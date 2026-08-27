import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkylineStore } from '../store/skylineStore.js'
import { readBridgeConfig, writeBridgeConfig, describeToken } from './config.js'

function scratch(): { sky: SkylineStore; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'roofscape-bridge-'))
  const sky = SkylineStore.open(join(dir, 'skyline.db'))
  return {
    sky,
    cleanup: () => {
      sky.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

const SECRET = 'MTIzNDU2Nzg5MDEyMzQ1Njc4.GhIjKl.REAL_BOT_TOKEN_abcdefghijklmnop'

test('a stored bot token is never handed back in full', () => {
  const { sky, cleanup } = scratch()
  try {
    writeBridgeConfig(sky, { token: SECRET, tokenKind: 'literal' })
    const described = describeToken(readBridgeConfig(sky))

    assert.ok(!described.includes(SECRET), 'the whole token came back')
    assert.ok(!described.includes('REAL_BOT_TOKEN'), 'a recognisable part of the token came back')
    assert.match(described, /mnop$/, 'but enough to tell which one is set')
  } finally {
    cleanup()
  }
})

test('changing how the token is stored does not reinterpret the old one', () => {
  // Flipping the kind on its own used to leave the literal secret in place and
  // start reading it as the *name* of an environment variable — which the
  // description then printed in full, straight back to a screen.
  const { sky, cleanup } = scratch()
  try {
    writeBridgeConfig(sky, { token: SECRET, tokenKind: 'literal' })
    const after = writeBridgeConfig(sky, { tokenKind: 'env' })

    assert.equal(after.token, null, 'the old secret survived the change')
    assert.equal(after.tokenKind, 'none')
    const described = describeToken(after)
    assert.ok(!described.includes('REAL_BOT_TOKEN'), `the secret leaked into: ${described}`)
    assert.equal(described, 'not set')
  } finally {
    cleanup()
  }
})

test('nobody may set a building working from Discord until somebody is named', () => {
  // Starting a goal spends the owner's budget and hands a coder a shell in
  // their workspace. A channel is a room other people can be in, so being
  // present in it is not authority.
  const { sky, cleanup } = scratch()
  try {
    assert.deepEqual(readBridgeConfig(sky).allowedAuthors, [], 'the default is nobody, not everybody')

    const set = writeBridgeConfig(sky, { allowedAuthors: ['123456789012345678'] })
    assert.deepEqual(set.allowedAuthors, ['123456789012345678'])
  } finally {
    cleanup()
  }
})

test('an unreadable allowlist means nobody rather than everybody', () => {
  const { sky, cleanup } = scratch()
  try {
    // As a hand-edited settings row, or a half-written file, would leave it.
    sky.setSetting('discord.allowedAuthors', '{ not json')
    assert.deepEqual(readBridgeConfig(sky).allowedAuthors, [])

    sky.setSetting('discord.allowedAuthors', '"a string, not a list"')
    assert.deepEqual(readBridgeConfig(sky).allowedAuthors, [])
  } finally {
    cleanup()
  }
})

test('the bridge is off until it has both a token and somewhere to put the post', () => {
  const { sky, cleanup } = scratch()
  try {
    const bare = readBridgeConfig(sky)
    assert.equal(bare.token, null)
    assert.deepEqual(bare.channels, {})
    assert.equal(bare.mirrorAll, false, 'a phone that buzzes for every task message gets turned off')

    const wired = writeBridgeConfig(sky, { token: SECRET, channels: { foundry: '999' } })
    assert.equal(wired.token, SECRET, 'it is readable by the daemon that needs it')
    assert.deepEqual(wired.channels, { foundry: '999' })
  } finally {
    cleanup()
  }
})

test('a token kept in the environment is read from there, and named without its value', () => {
  const { sky, cleanup } = scratch()
  const had = process.env.ROOFSCAPE_TEST_DISCORD
  try {
    process.env.ROOFSCAPE_TEST_DISCORD = SECRET
    const config = writeBridgeConfig(sky, { token: 'ROOFSCAPE_TEST_DISCORD', tokenKind: 'env' })

    assert.equal(config.token, SECRET, 'the daemon can use it')
    assert.equal(describeToken(config), 'read from $ROOFSCAPE_TEST_DISCORD', 'and a screen only learns where it lives')

    delete process.env.ROOFSCAPE_TEST_DISCORD
    assert.equal(readBridgeConfig(sky).token, null, 'an unset variable is not a token')
  } finally {
    if (had === undefined) delete process.env.ROOFSCAPE_TEST_DISCORD
    else process.env.ROOFSCAPE_TEST_DISCORD = had
    cleanup()
  }
})
