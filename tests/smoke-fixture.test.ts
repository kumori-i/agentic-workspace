import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { GitWorktreeService } from '../src/desktop/git-worktrees';
import { createSmokeFixture } from '../src/desktop/smoke-fixture';

const execute = promisify(execFile);
it('confines the smoke client to its disposable repository, including managed worktrees from another project', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'aw-smoke-fixture-'));
  const fixture = await createSmokeFixture(folder);
  const client = fixture.clientFactory();
  try {
    const service = new GitWorktreeService(join(folder, 'worktrees'));
    const owned = await service.create(fixture.repository, 'task-owned');
    await expect(client.request('thread/start', { cwd: owned.path, sandbox: 'read-only' })).resolves.toMatchObject({ thread: { id: expect.any(String) } });
    const foreign = join(folder, 'foreign-project');
    await execute('git', ['init', '-b', 'main', foreign]);
    await execute('git', ['-C', foreign, 'config', 'user.email', 'fixture@example.invalid']);
    await execute('git', ['-C', foreign, 'config', 'user.name', 'Fixture']);
    await writeFile(join(foreign, 'README.md'), 'Preserve this separate project.\n');
    await execute('git', ['-C', foreign, 'add', '.']);
    await execute('git', ['-C', foreign, '-c', 'commit.gpgsign=false', 'commit', '-m', 'Baseline']);
    const other = await service.create(foreign, 'task-other');
    await expect(client.request('thread/start', { cwd: other.path, sandbox: 'workspace-write' })).rejects.toThrow('non-fixture Git repository');
    expect(await readFile(join(other.path, 'README.md'), 'utf8')).toBe('Preserve this separate project.\n');
    expect(await readFile(join(foreign, 'README.md'), 'utf8')).toBe('Preserve this separate project.\n');
  } finally { await client.close(); await rm(folder, { recursive: true, force: true }); }
});
