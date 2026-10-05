import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitWorktreeService } from '../src/desktop/git-worktrees';
import type { TaskPublication, WorktreeInfo } from '../src/shared/types';

const execute = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await execute('git', ['-c', 'commit.gpgsign=false', ...args], { cwd })).stdout.trim();

describe('reviewed commit, merge and push using real disposable Git repositories', () => {
  let folder: string;
  let repository: string;
  let remote: string;
  let service: GitWorktreeService;
  let worktree: WorktreeInfo;
  let base: string;
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'aw-publication-'));
    repository = join(folder, 'project'); remote = join(folder, 'remote.git');
    await git(folder, 'init', '-b', 'main', repository);
    await git(repository, 'config', 'user.email', 'fixture@example.invalid');
    await git(repository, 'config', 'user.name', 'Fixture');
    await writeFile(join(repository, 'README.md'), 'original\n');
    await writeFile(join(repository, 'remove.txt'), 'original\n');
    await git(repository, 'add', '.'); await git(repository, 'commit', '-m', 'Baseline');
    base = await git(repository, 'rev-parse', 'HEAD');
    await git(folder, 'init', '--bare', remote);
    await git(repository, 'remote', 'add', 'origin', remote);
    await git(repository, 'push', 'origin', 'main');
    service = new GitWorktreeService(join(folder, 'worktrees'));
    worktree = await service.create(repository, 'task-review');
    await writeFile(join(worktree.path, 'README.md'), 'reviewed change\n');
  });
  afterEach(async () => { await rm(folder, { recursive: true, force: true }); });
  const prepare = async (): Promise<TaskPublication> => ({ phase: 'prepared', plan: await service.preparePublication(worktree, await service.checkpoint(worktree), 'origin', 'Update the README') });

  it('hashes all Git content without changing the real staged index', async () => {
    await git(worktree.path, 'add', 'README.md');
    const stagedBefore = await git(worktree.path, 'write-tree');
    await writeFile(join(worktree.path, 'README.md'), 'unstaged revision\n');
    await writeFile(join(worktree.path, 'asset.bin'), Buffer.from([0, 42, 255]));
    await rm(join(worktree.path, 'remove.txt'));
    const checkpoint = await service.checkpoint(worktree);
    expect(checkpoint.head).toBe(base);
    expect(checkpoint.tree).not.toBe(stagedBefore);
    expect(await git(worktree.path, 'write-tree')).toBe(stagedBefore);
    expect(await git(worktree.path, 'show', `${checkpoint.tree}:README.md`)).toBe('unstaged revision');
    expect(await git(worktree.path, 'ls-tree', '--name-only', checkpoint.tree)).toContain('asset.bin');
    expect(await git(worktree.path, 'ls-tree', '--name-only', checkpoint.tree)).not.toContain('remove.txt');
    await writeFile(join(worktree.path, 'asset.bin'), Buffer.from([0, 42, 254]));
    expect((await service.checkpoint(worktree)).tree).not.toBe(checkpoint.tree);
  });

  it('commits the reviewed tree, updates the project checkout, and pushes the pinned commit', async () => {
    const publication = await prepare();
    const saves: TaskPublication[] = [];
    await service.publish(worktree, publication, async state => { saves.push(state); });
    expect(publication).toMatchObject({ phase: 'published', merged: true, taskCommit: publication.mergeCommit });
    expect(await git(repository, 'rev-parse', 'HEAD')).toBe(publication.mergeCommit);
    expect(await git(remote, 'rev-parse', 'refs/heads/main')).toBe(publication.mergeCommit);
    expect(await git(repository, 'rev-parse', `${publication.taskCommit}^{tree}`)).toBe(publication.plan.tree);
    expect(await readFile(join(repository, 'README.md'), 'utf8')).toBe('reviewed change\n');
    expect(await git(worktree.path, 'status', '--porcelain')).toBe('');
    expect(await git(repository, 'show-ref', '--verify', `refs/heads/${worktree.branch}`)).toContain(publication.taskCommit);
    expect(saves.find(state => state.taskCommit)?.phase).toBe('committing');
    expect(saves.find(state => state.mergeCommit)?.phase).toBe('merging');
    expect(saves.find(state => state.merged)?.phase).toBe('pushing');
  });

  it('requires a fresh review when even a new binary file changes', async () => {
    const reviewed = await service.checkpoint(worktree);
    await writeFile(join(worktree.path, 'new.bin'), Buffer.from([0, 10]));
    await expect(service.preparePublication(worktree, reviewed, 'origin', 'Message')).rejects.toThrow('after Quinn');
    expect(await git(repository, 'rev-parse', 'HEAD')).toBe(base);
  });

  it('blocks changes made after confirmation before moving any branch', async () => {
    const publication = await prepare();
    await writeFile(join(worktree.path, 'README.md'), 'unreviewed change\n');
    await expect(service.publish(worktree, publication, async () => {})).rejects.toThrow('new Quinn review');
    expect(await git(worktree.path, 'rev-parse', 'HEAD')).toBe(base);
    expect(await git(remote, 'rev-parse', 'refs/heads/main')).toBe(base);
  });

  it('preserves dirty or advanced project checkouts and rejects a changed remote destination', async () => {
    await writeFile(join(repository, 'local.txt'), 'keep local\n');
    await expect(prepare()).rejects.toThrow('uncommitted changes');
    await rm(join(repository, 'local.txt'));
    const publication = await prepare();
    await git(repository, 'remote', 'set-url', '--push', 'origin', join(folder, 'different.git'));
    await expect(service.publish(worktree, publication, async () => {})).rejects.toThrow('push destination changed');
    expect(publication.taskCommit).toBeUndefined();
    await git(repository, 'remote', 'set-url', '--push', 'origin', remote);
    await writeFile(join(repository, 'local.txt'), 'keep local\n');
    await expect(service.publish(worktree, publication, async () => {})).rejects.toThrow('checkout changed');
    await git(repository, 'add', '.'); await git(repository, 'commit', '-m', 'New source head');
    await expect(service.publish(worktree, publication, async () => {})).rejects.toThrow('checkout changed');
    expect(await readFile(join(repository, 'local.txt'), 'utf8')).toBe('keep local\n');
    expect(publication.taskCommit).toBeUndefined();
  });

  it('merges nonconflicting target commits while preserving both branches', async () => {
    await writeFile(join(repository, 'project-change.txt'), 'project update\n');
    await git(repository, 'add', '.'); await git(repository, 'commit', '-m', 'Other work');
    const target = await git(repository, 'rev-parse', 'HEAD');
    const publication = await prepare();
    await service.publish(worktree, publication, async () => {});
    expect(await git(repository, 'show', '-s', '--format=%P', 'HEAD')).toBe(`${target} ${publication.taskCommit}`);
    expect(await readFile(join(repository, 'project-change.txt'), 'utf8')).toBe('project update\n');
    expect(await readFile(join(repository, 'README.md'), 'utf8')).toBe('reviewed change\n');
    expect(await git(remote, 'rev-parse', 'refs/heads/main')).toBe(publication.mergeCommit);
  });

  it('retains Rowan’s commit and leaves the project untouched when branches conflict', async () => {
    await writeFile(join(repository, 'README.md'), 'conflicting project change\n');
    await git(repository, 'add', '.'); await git(repository, 'commit', '-m', 'Conflict');
    const target = await git(repository, 'rev-parse', 'HEAD');
    const publication = await prepare();
    await expect(service.publish(worktree, publication, async () => {})).rejects.toThrow('merge conflicts');
    expect(publication.taskCommit).toBeDefined();
    expect(await git(worktree.path, 'rev-parse', 'HEAD')).toBe(publication.taskCommit);
    expect(await git(repository, 'rev-parse', 'HEAD')).toBe(target);
    expect(await git(repository, 'status', '--porcelain')).toBe('');
    expect(await readFile(join(repository, 'README.md'), 'utf8')).toBe('conflicting project change\n');
    expect(await git(remote, 'rev-parse', 'refs/heads/main')).toBe(base);
  });

  it('retains a successful local merge after push rejection and retries without another commit', async () => {
    const hook = join(remote, 'hooks', 'update');
    await writeFile(hook, '#!/bin/sh\nexit 1\n'); await chmod(hook, 0o755);
    const publication = await prepare();
    await expect(service.publish(worktree, publication, async () => {})).rejects.toThrow('Git operation failed');
    expect(publication).toMatchObject({ phase: 'pushing', merged: true });
    expect(await git(repository, 'rev-parse', 'HEAD')).toBe(publication.mergeCommit);
    expect(await git(remote, 'rev-parse', 'refs/heads/main')).toBe(base);
    const committed = publication.taskCommit;
    // Later work must not accidentally be staged or included in a retry of the reviewed push.
    await writeFile(join(worktree.path, 'README.md'), 'later task edit\n');
    await writeFile(join(repository, 'later.txt'), 'later project work\n');
    await git(repository, 'add', '.'); await git(repository, 'commit', '-m', 'Later unreviewed work');
    const laterHead = await git(repository, 'rev-parse', 'HEAD');
    await writeFile(join(repository, 'dirty.txt'), 'leave untouched\n');
    await rm(hook);
    await service.publish(worktree, publication, async () => {});
    expect(publication.phase).toBe('published');
    expect(publication.taskCommit).toBe(committed);
    expect(await git(remote, 'rev-parse', 'refs/heads/main')).toBe(publication.mergeCommit);
    expect(await git(repository, 'rev-parse', 'HEAD')).toBe(laterHead);
    expect(await readFile(join(worktree.path, 'README.md'), 'utf8')).toBe('later task edit\n');
    expect(await git(worktree.path, 'diff', '--cached')).toBe('');
    expect(await readFile(join(repository, 'dirty.txt'), 'utf8')).toBe('leave untouched\n');
  });

  it('recovers an intended task commit persisted before the task ref moved', async () => {
    const publication = await prepare();
    let durable: TaskPublication;
    await expect(service.publish(worktree, publication, async state => {
      durable = structuredClone(state);
      if (state.taskCommit) throw new Error('Fixture crash before update-ref');
    })).rejects.toThrow('Fixture crash');
    expect(await git(worktree.path, 'rev-parse', 'HEAD')).toBe(base);
    await service.publish(worktree, durable!, async () => {});
    expect(durable!.phase).toBe('published');
  });

  it('never force-pushes over newer remote commits', async () => {
    const other = join(folder, 'other-checkout');
    await git(folder, 'clone', '--branch', 'main', remote, other);
    await git(other, 'config', 'user.email', 'fixture@example.invalid');
    await git(other, 'config', 'user.name', 'Fixture');
    await writeFile(join(other, 'remote-update.txt'), 'someone else’s remote change\n');
    await git(other, 'add', '.'); await git(other, 'commit', '-m', 'Remote update');
    await git(other, 'push', 'origin', 'main');
    const remoteHead = await git(remote, 'rev-parse', 'refs/heads/main');
    const publication = await prepare();
    await expect(service.publish(worktree, publication, async () => {})).rejects.toThrow('Git operation failed');
    expect(publication.merged).toBe(true);
    expect(await git(remote, 'rev-parse', 'refs/heads/main')).toBe(remoteHead);
    expect(await git(repository, 'rev-parse', 'HEAD')).toBe(publication.mergeCommit);
  });

  it('recovers a merge applied immediately before saving its completed state', async () => {
    const publication = await prepare();
    let durable: TaskPublication;
    await expect(service.publish(worktree, publication, async state => {
      if (state.phase === 'pushing') throw new Error('Fixture crash after merge');
      durable = structuredClone(state);
    })).rejects.toThrow('Fixture crash');
    expect(durable!.merged).toBeUndefined();
    expect(await git(repository, 'rev-parse', 'HEAD')).toBe(durable!.mergeCommit);
    expect(await git(remote, 'rev-parse', 'refs/heads/main')).toBe(base);
    await service.publish(worktree, durable!, async () => {});
    expect(durable!.phase).toBe('published');
    expect(await git(remote, 'rev-parse', 'refs/heads/main')).toBe(durable!.mergeCommit);
  });
});
