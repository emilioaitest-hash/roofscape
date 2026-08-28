/**
 * The city, printed.
 *
 * The terminal gets `render.ts`, which draws the same buildings out of box
 * characters. Both read the same headcount and the same tier, so the two cannot
 * disagree about what a building *is* — but a browser can hold a great deal more
 * than eleven columns of text, and pretending otherwise would waste the screen
 * that matters most. This is the home screen. It is allowed to be beautiful.
 *
 * It is a *print*, not a photograph. On paper you cannot emit light; you can
 * only mark where it fell. So there is no sky, no moon and no streetlight here:
 * the warm paper of the page shows through and is the sky, and every building
 * comes off two plates —
 *
 *   `.rs-plate-colour`  every flat wash, landed a millimetre or two off
 *   `.rs-plate-ink`     every line, one warm-black ink at one weight
 *
 * — with the colour plate carrying a seeded misregistration so no two buildings
 * are off by the same amount. Hovering snaps a building's colour back into
 * register. That costs one CSS transform and no JavaScript at all.
 *
 * Everything here is a pure function of a `BuildingDesign` plus what the
 * building is doing right now. No DOM, no measurement, no state: the daemon
 * renders it and hands over a string. That is what keeps one renderer honest —
 * the page cannot draw a building the CLI has never heard of, because the page
 * cannot draw a building at all.
 *
 * Local coordinates, inside one building: x = 0 is the centre line, y = 0 is the
 * pavement, and up is negative. Every helper below obeys that and nothing else
 * has to think about it.
 */
import type { BuildingDesign, Ornament, Palette, StreetFixture, WindowShape } from './design.js'
import { designFor, Chooser, seedOf, streetFurniture, type DesignInput } from './design.js'
import { floorsSaid } from './tiers.js'

/** What the building is doing, which is the only thing that animates. */
export interface BuildingState {
  /** Floors with work in hand. Lit from the top down: the manager is up there. */
  working?: number
  /** Approvals waiting on the owner. A pin goes into the roof. */
  waiting?: number
  /** A goal is running in this building right now. */
  busy?: boolean
}

export interface CityOptions {
  /**
   * Draw onto a canvas at least this wide, with the row centred in it.
   *
   * The page knows how wide it is and the daemon does not, so the page says.
   * Without it a city of two buildings is a small drawing marooned in the
   * middle of a large sheet, which reads as a failure to load.
   */
  width?: number
  /**
   * Aim for this total height, by giving the drawing whatever is left over as
   * air above it. Ignored when the tallest building already needs more.
   */
  height?: number
  /** Space between plots. */
  gap?: number
  /** Left and right margin. */
  margin?: number
  /** Narrowest canvas to draw onto. A single portrait wants a much tighter one. */
  minWidth?: number
  /** Sketch the anonymous rest of town behind. Off for a single portrait. */
  backdrop?: boolean
  /** Draw the nameplate under each building. */
  labels?: boolean
  /** An empty lot at the end, for breaking ground on the next one. */
  emptyLot?: boolean
  /**
   * A stable key for *this* street, which its furniture is seeded off.
   *
   * The home's id is the right thing to pass. A hydrant belongs to the kerb
   * rather than to the building behind it, so it cannot be seeded off a
   * building without two neighbours who both rolled one putting two hydrants on
   * one corner — and seeding it off the row as a whole would rearrange the far
   * end of the street every time somebody broke ground at this one.
   */
  city?: string
}

export interface CityBuilding extends DesignInput, BuildingState {
  /** Shown small under the name. */
  note?: string
}

const round = (n: number): number => Math.round(n * 100) / 100

const esc = (text: string): string =>
  String(text ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  )

/**
 * A colour, darkened. Used for the lip inside a window and for nothing else.
 *
 * The lip is not a design decision — it is the shadow the top of a hole casts
 * into itself, and it has to be the *same* hole's colour or the hole stops
 * looking like one. Deriving it is the only way to guarantee that across
 * twenty-five palettes.
 */
function darken(hex: string, amount: number): string {
  const channel = (i: number) => parseInt(hex.slice(i, i + 2), 16)
  return `#${[1, 3, 5]
    .map((i) => Math.round(channel(i) * (1 - amount)).toString(16).padStart(2, '0'))
    .join('')}`
}

/** How light a colour looks, 0–255, weighted the way the eye weights it. */
function lightness(hex: string): number {
  const c = (i: number) => parseInt(hex.slice(i, i + 2), 16)
  return 0.299 * c(1) + 0.587 * c(3) + 0.114 * c(5)
}

/** Blend, so a hole can be lifted toward its own wall rather than toward grey. */
function toward(from: string, to: string, amount: number): string {
  const c = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16)
  return `#${[1, 3, 5]
    .map((i) =>
      Math.round(c(from, i) + (c(to, i) - c(from, i)) * amount)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

/**
 * The darkest a hole is allowed to print.
 *
 * On warm paper a near-black fill stops reading as a recess and starts reading
 * as a puncture — the paper has a hole in it rather than the building having a
 * window. Eight of the eighteen palettes hand over a socket down at 25, which
 * on a black-steel supertall turned the whole facade into a slab with dots in
 * it. Two of them at once (a dark wall and a black socket) is the worst case
 * and it is exactly the top of the ladder.
 */
const HOLE_FLOOR = 42

/**
 * The socket, as it is actually printed: never below the floor above.
 *
 * Lifted toward its *own wall* rather than toward grey, so it stays the same
 * hole's colour — a brownstone's holes stay brown and a bottle-green loft's
 * stay green. That is what makes an opening read as cut into the material
 * rather than as pasted on top of it.
 */
function socketInk(palette: Palette): string {
  const have = lightness(palette.socket)
  if (have >= HOLE_FLOOR) return palette.socket
  const wall = lightness(palette.wall)
  if (wall <= have) return palette.socket
  return toward(palette.socket, palette.wall, Math.min(0.5, (HOLE_FLOOR - have) / (wall - have)))
}

// ---- the press ------------------------------------------------------------

interface ShapeOpts {
  /** Goes on the wash. Classes are the interface the page drives. */
  cls?: string
  rx?: number
  /** A wash with no line of its own — a shaded face, a chamfer. */
  outline?: boolean
  /** Placement. Goes on both plates, or the line lands somewhere else entirely. */
  transform?: string
  /** Extra attributes on the wash alone. */
  attrs?: string
}

/**
 * One drawing, kept as two plates.
 *
 * Every mark is pushed to both at once so a call site says "a roof, in roof
 * colour" rather than having to remember to outline it afterward. The two
 * arrays come out as two `<g>`s, colour first and ink over the top of it,
 * which is the order a two-colour job actually goes through the press.
 */
class Pen {
  readonly colour: string[] = []
  readonly ink: string[] = []

  /** A flat wash with no line of its own. */
  wash(markup: string): void {
    this.colour.push(markup)
  }

  /** A line with no wash under it. */
  line(d: string): void {
    this.ink.push(`<path d="${d}"/>`)
  }

  /** Raw ink, for the few shapes a path cannot say cheaply. */
  mark(markup: string): void {
    this.ink.push(markup)
  }

  rect(x: number, y: number, w: number, h: number, fill: string, o: ShapeOpts = {}): void {
    this.both(
      'rect',
      `x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}"${
        o.rx ? ` rx="${round(o.rx)}"` : ''
      }`,
      fill,
      o,
    )
  }

  shape(d: string, fill: string, o: ShapeOpts = {}): void {
    this.both('path', `d="${d}"`, fill, o)
  }

  disc(cx: number, cy: number, r: number, fill: string, o: ShapeOpts = {}): void {
    this.both('circle', `cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}"`, fill, o)
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, fill: string, o: ShapeOpts = {}): void {
    this.both(
      'ellipse',
      `cx="${round(cx)}" cy="${round(cy)}" rx="${round(rx)}" ry="${round(ry)}"`,
      fill,
      o,
    )
  }

  /** The same geometry twice: once as a wash, once as the line around it. */
  private both(tag: string, geometry: string, fill: string, o: ShapeOpts): void {
    const where = o.transform ? ` transform="${o.transform}"` : ''
    this.colour.push(
      `<${tag} ${o.cls ? `class="${o.cls}" ` : ''}${geometry}${where} fill="${fill}"${o.attrs ?? ''}/>`,
    )
    if (o.outline !== false) this.ink.push(`<${tag} ${geometry}${where}/>`)
  }
}

/** A rectangle as a path, for merging many of them into one node. */
const boxPath = (x: number, y: number, w: number, h: number): string =>
  `M ${round(x)} ${round(y)} H ${round(x + w)} V ${round(y + h)} H ${round(x)} Z`

// ---- one building ---------------------------------------------------------

/**
 * The massing, as a stack of blocks.
 *
 * Consecutive storeys of the same width are one rectangle rather than one per
 * floor: a tower with no setbacks should be a single clean shaft, not a ladder
 * of hairline seams where the fills meet.
 */
interface Block {
  fromFloor: number
  toFloor: number
  width: number
  /** Both negative; `top` is the smaller number. */
  top: number
  bottom: number
}

function widthAtFloor(design: BuildingDesign, floor: number): number {
  let w = design.width
  for (const setback of design.setbacks) if (floor >= setback.atFloor) w -= setback.inset * 2
  return Math.max(28, w)
}

function massing(design: BuildingDesign): Block[] {
  const blocks: Block[] = []
  const floorY = (floor: number) => -(design.baseHeight + floor * design.floorHeight)
  for (let floor = 0; floor < design.floors; floor++) {
    const width = widthAtFloor(design, floor)
    const last = blocks[blocks.length - 1]
    if (last && last.width === width) {
      last.toFloor = floor
      last.top = floorY(floor + 1)
      continue
    }
    blocks.push({ fromFloor: floor, toFloor: floor, width, top: floorY(floor + 1), bottom: floorY(floor) })
  }
  return blocks
}

/** The width of the topmost storey, which is what a crown has to sit on. */
const topWidth = (design: BuildingDesign): number => widthAtFloor(design, design.floors - 1)

/**
 * The highest roof that is not the top of the building.
 *
 * A setback tower's water tower stands on one of these, because a ledge is the
 * only flat thing on a tower that steps in, and a barrel on a stick against the
 * sky is a different — and much less true — drawing than one tucked into a
 * corner of the massing with the shaft still going up behind it.
 */
function highestLedge(design: BuildingDesign): { y: number; width: number } | null {
  const blocks = massing(design)
  for (let i = blocks.length - 1; i >= 1; i--) {
    const below = blocks[i - 1]!
    if (blocks[i]!.width < below.width) return { y: below.top - 5, width: below.width }
  }
  return null
}

/**
 * How far up the crown a thing left on the roof stands.
 *
 * Every one of these used to be placed at a *fraction of the crown's height*
 * above the roofline, which reads correctly on a twelve-unit parapet and puts a
 * satellite dish twenty-nine units into the open air beside a landmark's
 * ninety-six-unit spire. A roof is a roof: things stand on it, and a tall crown
 * is something they stand next to rather than something they climb.
 */
const perch = (design: BuildingDesign): number => -Math.min(design.crownHeight * 0.3, 10)

/**
 * The two colours a sidewalk shed is painted, which are not the building's.
 *
 * A shed does not belong to the building it is wrapped around — it belongs to
 * whoever is being paid to have put it there — so it does not take the
 * palette. This particular green is the one thing in New York that every
 * scaffolding contractor agrees about. Both clear the meaning bands by a mile.
 */
const SHED_GREEN = '#4E7150'
const SHED_PIPE = '#8C9AA0'

/**
 * One building, as an SVG group with its feet at the origin.
 *
 * Returned as a `<g>` rather than a whole `<svg>` so a city can place several of
 * them in one coordinate system, and so a single portrait and a row of thirty
 * come off exactly the same code path.
 */
export function buildingSvg(design: BuildingDesign, state: BuildingState = {}): string {
  const lean = design.lean
  const transform = lean === 0 ? '' : ` transform="rotate(${round(lean)} 0 0)"`
  const pen = new Pen()
  // What stands between the building and the street gets its own pair of
  // plates, printed after the building's. Ink always lands on top of colour, so
  // anything drawn into the building's own plates has the door and the
  // shopfront outlines showing straight through it — which for a sidewalk shed,
  // whose whole job is to be in the way, reads as a mistake rather than as a
  // misprint. Two colour plates carry the same misregistration, so the shed is
  // out of register by exactly as much as the building it is wrapped around.
  const front = new Pen()

  // The lobby, then the shaft, then whatever is on top.
  baseSvg(pen, design)
  const blocks = massing(design)
  for (const block of blocks) blockSvg(pen, design, block)
  setbackLedges(pen, design, blocks)
  windowsSvg(pen, design, state)
  crownSvg(pen, design, topWidth(design))
  for (const ornament of design.ornaments) {
    ornamentSvg(ornament === 'sidewalk-shed' ? front : pen, design, ornament)
  }

  const { dx, dy } = design.register
  const plate = (marks: readonly string[], ink: readonly string[]): string[] =>
    marks.length + ink.length === 0
      ? []
      : [
          `<g class="rs-plate-colour" style="--rs-dx:${dx}px;--rs-dy:${dy}px">`,
          ...marks,
          '</g>',
          '<g class="rs-plate-ink">',
          ...ink,
          '</g>',
        ]
  // Two nested groups on purpose. A CSS transform replaces an element's
  // `transform` attribute outright rather than composing with it, so the lean
  // and the hover lift cannot live on the same node — put them together and a
  // hovered shack stands up straight, which it should never do.
  return [
    groundShadow(design),
    '<g class="rs-building">',
    `<g class="rs-lean"${transform}>`,
    // Colour first, ink over it, exactly as it would go through a press.
    ...plate(pen.colour, pen.ink),
    ...plate(front.colour, front.ink),
    // The one thing that is never misprinted. See `waitingPin`.
    (state.waiting ?? 0) > 0 ? waitingPin(design) : '',
    '</g>',
    '</g>',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * The shadow the building throws, so it sits on the street instead of floating.
 *
 * A parallelogram down and to the right, because the light in this city comes
 * from the upper left and does so consistently. No blur filter: thirty blurred
 * shadows on one page is a muddy page and a slow one.
 */
function groundShadow(design: BuildingDesign): string {
  const half = design.width / 2 + 5
  const drop = 13
  const skew = 26
  const d = `M ${round(-half)} 0 L ${round(half)} 0 L ${round(half + skew)} ${drop} L ${round(-half + skew)} ${drop} Z`
  return `<path class="rs-shadow" d="${d}" fill="url(#rs-shadow)"/>`
}

/** One rectangle of shaft: the wall, the face turned away, the light on top. */
function blockSvg(pen: Pen, design: BuildingDesign, block: Block): void {
  const half = block.width / 2
  const height = block.bottom - block.top
  const { palette } = design

  pen.rect(-half, block.top, block.width, height, palette.wall)
  // The face turned away from the light, and the chamfer that catches it.
  pen.rect(half - block.width * 0.17, block.top, block.width * 0.17, height, palette.shade, { outline: false })
  pen.rect(-half, block.top, block.width, 3, palette.lit, { outline: false })

  if (design.pilasters) pilasters(pen, design, block)
  if (design.bandCourse) bandCourses(pen, design, block)
  if (design.tier.name === 'newsstand') boards(pen, design, block)
}

/**
 * The mismatched boards a newsstand is actually made of.
 *
 * Without this the first building anybody sees is a small tidy box, which is
 * the wrong promise: a kiosk is supposed to look like somebody threw it up in
 * an afternoon, so that the brownstone two hires later feels earned. Under
 * Overprint it is drawn rather than shaded — a few ink lines where the boards
 * meet, one patch of ply nailed over a gap, and a brace holding it together.
 */
function boards(pen: Pen, design: BuildingDesign, block: Block): void {
  const rng = new Chooser(seedOf(`${design.id}:weather`))
  const half = block.width / 2
  const height = block.bottom - block.top

  // Two per storey, above and below where the windows sit. A board drawn
  // straight through a window reads as a rendering fault rather than as timber.
  for (let floor = block.fromFloor; floor <= block.toFloor; floor++) {
    const storeyTop = -(design.baseHeight + (floor + 1) * design.floorHeight)
    for (const offset of [4.5, design.floorHeight - 4.5]) {
      const y = storeyTop + offset + rng.float(-0.8, 0.8)
      pen.line(`M ${round(-half)} ${round(y)} H ${round(half)}`)
    }
  }
  // A patch nailed over a gap, and a brace in each bottom corner. Corner to
  // corner it crossed the windows, which reads as a rendering fault rather than
  // as timber.
  const w = rng.float(14, 24)
  const h = rng.float(8, 13)
  pen.rect(
    rng.float(-half + 4, half - w - 4),
    rng.float(block.top + 3, block.bottom - h - 3),
    w,
    h,
    design.palette.trim,
  )
  const brace = Math.min(20, block.width * 0.2, height * 0.45)
  pen.line(`M ${round(-half + 2)} ${round(block.bottom - 2 - brace)} L ${round(-half + 2 + brace)} ${round(block.bottom - 2)}`)
  pen.line(`M ${round(half - 2)} ${round(block.bottom - 2 - brace)} L ${round(half - 2 - brace)} ${round(block.bottom - 2)}`)
}

/** Vertical piers between the bays. A flat facade with none reads as a box. */
function pilasters(pen: Pen, design: BuildingDesign, block: Block): void {
  const half = block.width / 2
  const margin = block.width * 0.08
  const pitch = (block.width - margin * 2) / design.bays
  for (let i = 0; i <= design.bays; i++) {
    const x = -half + margin + i * pitch
    pen.line(`M ${round(x)} ${round(block.top + 3)} V ${round(block.bottom)}`)
  }
}

/** A course line at every floor, which is what gives brick its scale. */
function bandCourses(pen: Pen, design: BuildingDesign, block: Block): void {
  const half = block.width / 2
  for (let floor = block.fromFloor; floor <= block.toFloor; floor++) {
    const y = -(design.baseHeight + floor * design.floorHeight)
    if (y >= block.bottom) continue
    pen.line(`M ${round(-half)} ${round(y)} H ${round(half)}`)
  }
}

/** The lip where a tower steps in. Without it a setback looks like a mistake. */
function setbackLedges(pen: Pen, design: BuildingDesign, blocks: readonly Block[]): void {
  for (let i = 1; i < blocks.length; i++) {
    const below = blocks[i - 1]!
    const above = blocks[i]!
    if (above.width >= below.width) continue
    pen.rect(-below.width / 2, below.top - 5, below.width, 5, design.palette.roof)
  }
}

// ---- windows: the socket and the counter ----------------------------------

/**
 * On a light ground, "lit" cannot mean "lighter than the wall". It means a hole
 * that has been filled. So every window is a socket cut into the facade, and
 * light is a *counter* sitting inside it:
 *
 *   an empty hole                  nobody on that floor
 *   a marigold counter             a light is on
 *   a brighter counter, a figure   somebody is in there working
 *
 * The third state is told by shape as well as by colour, which is why the
 * figure exists: it is what finally separates a light left on from work being
 * done, and a colour-blind owner reads it as readily as anybody.
 */
interface Bay {
  x: number
  y: number
  width: number
  height: number
  /** Flat index, counted from the ground up, left to right. */
  index: number
  floor: number
}

/**
 * How big an opening is, as a fraction of its storey and of its bay.
 *
 * A table rather than a chain of ternaries: twelve shapes is well past where a
 * nested conditional stays readable, and a shape nobody gave a size to should
 * be a compile error rather than a window quietly drawn at the default. The
 * numbers are the difference between a brownstone and a supertall as much as
 * the massing is — a sash is tall and narrow with wall either side of it, and a
 * curtain wall is the whole bay with a spandrel above and below and no wall at
 * all.
 */
const OPENING: Record<WindowShape, { h: number; w: number }> = {
  plank: { h: 0.42, w: 0.54 },
  // A roll-down shutter is the shopfront: it fills the opening it covers.
  shutter: { h: 0.54, w: 0.8 },
  sash: { h: 0.64, w: 0.44 },
  'plate-glass': { h: 0.54, w: 0.88 },
  arched: { h: 0.68, w: 0.5 },
  'round-top': { h: 0.64, w: 0.5 },
  tall: { h: 0.7, w: 0.42 },
  grid: { h: 0.55, w: 0.54 },
  ribbon: { h: 0.36, w: 0.84 },
  slit: { h: 0.7, w: 0.26 },
  porthole: { h: 0.52, w: 0.5 },
  'curtain-wall': { h: 0.76, w: 0.86 },
}

/** Shapes that run right out to the piers, so they get a narrower margin. */
const EDGE_TO_EDGE = new Set<WindowShape>(['ribbon', 'curtain-wall', 'plate-glass', 'shutter'])

function windowGrid(design: BuildingDesign): Bay[] {
  const bays: Bay[] = []
  const shape = design.window
  for (let floor = 0; floor < design.floors; floor++) {
    const blockWidth = widthAtFloor(design, floor)
    const half = blockWidth / 2
    const margin = blockWidth * (EDGE_TO_EDGE.has(shape) ? 0.07 : 0.12)
    const usable = blockWidth - margin * 2
    const pitch = usable / design.bays
    const floorTop = -(design.baseHeight + (floor + 1) * design.floorHeight)

    let height = design.floorHeight * OPENING[shape].h
    let width = pitch * OPENING[shape].w
    // A drilled round hole is only round if it is drawn round.
    if (shape === 'porthole') width = height = Math.min(width, height)
    const y = floorTop + (design.floorHeight - height) / 2

    for (let bay = 0; bay < design.bays; bay++) {
      const centre = -half + margin + pitch * (bay + 0.5)
      bays.push({
        x: centre - width / 2,
        y,
        width,
        height,
        index: floor * design.bays + bay,
        floor,
      })
    }
  }
  return bays
}

/**
 * How far inside its hole a counter sits.
 *
 * The same on both axes, which matters more than it looks: the busy state is
 * drawn by stroking the counter until it fills the socket, and a counter inset
 * by one amount across and another down cannot be grown back to the edge by a
 * single stroke width.
 */
const counterInset = (bay: Bay): number => Math.min(1.5, bay.width * 0.2, bay.height * 0.2)

/**
 * The outline of one opening.
 *
 * Twelve shapes sharing one grammar, so that a street of arched cast iron and a
 * street of curtain wall are recognisably the same city. `inset` gives the
 * counter: the same hole, a little smaller, sitting inside it.
 */
function socketPath(shape: WindowShape, bay: Bay, inset = 0): string {
  const x = bay.x + inset
  const y = bay.y + inset
  const w = bay.width - inset * 2
  const h = bay.height - inset * 2
  const r = w / 2

  switch (shape) {
    case 'porthole':
      return `M ${round(x)} ${round(y + r)} A ${round(r)} ${round(r)} 0 1 1 ${round(x + w)} ${round(y + r)} A ${round(r)} ${round(r)} 0 1 1 ${round(x)} ${round(y + r)} Z`
    case 'arched':
      return `M ${round(x)} ${round(y + h)} V ${round(y + r)} A ${round(r)} ${round(r)} 0 0 1 ${round(x + w)} ${round(y + r)} V ${round(y + h)} Z`
    case 'round-top':
      return `M ${round(x)} ${round(y + h)} V ${round(y + r * 0.7)} Q ${round(x)} ${round(y)} ${round(x + r)} ${round(y)} Q ${round(x + w)} ${round(y)} ${round(x + w)} ${round(y + r * 0.7)} V ${round(y + h)} Z`
    case 'slit': {
      const cap = Math.min(r, h / 2)
      return `M ${round(x)} ${round(y + cap)} A ${round(cap)} ${round(cap)} 0 0 1 ${round(x + w)} ${round(y + cap)} V ${round(y + h - cap)} A ${round(cap)} ${round(cap)} 0 0 1 ${round(x)} ${round(y + h - cap)} Z`
    }
    default:
      return boxPath(x, y, w, h)
  }
}

/**
 * The shadow the top of the hole casts into itself.
 *
 * Stroked rather than filled, because that is the one description of "the top
 * inside edge" that holds for a rectangle, an arch and a drilled circle alike.
 * Skipped on a socket too short to have an inside.
 */
function lipPath(shape: WindowShape, bay: Bay): string {
  const x = bay.x + 0.6
  const w = bay.width - 1.2
  const y = bay.y + 0.6
  const r = w / 2
  switch (shape) {
    case 'porthole':
      return `M ${round(x)} ${round(y + r)} A ${round(r)} ${round(r)} 0 0 1 ${round(x + w)} ${round(y + r)}`
    case 'arched':
    case 'slit':
      return `M ${round(x)} ${round(y + r)} A ${round(r)} ${round(r)} 0 0 1 ${round(x + w)} ${round(y + r)}`
    case 'round-top':
      return `M ${round(x)} ${round(y + r * 0.7)} Q ${round(x)} ${round(y)} ${round(x + r)} ${round(y)} Q ${round(x + w)} ${round(y)} ${round(x + w)} ${round(y + r * 0.7)}`
    default:
      return `M ${round(x)} ${round(y)} H ${round(x + w)}`
  }
}

/**
 * Every window, with the lit ones marked rather than coloured.
 *
 * **Marigold means work in hand and nothing else.** This used to light a
 * sixteen-percent scatter of every facade as well, which meant that on a home
 * screen where every building reported `working: 0` roughly a hundred windows
 * were burning for decoration while the strip underneath said nine things were
 * in hand. A building captioned *nobody in yet* was drawn with its lights on.
 * A drawing that lies about its own state is worse than a plain one that does
 * not, so the scatter is gone: the floors that are working are lit, from the
 * top down, and every other opening is an empty hole. An idle facade of empty
 * sockets is *correct* — the chamfer along each mass already stops it reading
 * as abandoned.
 *
 * The class is the interface: the page toggles `rs-busy` as work starts and
 * stops without asking the daemon to draw the building again. A building only
 * has to be re-rendered when it grows.
 *
 * Sockets, lips and glazing bars are merged into one path per storey — a
 * twenty-storey tower has a hundred and twenty windows and four shapes each.
 * What is left per window is the counter, which the page has to be able to
 * address, and the figure, which is its sibling so that CSS can light one from
 * the other without a wrapper around each pair.
 */
function windowsSvg(pen: Pen, design: BuildingDesign, state: BuildingState): void {
  const { palette } = design
  const working = Math.max(0, Math.min(design.floors, state.working ?? 0))
  // Work lights a building from the head down, because that is the order it is
  // handed out in: the manager is on the top floor.
  const firstWorkingFloor = design.floors - working
  const shape = design.window
  const hole = socketInk(palette)
  const lip = darken(hole, 0.4)

  const rows = new Map<number, Bay[]>()
  for (const bay of windowGrid(design)) {
    const row = rows.get(bay.floor)
    if (row) row.push(bay)
    else rows.set(bay.floor, [bay])
  }

  pen.wash('<g class="rs-windows">')
  pen.mark('<g class="rs-windows">')

  for (const [, bays] of rows) {
    const sockets = bays.map((bay) => socketPath(shape, bay)).join(' ')
    pen.wash(`<path class="rs-socket" d="${sockets}" fill="${hole}"/>`)
    pen.line(sockets)
    if (bays[0]!.height >= 6) {
      const lips = bays.map((bay) => lipPath(shape, bay)).join(' ')
      pen.wash(
        `<path class="rs-lip" d="${lips}" fill="none" stroke="${lip}" stroke-width="1.2" stroke-linecap="round"/>`,
      )
    }
    // What divides the glass: the slats of a roll-down shutter, the meeting
    // rail of a sash, the mullion of a structural bay.
    //
    // Drawn twice, which is not a mistake. A muntin is painted stone or painted
    // steel, so against dark glass it is the *light* thing — draw it in ink and
    // it disappears into the socket, which is what happened to every sash
    // window in the city on the first pass. Against a lit window it is the dark
    // thing, silhouetted. So the pale one goes under the counter and the ink one
    // over it, and each window shows whichever of the two it can.
    const bars = glazingBars(shape, bays)
    if (bars) {
      pen.wash(
        `<path class="rs-mullion" d="${bars}" fill="none" stroke="${palette.lit}" stroke-width="1" stroke-linecap="round"/>`,
      )
    }

    for (const bay of bays) {
      const atWork = bay.floor >= firstWorkingFloor
      // Three flat marigolds, so a lit facade is a row of separate rooms rather
      // than one painted band. Chosen by position, so it never changes under a
      // re-render. The bay within its storey, offset by the storey — an earlier
      // form of this reduced to `index % 3`, which with a bay count divisible by
      // three made every column one fixed tone all the way up.
      const warmth = atWork ? ` rs-t${(bay.index + bay.floor * 2) % 3}` : ''
      const classes = `rs-w${atWork ? ' rs-on rs-busy' : ''}${warmth}`
      const inset = counterInset(bay)
      // The stroke width is what the third state is *made of*. A counter that
      // is merely lit sits inset in its hole; one with somebody at it is
      // stroked in its own colour until it fills the socket to the edge. That
      // difference survives at six pixels, where the old one — a marigold 1.8
      // L* brighter than the one next to it — did not survive at sixty.
      pen.wash(
        `<path class="${classes}" data-floor="${bay.floor}" d="${socketPath(shape, bay, inset)}" fill="${hole}" stroke-width="${round(inset * 2)}"/>`,
      )
      pen.wash(figure(bay, inset))
    }
    if (bars) pen.mark(`<path class="rs-bar" d="${bars}"/>`)
  }

  pen.wash('</g>')
  pen.mark('</g>')
}

/**
 * Somebody sitting at that window.
 *
 * Emitted for *every* opening, which it was not before: the figure was the
 * thing carrying the third state, and it was skipped on any bay under seven
 * units wide — which is nine of the fifty form-and-shape combinations, all of
 * them on the tallest buildings, where the states most needed telling apart. A
 * signal is not allowed to fall off a width threshold. Where there is no room
 * for a person there is a bar across the foot of the counter instead: the same
 * ink, the same meaning, and it survives being two pixels tall.
 *
 * Only ever on the colour plate — a figure that drifted out of its own window
 * would read as a bug rather than as a misprint.
 */
function figure(bay: Bay, inset: number): string {
  if (bay.width >= 7.5 && bay.height >= 7.5) {
    return `<circle class="rs-body" cx="${round(bay.x + bay.width * 0.32)}" cy="${round(bay.y + bay.height * 0.72)}" r="1.9"/>`
  }
  const bar = Math.max(1.2, Math.min(2.2, bay.height * 0.22))
  const x = bay.x + inset
  const w = Math.max(0.8, bay.width - inset * 2)
  return `<path class="rs-body" d="${boxPath(x, bay.y + bay.height - inset - bar, w, bar)}"/>`
}

/**
 * The bars across the glass, one merged path for a whole storey.
 *
 * This is most of what tells a brownstone's sash from a supertall's structural
 * bay at the size these are actually drawn at, and it costs one node a floor.
 */
function glazingBars(shape: WindowShape, bays: readonly Bay[]): string {
  const out: string[] = []
  for (const bay of bays) {
    const l = round(bay.x)
    const r = round(bay.x + bay.width)
    switch (shape) {
      case 'shutter': {
        // Slats. A roll-down shutter is nothing else.
        const slats = Math.max(2, Math.round(bay.height / 3.4))
        for (let i = 1; i < slats; i++) {
          const y = round(bay.y + (bay.height / slats) * i)
          out.push(`M ${l} ${y} H ${r}`)
        }
        break
      }
      case 'sash': {
        // The meeting rail, where the top sash laps the bottom one.
        const y = round(bay.y + bay.height * 0.44)
        out.push(`M ${l} ${y} H ${r}`)
        out.push(`M ${round(bay.x + bay.width / 2)} ${round(bay.y)} V ${round(bay.y + bay.height)}`)
        break
      }
      case 'grid': {
        const cx = round(bay.x + bay.width / 2)
        const cy = round(bay.y + bay.height / 2)
        out.push(`M ${cx} ${round(bay.y)} V ${round(bay.y + bay.height)}`)
        out.push(`M ${l} ${cy} H ${r}`)
        break
      }
      case 'curtain-wall': {
        // One mullion up the middle and a transom under the head: a bay of
        // glass with nothing else in it is a hole, not a building.
        const cx = round(bay.x + bay.width / 2)
        out.push(`M ${cx} ${round(bay.y)} V ${round(bay.y + bay.height)}`)
        out.push(`M ${l} ${round(bay.y + bay.height * 0.16)} H ${r}`)
        break
      }
      case 'plate-glass': {
        // A shopfront pane sits on a stall riser and has a transom over it.
        out.push(`M ${l} ${round(bay.y + bay.height * 0.22)} H ${r}`)
        break
      }
      default:
        break
    }
  }
  return out.join(' ')
}

// ---- the lobby ------------------------------------------------------------

/**
 * Glazing in the lobby.
 *
 * It is glass, and it is not a light. This used to light the first pane
 * unconditionally and flip a coin over the rest, so every building in the city
 * had marigold at street level whether anybody was working in it or not — the
 * largest single leak in a rule that says marigold means work in hand. The
 * lobby gets the wall's own caught light instead: glass reflecting the sky,
 * which is what a lobby window looks like from the pavement in the afternoon.
 *
 * Divided into panes with mullions between them, because a sheet of glazing the
 * width of the building is a lightbox rather than a way in.
 */
function lobbyGlazing(pen: Pen, design: BuildingDesign, x: number, y: number, w: number, h: number): void {
  const { palette } = design
  pen.rect(x, y, w, h, socketInk(palette))

  const panes = Math.max(1, Math.round(w / 17))
  const pitch = w / panes
  for (let i = 0; i < panes; i++) {
    if (i > 0) pen.line(`M ${round(x + pitch * i)} ${round(y)} V ${round(y + h)}`)
    const paneWidth = pitch - 3.4
    if (paneWidth < 2.5 || h < 5) continue
    pen.rect(x + pitch * i + 1.7, y + 1.7, paneWidth, h - 3.4, palette.lit, {
      cls: 'rs-glazing',
      outline: false,
    })
  }
}

/** The ground floor: where you walk in, and the only part at eye level. */
function baseSvg(pen: Pen, design: BuildingDesign): void {
  const width = design.width
  const half = width / 2
  const top = -design.baseHeight
  const { palette, accent } = design

  pen.rect(-half, top, width, design.baseHeight, palette.wall)
  pen.rect(half - width * 0.17, top, width * 0.17, design.baseHeight, palette.shade, { outline: false })
  pen.rect(-half, top, width, 3, palette.lit, { outline: false })

  // Everything in the lobby hangs below the sign band, and is measured from
  // what the sign leaves behind rather than from the lobby's full height. Left
  // to their own proportions, a shack's door and an awning both landed straight
  // through the lettering.
  const signBottom = top + Math.min(15, design.baseHeight * 0.38)
  const room = -signBottom
  const doorWidth = Math.min(20, width * 0.16)
  const doorHeight = room * 0.72
  const door = (lift = 0, at = 0) => {
    pen.rect(at - doorWidth / 2, -doorHeight - lift, doorWidth, doorHeight, accent, { cls: 'rs-door' })
    pen.line(`M ${round(at)} ${round(-doorHeight - lift + 2)} V ${round(-lift - 2)}`)
  }

  // A kiosk is not a small building, it is a counter with a roof over it, so it
  // gets its own ground floor rather than a shrunken version of somebody
  // else's. Every newsstand has one whichever base it rolled.
  if (design.tier.name === 'newsstand') {
    kiosk(pen, design, signBottom)
    facadeSign(pen, design, top, width)
    return
  }

  switch (design.base) {
    case 'shopfront': {
      const glassW = width * 0.3
      const glassY = signBottom + 13
      const glassH = Math.max(7, -glassY - 3)
      lobbyGlazing(pen, design, -half + width * 0.08, glassY, glassW, glassH)
      lobbyGlazing(pen, design, half - width * 0.08 - glassW, glassY, glassW, glassH)
      // A bodega carries a proper deli awning as its signature, drawn with the
      // ornaments and twice this size. Two awnings over one shopfront is one
      // awning too many.
      if (!design.ornaments.includes('deli-awning')) {
        awning(pen, design, -half + width * 0.06, half - width * 0.06, signBottom + 2)
      }
      door()
      break
    }
    case 'arcade': {
      const count = Math.max(3, design.bays)
      const pitch = (width * 0.86) / count
      const r = pitch * 0.38
      const doorBay = Math.floor(count / 2)
      const hole = socketInk(palette)
      for (let i = 0; i < count; i++) {
        const cx = -half + width * 0.07 + pitch * (i + 0.5)
        const spring = Math.max(-design.baseHeight * 0.42, signBottom + r + 3)
        const arch = `M ${round(cx - r)} -2 V ${round(spring)} A ${round(r)} ${round(r)} 0 0 1 ${round(cx + r)} ${round(spring)} V -2 Z`
        // The middle arch is the way in, so it is a door and not a dark hole.
        if (i === doorBay) {
          pen.shape(arch, accent, { cls: 'rs-door' })
          pen.line(`M ${round(cx)} ${round(-design.baseHeight * 0.46)} V -3`)
        } else {
          pen.shape(arch, hole)
          // Glass under an arch, not a light: an arcade lit end to end was
          // marigold on every cast-iron building in the city, all day, for
          // nothing.
          pen.wash(
            `<path class="rs-glazing" d="M ${round(cx - r + 1.6)} -3.5 V ${round(spring)} A ${round(r - 1.6)} ${round(r - 1.6)} 0 0 1 ${round(cx + r - 1.6)} ${round(spring)} V -3.5 Z" fill="${palette.lit}"/>`,
          )
        }
      }
      break
    }
    case 'colonnade': {
      const count = Math.max(4, design.bays + 1)
      const pitch = (width * 0.88) / (count - 1)
      lobbyGlazing(pen, design, -half + width * 0.06, -design.baseHeight * 0.7, width * 0.88, design.baseHeight * 0.56)
      for (let i = 0; i < count; i++) {
        const cx = -half + width * 0.06 + pitch * i
        pen.rect(cx - 3, signBottom + 6, 6, -signBottom - 6, palette.wall)
        pen.rect(cx - 4.5, signBottom + 2, 9, 4, palette.trim)
      }
      door()
      break
    }
    case 'plaza': {
      lobbyGlazing(pen, design, -half + width * 0.1, -design.baseHeight * 0.66, width * 0.8, design.baseHeight * 0.52)
      pen.rect(-half - 10, -6, width + 20, 6, palette.roof)
      pen.rect(-half + width * 0.08, signBottom + 3, width * 0.84, 4, accent)
      door()
      break
    }
    case 'stoop':
      stoop(pen, design, signBottom, doorWidth)
      break
    case 'yard':
    default: {
      door()
      lobbyGlazing(pen, design, -half + width * 0.12, signBottom + 3, width * 0.18, Math.max(6, room - 7))
      // The fence nobody has taken down.
      for (let i = 0; i < 5; i++) {
        const x = half - 5 - i * 5
        pen.line(`M ${round(x)} -11 V 0`)
      }
      pen.line(`M ${round(half - 26)} -8 H ${round(half - 4)}`)
      break
    }
  }

  facadeSign(pen, design, top, width)
}

/**
 * The high stoop. This is the most recognisable object in New York.
 *
 * Nobody has to be told what it is: a flight of steps climbing from the
 * pavement to a door a storey above it, iron railings either side, and the
 * garden-level door tucked in underneath. Four brownstones in a row and the
 * street is Brooklyn, at any size the drawing is ever shown at — which is why
 * this is a function with a stair and a railing in it rather than the three
 * stacked rectangles it used to be.
 *
 * Drawn to one side, seeded, because a row of houses with every stoop in the
 * middle is a diagram of a house rather than a row of them.
 */
function stoop(pen: Pen, design: BuildingDesign, signBottom: number, doorWidth: number): void {
  const { palette, accent } = design
  const half = design.width / 2
  const room = -signBottom
  const rng = new Chooser(seedOf(`${design.id}:stoop`))
  const side = rng.chance(0.5) ? -1 : 1

  // The parlour floor: high enough that the steps are obviously a climb, low
  // enough that the door still has a door's proportions above them.
  const lift = Math.max(9, Math.min(15, room * 0.52))
  const doorAt = -side * design.width * 0.13
  const landing = doorAt + side * (doorWidth / 2 + 2)
  const run = Math.min(design.width * 0.36, 36)
  const foot = landing + side * run
  const steps = 6

  // The flight, as one silhouette with a stepped top edge. Drawn as a single
  // shape rather than as six rectangles so the ink outlines the stair rather
  // than every tread inside it.
  const tread = run / steps
  const rise = lift / steps
  const edge: string[] = [`M ${round(landing - side * (doorWidth + 4))} ${round(-lift)}`, `L ${round(landing)} ${round(-lift)}`]
  for (let i = 0; i < steps; i++) {
    const x = landing + side * tread * (i + 1)
    edge.push(`L ${round(x)} ${round(-lift + rise * i)}`)
    edge.push(`L ${round(x)} ${round(-lift + rise * (i + 1))}`)
  }
  edge.push(`L ${round(landing - side * (doorWidth + 4))} 0 Z`)
  pen.shape(edge.join(' '), palette.trim)

  // The iron railing, which is half of what makes a stoop a stoop. It follows
  // the nosings up, on a newel post at each end, with balusters between.
  const railTop = -lift - 11
  const railFoot = -11
  pen.line(`M ${round(landing)} ${round(railTop)} L ${round(foot)} ${round(railFoot)}`)
  pen.line(`M ${round(landing)} ${round(railTop)} V ${round(-lift)}`)
  pen.line(`M ${round(foot)} ${round(railFoot)} V 0`)
  const balusters = 5
  for (let i = 1; i < balusters; i++) {
    const t = i / balusters
    const x = landing + (foot - landing) * t
    const yTop = railTop + (railFoot - railTop) * t
    pen.line(`M ${round(x)} ${round(yTop)} V ${round(-lift + lift * t)}`)
  }

  // The parlour door at the head of the steps, and the garden door underneath
  // it at the pavement — the half-storey nobody photographs and everybody
  // recognises.
  const doorHeight = Math.max(9, room - lift - 1)
  pen.rect(doorAt - doorWidth / 2, -lift - doorHeight, doorWidth, doorHeight, accent, { cls: 'rs-door' })
  pen.line(`M ${round(doorAt)} ${round(-lift - doorHeight + 2)} V ${round(-lift - 2)}`)

  const gardenAt = doorAt - side * (doorWidth / 2 + 9)
  pen.rect(gardenAt - 4.5, -11, 9, 11, socketInk(palette))
  pen.line(`M ${round(gardenAt - 8)} -13 H ${round(gardenAt + 8)}`)

  // And a tall parlour window on the far side of the door from the steps.
  const sill = -lift - 2
  const sashW = Math.min(14, design.width * 0.14)
  const sashX = doorAt - side * (doorWidth / 2 + 9 + sashW)
  if (Math.abs(sashX) + sashW / 2 < half - 4) {
    lobbyGlazing(pen, design, sashX - sashW / 2, sill - Math.max(10, room - lift - 3), sashW, Math.max(10, room - lift - 3))
  }
}

/**
 * A newsstand: a counter, a rack of papers and a bulb over the till.
 *
 * The kiosk is the one form on the ladder that has no lobby to speak of, and
 * drawing it with a door and a plate-glass window made it a very small office
 * block. What it has instead is the serving hatch you buy a paper through, the
 * rack the papers are clipped to, and the bulb somebody screwed into the
 * ceiling of it — which is the only light in this whole city that is neither a
 * window nor a signal, and is allowed to be marigold because it is a bulb.
 */
function kiosk(pen: Pen, design: BuildingDesign, signBottom: number): void {
  const { palette, accent } = design
  const half = design.width / 2
  const hatchW = design.width * 0.5
  const hatchY = signBottom + 5
  const hatchH = Math.max(9, -hatchY - 9)

  // The hatch, with the counter shelf across the bottom of it.
  pen.rect(-hatchW / 2, hatchY, hatchW, hatchH, socketInk(palette))
  pen.rect(-hatchW / 2 - 3, hatchY + hatchH, hatchW + 6, 3, palette.trim)

  // Papers on the counter, seen end-on: a short stack and a taller one.
  pen.rect(-hatchW / 2 + 3, hatchY + hatchH - 4, 11, 4, palette.lit)
  pen.rect(-hatchW / 2 + 16, hatchY + hatchH - 6, 9, 6, palette.lit)
  pen.line(`M ${round(-hatchW / 2 + 3)} ${round(hatchY + hatchH - 2)} H ${round(-hatchW / 2 + 14)}`)

  // The rack, bolted to the side: three shelves of magazines.
  const rackX = half - 4
  for (let i = 0; i < 3; i++) {
    const y = -8 - i * 8
    pen.rect(rackX - 12, y - 6, 12, 6, palette.lit)
    pen.line(`M ${round(rackX - 8)} ${round(y - 6)} V ${round(y)}`)
  }

  // The bulb, on its flex.
  pen.line(`M ${round(-hatchW * 0.22)} ${round(hatchY)} V ${round(hatchY + 5)}`)
  pen.disc(-hatchW * 0.22, hatchY + 7, 2.4, 'none', { cls: 'rs-bulb' })

  // The shutter, half down over the far end of the hatch. Every one of them has
  // one and half of them are stuck.
  pen.rect(-hatchW / 2, hatchY, hatchW * 0.34, hatchH * 0.42, palette.trim)
  for (let i = 1; i < 3; i++) {
    const y = hatchY + (hatchH * 0.42 * i) / 3
    pen.line(`M ${round(-hatchW / 2)} ${round(y)} H ${round(-hatchW / 2 + hatchW * 0.34)}`)
  }

  // And the way in, round the side.
  pen.rect(-half + 3, -12, 7, 12, accent, { cls: 'rs-door' })
}

/**
 * The name, over the door.
 *
 * A street tells you whose building is whose without a legend, and this is how
 * it does it. There is no text measurement here, so the size is estimated from
 * the character count and a long name falls back to initials rather than
 * running off the brickwork — a sign that does not fit is worse than a monogram.
 *
 * The lettering is on the ink plate and the board is on the colour plate, so a
 * badly registered building has a name that has slid a little off its board.
 * That is the joke and it is free.
 */
function facadeSign(pen: Pen, design: BuildingDesign, top: number, width: number): void {
  const boardWidth = width * 0.74
  const boardHeight = 12
  const name = design.name.trim().toUpperCase()
  // 0.68 em a character: bold, tracked, and measured against what came out
  // rather than against what a regular weight would have.
  const fitted = (boardWidth * 0.9) / Math.max(1, name.length * 0.68)
  const useInitials = fitted < 6.2
  const text = useInitials ? initials(design.name) : name
  const size = useInitials
    ? Math.min(10, (boardWidth * 0.8) / Math.max(1, text.length * 0.72))
    : Math.min(9.5, fitted)
  const y = top + 1.5

  pen.rect(-boardWidth / 2, y, boardWidth, boardHeight, 'none', { cls: 'rs-sign', rx: 1.5 })
  pen.rect(-boardWidth / 2, y, boardWidth, 1.6, design.accent, { outline: false })
  pen.mark(
    `<text class="rs-sign-text" x="0" y="${round(y + boardHeight - 3.6)}" text-anchor="middle" font-size="${round(size)}">${esc(text)}</text>`,
  )
}

/**
 * Up to three initials, for a name no shopfront could carry.
 *
 * Counted in characters rather than in UTF-16 units. Slicing a string by index
 * cuts an emoji in half, and half a surrogate pair is not a character: it
 * survives JSON intact and reaches the browser as a tofu box, or gets replaced
 * with U+FFFD the moment the SVG is written to a file. A building called 🏢
 * should get 🏢 on its sign or nothing.
 */
function initials(name: string): string {
  const words = name.split(/[\s\-_]+/).filter(Boolean)
  if (words.length === 1) return [...words[0]!].slice(0, 3).join('').toUpperCase()
  return words.slice(0, 3).map((w) => [...w][0]!.toUpperCase()).join('')
}

/** Stripes, in the accent and the wall's own caught light. */
function awning(pen: Pen, design: BuildingDesign, left: number, right: number, y: number): void {
  const width = right - left
  const drop = 9
  const face = (a: number, b: number) =>
    `M ${round(a)} ${round(y)} L ${round(b)} ${round(y)} L ${round(b - 4)} ${round(y + drop)} L ${round(a + 4)} ${round(y + drop)} Z`
  pen.shape(face(left, right), design.accent)
  const stripes = Math.max(3, Math.round(width / 12))
  for (let i = 1; i < stripes; i += 2) {
    const x = left + (width / stripes) * i
    pen.shape(face(x, x + width / stripes), design.palette.lit, { outline: false })
  }
}

// ---- crowns ---------------------------------------------------------------

/** What sits on top. Drawn from the top of the shaft upward. */
function crownSvg(pen: Pen, design: BuildingDesign, width: number): void {
  const half = width / 2
  const y = -(design.baseHeight + design.floors * design.floorHeight)
  const { palette, accent } = design
  const h = design.crownHeight
  const open = `<g class="rs-crown" transform="translate(0 ${round(y)})">`
  const colourFrom = pen.colour.length
  const inkFrom = pen.ink.length

  switch (design.crown) {
    case 'lean-to':
      pen.shape(
        `M ${round(-half - 5)} 0 L ${round(half + 5)} ${round(-h)} L ${round(half + 5)} ${round(-h + 6)} L ${round(-half - 5)} 6 Z`,
        palette.roof,
      )
      break
    case 'patched':
      pen.rect(-half - 4, -h, width + 8, h, palette.roof)
      pen.rect(-half + 6, -h - 3, width * 0.36, 7, palette.trim)
      pen.line(`M ${round(half - width * 0.3)} ${round(-h + 5)} H ${round(half - width * 0.06)}`)
      break
    case 'tarp':
      pen.shape(
        `M ${round(-half - 6)} 0 Q 0 ${round(-h * 1.7)} ${round(half + 6)} 0 L ${round(half + 6)} 6 Q 0 ${round(-h * 1.1)} ${round(-half - 6)} 6 Z`,
        palette.roof,
      )
      break
    case 'gable':
      pen.shape(`M ${round(-half - 7)} 0 L 0 ${round(-h)} L ${round(half + 7)} 0 Z`, palette.roof)
      pen.shape(`M ${round(-half - 7)} 0 L 0 ${round(-h)} L 0 0 Z`, palette.lit, { outline: false })
      break
    case 'hip':
      pen.shape(
        `M ${round(-half - 7)} 0 L ${round(-width * 0.22)} ${round(-h)} L ${round(width * 0.22)} ${round(-h)} L ${round(half + 7)} 0 Z`,
        palette.roof,
      )
      pen.shape(`M ${round(-half - 7)} 0 L ${round(-width * 0.22)} ${round(-h)} L 0 ${round(-h)} L 0 0 Z`, palette.lit, { outline: false })
      break
    case 'false-front':
      pen.rect(-half - 3, -h, width + 6, h, palette.wall)
      pen.rect(-half - 3, -h, width + 6, 4, palette.trim)
      pen.rect(-width * 0.3, -h + 9, width * 0.6, 8, accent)
      break
    case 'cornice':
      pen.rect(-half - 3, -h + 7, width + 6, h - 7, palette.shade)
      pen.rect(-half - 6, -h, width + 12, 7, palette.trim)
      break
    case 'parapet':
      pen.rect(-half - 2, -h, width + 4, h, palette.shade)
      pen.rect(-half - 2, -h, width + 4, 3.5, palette.trim)
      break
    case 'dentil': {
      pen.rect(-half - 2, -h + 13, width + 4, h - 13, palette.shade)
      pen.rect(-half - 7, -h, width + 14, 8, palette.trim)
      const count = Math.floor(width / 9)
      for (let i = 0; i < count; i++) {
        pen.rect(-half + 3 + i * 9, -h + 8, 4.5, 5, palette.trim)
      }
      break
    }
    case 'stepped':
      for (let i = 2; i >= 0; i--) {
        const w = width - i * (width * 0.22)
        pen.rect(-w / 2, -h + (2 - i) * (h / 3), w, h / 3 + 1, i % 2 ? palette.shade : palette.wall)
      }
      break
    case 'bracket-cornice': {
      // The SoHo signature: a cornice that projects far enough to throw a shadow.
      pen.rect(-half - 2, -h + 18, width + 4, Math.max(0, h - 18), palette.shade)
      const count = Math.max(4, design.bays + 1)
      const pitch = (width + 16) / (count - 1)
      for (let i = 0; i < count; i++) {
        const x = -half - 8 + pitch * i
        pen.shape(
          `M ${round(x - 3)} ${round(-h + 10)} L ${round(x + 3)} ${round(-h + 10)} L ${round(x + 1.8)} ${round(-h + 19)} L ${round(x - 1.8)} ${round(-h + 19)} Z`,
          palette.trim,
        )
      }
      pen.rect(-half - 9, -h + 5, width + 18, 5, palette.wall)
      pen.rect(-half - 11, -h, width + 22, 5, palette.trim)
      break
    }
    case 'pediment':
      pen.rect(-half - 2, -h + 16, width + 4, h - 16, palette.shade)
      pen.shape(
        `M ${round(-width * 0.34)} ${round(-h + 10)} L 0 ${round(-h)} L ${round(width * 0.34)} ${round(-h + 10)} Z`,
        palette.wall,
      )
      pen.rect(-half - 8, -h + 10, width + 16, 6, palette.trim)
      break
    case 'balustrade': {
      pen.rect(-half - 6, -4, width + 12, 5, palette.trim)
      const count = Math.floor(width / 10)
      for (let i = 0; i < count; i++) {
        const x = -half + 5 + i * 10
        pen.shape(
          `M ${round(x)} ${round(-h + 5)} L ${round(x + 3.4)} ${round(-h + 5)} L ${round(x + 2.4)} -4 L ${round(x + 1)} -4 Z`,
          palette.trim,
        )
      }
      pen.rect(-half - 6, -h, width + 12, 5, palette.trim)
      break
    }
    case 'setback-crown':
      pen.rect(-half * 0.78, -h * 0.55, width * 0.78, h * 0.55, palette.wall)
      pen.rect(-half * 0.5, -h, width * 0.5, h * 0.48, palette.shade)
      pen.rect(-half * 0.5, -h - 3.5, width * 0.5, 3.5, accent)
      break
    case 'ziggurat':
      for (let i = 2; i >= 0; i--) {
        const w = width * (0.82 - i * 0.22)
        pen.rect(-w / 2, -h * ((i + 1) / 3), w, h / 3 + 1, i % 2 ? palette.shade : palette.wall)
      }
      break
    case 'lantern':
      pen.rect(-half * 0.72, -h * 0.42, width * 0.72, h * 0.42, palette.wall)
      pen.rect(-half * 0.34, -h * 0.86, width * 0.34, h * 0.46, palette.shade)
      // Glazing, not a light. This one hard-coded `rs-w rs-on rs-busy` — the
      // class that means somebody is at that desk right now — with no
      // `data-floor` on it, so nothing in the product could ever clear it: a
      // building with nobody in it had one window permanently at work.
      pen.rect(-half * 0.24, -h * 0.8, width * 0.24, h * 0.32, palette.lit, { cls: 'rs-glazing' })
      pen.shape(
        `M ${round(-half * 0.4)} ${round(-h * 0.86)} L 0 ${round(-h)} L ${round(half * 0.4)} ${round(-h * 0.86)} Z`,
        palette.trim,
      )
      break
    case 'deck':
      pen.rect(-half, -h + 4, width, h - 4, palette.roof)
      pen.rect(-half - 3, -h, width + 6, 4.5, palette.trim)
      break
    case 'spire':
      pen.rect(-half * 0.62, -h * 0.3, width * 0.62, h * 0.3, palette.wall)
      pen.shape(
        `M ${round(-half * 0.44)} ${round(-h * 0.3)} L 0 ${round(-h * 0.94)} L ${round(half * 0.44)} ${round(-h * 0.3)} Z`,
        palette.shade,
      )
      pen.shape(`M ${round(-half * 0.44)} ${round(-h * 0.3)} L 0 ${round(-h * 0.94)} L 0 ${round(-h * 0.3)} Z`, palette.lit, { outline: false })
      pen.line(`M 0 ${round(-h * 0.94)} V ${round(-h)}`)
      beacon(pen, 0, -h * 0.66, 9)
      break
    case 'needle':
      pen.rect(-half * 0.5, -h * 0.2, width * 0.5, h * 0.2, palette.wall)
      pen.shape(
        `M ${round(-half * 0.2)} ${round(-h * 0.2)} L 0 ${round(-h * 0.98)} L ${round(half * 0.2)} ${round(-h * 0.2)} Z`,
        palette.trim,
      )
      // The observation deck, glazed. It used to be `rs-w rs-on`, permanently.
      pen.disc(0, -h * 0.42, width * 0.15, palette.shade)
      pen.disc(0, -h * 0.42, width * 0.09, palette.lit, { cls: 'rs-glazing', outline: false })
      beacon(pen, 0, -h * 0.62)
      break
    case 'dome':
      pen.rect(-half * 0.7, -h * 0.24, width * 0.7, h * 0.24, palette.wall)
      pen.shape(
        `M ${round(-half * 0.62)} ${round(-h * 0.24)} A ${round(half * 0.62)} ${round(h * 0.6)} 0 0 1 ${round(half * 0.62)} ${round(-h * 0.24)} Z`,
        palette.shade,
      )
      pen.shape(
        `M ${round(-half * 0.62)} ${round(-h * 0.24)} A ${round(half * 0.62)} ${round(h * 0.6)} 0 0 1 0 ${round(-h * 0.84)} Z`,
        palette.lit,
        { outline: false },
      )
      pen.line(`M 0 ${round(-h * 0.84)} V ${round(-h)}`)
      break
    case 'mast':
      pen.rect(-half * 0.6, -h * 0.26, width * 0.6, h * 0.26, palette.wall)
      pen.shape(`M -6 ${round(-h * 0.26)} L -2 ${round(-h)} L 2 ${round(-h)} L 6 ${round(-h * 0.26)} Z`, palette.trim)
      pen.line(`M -9 ${round(-h * 0.62)} H 9`)
      pen.line(`M -6.5 ${round(-h * 0.8)} H 6.5`)
      beacon(pen, 0, -h * 0.44, 12)
      break
    /*
     * The four supertall tops. A supertall does not finish, it *stops* — the
     * shaft runs out of budget or out of air rights and something perfunctory
     * is bolted on. That is the joke, and all four of these are things you can
     * see from the reservoir.
     */
    case 'mechanical-floor': {
      // 432 Park: two open braced storeys with the weather blowing through
      // them, so the tower reads as unfinished from a mile away. The paper
      // shows through on purpose — this is the one mass in the city that is not
      // filled in.
      const bays = 3
      const pitch = width / bays
      pen.rect(-half, -h, width, 5, palette.trim)
      pen.rect(-half, -6, width, 6, palette.trim)
      for (let i = 0; i <= bays; i++) {
        const x = -half + pitch * i
        pen.rect(x - 2, -h + 5, 4, h - 11, palette.shade, { outline: false })
        pen.line(`M ${round(x)} ${round(-h + 5)} V -6`)
      }
      for (let i = 0; i < bays; i++) {
        const l = -half + pitch * i
        pen.line(`M ${round(l + 2)} -6 L ${round(l + pitch - 2)} ${round(-h + 5)}`)
      }
      break
    }
    case 'chisel':
      // Citicorp: the shaft cut off on a slant, which was for solar panels that
      // never arrived and is now simply what the building looks like.
      pen.shape(
        `M ${round(-half)} 0 L ${round(-half)} ${round(-h * 0.28)} L ${round(half)} ${round(-h)} L ${round(half)} 0 Z`,
        palette.shade,
      )
      pen.shape(
        `M ${round(-half)} ${round(-h * 0.28)} L ${round(half)} ${round(-h)} L ${round(half)} ${round(-h + 6)} L ${round(-half)} ${round(-h * 0.28 + 6)} Z`,
        palette.lit,
        { outline: false },
      )
      pen.line(`M ${round(-half)} ${round(-h * 0.28 + 6)} L ${round(half)} ${round(-h + 6)}`)
      break
    case 'glass-fin': {
      // A parapet of plain glass with one fin standing off the top of it, which
      // is what a tower gets when the crown is the last thing left to cut.
      pen.rect(-half, -h * 0.34, width, h * 0.34, palette.shade)
      pen.rect(-half, -h * 0.34, width, 3.5, palette.trim)
      const fin = half * 0.34
      pen.shape(
        `M ${round(fin - 3)} ${round(-h * 0.34)} L ${round(fin - 3)} ${round(-h)} L ${round(fin + 3)} ${round(-h + 9)} L ${round(fin + 3)} ${round(-h * 0.34)} Z`,
        palette.trim,
      )
      beacon(pen, fin, -h * 0.72, 9)
      break
    }
    case 'crown-terrace': {
      // The last setback, with a rail round it. Somebody's terrace, and nobody
      // has ever been seen on one.
      pen.rect(-half * 0.82, -h * 0.55, width * 0.82, h * 0.55, palette.wall)
      pen.rect(-half * 0.82, -h * 0.55, width * 0.82, 3, palette.lit, { outline: false })
      pen.rect(-half, -6, width, 6, palette.roof)
      const posts = Math.max(4, Math.round(width / 9))
      for (let i = 0; i <= posts; i++) {
        const x = -half + (width * i) / posts
        pen.line(`M ${round(x)} -6 V -15`)
      }
      pen.line(`M ${round(-half)} -15 H ${round(half)}`)
      break
    }
  }

  // Everything the crown drew, moved up onto the top of the shaft.
  wrapRange(pen, colourFrom, inkFrom, open)
}

/**
 * An aircraft warning light: a flat marigold band across the mast.
 *
 * A bulb is allowed to be the colour of light — that is the rule, not a hole in
 * it. What it is *not* allowed to be is the same shape as the mark that means
 * something is waiting on you. This used to be a disc on the tip of a spire or
 * a needle, which is a vertical post with a ball on top: precisely the pin's
 * anatomy, in the other meaning colour, and it blinked. The documentation
 * claimed nothing else in the city had that silhouette and two crowns did.
 *
 * So it is a band across the shaft rather than a ball on the end of it, and it
 * is set below the tip so the top of a spire is bare ink.
 */
function beacon(pen: Pen, cx: number, cy: number, width = 8): void {
  pen.rect(cx - width / 2, cy - 2, width, 4, 'none', { cls: 'rs-beacon', rx: 1.2 })
}

/** Wrap the marks made since a mark in the log, on both plates at once. */
function wrapRange(pen: Pen, colourFrom: number, inkFrom: number, open: string): void {
  pen.colour.splice(colourFrom, 0, open)
  pen.colour.push('</g>')
  pen.ink.splice(inkFrom, 0, open)
  pen.ink.push('</g>')
}

// ---- what people leave on roofs -------------------------------------------

/**
 * The characters. A water tower that leans, a weathervane a few degrees off
 * true, a plant clearly nobody has watered — this is where the wit lives, and
 * it is the reason a row of six buildings the same height is worth looking at.
 */
function ornamentSvg(pen: Pen, design: BuildingDesign, ornament: Ornament): void {
  const roofY = -(design.baseHeight + design.floors * design.floorHeight)
  const width = topWidth(design)
  const half = width / 2
  const bodyHalf = design.width / 2
  const { palette, accent } = design
  // Deterministic placement, so the water tower does not wander between renders.
  const rng = new Chooser(seedOf(`${design.id}:${ornament}`))
  const side = rng.chance(0.5) ? -1 : 1
  const colourFrom = pen.colour.length
  const inkFrom = pen.ink.length
  const at = (dx: number, dy = 0, tilt = 0) =>
    `<g class="rs-ornament rs-o-${ornament}" transform="translate(${round(dx)} ${round(roofY + dy)})${
      tilt ? ` rotate(${round(tilt)})` : ''
    }">`

  switch (ornament) {
    case 'chimney': {
      pen.rect(-4.5, -22, 9, 24, palette.trim)
      pen.rect(-6.5, -26, 13, 4.5, palette.shade)
      // Smoke, drawn rather than glowed: on paper you cannot make anything pale.
      pen.mark('<path class="rs-smoke" d="M 0 -30 q -5 -5 0 -10 q 5 -5 0 -10" opacity="0.5"/>')
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.55, perch(design)))
      break
    }
    case 'vent-stack':
      pen.rect(-2.5, -16, 5, 17, palette.trim)
      pen.rect(-5.5, -20, 11, 4.5, palette.shade)
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.4))
      break
    case 'weathervane':
      // A few degrees off true, as they always are.
      pen.line('M 0 -21 V 0')
      pen.shape('M 0 -21 L 11 -16.5 L 0 -12 Z', accent)
      pen.line('M -6.5 -15 H 6.5')
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.45, perch(design), rng.float(-7, 7)))
      break
    case 'ladder': {
      pen.line('M -5 -27 V 0')
      pen.line('M 5 -27 V 0')
      for (let i = 0; i < 5; i++) pen.line(`M -5 ${-3 - i * 5} H 5`)
      wrapRange(pen, colourFrom, inkFrom, at(side * (half - 6)))
      break
    }
    case 'water-tower': {
      // A wooden barrel on a steel frame, and the single most New York object
      // there is. Banded, on four legs, with a conical lid.
      for (let i = -1; i <= 1; i += 2) pen.line(`M ${i * 9} -14 V 1`)
      pen.line('M -9 -8 L 9 -3')
      pen.rect(-13, -38, 26, 24, palette.trim, { rx: 2 })
      pen.shape('M -15 -38 L 0 -49 L 15 -38 Z', palette.roof)
      pen.line('M -13 -29 H 13')
      pen.line('M -13 -22 H 13')
      // On a setback tower it stands on a *lower* roof, which is where they
      // are — the ledge a tower leaves when it steps in is the only flat thing
      // on it. It leans, because nobody has ever straightened one of these.
      const ledge = highestLedge(design)
      const tilt = rng.float(-4.5, 4.5)
      if (ledge) {
        wrapRange(
          pen,
          colourFrom,
          inkFrom,
          `<g class="rs-ornament rs-o-water-tower" transform="translate(${round(side * ledge.width * 0.3)} ${round(ledge.y)}) rotate(${round(tilt)})">`,
        )
      } else {
        wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.5, perch(design), tilt))
      }
      break
    }
    case 'roof-bulkhead': {
      // The little brick box with the hatch in it, which is how anybody gets
      // onto a roof in the first place. Every rowhouse has one and nobody has
      // ever drawn one on purpose.
      const w = Math.min(26, width * 0.34)
      pen.rect(-w / 2, -17, w, 18, palette.wall)
      pen.rect(-w / 2 - 2.5, -21, w + 5, 4.5, palette.roof)
      pen.rect(-w * 0.22, -13, w * 0.44, 13, socketInk(palette))
      pen.line(`M ${round(w * 0.22)} -19 L ${round(w * 0.42)} -25`)
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.42, perch(design)))
      break
    }
    case 'standpipe': {
      // The fire-department siamese connection, bolted to the front at waist
      // height. Two brass outlets on a Y, and the only thing on a New York
      // facade that everybody walks past and nobody looks at.
      pen.line('M 0 -13 V 0')
      pen.line('M 0 -13 L -6 -19')
      pen.line('M 0 -13 L 6 -19')
      pen.disc(-6.5, -20, 3, palette.trim)
      pen.disc(6.5, -20, 3, palette.trim)
      pen.rect(-2.5, -13, 5, 13, palette.trim, { outline: false })
      wrapRange(
        pen,
        colourFrom,
        inkFrom,
        `<g class="rs-ornament rs-o-standpipe" transform="translate(${round(side * bodyHalf * 0.62)} 0)">`,
      )
      break
    }
    case 'gargoyle': {
      // One good joke per skyline, and it is on the landmark. A steel eagle
      // leaning out over the street from the corner of the crown, which is a
      // thing the Chrysler Building actually has six of.
      const out = side * 1
      pen.shape(
        `M 0 0 L ${round(out * 4)} -4 L ${round(out * 17)} -9 L ${round(out * 21)} -3 L ${round(out * 13)} 1 L ${round(out * 6)} 5 Z`,
        palette.trim,
      )
      pen.shape(`M ${round(out * 5)} -4 L ${round(out * 12)} -16 L ${round(out * 15)} -7 Z`, palette.shade)
      pen.line(`M ${round(out * 19)} -6 L ${round(out * 22)} -7`)
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.92, perch(design)))
      break
    }
    case 'deli-awning': {
      // The bodega's signature, so every one of them has it: a striped canvas
      // over the whole shopfront, a lettering board along the valance, and the
      // crates of fruit that are on the pavement outside by six in the morning.
      const left = -bodyHalf + 3
      const right = bodyHalf - 3
      const span = right - left
      const y = -design.baseHeight + Math.min(15, design.baseHeight * 0.38) + 2
      const drop = 11
      const lip = 6
      const face = (a: number, b: number) =>
        `M ${round(a)} ${round(y)} L ${round(b)} ${round(y)} L ${round(b - lip)} ${round(y + drop)} L ${round(a + lip)} ${round(y + drop)} Z`
      pen.shape(face(left, right), accent)
      const stripes = Math.max(4, Math.round(span / 13))
      for (let i = 1; i < stripes; i += 2) {
        const x = left + (span / stripes) * i
        pen.shape(face(x, x + span / stripes), palette.lit, { outline: false })
      }
      // The valance, and the lettering on it: dashes rather than words, because
      // a name at this size is a smudge and a smudge that says nothing is worse
      // than a rule that says "sign".
      pen.rect(left + lip, y + drop, span - lip * 2, 4.5, palette.lit)
      const words = [0.1, 0.34, 0.52, 0.74]
      for (const t of words) {
        const x = left + lip + (span - lip * 2) * t
        pen.line(`M ${round(x)} ${round(y + drop + 2.2)} H ${round(x + (span - lip * 2) * 0.14)}`)
      }
      // Crates, stacked two high on one side of the door.
      const crateAt = side * bodyHalf * 0.56
      for (let i = 0; i < 3; i++) {
        const cx = crateAt + (i % 2 ? 7 : -7)
        const cy = i < 2 ? -7 : -14
        pen.rect(cx - 7, cy, 14, 7, palette.trim)
        pen.line(`M ${round(cx - 7)} ${round(cy + 3.5)} H ${round(cx + 7)}`)
      }
      wrapRange(pen, colourFrom, inkFrom, '<g class="rs-ornament rs-o-deli-awning">')
      break
    }
    case 'ac-units': {
      for (let i = 0; i < 3; i++) {
        const x = -18 + i * 15
        pen.rect(x, -11, 12, 11, palette.trim, { rx: 1 })
        pen.mark(`<circle cx="${x + 6}" cy="-5.5" r="3.4"/>`)
      }
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.28))
      break
    }
    case 'antenna':
      pen.line('M 0 -42 V 0')
      pen.line('M -7 -34 H 7')
      pen.line('M -5.5 -28 H 5.5')
      pen.line('M -4 -22 H 4')
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.6, perch(design)))
      break
    case 'satellite':
      pen.line('M 0 -12 V 0')
      pen.shape('M -9 -13 A 9 6.5 0 0 1 9 -19 A 9 6.5 0 0 1 -9 -13 Z', palette.shade)
      pen.line('M 0 -16 L 3 -9')
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.62))
      break
    case 'pennant':
      pen.line('M 0 -30 V 0')
      pen.shape('M 1 -30 L 21 -26 L 1 -22 Z', accent, { cls: 'rs-pennant' })
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.7, perch(design)))
      break
    case 'clock':
      pen.disc(0, 0, 13, palette.trim)
      pen.disc(0, 0, 10, palette.lit)
      pen.line('M 0 -7 V 0')
      pen.line('M 0 0 H 6')
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.42, design.floorHeight * 1.7))
      break
    case 'neon-sign':
      pen.line('M 0 -26 V 0')
      pen.rect(-16, -41, 32, 16, palette.lit, { rx: 2 })
      pen.rect(-11, -36, 22, 3, accent, { cls: 'rs-neon', outline: false })
      pen.rect(-11, -31, 15, 3, accent, { cls: 'rs-neon', outline: false })
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.62, perch(design)))
      break
    case 'banner': {
      // In the blank margin beside the windows, hanging inward. Across the
      // window grid it read as a rendering fault rather than as cloth.
      const reach = 13 * -side
      pen.line('M 0 -4 V 30')
      pen.shape(
        `M 0 -2 L ${round(reach)} -2 L ${round(reach)} 30 L ${round(reach / 2)} 25 L 0 30 Z`,
        accent,
        { cls: 'rs-banner' },
      )
      wrapRange(pen, colourFrom, inkFrom, at(side * (bodyHalf - 3), design.floorHeight * 1.2))
      break
    }
    case 'roof-garden': {
      pen.rect(-26, -4, 52, 5, palette.trim)
      for (let i = 0; i < 5; i++) {
        const x = -20 + i * 10
        pen.disc(x, -8 - (i % 2) * 2.5, 4 + (i % 3), '#4F8A5B')
      }
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.25, perch(design)))
      break
    }
    case 'billboard':
      pen.line('M -16 -8 V 1')
      pen.line('M 16 -8 V 1')
      pen.rect(-20, -33, 40, 26, palette.lit, { rx: 1.5 })
      pen.rect(-15, -28, 24, 4, accent, { outline: false })
      pen.line('M -15 -21 H 15')
      pen.line('M -15 -16 H 3')
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.3, perch(design)))
      break
    case 'string-lights': {
      const span = design.width + 10
      pen.line(`M ${round(-span / 2)} -6 Q 0 12 ${round(span / 2)} -6`)
      for (let i = 1; i < 9; i++) {
        const t = i / 9
        const x = -span / 2 + span * t
        const sag = Math.sin(Math.PI * t) * 9
        pen.disc(x, -6 + sag, 2.2, 'none', { cls: 'rs-bulb' })
      }
      wrapRange(pen, colourFrom, inkFrom, at(0, -2))
      break
    }
    case 'solar-panel': {
      for (let i = 0; i < 3; i++) {
        const x = -21 + i * 15
        pen.shape(`M ${x} 0 L ${x + 13} 0 L ${x + 11} -10 L ${x - 2} -10 Z`, palette.shade)
      }
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.3, perch(design)))
      break
    }
    case 'planters': {
      for (let i = 0; i < 3; i++) {
        const x = -16 + i * 16
        pen.shape(`M ${x - 5} 0 L ${x + 5} 0 L ${x + 4} -7 L ${x - 4} -7 Z`, accent)
        // One of the three is clearly not being watered.
        if (i === 1) {
          pen.line(`M ${x} -7 q 4 -3 2 -8`)
          pen.line(`M ${x} -7 q -4 -2 -6 2`)
        } else {
          pen.disc(x, -10.5, 4.5, '#4F8A5B')
        }
      }
      wrapRange(pen, colourFrom, inkFrom, at(0, design.baseHeight + design.floors * design.floorHeight - 1))
      break
    }
    case 'pigeons': {
      // One silhouette per bird. Two overlapping circles draw two circles.
      // Every command after the first is relative, so where a bird stands is
      // the `M` and nothing else — which keeps the node free for CSS to peck.
      const bird = (x: number) =>
        `M ${round(x - 5.2)} -1.2 l 3.4 -2.2 c 0.2 -2.6 2.4 -3.4 3.8 -2.6` +
        ` c 0.2 -2.2 2.8 -2.2 2.8 0 l 2.4 0.7 l -2.3 0.8` +
        ` c 0.5 1.6 -0.6 3.4 -2.9 3.5 Z`
      for (let i = 0; i < 3; i++) {
        pen.shape(bird(-12 + i * 12 + (i % 2) * 3), palette.trim, { cls: 'rs-pigeon' })
      }
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.5, perch(design) - 1))
      break
    }
    case 'fire-escape': {
      // Down the FRONT, past the arched bays, which is where SoHo has them and
      // half of why a block of Greene Street looks like a block of Greene
      // Street. Kept inside the footprint: ironwork overhanging the brickwork
      // reads as a rendering fault rather than as iron.
      const platform = Math.min(design.width * 0.42, 46)
      const x = side * (design.width * 0.5 - platform / 2 - 4)
      const left = x - platform / 2
      const right = x + platform / 2
      for (let floor = 1; floor < design.floors; floor++) {
        const y = -(design.baseHeight + floor * design.floorHeight)
        // The landing, its rail, and the stanchions holding the rail up.
        pen.line(`M ${round(left)} ${round(y)} H ${round(right)}`)
        pen.line(`M ${round(left)} ${round(y - 9)} H ${round(right)}`)
        pen.line(`M ${round(left)} ${round(y - 9)} V ${round(y)}`)
        pen.line(`M ${round(right)} ${round(y - 9)} V ${round(y)}`)
        pen.line(`M ${round(x)} ${round(y - 9)} V ${round(y)}`)
        // The stair down to the landing below, alternating sides so the whole
        // thing zig-zags the way it does outside.
        const down = floor % 2 ? 1 : -1
        pen.line(
          `M ${round(x + (down * platform) / 2 - down * 3)} ${round(y)} L ${round(x - (down * platform) / 2 + down * 3)} ${round(y + design.floorHeight - 1)}`,
        )
      }
      // And the drop ladder over the pavement, hanging a storey short of it,
      // which is the whole point of a drop ladder.
      const dropTop = -(design.baseHeight + design.floorHeight)
      pen.line(`M ${round(x - 4)} ${round(dropTop)} V ${round(dropTop + 15)}`)
      pen.line(`M ${round(x + 4)} ${round(dropTop)} V ${round(dropTop + 15)}`)
      for (let i = 1; i < 4; i++) {
        pen.line(`M ${round(x - 4)} ${round(dropTop + i * 4)} H ${round(x + 4)}`)
      }
      wrapRange(pen, colourFrom, inkFrom, '<g class="rs-ornament rs-o-fire-escape">')
      break
    }
    case 'sidewalk-shed': {
      // The green plywood-and-pipe tunnel that has been outside every building
      // in New York since before anybody currently living moved here. It costs
      // three rectangles and it is funny because it is true.
      //
      // It stands in *front* of the building, so it is drawn on its own pair of
      // plates after both of the building's — see `buildingSvg`. Overprinted on
      // top of the ink plate it would have the door's outline showing straight
      // through it, which reads as a mistake rather than as a print.
      const span = design.width + 22
      const left = -span / 2
      const deck = -30
      pen.rect(left, deck, span, 7, SHED_GREEN)
      pen.rect(left, deck + 7, span, 3.5, darken(SHED_GREEN, 0.22), { outline: false })
      const legs = Math.max(3, Math.round(span / 30))
      for (let i = 0; i <= legs; i++) {
        const lx = left + (span * i) / legs
        pen.rect(lx - 2, deck + 10.5, 4, 30.5, SHED_PIPE)
      }
      pen.line(`M ${round(left)} ${round(deck + 24)} H ${round(left + span)}`)
      wrapRange(pen, colourFrom, inkFrom, '<g class="rs-ornament rs-o-sidewalk-shed">')
      break
    }
    case 'beacon':
      // A warning light on a plinth. Not a ball on a post — that shape belongs
      // to the pin and to nothing else in this city.
      pen.rect(-5, -8, 10, 9, palette.trim)
      beacon(pen, 0, -10, 12)
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.55, perch(design)))
      break
    case 'crane': {
      const height = 58
      pen.line(`M 0 ${-height} V 0`)
      pen.line(`M -26 ${-height + 2} H 36`)
      pen.line(`M 0 ${-height} L -22 ${-height + 4}`)
      pen.line(`M 0 ${-height} L 32 ${-height + 4}`)
      pen.line(`M 26 ${-height + 4} V ${-height + 24}`)
      pen.rect(22, -height + 24, 9, 6, accent)
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.7, perch(design)))
      break
    }
  }
}

/**
 * Something is waiting on the owner: a pin pushed into the roof.
 *
 * A base plate, a post, and a ball. Nothing else in the entire city is a
 * vertical post with a ball on top, so the *shape* carries the signal as
 * strongly as the vermilion does and a colour-blind owner reads it without
 * being told. Light sits inside an opening and you sit on top of the building;
 * they occupy different parts of the drawing and cannot be confused.
 *
 * It is the one thing here that is not printed. It is not part of the picture —
 * it is an object somebody pushed into it — so it is drawn in one piece,
 * outside both plates, and it never goes out of register. The mark that means
 * "decide something" is not allowed to look like a misprint.
 */
function waitingPin(design: BuildingDesign): string {
  const y = -(design.baseHeight + design.floors * design.floorHeight + design.crownHeight) - 4
  // Placed by the outer group and rocked by the inner one — CSS animating a
  // transform on the placed node would put the pin back at the pavement.
  return `<g transform="translate(0 ${round(y)})"><g class="rs-waiting">
  <rect class="rs-pin-base" x="-4.5" y="-3" width="9" height="3" rx="1"/>
  <rect class="rs-pin-post" x="-2" y="-23" width="4" height="21" rx="2"/>
  <circle class="rs-pin-ball" cx="0" cy="-27" r="7"/>
  <path class="rs-pin-shine" d="M -4.2 -29.4 A 4.6 4.6 0 0 1 -1.4 -31.6"/>
</g></g>`
}

// ---- the city -------------------------------------------------------------

/**
 * The whole skyline, as one self-contained `<svg>`.
 *
 * Sized to its contents: a city of shacks is not given the headroom of a city of
 * towers, because a great deal of empty paper above a row of sheds looks like a
 * bug rather than like restraint.
 */
export function citySvg(buildings: readonly CityBuilding[], options: CityOptions = {}): string {
  const gap = options.gap ?? 34
  const margin = options.margin ?? 60
  const designs = buildings.map((b) => ({ design: designFor(b), state: b, note: b.note }))

  // Either dimension on its own is worth honouring: the option's whole purpose
  // is to stop a drawing being marooned in a frame, and a caller who gives only
  // a width was once ignored entirely. A width with no height is taken as a
  // floor to reach rather than as a ratio to match.
  const asked = (value: number | undefined): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0

  const lotWidth = 150
  const bodyWidth = designs.reduce((sum, d) => sum + Math.max(d.design.width, 96), 0)
  const gapCount = Math.max(0, designs.length - (options.emptyLot === false ? 1 : 0))
  const rowWidth = bodyWidth + gap * gapCount + (options.emptyLot === false ? 0 : lotWidth)

  /**
   * The row is scaled up until it fills the width it was given.
   *
   * This used to fit by *padding*: zoom was capped at `860 / rowWidth`, so any
   * row wider than 860 units never grew past 1×, and everything left over went
   * into pavement on both sides. Measured on a 1361px viewport, six buildings
   * spanned 551px — forty percent of the width, with four hundred pixels of
   * dead paper either side — and the whole drawing came out at 0.687×. At that
   * scale `REGISTER_SLIP` lands at 1.1 CSS pixels and the lip inside a socket
   * at 0.82: the signature effect of the design language was below the
   * resolution of the screen it ships on, and every ornament carrying the wit
   * was a five-pixel speck.
   *
   * So it fits by scale instead. The buildings take most of the room, and only
   * what is left over becomes pavement.
   *
   * Two things it is deliberately *not* driven by. Not the frame's height: the
   * page hands this drawing a different height on every screen, and a building
   * that is drawn bigger on a taller window is a skyline whose heights cannot
   * be compared with yesterday's. And not the empty lot, which is a control
   * rather than a building — letting it into the basis magnified the plus sign
   * on an empty skyline until it was the size of a door.
   */
  const SHEET = 1180
  const MOST_ZOOM = 2.4
  /**
   * Below this the drawing stops being a drawing. A supertall in a short frame
   * has to give somewhere, and giving here is better than giving in width.
   */
  const LEAST_ZOOM = 0.72
  const zoomBasis = designs.length > 0 ? bodyWidth + gap * Math.max(0, designs.length - 1) : 860
  const room = Math.max(320, (asked(options.width) || SHEET) - margin * 2)
  const belowGround = options.labels === false ? 40 : 104

  /** The tallest thing to be drawn, before any zoom is applied to it. */
  const rawTallest = designs.reduce(
    (max, d) => Math.max(max, d.design.height + ornamentHeadroom(d.design)),
    110,
  )

  /**
   * Height constrains the zoom as well as width, which it did not used to.
   *
   * Fitting on width alone looked right until a supertall was on the street.
   * Then the drawing came out taller than the frame, and the block below —
   * which matches the frame's *shape* by widening — had to add pavement until
   * the ratios agreed. Measured: the page asked for 1600×620 and was handed a
   * sheet 3121 wide, with the six buildings spanning 1069 of it. A third of the
   * drawing was buildings and two thirds was empty pavement, which is exactly
   * the "postage stamp marooned in a half-empty sheet" a review found.
   *
   * So the height gets a vote. `1.09` is the sky the block below adds above the
   * roofline as a fraction of it; solving for the zoom that lands the whole
   * drawing inside the frame is cheaper than iterating, and near enough that
   * the widening has almost nothing left to do. Keep the two in step: a sky
   * fraction changed here and not there is a drawing that overflows its frame.
   */
  const wantsHeight = asked(options.height)
  const heightFit =
    wantsHeight > 0 ? (wantsHeight - belowGround) / (1.09 * Math.max(1, rawTallest)) : Infinity

  const zoom = Math.max(
    LEAST_ZOOM,
    Math.min(
      MOST_ZOOM,
      (room * 0.9) / Math.max(1, zoomBasis),
      room / Math.max(1, rowWidth),
      heightFit,
    ),
  )
  const scaled = rowWidth * zoom
  const natural = margin * 2 + scaled

  /**
   * Air above the roofline, so a low skyline is still a skyline.
   *
   * Enough that a building is not drawn touching the top of the frame, and no
   * more: the old floor of 320 units meant a street of newsstands was a small
   * drawing at the bottom of a tall empty rectangle, and a third of the home
   * screen was blank paper with nothing in it.
   */
  const tallest = Math.max(options.backdrop === false ? 110 : 220, rawTallest * zoom)
  // A city wants air above it; a portrait wants a margin. The backdrop being
  // off is what distinguishes the two, and it is the portrait that turns it off.
  const portrait = options.backdrop === false
  // Air above the roofline, and not a field. Every unit spent here is a unit
  // the buildings do not get, because the zoom is now fitted to the height as
  // well as the width — so generosity above the roofline is paid for in the
  // size of everything below it.
  const baseSky = portrait
    ? Math.max(24, Math.round(tallest * 0.07))
    : Math.max(40, Math.round(tallest * 0.09))
  /** What the drawing comes to on its own, before it is asked to fit anything. */
  const naturalHeight = baseSky + tallest + belowGround

  /**
   * Match the shape of the hole rather than the size of it.
   *
   * The page scales this to its own height, so the only thing that has to agree
   * is the ratio. A city too narrow for its frame is widened with pavement, and
   * the buildings stay the size they were drawn; a city too wide for it is left
   * alone and scrolls, because shrinking thirty buildings to fit one screen is
   * how you get thirty buildings nobody can tell apart.
   */
  const wantWidth = asked(options.width)
  const wantHeight = asked(options.height)
  const aspect = wantWidth > 0 && wantHeight > 0 ? wantWidth / wantHeight : 0

  // Bounded. `dust()` and `backdrop()` loop across the whole canvas, so a width
  // that runs away is megabytes of markup and, if the aspect were ever
  // non-finite, a loop that never ends. Wide enough for a very large skyline on
  // a very wide screen; nowhere near enough to hang anything.
  const MAX_WIDTH = 40_000
  /*
   * Widening to match the frame's shape is safe again, and it was not always.
   *
   * When the zoom was fitted to width alone, a street with a tall tower on it
   * came out taller than its frame, and matching the shape here meant adding
   * pavement until the ratios agreed: the page asked for 1600×620 and was
   * handed a sheet 3121 wide, of which the six buildings were 1069. Two thirds
   * of the drawing was empty pavement.
   *
   * The fix belonged upstream, and is upstream: the zoom is fitted to the
   * height as well, so the drawing already comes out close to the frame's
   * proportions and this has very little left to do. Capping it here instead
   * was treating the symptom, and it let a wide short frame letterbox.
   */
  const width = Math.min(
    MAX_WIDTH,
    Math.max(options.minWidth ?? 760, natural, wantWidth, aspect > 0 ? Math.round(naturalHeight * aspect) : 0),
  )

  /**
   * And the shortfall the other way is made up in air.
   *
   * Widening was only half of fitting a hole. A frame taller than the drawing's
   * own proportions could not be matched by adding pavement, so the ratios
   * stayed apart, and an SVG whose `preserveAspectRatio` is the default centres
   * that difference — a bar above the roofline and another below the street, on
   * every screen wider than it was tall. Four shacks in a large frame is the
   * common case, not the corner one.
   */
  const MAX_HEIGHT = 3000
  const extraSky =
    aspect > 0 ? Math.max(0, Math.min(MAX_HEIGHT, Math.round(width / aspect)) - naturalHeight) : 0

  const skyAbove = baseSky + extraSky
  const groundY = skyAbove + tallest
  const height = groundY + belowGround
  // Spare width becomes pavement on both sides rather than a hole on one.
  const spare = Math.max(0, (width - natural) / 2)

  const parts: string[] = []
  parts.push(
    `<svg class="rs-city" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(width)} ${round(height)}" width="${round(width)}" height="${round(height)}" role="img" aria-label="Your skyline: ${designs.length} building${designs.length === 1 ? '' : 's'}">`,
  )
  parts.push(cityDefs())
  parts.push(CITY_STYLE)

  // The paper. A portrait does not get one: it sits on a card that is already
  // a sheet, and a second sheet inside the first is a visible rectangle.
  if (!portrait) parts.push(`<rect class="rs-paper" x="0" y="0" width="${round(width)}" height="${round(height)}"/>`)
  if (!portrait) parts.push(dust(width, groundY))
  if (options.backdrop !== false) parts.push(backdrop(width, groundY))

  // The street: one line, and below it the paper goes darker. A portrait gets
  // the line and not the band, for the same reason it gets no paper — a card is
  // already a sheet, and a second ground inside it is a visible grey slab.
  if (!portrait) {
    parts.push(
      `<rect class="rs-under" x="0" y="${round(groundY)}" width="${round(width)}" height="${round(height - groundY)}"/>`,
    )
  }
  parts.push(`<path class="rs-street" d="M 0 ${round(groundY)} H ${round(width)}"/>`)

  /*
   * Where each gap in the row begins, so the street can be furnished.
   *
   * Gap 0 is the kerb before the first building; gap n is the pavement after
   * the last one. Collected as the row is laid out rather than recomputed,
   * because the two would drift apart the first time anybody changed a margin.
   */
  const gaps: Array<{ from: number; to: number }> = []
  let x = margin + spare
  gaps.push({ from: Math.max(4, x - gap * zoom), to: x })
  for (const { design, state, note } of designs) {
    const slot = Math.max(design.width, 96)
    const centre = x + (slot * zoom) / 2
    const waiting = (state.waiting ?? 0) > 0
    // The pin has to have a textual equivalent, or the one thing on this screen
    // that needs the owner is the one thing a screen reader does not mention.
    const label = `${esc(design.name)} — ${esc(design.tier.name)}, ${floorsSaid(design.headcount)}${
      waiting ? ', waiting on you' : ''
    }`
    // Scaled about its own feet, so the whole row still stands on one street.
    parts.push(
      `<g class="rs-plot" data-building="${esc(design.id)}" tabindex="0" role="button" aria-label="${label}" transform="translate(${round(centre)} ${round(groundY)}) scale(${round(zoom)})">`,
    )
    parts.push(buildingSvg(design, state))
    if (options.labels !== false) parts.push(nameplate(design, state, slot + gap * 0.8, note))
    // A generous invisible hit area: a newsstand is a small target otherwise —
    // and the same rectangle, drawn rather than left transparent, is where the
    // keyboard says it is. See `.rs-focus`.
    const hit = {
      x: -slot / 2 - gap / 2,
      y: -design.height - 40,
      w: slot + gap,
      h: design.height + 40 + (options.labels === false ? 10 : 76),
    }
    parts.push(
      `<rect class="rs-hit" x="${round(hit.x)}" y="${round(hit.y)}" width="${round(hit.w)}" height="${round(hit.h)}" fill="transparent"/>`,
    )
    parts.push(
      `<rect class="rs-focus" x="${round(hit.x)}" y="${round(hit.y)}" width="${round(hit.w)}" height="${round(hit.h)}" rx="6"/>`,
    )
    parts.push('</g>')
    x += slot * zoom
    gaps.push({ from: x, to: x + gap * zoom })
    x += gap * zoom
  }

  // The street itself, furnished. Drawn after the buildings so a tree stands in
  // front of the shadow the building next to it throws, and seeded off the city
  // rather than off any one building — a hydrant belongs to the kerb, and two
  // neighbours that both rolled one would put two on the same corner.
  parts.push(streetSvg(options.city ?? designs[0]?.design.id ?? 'roofscape', gaps, groundY, zoom))

  if (options.emptyLot !== false) {
    parts.push(emptyLot(x, groundY, lotWidth * zoom, zoom))
  }

  parts.push('</svg>')
  return parts.join('\n')
}

/**
 * The pavement, furnished.
 *
 * A street is not a row of buildings with air between them. It is a hydrant
 * nobody can park in front of, a tree in a pit with a guard round it that is
 * bare eight months of the year, a plume coming out of a stack in the middle of
 * the road, and a set of steps going down into the ground. Four things, drawn
 * between the plots rather than on them, and none of them belonging to any
 * building — which is what keeps decision 0013's promise intact: the building
 * you have not touched in a month still looks the same, however much its
 * neighbour has grown.
 */
function streetSvg(
  city: string,
  gaps: ReadonlyArray<{ from: number; to: number }>,
  groundY: number,
  zoom: number,
): string {
  const out: string[] = ['<g class="rs-street-kit">']
  for (const fixture of streetFurniture(city, gaps.length)) {
    const gap = gaps[fixture.gap]
    if (!gap) continue
    const span = gap.to - gap.from
    if (span < 18) continue
    const x = gap.from + span * fixture.at
    const flip = fixture.flip ? ' scale(-1 1)' : ''
    // Drawn a little under the buildings' own scale: street furniture at full
    // size next to a newsstand is a hydrant the size of a person.
    const size = round(Math.min(1.25, Math.max(0.7, zoom * 0.8)))
    out.push(
      `<g class="rs-fixture rs-f-${fixture.kind}" transform="translate(${round(x)} ${round(groundY)}) scale(${size})${flip}">`,
      streetPiece(fixture),
      '</g>',
    )
  }
  out.push('</g>')
  return out.length > 2 ? out.join('\n') : ''
}

/** One thing on the pavement. Ink and one flat wash, like everything else. */
function streetPiece(fixture: StreetFixture): string {
  const rng = new Chooser(fixture.seed)
  const pen = new Pen()
  switch (fixture.kind) {
    case 'hydrant':
      // Not vermilion, whatever colour they are outside. Vermilion means the
      // owner is needed, and a fire hydrant is not.
      pen.rect(-5.5, -3, 11, 3, HYDRANT)
      pen.rect(-3.5, -14, 7, 11, HYDRANT, { rx: 2 })
      pen.rect(-6.5, -11, 13, 3, HYDRANT)
      pen.disc(0, -15.5, 2.4, HYDRANT)
      break
    case 'street-tree': {
      // Bare, in a pit, with a guard round it. A tree in leaf is a green blob
      // and this city is not green.
      pen.rect(-9, -1.5, 18, 1.5, '#6E6A5E', { outline: false })
      pen.line('M -9 -1.5 H 9')
      const lean = rng.float(-4, 4)
      const trunk = `<g transform="rotate(${round(lean)})">`
      pen.mark(trunk)
      pen.mark('<path d="M 0 -2 V -30"/>')
      pen.mark('<path d="M 0 -20 L -9 -30 M 0 -24 L 8 -33 M 0 -14 L -7 -20 M 0 -28 L -4 -36 M 0 -28 L 5 -37"/>')
      pen.mark('</g>')
      for (let i = -1; i <= 1; i += 2) pen.line(`M ${i * 6} -9 V -1`)
      pen.line('M -6 -7 H 6')
      break
    }
    case 'steam-vent': {
      // The stack in the middle of the road with the plume coming out of it.
      // Banded rather than orange: an orange this size, this saturated, is the
      // brightest thing on the page and it does not mean anything.
      pen.rect(-9, -22, 18, 22, CHALK)
      for (let i = 0; i < 3; i++) pen.line(`M -9 ${round(-18 + i * 6)} H 9`)
      pen.line('M -11 -22 H 11')
      const drift = rng.float(-5, 5)
      pen.mark(
        `<path class="rs-steam" d="M -6 -24 q -6 -11 2 -19 q 7 -7 1 -16 M 5 -24 q 6 -9 -1 -17" transform="translate(${round(drift)} 0)" opacity="0.34"/>`,
      )
      break
    }
    case 'subway-entrance': {
      // Steps going down, a green railing, and a lamp on the newel. The lamp is
      // a square lantern and not a globe, because a ball on a post is the pin
      // and the pin has to stay the only one in the city.
      pen.rect(-15, 0, 30, 16, '#2A2723', { outline: false })
      for (let i = 0; i < 4; i++) pen.line(`M ${round(-15 + i * 3)} ${round(2 + i * 3.4)} H 15`)
      pen.line('M -15 0 H 15')
      for (let i = -1; i <= 1; i += 2) {
        pen.line(`M ${i * 15} -13 V 1`)
        pen.line(`M ${i * 15} -13 L ${i * 9} -7`)
      }
      pen.line('M -15 -13 H 15')
      pen.rect(-3, -24, 6, 8, LAMP_MARK, { cls: 'rs-lantern' })
      pen.line('M 0 -16 V -13')
      break
    }
  }
  return [...pen.colour, '<g class="rs-plate-ink">', ...pen.ink, '</g>'].join('')
}

/** A hydrant, a stack and a lantern, in colours that mean nothing. */
const HYDRANT = '#8A9089'
const CHALK = '#CFC4B1'
/** The one light on the pavement. A lamp is allowed to be the lamp colour. */
const LAMP_MARK = 'none'

/** How far above the roof an ornament can reach, so nothing gets clipped. */
function ornamentHeadroom(design: BuildingDesign): number {
  let extra = 36
  for (const ornament of design.ornaments) {
    if (ornament === 'antenna' || ornament === 'crane') extra = Math.max(extra, 66)
    else if (ornament === 'water-tower' || ornament === 'billboard' || ornament === 'pennant') extra = Math.max(extra, 56)
    else if (ornament === 'neon-sign' || ornament === 'clock') extra = Math.max(extra, 50)
  }
  return extra
}

/**
 * The only gradient left in the drawing, and it is a shadow rather than a
 * material. Everything else is a flat wash, because that is what a plate is.
 */
function cityDefs(): string {
  return `<defs>
  <linearGradient id="rs-shadow" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#6B533A" stop-opacity="0.24"/>
    <stop offset="1" stop-color="#6B533A" stop-opacity="0"/>
  </linearGradient>
</defs>`
}

/**
 * Dust in the paper.
 *
 * Where the stars used to be, and for the same reason: a completely even ground
 * reads as a screen rather than as a sheet of something. Static — paper does
 * not twinkle — and faint enough that you only notice it if you go looking.
 */
function dust(width: number, groundY: number): string {
  const rng = new Chooser(0x5c17)
  const out: string[] = ['<g class="rs-stars">']
  for (let i = 0; i < 36; i++) {
    out.push(
      `<circle cx="${round(rng.float(0, width))}" cy="${round(rng.float(0, groundY * 0.92))}" r="${round(rng.float(0.7, 1.7))}" opacity="${round(rng.float(0.05, 0.09))}"/>`,
    )
  }
  out.push('</g>')
  return out.join('')
}

/**
 * The rest of the city: anonymous, unfinished, and nobody's.
 *
 * Outline only, and no windows at all. It reads as somebody sketched the rest
 * of town and did not colour it in, which is exactly the right amount of effort
 * to have spent on something that is not yours — and it means the buildings
 * that *are* yours are the only coloured things on the page. Three depths, so
 * the parallax has something to work with.
 */
function backdrop(width: number, groundY: number): string {
  const layers = [
    { seed: 0x9e11, opacity: 0.1, min: 70, max: 210, step: 52, y: groundY - 30 },
    { seed: 0x4b73, opacity: 0.16, min: 55, max: 160, step: 44, y: groundY - 16 },
    { seed: 0x37a2, opacity: 0.24, min: 40, max: 120, step: 62, y: groundY - 4 },
  ]
  const drawn = layers.map((layer) => {
    const rng = new Chooser(layer.seed)
    const strokes: string[] = []
    let x = -30
    while (x < width + 30) {
      const w = rng.float(layer.step * 0.55, layer.step * 1.25)
      const h = rng.float(layer.min, layer.max)
      strokes.push(boxPath(x, layer.y - h, w, h))
      // A few of them get something on top, which is what stops a backdrop from
      // reading as a bar chart.
      if (rng.chance(0.24)) strokes.push(boxPath(x + w * 0.3, layer.y - h - 15, w * 0.4, 15))
      if (rng.chance(0.14)) strokes.push(`M ${round(x + w * 0.46)} ${round(layer.y - h - 28)} V ${round(layer.y - h)}`)
      x += w + rng.float(3, 15)
    }
    return `<g opacity="${layer.opacity}"><path d="${strokes.join(' ')}"/></g>`
  })
  // Two handles, three depths: `app.js` parallaxes by selector and the far pair
  // move together, which is what "far" means.
  return `<g class="rs-backdrop"><g class="rs-far">${drawn[0]}${drawn[1]}</g><g class="rs-mid">${drawn[2]}</g></g>`
}

/**
 * The name, and what the building is doing. Set like a museum label.
 *
 * The *form* is deliberately not written here. A building that has to caption
 * itself "cast-iron block" is one whose drawing has failed, and the whole claim
 * of decision 0009 is that the drawing does not fail. It is on the hover title
 * for anyone who wants the word.
 */
function nameplate(design: BuildingDesign, state: BuildingState, slot: number, note?: string): string {
  const status = note ?? floorsSaid(design.headcount)
  const busy = state.busy === true
  // No text measurement available here, so estimate from the type size. Erring
  // toward truncation is right: two labels touching looks broken, and one
  // ellipsis does not.
  const name = clip(design.name, Math.floor(slot / 8.6))
  const statusText = clip(status, Math.floor(slot / 6))
  return `<g class="rs-plate">
  <title>${esc(design.name)} — ${esc(design.tier.name)}, ${floorsSaid(design.headcount)}</title>
  <text class="rs-name" x="0" y="38" text-anchor="middle">${esc(name)}</text>
  <text class="rs-note" x="0" y="58" text-anchor="middle">${esc(statusText)}</text>
  ${busy ? '<circle class="rs-busy-dot" cx="0" cy="72" r="3.2"/>' : ''}
</g>`
}

/** Truncate by characters, not by UTF-16 units — see `initials` for why. */
const clip = (text: string, max: number): string => {
  const characters = [...text]
  const limit = Math.max(4, max)
  return characters.length > limit
    ? `${characters.slice(0, Math.max(3, max - 1)).join('')}…`
    : text
}

/**
 * Where the next one goes.
 *
 * The dash *is* the meaning — nothing here yet, and a solid line would be a
 * claim that something is. Hovering takes it to ink and never to the lamp:
 * marigold means a light is on, and an empty lot is the one place in the city
 * where nothing is.
 */
function emptyLot(x: number, groundY: number, width: number, zoom = 1): string {
  const inner = width / zoom
  return `<g class="rs-lot" data-lot="1" tabindex="0" role="button" aria-label="Break ground on a new building" transform="translate(${round(x + width / 2)} ${round(groundY)}) scale(${round(zoom)})">
  <rect class="rs-lot-plot" x="${round(-inner / 2)}" y="-124" width="${round(inner)}" height="124" rx="6"/>
  <path class="rs-lot-plus" d="M -13 -62 H 13 M 0 -75 V -49"/>
  <text class="rs-lot-text" x="0" y="38" text-anchor="middle">Break ground</text>
  <text class="rs-note" x="0" y="58" text-anchor="middle">Room for another</text>
  <rect class="rs-focus" x="${round(-inner / 2 - 8)}" y="-132" width="${round(inner + 16)}" height="196" rx="6"/>
</g>`
}

/**
 * Style and animation, inline, because the SVG has to survive being handed
 * around on its own.
 *
 * Every colour goes through a token with the token's own value as the fallback,
 * so the page's palette wins where there is one and the drawing still works
 * where there is not. Motion is slow and small on purpose: a home screen that
 * twitches is one people close.
 */
const CITY_STYLE = `<style>
  .rs-city { display: block; }
  .rs-paper { fill: var(--ground, #F1EBDD); }
  .rs-under { fill: var(--sunk, #E6DECC); }
  .rs-street { stroke: var(--ink, #1E1B16); stroke-width: 1.75; fill: none; stroke-linecap: round; }
  .rs-stars circle { fill: var(--ink, #1E1B16); }
  .rs-backdrop path { fill: none; stroke: var(--ink-4, #A2987F); stroke-width: 1.25;
                      stroke-linejoin: round; stroke-linecap: round; }

  /* One ink, one weight, round caps. Every line in the city is this line. */
  .rs-plate-ink { fill: none; stroke: var(--ink, #1E1B16); stroke-width: 1.6;
                  stroke-linecap: round; stroke-linejoin: round; }
  .rs-plate-colour { transform: translate(var(--rs-dx, 0px), var(--rs-dy, 0px));
                     transition: transform var(--base, .26s) var(--ease, cubic-bezier(.22,1,.36,1)); }
  .rs-plot:hover .rs-plate-colour, .rs-plot:focus-visible .rs-plate-colour { transform: none; }

  .rs-name { font: 600 17px/1 var(--serif, ui-serif, Georgia, "Times New Roman", serif);
             fill: var(--ink, #1E1B16); letter-spacing: .005em; }
  .rs-note { font: 400 12.5px/1 var(--sans, ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif);
             fill: var(--ink-3, #786F5D); letter-spacing: .01em; }
  .rs-lot-text { font: 600 15px/1 var(--serif, ui-serif, Georgia, "Times New Roman", serif);
                 fill: var(--ink-3, #786F5D); }
  .rs-sign { fill: var(--card, #FAF6EC); }
  .rs-sign-text { font-family: var(--sans, ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif);
                  font-weight: 700; letter-spacing: .06em; fill: var(--ink, #1E1B16); stroke: none; }

  /* A counter in a hole. Off, it is the hole. */
  .rs-w { transition: fill var(--slow, .42s) var(--ease, cubic-bezier(.22,1,.36,1)),
                      stroke var(--slow, .42s) var(--ease, cubic-bezier(.22,1,.36,1));
          stroke-linejoin: round; }
  .rs-on { fill: var(--lamp, #EFAA22); stroke: var(--lamp, #EFAA22); }
  /* Three flat marigolds, a shade either side of the lamp, so a lit facade is
     a row of separate rooms rather than one painted band. */
  .rs-on.rs-t0 { fill: #E39A1E; stroke: #E39A1E; }
  .rs-on.rs-t2 { fill: #F6BE52; stroke: #F6BE52; }
  .rs-busy { fill: var(--lamp, #EFAA22); stroke: var(--lamp, #EFAA22); }

  /* The third state is a *shape*, not a brighter yellow.

     It used to be #F7C556 against #F6BE52 — 1.8 L* apart, while the variation
     inside the ambient trio spanned eleven, so a window that meant nothing
     could be brighter than one that meant somebody was working. On warm paper
     there is no headroom above marigold and there never was going to be. So a
     counter with somebody at it is stroked in its own colour until it fills the
     socket edge to edge, and one that is merely lit stays inset with the hole
     showing round it. That difference survives at six pixels. */
  .rs-w:not(.rs-busy) { stroke: none; }

  /* Somebody at the window. Sibling rather than descendant: the counter is the
     element the page toggles, and its figure sits immediately after it. */
  .rs-body { fill: var(--ink, #1E1B16); opacity: 0; transition: opacity var(--base, .26s) ease; }
  .rs-w.rs-busy + .rs-body { opacity: .58; }

  .rs-plot { cursor: pointer; }
  .rs-plot:hover, .rs-plot:focus-visible, .rs-lot:focus-visible { outline: none; }
  .rs-building { transition: transform var(--base, .26s) var(--ease, cubic-bezier(.22,1,.36,1)); }
  .rs-plot:hover .rs-building, .rs-plot:focus-visible .rs-building { transform: translateY(-6px); }
  .rs-shadow { transition: opacity var(--base, .26s) ease; }
  .rs-plot:hover .rs-shadow, .rs-plot:focus-visible .rs-shadow { opacity: .7; }

  /* Where the keyboard is.

     Both plots and lots set \`outline: none\`, and every replacement was written
     on the same selector list as \`:hover\` — so a mouse and a keyboard produced
     exactly the same drawing and nothing on the page said which building was
     selected. This is focus's own mark and hover never draws it: a ruled frame
     round the plot, ink on paper, at a weight nothing else in the city uses. */
  .rs-focus { fill: none; stroke: var(--ink, #1E1B16); stroke-width: 2.4;
              stroke-dasharray: 3 5; stroke-linecap: round; opacity: 0; }
  .rs-plot:focus-visible .rs-focus, .rs-lot:focus-visible .rs-focus { opacity: 1; }

  .rs-lot { cursor: pointer; }
  .rs-lot-plot { fill: none; stroke: var(--line-strong, #C0B69E); stroke-width: 1.6;
                 stroke-dasharray: 9 8; stroke-linecap: round;
                 transition: stroke var(--base, .26s) ease; }
  .rs-lot-plus { stroke: var(--ink-3, #786F5D); stroke-width: 2.6; stroke-linecap: round; fill: none;
                 transition: stroke var(--base, .26s) ease; }
  .rs-lot:hover .rs-lot-plot, .rs-lot:focus-visible .rs-lot-plot { stroke: var(--ink, #1E1B16); }
  .rs-lot:hover .rs-lot-plus, .rs-lot:focus-visible .rs-lot-plus { stroke: var(--ink, #1E1B16); }
  .rs-lot:hover .rs-lot-text, .rs-lot:focus-visible .rs-lot-text,
  .rs-lot:hover .rs-note, .rs-lot:focus-visible .rs-note { fill: var(--ink, #1E1B16); }

  /* The pin. Vermilion, and the only vermilion in the drawing. */
  .rs-pin-base { fill: var(--flag-deep, #9C2F1B); }
  .rs-pin-post { fill: var(--flag, #D2452A); }
  .rs-pin-ball { fill: var(--flag, #D2452A); }
  .rs-pin-shine { fill: none; stroke: var(--ground, #F1EBDD); stroke-width: 2.4; stroke-linecap: round; opacity: .8; }

  /* The only loop left in the city.

     There were ten, four of them glows, and the eye goes to motion before it
     goes to anything else — so the first marigold anybody noticed in a street
     of thirty buildings was a decorative one blinking on a mast, while the mark
     that meant work was in hand sat perfectly still. Marigold is off animation
     and animation is off decoration. What is left is this: the pin rocks,
     because it was just pushed in. */
  .rs-waiting { transform-box: fill-box; transform-origin: 50% 100%;
                animation: rs-rock 3s var(--ease, cubic-bezier(.22,1,.36,1)) infinite; }
  @keyframes rs-rock { 0%, 100% { transform: rotate(-1.5deg) } 50% { transform: rotate(1.5deg) } }

  /* Lights that are lights: a warning band on a mast, a bulb on a flex, the
     lantern over a subway stair. Printed, not pulsing. */
  .rs-beacon, .rs-bulb, .rs-lantern { fill: var(--lamp, #EFAA22); }
  .rs-busy-dot { fill: var(--lamp, #EFAA22); }

  .rs-smoke, .rs-steam { fill: none; }

  .rs-fixture .rs-plate-ink { stroke-width: 1.5; }
  /* A glazing bar, at half the weight of a wall. */
  .rs-bar { stroke-width: 1; }

  @media (prefers-reduced-motion: reduce) {
    .rs-waiting { animation: none; }
    .rs-plot:hover .rs-building { transform: none; }
    .rs-plate-colour, .rs-building, .rs-w, .rs-body { transition: none; }
  }
</style>`

/**
 * One building on its own, for a company's own page.
 *
 * Framed tight. The city's minimum canvas is there so a row of buildings has
 * somewhere to stand; applied to a single portrait it produces one small
 * building adrift in a great deal of paper.
 */
export function portraitSvg(building: CityBuilding, options: CityOptions = {}): string {
  return citySvg([building], {
    gap: 0,
    margin: 30,
    minWidth: 0,
    width: 300,
    height: 380,
    backdrop: options.backdrop ?? false,
    labels: options.labels ?? false,
    emptyLot: false,
  })
}
