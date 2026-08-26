import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const run = promisify(execFile)

export interface GitResult {
  ok: boolean
  output: string
}

async function git(cwd: string, args: readonly string[]): Promise<GitResult> {
  try {
    const { stdout, stderr } = await run('git', [...args], {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      maxBuffer: 20 * 1024 * 1024,
    })
    return { ok: true, output: (stdout + stderr).trim() }
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message: string }
    return { ok: false, output: (e.stdout ?? '') + (e.stderr ?? '') || e.message }
  }
}

export const isRepo = (dir: string): boolean => existsSync(join(dir, '.git'))

export async function defaultBranch(repo: string): Promise<string> {
  const named = await git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  return named.ok && named.output ? named.output : 'main'
}

/**
 * Give an agent its own worktree.
 *
 * Code work never happens in the checkout the owner has open. A worktree is a
 * real directory on its own branch, so a half-finished change cannot disturb
 * anything, and abandoning it is a delete rather than a revert.
 */
export async function openWorktree(
  repo: string,
  branch: string,
  path: string,
): Promise<{ ok: true; path: string; branch: string } | { ok: false; reason: string }> {
  if (!isRepo(repo)) return { ok: false, reason: `${repo} is not a git repository.` }

  const base = await defaultBranch(repo)
  const created = await git(repo, ['worktree', 'add', '-b', branch, path, base])
  if (created.ok) return { ok: true, path, branch }

  // A branch of that name already exists: attach to it rather than failing, so
  // a retried task resumes where it left off.
  const attached = await git(repo, ['worktree', 'add', path, branch])
  return attached.ok ? { ok: true, path, branch } : { ok: false, reason: created.output }
}

export async function closeWorktree(repo: string, path: string, options: { keepBranch?: boolean } = {}): Promise<void> {
  await git(repo, ['worktree', 'remove', '--force', path])
  if (!options.keepBranch) await git(repo, ['worktree', 'prune'])
}

/** What the agent actually changed, for the reviewer to read. */
export async function summariseWork(worktree: string, base: string): Promise<{ files: string[]; diffstat: string; commits: string[] }> {
  const status = await git(worktree, ['status', '--porcelain'])
  const stat = await git(worktree, ['diff', '--stat', base])
  const log = await git(worktree, ['log', '--oneline', `${base}..HEAD`])
  return {
    files: status.output.split('\n').map((l) => l.trim()).filter(Boolean),
    diffstat: stat.output,
    commits: log.output.split('\n').filter(Boolean),
  }
}

export async function fullDiff(worktree: string, base: string): Promise<string> {
  const staged = await git(worktree, ['add', '-A'])
  if (!staged.ok) return staged.output
  const diff = await git(worktree, ['diff', '--cached', base])
  return diff.output
}

export async function commitAll(worktree: string, message: string): Promise<GitResult> {
  await git(worktree, ['add', '-A'])
  const status = await git(worktree, ['status', '--porcelain'])
  if (status.output.trim() === '') return { ok: false, output: 'Nothing to commit.' }
  return git(worktree, ['commit', '-m', message])
}

export const hasUncommitted = async (worktree: string): Promise<boolean> =>
  (await git(worktree, ['status', '--porcelain'])).output.trim() !== ''
