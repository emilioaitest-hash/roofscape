/**
 * What a particular building looks like.
 *
 * `tiers.ts` says what *form* a building has taken. That is a function of
 * headcount alone and it is the honest signal — decision 0009. This file says
 * what that form looks like *for this building*: its materials, its window
 * rhythm, what somebody left on its roof, and how badly its colour plate is
 * printed over its ink.
 *
 * The city is New York, and specifically so. The ladder was already half-way
 * there — "brick walk-up", "cast-iron block", "skyscraper" are New York words
 * that had not committed — and committing costs nothing and buys enormous
 * character, because New York's building stock is the most legible in the
 * world. Everybody knows a brownstone stoop, a SoHo cast-iron facade, a rooftop
 * water tower, a fire escape, a setback crown. A city made of those reads
 * instantly, and it is funny the way a caricature is funny: not because it is
 * silly, but because it is specific.
 *
 * All of it is drawn from a seed made of the building's id, so a building looks
 * the same every time the app opens, and two buildings the same size look
 * nothing like each other. Nothing here is chosen by a person, and nothing here
 * is stored — a design is derived, every time, from facts that already exist.
 * A skyline of eleven brownstones that were all the same brownstone would tell
 * you less than a list of names, which is the thing this is supposed to beat.
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

/**
 * What a building is made of, coarsely — and it is the ladder.
 *
 * Low buildings are masonry and paint; tall ones are metal and glass. That is
 * true outside, and it is most of what makes a skyline legible from across a
 * room: you know roughly how big a building is before you have counted a single
 * storey. A brownstone is never black steel and a supertall is never red brick,
 * and `design.test.ts` holds the line.
 */
export type MaterialFamily = 'street' | 'masonry' | 'iron' | 'metal'

export interface Palette {
  name: string
  family: MaterialFamily
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
 * choice — eighteen hand-picked highlights would be eighteen chances for one of
 * them to be a shade lighter than it ought to be, and the chamfer only works
 * when every building does it by the same amount.
 */
const CAUGHT_LIGHT = '#FFFAF0'

const paint = (
  family: MaterialFamily,
  name: string,
  wall: string,
  shade: string,
  trim: string,
  roof: string,
  socket: string,
): Palette => ({ name, family, wall, shade, lit: mix(wall, CAUGHT_LIGHT, 0.22), trim, roof, socket })

/**
 * New York's actual stock, in the order the ladder reaches for it.
 *
 * The old ladder ran on *finish* — bare, milk paint, enamel, lacquer — which
 * was a sensible abstraction and described no city in particular. These are
 * things you can point at from a kerb: the chocolate sandstone of a Brooklyn
 * rowhouse, the sooty tenement brick above a laundromat, the pale yellow brick
 * of the outer boroughs, Fifth Avenue limestone, glazed terracotta, and the
 * painted cast iron of Greene Street in the four colours it is actually painted.
 *
 * Two rules keep it New York rather than generic-city. **No pastels and no toy
 * colours** — everything here is a real material seen in daylight and the
 * saturation ceiling is low. And every one of these clears the material bar: no
 * wall, shade, trim, roof or chamfer sits inside the marigold or vermilion
 * band, so a single lit window still carries across a street of thirty
 * buildings. `design.test.ts` proves it, and it is the test to run before
 * adding a colour here.
 *
 * Two hexes are a shade off the sample book, and both times the bar is why.
 * Tenement brick came in at `#A85842`, which is inside the vermilion band and
 * would have put the *this needs you* colour on one building in six; it is
 * pulled one notch toward soot, which is where it is anyway by its second
 * winter. Black steel came in at `#3A3D42`, dark enough that a window cut into
 * it could not be a recess — the hole would have had nowhere darker to go — so
 * it is lifted to the value plate glass actually reads at in daylight.
 */
export const PALETTES = {
  // Street stock: plywood, sheet metal and tar. What a kiosk is made of.
  plywood: paint('street', 'bare plywood', '#B4956A', '#977D59', '#836D4E', '#725F44', '#322A1E'),
  shutterSteel: paint('street', 'rolling shutter', '#9AA0A0', '#828685', '#727471', '#646561', '#2C2D2C'),
  paintedTin: paint('street', 'painted sheet metal', '#6F7F76', '#606C63', '#565E56', '#4D534A', '#1E211E'),
  tarPaper: paint('street', 'tar paper', '#55524C', '#4B4841', '#44413A', '#3E3B34', '#1A1916'),

  // Masonry: what the city is mostly built out of, and always was.
  brownstone: paint('masonry', 'brownstone', '#7A5442', '#694939', '#5D4233', '#523C2E', '#201712'),
  redBrick: paint('masonry', 'tenement brick', '#A05B49', '#874F3F', '#764738', '#673F32', '#281813'),
  buffBrick: paint('masonry', 'buff brick', '#C8A473', '#A78961', '#907754', '#7D6749', '#362C1F'),
  limestone: paint('masonry', 'limestone', '#DCD2BC', '#B7AE9B', '#9D9584', '#878070', '#302D28'),
  terracotta: paint('masonry', 'glazed terracotta', '#D9B77E', '#B59969', '#9B835B', '#86714F', '#352D1F'),
  granite: paint('masonry', 'granite', '#5C5A57', '#514E4A', '#494641', '#423F3A', '#1A1917'),

  // Painted cast iron: SoHo, and nowhere else on the ladder.
  ironCream: paint('iron', 'cream cast iron', '#E8DFC8', '#C1B9A5', '#A59E8C', '#8E8777', '#302E29'),
  ironGreen: paint('iron', 'bottle-green cast iron', '#4A6B57', '#425C4A', '#3D5141', '#39483A', '#151B16'),
  ironSlate: paint('iron', 'slate cast iron', '#6E7A85', '#5F686F', '#555B60', '#4C5052', '#1E2022'),
  ironOxblood: paint('iron', 'oxblood cast iron', '#8A4A46', '#76413D', '#673B36', '#5B3630', '#251513'),

  // Metal, glass and poured concrete: the top of the ladder, and it looks it.
  paleGlass: paint('metal', 'pale glass', '#93A3A8', '#7D898B', '#6D7677', '#606665', '#2A2D2E'),
  whiteConcrete: paint('metal', 'white concrete', '#C9C3B6', '#A8A296', '#918B80', '#7D786D', '#2F2E2A'),
  bronzeGlass: paint('metal', 'bronze and glass', '#7A6242', '#695539', '#5D4B33', '#52432E', '#1E1811'),
  blackSteel: paint('metal', 'black steel and glass', '#4A4E55', '#424549', '#3D3E40', '#393838', '#19191A'),
} as const satisfies Record<string, Palette>

export type PaletteName = keyof typeof PALETTES

/**
 * What each form is built out of. This is the geology, written down.
 *
 * Cast iron belongs to the loft and to nothing else, which is what makes a
 * block of SoHo read as SoHo. Masonry climbs as far as the setback tower,
 * because the 1916 envelope was built in brick and limestone and looks it.
 * Metal and glass start at the landmark's crown and take the supertall
 * outright.
 */
export const MATERIALS: Record<TierName, readonly PaletteName[]> = {
  newsstand: ['plywood', 'shutterSteel', 'paintedTin', 'tarPaper'],
  bodega: ['paintedTin', 'shutterSteel', 'plywood', 'redBrick', 'buffBrick', 'brownstone'],
  // Named twice, because a brownstone is usually brownstone — but only twice in
  // six: a whole row of them in one colour is Brooklyn being accurate at the
  // expense of the one thing the home screen promises, which is that no two of
  // your buildings look alike.
  brownstone: ['brownstone', 'brownstone', 'redBrick', 'buffBrick', 'limestone', 'terracotta'],
  'cast-iron loft': ['ironCream', 'ironGreen', 'ironSlate', 'ironOxblood', 'redBrick', 'buffBrick'],
  'setback tower': ['buffBrick', 'limestone', 'terracotta', 'granite', 'redBrick'],
  landmark: ['limestone', 'terracotta', 'granite', 'buffBrick', 'blackSteel', 'bronzeGlass'],
  supertall: ['blackSteel', 'bronzeGlass', 'paleGlass', 'whiteConcrete'],
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
  '#4F8A5B', // parks-department green
  '#7C4B8C', // plum
  '#2F8F88', // teal
  '#C25A7A', // rose
  '#5B6EC4', // cobalt
  '#6D7F47', // olive
  '#CFC4B1', // chalk
] as const

// ---- the vocabulary of a facade -------------------------------------------

/*
 * The four lists below are the vocabulary the drawing is written in, and they
 * are exported as arrays rather than as bare unions so that a renderer, a
 * preview page or a test can walk them. A `case` that quietly went missing is
 * the way one of these disappears, and a list you can iterate is how you catch
 * it.
 */

/** Openings, from a plywood hatch to a full structural bay of glass. */
export const WINDOW_SHAPES = [
  'plank', 'shutter', 'sash', 'plate-glass', 'arched', 'round-top',
  'tall', 'grid', 'ribbon', 'slit', 'porthole', 'curtain-wall',
] as const
export type WindowShape = (typeof WINDOW_SHAPES)[number]

/** How a building finishes at the top. */
export const CROWN_KINDS = [
  'lean-to', 'patched', 'tarp', 'gable', 'hip',
  'false-front', 'cornice', 'parapet', 'dentil', 'stepped',
  'bracket-cornice', 'pediment', 'balustrade',
  'setback-crown', 'ziggurat', 'lantern', 'deck',
  'spire', 'needle', 'dome', 'mast',
  'mechanical-floor', 'chisel', 'glass-fin', 'crown-terrace',
] as const
export type CrownKind = (typeof CROWN_KINDS)[number]

/** How it meets the pavement. `stoop` is the brownstone's, and unmistakable. */
export const BASE_KINDS = ['stoop', 'shopfront', 'arcade', 'colonnade', 'plaza', 'yard'] as const
export type BaseKind = (typeof BASE_KINDS)[number]

/**
 * What somebody left on the roof, or bolted to the front.
 *
 * These carry more character than the massing does. The water tower is the
 * single most New York object there is — a wooden barrel on a steel frame — so
 * it is on three rungs rather than one. The fire escape goes down the *front* of
 * a cast-iron loft, because that is where SoHo actually has them. The sidewalk
 * shed is the green plywood-and-pipe tunnel that has been outside every
 * building in the city since forever, and it is funny because it is true. The
 * gargoyle is on the landmark and nowhere else: one good joke per skyline.
 *
 * `drone-pad` and `skybridge` are gone with the arcology that invented them.
 */
export const ORNAMENTS = [
  'water-tower', 'roof-bulkhead', 'fire-escape', 'sidewalk-shed', 'deli-awning',
  'standpipe', 'ac-units', 'antenna', 'satellite', 'pennant',
  'clock', 'neon-sign', 'banner', 'billboard', 'chimney',
  'roof-garden', 'vent-stack', 'weathervane', 'string-lights', 'solar-panel',
  'ladder', 'planters', 'pigeons', 'gargoyle', 'beacon', 'crane',
] as const
export type Ornament = (typeof ORNAMENTS)[number]

interface TierLook {
  /** Drawn width of the body, before jitter. */
  width: number
  /** Extra height of the ground floor over an ordinary storey. */
  baseExtra: number
  windows: readonly WindowShape[]
  crowns: readonly CrownKind[]
  bases: readonly BaseKind[]
  bays: readonly number[]
  /** The one thing this form always has, or nothing. */
  signature: Ornament | null
  ornaments: readonly Ornament[]
  /** How many ornaments this kind of building tends to carry, beyond its signature. */
  clutter: readonly [number, number]
}

/**
 * Widths differ; storey height does not. That is deliberate — the skyline
 * promises true relative heights, and it stops being true the moment a tower's
 * floors are drawn shorter than a brownstone's. So a newsstand is a small box
 * and a supertall is a sliver, which is also how it works outside: 111 West
 * 57th is sixty feet wide and a quarter of a mile tall.
 */
export const FLOOR_HEIGHT = 26

const LOOKS: Record<TierName, TierLook> = {
  newsstand: {
    width: 84, baseExtra: 4,
    windows: ['shutter', 'plank', 'porthole'],
    crowns: ['lean-to', 'patched', 'tarp', 'gable', 'hip'],
    bases: ['yard', 'yard', 'shopfront'],
    bays: [1, 2, 2],
    signature: null,
    ornaments: ['string-lights', 'pigeons', 'planters', 'banner', 'neon-sign', 'pennant', 'vent-stack'],
    clutter: [1, 2],
  },
  bodega: {
    width: 118, baseExtra: 12,
    windows: ['plate-glass', 'shutter', 'grid', 'porthole'],
    crowns: ['false-front', 'parapet', 'cornice', 'dentil'],
    bases: ['shopfront', 'shopfront', 'yard'],
    bays: [2, 3, 3],
    // The awning is the bodega. A deli without one is a shop with the lights on.
    signature: 'deli-awning',
    ornaments: ['neon-sign', 'string-lights', 'planters', 'pigeons', 'banner', 'ac-units', 'pennant', 'standpipe', 'clock'],
    clutter: [1, 3],
  },
  brownstone: {
    width: 100, baseExtra: 14,
    windows: ['sash', 'tall', 'grid'],
    crowns: ['cornice', 'bracket-cornice', 'dentil', 'stepped'],
    // Three stoops to one shop: the high front steps are the whole point of the
    // form, and a garden-level shopfront is the one honest exception.
    bases: ['stoop', 'stoop', 'stoop', 'shopfront'],
    bays: [3, 3, 4],
    signature: null,
    ornaments: [
      'water-tower', 'roof-bulkhead', 'fire-escape', 'chimney', 'ac-units', 'planters',
      'pigeons', 'sidewalk-shed', 'standpipe', 'ladder', 'vent-stack', 'weathervane', 'pennant',
    ],
    clutter: [2, 3],
  },
  'cast-iron loft': {
    width: 128, baseExtra: 16,
    windows: ['arched', 'round-top', 'tall'],
    crowns: ['bracket-cornice', 'pediment', 'balustrade', 'cornice'],
    bases: ['arcade', 'colonnade', 'shopfront'],
    bays: [4, 4, 5],
    // Down the front, zig-zagging past the arched bays. Every block of Greene
    // Street has them and they are half of why the block looks like that.
    signature: 'fire-escape',
    ornaments: [
      'water-tower', 'roof-bulkhead', 'clock', 'neon-sign', 'banner', 'ac-units',
      'planters', 'pigeons', 'sidewalk-shed', 'standpipe', 'pennant', 'string-lights',
    ],
    clutter: [2, 4],
  },
  'setback tower': {
    width: 116, baseExtra: 18,
    windows: ['grid', 'tall', 'ribbon', 'sash'],
    crowns: ['setback-crown', 'ziggurat', 'lantern', 'deck'],
    bases: ['colonnade', 'plaza', 'arcade', 'shopfront'],
    bays: [4, 5, 5, 6],
    signature: null,
    ornaments: [
      'water-tower', 'ac-units', 'antenna', 'satellite', 'beacon', 'billboard',
      'roof-garden', 'sidewalk-shed', 'pennant', 'pigeons', 'vent-stack', 'roof-bulkhead',
    ],
    clutter: [2, 3],
  },
  landmark: {
    width: 104, baseExtra: 20,
    windows: ['grid', 'ribbon', 'slit', 'tall'],
    crowns: ['spire', 'needle', 'dome', 'mast'],
    bases: ['plaza', 'colonnade', 'arcade'],
    bays: [4, 5, 6],
    signature: null,
    ornaments: [
      'gargoyle', 'beacon', 'antenna', 'satellite', 'clock', 'roof-garden',
      'ac-units', 'billboard', 'sidewalk-shed', 'pennant',
    ],
    clutter: [2, 3],
  },
  supertall: {
    // Sixty feet wide and a quarter of a mile tall. The joke is that it is true.
    width: 70, baseExtra: 22,
    windows: ['curtain-wall', 'ribbon', 'slit'],
    crowns: ['mechanical-floor', 'chisel', 'glass-fin', 'crown-terrace'],
    bases: ['plaza', 'colonnade'],
    bays: [2, 3, 3],
    signature: null,
    // The crane is here and nowhere else: a supertall is the only thing in this
    // city that is still going up.
    ornaments: ['crane', 'beacon', 'antenna', 'satellite', 'roof-garden', 'solar-panel', 'sidewalk-shed', 'pigeons'],
    clutter: [2, 3],
  },
}

// ---- the street between the buildings -------------------------------------

/**
 * The things that stand on the pavement rather than on anybody's plot.
 *
 * A hydrant belongs to the street, not to the building behind it, and drawing
 * it as an ornament would mean two hydrants on one kerb the moment two
 * buildings both rolled one. So these are seeded off the *city* and placed in
 * the gaps between plots — which also means a building keeps looking exactly
 * the same when its neighbour grows a storey, which is the promise the whole
 * file is built on. The building's own kerb-level piece is the `standpipe`.
 */
export const STREET_FURNITURE = ['hydrant', 'street-tree', 'steam-vent', 'subway-entrance'] as const
export type StreetFurniture = (typeof STREET_FURNITURE)[number]

export interface StreetFixture {
  kind: StreetFurniture
  /** Which gap it stands in. Gap 0 is the kerb before the first building. */
  gap: number
  /** Where across that gap, 0 at the left edge and 1 at the right. */
  at: number
  /** Drawn mirrored, so two hydrants on one street are not the same hydrant. */
  flip: boolean
  /** For whatever else the drawing wants to vary: a leaning tree, a plume. */
  seed: number
}

/**
 * How common each thing is, and how many of it one street may have.
 *
 * A hydrant and a bare tree in a pit are ordinary and can repeat. A steam vent
 * is a set piece — one per city, or the street turns into a fairground — and
 * the subway is allowed two, because a corner with entrances on both sides of
 * it is a real corner.
 */
const STREET_STOCK: ReadonlyArray<{ kind: StreetFurniture; weight: number; most: number }> = [
  { kind: 'hydrant', weight: 5, most: 3 },
  { kind: 'street-tree', weight: 5, most: 4 },
  { kind: 'steam-vent', weight: 2, most: 1 },
  { kind: 'subway-entrance', weight: 1, most: 2 },
]

/** Rather more gaps than any real skyline has, and a loop that cannot run away. */
const MOST_GAPS = 256

/**
 * What stands in the gaps of one city's street.
 *
 * `city` is any stable key for this skyline — the home's id will do. Each gap
 * is seeded on its own, `${city}:street:${gap}`, so adding a building at the
 * end of the row does not shuffle the furniture at the other end of it.
 */
export function streetFurniture(city: string, gaps: number): readonly StreetFixture[] {
  const count = Number.isFinite(gaps) ? Math.min(MOST_GAPS, Math.max(0, Math.floor(gaps))) : 0
  const placed: StreetFixture[] = []
  const used = new Map<StreetFurniture, number>()

  for (let gap = 0; gap < count; gap++) {
    const seed = seedOf(`${city}:street:${gap}`)
    const rng = new Chooser(seed)
    // Most of a street is pavement. Furniture in every gap reads as a diagram
    // of a street rather than as a street.
    if (!rng.chance(0.5)) continue

    const open = STREET_STOCK.filter((s) => (used.get(s.kind) ?? 0) < s.most)
    if (open.length === 0) continue
    const total = open.reduce((sum, s) => sum + s.weight, 0)
    let roll = rng.float(0, total)
    const chosen = open.find((s) => (roll -= s.weight) < 0) ?? open[0]!

    used.set(chosen.kind, (used.get(chosen.kind) ?? 0) + 1)
    placed.push({
      kind: chosen.kind,
      gap,
      // Kept off both edges so nothing is drawn touching a building.
      at: round2(rng.float(0.28, 0.72)),
      flip: rng.chance(0.5),
      seed,
    })
  }
  return placed
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
  /** The form's signature first, if it has one, then whatever it is carrying. */
  ornaments: readonly Ornament[]

  /** Degrees. The newsstand leans; nothing else does. */
  lean: number
  /** Vertical banding on the facade — pilasters between the bays. */
  pilasters: boolean
  /** A course line drawn between storeys. */
  bandCourse: boolean
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
  const carried = rng.some(look.ornaments, rng.int(look.clutter[0], look.clutter[1]))
  const ornaments = look.signature === null ? carried : [look.signature, ...carried]

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
    lean: tier.name === 'newsstand' ? rng.float(-3.2, 3.2) : 0,
    // The columns between the bays are what cast iron is *for*, and the piers
    // of a supertall are the only thing breaking up a quarter mile of glass.
    pilasters: rng.chance(pilasterChance(tier.name)),
    bandCourse: rng.chance(0.45),
  }
}

const pilasterChance = (tier: TierName): number =>
  tier === 'cast-iron loft' ? 0.85 : tier === 'supertall' ? 0.8 : 0.4

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
    // A supertall stops rather than finishes: an open braced mechanical floor,
    // a flat slice through the shaft, a fin of glass, one last terrace.
    case 'mechanical-floor': return 40
    case 'chisel': return 54
    case 'glass-fin': return 44
    case 'crown-terrace': return 36
  }
}

/**
 * Setbacks, for the forms that have them. A tower steps *in* as it rises, so
 * these are floor numbers counted up from the lobby with an inset per side.
 *
 * The setback tower is named after them — the 1916 zoning code made every tower
 * in midtown that shape, and it is the most recognisable massing in New York —
 * so it gets two or three, and the two above it get one or two.
 */
function setbacksFor(tier: TierName, floors: number, width: number, rng: Chooser): Setback[] {
  if (tier !== 'setback tower' && tier !== 'landmark' && tier !== 'supertall') return []
  if (floors < 6) return []
  const count = tier === 'setback tower' ? rng.int(2, 3) : rng.int(1, 2)
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

/*
 * There was a `ambientLights()` here: a seeded scatter that lit 16% of every
 * facade with "a light left on and nobody behind it".
 *
 * It was a good idea and it broke the one rule the product rests on. Because a
 * window was lit if the floor was working **or** if it fell in the scatter, the
 * quantity of marigold on a building had almost nothing to do with its work: a
 * review measured a home screen where every building had `working: 0` and found
 * all hundred-odd lit windows were decoration, while the strip underneath said
 * "9 in hand" and the page told the owner in words that the lit windows were
 * the floors working on them. A building captioned *nobody in yet* was drawn
 * with its lights on.
 *
 * A facade of empty holes was the thing this was meant to avoid, and the wall's
 * own `lit` chamfer already does that job without saying anything untrue. Light
 * is now a function of work and nothing else.
 */

/** The forms in order, for a screen that wants to show what comes next. */
export const TIER_ORDER: readonly TierName[] = [
  'newsstand', 'bodega', 'brownstone', 'cast-iron loft', 'setback tower', 'landmark', 'supertall',
]
