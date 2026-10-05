import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexRuntime, type RuntimeClient } from '../src/desktop/codex-runtime';
import { GitWorktreeService } from '../src/desktop/git-worktrees';
import type { CodexStatus, WorkspaceSnapshot } from '../src/shared/types';

const execute = promisify(execFile);
const ready: CodexStatus = { state: 'ready', auth: 'chatgpt', message: 'Fixture connected (no inference).', models: [{ id: 'fixture', model: 'fixture-model', displayName: 'Fixture', isDefault: true }], selectedModel: 'fixture-model' };
class FixtureClient implements RuntimeClient {
  requests: { method: string; params: any }[] = [];
  responses: { id: string | number; result: unknown }[] = [];
  notify = new Set<(method: string, params: unknown) => void>();
  servers = new Set<(method: string, params: unknown, id: string | number) => void>();
  exits = new Set<(error: Error) => void>();
  thread = 'thread-fixture';
  turn = 0;
  threads = 0;
  connect = async () => structuredClone(ready);
  request = async <T = unknown>(method: string, params: any): Promise<T> => {
    this.requests.push({ method, params: structuredClone(params) });
    if (method === 'thread/start') { this.thread = `thread-fixture-${++this.threads}`; return { thread: { id: this.thread } } as T; }
    if (method === 'thread/resume') { this.thread = params.threadId; return { thread: { id: this.thread } } as T; }
    if (method === 'turn/start') {
      const id = `turn-${++this.turn}`;
      this.emit('turn/started', { threadId: this.thread, turn: { id } });
      return { turn: { id } } as T;
    }
    if (method === 'turn/interrupt') this.emit('turn/completed', { threadId: this.thread, turn: { id: params.turnId, status: 'interrupted' } });
    return {} as T;
  };
  respond(id: string | number, result: unknown) { this.responses.push({ id, result }); }
  onNotification(callback: (method: string, params: unknown) => void) { this.notify.add(callback); return () => { this.notify.delete(callback); }; }
  onServerRequest(callback: (method: string, params: unknown, id: string | number) => void) { this.servers.add(callback); return () => { this.servers.delete(callback); }; }
  onExit(callback: (error: Error) => void) { this.exits.add(callback); return () => { this.exits.delete(callback); }; }
  close = async () => {};
  emit(method: string, params: unknown) { this.notify.forEach(callback => callback(method, params)); }
  finish(status = 'completed', id = `turn-${this.turn}`) { this.emit('turn/completed', { threadId: this.thread, turn: { id, status, error: status === 'failed' ? { message: 'Fixture failed' } : null } }); }
  approval(id: number, threadId = this.thread) { this.servers.forEach(callback => callback('item/commandExecution/requestApproval', { threadId, turnId: `turn-${this.turn}`, reason: 'Fixture approval', command: 'npm test' }, id)); }
}

describe('live runtime with real Git and a fixture Codex server', () => {
  let folder: string;
  let repository: string;
  let client: FixtureClient;
  let runtime: CodexRuntime;
  let service: GitWorktreeService;
  let saves: WorkspaceSnapshot[];
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'aw-runtime-'));
    repository = join(folder, 'repository');
    await execute('git', ['init', '-b', 'main', repository]);
    await execute('git', ['-C', repository, 'config', 'user.email', 'fixture@example.invalid']);
    await execute('git', ['-C', repository, 'config', 'user.name', 'Fixture']);
    await writeFile(join(repository, 'hello.txt'), 'original\n');
    await execute('git', ['-C', repository, 'add', '.']);
    await execute('git', ['-C', repository, 'commit', '-m', 'Fixture baseline']);
    client = new FixtureClient(); saves = [];
    service = new GitWorktreeService(join(folder, 'worktrees'));
    runtime = new CodexRuntime({ worktrees: service, clientFactory: () => client, onChange: async snapshot => { saves.push(snapshot); } });
    await runtime.setProject(repository);
    await runtime.connect();
    runtime.setPaused(false);
  });
  afterEach(async () => { await runtime.close(); await rm(folder, { recursive: true, force: true }); });
  async function start() {
    await runtime.submitTask('Change hello.txt and report checks.');
    await vi.waitFor(() => expect(runtime.getSnapshot().tasks[0]?.turnId).toBe('turn-1'));
    return runtime.getSnapshot().tasks[0];
  }

  async function completeReview(verdict = 'approved') {
    await vi.waitFor(() => expect(runtime.getSnapshot().tasks[0]?.review?.turnId).toBeDefined());
    client.emit('item/completed', { threadId: client.thread, turnId: `turn-${client.turn}`, item: { id: `review-${client.turn}`, type: 'agentMessage', phase: 'final_answer', text: JSON.stringify({ verdict, summary: 'Fixture review of actual files; no inference.', findings: verdict === 'approved' ? [] : ['Fix the fixture issue.'], checks: ['Inspected the fixture diff.'] }) } });
    client.finish();
    await vi.waitFor(() => expect(runtime.getSnapshot().tasks[0]?.status).toBe('review'));
  }

  async function reviewedTask() {
    const task = await start();
    await writeFile(join(task.worktree!.path, 'hello.txt'), 'reviewed fixture edit\n');
    client.finish(); await completeReview();
    return runtime.getSnapshot().tasks[0];
  }
  async function addRemote() {
    const remote = join(folder, 'remote.git');
    await execute('git', ['init', '--bare', remote]);
    await execute('git', ['-C', repository, 'remote', 'add', 'origin', remote]);
    await execute('git', ['-C', repository, 'push', 'origin', 'main']);
    return remote;
  }

  it('persists ownership before inference, isolates changes, streams actual output, and leaves review unmerged', async () => {
    const task = await start();
    const savedOwnership = saves.findIndex(snapshot => snapshot.tasks[0]?.worktree && !snapshot.tasks[0]?.threadId);
    expect(savedOwnership).toBeGreaterThanOrEqual(0);
    const turn = client.requests.find(request => request.method === 'turn/start')!;
    expect(turn.params.sandboxPolicy).toEqual({ type: 'workspaceWrite', writableRoots: [task.worktree!.path], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true });
    expect(client.requests.find(request => request.method === 'thread/start')!.params).toMatchObject({ modelProvider: 'openai', sandbox: 'workspace-write', approvalsReviewer: 'user' });
    await writeFile(join(task.worktree!.path, 'hello.txt'), 'actual fixture edit\n');
    client.emit('item/agentMessage/delta', { threadId: client.thread, turnId: 'turn-1', itemId: 'message-1', delta: 'First ' });
    client.emit('item/agentMessage/delta', { threadId: client.thread, turnId: 'turn-1', itemId: 'message-1', delta: 'second' });
    client.emit('item/completed', { threadId: client.thread, turnId: 'turn-1', item: { id: 'message-1', type: 'agentMessage', text: 'Final actual fixture output.' } });
    client.finish();
    expect(runtime.getSnapshot().tasks[0].status).toBe('reviewing');
    await completeReview();
    expect(runtime.getSnapshot().tasks[0].status).toBe('review');
    const reviewed = runtime.getSnapshot().tasks[0];
    expect(reviewed.review?.threadId).not.toBe(reviewed.threadId);
    expect(reviewed.review).toMatchObject({ status: 'approved', summary: 'Fixture review of actual files; no inference.' });
    const reviewerStart = client.requests.filter(request => request.method === 'thread/start').at(-1)!;
    expect(reviewerStart.params).toMatchObject({ cwd: task.worktree!.path, sandbox: 'read-only', approvalPolicy: 'never' });
    const reviewTurn = client.requests.filter(request => request.method === 'turn/start').at(-1)!;
    expect(reviewTurn.params.sandboxPolicy).toEqual({ type: 'readOnly', networkAccess: false });
    expect(reviewTurn.params.outputSchema.required).toContain('verdict');
    expect(reviewTurn.params.input[0].text).toContain('+actual fixture edit');
    expect(reviewTurn.params.input[0].text).toContain('Final actual fixture output.');
    expect(saves.some(snapshot => snapshot.tasks[0]?.review?.checkpoint && !snapshot.tasks[0]?.review?.threadId)).toBe(true);
    expect(runtime.getSnapshot().events.filter(event => event.itemId === 'message-1')).toHaveLength(1);
    expect((await runtime.inspectTask(task.id)).diff).toContain('+actual fixture edit');
    expect(await readFile(join(repository, 'hello.txt'), 'utf8')).toBe('original\n');
    runtime.approveTask(task.id);
    expect(runtime.getSnapshot().tasks[0].status).toBe('completed');
    expect(await readFile(join(task.worktree!.path, 'hello.txt'), 'utf8')).toBe('actual fixture edit\n');
    expect(runtime.getSnapshot().agents.filter(agent => agent.id !== 'backend').every(agent => agent.status === 'idle')).toBe(true);
  });

  it('requires explicit approval and rejects a request for another thread', async () => {
    await start();
    client.approval(5, 'unrelated');
    expect(client.responses[0]).toEqual({ id: 5, result: { decision: 'decline' } });
    client.approval(6);
    const snapshot = runtime.getSnapshot();
    expect(snapshot.tasks[0].status).toBe('blocked');
    expect(snapshot.approvals).toHaveLength(1);
    runtime.respondToApproval(snapshot.approvals![0].id, false);
    expect(client.responses[1]).toEqual({ id: 6, result: { decision: 'decline' } });
    expect(runtime.getSnapshot().tasks[0].status).toBe('working');
  });

  it('holds queued work during review and resumes revisions in the same thread/worktree', async () => {
    const first = await start();
    await runtime.submitTask('Another task');
    client.finish();
    await completeReview('changes-requested');
    expect(client.requests.filter(request => request.method === 'turn/start')).toHaveLength(2);
    expect(runtime.getSnapshot().tasks[1].status).toBe('queued');
    await expect(runtime.requestChanges(first.id)).rejects.toThrow('Describe');
    await runtime.requestChanges(first.id, 'Correct the edge case.');
    await vi.waitFor(() => expect(client.requests.filter(request => request.method === 'turn/start')).toHaveLength(3));
    const turn = client.requests.filter(request => request.method === 'turn/start').at(-1)!;
    expect(turn.params.input[0].text).toBe('Correct the edge case.');
    expect(turn.params.cwd).toBe(first.worktree!.path);
    expect(client.requests.some(request => request.method === 'thread/resume')).toBe(true);
    client.finish();
    await completeReview();
  });

  it('ignores stale turn completions and holds the queue after a real failure', async () => {
    await start();
    client.finish('completed', 'old-turn');
    expect(runtime.getSnapshot().tasks[0].status).toBe('working');
    client.finish('failed');
    expect(runtime.getSnapshot().tasks[0]).toMatchObject({ status: 'failed', error: 'Fixture failed' });
    expect(runtime.getSnapshot().paused).toBe(true);
  });

  it('interrupts cancellation and preserves changes', async () => {
    const task = await start();
    await writeFile(join(task.worktree!.path, 'hello.txt'), 'keep me\n');
    await runtime.cancelTask(task.id);
    expect(client.requests.some(request => request.method === 'turn/interrupt')).toBe(true);
    expect(runtime.getSnapshot().tasks[0].status).toBe('cancelled');
    expect(await readFile(join(task.worktree!.path, 'hello.txt'), 'utf8')).toBe('keep me\n');
    expect(runtime.isBusy).toBe(false);
  });

  it('restores interrupted history without reconnecting or spending usage', async () => {
    const task = await start();
    const saved = runtime.getSnapshot();
    saved.approvals = [{ id: 'old', taskId: task.id, kind: 'command', reason: 'stale', detail: 'stale' }];
    const restored = new CodexRuntime({ snapshot: saved, worktrees: new GitWorktreeService(join(folder, 'worktrees')), clientFactory: () => { throw new Error('must not launch'); }, onChange: async () => {} });
    expect(restored.getSnapshot()).toMatchObject({ mode: 'codex', paused: true, approvals: [], codex: { state: 'disconnected' } });
    expect(restored.getSnapshot().tasks[0]).toMatchObject({ status: 'interrupted', worktree: task.worktree, threadId: task.threadId });
    expect(restored.isBusy).toBe(false);
  });

  it('never starts inference if the worktree checkpoint cannot be saved', async () => {
    let reject = false;
    const guarded = new CodexRuntime({ worktrees: new GitWorktreeService(join(folder, 'guarded')), clientFactory: () => client, onChange: async snapshot => {
      if (reject && snapshot.tasks.some(task => task.worktree)) throw new Error('disk full');
    } });
    await guarded.setProject(repository); await guarded.connect(); guarded.setPaused(false); reject = true;
    await guarded.submitTask('A guarded task');
    await vi.waitFor(() => expect(guarded.getSnapshot().tasks[0].status).toBe('failed'));
    expect(client.requests).toHaveLength(0);
    expect(guarded.getSnapshot().paused).toBe(true);
  });

  it('requires Quinn approval and a matching user confirmation before real Git publication', async () => {
    const remote = await addRemote();
    const task = await reviewedTask();
    const before = (await execute('git', ['-C', repository, 'rev-parse', 'HEAD'])).stdout.trim();
    const prepared = await runtime.preparePublication(task.id, 'origin', 'Review fixture change');
    expect(prepared.tasks[0].publication?.phase).toBe('prepared');
    expect((await execute('git', ['-C', repository, 'rev-parse', 'HEAD'])).stdout.trim()).toBe(before);
    await expect(runtime.confirmPublication(task.id, 'publication-wrong')).rejects.toThrow('current, Quinn-approved');
    const published = await runtime.confirmPublication(task.id, prepared.tasks[0].publication!.plan.id);
    expect(published.tasks[0]).toMatchObject({ status: 'completed', publication: { phase: 'published', merged: true } });
    expect((await execute('git', ['-C', remote, 'rev-parse', 'refs/heads/main'])).stdout.trim()).toBe(published.tasks[0].publication!.mergeCommit);
    expect(await readFile(join(repository, 'hello.txt'), 'utf8')).toBe('reviewed fixture edit\n');
    expect(published.events.some(event => event.agentId === 'qa' && event.kind === 'review')).toBe(true);
    expect(published.events.some(event => event.agentId === 'manager' && event.message.includes('pushed'))).toBe(true);
  });

  it('keeps manager and reviewer actions on the existing task, including older local completions', async () => {
    const task = await reviewedTask();
    const workerThread = task.threadId;
    runtime.approveTask(task.id);
    await runtime.reviewTask(task.id); await completeReview();
    expect(runtime.getSnapshot().tasks).toHaveLength(1);
    expect(runtime.getSnapshot().tasks[0].worktree).toEqual(task.worktree);
    expect(runtime.getSnapshot().tasks[0].threadId).toBe(workerThread);
    expect(client.requests.filter(request => request.method === 'thread/start')).toHaveLength(3);
    expect(runtime.getSnapshot().tasks[0].jobs).toHaveLength(2);
  });

  it('rejects failed, malformed or changes-requested reviews as publication authority', async () => {
    const task = await start();
    client.finish(); await completeReview('changes-requested');
    await expect(runtime.preparePublication(task.id, 'origin', 'Must not publish')).rejects.toThrow('Quinn must approve');
    await runtime.reviewTask(task.id);
    await vi.waitFor(() => expect(runtime.getSnapshot().tasks[0].review?.turnId).toBeDefined());
    client.emit('item/completed', { threadId: client.thread, turnId: `turn-${client.turn}`, item: { id: 'bad-review', type: 'agentMessage', text: 'Looks fine, just push it!' } });
    client.finish();
    await vi.waitFor(() => expect(runtime.getSnapshot().tasks[0].review?.status).toBe('failed'));
    await expect(runtime.preparePublication(task.id, 'origin', 'Must not publish')).rejects.toThrow('Quinn must approve');
    expect(await readFile(join(repository, 'hello.txt'), 'utf8')).toBe('original\n');
  });

  it('invalidates a review if files change while Quinn is reviewing', async () => {
    const task = await start(); client.finish();
    await vi.waitFor(() => expect(runtime.getSnapshot().tasks[0].review?.turnId).toBeDefined());
    await writeFile(join(task.worktree!.path, 'hello.txt'), 'edit made during review\n');
    await completeReview();
    expect(runtime.getSnapshot().tasks[0].review?.status).toBe('stale');
    await expect(runtime.preparePublication(task.id, 'origin', 'Must not publish')).rejects.toThrow('Quinn must approve');
  });

  it('declines reviewer escalation and retains Rowan’s completed work when Quinn is cancelled', async () => {
    const task = await start(); client.finish();
    await vi.waitFor(() => expect(runtime.getSnapshot().tasks[0].review?.turnId).toBeDefined());
    client.approval(123);
    expect(client.responses.at(-1)).toEqual({ id: 123, result: { decision: 'decline' } });
    expect(runtime.getSnapshot().approvals).toEqual([]);
    expect(runtime.getSnapshot().tasks[0].status).toBe('reviewing');
    const cancelled = await runtime.cancelTask(task.id);
    expect(cancelled.tasks[0]).toMatchObject({ status: 'cancelled', review: { status: 'interrupted' } });
    expect(cancelled.tasks[0].jobs[0].status).toBe('completed');
    expect(cancelled.tasks[0].worktree).toEqual(task.worktree);
  });

  it('does not auto-publish or launch inference on restart with a prepared or interrupted handoff', async () => {
    await addRemote(); const task = await reviewedTask();
    const prepared = await runtime.preparePublication(task.id, 'origin', 'Review fixture change');
    for (const phase of ['prepared', 'pushing'] as const) {
      const snapshot = structuredClone(prepared);
      snapshot.tasks[0].publication!.phase = phase;
      snapshot.tasks[0].status = phase === 'pushing' ? 'publishing' : 'review';
      const restored = new CodexRuntime({ snapshot, worktrees: new GitWorktreeService(join(folder, 'worktrees')), clientFactory: () => { throw new Error('Must not launch inference'); }, onChange: async () => {} });
      expect(restored.isBusy).toBe(false);
      expect(restored.getSnapshot().tasks[0].publication?.phase).toBe(phase === 'prepared' ? 'prepared' : 'interrupted');
      expect(restored.getSnapshot().tasks[0].review?.status).toBe('approved');
      expect(await readFile(join(repository, 'hello.txt'), 'utf8')).toBe('original\n');
      await restored.close();
    }
  });

  it('can explicitly publish a durable Quinn-approved review after restart without reconnecting Codex', async () => {
    await addRemote(); const task = await reviewedTask();
    const prepared = await runtime.preparePublication(task.id, 'origin', 'Reviewed fixture');
    await runtime.close();
    const restored = new CodexRuntime({ snapshot: prepared, worktrees: service, clientFactory: () => { throw new Error('Git handoff must not start model inference'); }, onChange: async () => {} });
    try {
      const published = await restored.confirmPublication(task.id, prepared.tasks[0].publication!.plan.id);
      expect(published.tasks[0].publication?.phase).toBe('published');
      expect(published.codex?.state).toBe('disconnected');
    } finally { await restored.close(); }
  });

  it('blocks overlapping actions and waits for a confirmed Git transaction before closing', async () => {
    await addRemote(); const task = await reviewedTask();
    const prepared = await runtime.preparePublication(task.id, 'origin', 'Reviewed fixture');
    let entered!: () => void; let resume!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const publish = service.publish.bind(service);
    vi.spyOn(service, 'publish').mockImplementation(async (...args) => { entered(); await gate; return publish(...args); });
    const transaction = runtime.confirmPublication(task.id, prepared.tasks[0].publication!.plan.id);
    await started;
    expect(runtime.isBusy).toBe(true);
    expect(runtime.getSnapshot().tasks[0].status).toBe('publishing');
    await expect(runtime.cancelTask(task.id)).rejects.toThrow('Git handoff');
    await expect(runtime.reviewTask(task.id)).rejects.toThrow('active Codex task');
    await expect(runtime.setProject(repository)).rejects.toThrow('active Codex task');
    expect(() => runtime.reset()).toThrow('active Codex task');
    let closed = false;
    const closing = runtime.close().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false);
    resume(); await Promise.all([transaction, closing]);
    expect(runtime.getSnapshot().tasks[0].publication?.phase).toBe('published');
    expect(runtime.getSnapshot().paused).toBe(true);
    expect(runtime.isBusy).toBe(false);
  });

  it('does not resurrect a task when closing races with Git plan preparation', async () => {
    await addRemote(); const task = await reviewedTask();
    let entered!: () => void; let resume!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const prepare = service.preparePublication.bind(service);
    vi.spyOn(service, 'preparePublication').mockImplementation(async (...args) => { entered(); await gate; return prepare(...args); });
    const preparation = runtime.preparePublication(task.id, 'origin', 'Reviewed fixture');
    const rejected = expect(preparation).rejects.toThrow('closing');
    await started;
    expect(runtime.isBusy).toBe(true);
    await expect(runtime.reviewTask(task.id)).rejects.toThrow('active Codex task');
    await expect(runtime.cancelTask(task.id)).rejects.toThrow('Git handoff');
    const closing = runtime.close(); resume();
    await Promise.all([rejected, closing]);
    expect(runtime.getSnapshot().tasks[0].publication).toBeUndefined();
    expect(await readFile(join(repository, 'hello.txt'), 'utf8')).toBe('original\n');
  });

  it('releases queued work if cancelled Quinn startup later fails', async () => {
    const task = await start(); await runtime.submitTask('The next task should still start');
    let entered!: () => void; let fail!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const failed = new Promise<void>(resolve => { fail = resolve; });
    vi.spyOn(service, 'checkpoint').mockImplementationOnce(async () => { entered(); await failed; throw new Error('Fixture checkpoint error after cancellation'); });
    client.finish(); await started;
    await runtime.cancelTask(task.id);
    expect(runtime.getSnapshot().tasks[1].status).toBe('queued');
    fail();
    await vi.waitFor(() => expect(runtime.getSnapshot().tasks[1].turnId).toBeDefined());
    expect(runtime.getSnapshot().tasks[0]).toMatchObject({ status: 'cancelled', review: { status: 'interrupted' } });
    expect(runtime.getSnapshot().tasks[1].status).toBe('working');
  });
});
