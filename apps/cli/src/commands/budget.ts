import { describePosting } from '@app/core'
import { openSkyline, openBuilding, findBuilding } from '../context.js'
import { say, dim, bold, tick, note, fail, heading, amber, green } from '../ui.js'

/**
 * What a building may spend, and what it has.
 *
 * Output tokens rather than money, because money depends on which provider
 * answered and the number would be a guess dressed up as a fact.
 */
export function budget(options: { building?: string; monthly?: string; perTask?: string }): void {
  const skyline = openSkyline()
  const building = findBuilding(skyline, options.building)
  const store = openBuilding(building.id)

  if (options.monthly === undefined && options.perTask === undefined) {
    const spent = store.spentThisMonth()
    const allowance = building.budget.monthlyTokens

    heading(`${building.name} — spending`)
    say(`  ${bold(spent.toLocaleString())} output tokens this month`)
    if (allowance === null) {
      note('No monthly ceiling. Set one:  roofscape budget --monthly 500000')
    } else {
      const left = allowance - spent
      const bar = meter(spent, allowance)
      say(`  ${bar}  ${dim(`${Math.round((spent / allowance) * 100)}% of ${allowance.toLocaleString()}`)}`)
      if (left <= 0) say(`  ${amber('The allowance is used up. Work will not start until it is raised.')}`)
      else note(`${left.toLocaleString()} left this month.`)
    }
    say()
    say(dim(`  Any one task may spend ${building.budget.perTaskTokens.toLocaleString()}.`))
    say(dim(`  All told: ${store.spentSince('1970-01-01T00:00:00.000Z').toLocaleString()} since the ground was broken.`))
    say()
    store.close(); skyline.close()
    return
  }

  const monthly = options.monthly === undefined ? building.budget.monthlyTokens : positive(options.monthly, 'monthly')
  const perTask = options.perTask === undefined ? building.budget.perTaskTokens : positive(options.perTask, 'per-task')!

  skyline.setBudget(building.id, { monthlyTokens: monthly, perTaskTokens: perTask })
  tick(`${building.name}: ${monthly === null ? 'no monthly ceiling' : `${monthly.toLocaleString()} a month`}, ${perTask.toLocaleString()} a task.`)
  say()
  store.close()
  skyline.close()
}

/** "none" turns a ceiling off; anything unreadable is refused rather than guessed. */
function positive(text: string, what: string): number | null {
  if (text.trim().toLowerCase() === 'none') return null
  const value = Number(text.replace(/[_,]/g, ''))
  if (!Number.isFinite(value) || value <= 0) {
    fail(`"${text}" is not a ${what} allowance.`, 'Give a number of output tokens, or "none".')
  }
  return Math.round(value)
}

function meter(spent: number, allowance: number): string {
  const width = 24
  const filled = Math.min(width, Math.round((spent / allowance) * width))
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled)
  return spent >= allowance ? amber(bar) : green(bar)
}

export { describePosting }
