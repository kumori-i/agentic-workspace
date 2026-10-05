import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import type { ActivityEvent, Agent, Job, Task, WorkspaceSnapshot } from '../shared/types';

const agentIds = new Set(['manager', 'frontend', 'backend', 'qa']);
const agentStatuses = new Set(['idle', 'planning', 'working', 'waiting', 'review']);
const taskStatuses = new Set(['queued', 'planning', 'working', 'testing', 'review', 'completed', 'cancelled']);
const jobStatuses = new Set(['pending', 'running', 'completed']);
const eventKinds = new Set(['system', 'message', 'task', 'review']);
const MAX_STATE_BYTES = 5 * 1024 * 1024;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = 500, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= max && (allowEmpty || value.trim().length > 0);
}

function id(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function progress(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

function nullableId(value: unknown): value is string | null {
  return value === null || id(value);
}

function validAgent(value: unknown): value is Agent {
  return record(value) && agentIds.has(value.id as string) && text(value.name, 100) &&
    text(value.role, 100) && text(value.department, 100) &&
    typeof value.color === 'string' && /^#[\da-fA-F]{6}$/.test(value.color) &&
    agentStatuses.has(value.status as string) && text(value.activity, 2000, true) && nullableId(value.taskId);
}

function validJob(value: unknown): value is Job {
  return record(value) && id(value.id) && agentIds.has(value.agentId as string) &&
    text(value.title, 500) && jobStatuses.has(value.status as string) && progress(value.progress) &&
    Array.isArray(value.dependsOn) && value.dependsOn.length <= 16 && value.dependsOn.every(id) &&
    new Set(value.dependsOn).size === value.dependsOn.length && !value.dependsOn.includes(value.id);
}

function validTask(value: unknown): value is Task {
  if (!record(value) || !id(value.id) || !text(value.title, 500) ||
    !taskStatuses.has(value.status as string) || !progress(value.progress) ||
    !timestamp(value.createdAt) || !timestamp(value.updatedAt) ||
    !Number.isSafeInteger(value.iteration) || (value.iteration as number) < 1 || !Array.isArray(value.jobs) ||
    value.jobs.length > 16 || !value.jobs.every(validJob)) return false;
  const ids = new Set(value.jobs.map(job => job.id));
  return ids.size === value.jobs.length && value.jobs.every(job => job.dependsOn.every(dependency => ids.has(dependency)));
}

function validEvent(value: unknown): value is ActivityEvent {
  return record(value) && id(value.id) && timestamp(value.timestamp) &&
    (value.agentId === null || agentIds.has(value.agentId as string)) && nullableId(value.taskId) &&
    eventKinds.has(value.kind as string) && text(value.message, 4000);
}

/** Treat persisted JSON as untrusted input; return only the known schema fields. */
export function parseWorkspaceSnapshot(value: unknown): WorkspaceSnapshot | null {
  if (!record(value) || value.schemaVersion !== 1 || value.mode !== 'simulation' ||
    typeof value.paused !== 'boolean' ||
    !(value.projectPath === null || (text(value.projectPath, 4096) && isAbsolute(value.projectPath) && !value.projectPath.includes('\0'))) ||
    !Array.isArray(value.agents) || value.agents.length !== 4 || !value.agents.every(validAgent) ||
    new Set(value.agents.map(agent => agent.id)).size !== 4 ||
    !Array.isArray(value.tasks) || value.tasks.length > 500 || !value.tasks.every(validTask) ||
    new Set(value.tasks.map(task => task.id)).size !== value.tasks.length ||
    !Array.isArray(value.events) || value.events.length > 2000 || !value.events.every(validEvent) ||
    new Set(value.events.map(event => event.id)).size !== value.events.length) return null;

  const taskIds = new Set(value.tasks.map(task => task.id));
  if (value.agents.some(agent => agent.taskId !== null && !taskIds.has(agent.taskId))) return null;

  return {
    schemaVersion: 1,
    mode: 'simulation',
    projectPath: value.projectPath,
    paused: value.paused,
    agents: value.agents.map(agent => ({
      id: agent.id, name: agent.name, role: agent.role, department: agent.department,
      color: agent.color, status: agent.status, activity: agent.activity, taskId: agent.taskId,
    })),
    tasks: value.tasks.map(task => ({
      id: task.id, title: task.title, status: task.status, progress: task.progress,
      createdAt: task.createdAt, updatedAt: task.updatedAt, iteration: task.iteration,
      jobs: task.jobs.map(job => ({
        id: job.id, agentId: job.agentId, title: job.title, status: job.status,
        progress: job.progress, dependsOn: [...job.dependsOn],
      })),
    })),
    events: value.events.map(event => ({
      id: event.id, timestamp: event.timestamp, agentId: event.agentId,
      taskId: event.taskId, kind: event.kind, message: event.message,
    })),
  };
}

export interface StateReadResult {
  snapshot?: WorkspaceSnapshot;
  warning?: string;
}

export async function readWorkspaceState(filePath: string): Promise<StateReadResult> {
  try {
    const metadata = await stat(filePath);
    if (!metadata.isFile() || metadata.size > MAX_STATE_BYTES) {
      return { warning: 'Saved workspace was too large or invalid and has been ignored.' };
    }
    const raw = await readFile(filePath, 'utf8');
    if (Buffer.byteLength(raw) > MAX_STATE_BYTES) return { warning: 'Saved workspace was too large and has been ignored.' };
    const snapshot = parseWorkspaceSnapshot(JSON.parse(raw));
    return snapshot ? { snapshot } : { warning: 'Saved workspace was invalid and has been ignored.' };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    return { warning: 'Saved workspace could not be read and has been ignored.' };
  }
}

/** Write beside the destination, then atomically replace it. Interrupted writes keep the prior state. */
export async function writeWorkspaceState(filePath: string, snapshot: WorkspaceSnapshot): Promise<void> {
  const normalized = parseWorkspaceSnapshot(snapshot);
  if (!normalized) throw new Error('Refusing to save an invalid workspace snapshot.');
  const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_STATE_BYTES) throw new Error('Workspace snapshot exceeds the storage limit.');
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporaryPath, 'wx', 0o600);
    try {
      await file.writeFile(serialized, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporaryPath, filePath);
  } finally {
    await unlink(temporaryPath).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
}
