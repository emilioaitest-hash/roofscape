/**
 * Runs the test suite, and refuses to pass when it found nothing to run.
 *
 * `node --test <dir>` silently succeeds when no test file matches, which is the
 * worst possible failure: a green tick that means the opposite of what it says.
 * Discovery is done here explicitly so an empty match is an error.
 */
import { glob } from 'node:fs/promises'
import { spawn } from 'node:child_process'

// Both, because apps have tests too and a pattern that quietly excludes half
// the tree is the same failure this script exists to prevent.
const PATTERNS = ['packages/*/dist/**/*.test.js', 'apps/*/dist/**/*.test.js']

const files = []
for (const pattern of PATTERNS) {
  for await (const file of glob(pattern)) files.push(file)
}

if (files.length === 0) {
  console.error(`No test files matched ${PATTERNS.join(' or ')}.`)
  console.error('Either the build did not run, or the tests have gone missing.')
  process.exit(1)
}

console.log(`Running ${files.length} test file${files.length === 1 ? '' : 's'}.`)
const child = spawn(process.execPath, ['--test', '--test-reporter=spec', ...files], {
  stdio: 'inherit',
})
child.on('exit', (code) => process.exit(code ?? 1))
