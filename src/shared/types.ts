export type AgentId = 'manager' | 'frontend' | 'backend' | 'qa';
export type AgentStatus = 'idle' | 'planning' | 'working' | 'waiting' | 'review';
export type TaskStatus = 'queued' | 'planning' | 'working' | 'testing' | 'review' | 'completed' | 'cancelled';
export type JobStatus = 'pending' | 'running' | 'completed';

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
}

export interface ActivityEvent {
  id: string;
  timestamp: string;
  agentId: AgentId | null;
  taskId: string | null;
  kind: 'system' | 'message' | 'task' | 'review';
  message: string;
}

export interface WorkspaceSnapshot {
  schemaVersion: 1;
  mode: 'simulation';
  projectPath: string | null;
  paused: boolean;
  agents: Agent[];
  tasks: Task[];
  events: ActivityEvent[];
}

export interface DesktopInfo {
  appVersion: string;
  platform: string;
  runtime: 'simulation';
  codexAvailable: boolean;
}

export interface WorkspaceBridge {
  getSnapshot(): Promise<WorkspaceSnapshot>;
  getInfo(): Promise<DesktopInfo>;
  submitTask(title: string): Promise<WorkspaceSnapshot>;
  setPaused(paused: boolean): Promise<WorkspaceSnapshot>;
  approveTask(taskId: string): Promise<WorkspaceSnapshot>;
  requestChanges(taskId: string): Promise<WorkspaceSnapshot>;
  cancelTask(taskId: string): Promise<WorkspaceSnapshot>;
  chooseProject(): Promise<WorkspaceSnapshot>;
  resetWorkspace(): Promise<WorkspaceSnapshot>;
  onSnapshot(callback: (snapshot: WorkspaceSnapshot) => void): () => void;
}
