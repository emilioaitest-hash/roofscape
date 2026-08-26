import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { redactSecrets, containsSecret } from './redact.js'
import { BuildingStore } from './buildingStore.js'
import { asBuildingId } from '../domain/ids.js'

test('the shapes credentials actually have are caught', () => {
  const cases: Array<[string, string]> = [
    ['sk-ant-api03-AbCdEf1234567890XyZaBcDeFgHiJkLmNoP', 'an Anthropic key'],
    ['sk-proj-AbCdEf1234567890XyZaBcDeFgHiJk', 'an OpenAI key'],
    ['ghp_AbCdEf1234567890AbCdEf1234567890', 'a GitHub token'],
    ['github_pat_11ABCDEFG0123456789_abcdefghij', 'a GitHub token'],
    ['AKIAIOSFODNN7EXAMPLE', 'an AWS access key'],
    ['AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456', 'a Google key'],
    ['xoxb-1234567890-abcdefghij', 'a Slack token'],
    ['sk_live_ABCDEFGHIJKLMNOPQRSTUVWX', 'a Stripe key'],
  ]
  for (const [secret, what] of cases) {
    const result = redactSecrets(`the value is ${secret} here`)
    assert.equal(result.text.includes(secret), false, `${what} survived`)
    assert.match(result.text, /\[redacted/, `${what} left no marker`)
  }
})

test('a private key block is taken out whole, not line by line', () => {
  const key = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234\nabcd\n-----END RSA PRIVATE KEY-----'
  const result = redactSecrets(`here it is:\n${key}\nand that is all`)
  assert.equal(result.text.includes('MIIEowIBAAKCAQEA1234'), false)
  assert.match(result.text, /and that is all/, 'and the rest of the note survives')
})

test('a password in a connection string goes, and the rest stays readable', () => {
  // The note is still worth having: which host, which user, which database.
  const result = redactSecrets('It connects to postgres://admin:hunter2iscommon@db.internal:5432/app')
  assert.equal(result.text.includes('hunter2iscommon'), false)
  assert.match(result.text, /db\.internal:5432\/app/)
  assert.match(result.text, /admin/)
})

test('a named credential keeps its name and loses its value', () => {
  const result = redactSecrets('Set ANTHROPIC_API_KEY=abcdefghijklmnop1234 in the environment.')
  assert.equal(result.text.includes('abcdefghijklmnop1234'), false)
  assert.match(result.text, /ANTHROPIC_API_KEY=\[redacted\]/, 'so the note still says which variable')
})

test('ordinary notes are left exactly alone', () => {
  // False positives are worse than they look: a note mangled into nonsense is a
  // note that misleads on every future recall.
  const ordinary = [
    'The deploy target is Fly, not Vercel.',
    'formatSeconds pads the seconds to two digits with padStart.',
    'Nib (coder) was asked to add a farewell function. Vet accepted it.',
    'The keyboard shortcut is cmd-k and the token budget is 60000.',
    'Use the public key at id_rsa.pub for the deploy user.',
  ]
  for (const note of ordinary) {
    assert.equal(containsSecret(note), false, `mangled: ${note}`)
    assert.equal(redactSecrets(note).text, note)
  }
})

test('nothing reaches the archives with a key still in it', () => {
  // Applied at the one door into memory, so a future way of writing a note
  // cannot forget to do it.
  const dir = mkdtempSync(join(tmpdir(), 'roofscape-redact-'))
  const store = BuildingStore.open(asBuildingId('t'), join(dir, 'b.db'))
  try {
    store.remember({
      scope: 'building',
      layer: 'episodic',
      text: 'I read .env and it says ANTHROPIC_API_KEY=sk-ant-api03-RealLookingKey1234567890',
    })
    const found = store.recallByKeyword('env')
    assert.equal(found.length, 1)
    assert.equal(found[0]!.text.includes('sk-ant-api03-RealLookingKey1234567890'), false, 'the key reached the archives')
    assert.match(found[0]!.text, /redacted/)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
