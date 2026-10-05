export type AgentId = 'manager' | 'frontend' | 'backend' | 'qa';
export type RuntimeMode = 'simulation' | 'codex';
export type AgentStatus = 'idle' | 'planning' | 'working' | 'waiting' | 'review' | 'blocked' | 'error';
export type TaskStatus = 'queued' | 'planning' | 'working' | 'testing' | 'reviewing' | 'publishing' | 'review' | 'completed' | 'cancelled' | 'blocked' | 'failed' | 'interrupted';
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface WorktreeInfo {
  path: string;
  branch: string;
  repositoryPath: string;
  baseCommit: string;
  createdAt: string;
}

export interface RepositoryInfo {
  path: string;
  branch: string;
  head: string;
  dirty: boolean;
}

export interface WorktreeInspection {
  status: string;
  diff: string;
  files: string[];
  truncated: boolean;
}

export interface ReviewCheckpoint { tree: string; head: string; }
export interface TaskReview {
  status: 'pending' | 'running' | 'approved' | 'changes-requested' | 'failed' | 'interrupted' | 'stale';
  checkpoint?: ReviewCheckpoint;
  threadId?: string;
  turnId?: string;
  summary: string;
  findings: string[];
  checks: string[];
  completedAt?: string;
}
export interface PublicationPlan {
  id: string;
  taskBranch: string;
  taskHead: string;
  tree: string;
  targetBranch: string;
  targetHead: string;
  remote: string;
  remoteFingerprint: string;
  commitMessage: string;
}
export interface TaskPublication {
  plan: PublicationPlan;
  phase: 'prepared' | 'committing' | 'merging' | 'pushing' | 'published' | 'failed' | 'interrupted';
  taskCommit?: string;
  mergeCommit?: string;
  merged?: boolean;
  error?: string;
  publishedAt?: string;
}
export interface PublicationTargets { targetBranch: string; remotes: string[]; }

export interface CodexModel { id: string; model: string; displayName: string; isDefault: boolean; }
export interface CodexStatus {
  state: 'disconnected' | 'connecting' | 'ready' | 'needs-auth' | 'unavailable' | 'error';
  auth: 'chatgpt' | 'none' | 'other';
  message: string;
  models: CodexModel[];
  selectedModel: string | null;
  version?: string;
  plan?: string;
}

export interface CodexApproval {
  id: string;
  taskId: string;
  kind: 'command' | 'file';
  reason: string;
  detail: string;
}

export interface Agent {
  id: AgentId;
  name: string;
  role: string;
  department: string;
  color: string;
  status: AgentStatus;
  activity: string;
  taskId: string | null;
}

export interface Job {
  id: string;
  agentId: AgentId;
  title: string;
  status: JobStatus;
  progress: number;
  dependsOn: string[];
}

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  progress: number;
  createdAt: string;
  updatedAt: string;
  iteration: number;
  jobs: Job[];
  runtime?: RuntimeMode;
  worktree?: WorktreeInfo;
  threadId?: string;
  turnId?: string;
  model?: string;
  error?: string;
  pendingPrompt?: string;
  review?: TaskReview;
  publication?: TaskPublication;
}

export interface ActivityEvent {
  id: string;
  timestamp: string;
  agentId: AgentId | null;
  taskId: string | null;
  kind: 'system' | 'message' | 'task' | 'review' | 'tool' | 'error';
  message: string;
  itemId?: string;
}

export interface WorkspaceSnapshot {
  schemaVersion: 1;
  mode: RuntimeMode;
  projectPath: string | null;
  paused: boolean;
  agents: Agent[];
  tasks: Task[];
  events: ActivityEvent[];
  codex?: CodexStatus;
  approvals?: CodexApproval[];
}

export interface DesktopInfo {
  appVersion: string;
  platform: string;
  runtime: RuntimeMode;
  codexAvailable: boolean;
}

export interface WorkspaceBridge {
  getSnapshot(): Promise<WorkspaceSnapshot>;
  getInfo(): Promise<DesktopInfo>;
  submitTask(title: string): Promise<WorkspaceSnapshot>;
  setPaused(paused: boolean): Promise<WorkspaceSnapshot>;
  approveTask(taskId: string): Promise<WorkspaceSnapshot>;
  requestChanges(taskId: string, feedback?: string): Promise<WorkspaceSnapshot>;
  cancelTask(taskId: string): Promise<WorkspaceSnapshot>;
  chooseProject(): Promise<WorkspaceSnapshot>;
  resetWorkspace(): Promise<WorkspaceSnapshot>;
  setMode(mode: RuntimeMode): Promise<WorkspaceSnapshot>;
  connectCodex(): Promise<WorkspaceSnapshot>;
  chooseCodexExecutable(): Promise<WorkspaceSnapshot>;
  setModel(model: string): Promise<WorkspaceSnapshot>;
  respondToApproval(approvalId: string, accept: boolean): Promise<WorkspaceSnapshot>;
  inspectTask(taskId: string): Promise<WorktreeInspection>;
  openWorktree(taskId: string): Promise<void>;
  reviewTask(taskId: string): Promise<WorkspaceSnapshot>;
  getPublicationTargets(taskId: string): Promise<PublicationTargets>;
  preparePublication(taskId: string, remote: string, commitMessage: string): Promise<WorkspaceSnapshot>;
  confirmPublication(taskId: string, planId: string): Promise<WorkspaceSnapshot>;
  onSnapshot(callback: (snapshot: WorkspaceSnapshot) => void): () => void;
}
