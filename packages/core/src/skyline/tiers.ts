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
  | 'arcology'

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
  {
    name: 'arcology',
    blurb: 'Sky bridges and a halo. It stopped being a building a while ago.',
    cap: ['     \u25b2     ', '   \u2571\u2500\u2500\u2500\u2572   ', ' \u25dc\u2500\u2524\u25aa\u25aa\u25aa\u251c\u2500\u25dd ', ' \u2570\u2500\u2500\u2534\u2500\u2534\u2500\u2500\u256f '],
    storey: ' \u255e\u25aa\u25aa\u25aa\u25aa\u25aa\u25aa\u25aa\u2561 ',
    ground: [' \u255e\u25aa\u25aa \u25af \u25aa\u25aa\u2561 ', ' \u2558\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255b '],
    window: '\u25aa',
  },
]

/** Lower bound of each tier, by headcount. */
const THRESHOLDS = [1, 2, 3, 5, 8, 12, 18] as const

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

/**
 * How tall a building is, said the way both renderers say it.
 *
 * Every nameplate used to read "N on staff", which was the floor count wearing
 * the word for people — and those are not the same number. The curator works in
 * the archives, below ground, so it is staff and is not a storey: a building
 * should not appear to grow because it started tidying up. A six-floor building
 * with a curator in it therefore had seven people and a sign saying six.
 *
 * Floors are the honest word here, and the better one besides: it is the number
 * you can count on the drawing in front of you.
 */
export const floorsSaid = (floors: number): string => {
  const n = Math.max(0, Math.floor(Number.isFinite(floors) ? floors : 0))
  // A tally of nothing is worse than no tally. "0 floors" is the caption on the
  // one screen where the owner most needs telling what to do, and it spends that
  // line saying nothing happened. An empty building has nobody in it; say that,
  // and the sentence next to it can be the one that offers to fix it.
  if (n === 0) return 'nobody in yet'
  return n === 1 ? '1 floor' : `${n} floors`
}
