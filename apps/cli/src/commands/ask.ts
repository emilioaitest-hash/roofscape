import { ask as askConcierge, pursueGoal, type BuildingId } from '@app/core'
import { openSkyline, openBuilding } from '../context.js'
import { say, dim, bold, fail, heading, amber, green } from '../ui.js'

/**
 * Ask the concierge.
 *
 * The one view nobody inside a building has: buildings deliberately share
 * nothing, so only the lobby can answer "what is going on" across all of them.
 */
export async function ask(question: string | undefined, options: { yes?: boolean }): Promise<void> {
  if (!question) {
    fail('What would you like to know?', 'roofscape ask "what is everyone working on?"')
  }

  const skyline = openSkyline()
  if (skyline.list().length === 0) {
    skyline.close()
    fail('There are no buildings to ask about yet.', 'roofscape ground "My Project" --workspace .')
  }

  say()
  say(dim(`  "${question}"`))
  process.stdout.write(dim('  '))

  const result = await askConcierge({
    question,
    credentials: skyline,
    owner: skyline.owner(),
    onTool: () => process.stdout.write(dim('·')),
    startGoal: async (building: BuildingId, goal: string) => {
      const target = skyline.get(building)
      if (!target) return `There is no building ${building}.`

      say()
      say(`  ${amber('→')} handing to ${bold(target.name)}: ${goal}`)
      const store = openBuilding(target.id)
      try {
        const outcome = await pursueGoal(
          {
            building: target, store, credentials: skyline,
            ask: async (_kind, intent) => {
              say(`  ${amber('asked')}: ${intent} ${dim(options.yes ? '(allowed by --yes)' : '(refused — nobody was asked)')}`)
              return options.yes === true
            },
            report: (line) => say(dim(`    ${line}`)),
          },
          goal,
        )
        const done = outcome.worked.filter((w) => w.review?.accepted !== false).length
        return `${target.name} finished ${done} of ${outcome.worked.length} piece(s) of work. ${outcome.managerSummary.slice(0, 300)}`
      } catch (error) {
        return `${target.name} could not take it: ${(error as Error).message}`
      } finally {
        store.close()
      }
    },
  })

  say('\n')
  heading('The concierge')
  for (const line of result.answer.split('\n')) say(`  ${line}`)
  say()
  say(dim(`  ${result.toolsUsed.length} lookup${result.toolsUsed.length === 1 ? '' : 's'} · ${result.tokensSpent.toLocaleString()} output tokens`))
  say()
  skyline.close()
}
