import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceEngine } from '../src/core/engine';
import { parseWorkspaceSnapshot, readWorkspaceState, writeWorkspaceState } from '../src/desktop/persistence';

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
});
