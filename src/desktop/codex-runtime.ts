import { randomUUID } from 'node:crypto';
import { createInitialSnapshot } from '../core/engine';
import type { ActivityEvent, CodexStatus, Task, WorkspaceSnapshot, WorktreeInspection } from '../shared/types';
import { CodexClient } from './codex-client';
import { GitWorktreeService } from './git-worktrees';

type Wire = Record<string, any>;
export interface RuntimeClient {
  connect(): Promise<CodexStatus>;
  request<T = unknown>(method: string, params: unknown): Promise<T>;
  respond(id: string | number, result: unknown): void;
  onNotification(callback: (method: string, params: unknown) => void): () => void;
  onServerRequest(callback: (method: string, params: unknown, id: string | number) => void): () => void;
  onExit(callback: (error: Error) => void): () => void;
  close(): Promise<void>;
}
interface Options {
  snapshot?: WorkspaceSnapshot;
  worktrees: GitWorktreeService;
  onChange: (snapshot: WorkspaceSnapshot) => Promise<void>;
  clientFactory?: (executable?: string) => RuntimeClient;
}
interface Running { taskId: string; cancelled: boolean; threadId?: string; turnId?: string; starting: boolean; finished: Promise<void>; finish: () => void; }
const emptyStatus = (): CodexStatus => ({ state: 'disconnected', auth: 'none', message: 'Connect your installed Codex CLI to use live workers.', models: [], selectedModel: null });
const activeStatuses = new Set(['planning', 'working', 'testing', 'blocked']);
const timestamp = () => new Date().toISOString();
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const short = (value: unknown, limit = 4_000): string => typeof value === 'string' ? value.slice(0, limit) : '';
const opaqueId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value);

/** One real Codex worker. The simulation's other workers never imply real model calls. */
export class CodexRuntime {
  private state: WorkspaceSnapshot;
  private client?: RuntimeClient;
  private running?: Running;
  private connecting = false;
  private closing = false;
  private unsubscribers: (() => void)[] = [];
  private approvals = new Map<string, { wireId: string | number; taskId: string }>();
  private saveChain: Promise<void> = Promise.resolve();
  private launches = new Set<Promise<void>>();
  private executable?: string;
  private connectionDone?: Promise<void>;

  constructor(private options: Options) {
    this.state = options.snapshot?.mode === 'codex' ? structuredClone(options.snapshot) : createInitialSnapshot();
    this.state.mode = 'codex';
    this.state.codex = emptyStatus();
    this.state.approvals = [];
    this.state.paused = true; // Restarts never automatically spend usage or resume a turn.
    if (!options.snapshot) this.state.events = [];
    for (const task of this.state.tasks) {
      if (activeStatuses.has(task.status)) {
        task.status = 'interrupted';
        task.error = 'The desktop session ended. Reconnect Codex and resume explicitly; your worktree is preserved.';
        task.updatedAt = timestamp();
        task.jobs.forEach(job => { if (job.status === 'running') job.status = 'cancelled'; });
      }
    }
    this.updateAgents();
    if (!options.snapshot) this.event(null, 'system', 'Live mode uses one Codex worker in a separate Git worktree. Review changes yourself; no simulated QA runs here.');
  }

  get isBusy(): boolean { return Boolean(this.running || this.connecting); }
  getSnapshot(): WorkspaceSnapshot { return structuredClone(this.state); }
  private task(id: string): Task {
    const task = this.state.tasks.find(task => task.id === id);
    if (!task) throw new Error('Task not found.');
    return task;
  }
  private event(taskId: string | null, kind: ActivityEvent['kind'], text: string, itemId?: string, replace = false): void {
    const prior = itemId ? this.state.events.find(event => event.taskId === taskId && event.itemId === itemId && event.kind === kind) : undefined;
    if (prior) { prior.message = short(replace ? text : prior.message + text); return; }
    this.state.events.push({ id: `event-${randomUUID()}`, timestamp: timestamp(), agentId: taskId ? 'backend' : null, taskId, kind, message: short(text), ...(itemId ? { itemId } : {}) });
    this.state.events = this.state.events.slice(-180);
  }
  private updateAgents(): void {
    const task = this.state.tasks.find(task => activeStatuses.has(task.status) || task.status === 'review');
    for (const agent of this.state.agents) {
      agent.taskId = agent.id === 'backend' && task ? task.id : null;
      agent.status = agent.id === 'backend' && task ? task.status === 'blocked' ? 'blocked' : task.status === 'review' ? 'review' : task.status === 'planning' ? 'planning' : 'working' : 'idle';
      agent.activity = agent.id === 'backend' ? task ? task.status === 'blocked' ? 'Waiting for your command approval' : task.status === 'review' ? 'Codex finished; waiting for your review' : task.status === 'planning' ? 'Preparing an isolated worktree' : 'Codex is working in the task worktree' : 'Ready for a live Codex task' : 'Idle · additional live roles are not connected';
      if (agent.id === 'backend') agent.role = 'Codex developer';
    }
  }
  private publish(): Promise<void> {
    this.updateAgents();
    const snapshot = this.getSnapshot();
    const save = this.saveChain.then(() => this.options.onChange(snapshot));
    this.saveChain = save.catch(() => {});
    return save;
  }
  private announce(): void {
    void this.publish().catch(cause => {
      this.state.paused = true;
      this.state.codex = { ...this.state.codex!, state: 'error', message: `Could not save live state: ${message(cause)}` };
    });
  }
  private assertIdle(): void { if (this.closing) throw new Error('The workspace is closing.'); if (this.isBusy) throw new Error('Interrupt the active Codex task before changing this setting.'); }

  async setProject(path: string): Promise<WorkspaceSnapshot> {
    this.assertIdle();
    const repository = await this.options.worktrees.inspectRepository(path);
    if (this.state.projectPath !== repository.path && this.state.tasks.some(task => task.status === 'queued')) throw new Error('Cancel the queued live tasks before selecting a different repository.');
    this.state.projectPath = repository.path;
    this.event(null, 'system', `Selected ${repository.branch || 'detached HEAD'}. Tasks start from committed HEAD${repository.dirty ? '; existing uncommitted changes stay in your checkout' : ''}.`);
    await this.publish();
    return this.getSnapshot();
  }
  async connect(executable?: string): Promise<WorkspaceSnapshot> {
    this.assertIdle();
    const selectedModel = this.state.codex?.selectedModel;
    this.connecting = true;
    let finish!: () => void;
    this.connectionDone = new Promise(resolve => { finish = resolve; });
    this.state.codex = { ...emptyStatus(), state: 'connecting', message: 'Connecting to the local Codex app-server…' };
    this.announce();
    try {
      this.unsubscribers.splice(0).forEach(unsubscribe => unsubscribe());
      await this.client?.close();
      if (this.closing) return this.getSnapshot();
      if (executable) this.executable = executable;
      const client = this.options.clientFactory?.(this.executable) ?? new CodexClient(this.executable);
      this.client = client;
      this.unsubscribers.push(client.onNotification((method, params) => this.notification(method, params as Wire)));
      this.unsubscribers.push(client.onServerRequest((method, params, id) => this.serverRequest(method, params as Wire, id)));
      this.unsubscribers.push(client.onExit(error => this.disconnected(error)));
      this.state.codex = await client.connect();
      if (this.closing) { await client.close(); this.state.codex = emptyStatus(); return this.getSnapshot(); }
      if (selectedModel && this.state.codex.models.some(model => model.model === selectedModel)) this.state.codex.selectedModel = selectedModel;
      this.event(null, this.state.codex.state === 'ready' ? 'system' : 'error', this.state.codex.message);
    } catch (cause) {
      this.state.codex = { ...emptyStatus(), state: 'error', message: message(cause) };
    } finally { this.connecting = false; try { await this.publish(); } finally { finish(); } }
    return this.getSnapshot();
  }
  setModel(model: string): WorkspaceSnapshot {
    this.assertIdle();
    if (!this.state.codex?.models.some(item => item.model === model)) throw new Error('Choose a model from the connected Codex catalog.');
    this.state.codex.selectedModel = model;
    this.announce();
    return this.getSnapshot();
  }
  async submitTask(title: string): Promise<WorkspaceSnapshot> {
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 500) throw new Error('Enter a task brief of 1–500 characters.');
    if (!this.state.projectPath) throw new Error('Choose a Git repository before submitting a live task.');
    if (this.state.codex?.state !== 'ready' || !this.state.codex.selectedModel) throw new Error('Connect a signed-in Codex CLI and choose an available model first.');
    if (this.state.tasks.filter(task => task.status === 'queued').length >= 20 || this.state.tasks.length >= 500) throw new Error('The live task queue is full. Review or clear existing tasks.');
    const id = `task-${randomUUID()}`;
    this.state.tasks.push({ id, title: title.trim(), status: 'queued', progress: 0, createdAt: timestamp(), updatedAt: timestamp(), iteration: 1, runtime: 'codex', model: this.state.codex.selectedModel, jobs: [{ id: `${id}-codex`, agentId: 'backend', title: 'Codex implementation', status: 'pending', progress: 0, dependsOn: [] }] });
    this.event(id, 'task', 'Queued a live Codex task.');
    await this.publish();
    this.drain();
    return this.getSnapshot();
  }
  setPaused(paused: boolean): WorkspaceSnapshot {
    this.state.paused = paused;
    this.announce();
    if (!paused) this.drain();
    return this.getSnapshot();
  }
  private drain(): void {
    if (this.closing || this.running || this.state.paused || this.state.codex?.state !== 'ready' || this.state.tasks.some(task => task.status === 'review' || activeStatuses.has(task.status))) return;
    const task = this.state.tasks.find(task => task.status === 'queued');
    if (!task) return;
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    const running: Running = { taskId: task.id, cancelled: false, starting: true, finished, finish };
    this.running = running;
    const launch = this.start(task, running).catch(cause => this.fail(task, running, cause));
    this.launches.add(launch);
    void launch.finally(() => this.launches.delete(launch));
  }
  private async start(task: Task, running: Running): Promise<void> {
    task.status = 'planning'; task.updatedAt = timestamp();
    await this.publish();
    if (running.cancelled || this.closing) return this.release(running);
    if (task.worktree) await this.options.worktrees.inspect(task.worktree);
    else task.worktree = await this.options.worktrees.create(this.state.projectPath!, task.id);
    await this.publish(); // Persist worktree ownership before any model execution.
    if (running.cancelled || this.closing) return this.release(running);
    const settings = { model: task.model, modelProvider: 'openai', cwd: task.worktree.path, sandbox: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user' };
    const response = await this.client!.request<Wire>(task.threadId ? 'thread/resume' : 'thread/start', { ...settings, ...(task.threadId ? { threadId: task.threadId } : { developerInstructions: 'Work only in the provided task worktree. Implement the user brief, run appropriate checks, and report actual results and limitations. Do not merge or push; leave changes for the user to review. Do not represent simulated office characters as real workers.' }) });
    if (!opaqueId(response?.thread?.id)) throw new Error('Codex returned an invalid thread identifier.');
    task.threadId = response.thread.id;
    running.threadId = task.threadId;
    await this.publish();
    if (running.cancelled || this.closing) return this.release(running);
    task.status = 'working'; task.jobs[0].status = 'running'; task.error = undefined; task.turnId = undefined;
    await this.publish();
    if (running.cancelled || this.closing) return this.release(running);
    const text = task.pendingPrompt ?? task.title;
    const turn = await this.client!.request<Wire>('turn/start', {
      threadId: task.threadId, model: task.model, cwd: task.worktree.path, approvalPolicy: 'on-request', approvalsReviewer: 'user',
      sandboxPolicy: { type: 'workspaceWrite', writableRoots: [task.worktree.path], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true },
      input: [{ type: 'text', text, text_elements: [] }],
    });
    running.starting = false;
    if (!opaqueId(turn?.turn?.id)) throw new Error('Codex returned an invalid turn identifier.');
    task.turnId = turn.turn.id;
    task.pendingPrompt = undefined;
    running.turnId = task.turnId;
    if (running.cancelled || this.closing) {
      await this.client!.request('turn/interrupt', { threadId: task.threadId, turnId: task.turnId });
      this.release(running);
      return;
    }
    if (this.running === running) { this.event(task.id, 'task', 'Codex started in the isolated worktree.'); await this.publish(); }
  }
  private release(running: Running): void { running.finish(); if (this.running === running) this.running = undefined; this.drain(); }
  private fail(task: Task, running: Running, cause: unknown): void {
    if (this.running !== running) return;
    if (!running.cancelled) {
      task.status = 'failed'; task.error = short(message(cause)); task.jobs[0].status = 'failed'; task.updatedAt = timestamp();
      this.state.paused = true;
      this.event(task.id, 'error', task.error);
    }
    this.approvals.clear(); this.state.approvals = [];
    this.running = undefined;
    running.finish();
    this.announce();
  }
  private disconnected(error: Error): void {
    this.state.codex = { ...this.state.codex!, state: 'error', message: `Codex disconnected: ${short(error.message)}` };
    this.state.paused = true;
    if (this.running) this.fail(this.task(this.running.taskId), this.running, error);
    else this.announce();
  }
  private notification(method: string, params: Wire): void {
    if (method === 'serverRequest/resolved') {
      for (const [id, approval] of this.approvals) if (approval.wireId === params?.requestId) {
        this.approvals.delete(id);
        this.state.approvals = this.state.approvals!.filter(item => item.id !== id);
        const task = this.task(approval.taskId);
        if (task.status === 'blocked' && !this.state.approvals.some(item => item.taskId === task.id)) task.status = 'working';
      }
      this.announce(); return;
    }
    if (method === 'workspace/unsupportedServerRequest') {
      this.event(this.running?.taskId ?? null, 'error', `Codex requested an unsupported interaction (${short(params?.method, 200)}); it was declined.`);
      this.announce(); return;
    }
    const running = this.running;
    if (!running || !params || params.threadId !== running.threadId) return;
    const task = this.task(running.taskId);
    const turnId = params.turnId ?? params.turn?.id;
    if (running.turnId && turnId && running.turnId !== turnId) return;
    if (method === 'turn/started') {
      if (!opaqueId(params.turn?.id)) { this.fail(task, running, new Error('Codex sent an invalid turn identifier.')); return; }
      running.turnId = params.turn.id; task.turnId = params.turn.id;
    }
    if (method === 'turn/completed') {
      if (!running.cancelled) {
        const status = params.turn?.status;
        task.status = status === 'completed' ? 'review' : status === 'interrupted' ? 'interrupted' : 'failed';
        task.jobs[0].status = status === 'completed' ? 'completed' : status === 'interrupted' ? 'cancelled' : 'failed';
        task.error = status === 'failed' ? short(params.turn?.error?.message || 'Codex turn failed.') : undefined;
        task.updatedAt = timestamp();
        this.event(task.id, status === 'completed' ? 'review' : 'error', status === 'completed' ? 'Codex finished. Inspect the actual changes and reported checks before marking this task reviewed.' : task.error ?? 'Codex was interrupted; worktree changes are preserved.');
        if (status !== 'completed') this.state.paused = true;
      }
      this.clearApprovals(task.id);
      this.release(running);
    } else if (!running.cancelled && method === 'item/agentMessage/delta') {
      this.event(task.id, 'message', short(params.delta), short(params.itemId, 200));
    } else if (!running.cancelled && method === 'item/commandExecution/outputDelta') {
      this.event(task.id, 'tool', short(params.delta), `${short(params.itemId, 200)}-output`);
    } else if (!running.cancelled && (method === 'item/started' || method === 'item/completed')) {
      const item = params.item ?? {};
      if (item.type === 'agentMessage' && method === 'item/completed') this.event(task.id, 'message', short(item.text), short(item.id, 200), true);
      if (item.type === 'commandExecution') {
        this.event(task.id, 'tool', `${method === 'item/started' ? 'Running' : 'Finished'}: ${short(item.command, 2_000)}${method === 'item/completed' ? `\nExit code: ${item.exitCode ?? 'unavailable'}` : ''}`, short(item.id, 200), true);
        if (item.aggregatedOutput) this.event(task.id, 'tool', short(item.aggregatedOutput), `${short(item.id, 200)}-output`, true);
      }
      if (item.type === 'fileChange' && method === 'item/completed') this.event(task.id, 'tool', `File changes (${short(item.status, 80)}): ${(item.changes ?? []).map((change: Wire) => short(change.path, 500)).join(', ')}`);
    } else if (method === 'error') {
      this.event(task.id, 'error', `${short(params.error?.message || 'Codex reported an error.')}${params.willRetry ? ' (retrying)' : ''}`);
    }
    this.announce();
  }
  private serverRequest(method: string, params: Wire, wireId: string | number): void {
    const running = this.running;
    if (!running || running.cancelled || params?.threadId !== running.threadId || (running.turnId && params.turnId !== running.turnId)) {
      this.client?.respond(wireId, { decision: 'decline' }); return;
    }
    if (!['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(method)) { this.client?.respond(wireId, { decision: 'decline' }); return; }
    const task = this.task(running.taskId);
    const id = `approval-${randomUUID()}`;
    this.approvals.set(id, { wireId, taskId: task.id });
    this.state.approvals!.push({ id, taskId: task.id, kind: method.includes('commandExecution') ? 'command' : 'file', reason: short(params.reason || 'Codex requested approval.'), detail: short(params.command || params.grantRoot || 'Approve the proposed file changes.', 4_000) });
    task.status = 'blocked';
    this.event(task.id, 'task', 'Codex is waiting for your approval.');
    this.announce();
  }
  private clearApprovals(taskId: string): void {
    for (const [id, approval] of this.approvals) if (approval.taskId === taskId) this.approvals.delete(id);
    this.state.approvals = this.state.approvals!.filter(approval => approval.taskId !== taskId);
  }
  respondToApproval(id: string, accept: boolean): WorkspaceSnapshot {
    const approval = this.approvals.get(id);
    if (!approval || !this.client) throw new Error('This approval is no longer pending.');
    this.client.respond(approval.wireId, { decision: accept ? 'accept' : 'decline' });
    this.approvals.delete(id);
    this.state.approvals = this.state.approvals!.filter(item => item.id !== id);
    const task = this.task(approval.taskId);
    if (!this.state.approvals.some(item => item.taskId === task.id)) task.status = 'working';
    this.event(task.id, 'task', accept ? 'You approved the Codex request.' : 'You declined the Codex request.');
    this.announce();
    return this.getSnapshot();
  }
  approveTask(id: string): WorkspaceSnapshot {
    const task = this.task(id);
    if (task.status !== 'review') throw new Error('Only a finished task can be marked reviewed.');
    task.status = 'completed'; task.updatedAt = timestamp();
    this.event(id, 'review', 'You marked the task reviewed. Its branch and worktree remain available; no merge was performed.');
    this.announce(); this.drain();
    return this.getSnapshot();
  }
  async requestChanges(id: string, feedback?: string): Promise<WorkspaceSnapshot> {
    if (this.isBusy) throw new Error('Finish or interrupt the active Codex turn before resuming another.');
    const task = this.task(id);
    if (!['review', 'failed', 'interrupted'].includes(task.status)) throw new Error('This task cannot be resumed yet.');
    if (typeof feedback !== 'string' || !feedback.trim() || feedback.trim().length > 2_000) throw new Error('Describe the changes or next steps in 1–2,000 characters.');
    if (this.state.codex?.state !== 'ready') throw new Error('Reconnect Codex before resuming.');
    task.iteration++; task.status = 'queued'; task.updatedAt = timestamp(); task.jobs[0].status = 'pending'; task.error = undefined;
    task.pendingPrompt = feedback.trim();
    this.event(id, 'message', `Your feedback: ${feedback.trim()}`);
    await this.publish();
    this.drain();
    return this.getSnapshot();
  }
  async cancelTask(id: string): Promise<WorkspaceSnapshot> {
    const task = this.task(id);
    if (['completed', 'cancelled'].includes(task.status)) throw new Error('This task is already finished.');
    const running = this.running?.taskId === id ? this.running : undefined;
    if (running) {
      running.cancelled = true;
      for (const approval of this.approvals.values()) if (approval.taskId === id) {
        try { this.client?.respond(approval.wireId, { decision: 'cancel' }); } catch { /* Already resolved by the server. */ }
      }
      if (running.threadId && running.turnId) {
        try { await this.client!.request('turn/interrupt', { threadId: running.threadId, turnId: running.turnId }); }
        catch (cause) { this.event(id, 'error', `Interrupt failed; disconnecting the worker: ${message(cause)}`); await this.client?.close(); this.state.codex = { ...emptyStatus(), state: 'error', message: 'The worker was disconnected after interruption failed. Reconnect before continuing.' }; this.state.paused = true; this.release(running); }
        if (!running.starting && this.running === running) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const ended = await Promise.race([running.finished.then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 2_000); })]);
          if (timer) clearTimeout(timer);
          if (!ended) { await this.client?.close(); this.state.codex = { ...emptyStatus(), state: 'error', message: 'Codex did not confirm interruption. The worker was disconnected; reconnect to continue.' }; this.state.paused = true; this.release(running); }
        }
      }
    }
    this.clearApprovals(id); task.pendingPrompt = undefined;
    task.status = 'cancelled'; task.updatedAt = timestamp(); task.jobs[0].status = 'cancelled';
    this.event(id, 'task', 'Cancelled. Any worktree changes are preserved.');
    await this.publish();
    this.drain();
    return this.getSnapshot();
  }
  async inspectTask(id: string): Promise<WorktreeInspection> {
    const task = this.task(id);
    if (!task.worktree) throw new Error('This task does not have a worktree yet.');
    return this.options.worktrees.inspect(task.worktree);
  }
  async worktreePath(id: string): Promise<string> { await this.inspectTask(id); return this.task(id).worktree!.path; }
  reset(): WorkspaceSnapshot {
    this.assertIdle();
    this.state.tasks = []; this.state.events = []; this.state.approvals = []; this.state.paused = true;
    this.event(null, 'system', 'Cleared live task history. All Git branches and worktree folders were retained.');
    this.announce(); return this.getSnapshot();
  }
  async close(): Promise<void> {
    this.closing = true;
    if (this.running) {
      const task = this.task(this.running.taskId);
      this.running.cancelled = true;
      task.status = 'interrupted'; task.jobs[0].status = 'cancelled'; task.updatedAt = timestamp();
      this.event(task.id, 'system', 'Desktop closed. Resume explicitly after reconnecting; the worktree is preserved.');
      if (this.running.threadId && this.running.turnId) {
        try { await this.client?.request('turn/interrupt', { threadId: this.running.threadId, turnId: this.running.turnId }); } catch { /* Closing the child also ends the connection. */ }
      }
    }
    this.state.paused = true; this.clearAllApprovals();
    this.unsubscribers.splice(0).forEach(unsubscribe => unsubscribe());
    await this.client?.close();
    await this.connectionDone;
    await Promise.all([...this.launches]);
    this.running = undefined;
    await this.publish();
  }
  private clearAllApprovals(): void { this.approvals.clear(); this.state.approvals = []; }
}
