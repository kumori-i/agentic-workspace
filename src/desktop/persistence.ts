import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import type { ActivityEvent, Agent, CodexStatus, Job, Task, TaskReview, TaskPublication, WorktreeInfo, WorkspaceSnapshot } from '../shared/types';

const agentIds = new Set(['manager', 'frontend', 'backend', 'qa']);
const agentStatuses = new Set(['idle', 'planning', 'working', 'waiting', 'review', 'blocked', 'error']);
const taskStatuses = new Set(['queued', 'planning', 'working', 'testing', 'reviewing', 'publishing', 'review', 'completed', 'cancelled', 'blocked', 'failed', 'interrupted']);
const jobStatuses = new Set(['pending', 'running', 'completed', 'failed', 'cancelled']);
const eventKinds = new Set(['system', 'message', 'task', 'review', 'tool', 'error']);
const codexStates = new Set(['disconnected', 'connecting', 'ready', 'needs-auth', 'unavailable', 'error']);
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

function absolutePath(value: unknown): value is string {
  return text(value, 4096) && isAbsolute(value) && !value.includes('\0');
}

function opaqueId(value: unknown): value is string {
  return text(value, 256) && !/[\u0000-\u001f\u007f]/.test(value);
}

function validWorktree(value: unknown): value is WorktreeInfo {
  return record(value) && absolutePath(value.path) && absolutePath(value.repositoryPath) &&
    text(value.branch, 300) && !/[\u0000-\u001f\u007f]/.test(value.branch) &&
    typeof value.baseCommit === 'string' && /^[a-fA-F0-9]{40,64}$/.test(value.baseCommit) && timestamp(value.createdAt);
}

function validCodexStatus(value: unknown): value is CodexStatus {
  return record(value) && codexStates.has(value.state as string) && ['chatgpt', 'none', 'other'].includes(value.auth as string) &&
    text(value.message, 4000, true) && Array.isArray(value.models) && value.models.length <= 100 &&
    value.models.every(model => record(model) && opaqueId(model.id) && text(model.model, 200) &&
      text(model.displayName, 500) && typeof model.isDefault === 'boolean') &&
    new Set(value.models.map(model => model.id)).size === value.models.length &&
    (value.selectedModel === null || text(value.selectedModel, 200)) &&
    (value.version === undefined || text(value.version, 200)) && (value.plan === undefined || text(value.plan, 100));
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
const commit = (value: unknown): value is string => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
function validReview(value: unknown): value is TaskReview {
  return record(value) && ['pending', 'running', 'approved', 'changes-requested', 'failed', 'interrupted', 'stale'].includes(value.status as string)
    && text(value.summary, 4000, true) && Array.isArray(value.findings) && value.findings.length <= 30 && value.findings.every(item => text(item, 1000, true))
    && Array.isArray(value.checks) && value.checks.length <= 30 && value.checks.every(item => text(item, 1000, true))
    && (value.checkpoint === undefined || (record(value.checkpoint) && commit(value.checkpoint.tree) && commit(value.checkpoint.head)))
    && (value.threadId === undefined || opaqueId(value.threadId)) && (value.turnId === undefined || opaqueId(value.turnId))
    && (value.completedAt === undefined || timestamp(value.completedAt))
    && (value.status !== 'approved' || (value.checkpoint !== undefined && opaqueId(value.threadId) && opaqueId(value.turnId) && timestamp(value.completedAt)));
}
function validPublication(value: unknown): value is TaskPublication {
  if (!record(value) || !record(value.plan)) return false;
  const p = value.plan;
  return id(p.id) && text(p.taskBranch, 300) && commit(p.taskHead) && commit(p.tree) && text(p.targetBranch, 300) && commit(p.targetHead)
    && typeof p.remote === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(p.remote) && typeof p.remoteFingerprint === 'string' && /^[a-f0-9]{64}$/.test(p.remoteFingerprint) && text(p.commitMessage, 500)
    && ['prepared', 'committing', 'merging', 'pushing', 'published', 'failed', 'interrupted'].includes(value.phase as string)
    && (value.taskCommit === undefined || commit(value.taskCommit)) && (value.mergeCommit === undefined || commit(value.mergeCommit))
    && (value.merged === undefined || typeof value.merged === 'boolean') && (value.error === undefined || text(value.error, 4000, true))
    && (value.publishedAt === undefined || timestamp(value.publishedAt))
    && (!value.merged || (commit(value.taskCommit) && commit(value.mergeCommit)))
    && (value.phase !== 'published' || (value.merged === true && timestamp(value.publishedAt)));
}

function validTask(value: unknown): value is Task {
  if (!record(value) || !id(value.id) || !text(value.title, 500) ||
    !taskStatuses.has(value.status as string) || !progress(value.progress) ||
    !timestamp(value.createdAt) || !timestamp(value.updatedAt) ||
    !Number.isSafeInteger(value.iteration) || (value.iteration as number) < 1 || !Array.isArray(value.jobs) ||
    value.jobs.length > 16 || !value.jobs.every(validJob) ||
    (value.runtime !== undefined && value.runtime !== 'simulation' && value.runtime !== 'codex') ||
    (value.worktree !== undefined && !validWorktree(value.worktree)) ||
    (value.threadId !== undefined && !opaqueId(value.threadId)) ||
    (value.turnId !== undefined && !opaqueId(value.turnId)) ||
    (value.model !== undefined && !text(value.model, 200)) ||
    (value.error !== undefined && !text(value.error, 4000, true)) ||
    (value.review !== undefined && !validReview(value.review)) || (value.publication !== undefined && !validPublication(value.publication)) ||
    (value.pendingPrompt !== undefined && !text(value.pendingPrompt, 2000)) ||
    (value.revisionBrief !== undefined && !text(value.revisionBrief, 2000))) return false;
  const ids = new Set(value.jobs.map(job => job.id));
  return ids.size === value.jobs.length && value.jobs.every(job => job.dependsOn.every(dependency => ids.has(dependency)));
}

function validEvent(value: unknown): value is ActivityEvent {
  return record(value) && id(value.id) && timestamp(value.timestamp) &&
    (value.agentId === null || agentIds.has(value.agentId as string)) && nullableId(value.taskId) &&
    eventKinds.has(value.kind as string) && text(value.message, 4000, true) &&
    (value.itemId === undefined || opaqueId(value.itemId));
}

/** Treat persisted JSON as untrusted input; return only the known schema fields. */
export function parseWorkspaceSnapshot(value: unknown): WorkspaceSnapshot | null {
  if (!record(value) || value.schemaVersion !== 1 || !['simulation', 'codex'].includes(value.mode as string) ||
    typeof value.paused !== 'boolean' ||
    !(value.projectPath === null || absolutePath(value.projectPath)) ||
    (value.codex !== undefined && !validCodexStatus(value.codex)) ||
    !Array.isArray(value.agents) || value.agents.length !== 4 || !value.agents.every(validAgent) ||
    new Set(value.agents.map(agent => agent.id)).size !== 4 ||
    !Array.isArray(value.tasks) || value.tasks.length > 500 || !value.tasks.every(validTask) ||
    new Set(value.tasks.map(task => task.id)).size !== value.tasks.length ||
    !Array.isArray(value.events) || value.events.length > 2000 || !value.events.every(validEvent) ||
    new Set(value.events.map(event => event.id)).size !== value.events.length) return null;

  const taskIds = new Set(value.tasks.map(task => task.id));
  if (value.agents.some(agent => agent.taskId !== null && !taskIds.has(agent.taskId)) ||
    value.tasks.some(task => task.runtime !== undefined && task.runtime !== value.mode) ||
    value.tasks.some(task => (task.review || task.publication) && value.mode !== 'codex') ||
    value.tasks.some(task => task.review && (!task.worktree || task.jobs[1]?.agentId !== 'qa' ||
      (task.review.status === 'approved' && (task.review.threadId === task.threadId || task.jobs[1].status !== 'completed')))) ||
    value.tasks.some(task => task.publication && (task.review?.status !== 'approved' ||
      task.publication.plan.taskBranch !== task.worktree?.branch || task.publication.plan.tree !== task.review.checkpoint?.tree || task.publication.plan.taskHead !== task.review.checkpoint?.head)) ||
    (value.mode === 'codex' && value.tasks.some(task => task.jobs.length < 1 || task.jobs.length > 2 ||
      task.jobs[0].agentId !== 'backend' || task.jobs[0].dependsOn.length !== 0 ||
      (task.jobs[1] && (task.jobs[1].agentId !== 'qa' || task.jobs[1].dependsOn.length !== 1 || task.jobs[1].dependsOn[0] !== task.jobs[0].id))))) return null;

  return {
    schemaVersion: 1,
    mode: value.mode as WorkspaceSnapshot['mode'],
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
      ...(task.runtime === undefined ? {} : { runtime: task.runtime }),
      ...(task.worktree === undefined ? {} : { worktree: {
        path: task.worktree.path, branch: task.worktree.branch, repositoryPath: task.worktree.repositoryPath,
        baseCommit: task.worktree.baseCommit, createdAt: task.worktree.createdAt,
      } }),
      ...(task.threadId === undefined ? {} : { threadId: task.threadId }),
      ...(task.turnId === undefined ? {} : { turnId: task.turnId }),
      ...(task.model === undefined ? {} : { model: task.model }),
      ...(task.error === undefined ? {} : { error: task.error }),
      ...(task.pendingPrompt === undefined ? {} : { pendingPrompt: task.pendingPrompt }),
      ...(task.revisionBrief === undefined ? {} : { revisionBrief: task.revisionBrief }),
      ...(task.review === undefined ? {} : { review: {
        status: task.review.status, summary: task.review.summary, findings: [...task.review.findings], checks: [...task.review.checks],
        ...(task.review.checkpoint ? { checkpoint: { tree: task.review.checkpoint.tree, head: task.review.checkpoint.head } } : {}),
        ...(task.review.threadId ? { threadId: task.review.threadId } : {}), ...(task.review.turnId ? { turnId: task.review.turnId } : {}),
        ...(task.review.completedAt ? { completedAt: task.review.completedAt } : {}),
      } }),
      ...(task.publication === undefined ? {} : { publication: {
        phase: task.publication.phase, plan: { id: task.publication.plan.id, taskBranch: task.publication.plan.taskBranch, taskHead: task.publication.plan.taskHead, tree: task.publication.plan.tree,
          targetBranch: task.publication.plan.targetBranch, targetHead: task.publication.plan.targetHead, remote: task.publication.plan.remote, remoteFingerprint: task.publication.plan.remoteFingerprint, commitMessage: task.publication.plan.commitMessage },
        ...(task.publication.taskCommit ? { taskCommit: task.publication.taskCommit } : {}), ...(task.publication.mergeCommit ? { mergeCommit: task.publication.mergeCommit } : {}),
        ...(task.publication.merged === undefined ? {} : { merged: task.publication.merged }), ...(task.publication.error ? { error: task.publication.error } : {}),
        ...(task.publication.publishedAt ? { publishedAt: task.publication.publishedAt } : {}),
      } }),
    })),
    events: value.events.map(event => ({
      id: event.id, timestamp: event.timestamp, agentId: event.agentId,
      taskId: event.taskId, kind: event.kind, message: event.message,
      ...(event.itemId === undefined ? {} : { itemId: event.itemId }),
    })),
    ...(value.codex === undefined ? {} : { codex: {
      state: value.codex.state, auth: value.codex.auth, message: value.codex.message,
      models: value.codex.models.map(model => ({ id: model.id, model: model.model, displayName: model.displayName, isDefault: model.isDefault })),
      selectedModel: value.codex.selectedModel,
      ...(value.codex.version === undefined ? {} : { version: value.codex.version }),
      ...(value.codex.plan === undefined ? {} : { plan: value.codex.plan }),
    } }),
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
