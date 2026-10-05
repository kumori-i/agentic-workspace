import { describe, expect, it, vi } from 'vitest';
import { CodexRuntime, type RuntimeClient } from '../src/desktop/codex-runtime';
import type { GitWorktreeService } from '../src/desktop/git-worktrees';
import type { CodexStatus, WorktreeInfo, WorkspaceSnapshot } from '../src/shared/types';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

const ready: CodexStatus = {
  state: 'ready', auth: 'chatgpt', message: 'Race fixture; no inference.', selectedModel: 'fixture-model',
  models: [{ id: 'fixture-model', model: 'fixture-model', displayName: 'Fixture model', isDefault: true }],
};
const worktreeFor = (repositoryPath: string, id: string): WorktreeInfo => ({
  path: `/fixture/worktrees/${id}`, repositoryPath, branch: `agentic/${id}`,
  baseCommit: 'a'.repeat(40), createdAt: '2026-10-05T12:00:00.000Z',
});

class RaceClient implements RuntimeClient {
  requests: { method: string; params: any }[] = [];
  responses: { id: string | number; result: unknown }[] = [];
  notifications = new Set<(method: string, params: unknown) => void>();
  serverRequests = new Set<(method: string, params: unknown, id: string | number) => void>();
  exits = new Set<(error: Error) => void>();
  interruptError?: Error;
  threadId: unknown = 'thread-fixture';
  turnId: unknown = 'turn-fixture';
  closed = vi.fn(async () => {});
  connected = vi.fn(async () => structuredClone(ready));
  turnRequested = deferred<void>();

  connect(): Promise<CodexStatus> { return this.connected(); }
  async request<T = unknown>(method: string, params: any): Promise<T> {
    this.requests.push({ method, params: structuredClone(params) });
    if (method === 'thread/start' || method === 'thread/resume') return { thread: { id: this.threadId } } as T;
    if (method === 'turn/start') { this.turnRequested.resolve(); return { turn: { id: this.turnId } } as T; }
    if (method === 'turn/interrupt') {
      if (this.interruptError) throw this.interruptError;
      this.notify('turn/completed', { threadId: this.threadId, turn: { id: this.turnId, status: 'interrupted' } });
    }
    return {} as T;
  }
  respond(id: string | number, result: unknown): void { this.responses.push({ id, result }); }
  onNotification(callback: (method: string, params: unknown) => void): () => void {
    this.notifications.add(callback); return () => { this.notifications.delete(callback); };
  }
  onServerRequest(callback: (method: string, params: unknown, id: string | number) => void): () => void {
    this.serverRequests.add(callback); return () => { this.serverRequests.delete(callback); };
  }
  onExit(callback: (error: Error) => void): () => void {
    this.exits.add(callback); return () => { this.exits.delete(callback); };
  }
  close(): Promise<void> { return this.closed(); }
  notify(method: string, params: unknown): void { this.notifications.forEach(callback => callback(method, params)); }
  approval(id: string | number, threadId = this.threadId): void {
    this.serverRequests.forEach(callback => callback('item/commandExecution/requestApproval', {
      threadId, turnId: this.turnId, reason: 'Fixture command approval', command: 'fixture-check',
    }, id));
  }
}

function fixture() {
  const client = new RaceClient();
  const saved: WorkspaceSnapshot[] = [];
  const service = {
    inspectRepository: vi.fn(async (path: string) => ({ path, head: 'a'.repeat(40), branch: 'main', dirty: false })),
    create: vi.fn(async (path: string, id: string) => worktreeFor(path, id)),
    inspect: vi.fn(async (_worktree: WorktreeInfo) => ({ status: '', diff: '', files: [], truncated: false })),
  };
  const clientFactory = vi.fn(() => client);
  const runtime = new CodexRuntime({
    worktrees: service as unknown as GitWorktreeService, clientFactory,
    onChange: async snapshot => { saved.push(structuredClone(snapshot)); },
  });
  return { client, service, clientFactory, runtime, saved };
}

/** Drain deterministic promise continuations; there are no timers or real processes. */
async function settleUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await Promise.resolve();
  expect(predicate(), 'Expected asynchronous fixture checkpoint to settle').toBe(true);
}

async function connect(runtime: CodexRuntime): Promise<void> {
  await runtime.setProject('/fixture/repository');
  await runtime.connect();
}

async function start(runtime: CodexRuntime, client: RaceClient): Promise<string> {
  await connect(runtime);
  runtime.setPaused(false);
  await runtime.submitTask('Exercise the runtime race fixture');
  await client.turnRequested.promise;
  await settleUntil(() => runtime.getSnapshot().tasks[0]?.turnId === 'turn-fixture');
  return runtime.getSnapshot().tasks[0].id;
}

describe('CodexRuntime lifecycle race regression checks', () => {
  it('cannot retarget queued work to a different repository', async () => {
    const { runtime, service, client } = fixture();
    await connect(runtime);
    const queued = await runtime.submitTask('A task owned by the original repository');
    expect(queued.paused).toBe(true);
    expect(queued.tasks[0].status).toBe('queued');
    await expect(runtime.setProject('/fixture/another-repository')).rejects.toThrow('queued live tasks');
    expect(runtime.getSnapshot().projectPath).toBe('/fixture/repository');
    expect(runtime.getSnapshot().tasks[0].id).toBe(queued.tasks[0].id);
    expect(service.create).not.toHaveBeenCalled();
    expect(client.requests).toHaveLength(0);
    runtime.setPaused(false);
    await client.turnRequested.promise;
    await settleUntil(() => runtime.getSnapshot().tasks[0]?.turnId === 'turn-fixture');
    expect(service.create).toHaveBeenCalledWith('/fixture/repository', queued.tasks[0].id);
    await runtime.close();
  });

  it('releases busy state and holds the queue when interrupt is rejected', async () => {
    const { runtime, client } = fixture();
    const id = await start(runtime, client);
    await runtime.submitTask('A queued task must remain stopped');
    client.approval('approval-wire');
    client.interruptError = new Error('Fixture interrupt was rejected');
    const cancelled = await runtime.cancelTask(id);
    expect(runtime.isBusy).toBe(false);
    expect(client.closed).toHaveBeenCalledOnce();
    expect(cancelled).toMatchObject({ paused: true, approvals: [], codex: { state: 'error' } });
    expect(cancelled.tasks[0]).toMatchObject({ status: 'cancelled', jobs: [{ status: 'cancelled' }] });
    expect(cancelled.tasks[0].worktree).toBeDefined();
    expect(cancelled.tasks[1].status).toBe('queued');
    expect(client.requests.filter(request => request.method === 'turn/start')).toHaveLength(1);
    expect(cancelled.events.some(event => event.kind === 'error' && event.message.includes('Interrupt failed'))).toBe(true);
    await runtime.close();
  });

  it('holds the next task until completion when cancelling before the turn/start reply arrives', async () => {
    const { runtime, client, service } = fixture();
    const firstStarted = deferred<void>();
    const firstStartReply = deferred<{ turn: { id: string } }>();
    const firstStartReturned = deferred<void>();
    const interruptRequested = deferred<void>();
    const interruptReply = deferred<Record<string, never>>();
    const interruptReturned = deferred<void>();
    const firstTurnId = 'turn-before-reply';
    let starts = 0;
    const request = client.request.bind(client);
    vi.spyOn(client, 'request').mockImplementation(async (method, params: any): Promise<any> => {
      if (method === 'turn/start') {
        client.requests.push({ method, params: structuredClone(params) });
        starts++;
        const id = starts === 1 ? firstTurnId : 'turn-next-task';
        client.turnId = id;
        client.notify('turn/started', { threadId: client.threadId, turn: { id } });
        if (starts === 1) {
          firstStarted.resolve();
          const response = await firstStartReply.promise;
          firstStartReturned.resolve();
          return response;
        }
        return { turn: { id } };
      }
      if (method === 'turn/interrupt' && params.turnId === firstTurnId) {
        client.requests.push({ method, params: structuredClone(params) });
        interruptRequested.resolve();
        const response = await interruptReply.promise;
        interruptReturned.resolve();
        return response;
      }
      return request(method, params);
    });
    await connect(runtime);
    runtime.setPaused(false);
    await runtime.submitTask('The first turn has started but its reply is delayed');
    await firstStarted.promise;
    const firstTask = runtime.getSnapshot().tasks[0];
    expect(firstTask.turnId).toBe(firstTurnId);
    await runtime.submitTask('The second task must wait for confirmed interruption');
    let cancelled = false;
    const cancellation = runtime.cancelTask(firstTask.id).then(() => { cancelled = true; });
    await interruptRequested.promise;
    // Deliver the delayed turn/start response during cancellation. An interrupt
    // acknowledgement alone must not release ownership of the still-running turn.
    firstStartReply.resolve({ turn: { id: firstTurnId } });
    interruptReply.resolve({});
    await Promise.all([firstStartReturned.promise, interruptReturned.promise]);
    for (let continuation = 0; continuation < 100; continuation++) await Promise.resolve();
    try {
      expect(cancelled).toBe(false);
      expect(runtime.isBusy).toBe(true);
      expect(runtime.getSnapshot().tasks[1].status).toBe('queued');
      expect(client.requests.filter(item => item.method === 'turn/start')).toHaveLength(1);
      expect(service.create).toHaveBeenCalledOnce();
    } finally {
      client.notify('turn/completed', { threadId: client.threadId, turn: { id: firstTurnId, status: 'interrupted' } });
      await cancellation;
    }
    await settleUntil(() => client.requests.filter(item => item.method === 'turn/start').length === 2);
    expect(runtime.getSnapshot().tasks[0].status).toBe('cancelled');
    expect(service.create).toHaveBeenCalledTimes(2);
    await runtime.close();
  });

  it('removes approvals resolved by the server and rejects stale UI responses', async () => {
    const { runtime, client } = fixture();
    await start(runtime, client);
    client.approval('foreign-request', 'unrelated-thread');
    expect(client.responses).toEqual([{ id: 'foreign-request', result: { decision: 'decline' } }]);
    client.approval(41);
    client.approval(42);
    const approvals = runtime.getSnapshot().approvals!;
    expect(approvals).toHaveLength(2);
    client.notify('serverRequest/resolved', { requestId: 'not-a-real-request' });
    expect(runtime.getSnapshot().approvals).toHaveLength(2);
    client.notify('serverRequest/resolved', { requestId: 41 });
    expect(runtime.getSnapshot().tasks[0].status).toBe('blocked');
    expect(runtime.getSnapshot().approvals).toHaveLength(1);
    expect(() => runtime.respondToApproval(approvals[0].id, true)).toThrow('no longer pending');
    client.notify('serverRequest/resolved', { requestId: 42 });
    expect(runtime.getSnapshot().approvals).toEqual([]);
    expect(runtime.getSnapshot().tasks[0].status).toBe('working');
    expect(() => runtime.respondToApproval(approvals[1].id, true)).toThrow('no longer pending');
    expect(client.responses).toHaveLength(1);
    await runtime.close();
  });

  it('waits for delayed worktree creation on close and saves the retained ownership metadata', async () => {
    const { runtime, service, client, saved } = fixture();
    const creating = deferred<void>();
    const created = deferred<WorktreeInfo>();
    service.create.mockImplementation(async () => { creating.resolve(); return created.promise; });
    await connect(runtime);
    runtime.setPaused(false);
    await runtime.submitTask('Close while the worktree is being created');
    await creating.promise;
    const id = runtime.getSnapshot().tasks[0].id;
    let closed = false;
    const closing = runtime.close().then(() => { closed = true; });
    await settleUntil(() => client.closed.mock.calls.length === 1);
    await Promise.resolve();
    expect(closed).toBe(false);
    expect(client.requests).toHaveLength(0);
    const retained = worktreeFor('/fixture/repository', id);
    created.resolve(retained);
    await closing;
    expect(closed).toBe(true);
    expect(runtime.isBusy).toBe(false);
    expect(runtime.getSnapshot()).toMatchObject({ paused: true, tasks: [{ id, status: 'interrupted', worktree: retained }] });
    expect(saved.at(-1)?.tasks[0]).toMatchObject({ id, status: 'interrupted', worktree: retained });
    expect(client.requests).toHaveLength(0);
  });

  it('cannot create a new client when shutdown races with reconnecting the old client', async () => {
    const { runtime, client, clientFactory } = fixture();
    await connect(runtime);
    const closeEntered = deferred<void>();
    const oldClientClosed = deferred<void>();
    client.closed.mockImplementation(async () => { closeEntered.resolve(); await oldClientClosed.promise; });
    const reconnecting = runtime.connect();
    await closeEntered.promise;
    expect(runtime.isBusy).toBe(true);
    let finished = false;
    const closing = runtime.close().then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    oldClientClosed.resolve();
    await Promise.all([reconnecting, closing]);
    expect(clientFactory).toHaveBeenCalledOnce();
    expect(client.connected).toHaveBeenCalledOnce();
    expect(runtime.isBusy).toBe(false);
    expect(runtime.getSnapshot().paused).toBe(true);
    await expect(runtime.connect()).rejects.toThrow('closing');
  });

  it.each(['', null, 123, 'bad\nthread'])('rejects invalid thread identifiers (%j) before starting a turn', async invalidId => {
    const { runtime, client } = fixture();
    client.threadId = invalidId;
    await connect(runtime);
    runtime.setPaused(false);
    await runtime.submitTask('An invalid thread must never launch inference');
    await settleUntil(() => runtime.getSnapshot().tasks[0]?.status === 'failed');
    expect(runtime.isBusy).toBe(false);
    expect(runtime.getSnapshot().tasks[0].error).toContain('invalid thread identifier');
    expect(runtime.getSnapshot().tasks[0].worktree).toBeDefined();
    expect(client.requests.filter(request => request.method === 'turn/start')).toHaveLength(0);
    expect(runtime.getSnapshot().paused).toBe(true);
    await runtime.close();
  });
});
