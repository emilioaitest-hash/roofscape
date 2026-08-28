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
import type { BuildingDesign, Ornament, WindowShape } from './design.js'
import { designFor, Chooser, seedOf, type DesignInput } from './design.js'
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

  // The lobby, then the shaft, then whatever is on top.
  baseSvg(pen, design)
  const blocks = massing(design)
  for (const block of blocks) blockSvg(pen, design, block)
  setbackLedges(pen, design, blocks)
  windowsSvg(pen, design, state)
  crownSvg(pen, design, topWidth(design))
  for (const ornament of design.ornaments) ornamentSvg(pen, design, ornament)

  const { dx, dy } = design.register
  // Two nested groups on purpose. A CSS transform replaces an element's
  // `transform` attribute outright rather than composing with it, so the lean
  // and the hover lift cannot live on the same node — put them together and a
  // hovered shack stands up straight, which it should never do.
  return [
    groundShadow(design),
    '<g class="rs-building">',
    `<g class="rs-lean"${transform}>`,
    // Colour first, ink over it, exactly as it would go through a press.
    `<g class="rs-plate-colour" style="--rs-dx:${dx}px;--rs-dy:${dy}px">`,
    ...pen.colour,
    '</g>',
    '<g class="rs-plate-ink">',
    ...pen.ink,
    '</g>',
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
  if (design.tier.name === 'shack') boards(pen, design, block)
}

/**
 * The mismatched boards a shack is actually made of.
 *
 * Without this the first building anybody sees is a small tidy box, which is
 * the wrong promise: the shack is supposed to look like somebody threw it up in
 * an afternoon, so that the walk-up two hires later feels earned. Under
 * Overprint it is drawn rather than shaded — a few ink lines where the boards
 * meet, one patch nailed over a gap, and a brace holding the whole thing
 * together.
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

function windowGrid(design: BuildingDesign): Bay[] {
  const bays: Bay[] = []
  const shape = design.window
  for (let floor = 0; floor < design.floors; floor++) {
    const blockWidth = widthAtFloor(design, floor)
    const half = blockWidth / 2
    const margin = blockWidth * (shape === 'ribbon' ? 0.07 : 0.12)
    const usable = blockWidth - margin * 2
    const pitch = usable / design.bays
    const floorTop = -(design.baseHeight + (floor + 1) * design.floorHeight)

    const heightFactor =
      shape === 'tall' ? 0.66 : shape === 'slit' ? 0.7 : shape === 'ribbon' ? 0.36
      : shape === 'arched' || shape === 'round-top' ? 0.6 : shape === 'plank' ? 0.42
      : shape === 'porthole' ? 0.52 : 0.55
    const widthFactor =
      shape === 'ribbon' ? 0.84 : shape === 'slit' ? 0.26 : shape === 'tall' ? 0.44
      : shape === 'porthole' ? 0.5 : 0.54

    let height = design.floorHeight * heightFactor
    let width = pitch * widthFactor
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
 * The outline of one opening.
 *
 * Nine shapes sharing one grammar, so that a facade of arches and a facade of
 * ribbons are recognisably the same city. `inset` gives the counter: the same
 * hole, a little smaller, sitting inside it.
 */
function socketPath(shape: WindowShape, bay: Bay, inset = 0): string {
  const dx = Math.min(inset, bay.width * 0.22)
  const dy = Math.min(inset, bay.height * 0.22)
  const x = bay.x + dx
  const y = bay.y + dy
  const w = bay.width - dx * 2
  const h = bay.height - dy * 2
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
 * The class is the interface: the page toggles `rs-busy` as work starts and
 * stops without asking the daemon to draw the building again. A building only
 * has to be re-rendered when it grows.
 *
 * Sockets and lips are merged into one path per storey — four shapes per window
 * against one before, and a twenty-storey tower has a hundred and twenty of
 * them. What is left is the counter, which the page has to be able to address,
 * and the figure, which is its sibling so that CSS can light one from the other
 * without a wrapper around each pair.
 */
function windowsSvg(pen: Pen, design: BuildingDesign, state: BuildingState): void {
  const { palette } = design
  const ambient = new Set(design.ambientLights)
  const working = Math.max(0, Math.min(design.floors, state.working ?? 0))
  // Work lights a building from the head down, because that is the order it is
  // handed out in: the manager is on the top floor.
  const firstWorkingFloor = design.floors - working
  const shape = design.window
  const lip = darken(palette.socket, 0.45)

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
    pen.wash(`<path class="rs-socket" d="${sockets}" fill="${palette.socket}"/>`)
    pen.line(sockets)
    if (bays[0]!.height >= 6) {
      const lips = bays.map((bay) => lipPath(shape, bay)).join(' ')
      pen.wash(
        `<path class="rs-lip" d="${lips}" fill="none" stroke="${lip}" stroke-width="1.2" stroke-linecap="round"/>`,
      )
    }

    for (const bay of bays) {
      const atWork = bay.floor >= firstWorkingFloor
      const lit = atWork || ambient.has(bay.index)
      // Three flat marigolds, so a lit facade is a row of separate rooms rather
      // than one painted band. Chosen by position, so it never changes under a
      // re-render. The bay within its storey, offset by the storey — an earlier
      // form of this reduced to `index % 3`, which with a bay count divisible by
      // three made every column one fixed tone all the way up.
      const warmth = lit ? ` rs-t${(bay.index + bay.floor * 2) % 3}` : ''
      const classes = `rs-w${lit ? ' rs-on' : ''}${atWork ? ' rs-busy' : ''}${warmth}`
      pen.wash(
        `<path class="${classes}" data-floor="${bay.floor}" d="${socketPath(shape, bay, 1.5)}" fill="${palette.socket}"/>`,
      )
      // Somebody sitting at the window. Only where there is room to see them,
      // and only ever on the colour plate: a figure that drifted out of its own
      // window would read as a bug rather than as a misprint.
      if (bay.width >= 7) {
        pen.wash(
          `<circle class="rs-body" cx="${round(bay.x + bay.width * 0.3)}" cy="${round(bay.y + bay.height * 0.74)}" r="1.9"/>`,
        )
      }
    }
  }

  pen.wash('</g>')
  pen.mark('</g>')
}

// ---- the lobby ------------------------------------------------------------

/**
 * Glazing in the lobby.
 *
 * Divided into panes rather than left as one long counter. A lobby the width of
 * the building lit end to end is a great deal of marigold for something that is
 * not work, and it drowns out the one window upstairs that is. Panes, mullions,
 * and only some of them on — a lobby with the lights on, rather than a lightbox.
 *
 * The first pane is always lit, because the way in is always open.
 */
function lobbyLight(pen: Pen, design: BuildingDesign, x: number, y: number, w: number, h: number): void {
  const { palette } = design
  pen.rect(x, y, w, h, palette.socket)

  const panes = Math.max(1, Math.round(w / 17))
  const pitch = w / panes
  const rng = new Chooser(seedOf(`${design.id}:lobby:${Math.round(x)}`))
  for (let i = 0; i < panes; i++) {
    if (i > 0) pen.line(`M ${round(x + pitch * i)} ${round(y)} V ${round(y + h)}`)
    const paneWidth = pitch - 3.4
    if (paneWidth < 2.5 || h < 5) continue
    const lit = i === 0 || rng.chance(0.5)
    pen.rect(x + pitch * i + 1.7, y + 1.7, paneWidth, h - 3.4, palette.socket, {
      cls: lit ? 'rs-w rs-on' : 'rs-w',
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
  const stoopLift = Math.min(9, room * 0.18)
  const door = (lift = 0) => {
    pen.rect(-doorWidth / 2, -doorHeight - lift, doorWidth, doorHeight, accent, { cls: 'rs-door' })
    pen.line(`M 0 ${round(-doorHeight - lift + 2)} V ${round(-lift - 2)}`)
  }

  switch (design.base) {
    case 'shopfront': {
      const glassW = width * 0.3
      const glassY = signBottom + 13
      const glassH = Math.max(7, -glassY - 3)
      lobbyLight(pen, design, -half + width * 0.08, glassY, glassW, glassH)
      lobbyLight(pen, design, half - width * 0.08 - glassW, glassY, glassW, glassH)
      awning(pen, design, -half + width * 0.06, half - width * 0.06, signBottom + 2)
      door()
      break
    }
    case 'arcade': {
      const count = Math.max(3, design.bays)
      const pitch = (width * 0.86) / count
      const r = pitch * 0.38
      const doorBay = Math.floor(count / 2)
      for (let i = 0; i < count; i++) {
        const cx = -half + width * 0.07 + pitch * (i + 0.5)
        const spring = Math.max(-design.baseHeight * 0.42, signBottom + r + 3)
        const arch = `M ${round(cx - r)} -2 V ${round(spring)} A ${round(r)} ${round(r)} 0 0 1 ${round(cx + r)} ${round(spring)} V -2 Z`
        // The middle arch is the way in, so it is a door and not a dark hole.
        if (i === doorBay) {
          pen.shape(arch, accent, { cls: 'rs-door' })
          pen.line(`M ${round(cx)} ${round(-design.baseHeight * 0.46)} V -3`)
        } else {
          pen.shape(arch, palette.socket)
          pen.wash(
            `<path class="rs-w rs-on" d="M ${round(cx - r + 1.6)} -3.5 V ${round(spring)} A ${round(r - 1.6)} ${round(r - 1.6)} 0 0 1 ${round(cx + r - 1.6)} ${round(spring)} V -3.5 Z" fill="${palette.socket}"/>`,
          )
        }
      }
      break
    }
    case 'colonnade': {
      const count = Math.max(4, design.bays + 1)
      const pitch = (width * 0.88) / (count - 1)
      lobbyLight(pen, design, -half + width * 0.06, -design.baseHeight * 0.7, width * 0.88, design.baseHeight * 0.56)
      for (let i = 0; i < count; i++) {
        const cx = -half + width * 0.06 + pitch * i
        pen.rect(cx - 3, signBottom + 6, 6, -signBottom - 6, palette.wall)
        pen.rect(cx - 4.5, signBottom + 2, 9, 4, palette.trim)
      }
      door()
      break
    }
    case 'plaza': {
      lobbyLight(pen, design, -half + width * 0.1, -design.baseHeight * 0.66, width * 0.8, design.baseHeight * 0.52)
      pen.rect(-half - 10, -6, width + 20, 6, palette.roof)
      pen.rect(-half + width * 0.08, signBottom + 3, width * 0.84, 4, accent)
      door()
      break
    }
    case 'stoop': {
      const step = stoopLift / 3
      for (let i = 0; i < 3; i++) {
        const w = doorWidth + 14 - i * 4
        pen.rect(-w / 2, -(i + 1) * step, w, step, palette.trim)
      }
      door(stoopLift)
      const sillY = signBottom + 3
      lobbyLight(pen, design, -half + width * 0.1, sillY, width * 0.2, Math.max(6, -sillY - 4))
      lobbyLight(pen, design, half - width * 0.3, sillY, width * 0.2, Math.max(6, -sillY - 4))
      break
    }
    case 'yard':
    default: {
      door()
      lobbyLight(pen, design, -half + width * 0.12, signBottom + 3, width * 0.18, Math.max(6, room - 7))
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
      pen.rect(-half * 0.24, -h * 0.8, width * 0.24, h * 0.32, palette.socket, { cls: 'rs-w rs-on rs-busy' })
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
      beacon(pen, 0, -h - 2.6)
      break
    case 'needle':
      pen.rect(-half * 0.5, -h * 0.2, width * 0.5, h * 0.2, palette.wall)
      pen.shape(
        `M ${round(-half * 0.2)} ${round(-h * 0.2)} L 0 ${round(-h * 0.98)} L ${round(half * 0.2)} ${round(-h * 0.2)} Z`,
        palette.trim,
      )
      pen.disc(0, -h * 0.42, width * 0.15, palette.shade)
      pen.disc(0, -h * 0.42, width * 0.09, palette.socket, { cls: 'rs-w rs-on', outline: false })
      beacon(pen, 0, -h - 2.4)
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
      beacon(pen, 0, -h - 2.4)
      break
    case 'halo':
      pen.rect(-half * 0.5, -h * 0.5, width * 0.5, h * 0.5, palette.wall)
      pen.rect(-2.5, -h * 0.86, 5, h * 0.4, palette.trim)
      pen.mark(
        `<ellipse class="rs-halo" cx="0" cy="${round(-h * 0.86)}" rx="${round(width * 0.56)}" ry="${round(width * 0.13)}"/>`,
      )
      pen.mark(
        `<ellipse cx="0" cy="${round(-h * 0.78)}" rx="${round(width * 0.38)}" ry="${round(width * 0.09)}"/>`,
      )
      break
    case 'solar-fin':
      pen.rect(-half * 0.8, -h * 0.2, width * 0.8, h * 0.2, palette.wall)
      for (let i = 0; i < 4; i++) {
        const x = -half * 0.7 + (width * 0.7 * i) / 3
        pen.shape(
          `M ${round(x)} 0 L ${round(x + 8)} ${round(-h)} L ${round(x + 13)} ${round(-h)} L ${round(x + 5)} 0 Z`,
          i % 2 ? palette.trim : palette.shade,
        )
      }
      break
    case 'orb':
      pen.rect(-half * 0.36, -h * 0.55, width * 0.36, h * 0.55, palette.wall)
      pen.disc(0, -h * 0.72, width * 0.24, palette.shade)
      pen.disc(0, -h * 0.72, width * 0.15, accent)
      pen.mark(
        `<ellipse cx="0" cy="${round(-h * 0.72)}" rx="${round(width * 0.38)}" ry="${round(width * 0.09)}"/>`,
      )
      break
    case 'skybridge-crown': {
      const deck = -h * 0.66
      pen.rect(-half * 0.86, -h, width * 0.26, h, palette.wall)
      pen.rect(half * 0.6, -h * 0.82, width * 0.26, h * 0.82, palette.shade)
      pen.rect(-half * 0.6, deck, width * 1.2, 9, palette.trim)
      const panes = Math.max(3, Math.round(width / 13))
      const pitch = (width * 1.1) / panes
      for (let i = 0; i < panes; i++) {
        pen.rect(-half * 0.55 + pitch * i + 1.4, deck + 2.4, pitch - 2.8, 4.2, palette.socket, {
          cls: i % 2 ? 'rs-w rs-on' : 'rs-w',
          outline: false,
        })
      }
      break
    }
  }

  // Everything the crown drew, moved up onto the top of the shaft.
  wrapRange(pen, colourFrom, inkFrom, open)
}

/** A bulb is allowed to be the colour of light. That is the rule, not a hole in it. */
function beacon(pen: Pen, cx: number, cy: number): void {
  pen.disc(cx, cy, 3, 'none', { cls: 'rs-beacon' })
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
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.55, -design.crownHeight * 0.2))
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
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.45, -design.crownHeight * 0.55, rng.float(-7, 7)))
      break
    case 'ladder': {
      pen.line('M -5 -27 V 0')
      pen.line('M 5 -27 V 0')
      for (let i = 0; i < 5; i++) pen.line(`M -5 ${-3 - i * 5} H 5`)
      wrapRange(pen, colourFrom, inkFrom, at(side * (half - 6)))
      break
    }
    case 'water-tower': {
      for (let i = -1; i <= 1; i += 2) pen.line(`M ${i * 9} -14 V 1`)
      pen.line('M -9 -8 L 9 -3')
      pen.rect(-13, -38, 26, 24, palette.trim, { rx: 2 })
      pen.shape('M -15 -38 L 0 -49 L 15 -38 Z', palette.roof)
      pen.line('M -13 -29 H 13')
      pen.line('M -13 -22 H 13')
      // It leans. Nobody has ever straightened one of these.
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.5, -design.crownHeight * 0.1, rng.float(-4.5, 4.5)))
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
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.6, -design.crownHeight * 0.3))
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
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.7, -design.crownHeight * 0.6))
      break
    case 'clock':
      pen.disc(0, 0, 13, palette.trim)
      pen.disc(0, 0, 10, palette.lit)
      pen.line('M 0 -7 V 0')
      pen.line('M 0 0 H 6')
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.42, -design.crownHeight - 15))
      break
    case 'neon-sign':
      pen.line('M 0 -26 V 0')
      pen.rect(-16, -41, 32, 16, palette.lit, { rx: 2 })
      pen.rect(-11, -36, 22, 3, accent, { cls: 'rs-neon', outline: false })
      pen.rect(-11, -31, 15, 3, accent, { cls: 'rs-neon', outline: false })
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.62, -design.crownHeight * 0.4))
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
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.25, -design.crownHeight * 0.05))
      break
    }
    case 'billboard':
      pen.line('M -16 -8 V 1')
      pen.line('M 16 -8 V 1')
      pen.rect(-20, -33, 40, 26, palette.lit, { rx: 1.5 })
      pen.rect(-15, -28, 24, 4, accent, { outline: false })
      pen.line('M -15 -21 H 15')
      pen.line('M -15 -16 H 3')
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.3, -design.crownHeight * 0.15))
      break
    case 'string-lights': {
      const span = design.width + 10
      pen.line(`M ${round(-span / 2)} -6 Q 0 12 ${round(span / 2)} -6`)
      for (let i = 1; i < 9; i++) {
        const t = i / 9
        const x = -span / 2 + span * t
        const sag = Math.sin(Math.PI * t) * 9
        pen.disc(x, -6 + sag, 2.4, 'none', {
          cls: 'rs-bulb',
          attrs: ` style="animation-delay:${(i * 0.28).toFixed(2)}s"`,
        })
      }
      wrapRange(pen, colourFrom, inkFrom, at(0, -2))
      break
    }
    case 'solar-panel': {
      for (let i = 0; i < 3; i++) {
        const x = -21 + i * 15
        pen.shape(`M ${x} 0 L ${x + 13} 0 L ${x + 11} -10 L ${x - 2} -10 Z`, palette.shade)
      }
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.3, -design.crownHeight * 0.05))
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
        pen.shape(bird(-12 + i * 12 + (i % 2) * 3), palette.trim, {
          cls: 'rs-pigeon',
          attrs: ` style="animation-delay:${(i * 1.4).toFixed(1)}s"`,
        })
      }
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.5, -design.crownHeight - 1))
      break
    }
    case 'fire-escape': {
      // Down the front, which is where they are, and the reason the cast-iron
      // block reads as a cast-iron block at any size. Kept inside the footprint:
      // ironwork that overhangs the brickwork reads as a rendering fault.
      const platform = 22
      const x = side * (design.width * 0.5 - platform / 2 - 5)
      for (let floor = 1; floor < design.floors; floor++) {
        const y = -(design.baseHeight + floor * design.floorHeight)
        pen.line(`M ${round(x - platform / 2)} ${round(y)} H ${round(x + platform / 2)}`)
        pen.line(`M ${round(x - platform / 2)} ${round(y - 9)} V ${round(y)}`)
        pen.line(`M ${round(x + platform / 2)} ${round(y - 9)} V ${round(y)}`)
        pen.line(`M ${round(x - platform / 2)} ${round(y - 5)} H ${round(x + platform / 2)}`)
        pen.line(
          `M ${round(x - platform / 2 + 3)} ${round(y)} L ${round(x + platform / 2 - 3)} ${round(y + design.floorHeight - 1)}`,
        )
      }
      wrapRange(pen, colourFrom, inkFrom, '<g class="rs-ornament rs-o-fire-escape">')
      break
    }
    case 'skybridge': {
      const y = -(design.baseHeight + Math.max(2, Math.floor(design.floors * 0.62)) * design.floorHeight)
      const x = side * (design.width * 0.5)
      const reach = side * 46
      const left = Math.min(x, x + reach)
      const span = Math.abs(reach)
      pen.rect(left, y, span, 12, palette.shade, { rx: 3 })
      const panes = Math.max(3, Math.round(span / 11))
      const pitch = (span - 6) / panes
      for (let i = 0; i < panes; i++) {
        pen.rect(left + 3 + pitch * i + 1, y + 3.5, pitch - 2, 4.5, palette.socket, {
          cls: i % 2 ? 'rs-w rs-on' : 'rs-w',
          outline: false,
        })
      }
      wrapRange(pen, colourFrom, inkFrom, '<g class="rs-ornament rs-o-skybridge">')
      break
    }
    case 'drone-pad':
      pen.ellipse(0, -2, 20, 6, palette.shade)
      pen.mark('<ellipse cx="0" cy="-3" rx="13" ry="4"/>')
      pen.mark(`<g class="rs-drone">
<path d="M -9 -20 H -3 M 3 -20 H 9 M -6 -20 V -17.5 M 6 -20 V -17.5"/>
<path d="M -5 -17.5 H 5 L 3 -13 H -3 Z" fill="${accent}"/></g>`)
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.35, -design.crownHeight * 0.05))
      break
    case 'beacon':
      pen.rect(-2.5, -9, 5, 9, palette.trim)
      beacon(pen, 0, -12.5)
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.55, -design.crownHeight - 2))
      break
    case 'crane': {
      const height = 58
      pen.line(`M 0 ${-height} V 0`)
      pen.line(`M -26 ${-height + 2} H 36`)
      pen.line(`M 0 ${-height} L -22 ${-height + 4}`)
      pen.line(`M 0 ${-height} L 32 ${-height + 4}`)
      pen.line(`M 26 ${-height + 4} V ${-height + 24}`)
      pen.rect(22, -height + 24, 9, 6, accent)
      wrapRange(pen, colourFrom, inkFrom, at(side * half * 0.7, -design.crownHeight * 0.2))
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

  const lotWidth = 150
  const bodyWidth = designs.reduce((sum, d) => sum + Math.max(d.design.width, 96), 0)
  const gapCount = Math.max(0, designs.length - (options.emptyLot === false ? 1 : 0))
  const rowWidth = bodyWidth + gap * gapCount + (options.emptyLot === false ? 0 : lotWidth)

  /**
   * A short row is drawn larger.
   *
   * The first thing anybody ever sees here is one shack, and one shack at the
   * scale a row of thirty needs is a speck in the middle of a large sheet.
   * Scaling toward a comfortable row width means a new skyline reads as a place
   * from the first building, and a crowded one still fits.
   *
   * Measured on the buildings alone. The empty lot is a control rather than a
   * building, and letting it drive this magnified the plus sign on an empty
   * skyline until it was the size of a door.
   */
  const zoomBasis = designs.length > 0 ? bodyWidth + gap * Math.max(0, designs.length - 1) : 860
  const zoom = Math.min(1.75, Math.max(1, 860 / Math.max(1, zoomBasis)))
  const scaled = rowWidth * zoom
  const natural = margin * 2 + scaled

  /**
   * Air above the roofline, so a low skyline is still a skyline.
   *
   * The page scales this drawing to the height of its frame, so a canvas only
   * as tall as its tallest building gets magnified to fill the screen — and a
   * city of two shacks came out looking like two barns. Giving the short cases
   * more room costs nothing and keeps everything at a believable size.
   */
  const tallest = Math.max(
    options.backdrop === false ? 120 : 320,
    designs.reduce((max, d) => Math.max(max, d.design.height + ornamentHeadroom(d.design)), 120) * zoom,
  )
  const belowGround = options.labels === false ? 44 : 122
  // A city wants air above it; a portrait wants a margin. The backdrop being
  // off is what distinguishes the two, and it is the portrait that turns it off.
  const portrait = options.backdrop === false
  const baseSky = portrait
    ? Math.max(34, Math.round(tallest * 0.1))
    : Math.max(140, Math.round(tallest * 0.24))
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
  // Either dimension on its own is still worth honouring: the option's whole
  // purpose is to stop a drawing being marooned in a frame, and a caller who
  // gives only a width was previously ignored entirely. A width with no height
  // is taken as a floor to reach rather than a ratio to match.
  const asked = (value: number | undefined): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
  const wantWidth = asked(options.width)
  const wantHeight = asked(options.height)
  const aspect = wantWidth > 0 && wantHeight > 0 ? wantWidth / wantHeight : 0

  // Bounded. `dust()` and `backdrop()` loop across the whole canvas, so a width
  // that runs away is megabytes of markup and, if the aspect were ever
  // non-finite, a loop that never ends. Wide enough for a very large skyline on
  // a very wide screen; nowhere near enough to hang anything.
  const MAX_WIDTH = 40_000
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

  let x = margin + spare
  for (const { design, state, note } of designs) {
    const slot = Math.max(design.width, 96)
    const centre = x + (slot * zoom) / 2
    // Scaled about its own feet, so the whole row still stands on one street.
    parts.push(
      `<g class="rs-plot" data-building="${esc(design.id)}" tabindex="0" role="button" aria-label="${esc(design.name)} — ${esc(design.tier.name)}, ${floorsSaid(design.headcount)}" transform="translate(${round(centre)} ${round(groundY)}) scale(${round(zoom)})">`,
    )
    parts.push(buildingSvg(design, state))
    if (options.labels !== false) parts.push(nameplate(design, state, slot + gap * 0.8, note))
    // A generous invisible hit area: a shack is a small target otherwise.
    parts.push(
      `<rect class="rs-hit" x="${round(-slot / 2 - gap / 2)}" y="${round(-design.height - 40)}" width="${round(slot + gap)}" height="${round(design.height + 40 + (options.labels === false ? 10 : 90))}" fill="transparent"/>`,
    )
    parts.push('</g>')
    x += (slot + gap) * zoom
  }

  if (options.emptyLot !== false) {
    parts.push(emptyLot(x, groundY, lotWidth * zoom, zoom))
  }

  parts.push('</svg>')
  return parts.join('\n')
}

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
  .rs-w { transition: fill var(--slow, .42s) var(--ease, cubic-bezier(.22,1,.36,1)); }
  .rs-on { fill: var(--lamp, #EFAA22); }
  /* Three flat marigolds, a shade either side of the lamp, so a lit facade is
     a row of separate rooms rather than one painted band. */
  .rs-on.rs-t0 { fill: #E39A1E; }
  .rs-on.rs-t2 { fill: #F6BE52; }
  .rs-busy, .rs-busy.rs-t0, .rs-busy.rs-t1, .rs-busy.rs-t2 { fill: var(--lamp-lit, #F7C556); }
  /* Somebody at the window. Sibling rather than descendant: the counter is the
     element the page toggles, and its figure sits immediately after it. */
  .rs-body { fill: var(--ink, #1E1B16); opacity: 0; transition: opacity var(--base, .26s) ease; }
  .rs-w.rs-busy + .rs-body { opacity: .55; }

  .rs-plot { cursor: pointer; }
  .rs-plot:hover, .rs-plot:focus-visible { outline: none; }
  .rs-building { transition: transform var(--base, .26s) var(--ease, cubic-bezier(.22,1,.36,1)); }
  .rs-plot:hover .rs-building, .rs-plot:focus-visible .rs-building { transform: translateY(-6px); }
  .rs-shadow { transition: opacity var(--base, .26s) ease; }
  .rs-plot:hover .rs-shadow, .rs-plot:focus-visible .rs-shadow { opacity: .7; }

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
  .rs-lot:focus-visible { outline: none; }

  /* The pin. Vermilion, and the only vermilion in the drawing. */
  .rs-pin-base { fill: var(--flag-deep, #9C2F1B); }
  .rs-pin-post { fill: var(--flag, #D2452A); }
  .rs-pin-ball { fill: var(--flag, #D2452A); }
  .rs-pin-shine { fill: none; stroke: var(--ground, #F1EBDD); stroke-width: 2.4; stroke-linecap: round; opacity: .8; }
  .rs-waiting { transform-box: fill-box; transform-origin: 50% 100%;
                animation: rs-rock 3s var(--ease, cubic-bezier(.22,1,.36,1)) infinite; }
  @keyframes rs-rock { 0%, 100% { transform: rotate(-1.5deg) } 50% { transform: rotate(1.5deg) } }

  .rs-beacon { fill: var(--lamp, #EFAA22); animation: rs-blink 3.4s steps(1, end) infinite; }
  .rs-bulb { fill: var(--lamp, #EFAA22); animation: rs-glow 3.6s ease-in-out infinite; }
  @keyframes rs-blink { 0%, 55% { opacity: 1 } 56%, 100% { opacity: .15 } }
  @keyframes rs-glow { 0%, 100% { opacity: 1 } 50% { opacity: .4 } }

  .rs-busy-dot { fill: var(--lamp, #EFAA22); animation: rs-pulse 2.2s ease-in-out infinite; }
  @keyframes rs-pulse { 0%, 100% { opacity: 1 } 50% { opacity: .3 } }

  .rs-smoke { animation: rs-rise 9s ease-out infinite; transform-box: fill-box; transform-origin: bottom; }
  @keyframes rs-rise { 0% { opacity: .5; transform: translateY(0) scale(.6) } 100% { opacity: 0; transform: translateY(-26px) scale(1.3) } }

  .rs-pennant, .rs-banner { transform-box: fill-box; transform-origin: left center;
                            animation: rs-wave 4.5s ease-in-out infinite; }
  @keyframes rs-wave { 0%, 100% { transform: skewY(0deg) } 50% { transform: skewY(-3.5deg) } }

  .rs-neon { animation: rs-buzz 6s steps(1, end) infinite; }
  @keyframes rs-buzz { 0%, 91% { opacity: 1 } 92%, 94% { opacity: .3 } 95%, 100% { opacity: 1 } }

  .rs-drone { animation: rs-hover 5s ease-in-out infinite; }
  @keyframes rs-hover { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-7px) } }

  .rs-pigeon { transform-box: fill-box; transform-origin: center;
               animation: rs-peck 6s ease-in-out infinite; }
  @keyframes rs-peck { 0%, 88%, 100% { transform: rotate(0deg) } 92% { transform: rotate(-13deg) } }

  @media (prefers-reduced-motion: reduce) {
    .rs-beacon, .rs-bulb, .rs-busy-dot, .rs-waiting, .rs-smoke, .rs-pennant, .rs-banner,
    .rs-neon, .rs-drone, .rs-pigeon { animation: none; }
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
