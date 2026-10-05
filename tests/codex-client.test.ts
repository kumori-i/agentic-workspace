import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexClient, codexEnvironment, type CodexProcess, type CodexSpawnOptions } from '../src/desktop/codex-client';

type Message = { id?: string | number; method?: string; params?: unknown; result?: unknown; error?: unknown };

class FixtureProcess extends EventEmitter implements CodexProcess {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin: Writable;
  messages: Message[] = [];
  kills: (NodeJS.Signals | number | undefined)[] = [];
  account: unknown = { type: 'chatgpt', planType: 'plus', email: 'private@example.test' };
  handler?: (message: Message) => boolean;
  private buffer = '';

  constructor() {
    super();
    this.stdin = new Writable({ write: (chunk: Buffer, _encoding, done) => {
      this.buffer += chunk.toString('utf8');
      let newline: number;
      while ((newline = this.buffer.indexOf('\n')) !== -1) {
        const message = JSON.parse(this.buffer.slice(0, newline)) as Message;
        this.buffer = this.buffer.slice(newline + 1);
        this.messages.push(message);
        queueMicrotask(() => this.receive(message));
      }
      done();
    } });
  }

  send(message: Message): void { this.stdout.write(`${JSON.stringify(message)}\n`); }
  reply(message: Message, result: unknown): void { this.send({ id: message.id, result }); }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.kills.push(signal);
    queueMicrotask(() => this.emit('close', 0, signal));
    return true;
  }

  private receive(message: Message): void {
    if (this.handler?.(message)) return;
    if (message.method === 'initialize') this.reply(message, { userAgent: 'codex_cli_rs/0.160.0', codexHome: '/secret/user', platformOs: 'linux' });
    else if (message.method === 'account/read') this.reply(message, { account: this.account, requiresOpenaiAuth: true });
    else if (message.method === 'model/list') this.reply(message, {
      data: [{ id: 'available-model', model: 'available-model', displayName: 'Available model', isDefault: true }], nextCursor: null,
    });
    else if (message.method && message.id !== undefined) this.reply(message, { thread: { id: 'thread-fixture' } });
  }
}

const clients: CodexClient[] = [];
function clientFor(process = new FixtureProcess(), options: { requestTimeoutMs?: number; maxBufferBytes?: number } = {}) {
  const client = new CodexClient('/local/bin/codex', { processFactory: () => process, closeTimeoutMs: 20, ...options });
  clients.push(client);
  return { client, process };
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.close()));
  vi.unstubAllEnvs();
});

describe('local Codex JSONL transport', () => {
  it('initializes once, reuses ChatGPT auth, and gets models without exposing account identity', async () => {
    const { client, process } = clientFor();
    const [first, second] = await Promise.all([client.connect(), client.connect()]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ state: 'ready', auth: 'chatgpt', plan: 'plus', version: '0.160.0', selectedModel: 'available-model' });
    expect(JSON.stringify(first)).not.toContain('private@example.test');
    expect(JSON.stringify(first)).not.toContain('/secret/user');
    expect(process.messages.map(message => message.method)).toEqual(['initialize', 'initialized', 'account/read', 'model/list']);
    expect(process.messages[2].params).toEqual({ refreshToken: false });
    first.models.length = 0;
    expect((await client.connect()).models).toHaveLength(1);
    expect(process.messages.filter(message => message.method === 'initialize')).toHaveLength(1);
  });

  it('spawns without a shell or API billing credentials', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sensitive');
    vi.stubEnv('CODEX_API_KEY', 'sensitive');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sensitive');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'sensitive');
    const process = new FixtureProcess();
    let invocation: { executable: string; args: string[]; options: CodexSpawnOptions } | undefined;
    const client = new CodexClient('/path with spaces/codex', {
      processFactory: (executable, args, options) => { invocation = { executable, args, options }; return process; },
    });
    clients.push(client);
    await client.connect();
    expect(invocation).toMatchObject({ executable: '/path with spaces/codex', args: ['app-server'], options: { shell: false, stdio: ['pipe', 'pipe', 'pipe'] } });
    for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'ANTHROPIC_API_KEY', 'AWS_SECRET_ACCESS_KEY']) expect(invocation!.options.env[key]).toBeUndefined();
    expect(codexEnvironment({ PATH: '/bin', OPENAI_APIKEY: 'secret', KEEP_ME: 'value' })).toEqual({ PATH: '/bin', KEEP_ME: 'value' });
  });

  it.each([null, { type: 'apiKey' }, { type: 'amazonBedrock' }])('refuses inference for a missing or non-ChatGPT account (%j)', async account => {
    const fixture = new FixtureProcess();
    fixture.account = account;
    const { client } = clientFor(fixture);
    expect(await client.connect()).toMatchObject({ state: 'needs-auth', auth: account ? 'other' : 'none', models: [] });
    await expect(client.request('thread/start', {})).rejects.toThrow('signed-in Codex CLI');
    expect(fixture.messages.some(message => message.method === 'model/list' || message.method === 'thread/start')).toBe(false);
    expect(fixture.kills).toHaveLength(1);
  });

  it('decodes fragmented UTF-8 messages and routes notifications separately from replies', async () => {
    const { client, process } = clientFor();
    await client.connect();
    const received: unknown[] = [];
    const unsubscribe = client.onNotification((method, params) => received.push({ method, params }));
    const line = Buffer.from(`${JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: 'café 🌲' } })}\n`);
    const emoji = line.indexOf(Buffer.from('🌲'));
    process.stdout.write(line.subarray(0, emoji + 1));
    process.stdout.write(line.subarray(emoji + 1, emoji + 3));
    process.stdout.write(line.subarray(emoji + 3));
    expect(received).toEqual([{ method: 'item/agentMessage/delta', params: { delta: 'café 🌲' } }]);
    unsubscribe();
    process.send({ method: 'turn/started', params: {} });
    expect(received).toHaveLength(1);
    expect(await client.request('thread/start', { cwd: '/worktree' })).toEqual({ thread: { id: 'thread-fixture' } });
  });

  it('correlates ids exactly and never resolves a request from an unrelated response', async () => {
    const { client, process } = clientFor();
    await client.connect();
    process.handler = message => message.method === 'thread/start';
    const request = client.request('thread/start', {});
    const sent = process.messages.at(-1)!;
    process.send({ id: 'unrelated-id', result: { wrong: true } });
    process.reply(sent, { correct: true });
    await expect(request).resolves.toEqual({ correct: true });
  });

  it('surfaces command/file approval requests and requires pending ids when responding', async () => {
    const { client, process } = clientFor();
    await client.connect();
    const requests: unknown[] = [];
    client.onServerRequest((method, params, id) => requests.push({ method, params, id }));
    process.send({ id: 42, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread', turnId: 'turn', command: 'npm test' } });
    process.send({ id: 'approval-file', method: 'item/fileChange/requestApproval', params: { grantRoot: '/outside' } });
    expect(requests).toHaveLength(2);
    client.respond(42, { decision: 'accept' });
    expect(process.messages.at(-1)).toEqual({ id: 42, result: { decision: 'accept' } });
    expect(() => client.respond(42, { decision: 'accept' })).toThrow('no longer pending');
    process.send({ method: 'serverRequest/resolved', params: { requestId: 'approval-file' } });
    expect(() => client.respond('approval-file', { decision: 'decline' })).toThrow('no longer pending');
  });

  it('fails closed for unsupported permissions, tool requests and credential refresh', async () => {
    const { client, process } = clientFor();
    await client.connect();
    process.send({ id: 1, method: 'item/permissions/requestApproval', params: { permissions: { network: { enabled: true } } } });
    process.send({ id: 2, method: 'mcpServer/elicitation/request', params: { mode: 'url', url: 'https://example.test/login' } });
    process.send({ id: 3, method: 'account/chatgptAuthTokens/refresh', params: {} });
    process.send({ id: 4, method: 'item/commandExecution/requestApproval', params: {} });
    const replies = process.messages.filter(message => typeof message.id === 'number');
    expect(replies).toEqual([
      { id: 1, result: { permissions: {}, scope: 'turn' } },
      { id: 2, result: { action: 'decline', content: null } },
      { id: 3, error: { code: -32601, message: 'This client does not support that server request.' } },
      { id: 4, result: { decision: 'decline' } },
    ]);
  });

  it('terminates an ambiguous connection on request timeout and rejects every pending request', async () => {
    const { client, process } = clientFor(new FixtureProcess(), { requestTimeoutMs: 30 });
    await client.connect();
    process.handler = message => message.method === 'turn/start' || message.method === 'thread/read';
    const exits: Error[] = [];
    client.onExit(error => exits.push(error));
    const first = client.request<never>('turn/start', {}).catch(error => error as Error);
    const second = client.request<never>('thread/read', {}).catch(error => error as Error);
    expect((await first).message).toContain('did not answer turn/start');
    expect((await second).message).toContain('did not answer turn/start');
    expect(exits).toHaveLength(1);
    expect(process.kills).toHaveLength(1);
    await expect(client.request('turn/start', {})).rejects.toThrow('signed-in Codex CLI');
  });

  it('rejects pending requests once when the process dies', async () => {
    const { client, process } = clientFor();
    await client.connect();
    process.handler = message => message.method === 'turn/start';
    const exits: Error[] = [];
    client.onExit(error => exits.push(error));
    const request = client.request<never>('turn/start', {}).catch(error => error as Error);
    process.emit('exit', 1, null);
    process.emit('close', 1, null);
    expect((await request).message).toContain('Codex exited');
    expect(exits).toHaveLength(1);
  });

  it.each(['{not json}\n', `${JSON.stringify([])}\n`, `${'x'.repeat(4097)}`])('bounds and validates protocol input', async input => {
    const { client, process } = clientFor(new FixtureProcess(), { maxBufferBytes: 4096 });
    await client.connect();
    process.handler = message => message.method === 'turn/start';
    const request = client.request<never>('turn/start', {}).catch(error => error as Error);
    process.stdout.write(input);
    expect((await request).message).toMatch(/protocol/);
    expect(client.getStatus().state).toBe('error');
    expect(process.kills).toHaveLength(1);
  });

  it('reports a missing executable without printing stderr diagnostics', async () => {
    const fixture = new FixtureProcess();
    const { client } = clientFor(fixture);
    const connected = client.connect();
    fixture.stderr.write('secret credentials should not appear');
    fixture.emit('error', Object.assign(new Error('spawn failed'), { code: 'ENOENT' }));
    const status = await connected;
    expect(status.state).toBe('unavailable');
    expect(status.message).toContain('not found');
    expect(JSON.stringify(status)).not.toContain('secret credentials');
  });

  it('disconnects if authentication switches away from ChatGPT', async () => {
    const { client, process } = clientFor();
    await client.connect();
    process.send({ method: 'account/updated', params: { authMode: 'apiKey', planType: null } });
    expect(client.getStatus()).toMatchObject({ state: 'error', auth: 'none' });
    await expect(client.request('turn/start', {})).rejects.toThrow('signed-in Codex CLI');
  });

  it('closes cleanly, clears pending approvals, and can reconnect to another process', async () => {
    const processes = [new FixtureProcess(), new FixtureProcess()];
    const client = new CodexClient('codex', { processFactory: () => processes.shift()! });
    clients.push(client);
    await client.connect();
    const next = processes[0];
    await client.close();
    expect(client.getStatus().state).toBe('disconnected');
    expect((await client.connect()).state).toBe('ready');
    expect(next.messages[0].method).toBe('initialize');
  });
});
