/**
 * What an agent's shell command is allowed to see.
 *
 * It used to be everything. `echo $ANTHROPIC_API_KEY` in a command returned the
 * owner's key, and from there it is in the tool result, in the transcript, in
 * the archives, and in any file the agent writes. An agent reading a repository
 * is reading text somebody else wrote, so "run this diagnostic command" in a
 * README is all the persuasion required.
 *
 * An allowlist, not a denylist. A denylist has to guess every name a secret
 * might have — API_KEY, TOKEN, SECRET, PASSWORD, CREDENTIALS, and whatever the
 * next service calls its own — and it is wrong the first time somebody invents
 * a new one. This way an unrecognised variable is simply absent, which is the
 * safe direction to be wrong in.
 */

/** Needed by ordinary developer tooling, and none of it a secret. */
const CARRIED = [
  // Finding and running programs at all.
  'PATH', 'SHELL', 'TMPDIR', 'TEMP', 'TMP',
  // git and npm both read config from the home directory.
  'HOME', 'USER', 'LOGNAME',
  // Output that is not mojibake.
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM',
  // Toolchains that keep their installs somewhere unusual.
  'JAVA_HOME', 'GOPATH', 'GOROOT', 'GOMODCACHE',
  'CARGO_HOME', 'RUSTUP_HOME', 'NVM_DIR', 'PYENV_ROOT', 'VIRTUAL_ENV',
  'ANDROID_HOME', 'DEVELOPER_DIR', 'SDKROOT',
  // Where npm and friends keep their caches, so a build is not slower for this.
  'npm_config_cache', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
] as const

/** Set by us, for every command. */
const IMPOSED: Record<string, string> = {
  // Never sit waiting for a password nobody will type.
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '',
  SSH_ASKPASS: '',
  // Most tools are quieter and more deterministic when they believe this.
  CI: '1',
  // Interactive pagers are how an unattended command hangs for ever.
  PAGER: 'cat',
  GIT_PAGER: 'cat',
}

export interface EnvironmentOptions {
  /** Extra names the owner has decided are safe to pass through. */
  alsoCarry?: readonly string[]
}

export function environmentFor(
  source: NodeJS.ProcessEnv = process.env,
  options: EnvironmentOptions = {},
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const name of [...CARRIED, ...(options.alsoCarry ?? [])]) {
    const value = source[name]
    if (value !== undefined) environment[name] = value
  }
  return { ...environment, ...IMPOSED }
}

/** For a test, and for anyone wanting to know what does get through. */
export const carriedNames = (): readonly string[] => CARRIED

/**
 * Does this look like something that should never have been passed?
 *
 * Only used to check our own work — the allowlist is the protection. If this
 * ever finds something, the allowlist has grown a name it should not have.
 */
export function looksLikeASecret(name: string): boolean {
  return /(^|_)(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|CREDENTIALS|AUTH|SESSION|COOKIE|PRIVATE)(_|$)/i.test(name)
}
