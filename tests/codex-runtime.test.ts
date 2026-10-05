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
  connect = async () => structuredClone(ready);
  request = async <T = unknown>(method: string, params: any): Promise<T> => {
    this.requests.push({ method, params: structuredClone(params) });
    if (method === 'thread/start' || method === 'thread/resume') return { thread: { id: this.thread } } as T;
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
  let saves: WorkspaceSnapshot[];
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'aw-runtime-'));
    repository = join(folder, 'repository');
    await execute('git', ['init', repository]);
    await execute('git', ['-C', repository, 'config', 'user.email', 'fixture@example.invalid']);
    await execute('git', ['-C', repository, 'config', 'user.name', 'Fixture']);
    await writeFile(join(repository, 'hello.txt'), 'original\n');
    await execute('git', ['-C', repository, 'add', '.']);
    await execute('git', ['-C', repository, 'commit', '-m', 'Fixture baseline']);
    client = new FixtureClient(); saves = [];
    runtime = new CodexRuntime({ worktrees: new GitWorktreeService(join(folder, 'worktrees')), clientFactory: () => client, onChange: async snapshot => { saves.push(snapshot); } });
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
    expect(runtime.getSnapshot().tasks[0].status).toBe('review');
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
    expect(client.requests.filter(request => request.method === 'turn/start')).toHaveLength(1);
    await expect(runtime.requestChanges(first.id)).rejects.toThrow('Describe');
    await runtime.requestChanges(first.id, 'Correct the edge case.');
    await vi.waitFor(() => expect(client.requests.filter(request => request.method === 'turn/start')).toHaveLength(2));
    const turn = client.requests.filter(request => request.method === 'turn/start').at(-1)!;
    expect(turn.params.input[0].text).toBe('Correct the edge case.');
    expect(turn.params.cwd).toBe(first.worktree!.path);
    expect(client.requests.some(request => request.method === 'thread/resume')).toBe(true);
    client.finish();
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
});
