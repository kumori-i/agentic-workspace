import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { mkdtempSync } from 'node:fs';
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WorkspaceEngine } from '../core/engine';
import type { DesktopInfo, RuntimeMode, WorkspaceSnapshot } from '../shared/types';
import { CodexRuntime } from './codex-runtime';
import { GitWorktreeService } from './git-worktrees';
import { readWorkspaceState, writeWorkspaceState } from './persistence';

protocol.registerSchemesAsPrivileged([
  { scheme: 'workspace', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const smokeTest = process.argv.includes('--smoke-test');
const smokeScreenshot = smokeTest ? process.env.AW_SMOKE_SCREENSHOT : undefined;
if (smokeScreenshot && (!isAbsolute(smokeScreenshot) || smokeScreenshot.length > 4096 || !smokeScreenshot.toLowerCase().endsWith('.png'))) {
  throw new Error('AW_SMOKE_SCREENSHOT must be an absolute PNG filename.');
}
const devUrl = getDevelopmentUrl(process.env.AW_DEV_URL);
const rendererUrl = devUrl ?? 'workspace://app/index.html';
const dataOverride = process.env.AW_USER_DATA_DIR;
if (dataOverride) {
  if (!isAbsolute(dataOverride) || dataOverride.length > 4096 || resolve(dataOverride) === parse(dataOverride).root) {
    throw new Error('AW_USER_DATA_DIR must be an absolute, non-root directory.');
  }
  app.setPath('userData', resolve(dataOverride));
} else if (smokeTest) {
  // A smoke test must never share persistence with an ordinary desktop session.
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'agentic-workspace-smoke-')));
}

let mainWindow: BrowserWindow | null = null;
let engine: WorkspaceEngine;
let live: CodexRuntime;
let mode: RuntimeMode = 'simulation';
let configurationPending = false;
let stateFiles: Record<RuntimeMode, string>;
let tickTimer: ReturnType<typeof setInterval> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving = Promise.resolve();
let lastPublished = '';
let finishingQuit = false;
let didFlushForQuit = false;
let lastTick = performance.now();

if (smokeTest) {
  // Start before app/window readiness so stalled renderer loads are bounded too.
  setTimeout(() => {
    console.error('Desktop smoke test exceeded its time limit.');
    app.exit(1);
  }, 25000).unref();
}

function getDevelopmentUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) ||
    !parsed.port || parsed.pathname !== '/' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('AW_DEV_URL must be an exact HTTP localhost origin with a port.');
  }
  return parsed.href;
}

function sameRendererUrl(value: string): boolean {
  try {
    const supplied = new URL(value);
    const expected = new URL(rendererUrl);
    return supplied.protocol === expected.protocol && supplied.host === expected.host &&
      supplied.pathname === expected.pathname && supplied.search === expected.search;
  } catch {
    return false;
  }
}

function authorizeIpc(event: IpcMainInvokeEvent): void {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents ||
    !event.senderFrame || event.senderFrame !== event.sender.mainFrame || !sameRendererUrl(event.senderFrame.url)) {
    throw new Error('This IPC request is not authorized.');
  }
}

function requireNoArguments(args: unknown[]): void {
  if (args.length !== 0) throw new TypeError('This operation does not accept arguments.');
}

function requireTaskId(args: unknown[]): string {
  if (args.length !== 1 || typeof args[0] !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(args[0]) ||
    !getSnapshot().tasks.some(task => task.id === args[0])) {
    throw new TypeError('A valid workspace task ID is required.');
  }
  return args[0];
}

function getSnapshot(): WorkspaceSnapshot {
  return mode === 'simulation' ? engine.getSnapshot() : live.getSnapshot();
}

/** Live inference must await this durable write before making external changes. */
function saveWorkspaceSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
  const pending = saving.catch(() => undefined).then(() => writeWorkspaceState(stateFiles[snapshot.mode], snapshot));
  saving = pending;
  return pending;
}

function assertActionsEnabled(): void {
  if (configurationPending || finishingQuit) throw new Error('Wait for the workspace configuration change to finish.');
}

function requireLiveMode(): void {
  assertActionsEnabled();
  if (mode !== 'codex') throw new Error('Switch to Codex mode to use this operation.');
}

async function configure<T>(action: () => Promise<T>): Promise<T> {
  assertActionsEnabled();
  if (live.isBusy) throw new Error('Wait for the Codex run to stop before changing workspace configuration.');
  configurationPending = true;
  try { return await action(); } finally { configurationPending = false; }
}

async function completeAction(): Promise<WorkspaceSnapshot> {
  const snapshot = getSnapshot();
  if (snapshot.mode === 'codex') await saveWorkspaceSnapshot(snapshot);
  return publish(snapshot, snapshot.mode === 'simulation');
}

function publish(snapshot = getSnapshot(), persist = true): WorkspaceSnapshot {
  if (snapshot.mode !== mode) return getSnapshot();
  const serialized = JSON.stringify(snapshot);
  if (serialized !== lastPublished) {
    lastPublished = serialized;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('workspace:snapshot', snapshot);
    // Save at most once per interval, even while active work changes on every tick.
    if (persist && snapshot.mode === 'simulation' && !saveTimer && !finishingQuit) {
      saveTimer = setTimeout(() => {
        saveTimer = undefined;
        void saveWorkspaceSnapshot(engine.getSnapshot()).catch(error => {
          console.error('Workspace state could not be saved:', (error as Error).message);
        });
      }, 1600);
    }
  }
  return snapshot;
}

function installIpc(): void {
  ipcMain.handle('workspace:getSnapshot', (event, ...args: unknown[]) => {
    authorizeIpc(event); requireNoArguments(args); return getSnapshot();
  });
  ipcMain.handle('workspace:getInfo', (event, ...args: unknown[]): DesktopInfo => {
    authorizeIpc(event); requireNoArguments(args);
    const codex = live.getSnapshot().codex;
    return { appVersion: app.getVersion(), platform: process.platform, runtime: mode,
      codexAvailable: Boolean(codex && ['ready', 'needs-auth', 'connecting'].includes(codex.state)) };
  });
  ipcMain.handle('workspace:submitTask', async (event, ...args: unknown[]) => {
    authorizeIpc(event); assertActionsEnabled();
    if (args.length !== 1 || typeof args[0] !== 'string' || args[0].trim().length < 1 || args[0].length > 500) {
      throw new TypeError('Task titles must contain 1 to 500 characters.');
    }
    if (mode === 'simulation') engine.submitTask(args[0].trim());
    else await live.submitTask(args[0].trim());
    return completeAction();
  });
  ipcMain.handle('workspace:setPaused', async (event, ...args: unknown[]) => {
    authorizeIpc(event); assertActionsEnabled();
    if (args.length !== 1 || typeof args[0] !== 'boolean') throw new TypeError('Paused must be a boolean.');
    if (mode === 'simulation') engine.setPaused(args[0]); else live.setPaused(args[0]);
    return completeAction();
  });
  ipcMain.handle('workspace:approveTask', async (event, ...args: unknown[]) => {
    authorizeIpc(event); assertActionsEnabled();
    const taskId = requireTaskId(args);
    if (mode === 'simulation') engine.approveTask(taskId); else live.approveTask(taskId);
    return completeAction();
  });
  ipcMain.handle('workspace:requestChanges', async (event, ...args: unknown[]) => {
    authorizeIpc(event); assertActionsEnabled();
    if (args.length < 1 || args.length > 2 || (args[1] !== undefined &&
      (typeof args[1] !== 'string' || !args[1].trim() || args[1].length > 2000))) {
      throw new TypeError('Revision feedback must contain 1 to 2000 characters.');
    }
    const taskId = requireTaskId(args.slice(0, 1));
    if (mode === 'simulation') engine.requestChanges(taskId);
    else await live.requestChanges(taskId, args[1] as string | undefined);
    return completeAction();
  });
  ipcMain.handle('workspace:cancelTask', async (event, ...args: unknown[]) => {
    authorizeIpc(event); assertActionsEnabled();
    const taskId = requireTaskId(args);
    if (mode === 'simulation') engine.cancelTask(taskId); else await live.cancelTask(taskId);
    return completeAction();
  });
  ipcMain.handle('workspace:chooseProject', async (event, ...args: unknown[]) => {
    authorizeIpc(event); requireNoArguments(args);
    return configure(async () => {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: mode === 'codex' ? 'Choose a committed Git repository' : 'Choose a local project',
        buttonLabel: 'Select project', properties: ['openDirectory'],
      });
      if (!result.canceled && result.filePaths.length === 1) {
        if (mode === 'simulation') engine.setProject(result.filePaths[0]);
        else await live.setProject(result.filePaths[0]);
      }
      return completeAction();
    });
  });
  ipcMain.handle('workspace:resetWorkspace', async (event, ...args: unknown[]) => {
    authorizeIpc(event); requireNoArguments(args);
    return configure(async () => {
      if (mode === 'simulation') engine.reset(); else live.reset();
      return completeAction();
    });
  });
  ipcMain.handle('workspace:setMode', async (event, ...args: unknown[]) => {
    authorizeIpc(event);
    if (args.length !== 1 || !['simulation', 'codex'].includes(args[0] as string)) throw new TypeError('Choose a valid runtime mode.');
    return configure(async () => {
      const requested = args[0] as RuntimeMode;
      if (mode === requested) return getSnapshot();
      await saveWorkspaceSnapshot(getSnapshot());
      if (requested === 'codex') {
        const selectedProject = engine.getSnapshot().projectPath;
        if (selectedProject && selectedProject !== live.getSnapshot().projectPath) await live.setProject(selectedProject);
      }
      mode = requested;
      lastTick = performance.now();
      return completeAction();
    });
  });
  ipcMain.handle('workspace:connectCodex', async (event, ...args: unknown[]) => {
    authorizeIpc(event); requireNoArguments(args); requireLiveMode();
    return configure(async () => { await live.connect(); return completeAction(); });
  });
  ipcMain.handle('workspace:chooseCodexExecutable', async (event, ...args: unknown[]) => {
    authorizeIpc(event); requireNoArguments(args); requireLiveMode();
    return configure(async () => {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: 'Choose the Codex executable', buttonLabel: 'Use executable', properties: ['openFile'],
      });
      if (!result.canceled && result.filePaths.length === 1) {
        const executable = await realpath(result.filePaths[0]);
        if (!isAbsolute(executable) || !(await stat(executable)).isFile()) throw new Error('Choose a valid Codex executable file.');
        await live.connect(executable);
      }
      return completeAction();
    });
  });
  ipcMain.handle('workspace:setModel', async (event, ...args: unknown[]) => {
    authorizeIpc(event); requireLiveMode();
    const selectedModel = live.getSnapshot().codex?.models.find(model => model.id === args[0] || model.model === args[0]);
    if (args.length !== 1 || typeof args[0] !== 'string' || args[0].length > 200 || !selectedModel) {
      throw new TypeError('Choose a model returned by Codex.');
    }
    live.setModel(selectedModel.model);
    return completeAction();
  });
  ipcMain.handle('workspace:respondToApproval', async (event, ...args: unknown[]) => {
    authorizeIpc(event); requireLiveMode();
    if (args.length !== 2 || typeof args[0] !== 'string' || args[0].length > 256 || typeof args[1] !== 'boolean' ||
      !live.getSnapshot().approvals?.some(approval => approval.id === args[0])) {
      throw new TypeError('Choose a pending approval and an explicit decision.');
    }
    live.respondToApproval(args[0], args[1]);
    return completeAction();
  });
  ipcMain.handle('workspace:inspectTask', async (event, ...args: unknown[]) => {
    authorizeIpc(event); requireLiveMode(); return live.inspectTask(requireTaskId(args));
  });
  ipcMain.handle('workspace:openWorktree', async (event, ...args: unknown[]) => {
    authorizeIpc(event); requireLiveMode();
    const path = await live.worktreePath(requireTaskId(args));
    if (!isAbsolute(path)) throw new Error('The worktree path is invalid.');
    const error = await shell.openPath(path);
    if (error) throw new Error(`Could not open the task worktree: ${error}`);
  });
}

async function installRendererProtocol(): Promise<void> {
  const rendererDirectory = await realpath(join(__dirname, '../renderer'));
  protocol.handle('workspace', async request => {
    try {
      const requested = new URL(request.url);
      if (requested.host !== 'app' || !['GET', 'HEAD'].includes(request.method) || requested.search) {
        return new Response('Not found', { status: 404 });
      }
      const pathname = decodeURIComponent(requested.pathname);
      if (pathname.includes('\0') || pathname.includes('\\')) return new Response('Not found', { status: 404 });
      const fullPath = await realpath(resolve(rendererDirectory, `.${pathname === '/' ? '/index.html' : pathname}`));
      if (!fullPath.startsWith(`${rendererDirectory}${sep}`)) return new Response('Not found', { status: 404 });
      const response = await net.fetch(pathToFileURL(fullPath).toString());
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'");
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440, height: 980, minWidth: 1100, minHeight: 760,
    title: 'Agentic Workspace', backgroundColor: '#10151e', show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      webviewTag: false, spellcheck: false,
    },
  });
  const window = mainWindow;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!sameRendererUrl(url)) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => { if (mainWindow === window) mainWindow = null; });
  if (smokeTest) {
    window.webContents.once('did-finish-load', () => { void runSmokeTest(window); });
  }
  await window.loadURL(rendererUrl);
}

async function runSmokeTest(window: BrowserWindow): Promise<void> {
  try {
    const result = await window.webContents.executeJavaScript(`
      (async () => {
        const deadline = Date.now() + 6000;
        while (!document.querySelector('[data-app-ready]') || !document.querySelector('canvas')) {
          if (Date.now() > deadline) throw new Error('Renderer did not become ready with a world canvas.');
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (!window.workspace) throw new Error('Desktop bridge is missing.');
        const info = await window.workspace.getInfo();
        const snapshot = await window.workspace.getSnapshot();
        if (info.runtime !== 'simulation' || snapshot.schemaVersion !== 1 || snapshot.agents.length !== 4) {
          throw new Error('Desktop bridge returned an invalid initial state.');
        }
        let invalidTitleRejected = false;
        try { await window.workspace.submitTask(''); } catch { invalidTitleRejected = true; }
        if (!invalidTitleRejected) throw new Error('Invalid task input was accepted.');
        let invalidModeRejected = false;
        try { await window.workspace.setMode('invalid'); } catch { invalidModeRejected = true; }
        if (!invalidModeRejected) throw new Error('Invalid runtime mode was accepted.');
        const disconnected = await window.workspace.setMode('codex');
        if (disconnected.mode !== 'codex' || !disconnected.codex || disconnected.codex.state === 'ready') {
          throw new Error('Codex mode did not open in a disconnected state.');
        }
        const liveInfo = await window.workspace.getInfo();
        if (liveInfo.runtime !== 'codex') throw new Error('Desktop info did not follow the selected mode.');
        const rejectedOperations = [
          () => window.workspace.setModel('not-in-the-codex-catalog'),
          () => window.workspace.respondToApproval('missing-approval', true),
          () => window.workspace.inspectTask('missing-task'),
          () => window.workspace.openWorktree('missing-task'),
        ];
        for (const operation of rejectedOperations) {
          let rejected = false;
          try { await operation(); } catch { rejected = true; }
          if (!rejected) throw new Error('A disconnected operation accepted an invalid identifier.');
        }
        let disconnectedRunRejected = false;
        try { await window.workspace.submitTask('This disconnected test must not run inference'); }
        catch { disconnectedRunRejected = true; }
        if (!disconnectedRunRejected) throw new Error('A disconnected Codex run was accepted.');
        await window.workspace.setMode('simulation');
        await window.workspace.resetWorkspace();
        const started = await window.workspace.submitTask('Verify the desktop simulation lifecycle');
        const taskId = started.tasks[0]?.id;
        if (!taskId || started.tasks[0].status !== 'planning') throw new Error('Task did not enter planning.');
        const paused = await window.workspace.setPaused(true);
        const progressBeforePause = paused.tasks[0].progress;
        await new Promise(resolve => setTimeout(resolve, 600));
        const stillPaused = await window.workspace.getSnapshot();
        if (!stillPaused.paused || stillPaused.tasks[0].progress !== progressBeforePause) {
          throw new Error('Simulation advanced while paused.');
        }
        await window.workspace.setPaused(false);
        const workflowDeadline = Date.now() + 17000;
        let current = await window.workspace.getSnapshot();
        while (current.tasks[0]?.status !== 'review') {
          if (Date.now() > workflowDeadline) throw new Error('Simulation did not reach review.');
          await new Promise(resolve => setTimeout(resolve, 100));
          current = await window.workspace.getSnapshot();
        }
        return { runtime: info.runtime, platform: info.platform, agents: snapshot.agents.length, canvas: true,
          invalidTitleRejected, invalidModeRejected, disconnectedRunRejected, invalidLiveIdentifiersRejected: true,
          modeSwitch: true, pause: true, review: true, taskId };
      })()
    `);
    if (smokeScreenshot) {
      await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      const screenshot = await window.webContents.capturePage();
      await mkdir(dirname(smokeScreenshot), { recursive: true });
      await writeFile(smokeScreenshot, screenshot.toPNG(), { mode: 0o600 });
    }
    const controls = await window.webContents.executeJavaScript(`
      (async () => {
        const taskId = ${JSON.stringify(result.taskId)};
        const revised = await window.workspace.requestChanges(taskId);
        if (revised.tasks[0].status !== 'planning' || revised.tasks[0].iteration !== 2) {
          throw new Error('Request changes did not restart task planning.');
        }
        const cancelled = await window.workspace.cancelTask(taskId);
        if (cancelled.tasks[0].status !== 'cancelled') throw new Error('Task cancellation failed.');
        return { requestChanges: true, cancel: true };
      })()
    `);
    console.log(JSON.stringify({ smokeTest: { ok: true, ...result, ...controls, screenshot: Boolean(smokeScreenshot) } }));
    app.quit();
  } catch (error) {
    console.error('Desktop smoke test failed:', (error as Error).message);
    process.exitCode = 1;
    app.quit();
  }
}

if (!smokeTest && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    stateFiles = {
      simulation: join(app.getPath('userData'), 'workspace-state.json'),
      codex: join(app.getPath('userData'), 'codex-state.json'),
    };
    const restored = await readWorkspaceState(stateFiles.simulation);
    if (restored.warning) console.warn(restored.warning);
    if (restored.snapshot && restored.snapshot.mode !== 'simulation') restored.snapshot = undefined;
    if (restored.snapshot && restored.snapshot.tasks.some(task => ['queued', 'planning', 'working', 'testing'].includes(task.status))) {
      restored.snapshot.paused = true;
    }
    try {
      engine = new WorkspaceEngine(restored.snapshot);
    } catch {
      // A structurally valid file can still violate workflow invariants.
      console.warn('Saved workspace could not be restored. Starting a fresh simulation.');
      engine = new WorkspaceEngine();
    }
    const liveRestored = await readWorkspaceState(stateFiles.codex);
    if (liveRestored.warning) console.warn(liveRestored.warning);
    live = new CodexRuntime({
      snapshot: liveRestored.snapshot?.mode === 'codex' ? liveRestored.snapshot : undefined,
      worktrees: new GitWorktreeService(join(app.getPath('userData'), 'worktrees')),
      onChange: async snapshot => {
        await saveWorkspaceSnapshot(snapshot);
        if (mode === 'codex') publish(snapshot, false);
      },
    });
    installIpc();
    if (!devUrl) await installRendererProtocol();
    await createWindow();
    lastTick = performance.now();
    tickTimer = setInterval(() => {
      const now = performance.now();
      if (mode === 'simulation') engine.tick(Math.max(0, Math.min(now - lastTick, 1000)));
      lastTick = now;
      publish();
    }, 400);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  }).catch(error => {
    console.error('Desktop application could not start:', (error as Error).message);
    app.exit(1);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || smokeTest) app.quit();
  });
  app.on('before-quit', event => {
    if (didFlushForQuit || !engine) return;
    event.preventDefault();
    if (finishingQuit) return;
    finishingQuit = true;
    if (tickTimer) clearInterval(tickTimer);
    if (saveTimer) clearTimeout(saveTimer);
    void (async () => {
      await live?.close();
      await saveWorkspaceSnapshot(engine.getSnapshot());
      if (live) await saveWorkspaceSnapshot(live.getSnapshot());
    })().catch(error => {
      console.error('Workspace state could not be saved during shutdown:', (error as Error).message);
    }).finally(() => {
      didFlushForQuit = true;
      app.quit();
    });
  });
}
