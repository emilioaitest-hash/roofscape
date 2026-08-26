/**
 * Make the built binaries executable.
 *
 * tsc writes plain files, so the executable bit is lost on every rebuild and the
 * `roofscape` command stops working until the next `npm install`. npm sets it
 * when it links; nothing sets it after that.
 */
import { chmod, access } from 'node:fs/promises'
import { constants } from 'node:fs'

const BINARIES = ['apps/cli/dist/main.js', 'apps/daemon/dist/main.js']

for (const path of BINARIES) {
  try {
    await access(path, constants.F_OK)
    await chmod(path, 0o755)
  } catch {
    // A package that has not been built yet is not an error here; the build
    // step that produces it will run this again.
  }
}
