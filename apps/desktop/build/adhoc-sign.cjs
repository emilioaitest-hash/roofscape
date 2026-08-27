const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

/**
 * Give the macOS app a signature of its own.
 *
 * Without this it keeps the signature the Electron binary was shipped with:
 * identifier "Electron", no sealed resources, and a seal that does not describe
 * the bundle it is now inside. macOS does not read that as unsigned — it reads
 * it as *broken*, and says the app is damaged and should be moved to the Trash.
 * On Apple silicon that is a dead end, because there is no "open anyway" for an
 * app whose signature is incoherent.
 *
 * An ad-hoc signature is not a trusted one. It does not stop Gatekeeper asking
 * whether the developer can be verified — that needs a Developer ID, and so
 * does auto-update on macOS. What it does is make the refusal an honest and
 * bypassable one instead of a lie about corruption.
 */
exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return

  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)

  // A real certificate, when there is one, is applied by electron-builder
  // itself; re-signing over it here would throw the real signature away.
  if (process.env.CSC_LINK || process.env.CSC_NAME) return

  // Nested code has to be sealed before the bundle that contains it, or the
  // outer seal describes contents that then change underneath it.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--strict', app], { stdio: 'inherit' })

  process.stdout.write(`  • ad-hoc signed ${app}\n`)
}
