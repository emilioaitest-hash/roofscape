/**
 * Ask the running page a question and print what it says.
 *
 *     node_modules/.bin/electron scripts/probe.cjs <url> <waitMs> <js…>
 *
 * The js is evaluated in the page and its value printed as JSON. Screenshots
 * answer "does it look right"; this answers "is it actually there" — which is a
 * different question, and the one that catches a button wired to nothing.
 */
const { app, BrowserWindow } = require('electron')

const [target, waitArg, ...jsParts] = process.argv.slice(2)
const wait = Number(waitArg || 1200)
const js = jsParts.join(' ')

if (!target || !js) {
  process.stderr.write('usage: electron scripts/probe.cjs <url> <waitMs> <js…>\n')
  process.exit(2)
}

app.commandLine.appendSwitch('force-color-profile', 'srgb')

const guard = setTimeout(() => {
  process.stderr.write('probe: timed out\n')
  app.exit(3)
}, 45000)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1400, height: 900, x: -20000, y: 0, show: true, frame: false })
  try {
    await win.loadURL(target)
    await new Promise((r) => setTimeout(r, wait))
    const value = await win.webContents.executeJavaScript(js, true)
    process.stdout.write(JSON.stringify(value, null, 2) + '\n')
    clearTimeout(guard)
    app.exit(0)
  } catch (error) {
    process.stderr.write('probe failed: ' + (error && error.message ? error.message : String(error)) + '\n')
    clearTimeout(guard)
    app.exit(1)
  }
})
