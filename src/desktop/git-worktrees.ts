import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { PublicationPlan, PublicationTargets, ReviewCheckpoint, TaskPublication, RepositoryInfo, WorktreeInfo, WorktreeInspection } from '../shared/types';

const execute = promisify(execFile);
const MAX_DIFF_BYTES = 256 * 1024;
const MAX_METADATA_BYTES = 128 * 1024;
const MAX_UNTRACKED_BYTES = 64 * 1024;
const MAX_FILES = 300;

interface GitOutput { stdout: string; truncated: boolean }
interface WorktreeRecord { path: string; branch: string | null }
class GitOperationError extends Error {
  constructor(detail: string, readonly code: string | number | undefined) { super(`Git operation failed: ${detail}`); }
}

function validPath(value: unknown): value is string {
  return typeof value === 'string' && isAbsolute(value) && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value);
}

function within(parent: string, child: string): boolean {
  const difference = relative(parent, child);
  return difference !== '' && !isAbsolute(difference) && difference !== '..' && !difference.startsWith(`..${sep}`);
}

function bounded(value: string, limit: number): GitOutput {
  const encoded = Buffer.from(value, 'utf8');
  return encoded.length <= limit ? { stdout: value, truncated: false }
    : { stdout: new TextDecoder('utf-8').decode(encoded.subarray(0, limit), { stream: true }), truncated: true };
}

function omitForcedBinaryDiffs(value: string): string {
  // A .gitattributes rule can force Git to treat a binary file as text.
  // Keep the review readable even when Git's automatic binary detection is overridden.
  return value.split(/(?=^diff --git )/m).map(block => block.includes('\0')
    ? `${block.split('\n')[0]}\n[Binary file omitted.]\n` : block).join('');
}

function gitEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  // Repository selection must not inherit an unrelated Git directory or injected config.
  for (const key of Object.keys(environment)) if (key.startsWith('GIT_')) delete environment[key];
  environment.GIT_TERMINAL_PROMPT = '0';
  return environment;
}

async function git(cwd: string, args: string[], limit = MAX_METADATA_BYTES, allowTruncation = false, indexFile?: string): Promise<GitOutput> {
  try {
    const result = await execute('git', [
      '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
      '-c', 'color.ui=false', ...args,
    ], { cwd, shell: false, windowsHide: true, encoding: 'utf8', timeout: 20_000,
      maxBuffer: limit, env: { ...gitEnvironment(), ...(indexFile ? { GIT_INDEX_FILE: indexFile } : {}) } });
    return bounded(result.stdout, limit);
  } catch (cause) {
    const error = cause as Error & { code?: string | number; stdout?: string; stderr?: string };
    if (allowTruncation && error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      return { stdout: bounded(error.stdout ?? '', limit).stdout, truncated: true };
    }
    const detail = bounded(error.stderr?.trim() || error.message, 1000).stdout.replace(/(?:https?|ssh|git):\/\/[^\s'"]+/g, address => {
      try { const url = new URL(address); return `${url.protocol}//${url.host}/[repository]`; } catch { return '[Git remote]'; }
    });
    throw new GitOperationError(detail, error.code);
  }
}

function worktreeRecords(output: string): WorktreeRecord[] {
  return output.split('\0\0').filter(Boolean).map(record => {
    const fields = record.split('\0');
    return {
      path: fields.find(field => field.startsWith('worktree '))?.slice('worktree '.length) ?? '',
      branch: fields.find(field => field.startsWith('branch '))?.slice('branch refs/heads/'.length) ?? null,
    };
  });
}

/** Local Git operations only. Task worktrees and their branches are retained for review. */
export class GitWorktreeService {
  private readonly configuredRoot: string;

  constructor(root: string) {
    if (!validPath(root) || resolve(root) === parse(root).root) throw new Error('Worktrees require an absolute, non-root storage folder.');
    this.configuredRoot = resolve(root);
  }

  async inspectRepository(selectedPath: string): Promise<RepositoryInfo> {
    if (!validPath(selectedPath)) throw new Error('Choose an absolute local repository folder.');
    const folder = await realpath(selectedPath);
    if (!(await lstat(folder)).isDirectory()) throw new Error('Choose a local Git repository folder.');
    const repositoryPath = (await git(folder, ['rev-parse', '--show-toplevel'])).stdout.trim();
    if (!validPath(repositoryPath)) throw new Error('The selected folder does not have a supported Git repository root.');
    const canonicalPath = await realpath(repositoryPath);
    let head: string;
    try {
      head = (await git(canonicalPath, ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'])).stdout.trim();
    } catch {
      throw new Error('This repository needs at least one committed revision before a task worktree can be created.');
    }
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head)) throw new Error('The repository HEAD is not a supported commit.');
    const branch = (await git(canonicalPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
    const status = await git(canonicalPath, ['status', '--porcelain=v1', '-z'], MAX_METADATA_BYTES, true);
    return { path: canonicalPath, branch: branch === 'HEAD' ? 'Detached HEAD' : branch, head,
      dirty: status.truncated || status.stdout.length > 0 };
  }

  async create(repositoryPath: string, taskId: string): Promise<WorktreeInfo> {
    if (typeof taskId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(taskId)) {
      throw new Error('A safe task ID is required to create a worktree.');
    }
    const repository = await this.inspectRepository(repositoryPath);
    const root = await this.root(true);
    const unique = randomUUID();
    const branch = `agentic/${taskId}-${unique}`;
    const path = join(root, `${taskId}-${unique}`);
    // Only committed HEAD is copied. Dirty source files remain in the selected repository.
    await git(repository.path, ['worktree', 'add', '-b', branch, '--', path, repository.head]);
    const result = { path, branch, repositoryPath: repository.path, baseCommit: repository.head, createdAt: new Date().toISOString() };
    await this.validateWorktree(result);
    return result;
  }

  async inspect(worktree: WorktreeInfo): Promise<WorktreeInspection> {
    const path = await this.validateWorktree(worktree);
    const status = await git(path, ['status', '--short', '--untracked-files=all'], MAX_METADATA_BYTES, true);
    const trackedFiles = await git(path, ['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', worktree.baseCommit, '--'], MAX_METADATA_BYTES, true);
    const untrackedFiles = await git(path, ['ls-files', '--others', '--exclude-standard', '-z'], MAX_METADATA_BYTES, true);
    const trackedDiff = await git(path, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3', worktree.baseCommit, '--'], MAX_DIFF_BYTES, true);
    let truncated = status.truncated || trackedFiles.truncated || untrackedFiles.truncated || trackedDiff.truncated;
    const splitPaths = (value: GitOutput): string[] => {
      const parts = value.stdout.split('\0');
      // A truncated filename is not safe to inspect as if it were a complete path.
      if (value.truncated && !value.stdout.endsWith('\0')) parts.pop();
      return parts.filter(Boolean);
    };
    const untracked = splitPaths(untrackedFiles);
    const allFiles = [...new Set([...splitPaths(trackedFiles), ...untracked])];
    if (allFiles.length > MAX_FILES) truncated = true;
    const files = allFiles.slice(0, MAX_FILES);
    let diff = omitForcedBinaryDiffs(trackedDiff.stdout);
    for (const file of untracked) {
      if (Buffer.byteLength(diff) >= MAX_DIFF_BYTES || !files.includes(file)) { truncated = true; break; }
      const untrackedDiff = await this.untrackedDiff(path, file);
      const result = bounded(diff + untrackedDiff.stdout, MAX_DIFF_BYTES);
      diff = result.stdout;
      truncated ||= result.truncated || untrackedDiff.truncated;
    }
    if (truncated) diff = bounded(`${diff}\n[Review output truncated; inspect the retained worktree for the full changes.]\n`, MAX_DIFF_BYTES).stdout;
    return { status: status.stdout.trimEnd(), diff, files, truncated };
  }

  /** A full Git tree, including binary/new files, without changing the real index. */
  async checkpoint(worktree: WorktreeInfo): Promise<ReviewCheckpoint> {
    const path = await this.validateWorktree(worktree);
    const head = (await git(path, ['rev-parse', 'HEAD'])).stdout.trim();
    const temporary = await mkdtemp(join(tmpdir(), 'agentic-review-index-'));
    try {
      const index = join(temporary, 'index');
      await git(path, ['read-tree', head], MAX_METADATA_BYTES, false, index);
      await git(path, ['add', '--all', '--', '.'], MAX_METADATA_BYTES, false, index);
      const tree = (await git(path, ['write-tree'], MAX_METADATA_BYTES, false, index)).stdout.trim();
      if ((await git(path, ['rev-parse', 'HEAD'])).stdout.trim() !== head) throw new Error('The task branch changed while taking the review checkpoint.');
      return { tree, head };
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }

  async publicationTargets(worktree: WorktreeInfo): Promise<PublicationTargets> {
    await this.validateWorktree(worktree);
    const repository = await this.inspectRepository(worktree.repositoryPath);
    if (repository.branch === 'Detached HEAD') throw new Error('Check out the branch you want Mira to merge into in the project folder.');
    if (repository.branch === worktree.branch) throw new Error('Choose the project checkout, rather than the task branch, as the merge destination.');
    const remotes = (await git(repository.path, ['remote'])).stdout.trim().split('\n').filter(Boolean);
    return { targetBranch: repository.branch, remotes };
  }

  async preparePublication(worktree: WorktreeInfo, reviewed: ReviewCheckpoint, remote: string, commitMessage: string): Promise<PublicationPlan> {
    const current = await this.checkpoint(worktree);
    if (current.tree !== reviewed.tree || current.head !== reviewed.head) throw new Error('Rowan’s changes moved after Quinn’s review. Ask Quinn to review them again.');
    const targets = await this.publicationTargets(worktree);
    if (!targets.remotes.includes(remote) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(remote)) throw new Error('Choose an existing Git remote.');
    if (typeof commitMessage !== 'string' || !commitMessage.trim() || commitMessage.length > 500 || commitMessage.includes('\0')) throw new Error('Enter a commit message of 1–500 characters.');
    const repository = await this.inspectRepository(worktree.repositoryPath);
    if (repository.dirty) throw new Error('The project checkout has uncommitted changes. Commit or stash them yourself before Mira merges; the app will preserve them.');
    await git(repository.path, ['check-ref-format', `refs/heads/${targets.targetBranch}`]);
    return { id: `publication-${randomUUID()}`, taskBranch: worktree.branch, taskHead: reviewed.head, tree: reviewed.tree,
      targetBranch: targets.targetBranch, targetHead: repository.head, remote, remoteFingerprint: await this.remoteFingerprint(repository.path, remote), commitMessage: commitMessage.trim() };
  }

  /** Pin every commit before moving refs. Failed push/merge is explicitly retryable. */
  async publish(worktree: WorktreeInfo, publication: TaskPublication, save: (record: TaskPublication) => Promise<void>): Promise<void> {
    const plan = publication.plan;
    const path = await this.validateWorktree(worktree);
    if (plan.taskBranch !== worktree.branch || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(plan.tree)) throw new Error('The publication plan does not belong to this task.');
    const targets = await this.publicationTargets(worktree);
    if (targets.targetBranch !== plan.targetBranch || !targets.remotes.includes(plan.remote)) throw new Error('The destination branch or remote changed. Prepare a new confirmation with Mira.');
    if (await this.remoteFingerprint(worktree.repositoryPath, plan.remote) !== plan.remoteFingerprint) throw new Error('The Git remote’s push destination changed since confirmation. Restore its configuration or prepare a new handoff with Mira.');
    const repository = await this.inspectRepository(worktree.repositoryPath);
    // Recover a merge which completed immediately before the final durable save.
    let mergeAlreadyApplied = publication.mergeCommit && repository.head === publication.mergeCommit;
    if (publication.merged && publication.mergeCommit && !mergeAlreadyApplied) {
      try { await git(repository.path, ['merge-base', '--is-ancestor', publication.mergeCommit, repository.head]); mergeAlreadyApplied = true; }
      catch { throw new Error('The project branch no longer contains the retained merge. Restore it before retrying the confirmed push.'); }
    }
    if (mergeAlreadyApplied) {
      // Retry only the pinned push, without staging or touching newer edits in either checkout.
      if (!publication.taskCommit || (await git(path, ['rev-parse', `${publication.taskCommit}^{tree}`])).stdout.trim() !== plan.tree) throw new Error('The retained commit no longer matches Quinn’s review.');
      await git(path, ['merge-base', '--is-ancestor', publication.taskCommit, publication.mergeCommit!]);
      await this.pushCommit(repository.path, publication, save); return;
    }
    const checkpoint = await this.checkpoint(worktree);
    if (checkpoint.tree !== plan.tree || ![plan.taskHead, publication.taskCommit].includes(checkpoint.head)) throw new Error('The reviewed worktree changed. A new Quinn review is required.');
    if (repository.dirty || repository.head !== plan.targetHead) throw new Error('The project checkout changed since confirmation. Mira stopped; existing changes were preserved.');
    if (!publication.taskCommit) {
      publication.phase = 'committing'; await save(structuredClone(publication));
      const headTree = (await git(path, ['rev-parse', `${plan.taskHead}^{tree}`])).stdout.trim();
      publication.taskCommit = headTree === plan.tree ? plan.taskHead
        : (await git(path, ['commit-tree', plan.tree, '-p', plan.taskHead, '-m', plan.commitMessage])).stdout.trim();
      await save(structuredClone(publication)); // Intent survives a crash before update-ref.
    }
    if (checkpoint.head !== publication.taskCommit) await git(path, ['update-ref', `refs/heads/${worktree.branch}`, publication.taskCommit, plan.taskHead]);
    // Index only: never reset or overwrite the worktree's file contents.
    await git(path, ['read-tree', publication.taskCommit]);
    if ((await this.checkpoint(worktree)).tree !== plan.tree) throw new Error('Files changed during publication. The commit is retained; ask Quinn to review the new changes.');
    if (!publication.mergeCommit) {
      publication.phase = 'merging'; await save(structuredClone(publication));
      const fastForward = await git(path, ['merge-base', plan.targetHead, publication.taskCommit]);
      if (fastForward.stdout.trim() === plan.targetHead) publication.mergeCommit = publication.taskCommit;
      else {
        // Compute conflicts outside the main checkout. A conflict cannot leave it half-merged.
        let tree: string;
        try { tree = (await git(path, ['merge-tree', '--write-tree', plan.targetHead, publication.taskCommit])).stdout.trim().split('\n')[0]; }
        catch (cause) {
          if (!(cause instanceof GitOperationError) || cause.code !== 1) throw new Error(`Could not prepare the merge. Git 2.38 or newer is required. ${cause instanceof Error ? cause.message : ''}`);
          throw new Error('The branches have merge conflicts. Rowan’s commit is retained and the project checkout was not changed. Resolve the task branch, then ask Quinn for a new review.');
        }
        publication.mergeCommit = (await git(path, ['commit-tree', tree, '-p', plan.targetHead, '-p', publication.taskCommit, '-m', `Merge reviewed task: ${plan.commitMessage}`])).stdout.trim();
      }
      await save(structuredClone(publication));
    }
    const latest = await this.inspectRepository(worktree.repositoryPath);
    if (latest.dirty || latest.head !== plan.targetHead || latest.branch !== plan.targetBranch) throw new Error('The project checkout changed before the merge. Existing files were preserved.');
    await git(repository.path, ['merge', '--ff-only', '--no-edit', publication.mergeCommit]);
    await this.pushCommit(repository.path, publication, save);
  }

  private async pushCommit(repositoryPath: string, publication: TaskPublication, save: (record: TaskPublication) => Promise<void>): Promise<void> {
    const plan = publication.plan;
    publication.merged = true; publication.phase = 'pushing'; await save(structuredClone(publication));
    // Push the reviewed, immutable commit; never force and never push arbitrary HEAD.
    if (await this.remoteFingerprint(repositoryPath, plan.remote) !== plan.remoteFingerprint) throw new Error('The remote changed before push. The local merge is retained; restore the confirmed remote before retrying.');
    await git(repositoryPath, ['push', '--porcelain', plan.remote, `${publication.mergeCommit}:refs/heads/${plan.targetBranch}`]);
    publication.phase = 'published'; publication.publishedAt = new Date().toISOString(); publication.error = undefined;
    await save(structuredClone(publication));
  }

  private async remoteFingerprint(path: string, remote: string): Promise<string> {
    // Bind confirmation to every push URL without putting URLs or embedded credentials in state.
    const urls = (await git(path, ['remote', 'get-url', '--push', '--all', remote])).stdout;
    return createHash('sha256').update(urls).digest('hex');
  }

  private async root(create: boolean): Promise<string> {
    if (create) await mkdir(this.configuredRoot, { recursive: true, mode: 0o700 });
    const metadata = await lstat(this.configuredRoot);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('The worktree storage folder must be a real directory, not a symlink.');
    return realpath(this.configuredRoot);
  }

  private async validateWorktree(worktree: WorktreeInfo): Promise<string> {
    if (!worktree || !validPath(worktree.path) || !validPath(worktree.repositoryPath)
      || typeof worktree.branch !== 'string' || !/^agentic\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}-[a-f0-9-]{36}$/.test(worktree.branch)
      || typeof worktree.baseCommit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(worktree.baseCommit)) {
      throw new Error('The task worktree metadata is invalid.');
    }
    const root = await this.root(false);
    const path = resolve(worktree.path);
    if (!within(root, path) || dirname(path) !== root) throw new Error('This worktree is outside the managed worktree folder.');
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path) {
      throw new Error('The task worktree must be a real managed directory, not a symlink.');
    }
    const repository = await this.inspectRepository(worktree.repositoryPath);
    const records = worktreeRecords((await git(repository.path, ['worktree', 'list', '--porcelain', '-z'])).stdout);
    const registered = records.find(record => record.path && resolve(record.path) === path);
    if (!registered || registered.branch !== worktree.branch) throw new Error('This task worktree is not registered to its selected repository and branch.');
    const actualRoot = await realpath((await git(path, ['rev-parse', '--show-toplevel'])).stdout.trim());
    if (actualRoot !== path) throw new Error('The managed folder is not the root of its registered worktree.');
    const repositoryCommonDirectory = await realpath((await git(repository.path, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).stdout.trim());
    const worktreeCommonDirectory = await realpath((await git(path, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).stdout.trim());
    if (repositoryCommonDirectory !== worktreeCommonDirectory) throw new Error('The task worktree belongs to a different Git repository.');
    const actualBase = (await git(path, ['rev-parse', '--verify', '--end-of-options', `${worktree.baseCommit}^{commit}`])).stdout.trim();
    if (actualBase !== worktree.baseCommit) throw new Error('The task worktree base revision is unavailable.');
    return path;
  }

  private async untrackedDiff(worktreePath: string, file: string): Promise<GitOutput> {
    const heading = `\ndiff --git ${JSON.stringify(`a/${file}`)} ${JSON.stringify(`b/${file}`)}\nnew untracked file\n`;
    const path = resolve(worktreePath, file);
    if (!within(worktreePath, path)) return { stdout: `${heading}[Unsafe file path omitted.]\n`, truncated: false };
    try {
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) return { stdout: `${heading}[Symlink omitted; target was not read.]\n`, truncated: false };
      if (!metadata.isFile() || await realpath(path) !== path) return { stdout: `${heading}[Non-regular file omitted.]\n`, truncated: false };
      if (metadata.size > MAX_UNTRACKED_BYTES) return { stdout: `${heading}[Large untracked file omitted; review it in the worktree.]\n`, truncated: true };
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const openedMetadata = await handle.stat();
        if (!openedMetadata.isFile() || openedMetadata.size > MAX_UNTRACKED_BYTES) return { stdout: `${heading}[Changed or large file omitted.]\n`, truncated: true };
        const buffer = Buffer.alloc(MAX_UNTRACKED_BYTES + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const bytes = buffer.subarray(0, bytesRead);
        if (bytesRead > MAX_UNTRACKED_BYTES) return { stdout: `${heading}[Large untracked file omitted.]\n`, truncated: true };
        let text: string;
        try {
          if (bytes.includes(0)) throw new Error('Binary file');
          text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch { return { stdout: `${heading}[Binary file omitted.]\n`, truncated: false }; }
        const lines = text.split('\n');
        if (text.endsWith('\n')) lines.pop();
        if (text === '') lines.length = 0;
        const hunk = `--- /dev/null\n+++ ${JSON.stringify(`b/${file}`)}\n@@ -0,0 +1,${lines.length} @@\n`;
        return { stdout: `${heading}${hunk}${lines.map(line => `+${line}`).join('\n')}${lines.length ? '\n' : ''}${text && !text.endsWith('\n') ? '\\ No newline at end of file\n' : ''}`, truncated: false };
      } finally { await handle.close(); }
    } catch {
      return { stdout: `${heading}[File unavailable or unsafe to read; inspect the worktree directly.]\n`, truncated: true };
    }
  }
}
