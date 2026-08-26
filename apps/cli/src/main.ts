#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { BRAND } from '@app/core'
import { showSkyline, showBuilding } from './commands/skyline.js'
import { breakGround, hire, setCharter } from './commands/manage.js'
import { goal, lobby, decide } from './commands/work.js'
import { doctor, providerAdd, archives, curateArchives } from './commands/setup.js'
import { post } from './commands/post.js'
import { serve } from './commands/serve.js'
import { say, dim, bold, fail, red } from './ui.js'

const HELP = `
${bold(BRAND.name)} — ${BRAND.tagline}

  ${bold('roofscape')}                          the skyline: every building, at its height

  ${bold('ground')} <name> [--workspace DIR]    break ground on a new building
  ${bold('building')} [name]                    one building in detail
  ${bold('charter')} <text> [--building B]      say what a building is for

  ${bold('hire')} [role] [--name N]             take on staff; the building grows a floor
  ${bold('post')} [who] [--provider P --model M]  who runs on what, and change it
  ${bold('goal')} <text> [--yes]                put a goal to a building and let it work

  ${bold('lobby')}                              everything waiting on your approval
  ${bold('approve')} <id> · ${bold('refuse')} <id>        decide one of them

  ${bold('archives')} [query]                   read what the building remembers
  ${bold('curate')}                             send the curator down to tidy them
  ${bold('provider')} add <name> [--env VAR]    connect a model provider
  ${bold('serve')} [--port N]                  start the service and open the dashboard
  ${bold('doctor')}                             check that everything it needs is here

${dim('Most commands take --building to say which one, when you have more than one.')}
`

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const command = argv[0]

  if (command === undefined) return showSkyline()
  if (command === 'help' || command === '--help' || command === '-h') {
    say(HELP)
    return
  }
  if (command === '--version' || command === 'version') {
    say(`${BRAND.name} 0.1.0`)
    return
  }

  const { values, positionals } = parseArgs({
    args: argv.slice(1),
    allowPositionals: true,
    strict: false,
    options: {
      building: { type: 'string', short: 'b' },
      workspace: { type: 'string', short: 'w' },
      charter: { type: 'string' },
      name: { type: 'string' },
      env: { type: 'string' },
      provider: { type: 'string', short: 'p' },
      model: { type: 'string', short: 'm' },
      engine: { type: 'string', short: 'e' },
      port: { type: 'string' },
      host: { type: 'string' },
      open: { type: 'boolean' },
      key: { type: 'string' },
      yes: { type: 'boolean', short: 'y' },
    },
  })

  const first = positionals[0] as string | undefined
  const rest = positionals.join(' ')
  const opts = values as {
    building?: string; workspace?: string; charter?: string
    name?: string; env?: string; key?: string; yes?: boolean
    provider?: string; model?: string; engine?: string
    port?: string; host?: string; open?: boolean
  }

  switch (command) {
    case 'ground':
    case 'break-ground':
      return breakGround(rest || undefined, opts)
    case 'building':
    case 'show':
      return showBuilding(first ?? opts.building)
    case 'charter':
      return setCharter(rest || undefined, opts)
    case 'hire':
      return hire(first, opts)
    case 'goal':
    case 'do':
      return goal(rest || undefined, opts)
    case 'lobby':
    case 'approvals':
      return lobby()
    case 'approve':
      return decide(first, true)
    case 'refuse':
    case 'deny':
      return decide(first, false)
    case 'archives':
    case 'memory':
      return archives(rest || undefined, opts)
    case 'provider':
    case 'providers':
      if (first === 'add' || first === undefined) {
        return providerAdd(positionals[1] as string | undefined, opts)
      }
      return providerAdd(first, opts)
    case 'post':
    case 'posting':
      return post(first, opts)
    case 'curate':
      return curateArchives(opts)
    case 'serve':
    case 'open':
      return serve({
        ...(opts.port ? { port: opts.port } : {}),
        ...(opts.host ? { host: opts.host } : {}),
        // parseArgs has no notion of --no-x, and a headless start is exactly
        // what you want on a server. Read it literally.
        open: !argv.includes('--no-open'),
      })
    case 'doctor':
    case 'check':
      return doctor()
    default:
      fail(`No command called "${command}".`, 'Run  roofscape help  to see what there is.')
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  say()
  say(red(message))
  say()
  process.exitCode = 1
})
