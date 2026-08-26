import { BUILDING_WIDTH, tierOf, type Tier } from './tiers.js'

export interface BuildingView {
  name: string
  /** Number of staff. One storey is drawn per head. */
  headcount: number
  /** How many floors currently have work in hand. Their windows are lit. */
  working?: number
  /** Shown under the name, e.g. "3 tasks". */
  note?: string
}

export interface RenderOptions {
  /** ANSI colour. Off when piping to a file. */
  colour?: boolean
  /** Space between buildings, in columns. */
  gap?: number
}

const DIM = '\x1b[38;5;244m'
const LIT = '\x1b[38;5;222m'
const NAME = '\x1b[1m'
const OFF = '\x1b[0m'

/**
 * Draw one building, tallest line first. Lines are padded to BUILDING_WIDTH so
 * that buildings of different forms still stack into a straight skyline.
 */
export function renderBuilding(view: BuildingView, opts: RenderOptions = {}): string[] {
  const tier = tierOf(view.headcount)
  const storeys = Math.max(1, Math.floor(view.headcount))
  const lines = [...tier.cap, ...Array.from({ length: storeys }, () => tier.storey), ...tier.ground]
  const lit = Math.max(0, Math.min(storeys, view.working ?? 0))
  const withLight = lightWindows(lines, tier, tier.cap.length, lit, opts.colour ?? false)
  return withLight.map((l) => pad(l))
}

/**
 * Light the windows of the topmost `count` storeys — the manager's floor is at
 * the top, so work lights the building from the head down, which is also the
 * order it is handed out in.
 */
function lightWindows(
  lines: readonly string[],
  tier: Tier,
  capLines: number,
  count: number,
  colour: boolean,
): string[] {
  if (!colour) return [...lines]
  return lines.map((line, i) => {
    const isStorey = i >= capLines && i < capLines + countStoreys(lines, tier, capLines)
    const inLitRange = isStorey && i - capLines < count
    if (!inLitRange) return DIM + line + OFF
    return DIM + line.replaceAll(tier.window, LIT + tier.window + DIM) + OFF
  })
}

const countStoreys = (lines: readonly string[], tier: Tier, capLines: number) =>
  lines.length - capLines - tier.ground.length

const visibleLength = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').length

function pad(line: string): string {
  const short = BUILDING_WIDTH - visibleLength(line)
  return short > 0 ? line + ' '.repeat(short) : line
}

/**
 * The skyline: every building on one ground line, in the order given, with names
 * beneath. This is the home screen, so it has to be readable before it is clever.
 */
export function renderSkyline(views: readonly BuildingView[], opts: RenderOptions = {}): string {
  if (views.length === 0) return emptySkyline(opts)
  const gap = ' '.repeat(opts.gap ?? 2)
  const drawn = views.map((v) => renderBuilding(v, opts))
  const tallest = Math.max(...drawn.map((d) => d.length))

  const rows: string[] = []
  for (let row = 0; row < tallest; row++) {
    const cells = drawn.map((building) => {
      const offset = tallest - building.length
      return row < offset ? ' '.repeat(BUILDING_WIDTH) : building[row - offset]!
    })
    rows.push(cells.join(gap).trimEnd())
  }

  rows.push(views.map(() => '─'.repeat(BUILDING_WIDTH)).join(gap))
  rows.push(views.map((v) => centre(label(v.name, opts), BUILDING_WIDTH)).join(gap).trimEnd())
  rows.push(
    views
      .map((v) => centre(dim(v.note ?? `${v.headcount} on staff`, opts), BUILDING_WIDTH))
      .join(gap)
      .trimEnd(),
  )
  return rows.join('\n')
}

const label = (s: string, o: RenderOptions) => (o.colour ? NAME + trunc(s) + OFF : trunc(s))
const dim = (s: string, o: RenderOptions) => (o.colour ? DIM + trunc(s) + OFF : trunc(s))
const trunc = (s: string) => (s.length > BUILDING_WIDTH ? s.slice(0, BUILDING_WIDTH - 1) + '…' : s)

function centre(s: string, width: number): string {
  const len = visibleLength(s)
  if (len >= width) return s
  const left = Math.floor((width - len) / 2)
  return ' '.repeat(left) + s + ' '.repeat(width - len - left)
}

function emptySkyline(opts: RenderOptions): string {
  const flat = [
    '                                   ',
    '            nothing here yet       ',
    '                                   ',
    '───────────────────────────────────',
  ].join('\n')
  return opts.colour ? DIM + flat + OFF : flat
}
