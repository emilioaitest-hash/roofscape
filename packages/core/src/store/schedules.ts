import type { BuildingId } from '../domain/ids.js'

export interface Schedule {
  id: string
  building: BuildingId
  goal: string
  /** How often, in minutes. */
  everyMinutes: number
  /** "HH:MM" when the work belongs to a time of day rather than an interval. */
  atTime: string | null
  enabled: boolean
  lastRunAt: string | null
  nextRunAt: string
  createdAt: string
}

/**
 * How often, written the way a person says it: `30m`, `4h`, `daily`, `weekly`.
 * Returns minutes, or null when it is not something we understand — which is
 * better than guessing, because a schedule that runs at the wrong interval is
 * worse than one that was refused.
 */
export function parseEvery(text: string): number | null {
  const cleaned = text.trim().toLowerCase()
  const named: Record<string, number> = {
    hourly: 60,
    daily: 60 * 24,
    weekly: 60 * 24 * 7,
    weekday: 60 * 24,
  }
  if (named[cleaned]) return named[cleaned]!

  const match = /^(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|weeks?)$/.exec(cleaned)
  if (!match) return null
  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) return null

  const unit = match[2]!
  if (unit.startsWith('m')) return amount
  if (unit.startsWith('h')) return amount * 60
  if (unit.startsWith('d')) return amount * 60 * 24
  return amount * 60 * 24 * 7
}

/** "09:00" → minutes past midnight, or null if it is not a time. */
export function parseAtTime(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/**
 * When this should next run.
 *
 * With a time of day, the next occurrence of that time — never the one that has
 * just gone, because a schedule created at ten past nine should not immediately
 * fire yesterday's nine o'clock.
 */
export function nextRun(from: Date, everyMinutes: number, atTime: string | null): Date {
  if (atTime === null) return new Date(from.getTime() + everyMinutes * 60_000)

  const target = parseAtTime(atTime)
  if (target === null) return new Date(from.getTime() + everyMinutes * 60_000)

  const next = new Date(from)
  next.setSeconds(0, 0)
  next.setHours(Math.floor(target / 60), target % 60)
  if (next.getTime() <= from.getTime()) {
    // Advance by whole periods rather than a single day, so "every 3 days at
    // nine" stays on its own rhythm instead of collapsing into a daily job.
    const stepDays = Math.max(1, Math.round(everyMinutes / (60 * 24)))
    next.setDate(next.getDate() + stepDays)
  }
  return next
}

/** How it reads back to the owner. */
export function describeSchedule(schedule: Schedule): string {
  const every = describeEvery(schedule.everyMinutes)
  return schedule.atTime ? `${every} at ${schedule.atTime}` : every
}

export function describeEvery(minutes: number): string {
  if (minutes % (60 * 24 * 7) === 0) {
    const weeks = minutes / (60 * 24 * 7)
    return weeks === 1 ? 'weekly' : `every ${weeks} weeks`
  }
  if (minutes % (60 * 24) === 0) {
    const days = minutes / (60 * 24)
    return days === 1 ? 'daily' : `every ${days} days`
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return hours === 1 ? 'hourly' : `every ${hours} hours`
  }
  return `every ${minutes} minutes`
}
