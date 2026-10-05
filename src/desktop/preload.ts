import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopInfo, WorkspaceBridge, WorkspaceSnapshot, WorktreeInspection } from '../shared/types';

const bridge: WorkspaceBridge = {
  getSnapshot: () => ipcRenderer.invoke('workspace:getSnapshot') as Promise<WorkspaceSnapshot>,
  getInfo: () => ipcRenderer.invoke('workspace:getInfo') as Promise<DesktopInfo>,
  submitTask: (title) => ipcRenderer.invoke('workspace:submitTask', title) as Promise<WorkspaceSnapshot>,
  setPaused: (paused) => ipcRenderer.invoke('workspace:setPaused', paused) as Promise<WorkspaceSnapshot>,
  approveTask: (taskId) => ipcRenderer.invoke('workspace:approveTask', taskId) as Promise<WorkspaceSnapshot>,
  requestChanges: (taskId, feedback) => ipcRenderer.invoke('workspace:requestChanges', taskId, feedback) as Promise<WorkspaceSnapshot>,
  cancelTask: (taskId) => ipcRenderer.invoke('workspace:cancelTask', taskId) as Promise<WorkspaceSnapshot>,
  chooseProject: () => ipcRenderer.invoke('workspace:chooseProject') as Promise<WorkspaceSnapshot>,
  resetWorkspace: () => ipcRenderer.invoke('workspace:resetWorkspace') as Promise<WorkspaceSnapshot>,
  setMode: (mode) => ipcRenderer.invoke('workspace:setMode', mode) as Promise<WorkspaceSnapshot>,
  connectCodex: () => ipcRenderer.invoke('workspace:connectCodex') as Promise<WorkspaceSnapshot>,
  chooseCodexExecutable: () => ipcRenderer.invoke('workspace:chooseCodexExecutable') as Promise<WorkspaceSnapshot>,
  setModel: (model) => ipcRenderer.invoke('workspace:setModel', model) as Promise<WorkspaceSnapshot>,
  respondToApproval: (approvalId, accept) => ipcRenderer.invoke('workspace:respondToApproval', approvalId, accept) as Promise<WorkspaceSnapshot>,
  inspectTask: (taskId) => ipcRenderer.invoke('workspace:inspectTask', taskId) as Promise<WorktreeInspection>,
  openWorktree: (taskId) => ipcRenderer.invoke('workspace:openWorktree', taskId) as Promise<void>,
  onSnapshot: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('A snapshot listener must be a function.');
    const listener = (_event: Electron.IpcRendererEvent, snapshot: WorkspaceSnapshot) => callback(snapshot);
    ipcRenderer.on('workspace:snapshot', listener);
    return () => ipcRenderer.removeListener('workspace:snapshot', listener);
  },
};

contextBridge.exposeInMainWorld('workspace', Object.freeze(bridge));
