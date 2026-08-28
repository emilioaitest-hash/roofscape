/**
 * What a particular building looks like.
 *
 * `tiers.ts` says what *form* a building has taken. That is a function of
 * headcount alone and it is the honest signal — decision 0009. This file says
 * what that form looks like *for this building*: its materials, its window
 * rhythm, what somebody left on its roof, and how badly its colour plate is
 * printed over its ink.
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
  /** The 3-unit chamfer along the top of a mass: the wall, caught. */
  lit: string
  /** Cornices, mullions, sills — the flat washes that are not the wall. */
  trim: string
  /** Roof deck and parapet top. */
  roof: string
  /** Inside a window: the hole, before anybody turns a light on in it. */
  socket: string
}

/** Mix two hexes. Used once, to derive `lit` from `wall` so it cannot drift. */
function mix(from: string, to: string, amount: number): string {
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const a = channels(from)
  const b = channels(to)
  return `#${a
    .map((c, i) => Math.round(c + (b[i]! - c) * amount).toString(16).padStart(2, '0'))
    .join('')}`
}

/**
 * The colour a lit face is: the wall, taken 22% of the way toward warm white.
 *
 * Derived rather than written down because it is a *relationship*, not a
 * choice — twenty-five hand-picked highlights would be twenty-five chances for
 * one of them to be a shade lighter than it ought to be, and the chamfer only
 * works when every building does it by the same amount.
 */
const CAUGHT_LIGHT = '#FFFAF0'

const paint = (
  name: string,
  wall: string,
  shade: string,
  trim: string,
  roof: string,
  socket: string,
): Palette => ({ name, wall, shade, lit: mix(wall, CAUGHT_LIGHT, 0.22), trim, roof, socket })

/**
 * Finishes, in the order a building earns them.
 *
 * The ladder used to run on the age of a district, which put a limestone bank
 * next to a tar-paper shed for reasons only a city planner would feel. It runs
 * on *finish* now: bare and scuffed at the bottom, then milk paint, then
 * enamel, then lacquer and anodised metal at the top. That ladder is legible
 * from across the room — a building that has been painted is doing better than
 * one that has not — and it is the same claim the drawn height makes.
 *
 * Every one of these clears the material bar: no wall, shade, trim, roof or
 * chamfer sits inside the marigold or vermilion band, so a single lit window
 * still carries across a street of thirty buildings. `design.test.ts` proves
 * it, and it is the test to run before adding a colour here.
 */
export const PALETTES = {
  // Bare: nobody has painted these.
  bareTimber: paint('bare timber', '#A08560', '#856C4B', '#6B563B', '#5C4C38', '#3B3125'),
  tarBoard: paint('tarred board', '#6E6A61', '#57544C', '#46433C', '#3E3B35', '#33302B'),
  patchTin: paint('patched tin', '#99A0A2', '#7C8386', '#636A6D', '#585F62', '#33383A'),
  scuffedBoard: paint('scuffed board', '#B2A68E', '#948972', '#776E5A', '#665E4D', '#383327'),

  // Milk paint: chalky, matt, and somebody's own hand.
  milkSage: paint('sage milk paint', '#A3B29B', '#85947E', '#6B7865', '#5C6754', '#333A31'),
  milkSky: paint('sky milk paint', '#9DB0BC', '#7F929E', '#667681', '#58656E', '#303840'),
  milkOat: paint('oat milk paint', '#CFC3A8', '#AEA38A', '#8D8470', '#78705F', '#3A3529'),
  milkClay: paint('clay milk paint', '#B08A78', '#92705F', '#765A4C', '#644D42', '#3A2C26'),

  // Fired and quarried: the things a walk-up is actually built out of.
  smokeBrick: paint('smoked brick', '#96604F', '#7B4E40', '#633F34', '#52352C', '#3B2721'),
  dustBrick: paint('dusty brick', '#A87A63', '#8A6350', '#6F5040', '#5C4335', '#362720'),
  buffStone: paint('buff stone', '#C6B896', '#A6997B', '#877C63', '#736952', '#3B3529'),
  greyStone: paint('grey stone', '#A6A79E', '#888982', '#6E6F69', '#5F605B', '#34352F'),
  blueStone: paint('bluestone', '#8792A0', '#6D7784', '#57606B', '#4B535C', '#2C3239'),

  // Enamel: paint that was bought rather than mixed, and it shows.
  enamelCream: paint('cream enamel', '#DCD1B4', '#BAAF94', '#978D75', '#7F7663', '#3C3729'),
  enamelOlive: paint('olive enamel', '#7F8A57', '#667046', '#525A38', '#464D31', '#2B2F1E'),
  enamelTeal: paint('teal enamel', '#4E8A85', '#3E706C', '#325A57', '#2B4E4B', '#263B39'),
  enamelPlum: paint('plum enamel', '#7B5A82', '#644969', '#503B55', '#443248', '#322638'),
  enamelSlate: paint('slate enamel', '#5F6672', '#4C525C', '#3D424B', '#353941', '#2B2F35'),
  enamelBottle: paint('bottle-green enamel', '#48705A', '#395A48', '#2E483A', '#283E32', '#233229'),

  // Lacquer and anodised metal: finishes you have to send a building away for.
  lacquerInk: paint('ink lacquer', '#3A3843', '#2E2C36', '#24222B', '#201F26', '#1B1A22'),
  lacquerCobalt: paint('cobalt lacquer', '#46578F', '#384673', '#2D385C', '#26304F', '#222945'),
  lacquerPlum: paint('plum lacquer', '#61417A', '#4E3462', '#3E2A4E', '#362444', '#2B1E37'),
  anodGraphite: paint('anodised graphite', '#52565E', '#42464C', '#34373C', '#2D3034', '#212327'),
  anodPearl: paint('anodised pearl', '#C3C6C4', '#A2A5A3', '#838685', '#717473', '#343736'),
  anodChalk: paint('anodised chalk', '#D5D0C4', '#B3AEA2', '#918D82', '#7C786E', '#3A3833'),
} as const satisfies Record<string, Palette>

export type PaletteName = keyof typeof PALETTES

/** Which rung of the finish ladder each form is built on. */
const MATERIALS: Record<TierName, readonly PaletteName[]> = {
  shack: ['bareTimber', 'tarBoard', 'patchTin', 'scuffedBoard'],
  'single-storey': ['scuffedBoard', 'bareTimber', 'milkSage', 'milkSky', 'milkOat', 'milkClay'],
  'brick walk-up': ['smokeBrick', 'dustBrick', 'buffStone', 'greyStone', 'blueStone', 'milkOat', 'milkClay'],
  'cast-iron block': ['enamelCream', 'enamelOlive', 'enamelTeal', 'enamelPlum', 'enamelBottle', 'buffStone', 'greyStone'],
  skyscraper: ['enamelSlate', 'enamelCream', 'buffStone', 'greyStone', 'blueStone', 'anodGraphite'],
  landmark: ['lacquerInk', 'lacquerCobalt', 'lacquerPlum', 'anodGraphite', 'anodPearl', 'buffStone'],
  arcology: ['lacquerInk', 'lacquerCobalt', 'lacquerPlum', 'anodPearl', 'anodChalk', 'anodGraphite', 'enamelTeal'],
}

/**
 * Awnings, pennants, doors. One saturated note against a whole building.
 *
 * Neither meaning hue is in here, and that is the whole point of the list.
 * `ACCENTS[0]` used to be `#d4703a`, which is byte-identical to `--flag` — so
 * one building in ten wore the "this needs you" colour as awning paint, and the
 * mark on a roof had a rival it could not win against. Nothing in this pool
 * falls inside either meaning band; `design.test.ts` will not let it.
 */
export const ACCENTS = [
  '#3F7FA8', // signal blue
  '#4F8A5B', // park green
  '#7C4B8C', // plum
  '#2F8F88', // teal
  '#C25A7A', // rose
  '#5B6EC4', // cobalt
  '#6D7F47', // olive
  '#CFC4B1', // chalk
] as const

// ---- the vocabulary of a facade -------------------------------------------

export type WindowShape =
  | 'plank' | 'sash' | 'arched' | 'tall' | 'ribbon' | 'round-top' | 'slit' | 'grid' | 'porthole'
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
  | 'fire-escape' | 'water-tower' | 'ac-units' | 'antenna' | 'satellite' | 'pennant'
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
    windows: ['plank', 'sash', 'porthole'],
    crowns: ['lean-to', 'patched', 'tarp'],
    bases: ['yard', 'stoop'],
    bays: [2, 2, 3],
    ornaments: ['chimney', 'vent-stack', 'weathervane', 'ladder', 'string-lights', 'pigeons'],
    clutter: [1, 2],
  },
  'single-storey': {
    width: 122, baseExtra: 10,
    windows: ['sash', 'plank', 'grid', 'porthole'],
    crowns: ['gable', 'hip', 'false-front'],
    bases: ['shopfront', 'stoop', 'yard'],
    bays: [2, 3, 3],
    ornaments: ['chimney', 'weathervane', 'pennant', 'string-lights', 'planters', 'banner', 'pigeons'],
    clutter: [1, 3],
  },
  'brick walk-up': {
    width: 112, baseExtra: 12,
    windows: ['sash', 'grid', 'tall'],
    crowns: ['cornice', 'parapet', 'dentil', 'stepped'],
    bases: ['stoop', 'shopfront', 'arcade'],
    bays: [3, 3, 4],
    ornaments: ['fire-escape', 'water-tower', 'chimney', 'pennant', 'banner', 'planters', 'ac-units', 'pigeons', 'ladder'],
    clutter: [2, 3],
  },
  'cast-iron block': {
    width: 120, baseExtra: 14,
    windows: ['arched', 'round-top', 'tall'],
    crowns: ['bracket-cornice', 'pediment', 'balustrade', 'cornice'],
    bases: ['arcade', 'colonnade', 'shopfront'],
    bays: [4, 4, 5],
    ornaments: ['fire-escape', 'water-tower', 'clock', 'banner', 'neon-sign', 'pennant', 'planters', 'pigeons', 'ac-units'],
    clutter: [2, 4],
  },
  skyscraper: {
    width: 100, baseExtra: 16,
    windows: ['grid', 'tall', 'ribbon'],
    crowns: ['setback-crown', 'ziggurat', 'lantern', 'deck'],
    bases: ['colonnade', 'plaza', 'arcade'],
    bays: [4, 5, 5, 6],
    // The crane is here because a tower is the only thing still going up, and
    // because it was drawn years ago and then never put on any building's list:
    // twenty-three ornaments in the type, twenty-two anybody could ever see.
    ornaments: ['water-tower', 'ac-units', 'antenna', 'beacon', 'pennant', 'billboard', 'satellite', 'roof-garden', 'crane'],
    clutter: [2, 3],
  },
  landmark: {
    width: 96, baseExtra: 18,
    windows: ['grid', 'ribbon', 'tall'],
    crowns: ['spire', 'needle', 'dome', 'mast'],
    bases: ['plaza', 'colonnade'],
    bays: [4, 5, 6],
    ornaments: ['beacon', 'antenna', 'satellite', 'pennant', 'roof-garden', 'ac-units', 'billboard'],
    clutter: [2, 3],
  },
  arcology: {
    width: 108, baseExtra: 20,
    windows: ['ribbon', 'slit', 'grid'],
    crowns: ['halo', 'solar-fin', 'orb', 'skybridge-crown'],
    bases: ['plaza', 'colonnade'],
    bays: [5, 6, 6],
    ornaments: ['drone-pad', 'skybridge', 'beacon', 'solar-panel', 'roof-garden', 'satellite', 'antenna', 'crane'],
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

/**
 * How far this building's colour plate landed off its ink.
 *
 * A two-colour press never lands the second plate exactly on the first, and
 * the amount it is out by is a property of that sheet rather than of the
 * drawing. Seeded per building, so the misprint is *this* building's misprint,
 * and hovering can snap it back into register.
 */
export interface Register {
  dx: number
  dy: number
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
  register: Register

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
  /** Windows with a light left on and nobody behind it. */
  ambientLights: readonly number[]
}

export interface DesignInput {
  id: string
  name: string
  headcount: number
}

/** How far out of register a colour plate is allowed to land, either way. */
export const REGISTER_SLIP = 1.6

/**
 * The look of one building. Pure, and stable for a given id and form — hiring
 * somebody changes the building, opening the app twice does not.
 */
export function designFor(input: DesignInput): BuildingDesign {
  // `Math.max` passes NaN straight through, and a NaN headcount reaches the
  // drawing as `viewBox="0 0 NaN NaN"` — a document that renders as nothing at
  // all rather than as an error anybody could act on.
  const asked = Math.floor(input.headcount)
  const headcount = Number.isFinite(asked) ? Math.max(0, asked) : 0
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
    // Its own sub-seed, not the form's: a building that grows a storey keeps
    // the misprint it has always had, because the press did not change.
    register: registerFor(input.id),
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

/**
 * The misprint, for one building.
 *
 * Never zero on both axes: a plate that landed perfectly is the one thing this
 * cannot be, because then hovering it does nothing and the building looks
 * broken next to its neighbours. The smaller nudge is pushed out to a
 * legible slip rather than allowed to vanish.
 */
function registerFor(id: string): Register {
  const rng = new Chooser(seedOf(`${id}:register`))
  const slip = () => rng.float(-REGISTER_SLIP, REGISTER_SLIP)
  const floor = REGISTER_SLIP * 0.45
  const push = (n: number) => (Math.abs(n) < floor ? (n < 0 ? -floor : floor) : n)
  return { dx: round2(push(slip())), dy: round2(push(slip())) }
}

const round2 = (n: number): number => Math.round(n * 100) / 100

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
 * A scatter of windows with a light left on and nobody behind them.
 *
 * These are the state the whole window grammar exists to tell apart. A marigold
 * counter on its own says a light is on; a counter with a small dark figure in
 * front of it says somebody is in there working. Without the first, an idle
 * building is a facade of empty holes and reads as abandoned rather than as
 * quiet; without the second, the two were indistinguishable, which is where the
 * old system was weakest against its own rule.
 *
 * Returned as flat window indices so the renderer does not have to care how the
 * grid is laid out.
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
