import type { ActivityEvent, Agent, AgentId, Job, Task, WorkspaceSnapshot } from '../shared/types';

const PLANNING_MS = 2_000;
const JOB_DURATIONS: Record<'frontend' | 'backend' | 'qa', number> = {
  frontend: 6_000,
  backend: 8_000,
  qa: 4_000,
};
const MAX_EVENTS = 180;
const MAX_TASKS = 60;
const MAX_PENDING_TASKS = 20;
const ACTIVE_STATUSES = new Set(['planning', 'working', 'testing', 'review']);
const AGENT_IDS: AgentId[] = ['manager', 'frontend', 'backend', 'qa'];

const clone = <T>(value: T): T => structuredClone(value);
const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

function initialAgents(): Agent[] {
  return [
    { id: 'manager', name: 'Mira', role: 'Manager', department: 'Management', color: '#a8cf8f', status: 'idle', activity: 'Ready to plan your next task', taskId: null },
    { id: 'frontend', name: 'Jules', role: 'Frontend developer', department: 'Engineering', color: '#8ebce8', status: 'idle', activity: 'Ready for interface work', taskId: null },
    { id: 'backend', name: 'Rowan', role: 'Backend developer', department: 'Engineering', color: '#e0b878', status: 'idle', activity: 'Ready for service work', taskId: null },
    { id: 'qa', name: 'Quinn', role: 'QA reviewer', department: 'Engineering', color: '#ceafe8', status: 'idle', activity: 'Ready to verify a workflow', taskId: null },
  ];
}

function validateProjectPath(path: string | null): string | null {
  if (path === null) return null;
  if (typeof path !== 'string' || !path.trim() || path.includes('\0') || path.length > 4_096) {
    throw new Error('Choose a valid project folder.');
  }
  return path.trim();
}

/** Creates a local simulation. Selecting a project never reads or changes its files. */
export function createInitialSnapshot(projectPath: string | null = null): WorkspaceSnapshot {
  const timestamp = new Date().toISOString();
  return {
    schemaVersion: 1,
    mode: 'simulation',
    projectPath: validateProjectPath(projectPath),
    paused: false,
    agents: initialAgents(),
    tasks: [],
    events: [
      { id: 'event-1', timestamp, agentId: null, taskId: null, kind: 'system', message: 'Simulation ready. Agent activity is demonstrated locally; no Codex inference or project file changes occur.' },
      { id: 'event-2', timestamp, agentId: 'manager', taskId: null, kind: 'message', message: 'Mira: Submit a task to see planning, parallel implementation, QA, and your approval in action.' },
    ],
  };
}

function createJobs(taskId: string, iteration: number): Job[] {
  const prefix = `${taskId}-iteration-${iteration}`;
  return [
    { id: `${prefix}-frontend`, agentId: 'frontend', title: 'Simulate interface implementation', status: 'pending', progress: 0, dependsOn: [] },
    { id: `${prefix}-backend`, agentId: 'backend', title: 'Simulate service implementation', status: 'pending', progress: 0, dependsOn: [] },
    { id: `${prefix}-qa`, agentId: 'qa', title: 'Simulate workflow verification', status: 'pending', progress: 0, dependsOn: [`${prefix}-frontend`, `${prefix}-backend`] },
  ];
}

function isProgress(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

function validateSnapshot(snapshot: WorkspaceSnapshot): void {
  const fail = () => { throw new Error('The saved workspace is invalid. Reset the workspace to start a new simulation.'); };
  if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.mode !== 'simulation' || typeof snapshot.paused !== 'boolean'
    || !Array.isArray(snapshot.tasks) || !Array.isArray(snapshot.events) || !Array.isArray(snapshot.agents)) fail();
  validateProjectPath(snapshot.projectPath);
  if (snapshot.tasks.length > 500 || snapshot.events.length > 2_000
    || snapshot.tasks.some(task => !task) || snapshot.agents.some(agent => !agent)) fail();
  if (snapshot.agents.length !== 4 || AGENT_IDS.some(id => snapshot.agents.filter(agent => agent.id === id).length !== 1)) fail();
  if (snapshot.tasks.filter(task => ACTIVE_STATUSES.has(task.status)).length > 1) fail();
  if (new Set(snapshot.tasks.map(task => task.id)).size !== snapshot.tasks.length) fail();
  for (const task of snapshot.tasks) {
    if (!task || typeof task.id !== 'string' || !/^task-\d+$/.test(task.id)
      || !Number.isSafeInteger(Number(task.id.slice(5))) || Number(task.id.slice(5)) < 1
      || typeof task.title !== 'string' || !task.title.trim()
      || !['queued', 'planning', 'working', 'testing', 'review', 'completed', 'cancelled'].includes(task.status)
      || !isProgress(task.progress) || !Number.isInteger(task.iteration) || task.iteration < 1
      || !Number.isFinite(Date.parse(task.createdAt)) || !Number.isFinite(Date.parse(task.updatedAt))
      || !Array.isArray(task.jobs) || task.jobs.length !== 3 || task.jobs.some(job => !job)) fail();
    for (const agentId of ['frontend', 'backend', 'qa'] as const) {
      if (task.jobs.filter(job => job.agentId === agentId).length !== 1) fail();
    }
    if (new Set(task.jobs.map(job => job.id)).size !== 3) fail();
    for (const job of task.jobs) {
      if (!job || typeof job.id !== 'string' || typeof job.title !== 'string'
        || !['pending', 'running', 'completed'].includes(job.status) || !isProgress(job.progress)
        || !Array.isArray(job.dependsOn) || job.dependsOn.some(id => !task.jobs.some(candidate => candidate.id === id))) fail();
    }
    const frontend = task.jobs.find(job => job.agentId === 'frontend')!;
    const backend = task.jobs.find(job => job.agentId === 'backend')!;
    const qa = task.jobs.find(job => job.agentId === 'qa')!;
    if (frontend.dependsOn.length || backend.dependsOn.length || qa.dependsOn.length !== 2
      || !qa.dependsOn.includes(frontend.id) || !qa.dependsOn.includes(backend.id)) fail();
    if (task.status === 'planning' && task.progress > 10) fail();
    if (['queued', 'planning'].includes(task.status) && task.jobs.some(job => job.status !== 'pending')) fail();
    if (task.status === 'working' && (qa.status !== 'pending' || task.progress > 65)) fail();
    if (['testing', 'review', 'completed'].includes(task.status)
      && (frontend.status !== 'completed' || backend.status !== 'completed')) fail();
    if (['review', 'completed'].includes(task.status) && qa.status !== 'completed') fail();
  }
  if (snapshot.events.some(event => !event || typeof event.id !== 'string' || typeof event.message !== 'string'
    || !Number.isFinite(Date.parse(event.timestamp)))) fail();
}

/** A deterministic, event-driven demo engine. Only explicit ticks advance simulated work. */
export class WorkspaceEngine {
  private state: WorkspaceSnapshot;
  private clock: number;
  private taskSequence: number;
  private eventSequence: number;

  constructor(snapshot: WorkspaceSnapshot = createInitialSnapshot()) {
    validateSnapshot(snapshot);
    this.state = clone(snapshot);
    this.clock = Math.max(Date.now(), ...this.state.events.map(event => Date.parse(event.timestamp)),
      ...this.state.tasks.map(task => Date.parse(task.updatedAt)));
    this.taskSequence = Math.max(0, ...this.state.tasks.map(task => Number(task.id.replace('task-', ''))));
    this.eventSequence = Math.max(0, ...this.state.events.map(event => Number(event.id.replace('event-', '')) || 0));
    this.normalizeJobs();
    this.trimHistory();
    this.activateNextTask();
    this.syncAgents();
  }

  getSnapshot(): WorkspaceSnapshot {
    return clone(this.state);
  }

  submitTask(title: string): WorkspaceSnapshot {
    if (typeof title !== 'string' || !title.trim()) throw new Error('Enter a task description.');
    const cleanedTitle = title.trim();
    if (cleanedTitle.length > 500) throw new Error('Keep the task description to 500 characters or fewer.');
    if (this.state.tasks.filter(task => !['completed', 'cancelled'].includes(task.status)).length >= MAX_PENDING_TASKS) {
      throw new Error('The queue is full. Finish or cancel a task before adding another.');
    }
    const id = `task-${++this.taskSequence}`;
    const timestamp = this.timestamp();
    this.state.tasks.push({ id, title: cleanedTitle, status: 'queued', progress: 0, createdAt: timestamp,
      updatedAt: timestamp, iteration: 1, jobs: createJobs(id, 1) });
    this.addEvent('task', `Task queued for simulation: ${cleanedTitle}`, null, id);
    this.activateNextTask();
    this.trimHistory();
    return this.getSnapshot();
  }

  tick(elapsedMs: number): WorkspaceSnapshot {
    if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs) || elapsedMs < 0
      || !Number.isSafeInteger(Math.trunc(elapsedMs)) || this.clock + elapsedMs > 8_640_000_000_000_000) {
      throw new Error('Elapsed time must be a finite, nonnegative number.');
    }
    if (elapsedMs === 0 || this.state.paused) return this.getSnapshot();
    let remaining = elapsedMs;
    while (remaining > 0) {
      const task = this.activeTask();
      if (!task || task.status === 'review') {
        this.clock += remaining;
        break;
      }
      if (task.status === 'planning') {
        const spent = Math.min(remaining, PLANNING_MS * (1 - task.progress / 10));
        this.clock += spent;
        remaining -= spent;
        task.progress = round(Math.min(10, task.progress + spent / PLANNING_MS * 10));
        task.updatedAt = this.timestamp();
        if (task.progress >= 10) this.startImplementation(task);
      } else if (task.status === 'working') {
        const jobs = task.jobs.filter(job => job.agentId !== 'qa');
        const timeToFinish = Math.max(...jobs.map(job => this.remainingJobTime(job)));
        const spent = Math.min(remaining, timeToFinish);
        this.clock += spent;
        remaining -= spent;
        for (const job of jobs) this.advanceJob(task, job, spent);
        task.progress = round(Math.max(task.progress, 10 + jobs.reduce((sum, job) => sum + job.progress, 0) / 200 * 55));
        task.updatedAt = this.timestamp();
        if (jobs.every(job => job.status === 'completed')) this.startVerification(task);
      } else if (task.status === 'testing') {
        const job = task.jobs.find(candidate => candidate.agentId === 'qa')!;
        const spent = Math.min(remaining, this.remainingJobTime(job));
        this.clock += spent;
        remaining -= spent;
        this.advanceJob(task, job, spent);
        task.progress = round(Math.max(task.progress, 65 + job.progress / 100 * 30));
        task.updatedAt = this.timestamp();
        if (job.status === 'completed') this.awaitReview(task);
      }
    }
    this.syncAgents();
    return this.getSnapshot();
  }

  setPaused(paused: boolean): WorkspaceSnapshot {
    if (typeof paused !== 'boolean') throw new Error('Pause state must be true or false.');
    if (this.state.paused !== paused) {
      this.state.paused = paused;
      this.addEvent('system', paused ? 'Simulation paused. You can still review or cancel tasks.' : 'Simulation resumed.');
    }
    return this.getSnapshot();
  }

  approveTask(id: string): WorkspaceSnapshot {
    const task = this.requireReviewTask(id);
    task.status = 'completed';
    task.progress = 100;
    task.updatedAt = this.timestamp();
    this.addEvent('review', 'You approved the simulated result. Task complete; no project files were changed.', 'manager', id);
    this.syncAgents();
    this.activateNextTask();
    this.trimHistory();
    return this.getSnapshot();
  }

  requestChanges(id: string): WorkspaceSnapshot {
    const task = this.requireReviewTask(id);
    task.iteration += 1;
    task.progress = 0;
    task.jobs = createJobs(task.id, task.iteration);
    task.status = 'planning';
    task.updatedAt = this.timestamp();
    this.addEvent('review', `You requested changes. Mira is planning simulation iteration ${task.iteration}.`, 'manager', id);
    this.syncAgents();
    return this.getSnapshot();
  }

  cancelTask(id: string): WorkspaceSnapshot {
    const task = this.requireTask(id);
    if (['completed', 'cancelled'].includes(task.status)) throw new Error('This task has already finished.');
    task.status = 'cancelled';
    task.updatedAt = this.timestamp();
    this.addEvent('task', 'Task cancelled. Simulated workers have been released.', null, id);
    this.syncAgents();
    this.activateNextTask();
    this.trimHistory();
    return this.getSnapshot();
  }

  setProject(path: string | null): WorkspaceSnapshot {
    const cleanedPath = validateProjectPath(path);
    if (this.state.projectPath !== cleanedPath) {
      this.state.projectPath = cleanedPath;
      this.addEvent('system', cleanedPath ? 'Project folder selected for this workspace. Simulation does not access or modify its files.' : 'Project folder cleared. Simulation remains available.');
    }
    return this.getSnapshot();
  }

  reset(): WorkspaceSnapshot {
    this.state = createInitialSnapshot(this.state.projectPath);
    this.clock = Date.now();
    this.taskSequence = 0;
    this.eventSequence = 2;
    return this.getSnapshot();
  }

  private timestamp(): string {
    return new Date(this.clock).toISOString();
  }

  private activeTask(): Task | undefined {
    return this.state.tasks.find(task => ACTIVE_STATUSES.has(task.status));
  }

  private requireTask(id: string): Task {
    if (typeof id !== 'string' || !id) throw new Error('Choose a valid task.');
    const task = this.state.tasks.find(candidate => candidate.id === id);
    if (!task) throw new Error('Task not found.');
    return task;
  }

  private requireReviewTask(id: string): Task {
    const task = this.requireTask(id);
    if (task.status !== 'review') throw new Error('This task is not ready for your review.');
    return task;
  }

  private activateNextTask(): void {
    if (this.activeTask()) return;
    const task = this.state.tasks.find(candidate => candidate.status === 'queued');
    if (!task) return;
    task.status = 'planning';
    task.updatedAt = this.timestamp();
    this.addEvent('message', `Mira is planning a simulated workflow: ${task.title}`, 'manager', task.id);
    this.syncAgents();
  }

  private startImplementation(task: Task): void {
    task.status = 'working';
    for (const job of task.jobs) if (job.agentId !== 'qa') job.status = 'running';
    this.addEvent('message', 'Simulation plan ready. Jules and Rowan work independently; Quinn waits for both.', 'manager', task.id);
    this.addEvent('task', 'Jules started simulated interface work.', 'frontend', task.id);
    this.addEvent('task', 'Rowan started simulated service work.', 'backend', task.id);
  }

  private startVerification(task: Task): void {
    task.status = 'testing';
    task.progress = 65;
    task.jobs.find(job => job.agentId === 'qa')!.status = 'running';
    this.addEvent('task', 'Both implementation jobs finished. Quinn is running simulated workflow checks.', 'qa', task.id);
  }

  private awaitReview(task: Task): void {
    task.status = 'review';
    task.progress = 95;
    this.addEvent('review', 'Simulated checks passed. Approve this result or request another iteration.', 'qa', task.id);
  }

  private remainingJobTime(job: Job): number {
    return (1 - job.progress / 100) * JOB_DURATIONS[job.agentId as keyof typeof JOB_DURATIONS];
  }

  private advanceJob(task: Task, job: Job, elapsedMs: number): void {
    if (job.status === 'completed') return;
    job.progress = round(Math.min(100, job.progress + elapsedMs / JOB_DURATIONS[job.agentId as keyof typeof JOB_DURATIONS] * 100));
    if (job.progress >= 100) {
      job.status = 'completed';
      if (job.agentId !== 'qa') {
        const name = job.agentId === 'frontend' ? 'Jules' : 'Rowan';
        this.addEvent('task', `${name} finished the simulated ${job.agentId === 'frontend' ? 'interface' : 'service'} work.`, job.agentId, task.id);
      }
    }
  }

  /** Restore elapsed work from progress, rather than relying on nonpersisted timers. */
  private normalizeJobs(): void {
    for (const task of this.state.tasks) {
      for (const job of task.jobs) {
        if (job.status === 'completed') job.progress = 100;
        if (job.status === 'pending') job.progress = 0;
      }
      if (task.status === 'working') {
        for (const job of task.jobs) if (job.agentId !== 'qa' && job.status !== 'completed') job.status = 'running';
        task.progress = Math.max(task.progress, 10);
      } else if (task.status === 'testing') {
        task.jobs.find(job => job.agentId === 'qa')!.status = 'running';
        task.progress = Math.max(task.progress, 65);
      } else if (task.status === 'review') task.progress = 95;
      else if (task.status === 'completed') task.progress = 100;
    }
  }

  private syncAgents(): void {
    this.state.agents = initialAgents();
    const task = this.activeTask();
    if (!task) return;
    for (const agent of this.state.agents) {
      agent.taskId = task.id;
      if (agent.id === 'manager') {
        agent.status = task.status === 'planning' ? 'planning' : task.status === 'review' ? 'review' : 'waiting';
        agent.activity = task.status === 'planning' ? `Planning iteration ${task.iteration}` : task.status === 'review' ? 'Waiting for your approval' : 'Waiting for worker reports';
        continue;
      }
      const job = task.jobs.find(candidate => candidate.agentId === agent.id)!;
      agent.status = job.status === 'running' ? 'working' : 'waiting';
      agent.activity = job.status === 'running' ? job.title : task.status === 'planning' ? "Waiting for Mira's plan"
        : task.status === 'review' ? 'Waiting for your approval'
          : job.status === 'completed' ? 'Work finished; waiting for the team'
            : 'Waiting for frontend and backend';
      if (agent.id === 'qa' && task.status === 'review') agent.status = 'review';
    }
  }

  private addEvent(kind: ActivityEvent['kind'], message: string, agentId: AgentId | null = null, taskId: string | null = null): void {
    this.state.events.push({ id: `event-${++this.eventSequence}`, timestamp: this.timestamp(), kind, message, agentId, taskId });
    if (this.state.events.length > MAX_EVENTS) this.state.events.splice(0, this.state.events.length - MAX_EVENTS);
  }

  private trimHistory(): void {
    if (this.state.events.length > MAX_EVENTS) this.state.events.splice(0, this.state.events.length - MAX_EVENTS);
    const terminalTasks = this.state.tasks.filter(task => ['completed', 'cancelled'].includes(task.status));
    const excess = this.state.tasks.length - MAX_TASKS;
    if (excess <= 0) return;
    const removedIds = new Set(terminalTasks.slice(0, excess).map(task => task.id));
    this.state.tasks = this.state.tasks.filter(task => !removedIds.has(task.id));
  }
}
