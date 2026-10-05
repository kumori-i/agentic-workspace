import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { GitWorktreeService } from '../src/desktop/git-worktrees';

const execute = promisify(execFile);
const temporaryDirectories: string[] = [];

async function runGit(path: string, ...args: string[]): Promise<string> {
  return (await execute('git', args, { cwd: path, shell: false, encoding: 'utf8' })).stdout;
}

async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'agentic-worktree-test-')));
  temporaryDirectories.push(directory);
  const repository = join(directory, 'repository');
  await mkdir(repository);
  await runGit(repository, 'init', '-b', 'main');
  await runGit(repository, 'config', 'user.name', 'Worktree Tests');
  await runGit(repository, 'config', 'user.email', 'worktree-tests@example.invalid');
  await writeFile(join(repository, 'source.txt'), 'committed source\n');
  await runGit(repository, 'add', '--', 'source.txt');
  await runGit(repository, 'commit', '-m', 'Fixture baseline');
  const root = join(directory, 'worktrees');
  return { directory, repository, root, service: new GitWorktreeService(root) };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('GitWorktreeService', () => {
  it('requires a committed Git repository and resolves a selected subfolder to its root', async () => {
    const { directory, repository, service } = await fixture();
    const selected = join(repository, 'subfolder');
    await mkdir(selected);
    const information = await service.inspectRepository(selected);
    expect(information.path).toBe(repository);
    expect(information.branch).toBe('main');
    expect(information.head).toMatch(/^[a-f0-9]{40}$/);
    expect(information.dirty).toBe(false);
    const emptyRepository = join(directory, 'empty');
    await mkdir(emptyRepository);
    await runGit(emptyRepository, 'init');
    await expect(service.inspectRepository(emptyRepository)).rejects.toThrow('at least one committed');
    await expect(service.inspectRepository(directory)).rejects.toThrow('Git operation failed');
  });

  it('creates unique isolated task branches from HEAD while retaining dirty source files', async () => {
    const { repository, root, service } = await fixture();
    await writeFile(join(repository, 'source.txt'), 'uncommitted source stays here\n');
    await writeFile(join(repository, 'local-only.txt'), 'do not copy\n');
    await runGit(repository, 'add', '--', 'source.txt');
    expect((await service.inspectRepository(repository)).dirty).toBe(true);
    const first = await service.create(repository, 'task-1');
    const second = await service.create(repository, 'task-1');
    expect(first.path.startsWith(root)).toBe(true);
    expect(first.path).not.toBe(second.path);
    expect(first.branch).not.toBe(second.branch);
    expect(await readFile(join(first.path, 'source.txt'), 'utf8')).toBe('committed source\n');
    await expect(readFile(join(first.path, 'local-only.txt'))).rejects.toThrow();
    await writeFile(join(first.path, 'source.txt'), 'changed by task\n');
    expect(await readFile(join(second.path, 'source.txt'), 'utf8')).toBe('committed source\n');
    expect(await readFile(join(repository, 'source.txt'), 'utf8')).toBe('uncommitted source stays here\n');
    expect((await runGit(repository, 'status', '--short'))).toContain('M  source.txt');
  });

  it('inspects committed, staged, unstaged, and untracked changes against the original base', async () => {
    const { repository, service } = await fixture();
    const worktree = await service.create(repository, 'task-2');
    await writeFile(join(worktree.path, 'source.txt'), 'task commit\n');
    await runGit(worktree.path, 'add', '--', 'source.txt');
    await runGit(worktree.path, 'commit', '-m', 'Task commit');
    await writeFile(join(worktree.path, 'staged.txt'), 'staged addition\n');
    await runGit(worktree.path, 'add', '--', 'staged.txt');
    await writeFile(join(worktree.path, 'source.txt'), 'task commit\nunstaged addition\n');
    await writeFile(join(worktree.path, 'untracked.txt'), 'untracked addition\n');
    const inspection = await service.inspect(worktree);
    expect(inspection.files).toEqual(expect.arrayContaining(['source.txt', 'staged.txt', 'untracked.txt']));
    expect(inspection.diff).toContain('-committed source');
    expect(inspection.diff).toContain('+task commit');
    expect(inspection.diff).toContain('+staged addition');
    expect(inspection.diff).toContain('+unstaged addition');
    expect(inspection.diff).toContain('+untracked addition');
    expect(inspection.status).toContain('?? untracked.txt');
    expect(inspection.truncated).toBe(false);
    expect(await readFile(join(worktree.path, 'untracked.txt'), 'utf8')).toBe('untracked addition\n');
  });

  it('indicates omitted binary and oversized files and bounds review output', async () => {
    const { repository, service } = await fixture();
    await writeFile(join(repository, 'tracked-binary.bin'), Buffer.from([0, 1, 2, 3]));
    await runGit(repository, 'add', '--', 'tracked-binary.bin');
    await runGit(repository, 'commit', '-m', 'Binary fixture');
    const worktree = await service.create(repository, 'task-3');
    await writeFile(join(worktree.path, 'tracked-binary.bin'), Buffer.from([0, 4, 5, 6]));
    await writeFile(join(worktree.path, 'binary.bin'), Buffer.from([0, 1, 2, 255]));
    await writeFile(join(worktree.path, 'large.txt'), 'x'.repeat(70 * 1024));
    const inspection = await service.inspect(worktree);
    expect(inspection.diff).toContain('Binary file omitted');
    expect(inspection.diff).toContain('Binary files a/tracked-binary.bin and b/tracked-binary.bin differ');
    expect(inspection.diff).toContain('Large untracked file omitted');
    expect(inspection.truncated).toBe(true);
    expect(Buffer.byteLength(inspection.diff)).toBeLessThanOrEqual(256 * 1024);
    await writeFile(join(worktree.path, 'source.txt'), `${'many changed lines\n'.repeat(30_000)}`);
    const largeDiff = await service.inspect(worktree);
    expect(largeDiff.truncated).toBe(true);
    expect(Buffer.byteLength(largeDiff.diff)).toBeLessThanOrEqual(256 * 1024);
  });

  it('rejects foreign metadata and symlink worktree folders without following their targets', async () => {
    const { directory, repository, service } = await fixture();
    const managed = await service.create(repository, 'task-4');
    const foreign = join(directory, 'foreign');
    await runGit(repository, 'worktree', 'add', '-b', 'foreign', '--', foreign, managed.baseCommit);
    await expect(service.inspect({ ...managed, path: foreign })).rejects.toThrow('outside');
    await expect(service.inspect({ ...managed, baseCommit: '--help' })).rejects.toThrow('metadata');
    const link = join(directory, 'worktrees', 'linked');
    await symlink(foreign, link, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(service.inspect({ ...managed, path: link })).rejects.toThrow('not a symlink');
    const differentRepository = join(directory, 'different-repository');
    await mkdir(differentRepository);
    await runGit(differentRepository, 'init', '-b', 'main');
    await runGit(differentRepository, 'config', 'user.name', 'Other');
    await runGit(differentRepository, 'config', 'user.email', 'other@example.invalid');
    await writeFile(join(differentRepository, 'other.txt'), 'other');
    await runGit(differentRepository, 'add', '--', 'other.txt');
    await runGit(differentRepository, 'commit', '-m', 'Other baseline');
    await expect(service.inspect({ ...managed, repositoryPath: differentRepository })).rejects.toThrow('not registered');
  });

  it('omits tracked binary contents even when attributes force text diffs', async () => {
    const { repository, service } = await fixture();
    await writeFile(join(repository, 'forced.bin'), Buffer.from([0, 1, 2, 3]));
    await writeFile(join(repository, '.gitattributes'), 'forced.bin diff\n');
    await runGit(repository, 'add', '--', 'forced.bin', '.gitattributes');
    await runGit(repository, 'commit', '-m', 'Forced text binary fixture');
    const worktree = await service.create(repository, 'task-forced-binary');
    await writeFile(join(worktree.path, 'forced.bin'), Buffer.from([0, 9, 8, 7]));
    const inspection = await service.inspect(worktree);
    expect(inspection.diff).toContain('Binary file omitted');
    expect(inspection.diff).not.toContain('\0');
    expect(inspection.files).toContain('forced.bin');
  });

  it.skipIf(process.platform === 'win32')('does not read an untracked symlink target outside the task worktree', async () => {
    const { directory, repository, service } = await fixture();
    const worktree = await service.create(repository, 'task-5');
    const outside = join(directory, 'outside.txt');
    await writeFile(outside, 'private target content');
    await symlink(outside, join(worktree.path, 'outside-link.txt'), 'file');
    const inspection = await service.inspect(worktree);
    expect(inspection.diff).toContain('Symlink omitted');
    expect(inspection.diff).not.toContain('private target content');
  });

  it('rejects unsafe task IDs and symlink storage folders', async () => {
    const { directory, repository, service } = await fixture();
    await expect(service.create(repository, '../escape')).rejects.toThrow('safe task ID');
    await expect(service.create(repository, '--help')).rejects.toThrow('safe task ID');
    const actual = join(directory, 'actual');
    await mkdir(actual);
    const rootLink = join(directory, 'root-link');
    await symlink(actual, rootLink, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(new GitWorktreeService(rootLink).create(repository, 'task-6')).rejects.toThrow('not a symlink');
  });
});
