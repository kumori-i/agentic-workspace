import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import type { CodexModel, CodexStatus } from '../shared/types';

export type CodexRequestId = string | number;

/** The small process surface also permits a protocol fixture, without launching a model. */
export interface CodexProcess extends EventEmitter {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export interface CodexSpawnOptions {
  env: NodeJS.ProcessEnv;
  windowsHide: boolean;
  shell: false;
  stdio: ['pipe', 'pipe', 'pipe'];
}

export interface CodexClientOptions {
  processFactory?: (executable: string, args: string[], options: CodexSpawnOptions) => CodexProcess;
  requestTimeoutMs?: number;
  maxBufferBytes?: number;
  closeTimeoutMs?: number;
  startupTimeoutMs?: number;
}

type NotificationListener = (method: string, params: unknown) => void;
type RequestListener = (method: string, params: unknown, id: CodexRequestId) => void;
type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const APPROVAL_METHODS = new Set(['item/commandExecution/requestApproval', 'item/fileChange/requestApproval']);
const initialStatus = (): CodexStatus => ({
  state: 'disconnected', auth: 'none', message: 'Codex is disconnected.', models: [], selectedModel: null,
});
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is CodexRequestId =>
  (typeof value === 'number' && Number.isSafeInteger(value)) ||
  (typeof value === 'string' && value.length > 0 && value.length <= 200);

/** Never pass API billing credentials to the desktop's ChatGPT-only connection. */
export function codexEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([name]) =>
    !/(?:^|_)(?:API_KEY|APIKEY)$|^(?:AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN)$/i.test(name),
  ));
}

function safeError(error: unknown, fallback: string): Error {
  const message = error instanceof Error ? error.message : fallback;
  return new Error(message
    .replace(/\b(?:sk-[\w-]+|Bearer\s+[\w.\/-]+)\b/gi, '[redacted]')
    .slice(0, 800));
}

/**
 * Local JSONL transport for an installed Codex app-server. Authentication stays
 * inside Codex: this class neither reads auth files nor exposes account identity.
 */
export class CodexClient {
  private readonly factory: NonNullable<CodexClientOptions['processFactory']>;
  private readonly timeoutMs: number;
  private readonly maxBufferBytes: number;
  private readonly closeTimeoutMs: number;
  private readonly startupTimeoutMs: number;
  private process: CodexProcess | null = null;
  private decoder = new StringDecoder('utf8');
  private buffer = '';
  private requestSequence = 0;
  private pending = new Map<CodexRequestId, PendingRequest>();
  private serverRequests = new Set<CodexRequestId>();
  private notifications = new Set<NotificationListener>();
  private requests = new Set<RequestListener>();
  private exits = new Set<(error: Error) => void>();
  private status = initialStatus();
  private connecting: Promise<CodexStatus> | null = null;

  constructor(private readonly executable = 'codex', options: CodexClientOptions = {}) {
    this.factory = options.processFactory ?? ((command, args, spawnOptions) => spawn(command, args, spawnOptions));
    this.timeoutMs = options.requestTimeoutMs ?? 30_000;
    this.maxBufferBytes = options.maxBufferBytes ?? 2 * 1024 * 1024;
    this.closeTimeoutMs = options.closeTimeoutMs ?? 1500;
    this.startupTimeoutMs = options.startupTimeoutMs ?? options.requestTimeoutMs ?? 90_000;
  }

  getStatus(): CodexStatus { return structuredClone(this.status); }

  connect(): Promise<CodexStatus> {
    if (this.status.state === 'ready' && this.process) return Promise.resolve(this.getStatus());
    if (this.connecting) return this.connecting;
    this.status = { ...initialStatus(), state: 'connecting', message: 'Connecting to the local Codex CLI…' };
    this.connecting = this.initialize().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  /** Only an authenticated, initialized connection may launch work. */
  request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (this.status.state !== 'ready') return Promise.reject(new Error('Connect to a signed-in Codex CLI before starting work.'));
    return this.sendRequest(method, params) as Promise<T>;
  }

  respond(id: CodexRequestId, result: unknown): void {
    if (!this.serverRequests.has(id)) throw new Error('This Codex approval is no longer pending.');
    this.write({ id, result });
    this.serverRequests.delete(id);
  }

  onNotification(listener: NotificationListener): () => void {
    this.notifications.add(listener);
    return () => this.notifications.delete(listener);
  }

  onServerRequest(listener: RequestListener): () => void {
    this.requests.add(listener);
    return () => this.requests.delete(listener);
  }

  onExit(listener: (error: Error) => void): () => void {
    this.exits.add(listener);
    return () => this.exits.delete(listener);
  }

  async close(): Promise<void> {
    await this.stopProcess(new Error('The Codex connection was closed.'));
    this.status = initialStatus();
  }

  private async initialize(): Promise<CodexStatus> {
    try {
      if (!this.executable || this.executable.includes('\0')) throw new Error('Choose a valid Codex executable.');
      this.decoder = new StringDecoder('utf8');
      this.buffer = '';
      const process = this.factory(this.executable, ['app-server'], {
        env: codexEnvironment(globalThis.process.env), windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.process = process;
      process.stdout.on('data', (chunk: Buffer | string) => {
        if (this.process === process) this.consume(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      });
      // Drain stderr, but never forward it: auth/token diagnostics can be sensitive.
      process.stderr.on('data', () => {});
      process.stdout.on('error', () => this.fail(process, new Error('The Codex output stream failed.')));
      process.stderr.on('error', () => {});
      process.stdin.on('error', () => this.fail(process, new Error('The Codex input stream failed.')));
      process.on('error', (error: NodeJS.ErrnoException) => {
        const failure = new Error(error.code === 'ENOENT'
          ? 'Codex CLI was not found. Install Codex or choose its executable.'
          : 'The Codex CLI could not be started.');
        Object.assign(failure, { code: error.code });
        this.fail(process, failure);
      });
      process.on('exit', () => this.fail(process, new Error('Codex exited. Reconnect before resuming work.')));
      process.on('close', () => this.fail(process, new Error('Codex closed its connection. Reconnect before resuming work.')));
      const initialized = await this.sendRequest('initialize', {
        clientInfo: { name: 'agentic_workspace', title: 'Agentic Workspace', version: '0.2.0' },
        capabilities: { experimentalApi: false },
      });
      this.write({ method: 'initialized', params: {} });
      const accountResult = await this.sendRequest('account/read', { refreshToken: false });
      if (!isRecord(accountResult)) throw new Error('Codex returned an invalid account response.');
      const account = accountResult.account;
      if (!isRecord(account) || account.type !== 'chatgpt') {
        this.status = {
          ...initialStatus(), state: 'needs-auth', auth: account ? 'other' : 'none',
          message: account
            ? 'This preview uses Codex with ChatGPT sign-in. API-key and other billing modes are disabled.'
            : 'Sign in through the Codex CLI with your existing ChatGPT account, then reconnect. The desktop app has no separate account.',
        };
        await this.stopProcess(new Error('ChatGPT authentication is required.'));
        return this.getStatus();
      }
      const models = await this.listModels();
      if (!models.length) throw new Error('Codex returned no available models. Check the CLI and reconnect.');
      const version = isRecord(initialized) && typeof initialized.userAgent === 'string'
        ? initialized.userAgent.match(/\b(?:codex_cli_rs|codex-cli|codex)[ /](\d+\.\d+\.\d+(?:[-.\w]*)?)/i)?.[1]
        : undefined;
      this.status = {
        state: 'ready', auth: 'chatgpt', message: 'Connected to the local Codex CLI with ChatGPT.',
        models, selectedModel: (models.find(model => model.isDefault) ?? models[0]).model,
        ...(version ? { version } : {}),
        ...(typeof account.planType === 'string' ? { plan: account.planType.slice(0, 100) } : {}),
      };
      return this.getStatus();
    } catch (error) {
      const failure = safeError(error, 'The Codex connection failed.');
      await this.stopProcess(failure);
      this.status = {
        ...initialStatus(), state: (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'unavailable' : 'error',
        message: failure.message,
      };
      return this.getStatus();
    }
  }

  private async listModels(): Promise<CodexModel[]> {
    const models: CodexModel[] = [];
    let cursor: string | null = null;
    const seen = new Set<string>();
    for (let page = 0; page < 10; page++) {
      const result = await this.sendRequest('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
      if (!isRecord(result) || !Array.isArray(result.data)) throw new Error('Codex returned an invalid model catalog.');
      for (const model of result.data) {
        if (!isRecord(model) || typeof model.id !== 'string' || typeof model.model !== 'string' ||
          typeof model.displayName !== 'string' || model.hidden === true || seen.has(model.model)) continue;
        if (!model.id || model.id.length > 200 || !model.model || model.model.length > 200 || model.displayName.length > 300) continue;
        seen.add(model.model);
        models.push({ id: model.id, model: model.model, displayName: model.displayName, isDefault: model.isDefault === true });
      }
      if (result.nextCursor === null || result.nextCursor === undefined) return models;
      if (typeof result.nextCursor !== 'string' || !result.nextCursor || result.nextCursor === cursor) throw new Error('Codex returned an invalid model catalog cursor.');
      cursor = result.nextCursor;
    }
    throw new Error('The Codex model catalog exceeded the supported page limit.');
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    if (!this.process) return Promise.reject(new Error('The Codex connection is closed.'));
    const id = `aw-${++this.requestSequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(`Codex did not answer ${method} in time. Reconnect before resuming work.`);
        reject(error);
        // A timed-out turn/start could still run: terminate the transport so callers
        // cannot accidentally launch a second turn on an ambiguous connection.
        const process = this.process;
        if (process) this.fail(process, error);
      }, method === 'thread/start' || method === 'thread/resume' ? this.startupTimeoutMs : this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(safeError(error, 'The Codex request could not be sent.'));
      }
    });
  }

  private write(value: unknown): void {
    const process = this.process;
    if (!process) throw new Error('The Codex connection is closed.');
    const line = `${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(line) > this.maxBufferBytes) throw new Error('The Codex request is too large.');
    process.stdin.write(line, error => {
      if (error) this.fail(process, new Error('The Codex request could not be written.'));
    });
  }

  private consume(chunk: Buffer): void {
    this.buffer += this.decoder.write(chunk);
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline === -1) break;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (Buffer.byteLength(line) > this.maxBufferBytes) { this.protocolFailure('Codex sent an oversized protocol message.'); return; }
      if (!line.trim()) continue;
      let message: unknown;
      try { message = JSON.parse(line); }
      catch { this.protocolFailure('Codex sent malformed protocol data.'); return; }
      if (!isRecord(message)) { this.protocolFailure('Codex sent an invalid protocol message.'); return; }
      try { this.dispatch(message); }
      catch { this.protocolFailure('A Codex event could not be handled safely.'); return; }
      if (!this.process) return;
    }
    if (Buffer.byteLength(this.buffer) > this.maxBufferBytes) this.protocolFailure('Codex sent an oversized protocol message.');
  }

  private dispatch(message: Record<string, unknown>): void {
    if (typeof message.method === 'string') {
      if (!message.method || message.method.length > 200) throw new Error('Invalid method.');
      if (message.id !== undefined) {
        if (!isId(message.id)) throw new Error('Invalid request id.');
        if (this.serverRequests.has(message.id)) throw new Error('Duplicate server request.');
        this.serverRequests.add(message.id);
        if (APPROVAL_METHODS.has(message.method) && this.requests.size) {
          for (const listener of this.requests) listener(message.method, message.params, message.id);
        } else this.rejectUnsupported(message.method, message.id);
      } else {
        if (message.method === 'account/updated' && this.status.state === 'ready' &&
          isRecord(message.params) && message.params.authMode !== 'chatgpt') {
          this.protocolFailure('Codex authentication changed. Reconnect with ChatGPT before resuming work.');
          return;
        }
        if (message.method === 'serverRequest/resolved' && isRecord(message.params) && isId(message.params.requestId)) {
          this.serverRequests.delete(message.params.requestId);
        }
        for (const listener of this.notifications) listener(message.method, message.params);
      }
      return;
    }
    if (!isId(message.id)) throw new Error('Missing response id.');
    const pending = this.pending.get(message.id);
    if (!pending) return; // Late or unrelated responses never resolve another request.
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (isRecord(message.error)) {
      const error = typeof message.error.message === 'string' ? message.error.message : 'Codex rejected the request.';
      pending.reject(safeError(new Error(error), 'Codex rejected the request.'));
    } else if ('result' in message) pending.resolve(message.result);
    else pending.reject(new Error('Codex returned an invalid response.'));
  }

  private rejectUnsupported(method: string, id: CodexRequestId): void {
    if (APPROVAL_METHODS.has(method)) this.respond(id, { decision: 'decline' });
    else if (method === 'item/permissions/requestApproval') this.respond(id, { permissions: {}, scope: 'turn' });
    else if (method === 'mcpServer/elicitation/request') this.respond(id, { action: 'decline', content: null });
    else if (method === 'item/tool/requestUserInput') this.respond(id, { answers: {} });
    else if (method === 'item/tool/call') this.respond(id, {
      contentItems: [{ type: 'inputText', text: 'This desktop preview does not implement dynamic tools.' }], success: false,
    });
    else {
      this.write({ id, error: { code: -32601, message: 'This client does not support that server request.' } });
      this.serverRequests.delete(id);
    }
    for (const listener of this.notifications) listener('workspace/unsupportedServerRequest', { method });
  }

  private protocolFailure(message: string): void {
    const process = this.process;
    if (process) this.fail(process, new Error(message));
  }

  private fail(process: CodexProcess, error: Error): void {
    if (this.process !== process) return;
    this.process = null;
    this.buffer = '';
    this.rejectPending(error);
    this.status = { ...initialStatus(), state: 'error', message: error.message };
    const escalation = setTimeout(() => {
      try { process.kill('SIGKILL'); } catch { /* Already exited. */ }
    }, this.closeTimeoutMs);
    escalation.unref();
    const finished = () => clearTimeout(escalation);
    process.once('close', finished);
    process.once('exit', finished);
    try { process.stdin.end(); process.kill(); } catch { finished(); }
    for (const listener of this.exits) {
      try { listener(error); } catch { /* One observer cannot hide exit from the others. */ }
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.serverRequests.clear();
  }

  private async stopProcess(error: Error): Promise<void> {
    const process = this.process;
    this.process = null;
    this.buffer = '';
    this.rejectPending(error);
    if (!process) return;
    await new Promise<void>(resolve => {
      let finished = false;
      const finish = () => { if (!finished) { finished = true; clearTimeout(timer); resolve(); } };
      const timer = setTimeout(() => { try { process.kill('SIGKILL'); } catch { /* Already exited. */ } finish(); }, this.closeTimeoutMs);
      process.once('close', finish);
      process.once('exit', finish);
      try { process.stdin.end(); process.kill(); } catch { finish(); }
    });
  }
}
