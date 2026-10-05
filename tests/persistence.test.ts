import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceEngine } from '../src/core/engine';
import { parseWorkspaceSnapshot, readWorkspaceState, writeWorkspaceState } from '../src/desktop/persistence';
import type { WorkspaceSnapshot } from '../src/shared/types';

function liveSnapshot(directory: string): WorkspaceSnapshot {
  const engine = new WorkspaceEngine();
  engine.submitTask('Persist a real worker task');
  const snapshot = engine.getSnapshot();
  snapshot.mode = 'codex';
  snapshot.paused = true;
  snapshot.projectPath = directory;
  snapshot.codex = {
    state: 'disconnected', auth: 'none', message: 'Reconnect explicitly.',
    models: [{ id: 'model-a', model: 'gpt-a', displayName: 'Model A', isDefault: true }],
    selectedModel: 'gpt-a', version: '1.0.0', plan: 'Pro',
  };
  snapshot.tasks[0] = {
    ...snapshot.tasks[0], runtime: 'codex', status: 'interrupted',
    threadId: 'thread:001', turnId: 'turn-001', model: 'gpt-a', error: 'Interrupted on close.',
    pendingPrompt: 'Continue with the requested revision.',
    worktree: { path: join(directory, 'task-worktree'), repositoryPath: directory,
      branch: 'codex/task-001', baseCommit: 'a'.repeat(40), createdAt: new Date().toISOString() },
    jobs: [{ id: 'task-1-codex', agentId: 'backend', title: 'Codex implementation', status: 'cancelled', progress: 0, dependsOn: [] }],
  };
  snapshot.agents[0].status = 'blocked';
  snapshot.agents[1].status = 'error';
  snapshot.events[0].kind = 'tool';
  snapshot.events[0].itemId = 'item:001';
  snapshot.approvals = [{ id: 'approval-001', taskId: snapshot.tasks[0].id, kind: 'command', reason: 'Pending', detail: 'Do not restore this decision.' }];
  return snapshot;
}

describe('workspace persistence', () => {
  let directory: string;
  let statePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'agentic-workspace-state-'));
    statePath = join(directory, 'workspace-state.json');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('returns an empty result on a first launch', async () => {
    expect(await readWorkspaceState(statePath)).toEqual({});
  });

  it('round trips active task progress, pause status and project selection', async () => {
    const engine = new WorkspaceEngine();
    engine.setProject(directory);
    engine.submitTask('Improve the agent task inspector');
    engine.tick(2500);
    engine.setPaused(true);
    const snapshot = engine.getSnapshot();
    await writeWorkspaceState(statePath, snapshot);
    const restored = await readWorkspaceState(statePath);
    expect(restored.snapshot).toEqual(snapshot);
    expect(restored.warning).toBeUndefined();
    expect(restored.snapshot!.tasks[0].status).not.toBe('completed');
    expect(restored.snapshot!.paused).toBe(true);
    expect(await readdir(directory)).toEqual(['workspace-state.json']);
  });

  it('replaces an existing state file without leaving temporary files', async () => {
    const engine = new WorkspaceEngine();
    await writeWorkspaceState(statePath, engine.getSnapshot());
    engine.submitTask('Add a review panel');
    await writeWorkspaceState(statePath, engine.getSnapshot());
    expect((await readWorkspaceState(statePath)).snapshot!.tasks).toHaveLength(1);
    expect(await readdir(directory)).toEqual(['workspace-state.json']);
  });

  it('recovers from corrupt JSON without throwing', async () => {
    await writeFile(statePath, '{ "schemaVersion":');
    const result = await readWorkspaceState(statePath);
    expect(result.snapshot).toBeUndefined();
    expect(result.warning).toContain('ignored');
  });

  it('ignores unsupported schemas and refuses invalid relationships', async () => {
    const snapshot = new WorkspaceEngine().getSnapshot();
    expect(parseWorkspaceSnapshot({ ...snapshot, schemaVersion: 2 })).toBeNull();
    expect(parseWorkspaceSnapshot({ ...snapshot, agents: snapshot.agents.slice(1) })).toBeNull();
    expect(parseWorkspaceSnapshot({ ...snapshot, agents: snapshot.agents.map(agent => ({ ...agent, taskId: 'missing-task' })) })).toBeNull();
    await writeFile(statePath, JSON.stringify({ ...snapshot, mode: 'api' }));
    expect((await readWorkspaceState(statePath)).snapshot).toBeUndefined();
  });

  it('rejects invalid progress and dependencies while preserving the previous file', async () => {
    const engine = new WorkspaceEngine();
    engine.submitTask('Review workspace state');
    const valid = engine.getSnapshot();
    await writeWorkspaceState(statePath, valid);
    const invalid = structuredClone(valid);
    invalid.tasks[0].progress = Number.NaN;
    await expect(writeWorkspaceState(statePath, invalid)).rejects.toThrow('invalid');
    expect((await readWorkspaceState(statePath)).snapshot).toEqual(valid);
    const invalidDependency = structuredClone(valid);
    invalidDependency.tasks[0].jobs[0].dependsOn = ['missing-job'];
    expect(parseWorkspaceSnapshot(invalidDependency)).toBeNull();
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toEqual(valid);
  });

  it('does not retain unknown persisted properties', () => {
    const snapshot = new WorkspaceEngine().getSnapshot();
    const parsed = parseWorkspaceSnapshot({ ...snapshot, apiKey: 'unexpected-field' });
    expect(parsed).toEqual(snapshot);
    expect(parsed).not.toHaveProperty('apiKey');
  });

  it('ignores oversized state files', async () => {
    await writeFile(statePath, ' '.repeat(5 * 1024 * 1024 + 1));
    const result = await readWorkspaceState(statePath);
    expect(result.snapshot).toBeUndefined();
    expect(result.warning).toContain('too large');
  });

  it('persists live task ownership and queued revision metadata without pending approvals', async () => {
    const live = liveSnapshot(directory);
    await writeWorkspaceState(statePath, live);
    const restored = (await readWorkspaceState(statePath)).snapshot!;
    expect(restored.mode).toBe('codex');
    expect(restored.tasks).toEqual(live.tasks);
    expect(restored.codex).toEqual(live.codex);
    expect(restored.events[0].itemId).toBe('item:001');
    expect(restored).not.toHaveProperty('approvals');
    expect(await readFile(statePath, 'utf8')).not.toContain('approval-001');
  });

  it('keeps simulation and live histories in independent state files', async () => {
    const simulationPath = join(directory, 'workspace-state.json');
    const livePath = join(directory, 'codex-state.json');
    const simulation = new WorkspaceEngine().getSnapshot();
    const live = liveSnapshot(directory);
    await writeWorkspaceState(simulationPath, simulation);
    await writeWorkspaceState(livePath, live);
    expect((await readWorkspaceState(simulationPath)).snapshot).toEqual(simulation);
    expect((await readWorkspaceState(livePath)).snapshot!.tasks[0].worktree).toEqual(live.tasks[0].worktree);
    expect((await readWorkspaceState(livePath)).snapshot!.mode).toBe('codex');
  });

  it('strips unrecognized credential fields from nested live metadata on read and write', async () => {
    const snapshot = liveSnapshot(directory);
    const untrusted = {
      ...snapshot, accessToken: 'secret-root-token',
      codex: { ...snapshot.codex, apiKey: 'secret-codex-key',
        models: snapshot.codex!.models.map(model => ({ ...model, refreshToken: 'secret-model-token' })) },
      tasks: snapshot.tasks.map(task => ({ ...task, token: 'secret-task-token',
        worktree: { ...task.worktree, credential: 'secret-worktree-token' } })),
    };
    await writeFile(statePath, JSON.stringify(untrusted));
    const sanitized = (await readWorkspaceState(statePath)).snapshot!;
    await writeWorkspaceState(statePath, sanitized);
    const serialized = await readFile(statePath, 'utf8');
    expect(serialized).not.toContain('secret-');
    expect(sanitized.tasks[0].threadId).toBe('thread:001');
    expect(sanitized.tasks[0].pendingPrompt).toBe(snapshot.tasks[0].pendingPrompt);
  });

  it('rejects invalid live ownership paths, commit IDs and oversized revision prompts', () => {
    const snapshot = liveSnapshot(directory);
    const relativePath = structuredClone(snapshot);
    relativePath.tasks[0].worktree!.path = 'relative/worktree';
    expect(parseWorkspaceSnapshot(relativePath)).toBeNull();
    const invalidCommit = structuredClone(snapshot);
    invalidCommit.tasks[0].worktree!.baseCommit = 'not-a-commit';
    expect(parseWorkspaceSnapshot(invalidCommit)).toBeNull();
    const oversizedPrompt = structuredClone(snapshot);
    oversizedPrompt.tasks[0].pendingPrompt = 'a'.repeat(2001);
    expect(parseWorkspaceSnapshot(oversizedPrompt)).toBeNull();
    const mixedRuntime = structuredClone(snapshot);
    mixedRuntime.tasks[0].runtime = 'simulation';
    expect(parseWorkspaceSnapshot(mixedRuntime)).toBeNull();
    const badThreadId = structuredClone(snapshot);
    badThreadId.tasks[0].threadId = 'thread\nunsafe';
    expect(parseWorkspaceSnapshot(badThreadId)).toBeNull();
  });

  it('ignores pending approval data from prior sessions even when the data is malformed', () => {
    const snapshot = liveSnapshot(directory);
    expect(parseWorkspaceSnapshot({ ...snapshot, approvals: 'stale-session-request' })).not.toHaveProperty('approvals');
  });
});
