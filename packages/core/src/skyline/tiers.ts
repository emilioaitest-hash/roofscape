/**
 * A building's drawn form follows its headcount. See docs/decisions/0009.
 *
 * Nothing here is fixed art: a tier supplies a cap, a repeating storey and a
 * ground floor, and the storeys are generated from the staff list. So a building
 * with nine floors really is drawn nine storeys tall, and growing by one hire
 * visibly adds a storey rather than swapping a picture.
 */

/** Every form is drawn to this width so a skyline lines up. */
export const BUILDING_WIDTH = 11

export type TierName =
  | 'shack'
  | 'single-storey'
  | 'brick walk-up'
  | 'cast-iron block'
  | 'skyscraper'
  | 'landmark'

export interface Tier {
  name: TierName
  /** What the owner is told when the building reaches this form. */
  blurb: string
  /** Drawn above the topmost storey. */
  cap: readonly string[]
  /** One storey. `lit` marks windows that should glow. */
  storey: string
  /** The lobby: ground floor, always present, always the way in. */
  ground: readonly string[]
  /** Which character in a storey counts as a window, for lighting. */
  window: string
}

const TIERS: readonly Tier[] = [
  {
    name: 'shack',
    blurb: 'One pair of hands and a roof that mostly works.',
    cap: ['   ,---.   ', '  /     \\  '],
    storey: '  |  \u25ab  |  ',
    ground: ['  |  \u25af  |  ', "  '-----'  "],
    window: '\u25ab',
  },
  {
    name: 'single-storey',
    blurb: 'Squared up, properly roofed, and open for business.',
    cap: ['    ___    ', '   /   \\   ', '  /_____\\  '],
    storey: '  | \u25ab \u25ab |  ',
    ground: ['  | \u25af \u25ab |  ', '  \u2514\u2500\u2500\u2500\u2500\u2500\u2518  '],
    window: '\u25ab',
  },
  {
    name: 'brick walk-up',
    blurb: 'Four solid walls and a cornice. People work here.',
    cap: [' \u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584 ', '  \u250c\u2500\u2500\u2500\u2500\u2500\u2510  '],
    storey: '  \u2502\u25ab \u25ab \u25ab\u2502  ',
    ground: ['  \u2502\u25ab \u25af \u25ab\u2502  ', '  \u2558\u2550\u2550\u2550\u2550\u2550\u255b  '],
    window: '\u25ab',
  },
  {
    name: 'cast-iron block',
    blurb: 'Arched bays and ornament. The good part of town.',
    cap: [' \u2552\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2555 ', ' \u2502\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2502 '],
    storey: ' \u2502 \u2229 \u2229 \u2229 \u2502 ',
    ground: [' \u2502 \u2229 \u25af \u2229 \u2502 ', ' \u2558\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255b '],
    window: '\u2229',
  },
  {
    name: 'skyscraper',
    blurb: 'Steel frame, setbacks, and a crown you can see from the bridge.',
    cap: ['   \u2584\u2584\u2584\u2584\u2584   ', '   \u2502\u25aa\u25aa\u25aa\u2502   ', ' \u2584\u2584\u2534\u2500\u2500\u2500\u2500\u2500\u2534\u2584', ' \u2502\u25aa\u25aa\u25aa\u25aa\u25aa\u25aa\u25aa\u25aa\u2502'],
    storey: ' \u2502\u25aa\u25aa \u25aa\u25aa \u25aa\u25aa\u2502',
    ground: [' \u2502\u25aa\u25aa \u25af\u25af \u25aa\u25aa\u2502', ' \u2558\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255b'],
    window: '\u25aa',
  },
  {
    name: 'landmark',
    blurb: 'It has a spire. People give directions by it.',
    cap: ['     \u2577     ', '    \u2571\u25b2\u2572    ', '   \u2571\u2500\u2500\u2500\u2572   ', '   \u2502\u25aa\u25aa\u25aa\u2502   ', ' \u2584\u2584\u2534\u2500\u2500\u2500\u2500\u2500\u2534\u2584', ' \u2502\u25aa\u25aa\u25aa\u25aa\u25aa\u25aa\u25aa\u25aa\u2502'],
    storey: ' \u2502\u25aa\u25aa \u25aa\u25aa \u25aa\u25aa\u2502',
    ground: [' \u2502\u25aa\u25aa \u25af\u25af \u25aa\u25aa\u2502', ' \u2558\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255b'],
    window: '\u25aa',
  },
]

/** Lower bound of each tier, by headcount. */
const THRESHOLDS = [1, 2, 3, 5, 8, 12] as const

export function tierOf(headcount: number): Tier {
  const n = Math.max(1, Math.floor(headcount))
  let index = 0
  for (let i = 0; i < THRESHOLDS.length; i++) {
    if (n >= THRESHOLDS[i]!) index = i
  }
  return TIERS[index]!
}

/** The headcount at which this building next changes form, or null at the top. */
export function nextTierAt(headcount: number): number | null {
  const n = Math.max(1, Math.floor(headcount))
  for (const t of THRESHOLDS) if (t > n) return t
  return null
}

export const allTiers = (): readonly Tier[] => TIERS
