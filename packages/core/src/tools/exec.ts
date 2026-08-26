import { spawn } from 'node:child_process'
import { judge } from './shell.js'
import { cap, type AgentContext } from './context.js'

export interface ExecResult {
  ok: boolean
  code: number | null
  output: string
  /** Set when the command was stopped rather than finished. */
  stopped?: 'timeout' | 'refused' | 'not-approved'
}

export interface ExecOptions {
  timeoutSeconds?: number
  cwd?: string
}

/**
 * Run a command on the agent's behalf, having first decided whether it should be
 * run at all. A command that is merely unfamiliar goes to a person; one that is
 * destructive does not, because there is no version of that question worth
 * asking at three in the morning.
 */
export async function execute(
  context: AgentContext,
  command: string,
  options: ExecOptions = {},
): Promise<ExecResult> {
  const verdict = judge(command)

  if (!verdict.allow && !verdict.escalate) {
    return { ok: false, code: null, output: verdict.reason, stopped: 'refused' }
  }

  if (!verdict.allow) {
    const granted = await context.ask('shell', `Run: ${command}`)
    if (!granted) {
      return {
        ok: false,
        code: null,
        output: `${verdict.reason} It was put to the owner and not approved.`,
        stopped: 'not-approved',
      }
    }
  }

  return run(command, options.cwd ?? context.cwd, options.timeoutSeconds ?? 120)
}

function run(command: string, cwd: string, timeoutSeconds: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let output = ''
    let settled = false
    // Stop reading long before memory is a problem: the cap applies to what the
    // agent is charged for, and everything past it is noise anyway.
    const HARD_LIMIT = 400_000
    const collect = (chunk: Buffer) => {
      if (output.length < HARD_LIMIT) output += chunk.toString()
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      resolve({
        ok: false,
        code: null,
        output: cap(`${output}\n\nStopped after ${timeoutSeconds}s.`),
        stopped: 'timeout',
      })
    }, timeoutSeconds * 1000)

    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: false, code: null, output: `Could not run it: ${error.message}` })
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const text = output.trim()
      resolve({
        ok: code === 0,
        code,
        output: cap(text === '' ? `(no output, exit ${code})` : text),
      })
    })
  })
}
