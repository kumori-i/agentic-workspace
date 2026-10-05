import { describe, expect, it } from 'vitest';
import { createInitialSnapshot, WorkspaceEngine } from '../src/core/engine';
import type { Task, WorkspaceSnapshot } from '../src/shared/types';

const latestTask = (snapshot: WorkspaceSnapshot): Task => snapshot.tasks.at(-1)!;
const job = (task: Task, agentId: string) => task.jobs.find(candidate => candidate.agentId === agentId)!;

describe('WorkspaceEngine simulation', () => {
  it('plans, runs independent jobs, waits for dependencies, then requires human approval', () => {
    const engine = new WorkspaceEngine();
    let task = latestTask(engine.submitTask('Build a project activity panel'));
    expect(task.status).toBe('planning');
    expect(task.jobs.every(candidate => candidate.status === 'pending')).toBe(true);
    task = latestTask(engine.tick(2_000));
    expect(task.status).toBe('working');
    expect(job(task, 'frontend').status).toBe('running');
    expect(job(task, 'backend').status).toBe('running');
    expect(job(task, 'qa').status).toBe('pending');
    task = latestTask(engine.tick(6_000));
    expect(job(task, 'frontend').status).toBe('completed');
    expect(job(task, 'backend').progress).toBe(75);
    expect(job(task, 'qa').status).toBe('pending');
    task = latestTask(engine.tick(2_000));
    expect(task.status).toBe('testing');
    expect(job(task, 'qa').status).toBe('running');
    expect(job(task, 'qa').dependsOn).toEqual([job(task, 'frontend').id, job(task, 'backend').id]);
    task = latestTask(engine.tick(4_000));
    expect(task.status).toBe('review');
    expect(task.progress).toBe(95);
    expect(latestTask(engine.tick(100_000)).status).toBe('review');
    task = latestTask(engine.approveTask(task.id));
    expect(task.status).toBe('completed');
    expect(task.progress).toBe(100);
    expect(engine.getSnapshot().agents.every(agent => agent.status === 'idle')).toBe(true);
  });

  it('handles a full elapsed interval and reports progress monotonically within an iteration', () => {
    const engine = new WorkspaceEngine();
    engine.submitTask('Improve agent activity');
    let progress = 0;
    for (let i = 0; i < 61; i += 1) {
      const nextProgress = latestTask(engine.tick(250)).progress;
      expect(nextProgress).toBeGreaterThanOrEqual(progress);
      expect(nextProgress).toBeLessThanOrEqual(95);
      progress = nextProgress;
    }
    expect(latestTask(engine.getSnapshot()).status).toBe('review');
    const singleTick = new WorkspaceEngine();
    singleTick.submitTask('Improve agent activity');
    expect(latestTask(singleTick.tick(14_000)).status).toBe('review');
  });

  it('does not advance queued tasks until the active task is reviewed', () => {
    const engine = new WorkspaceEngine();
    const first = latestTask(engine.submitTask('First task'));
    const second = latestTask(engine.submitTask('Second task'));
    expect(second.status).toBe('queued');
    const awaiting = engine.tick(14_000);
    expect(awaiting.tasks[0].status).toBe('review');
    expect(awaiting.tasks[1].status).toBe('queued');
    const approved = engine.approveTask(first.id);
    expect(approved.tasks[1].status).toBe('planning');
    expect(approved.tasks[1].progress).toBe(0);
  });

  it('cancels active and queued tasks and releases agents', () => {
    const engine = new WorkspaceEngine();
    const first = latestTask(engine.submitTask('Active task'));
    const second = latestTask(engine.submitTask('Queued task'));
    const third = latestTask(engine.submitTask('Next task'));
    engine.cancelTask(second.id);
    const activated = engine.cancelTask(first.id);
    expect(activated.tasks.find(task => task.id === third.id)!.status).toBe('planning');
    const cancelled = engine.cancelTask(third.id);
    expect(cancelled.agents.every(agent => agent.status === 'idle' && agent.taskId === null)).toBe(true);
    expect(() => engine.cancelTask(first.id)).toThrow('already finished');
  });

  it('starts a fresh job cycle after changes are requested', () => {
    const engine = new WorkspaceEngine();
    const submitted = latestTask(engine.submitTask('Add task filtering'));
    const reviewed = latestTask(engine.tick(14_000));
    const revised = latestTask(engine.requestChanges(submitted.id));
    expect(revised.status).toBe('planning');
    expect(revised.iteration).toBe(2);
    expect(revised.progress).toBe(0);
    expect(revised.jobs.every(candidate => candidate.status === 'pending' && candidate.progress === 0)).toBe(true);
    expect(revised.jobs.map(candidate => candidate.id)).not.toEqual(reviewed.jobs.map(candidate => candidate.id));
    expect(latestTask(engine.tick(14_000)).status).toBe('review');
  });

  it('pauses simulated work but permits review decisions', () => {
    const engine = new WorkspaceEngine();
    const task = latestTask(engine.submitTask('Update inspector'));
    engine.tick(3_000);
    engine.setPaused(true);
    const before = engine.getSnapshot();
    expect(engine.tick(60_000)).toEqual(before);
    engine.setPaused(false);
    engine.tick(11_000);
    engine.setPaused(true);
    expect(latestTask(engine.approveTask(task.id)).status).toBe('completed');
  });

  it('restores progress from snapshots without losing elapsed simulated work', () => {
    for (const elapsed of [1_000, 3_500, 8_500, 11_500, 14_000]) {
      const original = new WorkspaceEngine();
      original.submitTask('Persist a workflow');
      original.tick(elapsed);
      const restored = new WorkspaceEngine(original.getSnapshot());
      const after = latestTask(restored.tick(14_000 - elapsed));
      expect(after.status).toBe('review');
      expect(after.progress).toBe(95);
      expect(after.jobs.every(candidate => candidate.status === 'completed')).toBe(true);
    }
  });

  it('clones inputs and returned snapshots so callers cannot mutate the engine', () => {
    const initial = createInitialSnapshot();
    const engine = new WorkspaceEngine(initial);
    initial.agents[0].name = 'Changed externally';
    const returned = engine.submitTask('Protect state');
    returned.tasks[0].title = 'Changed externally';
    returned.tasks[0].jobs[0].dependsOn.push('fake');
    returned.events.length = 0;
    const fresh = engine.getSnapshot();
    expect(fresh.agents[0].name).toBe('Mira');
    expect(fresh.tasks[0].title).toBe('Protect state');
    expect(fresh.tasks[0].jobs[0].dependsOn).toEqual([]);
    expect(fresh.events.length).toBeGreaterThan(0);
  });

  it('rejects invalid input and actions without mutating tasks', () => {
    const engine = new WorkspaceEngine();
    expect(() => engine.submitTask('   ')).toThrow('description');
    expect(() => engine.submitTask('a'.repeat(501))).toThrow('500');
    expect(() => engine.tick(-1)).toThrow('Elapsed time');
    expect(() => engine.tick(Number.NaN)).toThrow('Elapsed time');
    expect(() => engine.tick(Number.POSITIVE_INFINITY)).toThrow('Elapsed time');
    expect(() => engine.tick(Number.MAX_VALUE)).toThrow('Elapsed time');
    expect(() => engine.approveTask('missing')).toThrow('not found');
    expect(() => engine.requestChanges('missing')).toThrow('not found');
    expect(() => engine.cancelTask('missing')).toThrow('not found');
    expect(() => engine.setProject('')).toThrow('project folder');
    const task = latestTask(engine.submitTask('An actual task'));
    expect(() => engine.approveTask(task.id)).toThrow('not ready');
    expect(() => engine.requestChanges(task.id)).toThrow('not ready');
    expect(latestTask(engine.getSnapshot()).status).toBe('planning');
  });

  it('keeps recent history bounded and never drops pending work', () => {
    const engine = new WorkspaceEngine();
    for (let i = 0; i < 75; i += 1) {
      const task = latestTask(engine.submitTask(`Task ${i}`));
      engine.tick(14_000);
      engine.approveTask(task.id);
    }
    const pending = latestTask(engine.submitTask('Keep pending work'));
    const snapshot = engine.getSnapshot();
    expect(snapshot.tasks.length).toBeLessThanOrEqual(60);
    expect(snapshot.events.length).toBeLessThanOrEqual(180);
    expect(snapshot.tasks.some(task => task.id === pending.id)).toBe(true);
    expect(new Set(snapshot.events.map(event => event.id)).size).toBe(snapshot.events.length);
  });

  it('limits pending work while allowing queue capacity to recover after cancellation', () => {
    const engine = new WorkspaceEngine();
    for (let i = 0; i < 20; i += 1) engine.submitTask(`Queued task ${i}`);
    expect(() => engine.submitTask('Overflow task')).toThrow('queue is full');
    engine.cancelTask('task-2');
    expect(latestTask(engine.submitTask('Replacement task')).status).toBe('queued');
  });

  it('preserves the selected project on reset and exposes the simulation clearly', () => {
    const engine = new WorkspaceEngine();
    engine.setProject('/projects/example');
    engine.submitTask('An experiment');
    engine.setPaused(true);
    const reset = engine.reset();
    expect(reset.projectPath).toBe('/projects/example');
    expect(reset.tasks).toEqual([]);
    expect(reset.paused).toBe(false);
    expect(reset.mode).toBe('simulation');
    expect(reset.events[0].message).toContain('no Codex inference');
  });

  it('rejects incompatible or unsafe saved snapshots', () => {
    const snapshot = createInitialSnapshot();
    snapshot.schemaVersion = 2 as 1;
    expect(() => new WorkspaceEngine(snapshot)).toThrow('saved workspace');
    const engine = new WorkspaceEngine();
    engine.submitTask('A first task');
    const corrupted = engine.submitTask('A second task');
    corrupted.tasks[1].status = 'working';
    expect(() => new WorkspaceEngine(corrupted)).toThrow('saved workspace');
  });
});
