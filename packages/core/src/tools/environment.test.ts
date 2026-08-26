import { test } from 'node:test'
import assert from 'node:assert/strict'
import { environmentFor, carriedNames, looksLikeASecret } from './environment.js'

test('an agent command cannot see the owner\'s credentials', () => {
  // It used to see all of them. `echo $ANTHROPIC_API_KEY` returned the key, and
  // from there it is in the tool result, the transcript, the archives, and any
  // file the agent writes. An agent reading a repository is reading text
  // somebody else wrote.
  const source = {
    PATH: '/usr/bin',
    HOME: '/home/someone',
    ANTHROPIC_API_KEY: 'sk-ant-secret',
    OPENAI_API_KEY: 'sk-openai-secret',
    AWS_SECRET_ACCESS_KEY: 'aws-secret',
    GITHUB_TOKEN: 'ghp_secret',
    DATABASE_URL: 'postgres://user:password@host/db',
    STRIPE_SECRET_KEY: 'sk_live_secret',
  }
  const passed = environmentFor(source)

  for (const name of Object.keys(source)) {
    if (name === 'PATH' || name === 'HOME') continue
    assert.equal(passed[name], undefined, `${name} was passed through`)
  }
  assert.equal(passed.PATH, '/usr/bin', 'and the things it needs still are')
  assert.equal(passed.HOME, '/home/someone')
})

test('a name nobody anticipated is absent rather than present', () => {
  // The argument for an allowlist. A denylist has to guess every name a secret
  // might have and is wrong the first time somebody invents a new one.
  const passed = environmentFor({ WHATEVER_THE_NEXT_SERVICE_CALLS_IT: 'secret' })
  assert.equal(passed.WHATEVER_THE_NEXT_SERVICE_CALLS_IT, undefined)
})

test('nothing on the carried list looks like a secret', () => {
  for (const name of carriedNames()) {
    assert.equal(looksLikeASecret(name), false, `${name} is carried and looks like a credential`)
  }
})

test('commands are told not to wait for a human who is not there', () => {
  const passed = environmentFor({ PATH: '/usr/bin' })
  assert.equal(passed.GIT_TERMINAL_PROMPT, '0', 'no waiting for a password nobody will type')
  assert.equal(passed.PAGER, 'cat', 'and no pager, which is how a command hangs for ever')
  assert.equal(passed.CI, '1')
})

test('the owner can carry something extra through deliberately', () => {
  const passed = environmentFor({ PATH: '/usr/bin', MY_BUILD_FLAG: 'on' }, { alsoCarry: ['MY_BUILD_FLAG'] })
  assert.equal(passed.MY_BUILD_FLAG, 'on')
})

test('what is imposed cannot be overridden by what is inherited', () => {
  const passed = environmentFor({ PATH: '/usr/bin', GIT_TERMINAL_PROMPT: '1', CI: '0' })
  assert.equal(passed.GIT_TERMINAL_PROMPT, '0')
  assert.equal(passed.CI, '1')
})
