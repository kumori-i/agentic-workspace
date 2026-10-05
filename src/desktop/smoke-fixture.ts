import { execFile } from 'node:child_process';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import type { CodexStatus } from '../shared/types';
import type { RuntimeClient } from './codex-runtime';

const execute = promisify(execFile);
const updatedReadme = '# Smoke project\nRuns locally.\n';
function fixtureEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) if (key.startsWith('GIT_')) delete environment[key];
  environment.GIT_TERMINAL_PROMPT = '0'; return environment;
}
const status: CodexStatus = { state: 'ready', auth: 'chatgpt', message: 'Desktop smoke fixture; no authentication or model inference.', models: [{ id: 'smoke-fixture', model: 'smoke-fixture', displayName: 'Smoke fixture (no inference)', isDefault: true }], selectedModel: 'smoke-fixture' };

/** Used only with --smoke-test and a newly created disposable repository. */
class SmokeClient implements RuntimeClient {
  private notifications = new Set<(method: string, params: unknown) => void>();
  private threads = new Map<string, { cwd: string; review: boolean }>();
  private cancelled = new Set<string>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private pending = new Set<Promise<void>>();
  private sequence = 0;
  private closed = false;
  constructor(private readonly worktreeRoot: string, private readonly fixtureRepository: string) {}
  connect = async () => structuredClone(status);
  async request<T>(method: string, params: any): Promise<T> {
    if (method === 'thread/start') {
      // A fixture can never edit a user-selected project or arbitrary folder.
      const root = await realpath(this.worktreeRoot); const cwd = await realpath(params.cwd);
      if (dirname(cwd) !== root || relative(root, cwd).startsWith('..')) throw new Error('Smoke fixture rejected a non-fixture worktree.');
      const common = await execute('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { timeout: 10_000, env: fixtureEnvironment() });
      if (await realpath(common.stdout.trim()) !== await realpath(join(this.fixtureRepository, '.git'))) throw new Error('Smoke fixture rejected a non-fixture Git repository.');
      const id = `smoke-thread-${++this.sequence}`;
      this.threads.set(id, { cwd: params.cwd, review: params.sandbox === 'read-only' });
      return { thread: { id } } as T;
    }
    if (method === 'turn/start') {
      const thread = this.threads.get(params.threadId);
      if (!thread) throw new Error('Unknown smoke thread.');
      const id = `smoke-turn-${++this.sequence}`;
      this.emit('turn/started', { threadId: params.threadId, turn: { id } });
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        const run = this.complete(params.threadId, id, thread).catch(() => this.emit('turn/completed', { threadId: params.threadId, turn: { id, status: 'failed', error: { message: 'Disposable smoke fixture failed.' } } }));
        this.pending.add(run); void run.finally(() => this.pending.delete(run));
      }, 30);
      this.timers.add(timer);
      return { turn: { id } } as T;
    }
    if (method === 'turn/interrupt') {
      this.cancelled.add(params.turnId);
      this.emit('turn/completed', { threadId: params.threadId, turn: { id: params.turnId, status: 'interrupted' } });
      return {} as T;
    }
    throw new Error(`Unsupported smoke operation: ${method}`);
  }
  private async complete(threadId: string, id: string, thread: { cwd: string; review: boolean }): Promise<void> {
    if (this.closed || this.cancelled.has(id)) return;
    let text: string;
    if (thread.review) {
      if (await readFile(join(thread.cwd, 'README.md'), 'utf8') !== updatedReadme) throw new Error('Fixture README did not match the brief.');
      text = JSON.stringify({ verdict: 'approved', summary: 'Fixture review inspected Rowan’s README in the same worktree. No model inference ran.', findings: [], checks: ['Fixture check: the README describes local use.'] });
    } else {
      await writeFile(join(thread.cwd, 'README.md'), updatedReadme);
      text = 'Fixture implementation updated the disposable README. No model inference ran.';
    }
    if (this.closed || this.cancelled.has(id)) return;
    this.emit('item/completed', { threadId, turnId: id, item: { id: `message-${id}`, type: 'agentMessage', phase: 'final_answer', text } });
    this.emit('turn/completed', { threadId, turn: { id, status: 'completed' } });
  }
  private emit(method: string, params: unknown): void { if (!this.closed) this.notifications.forEach(callback => callback(method, params)); }
  respond(): void { throw new Error('Smoke fixture never requests approval.'); }
  onNotification(callback: (method: string, params: unknown) => void): () => void { this.notifications.add(callback); return () => { this.notifications.delete(callback); }; }
  onServerRequest(): () => void { return () => {}; }
  onExit(): () => void { return () => {}; }
  async close(): Promise<void> { this.closed = true; this.timers.forEach(clearTimeout); this.timers.clear(); await Promise.all(this.pending); }
}

export async function createSmokeFixture(dataPath: string): Promise<{ repository: string; remote: string; clientFactory: () => RuntimeClient }> {
  const root = join(dataPath, 'disposable-smoke');
  await mkdir(root, { recursive: true });
  const repository = join(root, 'project'); const remote = join(root, 'remote.git');
  const git = async (...args: string[]) => { await execute('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: root, timeout: 10_000, env: fixtureEnvironment() }); };
  await git('init', '-b', 'main', repository);
  await git('-C', repository, 'config', 'user.email', 'smoke@example.invalid');
  await git('-C', repository, 'config', 'user.name', 'Desktop smoke fixture');
  await writeFile(join(repository, 'README.md'), '# Smoke project\nDevelopment fixture.\n');
  await git('-C', repository, 'add', '.'); await git('-C', repository, 'commit', '-m', 'Smoke baseline');
  await git('init', '--bare', remote);
  await git('-C', repository, 'remote', 'add', 'origin', remote);
  await git('-C', repository, 'push', 'origin', 'main');
  return { repository, remote, clientFactory: () => new SmokeClient(join(dataPath, 'worktrees'), repository) };
}
