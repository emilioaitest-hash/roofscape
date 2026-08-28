/**
 * Take a picture of a page, so a change to how the app looks can be judged by
 * looking at it rather than argued about.
 *
 *     node_modules/.bin/electron scripts/shoot.cjs <file-or-url> <out.png> [w] [h] [waitMs]
 *
 * The window is shown rather than hidden, and parked off the side of the
 * screen: a hidden window on macOS can sit forever waiting for a frame that
 * compositing never produces, and a shot that never arrives is worse than an
 * ugly one. Everything is on a hard timeout for the same reason.
 */
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const { pathToFileURL } = require('node:url')
const { resolve } = require('node:path')

const [target, out, widthArg, heightArg, waitArg] = process.argv.slice(2)

if (!target || !out) {
  process.stderr.write('usage: electron scripts/shoot.cjs <file-or-url> <out.png> [w] [h] [waitMs]\n')
  process.exit(2)
}

const width = Number(widthArg || 1440)
const height = Number(heightArg || 900)
const wait = Number(waitArg || 1200)

app.commandLine.appendSwitch('force-color-profile', 'srgb')
app.commandLine.appendSwitch('disable-gpu-vsync')

const die = (message, code) => {
  process.stderr.write(message + '\n')
  process.exitCode = code
  try { app.exit(code) } catch { process.exit(code) }
}

// Nothing here is allowed to hang the run.
const guard = setTimeout(() => die('shoot: timed out', 3), 45000)

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width,
    height,
    x: -20000,
    y: 0,
    show: true,
    frame: false,
    skipTaskbar: true,
    webPreferences: { backgroundThrottling: false, offscreen: false },
  })

  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) process.stderr.write('page: ' + message + '\n')
  })

  const url = /^https?:/.test(target) ? target : pathToFileURL(resolve(target)).href

  try {
    await win.loadURL(url)
    await win.webContents
      .executeJavaScript('document.fonts && document.fonts.ready ? document.fonts.ready.then(function(){return 1}) : 1')
      .catch(() => {})
    await new Promise((r) => setTimeout(r, wait))
    const image = await win.capturePage()
    writeFileSync(resolve(out), image.toPNG())
    process.stdout.write('Wrote ' + out + ' (' + width + 'x' + height + ')\n')
    clearTimeout(guard)
    app.exit(0)
  } catch (error) {
    clearTimeout(guard)
    die('shoot failed: ' + (error && error.message ? error.message : String(error)), 1)
  }
})
