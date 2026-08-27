/**
 * What a particular building looks like.
 *
 * `tiers.ts` says what *form* a building has taken. That is a function of
 * headcount alone and it is the honest signal — decision 0009. This file says
 * what that form looks like *for this building*: its materials, its window
 * rhythm, what somebody left on its roof.
 *
 * All of it is drawn from a seed made of the building's id, so a building looks
 * the same every time the app opens, and two buildings the same size look
 * nothing like each other. Nothing here is chosen by a person, and nothing here
 * is stored — a design is derived, every time, from facts that already exist.
 * A skyline of eleven walk-ups that were all the same walk-up would tell you
 * less than a list of names, which is the thing this is supposed to beat.
 */
import { tierOf, type Tier, type TierName } from './tiers.js'

// ---- randomness that is the same tomorrow ---------------------------------

/** FNV-1a. Small, fast, and stable across runs, which is the entire point. */
export function seedOf(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32: one word of state, good enough for choosing bricks. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A seeded chooser. Every decision below goes through one of these. */
export class Chooser {
  private readonly next: () => number
  constructor(seed: number) {
    this.next = mulberry32(seed)
  }
  unit(): number {
    return this.next()
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }
  float(min: number, max: number): number {
    return min + this.next() * (max - min)
  }
  chance(probability: number): boolean {
    return this.next() < probability
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!
  }
  /** Up to `count` distinct items, order preserved. */
  some<T>(items: readonly T[], count: number): T[] {
    const pool = [...items]
    const taken: T[] = []
    while (taken.length < count && pool.length > 0) {
      taken.push(pool.splice(Math.floor(this.next() * pool.length), 1)[0]!)
    }
    return taken
  }
}

// ---- materials ------------------------------------------------------------

export interface Palette {
  name: string
  /** Face in light. */
  wall: string
  /** The same wall turned away from it. */
  shade: string
  /** Cornices, mullions, frames — the drawn lines of the building. */
  trim: string
  /** Roof deck and parapet top. */
  roof: string
  /** A window nobody is behind. */
  glass: string
}

/**
 * Real materials, in the order a district gets built in. The names are the
 * point: a building is "sandstone" or "verdigris", not "#c8a97e", and a palette
 * that cannot be named is usually one that does not go together.
 */
export const PALETTES = {
  timber: { name: 'weathered timber', wall: '#8a7259', shade: '#6b573f', trim: '#5a4632', roof: '#4e4034', glass: '#3a3228' },
  tin: { name: 'corrugated tin', wall: '#8d9499', shade: '#6c7378', trim: '#565d61', roof: '#5d6469', glass: '#343a3e' },
  tarpaper: { name: 'tar paper', wall: '#6f6a63', shade: '#544f4a', trim: '#413d39', roof: '#3c3835', glass: '#2e2b28' },
  clapboard: { name: 'painted clapboard', wall: '#c9c2b2', shade: '#a49d8d', trim: '#7d7768', roof: '#6b5f52', glass: '#3b3a36' },
  seafoam: { name: 'seafoam board', wall: '#9fb8ac', shade: '#7d968b', trim: '#5f7469', roof: '#5a5f52', glass: '#33403b' },
  brickRed: { name: 'red brick', wall: '#a8523c', shade: '#853f2e', trim: '#6d3325', roof: '#4a2e26', glass: '#3a2a26' },
  brickBrown: { name: 'brown brick', wall: '#8a6048', shade: '#6d4b38', trim: '#573c2d', roof: '#443128', glass: '#332a25' },
  sandstone: { name: 'sandstone', wall: '#c3a173', shade: '#a1835b', trim: '#836a49', roof: '#5f5140', glass: '#3b352c' },
  bluestone: { name: 'bluestone', wall: '#7c8794', shade: '#616b76', trim: '#4d555e', roof: '#414850', glass: '#2f353b' },
  oxblood: { name: 'oxblood', wall: '#8e3f42', shade: '#6f3134', trim: '#582629', roof: '#452023', glass: '#331f21' },
  castCream: { name: 'painted cast iron', wall: '#d8cdb4', shade: '#b5aa92', trim: '#8e836c', roof: '#6a6252', glass: '#3c3a33' },
  castSage: { name: 'sage cast iron', wall: '#9aa688', shade: '#7c876c', trim: '#5f6952', roof: '#4e5643', glass: '#333829' },
  verdigris: { name: 'verdigris', wall: '#6f9b8e', shade: '#557a70', trim: '#416058', roof: '#3a534d', glass: '#2b3d39' },
  castSlate: { name: 'slate cast iron', wall: '#6d6a74', shade: '#54525b', trim: '#413f47', roof: '#38363e', glass: '#2a292f' },
  limestone: { name: 'limestone', wall: '#cfc4ac', shade: '#aba08a', trim: '#8a806c', roof: '#6b6354', glass: '#3a372f' },
  bronze: { name: 'bronze', wall: '#9a7a4e', shade: '#7a5f3c', trim: '#5e4a2e', roof: '#4b3c26', glass: '#332b1e' },
  blacksteel: { name: 'black steel', wall: '#3f434a', shade: '#31343a', trim: '#24272b', roof: '#25282d', glass: '#1e2124' },
  glassBlue: { name: 'blue curtain wall', wall: '#4e6b86', shade: '#3c536a', trim: '#2f4152', roof: '#2b3a49', glass: '#22303d' },
  glassTeal: { name: 'teal curtain wall', wall: '#3f7573', shade: '#305a58', trim: '#254745', roof: '#22403f', glass: '#1c3332' },
  glassBronze: { name: 'bronze curtain wall', wall: '#7a6448', shade: '#5f4e38', trim: '#493c2b', roof: '#413628', glass: '#2c2519' },
  pearl: { name: 'pearl composite', wall: '#b9c0c8', shade: '#969ea6', trim: '#737b83', roof: '#646c74', glass: '#2f363c' },
  carbon: { name: 'carbon lattice', wall: '#2f3440', shade: '#242833', trim: '#1a1d25', roof: '#1c1f28', glass: '#171a21' },
  alabaster: { name: 'alabaster shell', wall: '#d9dbe2', shade: '#b3b6bf', trim: '#8b8e98', roof: '#787c86', glass: '#2b2f38' },
} as const satisfies Record<string, Palette>

export type PaletteName = keyof typeof PALETTES

/** What a district of this age would actually have been built out of. */
const MATERIALS: Record<TierName, readonly PaletteName[]> = {
  shack: ['timber', 'tin', 'tarpaper'],
  'single-storey': ['clapboard', 'seafoam', 'timber', 'brickRed', 'tin'],
  'brick walk-up': ['brickRed', 'brickBrown', 'sandstone', 'bluestone', 'oxblood', 'clapboard'],
  'cast-iron block': ['castCream', 'castSage', 'verdigris', 'castSlate', 'oxblood', 'sandstone'],
  skyscraper: ['limestone', 'bronze', 'blacksteel', 'bluestone', 'sandstone', 'castSlate'],
  landmark: ['limestone', 'bronze', 'blacksteel', 'pearl', 'glassBlue', 'glassBronze'],
  arcology: ['carbon', 'alabaster', 'glassTeal', 'glassBlue', 'pearl', 'blacksteel'],
}

/** Awnings, neon, doors. One saturated note against a whole building of stone. */
export const ACCENTS = [
  '#d4703a', '#c2453f', '#3f7fa8', '#4f8a5b', '#b8862f',
  '#8a4f8f', '#2f8f88', '#c25a7a', '#5b6ec4', '#d19a2e',
] as const

// ---- the vocabulary of a facade -------------------------------------------

export type WindowShape = 'plank' | 'sash' | 'arched' | 'tall' | 'ribbon' | 'round-top' | 'slit' | 'grid'
export type CrownKind =
  | 'lean-to' | 'patched' | 'tarp'
  | 'gable' | 'hip' | 'false-front'
  | 'cornice' | 'parapet' | 'dentil' | 'stepped'
  | 'bracket-cornice' | 'pediment' | 'balustrade'
  | 'setback-crown' | 'ziggurat' | 'lantern' | 'deck'
  | 'spire' | 'needle' | 'dome' | 'mast'
  | 'halo' | 'solar-fin' | 'orb' | 'skybridge-crown'
export type BaseKind = 'stoop' | 'arcade' | 'shopfront' | 'plaza' | 'colonnade' | 'yard'
export type Ornament =
  | 'fire-escape' | 'water-tower' | 'ac-units' | 'antenna' | 'satellite' | 'flag'
  | 'clock' | 'neon-sign' | 'banner' | 'chimney' | 'roof-garden' | 'billboard'
  | 'vent-stack' | 'weathervane' | 'string-lights' | 'solar-panel' | 'ladder'
  | 'planters' | 'pigeons' | 'skybridge' | 'drone-pad' | 'beacon' | 'crane'

interface TierLook {
  /** Drawn width of the body, before jitter. */
  width: number
  /** Extra height of the ground floor over an ordinary storey. */
  baseExtra: number
  windows: readonly WindowShape[]
  crowns: readonly CrownKind[]
  bases: readonly BaseKind[]
  bays: readonly number[]
  ornaments: readonly Ornament[]
  /** How many ornaments this kind of building tends to carry. */
  clutter: readonly [number, number]
}

/**
 * Widths differ; storey height does not. That is deliberate — the skyline
 * promises true relative heights, and it stops being true the moment a tower's
 * floors are drawn shorter than a walk-up's. So a shack is squat and wide and a
 * tower is narrow, which is also how it works outside.
 */
export const FLOOR_HEIGHT = 26

const LOOKS: Record<TierName, TierLook> = {
  shack: {
    width: 128, baseExtra: 8,
    windows: ['plank', 'sash'],
    crowns: ['lean-to', 'patched', 'tarp'],
    bases: ['yard', 'stoop'],
    bays: [2, 2, 3],
    ornaments: ['chimney', 'vent-stack', 'weathervane', 'ladder', 'string-lights', 'pigeons'],
    clutter: [1, 2],
  },
  'single-storey': {
    width: 122, baseExtra: 10,
    windows: ['sash', 'plank', 'grid'],
    crowns: ['gable', 'hip', 'false-front'],
    bases: ['shopfront', 'stoop', 'yard'],
    bays: [2, 3, 3],
    ornaments: ['chimney', 'weathervane', 'flag', 'string-lights', 'planters', 'banner', 'pigeons'],
    clutter: [1, 3],
  },
  'brick walk-up': {
    width: 112, baseExtra: 12,
    windows: ['sash', 'grid', 'tall'],
    crowns: ['cornice', 'parapet', 'dentil', 'stepped'],
    bases: ['stoop', 'shopfront', 'arcade'],
    bays: [3, 3, 4],
    ornaments: ['fire-escape', 'water-tower', 'chimney', 'flag', 'banner', 'planters', 'ac-units', 'pigeons', 'ladder'],
    clutter: [2, 3],
  },
  'cast-iron block': {
    width: 120, baseExtra: 14,
    windows: ['arched', 'round-top', 'tall'],
    crowns: ['bracket-cornice', 'pediment', 'balustrade', 'cornice'],
    bases: ['arcade', 'colonnade', 'shopfront'],
    bays: [4, 4, 5],
    ornaments: ['fire-escape', 'water-tower', 'clock', 'banner', 'neon-sign', 'flag', 'planters', 'pigeons', 'ac-units'],
    clutter: [2, 4],
  },
  skyscraper: {
    width: 100, baseExtra: 16,
    windows: ['grid', 'tall', 'ribbon'],
    crowns: ['setback-crown', 'ziggurat', 'lantern', 'deck'],
    bases: ['colonnade', 'plaza', 'arcade'],
    bays: [4, 5, 5, 6],
    ornaments: ['water-tower', 'ac-units', 'antenna', 'beacon', 'flag', 'billboard', 'satellite', 'roof-garden'],
    clutter: [2, 3],
  },
  landmark: {
    width: 96, baseExtra: 18,
    windows: ['grid', 'ribbon', 'tall'],
    crowns: ['spire', 'needle', 'dome', 'mast'],
    bases: ['plaza', 'colonnade'],
    bays: [4, 5, 6],
    ornaments: ['beacon', 'antenna', 'satellite', 'flag', 'roof-garden', 'ac-units', 'billboard'],
    clutter: [2, 3],
  },
  arcology: {
    width: 108, baseExtra: 20,
    windows: ['ribbon', 'slit', 'grid'],
    crowns: ['halo', 'solar-fin', 'orb', 'skybridge-crown'],
    bases: ['plaza', 'colonnade'],
    bays: [5, 6, 6],
    ornaments: ['drone-pad', 'skybridge', 'beacon', 'solar-panel', 'roof-garden', 'satellite', 'antenna'],
    clutter: [2, 4],
  },
}

// ---- the design itself ----------------------------------------------------

/** Where a tower steps in, and by how much on each side. */
export interface Setback {
  /** Counted from the ground, 0 is the first storey above the lobby. */
  atFloor: number
  inset: number
}

export interface BuildingDesign {
  id: string
  name: string
  headcount: number
  /** Storeys drawn above the lobby. One per head, always at least one. */
  floors: number
  tier: Tier
  seed: number

  palette: Palette
  accent: string

  /** Body width at the base, after jitter. */
  width: number
  floorHeight: number
  baseHeight: number
  crownHeight: number
  /** Ground to the top of the crown, ornaments excluded. */
  height: number

  bays: number
  window: WindowShape
  crown: CrownKind
  base: BaseKind
  setbacks: readonly Setback[]
  ornaments: readonly Ornament[]

  /** Degrees. The shack leans; nothing else does. */
  lean: number
  /** Vertical banding on the facade — pilasters between the bays. */
  pilasters: boolean
  /** A course line drawn between storeys. */
  bandCourse: boolean
  /** Windows lit with nobody home, so a city at dusk is never fully dark. */
  ambientLights: readonly number[]
}

export interface DesignInput {
  id: string
  name: string
  headcount: number
}

/**
 * The look of one building. Pure, and stable for a given id and form — hiring
 * somebody changes the building, opening the app twice does not.
 */
export function designFor(input: DesignInput): BuildingDesign {
  const headcount = Math.max(0, Math.floor(input.headcount))
  const floors = Math.max(1, headcount)
  const tier = tierOf(floors)
  const look = LOOKS[tier.name]

  // The form is in the seed on purpose. A building that grows into a new form
  // is allowed to have re-rendered its roof: it just became a different kind of
  // building. Growing a storey inside the same form leaves the look alone.
  const seed = seedOf(`${input.id}:${tier.name}`)
  const rng = new Chooser(seed)

  const palette = PALETTES[rng.pick(MATERIALS[tier.name])]
  const width = Math.round(look.width * rng.float(0.92, 1.08))
  const crown = rng.pick(look.crowns)
  const base = rng.pick(look.bases)
  const window = rng.pick(look.windows)
  const bays = rng.pick(look.bays)
  const baseHeight = FLOOR_HEIGHT + look.baseExtra
  const crownHeight = crownHeightOf(crown, width)
  const setbacks = setbacksFor(tier.name, floors, width, rng)
  const ornaments = rng.some(look.ornaments, rng.int(look.clutter[0], look.clutter[1]))

  return {
    id: input.id,
    name: input.name,
    headcount,
    floors,
    tier,
    seed,
    palette,
    accent: rng.pick(ACCENTS),
    width,
    floorHeight: FLOOR_HEIGHT,
    baseHeight,
    crownHeight,
    height: baseHeight + floors * FLOOR_HEIGHT + crownHeight,
    bays,
    window,
    crown,
    base,
    setbacks,
    ornaments,
    lean: tier.name === 'shack' ? rng.float(-3.2, 3.2) : 0,
    pilasters: rng.chance(tier.name === 'cast-iron block' ? 0.85 : 0.4),
    bandCourse: rng.chance(0.45),
    ambientLights: ambientLights(floors, bays, rng),
  }
}

function crownHeightOf(crown: CrownKind, width: number): number {
  switch (crown) {
    case 'lean-to': case 'patched': case 'tarp': return 16
    case 'gable': case 'hip': return Math.round(width * 0.24)
    case 'false-front': return 26
    case 'cornice': case 'bracket-cornice': return 14
    case 'parapet': case 'deck': return 12
    case 'dentil': case 'balustrade': return 18
    case 'stepped': case 'pediment': return 24
    case 'setback-crown': case 'ziggurat': return 46
    case 'lantern': return 54
    case 'spire': return 96
    case 'needle': return 120
    case 'mast': return 84
    case 'dome': return 62
    case 'halo': return 78
    case 'solar-fin': return 66
    case 'orb': return 70
    case 'skybridge-crown': return 58
  }
}

/**
 * Setbacks, for the forms that have them. A tower steps *in* as it rises, so
 * these are floor numbers counted up from the lobby with an inset per side.
 */
function setbacksFor(tier: TierName, floors: number, width: number, rng: Chooser): Setback[] {
  if (tier !== 'skyscraper' && tier !== 'landmark' && tier !== 'arcology') return []
  if (floors < 6) return []
  const count = rng.int(1, tier === 'arcology' ? 3 : 2)
  const step = Math.max(2, Math.floor(floors / (count + 1)))
  const out: Setback[] = []
  for (let i = 1; i <= count; i++) {
    const at = Math.min(floors - 2, i * step + rng.int(-1, 1))
    if (at <= 1) continue
    if (out.some((s) => Math.abs(s.atFloor - at) < 2)) continue
    out.push({ atFloor: at, inset: Math.round(width * rng.float(0.05, 0.09)) })
  }
  return out.sort((a, b) => a.atFloor - b.atFloor)
}

/**
 * A scatter of windows that are lit whether or not anyone is working.
 *
 * Without this an idle city is a black cutout, which reads as broken rather than
 * as quiet. Returned as flat window indices so the renderer does not have to
 * care how the grid is laid out.
 */
function ambientLights(floors: number, bays: number, rng: Chooser): number[] {
  const total = floors * bays
  const lit: number[] = []
  for (let i = 0; i < total; i++) if (rng.chance(0.16)) lit.push(i)
  return lit
}

/** The forms in order, for a screen that wants to show what comes next. */
export const TIER_ORDER: readonly TierName[] = [
  'shack', 'single-storey', 'brick walk-up', 'cast-iron block', 'skyscraper', 'landmark', 'arcology',
]
