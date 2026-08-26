import { realpathSync, existsSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, dirname } from 'node:path'

export class OutsideWorkspaceError extends Error {
  constructor(readonly attempted: string, readonly workspace: string) {
    super(`Refused: ${attempted} is outside this building's workspace (${workspace}).`)
    this.name = 'OutsideWorkspaceError'
  }
}

/**
 * A building may touch its own workspace and nothing above it.
 *
 * Resolution goes through realpath so that a symlink pointing out of the
 * workspace is refused rather than followed — checking the string alone would
 * let `link -> /` through on the first try.
 */
export class Workspace {
  readonly root: string

  constructor(root: string) {
    if (!isAbsolute(root)) throw new Error(`A workspace must be an absolute path, got "${root}"`)
    this.root = existsSync(root) ? realpathSync(root) : resolve(root)
  }

  /** Absolute path for a workspace-relative one, or throw. */
  resolve(path: string): string {
    const absolute = isAbsolute(path) ? path : join(this.root, path)
    const settled = this.settle(absolute)
    if (!this.contains(settled)) throw new OutsideWorkspaceError(path, this.root)
    return settled
  }

  /**
   * Follow symlinks as far as the filesystem actually goes. A path that does
   * not exist yet is resolved through its nearest existing ancestor, so writing
   * a new file inside a symlinked-away directory is still caught.
   */
  private settle(absolute: string): string {
    if (existsSync(absolute)) return realpathSync(absolute)
    let parent = dirname(absolute)
    const tail: string[] = [absolute.slice(parent.length + 1)]
    while (!existsSync(parent) && parent !== dirname(parent)) {
      tail.unshift(parent.slice(dirname(parent).length + 1))
      parent = dirname(parent)
    }
    return existsSync(parent) ? join(realpathSync(parent), ...tail) : absolute
  }

  contains(absolute: string): boolean {
    const rel = relative(this.root, absolute)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  }

  /** For display: paths shown to an agent are relative, so prompts stay short. */
  display(absolute: string): string {
    const rel = relative(this.root, absolute)
    return rel === '' ? '.' : rel
  }
}
