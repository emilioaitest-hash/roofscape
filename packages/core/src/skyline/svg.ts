/**
 * The city, drawn.
 *
 * The terminal gets `render.ts`, which draws the same buildings out of box
 * characters. Both read the same headcount and the same tier, so the two cannot
 * disagree about what a building *is* — but a browser can hold a great deal more
 * than eleven columns of text, and pretending otherwise would waste the screen
 * that matters most. This is the home screen. It is allowed to be beautiful.
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
import type { BuildingDesign, Ornament } from './design.js'
import { designFor, Chooser, seedOf, type DesignInput } from './design.js'

/** What the building is doing, which is the only thing that animates. */
export interface BuildingState {
  /** Floors with work in hand. Lit from the top down: the manager is up there. */
  working?: number
  /** Approvals waiting on the owner. The building runs a flag up. */
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
   * middle of a large dark rectangle, which reads as a failure to load.
   */
  width?: number
  /**
   * Aim for this total height, by giving the sky whatever is left over. Ignored
   * when the tallest building already needs more than that.
   */
  height?: number
  /** Space between plots. */
  gap?: number
  /** Left and right margin. */
  margin?: number
  /** Narrowest canvas to draw onto. A single portrait wants a much tighter one. */
  minWidth?: number
  /** Draw the hazy anonymous skyline behind. Off for a single portrait. */
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
 * Ids have to be unique on a page holding a whole city of gradients.
 *
 * Keyed on the building's own id rather than on its seed. The seed is a 32-bit
 * hash, so two buildings in one document can share one — `b2cir` as a shack and
 * `b9kc` as a single storey both hash to 3015174655 — and the first definition
 * of a duplicated gradient id wins, which paints one building in the other's
 * walls while its trim and roof stay its own. Building ids are unique by
 * construction, so this cannot collide at all.
 */
const idOf = (design: BuildingDesign, part: string): string =>
  `rs-${part}-${design.id.replace(/[^A-Za-z0-9_-]/g, '_')}-${design.seed.toString(36)}`

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
  const { palette } = design
  const wallId = idOf(design, 'wall')
  const blocks = massing(design)
  const lean = design.lean
  const transform = lean === 0 ? '' : ` transform="rotate(${round(lean)} 0 0)"`

  const parts: string[] = []

  parts.push(`<defs>
  <linearGradient id="${wallId}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${palette.wall}"/>
    <stop offset="0.72" stop-color="${palette.wall}"/>
    <stop offset="1" stop-color="${palette.shade}"/>
  </linearGradient>
</defs>`)

  parts.push(`<g class="rs-building"${transform}>`)

  // Ground shadow, so the building sits on the street instead of floating.
  // Soft-edged: a hard ellipse under every building reads as a row of puddles.
  parts.push(
    `<ellipse class="rs-shadow" cx="0" cy="4" rx="${round(design.width * 0.78)}" ry="11" fill="url(#rs-shadow)"/>`,
  )

  // The lobby, then the shaft, then whatever is on top.
  parts.push(baseSvg(design, wallId))
  for (const block of blocks) parts.push(blockSvg(design, block, wallId))
  parts.push(setbackLedges(design, blocks))
  parts.push(windowsSvg(design, state))
  parts.push(crownSvg(design, topWidth(design)))
  for (const ornament of design.ornaments) parts.push(ornamentSvg(design, ornament))
  if ((state.waiting ?? 0) > 0) parts.push(waitingFlag(design))

  parts.push('</g>')
  return parts.join('\n')
}

/** One rectangle of shaft, with its lit edge and its shaded one. */
function blockSvg(design: BuildingDesign, block: Block, wallId: string): string {
  const half = block.width / 2
  const height = block.bottom - block.top
  const { palette } = design
  const out = [
    `<rect x="${round(-half)}" y="${round(block.top)}" width="${round(block.width)}" height="${round(height)}" fill="url(#${wallId})"/>`,
    // Light comes from the left in this city, and it does so consistently.
    `<rect x="${round(-half)}" y="${round(block.top)}" width="2.5" height="${round(height)}" fill="#ffffff14"/>`,
    `<rect x="${round(half - 4)}" y="${round(block.top)}" width="4" height="${round(height)}" fill="#00000026"/>`,
  ]
  if (design.pilasters) out.push(pilasters(design, block))
  if (design.bandCourse) out.push(bandCourses(design, block, palette.trim))
  if (design.tier.name === 'shack') out.push(weathering(design, block))
  return out.join('')
}

/**
 * The mismatched boards a shack is actually made of.
 *
 * Without this the first building anybody sees is a small tidy box, which is the
 * wrong promise: the shack is supposed to look like somebody threw it up in an
 * afternoon, so that the walk-up two hires later feels earned.
 */
function weathering(design: BuildingDesign, block: Block): string {
  const rng = new Chooser(seedOf(`${design.id}:weather`))
  const half = block.width / 2
  const height = block.bottom - block.top
  const out: string[] = []

  // Horizontal boards, none of them quite the same shade.
  const boards = Math.max(3, Math.round(height / 7))
  for (let i = 0; i < boards; i++) {
    const y = block.top + (height / boards) * i
    out.push(
      `<rect x="${round(-half)}" y="${round(y)}" width="${round(block.width)}" height="${round(height / boards)}" fill="${rng.chance(0.5) ? design.palette.shade : design.palette.wall}" opacity="${round(rng.float(0.12, 0.36))}"/>`,
    )
  }
  // A couple of patches nailed over the gaps.
  for (let i = 0; i < rng.int(2, 3); i++) {
    const w = rng.float(14, 30)
    const h = rng.float(7, 14)
    out.push(
      `<rect x="${round(rng.float(-half + 3, half - w - 3))}" y="${round(rng.float(block.top + 2, block.bottom - h - 2))}" width="${round(w)}" height="${round(h)}" fill="${design.palette.trim}" opacity="${round(rng.float(0.3, 0.55))}"/>`,
    )
  }
  // A board across the whole thing, at an angle, holding it together.
  out.push(
    `<path d="M ${round(-half + 2)} ${round(block.bottom - 3)} L ${round(half - 2)} ${round(block.top + 4)}" stroke="${design.palette.trim}" stroke-width="3" opacity="0.4" fill="none"/>`,
  )
  return out.join('')
}

/** Vertical piers between the bays. A flat facade with none reads as a box. */
function pilasters(design: BuildingDesign, block: Block): string {
  const half = block.width / 2
  const margin = block.width * 0.08
  const usable = block.width - margin * 2
  const pitch = usable / design.bays
  const height = block.bottom - block.top
  const out: string[] = []
  for (let i = 0; i <= design.bays; i++) {
    const x = -half + margin + i * pitch - 1.5
    out.push(
      `<rect x="${round(x)}" y="${round(block.top)}" width="3" height="${round(height)}" fill="${design.palette.trim}" opacity="0.35"/>`,
    )
  }
  return out.join('')
}

/** A course line at every floor, which is what gives brick its scale. */
function bandCourses(design: BuildingDesign, block: Block, colour: string): string {
  const half = block.width / 2
  const out: string[] = []
  for (let floor = block.fromFloor; floor <= block.toFloor; floor++) {
    const y = -(design.baseHeight + floor * design.floorHeight)
    out.push(
      `<rect x="${round(-half)}" y="${round(y - 1)}" width="${round(block.width)}" height="1.5" fill="${colour}" opacity="0.3"/>`,
    )
  }
  return out.join('')
}

/** The lip where a tower steps in. Without it a setback looks like a mistake. */
function setbackLedges(design: BuildingDesign, blocks: readonly Block[]): string {
  const out: string[] = []
  for (let i = 1; i < blocks.length; i++) {
    const below = blocks[i - 1]!
    const above = blocks[i]!
    if (above.width >= below.width) continue
    out.push(
      `<rect x="${round(-below.width / 2)}" y="${round(below.top - 4)}" width="${round(below.width)}" height="5" fill="${design.palette.roof}"/>`,
      `<rect x="${round(-below.width / 2)}" y="${round(below.top - 5)}" width="${round(below.width)}" height="2" fill="${design.palette.trim}"/>`,
    )
  }
  return out.join('')
}

// ---- windows --------------------------------------------------------------

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
      shape === 'tall' ? 0.66 : shape === 'slit' ? 0.7 : shape === 'ribbon' ? 0.4
      : shape === 'arched' || shape === 'round-top' ? 0.6 : shape === 'plank' ? 0.42 : 0.55
    const widthFactor =
      shape === 'ribbon' ? 0.9 : shape === 'slit' ? 0.24 : shape === 'tall' ? 0.44 : 0.54

    const height = design.floorHeight * heightFactor
    const width = pitch * widthFactor
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
 * Every window, with the lit ones marked rather than coloured.
 *
 * The class is the interface: the page toggles `rs-on` as work starts and stops
 * without asking the daemon to draw the building again. A building only has to
 * be re-rendered when it grows.
 */
function windowsSvg(design: BuildingDesign, state: BuildingState): string {
  const ambient = new Set(design.ambientLights)
  const working = Math.max(0, Math.min(design.floors, state.working ?? 0))
  // Work lights a building from the head down, because that is the order it is
  // handed out in: the manager is on the top floor.
  const firstWorkingFloor = design.floors - working

  const out: string[] = [`<g class="rs-windows" fill="${design.palette.glass}">`]
  for (const bay of windowGrid(design)) {
    const atWork = bay.floor >= firstWorkingFloor
    const lit = atWork || ambient.has(bay.index)
    // Three warmths, so a lit facade is a row of separate rooms rather than one
    // painted band. Chosen by position, so it never changes under a re-render.
    //
    // The bay within its storey, offset by the storey — the previous form,
    // `(index * 7 + floor * 3) % 3`, reduced to `index % 3` (7 ≡ 1 and 3 ≡ 0,
    // mod 3), and with a bay count divisible by three that made every column
    // one fixed tone all the way up. This actually staggers.
    const warmth = lit ? ` rs-t${(bay.index + bay.floor * 2) % 3}` : ''
    const classes = `rs-w${lit ? ' rs-on' : ''}${atWork ? ' rs-busy' : ''}${warmth}`
    out.push(windowShape(design, bay, classes))
  }
  out.push('</g>')
  return out.join('')
}

function windowShape(design: BuildingDesign, bay: Bay, classes: string): string {
  const { x, y, width, height } = bay
  const common = `class="${classes}" data-floor="${bay.floor}"`
  const sill = `<rect x="${round(x - 1.5)}" y="${round(y + height)}" width="${round(width + 3)}" height="1.5" fill="${design.palette.trim}" opacity="0.5"/>`

  switch (design.window) {
    case 'arched': {
      const r = width / 2
      const bodyTop = y + r
      const d = `M ${round(x)} ${round(y + height)} L ${round(x)} ${round(bodyTop)} A ${round(r)} ${round(r)} 0 0 1 ${round(x + width)} ${round(bodyTop)} L ${round(x + width)} ${round(y + height)} Z`
      return `<path ${common} d="${d}"/>${sill}`
    }
    case 'round-top': {
      const r = width / 2
      const d = `M ${round(x)} ${round(y + height)} L ${round(x)} ${round(y + r)} Q ${round(x)} ${round(y)} ${round(x + r)} ${round(y)} Q ${round(x + width)} ${round(y)} ${round(x + width)} ${round(y + r)} L ${round(x + width)} ${round(y + height)} Z`
      return `<path ${common} d="${d}"/>${sill}`
    }
    case 'sash': {
      const muntin = `<rect x="${round(x)}" y="${round(y + height / 2 - 0.6)}" width="${round(width)}" height="1.2" fill="${design.palette.trim}" opacity="0.75"/>`
      return `<rect ${common} x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}"/>${muntin}${sill}`
    }
    case 'grid': {
      const vertical = `<rect x="${round(x + width / 2 - 0.5)}" y="${round(y)}" width="1" height="${round(height)}" fill="${design.palette.trim}" opacity="0.7"/>`
      const horizontal = `<rect x="${round(x)}" y="${round(y + height / 2 - 0.5)}" width="${round(width)}" height="1" fill="${design.palette.trim}" opacity="0.7"/>`
      return `<rect ${common} x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}"/>${vertical}${horizontal}`
    }
    case 'ribbon':
      return `<rect ${common} x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}" rx="1"/>`
    case 'slit':
      return `<rect ${common} x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}" rx="${round(width / 2)}"/>`
    case 'plank':
      return `<rect ${common} x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}"/>`
    case 'tall':
    default:
      return `<rect ${common} x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}"/>${sill}`
  }
}

// ---- the lobby ------------------------------------------------------------

/** The ground floor: where you walk in, and the only part at eye level. */
function baseSvg(design: BuildingDesign, wallId: string): string {
  const width = design.width
  const half = width / 2
  const top = -design.baseHeight
  const { palette, accent } = design
  const out = [
    `<rect x="${round(-half)}" y="${round(top)}" width="${round(width)}" height="${round(design.baseHeight)}" fill="url(#${wallId})"/>`,
    `<rect x="${round(half - 4)}" y="${round(top)}" width="4" height="${round(design.baseHeight)}" fill="#00000026"/>`,
  ]

  const doorWidth = Math.min(20, width * 0.16)
  const doorHeight = design.baseHeight * 0.62
  const door = `<rect class="rs-door" x="${round(-doorWidth / 2)}" y="${round(-doorHeight)}" width="${round(doorWidth)}" height="${round(doorHeight)}" fill="${accent}" opacity="0.92"/>
<rect x="${round(-doorWidth / 2)}" y="${round(-doorHeight)}" width="${round(doorWidth)}" height="2" fill="#00000033"/>`

  switch (design.base) {
    case 'shopfront': {
      const glassW = width * 0.3
      const glassH = design.baseHeight * 0.42
      out.push(
        `<rect class="rs-w rs-on" x="${round(-half + width * 0.08)}" y="${round(-glassH - design.baseHeight * 0.16)}" width="${round(glassW)}" height="${round(glassH)}"/>`,
        `<rect class="rs-w rs-on" x="${round(half - width * 0.08 - glassW)}" y="${round(-glassH - design.baseHeight * 0.16)}" width="${round(glassW)}" height="${round(glassH)}"/>`,
        awning(design, -half + width * 0.06, half - width * 0.06, top + design.baseHeight * 0.26),
        door,
      )
      break
    }
    case 'arcade': {
      const count = Math.max(3, design.bays)
      const pitch = (width * 0.86) / count
      const r = pitch * 0.38
      const doorBay = Math.floor(count / 2)
      for (let i = 0; i < count; i++) {
        const cx = -half + width * 0.07 + pitch * (i + 0.5)
        const bottom = -2
        const springLine = -design.baseHeight * 0.5
        const arch = `M ${round(cx - r)} ${round(bottom)} L ${round(cx - r)} ${round(springLine)} A ${round(r)} ${round(r)} 0 0 1 ${round(cx + r)} ${round(springLine)} L ${round(cx + r)} ${round(bottom)} Z`
        // The middle arch is the way in, so it is a door and not a dark hole.
        if (i === doorBay) {
          out.push(
            `<path d="${arch}" fill="${accent}" opacity="0.92"/>`,
            `<path d="${arch}" fill="none" stroke="${palette.trim}" stroke-width="1.4" opacity="0.7"/>`,
            `<rect x="${round(cx - 0.7)}" y="${round(-design.baseHeight * 0.46)}" width="1.4" height="${round(design.baseHeight * 0.44)}" fill="${palette.trim}" opacity="0.55"/>`,
          )
        } else {
          out.push(`<path class="rs-w rs-on" d="${arch}"/>`)
        }
      }
      break
    }
    case 'colonnade': {
      const count = Math.max(4, design.bays + 1)
      const pitch = (width * 0.88) / (count - 1)
      out.push(
        `<rect class="rs-w rs-on" x="${round(-half + width * 0.06)}" y="${round(-design.baseHeight * 0.72)}" width="${round(width * 0.88)}" height="${round(design.baseHeight * 0.66)}"/>`,
      )
      for (let i = 0; i < count; i++) {
        const cx = -half + width * 0.06 + pitch * i
        out.push(
          `<rect x="${round(cx - 3)}" y="${round(-design.baseHeight * 0.78)}" width="6" height="${round(design.baseHeight * 0.78)}" fill="${palette.wall}"/>`,
          `<rect x="${round(cx - 4.5)}" y="${round(-design.baseHeight * 0.82)}" width="9" height="4" fill="${palette.trim}"/>`,
        )
      }
      out.push(door)
      break
    }
    case 'plaza': {
      out.push(
        `<rect class="rs-w rs-on" x="${round(-half + width * 0.1)}" y="${round(-design.baseHeight * 0.68)}" width="${round(width * 0.8)}" height="${round(design.baseHeight * 0.6)}"/>`,
        `<rect x="${round(-half - 10)}" y="-6" width="${round(width + 20)}" height="6" fill="${palette.roof}"/>`,
        `<rect x="${round(-half - 16)}" y="-3" width="${round(width + 32)}" height="3" fill="${palette.trim}" opacity="0.8"/>`,
        `<rect x="${round(-half + width * 0.08)}" y="${round(-design.baseHeight * 0.86)}" width="${round(width * 0.84)}" height="4" fill="${accent}" opacity="0.85"/>`,
        door,
      )
      break
    }
    case 'stoop': {
      const steps = 3
      for (let i = 0; i < steps; i++) {
        const w = doorWidth + 14 - i * 4
        out.push(
          `<rect x="${round(-w / 2)}" y="${round(-(i + 1) * 3)}" width="${round(w)}" height="3" fill="${palette.trim}" opacity="${0.6 + i * 0.1}"/>`,
        )
      }
      out.push(
        `<rect class="rs-door" x="${round(-doorWidth / 2)}" y="${round(-doorHeight - 9)}" width="${round(doorWidth)}" height="${round(doorHeight)}" fill="${accent}" opacity="0.92"/>`,
        `<rect class="rs-w rs-on" x="${round(-half + width * 0.1)}" y="${round(-design.baseHeight * 0.62)}" width="${round(width * 0.2)}" height="${round(design.baseHeight * 0.3)}"/>`,
        `<rect class="rs-w rs-on" x="${round(half - width * 0.3)}" y="${round(-design.baseHeight * 0.62)}" width="${round(width * 0.2)}" height="${round(design.baseHeight * 0.3)}"/>`,
      )
      break
    }
    case 'yard':
    default: {
      out.push(
        door,
        `<rect class="rs-w rs-on" x="${round(-half + width * 0.12)}" y="${round(-design.baseHeight * 0.7)}" width="${round(width * 0.18)}" height="${round(design.baseHeight * 0.32)}"/>`,
      )
      // A fence, and the packing crates nobody has moved.
      for (let i = 0; i < 5; i++) {
        const x = half - 4 - i * 5
        out.push(`<rect x="${round(x)}" y="-11" width="2" height="11" fill="${palette.trim}" opacity="0.55"/>`)
      }
      break
    }
  }

  out.push(facadeSign(design, top, width))
  return out.join('')
}

/**
 * The name, over the door.
 *
 * A street tells you whose building is whose without a legend, and this is how
 * it does it. There is no text measurement here, so the size is estimated from
 * the character count and a long name falls back to initials rather than
 * running off the brickwork — a sign that does not fit is worse than a monogram.
 */
function facadeSign(design: BuildingDesign, top: number, width: number): string {
  const boardWidth = width * 0.66
  const boardHeight = 13
  const name = design.name.trim().toUpperCase()
  const fitted = (boardWidth * 0.88) / Math.max(1, name.length * 0.62)
  const useInitials = fitted < 6.2
  const text = useInitials ? initials(design.name) : name
  const size = useInitials
    ? Math.min(10, (boardWidth * 0.8) / Math.max(1, text.length * 0.66))
    : Math.min(9.5, fitted)
  const y = top + 4

  // The board is the palette's darkest value rather than its trim, because trim
  // on an oxblood or a sage building is close enough to the wall that the
  // lettering ends up sitting on nothing. Every palette's `glass` is dark, so
  // the same near-white text reads on all of them.
  return `<g class="rs-sign">
  <rect x="${round(-boardWidth / 2)}" y="${round(y)}" width="${round(boardWidth)}" height="${boardHeight}" rx="1.5" fill="${design.palette.glass}"/>
  <rect x="${round(-boardWidth / 2 - 1)}" y="${round(y - 1)}" width="${round(boardWidth + 2)}" height="${boardHeight + 2}" rx="2" fill="none" stroke="${design.palette.trim}" stroke-width="1"/>
  <rect x="${round(-boardWidth / 2)}" y="${round(y)}" width="${round(boardWidth)}" height="1.4" fill="${design.accent}" opacity="0.95"/>
  <text class="rs-sign-text" x="0" y="${round(y + boardHeight - 4)}" text-anchor="middle" font-size="${round(size)}">${esc(text)}</text>
</g>`
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

function awning(design: BuildingDesign, left: number, right: number, y: number): string {
  const stripe = design.accent
  const width = right - left
  const out = [
    `<path d="M ${round(left)} ${round(y)} L ${round(right)} ${round(y)} L ${round(right - 4)} ${round(y + 9)} L ${round(left + 4)} ${round(y + 9)} Z" fill="${stripe}" opacity="0.9"/>`,
  ]
  const stripes = Math.max(3, Math.round(width / 12))
  for (let i = 1; i < stripes; i += 2) {
    const x = left + (width / stripes) * i
    out.push(
      `<path d="M ${round(x)} ${round(y)} L ${round(x + width / stripes)} ${round(y)} L ${round(x + width / stripes - 3.2)} ${round(y + 9)} L ${round(x - 3.2)} ${round(y + 9)} Z" fill="#ffffff" opacity="0.28"/>`,
    )
  }
  return out.join('')
}

// ---- crowns ---------------------------------------------------------------

/** What sits on top. Drawn from the top of the shaft upward. */
function crownSvg(design: BuildingDesign, width: number): string {
  const half = width / 2
  const y = -(design.baseHeight + design.floors * design.floorHeight)
  const { palette, accent } = design
  const h = design.crownHeight
  const g = (body: string) => `<g class="rs-crown" transform="translate(0 ${round(y)})">${body}</g>`

  switch (design.crown) {
    case 'lean-to':
      return g(`<path d="M ${round(-half - 5)} 0 L ${round(half + 5)} ${round(-h)} L ${round(half + 5)} ${round(-h + 5)} L ${round(-half - 5)} 5 Z" fill="${palette.roof}"/>`)
    case 'patched':
      return g(`<rect x="${round(-half - 4)}" y="${round(-h)}" width="${round(width + 8)}" height="${round(h)}" fill="${palette.roof}"/>
<rect x="${round(-half + 6)}" y="${round(-h - 2)}" width="${round(width * 0.36)}" height="6" fill="${palette.shade}"/>
<rect x="${round(half - width * 0.3)}" y="${round(-h + 3)}" width="${round(width * 0.26)}" height="4" fill="${palette.trim}" opacity="0.7"/>`)
    case 'tarp':
      return g(`<path d="M ${round(-half - 6)} 0 Q 0 ${round(-h * 1.6)} ${round(half + 6)} 0 L ${round(half + 6)} 6 Q 0 ${round(-h * 1.1)} ${round(-half - 6)} 6 Z" fill="${palette.roof}"/>`)
    case 'gable':
      return g(`<path d="M ${round(-half - 7)} 0 L 0 ${round(-h)} L ${round(half + 7)} 0 Z" fill="${palette.roof}"/>
<path d="M ${round(-half - 7)} 0 L 0 ${round(-h)} L 0 0 Z" fill="#ffffff" opacity="0.07"/>`)
    case 'hip':
      return g(`<path d="M ${round(-half - 7)} 0 L ${round(-width * 0.22)} ${round(-h)} L ${round(width * 0.22)} ${round(-h)} L ${round(half + 7)} 0 Z" fill="${palette.roof}"/>`)
    case 'false-front':
      return g(`<rect x="${round(-half - 3)}" y="${round(-h)}" width="${round(width + 6)}" height="${round(h)}" fill="${palette.wall}"/>
<rect x="${round(-half - 3)}" y="${round(-h)}" width="${round(width + 6)}" height="4" fill="${palette.trim}"/>
<rect x="${round(-width * 0.3)}" y="${round(-h + 8)}" width="${round(width * 0.6)}" height="7" fill="${accent}" opacity="0.85"/>`)
    case 'cornice':
      return g(`<rect x="${round(-half - 6)}" y="${round(-h)}" width="${round(width + 12)}" height="7" fill="${palette.trim}"/>
<rect x="${round(-half - 3)}" y="${round(-h + 7)}" width="${round(width + 6)}" height="${round(h - 7)}" fill="${palette.shade}"/>`)
    case 'parapet':
      return g(`<rect x="${round(-half - 2)}" y="${round(-h)}" width="${round(width + 4)}" height="${round(h)}" fill="${palette.shade}"/>
<rect x="${round(-half - 2)}" y="${round(-h)}" width="${round(width + 4)}" height="3" fill="${palette.trim}"/>`)
    case 'dentil': {
      const teeth: string[] = []
      const count = Math.floor(width / 8)
      for (let i = 0; i < count; i++) {
        teeth.push(`<rect x="${round(-half + 2 + i * 8)}" y="${round(-h + 8)}" width="4" height="5" fill="${palette.trim}"/>`)
      }
      return g(`<rect x="${round(-half - 7)}" y="${round(-h)}" width="${round(width + 14)}" height="8" fill="${palette.trim}"/>
${teeth.join('')}
<rect x="${round(-half - 2)}" y="${round(-h + 13)}" width="${round(width + 4)}" height="${round(h - 13)}" fill="${palette.shade}"/>`)
    }
    case 'stepped': {
      const steps: string[] = []
      for (let i = 0; i < 3; i++) {
        const w = width - i * (width * 0.22)
        steps.push(`<rect x="${round(-w / 2)}" y="${round(-h + (2 - i) * (h / 3))}" width="${round(w)}" height="${round(h / 3 + 1)}" fill="${i % 2 ? palette.shade : palette.wall}"/>`)
      }
      return g(steps.join(''))
    }
    case 'bracket-cornice': {
      // The SoHo signature: a cornice that projects far enough to throw a shadow.
      const brackets: string[] = []
      const count = Math.max(4, design.bays + 1)
      const pitch = (width + 16) / (count - 1)
      for (let i = 0; i < count; i++) {
        const x = -half - 8 + pitch * i
        brackets.push(`<path d="M ${round(x - 2.5)} ${round(-h + 9)} L ${round(x + 2.5)} ${round(-h + 9)} L ${round(x + 1.5)} ${round(-h + 18)} L ${round(x - 1.5)} ${round(-h + 18)} Z" fill="${palette.trim}"/>`)
      }
      return g(`<rect x="${round(-half - 11)}" y="${round(-h)}" width="${round(width + 22)}" height="5" fill="${palette.trim}"/>
<rect x="${round(-half - 9)}" y="${round(-h + 5)}" width="${round(width + 18)}" height="5" fill="${palette.wall}"/>
${brackets.join('')}
<rect x="${round(-half - 2)}" y="${round(-h + 18)}" width="${round(width + 4)}" height="${round(Math.max(0, h - 18))}" fill="${palette.shade}"/>`)
    }
    case 'pediment':
      return g(`<rect x="${round(-half - 8)}" y="${round(-h + 10)}" width="${round(width + 16)}" height="6" fill="${palette.trim}"/>
<path d="M ${round(-width * 0.34)} ${round(-h + 10)} L 0 ${round(-h)} L ${round(width * 0.34)} ${round(-h + 10)} Z" fill="${palette.wall}"/>
<path d="M ${round(-width * 0.34)} ${round(-h + 10)} L 0 ${round(-h)} L ${round(width * 0.34)} ${round(-h + 10)}" fill="none" stroke="${palette.trim}" stroke-width="2"/>
<rect x="${round(-half - 2)}" y="${round(-h + 16)}" width="${round(width + 4)}" height="${round(h - 16)}" fill="${palette.shade}"/>`)
    case 'balustrade': {
      const posts: string[] = []
      const count = Math.floor(width / 9)
      for (let i = 0; i < count; i++) {
        const x = -half + 4 + i * 9
        posts.push(`<rect x="${round(x)}" y="${round(-h + 5)}" width="3" height="${round(h - 9)}" fill="${palette.trim}" opacity="0.85"/>`)
      }
      return g(`<rect x="${round(-half - 6)}" y="${round(-h)}" width="${round(width + 12)}" height="5" fill="${palette.trim}"/>
${posts.join('')}
<rect x="${round(-half - 6)}" y="-4" width="${round(width + 12)}" height="5" fill="${palette.trim}"/>`)
    }
    case 'setback-crown':
      return g(`<rect x="${round(-half * 0.78)}" y="${round(-h * 0.55)}" width="${round(width * 0.78)}" height="${round(h * 0.55)}" fill="${palette.wall}"/>
<rect x="${round(-half * 0.5)}" y="${round(-h)}" width="${round(width * 0.5)}" height="${round(h * 0.48)}" fill="${palette.shade}"/>
<rect x="${round(-half * 0.5)}" y="${round(-h - 3)}" width="${round(width * 0.5)}" height="3" fill="${accent}" opacity="0.75"/>`)
    case 'ziggurat': {
      const tiers: string[] = []
      for (let i = 0; i < 3; i++) {
        const w = width * (0.82 - i * 0.22)
        tiers.push(`<rect x="${round(-w / 2)}" y="${round(-h * ((i + 1) / 3))}" width="${round(w)}" height="${round(h / 3 + 1)}" fill="${i % 2 ? palette.shade : palette.wall}"/>`)
      }
      return g(tiers.join(''))
    }
    case 'lantern':
      return g(`<rect x="${round(-half * 0.72)}" y="${round(-h * 0.42)}" width="${round(width * 0.72)}" height="${round(h * 0.42)}" fill="${palette.wall}"/>
<rect x="${round(-half * 0.34)}" y="${round(-h * 0.86)}" width="${round(width * 0.34)}" height="${round(h * 0.46)}" fill="${palette.shade}"/>
<rect class="rs-w rs-on rs-busy" x="${round(-half * 0.24)}" y="${round(-h * 0.8)}" width="${round(width * 0.24)}" height="${round(h * 0.32)}"/>
<path d="M ${round(-half * 0.34)} ${round(-h * 0.86)} L 0 ${round(-h)} L ${round(half * 0.34)} ${round(-h * 0.86)} Z" fill="${palette.trim}"/>`)
    case 'deck':
      return g(`<rect x="${round(-half - 3)}" y="${round(-h)}" width="${round(width + 6)}" height="4" fill="${palette.trim}"/>
<rect x="${round(-half)}" y="${round(-h + 4)}" width="${round(width)}" height="${round(h - 4)}" fill="${palette.roof}"/>`)
    case 'spire':
      return g(`<rect x="${round(-half * 0.62)}" y="${round(-h * 0.3)}" width="${round(width * 0.62)}" height="${round(h * 0.3)}" fill="${palette.wall}"/>
<path d="M ${round(-half * 0.44)} ${round(-h * 0.3)} L 0 ${round(-h * 0.94)} L ${round(half * 0.44)} ${round(-h * 0.3)} Z" fill="${palette.shade}"/>
<path d="M ${round(-half * 0.44)} ${round(-h * 0.3)} L 0 ${round(-h * 0.94)} L 0 ${round(-h * 0.3)} Z" fill="#ffffff" opacity="0.09"/>
<rect x="-1" y="${round(-h)}" width="2" height="${round(h * 0.1)}" fill="${palette.trim}"/>
<circle class="rs-beacon" cx="0" cy="${round(-h - 2)}" r="2.6" fill="#ff6b5a"/>`)
    case 'needle':
      return g(`<rect x="${round(-half * 0.5)}" y="${round(-h * 0.2)}" width="${round(width * 0.5)}" height="${round(h * 0.2)}" fill="${palette.wall}"/>
<path d="M ${round(-half * 0.2)} ${round(-h * 0.2)} L 0 ${round(-h * 0.98)} L ${round(half * 0.2)} ${round(-h * 0.2)} Z" fill="${palette.trim}"/>
<circle cx="0" cy="${round(-h * 0.42)}" r="${round(width * 0.14)}" fill="${palette.shade}"/>
<circle class="rs-w rs-on" cx="0" cy="${round(-h * 0.42)}" r="${round(width * 0.09)}"/>
<circle class="rs-beacon" cx="0" cy="${round(-h)}" r="2.4" fill="#ff6b5a"/>`)
    case 'dome':
      return g(`<rect x="${round(-half * 0.7)}" y="${round(-h * 0.24)}" width="${round(width * 0.7)}" height="${round(h * 0.24)}" fill="${palette.wall}"/>
<path d="M ${round(-half * 0.62)} ${round(-h * 0.24)} A ${round(half * 0.62)} ${round(h * 0.6)} 0 0 1 ${round(half * 0.62)} ${round(-h * 0.24)} Z" fill="${palette.shade}"/>
<path d="M ${round(-half * 0.62)} ${round(-h * 0.24)} A ${round(half * 0.62)} ${round(h * 0.6)} 0 0 1 0 ${round(-h * 0.84)} L 0 ${round(-h * 0.24)} Z" fill="#ffffff" opacity="0.08"/>
<rect x="-1.5" y="${round(-h)}" width="3" height="${round(h * 0.18)}" fill="${palette.trim}"/>`)
    case 'mast':
      return g(`<rect x="${round(-half * 0.6)}" y="${round(-h * 0.26)}" width="${round(width * 0.6)}" height="${round(h * 0.26)}" fill="${palette.wall}"/>
<path d="M ${round(-6)} ${round(-h * 0.26)} L -2 ${round(-h)} L 2 ${round(-h)} L 6 ${round(-h * 0.26)} Z" fill="${palette.trim}"/>
<rect x="-8" y="${round(-h * 0.62)}" width="16" height="2" fill="${palette.trim}"/>
<rect x="-6" y="${round(-h * 0.8)}" width="12" height="2" fill="${palette.trim}"/>
<circle class="rs-beacon" cx="0" cy="${round(-h - 2)}" r="2.4" fill="#ff6b5a"/>`)
    case 'halo':
      return g(`<rect x="${round(-half * 0.5)}" y="${round(-h * 0.5)}" width="${round(width * 0.5)}" height="${round(h * 0.5)}" fill="${palette.wall}"/>
<rect x="-2" y="${round(-h * 0.86)}" width="4" height="${round(h * 0.4)}" fill="${palette.trim}"/>
<ellipse class="rs-halo" cx="0" cy="${round(-h * 0.86)}" rx="${round(width * 0.72)}" ry="${round(width * 0.16)}" fill="none" stroke="${accent}" stroke-width="3" opacity="0.85"/>
<ellipse cx="0" cy="${round(-h * 0.86)}" rx="${round(width * 0.52)}" ry="${round(width * 0.11)}" fill="none" stroke="#ffd988" stroke-width="1.4" opacity="0.6"/>`)
    case 'solar-fin': {
      const fins: string[] = []
      for (let i = 0; i < 4; i++) {
        const x = -half * 0.7 + (width * 0.7 * i) / 3
        fins.push(`<path d="M ${round(x)} 0 L ${round(x + 8)} ${round(-h)} L ${round(x + 13)} ${round(-h)} L ${round(x + 5)} 0 Z" fill="${palette.trim}" opacity="${0.65 + i * 0.08}"/>`)
      }
      return g(`<rect x="${round(-half * 0.8)}" y="${round(-h * 0.2)}" width="${round(width * 0.8)}" height="${round(h * 0.2)}" fill="${palette.wall}"/>${fins.join('')}`)
    }
    case 'orb':
      return g(`<rect x="${round(-half * 0.36)}" y="${round(-h * 0.55)}" width="${round(width * 0.36)}" height="${round(h * 0.55)}" fill="${palette.wall}"/>
<circle cx="0" cy="${round(-h * 0.72)}" r="${round(width * 0.24)}" fill="${palette.shade}"/>
<circle class="rs-orb" cx="0" cy="${round(-h * 0.72)}" r="${round(width * 0.16)}" fill="${accent}" opacity="0.9"/>
<ellipse cx="0" cy="${round(-h * 0.72)}" rx="${round(width * 0.36)}" ry="${round(width * 0.08)}" fill="none" stroke="${palette.trim}" stroke-width="2" opacity="0.8"/>`)
    case 'skybridge-crown':
      return g(`<rect x="${round(-half * 0.86)}" y="${round(-h)}" width="${round(width * 0.26)}" height="${round(h)}" fill="${palette.wall}"/>
<rect x="${round(half * 0.6)}" y="${round(-h * 0.82)}" width="${round(width * 0.26)}" height="${round(h * 0.82)}" fill="${palette.shade}"/>
<rect x="${round(-half * 0.6)}" y="${round(-h * 0.66)}" width="${round(width * 1.2)}" height="7" fill="${palette.trim}"/>
<rect class="rs-w rs-on" x="${round(-half * 0.56)}" y="${round(-h * 0.66) + 2}" width="${round(width * 1.12)}" height="3"/>`)
    default:
      return ''
  }
}

// ---- what people leave on roofs -------------------------------------------

function ornamentSvg(design: BuildingDesign, ornament: Ornament): string {
  const roofY = -(design.baseHeight + design.floors * design.floorHeight)
  const width = topWidth(design)
  const half = width / 2
  const bodyHalf = design.width / 2
  const { palette, accent } = design
  // Deterministic placement, so the water tower does not wander between renders.
  const rng = new Chooser(seedOf(`${design.id}:${ornament}`))
  const side = rng.chance(0.5) ? -1 : 1
  const g = (body: string, dx = 0, dy = 0) =>
    `<g class="rs-ornament rs-o-${ornament}" transform="translate(${round(dx)} ${round(roofY + dy)})">${body}</g>`

  switch (ornament) {
    case 'chimney':
      return g(`<rect x="-4" y="-22" width="9" height="24" fill="${palette.trim}"/>
<rect x="-6" y="-25" width="13" height="4" fill="${palette.shade}"/>
<circle class="rs-smoke" cx="0" cy="-30" r="4" fill="#ffffff" opacity="0.14"/>
<circle class="rs-smoke rs-smoke-2" cx="3" cy="-40" r="6" fill="#ffffff" opacity="0.1"/>`, side * half * 0.55, -design.crownHeight * 0.2)
    case 'vent-stack':
      return g(`<rect x="-2" y="-16" width="4" height="17" fill="${palette.trim}"/>
<rect x="-5" y="-19" width="10" height="4" fill="${palette.shade}"/>`, side * half * 0.4, 0)
    case 'weathervane':
      return g(`<rect x="-0.8" y="-20" width="1.6" height="20" fill="${palette.trim}"/>
<path d="M 0 -20 L 10 -16 L 0 -12 Z" fill="${accent}"/>
<rect x="-6" y="-15" width="12" height="1" fill="${palette.trim}" opacity="0.7"/>`, side * half * 0.45, -design.crownHeight * 0.55)
    case 'ladder': {
      const rungs: string[] = []
      for (let i = 0; i < 5; i++) rungs.push(`<rect x="-4" y="${-3 - i * 5}" width="8" height="1.4" fill="${palette.trim}"/>`)
      return g(`<rect x="-5" y="-26" width="1.4" height="26" fill="${palette.trim}"/>
<rect x="3.6" y="-26" width="1.4" height="26" fill="${palette.trim}"/>${rungs.join('')}`, side * (half - 6), 0)
    }
    case 'water-tower': {
      const legs: string[] = []
      for (let i = -1; i <= 1; i += 2) legs.push(`<rect x="${i * 9 - 1}" y="-14" width="2.2" height="15" fill="${palette.trim}"/>`)
      return g(`${legs.join('')}
<rect x="-13" y="-38" width="26" height="24" rx="2" fill="#6b5744"/>
<rect x="-13" y="-38" width="26" height="3" fill="#8a7259"/>
<path d="M -14 -38 L 0 -48 L 14 -38 Z" fill="#4e4034"/>
<rect x="-13" y="-28" width="26" height="1.4" fill="#00000033"/>
<rect x="-13" y="-22" width="26" height="1.4" fill="#00000033"/>`, side * half * 0.5, -design.crownHeight * 0.1)
    }
    case 'ac-units': {
      const units: string[] = []
      for (let i = 0; i < 3; i++) {
        const x = -18 + i * 15
        units.push(`<rect x="${x}" y="-11" width="12" height="11" rx="1" fill="${palette.trim}"/>
<circle cx="${x + 6}" cy="-5.5" r="3.4" fill="none" stroke="${palette.shade}" stroke-width="1.2"/>`)
      }
      return g(units.join(''), side * half * 0.28, 0)
    }
    case 'antenna':
      return g(`<rect x="-1" y="-40" width="2" height="40" fill="${palette.trim}"/>
<rect x="-7" y="-34" width="14" height="1.6" fill="${palette.trim}"/>
<rect x="-5" y="-28" width="10" height="1.6" fill="${palette.trim}"/>
<rect x="-3.5" y="-22" width="7" height="1.6" fill="${palette.trim}"/>`, side * half * 0.6, -design.crownHeight * 0.3)
    case 'satellite':
      return g(`<rect x="-1.5" y="-12" width="3" height="12" fill="${palette.trim}"/>
<ellipse cx="0" cy="-16" rx="9" ry="6" fill="${palette.shade}" transform="rotate(-24 0 -16)"/>
<ellipse cx="0" cy="-16" rx="6" ry="4" fill="${palette.wall}" transform="rotate(-24 0 -16)"/>`, side * half * 0.62, 0)
    case 'flag':
      return g(`<rect x="-1" y="-30" width="2" height="30" fill="${palette.trim}"/>
<path class="rs-flag" d="M 1 -30 L 20 -26 L 1 -22 Z" fill="${accent}"/>`, side * half * 0.7, -design.crownHeight * 0.6)
    case 'clock':
      return g(`<circle cx="0" cy="0" r="13" fill="${palette.trim}"/>
<circle cx="0" cy="0" r="10.5" fill="#f3e6c8"/>
<rect x="-0.9" y="-7" width="1.8" height="8" fill="#2a2620" rx="0.8"/>
<rect x="-0.9" y="-1" width="6.5" height="1.8" fill="#2a2620" rx="0.8"/>`, 0, -design.crownHeight - 15)
    case 'neon-sign':
      return g(`<rect x="-2" y="-26" width="4" height="26" fill="${palette.trim}"/>
<rect class="rs-neon" x="-16" y="-40" width="32" height="15" rx="2" fill="none" stroke="${accent}" stroke-width="2.4"/>
<rect class="rs-neon" x="-10" y="-35" width="20" height="2" rx="1" fill="${accent}"/>`, side * half * 0.62, -design.crownHeight * 0.4)
    case 'banner':
      return g(`<rect x="-1" y="-4" width="2" height="34" fill="${palette.trim}"/>
<path class="rs-banner" d="M 1 -2 L 15 -2 L 15 30 L 8 25 L 1 30 Z" fill="${accent}" opacity="0.92"/>
<rect x="3" y="6" width="10" height="2" fill="#ffffff" opacity="0.45"/>
<rect x="3" y="12" width="7" height="2" fill="#ffffff" opacity="0.45"/>`, side * (bodyHalf - 16), design.floorHeight * 1.2)
    case 'roof-garden': {
      const shrubs: string[] = []
      for (let i = 0; i < 5; i++) {
        const x = -20 + i * 10
        shrubs.push(`<circle cx="${x}" cy="${-5 - (i % 2) * 2}" r="${4 + (i % 3)}" fill="#4f7a52" opacity="0.9"/>`)
      }
      return g(`<rect x="-26" y="-3" width="52" height="4" fill="${palette.trim}"/>${shrubs.join('')}`, side * half * 0.25, -design.crownHeight * 0.05)
    }
    case 'billboard': {
      const legs = `<rect x="-16" y="-8" width="2.5" height="9" fill="${palette.trim}"/><rect x="14" y="-8" width="2.5" height="9" fill="${palette.trim}"/>`
      return g(`${legs}<rect class="rs-billboard" x="-20" y="-32" width="40" height="25" rx="1.5" fill="${palette.shade}" stroke="${palette.trim}" stroke-width="1.5"/>
<rect x="-15" y="-27" width="24" height="3" fill="${accent}" opacity="0.9"/>
<rect x="-15" y="-21" width="30" height="2.4" fill="#ffffff" opacity="0.35"/>
<rect x="-15" y="-16" width="18" height="2.4" fill="#ffffff" opacity="0.25"/>`, side * half * 0.3, -design.crownHeight * 0.15)
    }
    case 'string-lights': {
      const bulbs: string[] = []
      const span = design.width + 10
      for (let i = 1; i < 9; i++) {
        const t = i / 9
        const x = -span / 2 + span * t
        const sag = Math.sin(Math.PI * t) * 9
        bulbs.push(`<circle class="rs-bulb" cx="${round(x)}" cy="${round(-6 + sag)}" r="2.1" fill="#ffd988" style="animation-delay:${(i * 0.28).toFixed(2)}s"/>`)
      }
      return g(`<path d="M ${round(-span / 2)} -6 Q 0 ${round(12)} ${round(span / 2)} -6" fill="none" stroke="${palette.trim}" stroke-width="1" opacity="0.7"/>${bulbs.join('')}`, 0, -2)
    }
    case 'solar-panel': {
      const panels: string[] = []
      for (let i = 0; i < 3; i++) {
        const x = -21 + i * 15
        panels.push(`<path d="M ${x} 0 L ${x + 13} 0 L ${x + 11} -9 L ${x - 2} -9 Z" fill="#2b3f5e" stroke="${palette.trim}" stroke-width="0.8"/>`)
      }
      return g(panels.join(''), side * half * 0.3, -design.crownHeight * 0.05)
    }
    case 'planters': {
      const pots: string[] = []
      for (let i = 0; i < 3; i++) {
        const x = -16 + i * 16
        pots.push(`<path d="M ${x - 5} 0 L ${x + 5} 0 L ${x + 4} -6 L ${x - 4} -6 Z" fill="${accent}" opacity="0.8"/>
<circle cx="${x}" cy="-9" r="4.5" fill="#4f7a52"/>`)
      }
      return g(pots.join(''), 0, design.baseHeight + design.floors * design.floorHeight - 1)
    }
    case 'pigeons': {
      const birds: string[] = []
      for (let i = 0; i < 3; i++) {
        const x = -12 + i * 12 + (i % 2) * 3
        birds.push(`<ellipse class="rs-pigeon" cx="${x}" cy="-3" rx="3.2" ry="2.4" fill="${palette.trim}" style="animation-delay:${(i * 1.4).toFixed(1)}s"/>
<circle cx="${x + 2.6}" cy="-4.6" r="1.4" fill="${palette.trim}"/>`)
      }
      return g(birds.join(''), side * half * 0.5, -design.crownHeight - 1)
    }
    case 'fire-escape': {
      // Down the front, which is where they are, and the reason the cast-iron
      // block reads as a cast-iron block at any size.
      const rows: string[] = []
      const platform = 22
      // Kept inside the footprint on purpose: a fire escape that overhangs the
      // brickwork reads as a rendering fault rather than as ironwork.
      const x = side * (design.width * 0.5 - platform / 2 - 5)
      for (let floor = 1; floor < design.floors; floor++) {
        const y = -(design.baseHeight + floor * design.floorHeight)
        rows.push(`<rect x="${round(x - platform / 2)}" y="${round(y)}" width="${platform}" height="2" fill="${palette.trim}"/>
<rect x="${round(x - platform / 2)}" y="${round(y - 9)}" width="1.4" height="9" fill="${palette.trim}" opacity="0.85"/>
<rect x="${round(x + platform / 2 - 1.4)}" y="${round(y - 9)}" width="1.4" height="9" fill="${palette.trim}" opacity="0.85"/>
<rect x="${round(x - platform / 2)}" y="${round(y - 5)}" width="${platform}" height="1" fill="${palette.trim}" opacity="0.55"/>
<path d="M ${round(x - platform / 2 + 3)} ${round(y)} L ${round(x + platform / 2 - 3)} ${round(y + design.floorHeight - 1)}" stroke="${palette.trim}" stroke-width="1.6" opacity="0.8"/>`)
      }
      return `<g class="rs-ornament rs-o-fire-escape">${rows.join('')}</g>`
    }
    case 'skybridge': {
      const y = -(design.baseHeight + Math.max(2, Math.floor(design.floors * 0.62)) * design.floorHeight)
      const x = side * (design.width * 0.5)
      const reach = side * 46
      return `<g class="rs-ornament rs-o-skybridge">
<rect x="${round(Math.min(x, x + reach))}" y="${round(y)}" width="${round(Math.abs(reach))}" height="11" rx="3" fill="${palette.shade}"/>
<rect class="rs-w rs-on" x="${round(Math.min(x, x + reach) + 3)}" y="${round(y + 3)}" width="${round(Math.abs(reach) - 6)}" height="4" rx="2"/>
<rect x="${round(Math.min(x, x + reach))}" y="${round(y)}" width="${round(Math.abs(reach))}" height="1.6" fill="${palette.trim}"/></g>`
    }
    case 'drone-pad':
      return g(`<ellipse cx="0" cy="-2" rx="20" ry="6" fill="${palette.shade}"/>
<ellipse class="rs-pad" cx="0" cy="-3" rx="14" ry="4" fill="none" stroke="${accent}" stroke-width="1.8"/>
<circle class="rs-drone" cx="0" cy="-16" r="2.6" fill="${accent}"/>
<rect x="-7" y="-17" width="14" height="1.2" fill="${palette.trim}" opacity="0.8"/>`, side * half * 0.35, -design.crownHeight * 0.05)
    case 'beacon':
      return g(`<rect x="-2.5" y="-9" width="5" height="9" fill="${palette.trim}"/>
<circle class="rs-beacon" cx="0" cy="-12" r="3.4" fill="#ff6b5a"/>`, side * half * 0.55, -design.crownHeight - 2)
    case 'crane': {
      const height = 58
      return g(`<rect x="-2" y="${-height}" width="4" height="${height}" fill="${accent}" opacity="0.85"/>
<rect x="-26" y="${-height}" width="62" height="3.5" fill="${accent}" opacity="0.85"/>
<path d="M 0 ${-height} L -22 ${-height + 3} M 0 ${-height} L 32 ${-height + 3}" stroke="${accent}" stroke-width="1.2" opacity="0.7" fill="none"/>
<rect x="26" y="${-height + 4}" width="1" height="20" fill="${palette.trim}"/>
<rect x="22" y="${-height + 24}" width="9" height="6" fill="${palette.trim}"/>`, side * half * 0.7, -design.crownHeight * 0.2)
    }
    default:
      return ''
  }
}

/** Something is waiting on the owner, and the building would like them to know. */
function waitingFlag(design: BuildingDesign): string {
  const y = -(design.baseHeight + design.floors * design.floorHeight + design.crownHeight)
  return `<g class="rs-waiting" transform="translate(0 ${round(y - 24)})">
  <circle r="11" cy="0" cx="0" fill="#d4703a"/>
  <circle r="11" cy="0" cx="0" fill="none" stroke="#ffffff" stroke-width="1.5" opacity="0.55"/>
  <rect x="-1.4" y="-6" width="2.8" height="7.5" rx="1.2" fill="#ffffff"/>
  <circle cx="0" cy="4" r="1.6" fill="#ffffff"/>
</g>`
}

// ---- the city -------------------------------------------------------------

/**
 * The whole skyline, as one self-contained `<svg>`.
 *
 * Sized to its contents: a city of shacks is not given the headroom of a city of
 * towers, because empty sky above a row of sheds looks like a bug rather than
 * like restraint.
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
   * scale a row of thirty needs is a speck in the middle of a large dark
   * rectangle. Scaling toward a comfortable row width means a new skyline reads
   * as a place from the first building, and a crowded one still fits.
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
   * A floor under the sky, so a low skyline is still a skyline.
   *
   * The page scales this drawing to the height of its frame, so a canvas only
   * as tall as its tallest building gets magnified to fill the screen — and a
   * city of two shacks came out looking like two barns. Giving the short cases
   * more sky costs nothing and keeps everything at a believable size.
   */
  const tallest = Math.max(
    options.backdrop === false ? 120 : 320,
    designs.reduce((max, d) => Math.max(max, d.design.height + ornamentHeadroom(d.design)), 120) * zoom,
  )
  const belowGround = options.labels === false ? 40 : 118
  // A city wants sky above it; a portrait wants a margin. The backdrop being
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

  // Bounded. `stars()` and `backdrop()` loop across the whole canvas, so a
  // width that runs away is megabytes of markup and, if the aspect were ever
  // non-finite, a loop that never ends. Wide enough for a very large skyline on
  // a very wide screen; nowhere near enough to hang anything.
  const MAX_WIDTH = 40_000
  const width = Math.min(
    MAX_WIDTH,
    Math.max(options.minWidth ?? 760, natural, wantWidth, aspect > 0 ? Math.round(naturalHeight * aspect) : 0),
  )

  /**
   * And the shortfall the other way is made up in sky.
   *
   * Widening was only half of fitting a hole. A frame taller than the drawing's
   * own proportions could not be matched by adding pavement, so the ratios
   * stayed apart, and an SVG whose `preserveAspectRatio` is the default centres
   * that difference — a black bar above the sky and another below the street,
   * on every screen wider than it was tall. Four shacks in a large frame is the
   * common case, not the corner one.
   *
   * Sky is the right thing to spend it on. It costs one gradient stop, the
   * buildings stay the size they were drawn, and a low skyline under a lot of
   * evening is the picture this is trying to be anyway.
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
  parts.push(cityDefs(width, height, groundY))
  parts.push(CITY_STYLE)
  parts.push(`<rect x="0" y="0" width="${round(width)}" height="${round(height)}" fill="url(#rs-sky)"/>`)
  parts.push(stars(width, groundY))
  const moonX = width * 0.82
  const moonY = skyAbove * 0.42
  const moonR = Math.min(34, skyAbove * 0.2)
  parts.push(`<circle cx="${round(moonX)}" cy="${round(moonY)}" r="${round(moonR * 4.2)}" fill="url(#rs-moonglow)"/>`)
  parts.push(`<circle cx="${round(moonX)}" cy="${round(moonY)}" r="${round(moonR)}" fill="#f6e7c4" opacity="0.95"/>`)
  if (options.backdrop !== false) parts.push(backdrop(width, groundY))
  parts.push(`<rect x="0" y="${round(groundY - 90)}" width="${round(width)}" height="90" fill="url(#rs-haze)"/>`)

  // The street.
  parts.push(`<rect x="0" y="${round(groundY)}" width="${round(width)}" height="${round(height - groundY)}" fill="url(#rs-ground)"/>`)
  parts.push(`<rect x="0" y="${round(groundY)}" width="${round(width)}" height="1.5" fill="#ffffff" opacity="0.13"/>`)
  parts.push(`<rect x="0" y="${round(groundY + 15)}" width="${round(width)}" height="1" fill="#ffffff" opacity="0.05"/>`)

  // Lamps first, so a building stands in front of the one beside it.
  parts.push(
    streetlights(designs.map((d) => Math.max(d.design.width, 96) * zoom), margin + spare, gap * zoom, groundY),
  )

  let x = margin + spare
  for (const { design, state, note } of designs) {
    const slot = Math.max(design.width, 96)
    const centre = x + (slot * zoom) / 2
    // Scaled about its own feet, so the whole row still stands on one street.
    parts.push(
      `<g class="rs-plot" data-building="${esc(design.id)}" tabindex="0" role="button" aria-label="${esc(design.name)} — ${esc(design.tier.name)}, ${design.headcount} on staff" transform="translate(${round(centre)} ${round(groundY)}) scale(${round(zoom)})">`,
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

/**
 * Lamps in the gaps between the plots.
 *
 * They do the work no amount of detail on the buildings can: they put something
 * human-sized at the bottom of the picture, which is what tells you the tower
 * next to it is a tower. Without them the whole city could be a tabletop model.
 */
function streetlights(slots: readonly number[], margin: number, gap: number, groundY: number): string {
  if (slots.length === 0) return ''
  const out: string[] = ['<g class="rs-lamps">']
  let x = margin
  for (let i = 0; i <= slots.length; i++) {
    // One in the gap before each plot, and one after the last.
    const at = i === 0 ? x - gap / 2 : x + (slots[i - 1] ?? 0) + gap / 2
    if (i > 0) x += (slots[i - 1] ?? 0) + gap
    if (i % 2 === 1) continue
    const height = 46
    out.push(`<g transform="translate(${round(at)} ${round(groundY)})">
  <ellipse cx="4" cy="3" rx="34" ry="10" fill="url(#rs-lamppool)"/>
  <rect x="-1.2" y="${-height}" width="2.4" height="${height}" fill="#1d1a24"/>
  <rect x="-4" y="-2" width="8" height="3" rx="1" fill="#1d1a24"/>
  <path d="M -1 ${-height} Q -1 ${-height - 7} 6 ${-height - 7}" fill="none" stroke="#1d1a24" stroke-width="2.2"/>
  <circle cx="7" cy="${-height - 5}" r="20" fill="url(#rs-lampglow)"/>
  <ellipse cx="7" cy="${-height - 5}" rx="4.6" ry="3.2" fill="#ffe6ab"/>
</g>`)
  }
  out.push('</g>')
  return out.join('')
}

/** How far above the roof an ornament can reach, so nothing gets clipped. */
function ornamentHeadroom(design: BuildingDesign): number {
  let extra = 30
  for (const ornament of design.ornaments) {
    if (ornament === 'antenna' || ornament === 'crane') extra = Math.max(extra, 62)
    else if (ornament === 'water-tower' || ornament === 'billboard' || ornament === 'flag') extra = Math.max(extra, 52)
    else if (ornament === 'neon-sign' || ornament === 'clock') extra = Math.max(extra, 46)
  }
  return extra
}

function cityDefs(width: number, height: number, groundY: number): string {
  return `<defs>
  <linearGradient id="rs-sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#131a2e"/>
    <stop offset="0.38" stop-color="#22273f"/>
    <stop offset="0.72" stop-color="#463a4d"/>
    <stop offset="0.9" stop-color="#7c5555"/>
    <stop offset="1" stop-color="#a97051"/>
  </linearGradient>
  <linearGradient id="rs-haze" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#a9705100"/>
    <stop offset="1" stop-color="#c08a5e4d"/>
  </linearGradient>
  <linearGradient id="rs-ground" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2b2634"/>
    <stop offset="1" stop-color="#16141c"/>
  </linearGradient>
  <linearGradient id="rs-far" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#3b3550"/>
    <stop offset="1" stop-color="#584560"/>
  </linearGradient>
  <linearGradient id="rs-near" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2a2740"/>
    <stop offset="1" stop-color="#3a3350"/>
  </linearGradient>
  <radialGradient id="rs-moonglow">
    <stop offset="0" stop-color="#f6e7c4" stop-opacity="0.28"/>
    <stop offset="0.45" stop-color="#f6e7c4" stop-opacity="0.09"/>
    <stop offset="1" stop-color="#f6e7c4" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="rs-shadow">
    <stop offset="0" stop-color="#000000" stop-opacity="0.5"/>
    <stop offset="0.6" stop-color="#000000" stop-opacity="0.22"/>
    <stop offset="1" stop-color="#000000" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="rs-lampglow">
    <stop offset="0" stop-color="#ffe6ab" stop-opacity="0.5"/>
    <stop offset="0.4" stop-color="#ffd988" stop-opacity="0.16"/>
    <stop offset="1" stop-color="#ffd988" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="rs-lamppool">
    <stop offset="0" stop-color="#ffd988" stop-opacity="0.22"/>
    <stop offset="1" stop-color="#ffd988" stop-opacity="0"/>
  </radialGradient>
</defs>`
}

/** Stars, thinning out toward the horizon where the sky is still warm. */
function stars(width: number, groundY: number): string {
  const rng = new Chooser(0x5c17)
  const out: string[] = ['<g class="rs-stars">']
  const count = Math.round(width / 9)
  for (let i = 0; i < count; i++) {
    const x = rng.float(0, width)
    const y = rng.float(0, groundY * 0.6)
    // Fade them out as they approach the lit part of the sky.
    const opacity = (1 - y / (groundY * 0.6)) * rng.float(0.25, 0.9)
    if (opacity < 0.06) continue
    const r = rng.chance(0.12) ? 1.5 : rng.float(0.5, 1.05)
    out.push(
      `<circle class="rs-star" cx="${round(x)}" cy="${round(y)}" r="${round(r)}" fill="#fff6e0" opacity="${round(opacity)}" style="animation-delay:${rng.float(0, 6).toFixed(1)}s"/>`,
    )
  }
  out.push('</g>')
  return out.join('')
}

/**
 * The rest of the city: anonymous, hazed, and nobody's.
 *
 * It exists so the buildings that *are* yours have somewhere to stand. A row of
 * six towers on an empty gradient reads as a chart; the same six against a
 * skyline reads as a place.
 */
function backdrop(width: number, groundY: number): string {
  const layers = [
    { seed: 0x9e11, fill: 'url(#rs-far)', opacity: 0.5, min: 60, max: 190, step: 46, y: groundY - 26, blurClass: 'rs-far' },
    { seed: 0x37a2, fill: 'url(#rs-near)', opacity: 0.72, min: 40, max: 130, step: 62, y: groundY - 8, blurClass: 'rs-mid' },
  ]
  const out: string[] = []
  for (const layer of layers) {
    const rng = new Chooser(layer.seed)
    const shapes: string[] = [`<g class="${layer.blurClass}" opacity="${layer.opacity}">`]
    let x = -30
    while (x < width + 30) {
      const w = rng.float(layer.step * 0.55, layer.step * 1.25)
      const h = rng.float(layer.min, layer.max)
      shapes.push(`<rect x="${round(x)}" y="${round(layer.y - h)}" width="${round(w)}" height="${round(h)}" fill="${layer.fill}"/>`)
      // A few of them get something on top, which is what stops a backdrop
      // from reading as a bar chart.
      if (rng.chance(0.24)) {
        shapes.push(`<rect x="${round(x + w * 0.3)}" y="${round(layer.y - h - 14)}" width="${round(w * 0.4)}" height="14" fill="${layer.fill}"/>`)
      }
      if (rng.chance(0.14)) {
        shapes.push(`<rect x="${round(x + w * 0.46)}" y="${round(layer.y - h - 26)}" width="2" height="26" fill="${layer.fill}"/>`)
      }
      // Distant lit windows, sparse enough to read as distance.
      const rows = Math.floor(h / 16)
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < 3; c++) {
          if (!rng.chance(0.1)) continue
          shapes.push(
            `<rect x="${round(x + 5 + c * (w / 3.4))}" y="${round(layer.y - h + 8 + r * 16)}" width="2.6" height="3.4" fill="#ffd988" opacity="${round(rng.float(0.3, 0.7))}"/>`,
          )
        }
      }
      x += w + rng.float(2, 14)
    }
    shapes.push('</g>')
    out.push(shapes.join(''))
  }
  return out.join('')
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
  const status = note ?? `${design.headcount} on staff`
  const busy = state.busy === true
  // No text measurement available here, so estimate from the type size. Erring
  // toward truncation is right: two labels touching looks broken, and one
  // ellipsis does not.
  const name = clip(design.name, Math.floor(slot / 8.1))
  const statusText = clip(status, Math.floor(slot / 6))
  return `<g class="rs-plate">
  <title>${esc(design.name)} — ${esc(design.tier.name)}, ${design.headcount} on staff</title>
  <text class="rs-name" x="0" y="34" text-anchor="middle">${esc(name)}</text>
  <text class="rs-note" x="0" y="53" text-anchor="middle">${esc(statusText)}</text>
  ${busy ? '<circle class="rs-busy-dot" cx="0" cy="66" r="3.2" fill="#e8c15a"/>' : ''}
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

/** Where the next one goes. An empty skyline should still look like a place. */
function emptyLot(x: number, groundY: number, width: number, zoom = 1): string {
  const inner = width / zoom
  return `<g class="rs-lot" data-lot="1" tabindex="0" role="button" aria-label="Break ground on a new building" transform="translate(${round(x + width / 2)} ${round(groundY)}) scale(${round(zoom)})">
  <rect class="rs-lot-plot" x="${round(-inner / 2)}" y="-120" width="${round(inner)}" height="120" rx="6"/>
  <path class="rs-lot-plus" d="M -13 -60 L 13 -60 M 0 -73 L 0 -47" stroke-width="2.6" stroke-linecap="round" fill="none"/>
  <text class="rs-lot-text" x="0" y="34" text-anchor="middle">Break ground</text>
  <text class="rs-note" x="0" y="54" text-anchor="middle">an empty lot</text>
</g>`
}

/**
 * Style and animation, inline, because the SVG has to survive being handed
 * around on its own. Motion is slow and small on purpose: a home screen that
 * twitches is one people close.
 */
const CITY_STYLE = `<style>
  .rs-city { display: block; }
  .rs-name { font: 600 15px/1 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif; fill: #f2ece1; letter-spacing: .01em; }
  .rs-note { font: 400 11.5px/1 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif; fill: #a99e92; letter-spacing: .04em; }
  .rs-lot-text { font: 600 13px/1 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif; fill: #b3a898; }
  .rs-sign-text { font-family: ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
                  font-weight: 700; letter-spacing: .07em; fill: #f7efdf; }

  .rs-w { transition: fill .5s ease; }
  .rs-on { fill: #f0c778; }
  .rs-on.rs-t0 { fill: #efc477; }
  .rs-on.rs-t1 { fill: #e0b264; }
  .rs-on.rs-t2 { fill: #f7d99b; }
  .rs-busy, .rs-busy.rs-t0, .rs-busy.rs-t1, .rs-busy.rs-t2 { fill: #ffd98d; }
  .rs-busy { animation: rs-flicker 5.5s ease-in-out infinite; }
  @keyframes rs-flicker { 0%,100% { opacity: 1 } 42% { opacity: .82 } 62% { opacity: 1 } 78% { opacity: .9 } }

  .rs-plot { cursor: pointer; transition: transform .28s cubic-bezier(.22,1,.36,1); transform-box: view-box; }
  .rs-plot:hover, .rs-plot:focus-visible { outline: none; }
  .rs-plot:hover .rs-building, .rs-plot:focus-visible .rs-building { transform: translateY(-7px); }
  .rs-building { transition: transform .28s cubic-bezier(.22,1,.36,1); }
  .rs-plot:hover .rs-name, .rs-plot:focus-visible .rs-name { fill: #ffd98d; }
  .rs-plot:hover .rs-shadow, .rs-plot:focus-visible .rs-shadow { opacity: .55; }
  .rs-shadow { transition: opacity .28s ease; }

  .rs-lot { cursor: pointer; }
  .rs-lot-plot { fill: #ffffff08; stroke: #ffffff2e; stroke-width: 1.5; stroke-dasharray: 7 7; transition: fill .2s ease, stroke .2s ease; }
  .rs-lot-plus { stroke: #b3a898; transition: stroke .2s ease; }
  .rs-lot:hover .rs-lot-plot, .rs-lot:focus-visible .rs-lot-plot { fill: #ffffff12; stroke: #e8c15a80; }
  .rs-lot:hover .rs-lot-plus, .rs-lot:focus-visible .rs-lot-plus { stroke: #e8c15a; }
  .rs-lot:hover .rs-lot-text, .rs-lot:focus-visible .rs-lot-text { fill: #e8c15a; }
  .rs-lot:focus-visible { outline: none; }

  .rs-star { animation: rs-twinkle 7s ease-in-out infinite; }
  @keyframes rs-twinkle { 0%,100% { opacity: inherit } 50% { opacity: .18 } }

  .rs-beacon { animation: rs-blink 3.4s steps(1, end) infinite; }
  @keyframes rs-blink { 0%, 55% { opacity: 1 } 56%, 100% { opacity: .12 } }

  .rs-busy-dot { animation: rs-pulse 2.2s ease-in-out infinite; }
  @keyframes rs-pulse { 0%,100% { opacity: 1; r: 3.2 } 50% { opacity: .35; r: 2.4 } }

  .rs-waiting { animation: rs-bob 3s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
  @keyframes rs-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }

  .rs-smoke { animation: rs-rise 9s ease-out infinite; }
  .rs-smoke-2 { animation-delay: 4.5s; }
  @keyframes rs-rise { 0% { opacity: .16; transform: translateY(0) scale(.5) } 100% { opacity: 0; transform: translateY(-34px) scale(1.9) } }

  .rs-flag, .rs-banner { transform-box: fill-box; transform-origin: left center; animation: rs-wave 4.5s ease-in-out infinite; }
  @keyframes rs-wave { 0%,100% { transform: skewY(0deg) } 50% { transform: skewY(-3.5deg) } }

  .rs-neon { animation: rs-buzz 6s steps(1, end) infinite; }
  @keyframes rs-buzz { 0%, 91% { opacity: 1 } 92%, 94% { opacity: .25 } 95%, 100% { opacity: 1 } }

  .rs-bulb { animation: rs-glow 3.6s ease-in-out infinite; }
  @keyframes rs-glow { 0%,100% { opacity: 1 } 50% { opacity: .45 } }

  .rs-halo { transform-box: fill-box; transform-origin: center; animation: rs-spin 22s linear infinite; }
  @keyframes rs-spin { 0% { transform: rotate(0deg) } 100% { transform: rotate(360deg) } }

  .rs-orb { animation: rs-glow 4.4s ease-in-out infinite; }
  .rs-pad { animation: rs-glow 2.8s ease-in-out infinite; }
  .rs-drone { animation: rs-hover 5s ease-in-out infinite; }
  @keyframes rs-hover { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-7px) } }

  .rs-pigeon { animation: rs-peck 6s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
  @keyframes rs-peck { 0%,88%,100% { transform: rotate(0deg) } 92% { transform: rotate(-13deg) } }

  @media (prefers-reduced-motion: reduce) {
    .rs-busy, .rs-star, .rs-beacon, .rs-busy-dot, .rs-waiting, .rs-smoke,
    .rs-flag, .rs-banner, .rs-neon, .rs-bulb, .rs-halo, .rs-orb, .rs-pad,
    .rs-drone, .rs-pigeon { animation: none; }
    .rs-plot:hover .rs-building { transform: none; }
  }
</style>`

/**
 * One building on its own, for a company's own page.
 *
 * Framed tight. The city's minimum canvas is there so a row of buildings has
 * somewhere to stand; applied to a single portrait it produces one small
 * building adrift in a great deal of sky.
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
