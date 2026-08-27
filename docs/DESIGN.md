# Dusk — how Roofscape looks, and why

The city is the product. Everything else is the architect's office around it:
drafting paper, brass fittings, a lamp on. The chrome's job is to be quiet
enough that the skyline is the brightest thing on the screen, and precise enough
that the whole thing reads as drawn rather than assembled.

This is the whole of the visual system. `apps/daemon/public/app.css` implements
it and nothing in the app invents a value that is not here — which is checked
rather than hoped for. `apps/daemon/src/design.test.ts` reads the stylesheet and
fails the build if a `var()` has no token behind it, if a font size is not on the
scale, if a colour appears that nobody named, or if amber ever fills a neutral
control. A stylesheet keeps this sort of promise for about three weeks unless
something is watching, and the failure mode is quiet: a renamed token makes CSS
drop the whole property and inherit, which usually looks *almost* right.

## One rule above the others

**Nothing is decorative.** Every colour, every glow, every piece of motion means
something specific, and means only that. Amber is light — a window with somebody
behind it, work in hand, a building that just grew. Terracotta is *you* — the
approval desk, the flag on a roof, the number waiting on your say-so. If a thing
is amber it is about work; if it is terracotta it is about you. The moment amber
becomes "our brand colour, used on buttons" the skyline stops meaning anything,
because the eye can no longer tell a lit window from a highlight.

## Ground

Four depths, and only four. They are the same indigo the drawn sky starts from,
so the page and the city are lit by the same evening.

| Token | Use |
|---|---|
| `--sunk` | Behind things: inputs, the city frame, the plate under a floor number |
| `--ground` | The page |
| `--panel` | A card sitting on the page |
| `--raised` | Something on a card: a band, a hovered row, a dialog |

Two rules: `--line` for an ordinary division, `--line-strong` for the edge of a
control. There is no third weight, and there are no shadows on anything that is
not floating — a card does not need to hover, it needs an edge.

`--scrim` sits outside the four. It is the dark behind an open dialog, which is
not a depth in the stack so much as the absence of one.

## Ink

Four weights, named for how loud they are rather than for a percentage.

| Token | Use |
|---|---|
| `--ink` | What you are meant to read |
| `--ink-2` | Body prose, message bodies |
| `--ink-3` | Labels, secondary facts |
| `--ink-4` | Timestamps, hints, things present but not offered |

## Light

| Token | Means, and means nothing else |
|---|---|
| `--lamp` | Light: a lit window, work in hand, a building that changed form |
| `--lamp-dim` | The same, quieted — borders and rules that belong to light |
| `--flag` | You: something is waiting on your decision |
| `--good` | It held: a task done, a provider reachable, an accepted review |
| `--alarm` | It did not: blocked, refused, failed |
| `--cool` | In somebody else's hands: under review, in flight |

## Type

One family for anything a person wrote, one for anything a machine produced. An
id, a model name, a branch, a command you are meant to type — those are
monospace, always, because they are things to copy rather than to read.

Seven sizes. Nothing between them.

| Role | Size | Use |
|---|---|---|
| `plate` | 11 | Small caps, `.11em` tracked. Architectural labels — the lettering on a drawing |
| `micro` | 12.5 | Timestamps, notes, help |
| `small` | 13.5 | Secondary rows, dialog prose |
| `body` | 15 | Default |
| `lead` | 19 | Card headings |
| `title` | 27 | A building's name |
| `display` | 34 | A tally you are meant to read across the room |

`plate` is the one that does the work. Small, spaced capitals are how a drawing
labels a thing without competing with it, and using them consistently is most of
why the app reads as drafted.

Numbers are tabular everywhere. A tally that jitters as it counts is a tally
nobody trusts.

## Space

4, 8, 12, 16, 24, 32, 48, 64. If a gap wants to be 20, it is 16 or 24.

## Shape

Three, plus the pill. There was a fourth for "rows and inner blocks" and
nothing ever used it, so it is gone: a token nothing uses is a token that
drifts.

| Radius | Use |
|---|---|
| 6 | Controls: buttons, inputs, small plates |
| 16 | Surfaces: cards, dialogs, the portrait |
| 999 | Pills and lamps |

## Motion

One easing — `cubic-bezier(.22, 1, .36, 1)`, which arrives quickly and settles.
Three durations: `--fast` .16s for a hover, `--base` .26s for a change of state,
`--slow` .42s for something with weight behind it.

Things **rise**. Nothing bounces, nothing spins except a thing that is genuinely
turning, and nothing moves more than a few pixels. A home screen that twitches
is one people close.

Every animation is switched off under `prefers-reduced-motion`, including the
ones inside the drawn city.

## The playful part

The metaphor is load-bearing, not a theme. It earns its keep by being used
*literally* wherever there is a real counterpart:

- A floor in the staff list is a **storey**: it has a lift plate with its number
  on it, and it lights from the inside when somebody on it is working — the same
  amber, at the same moment, as that floor's windows out on the skyline.
- The list has a **roof** on top and, below the last storey, the **lobby** at
  street level and the **archives** below ground, tinted darker for being
  underground.
- Waiting on you is a **flag** on the building and a terracotta count in the
  lobby, because the approval desk is in the lobby.
- Breaking ground is an **empty lot** on the street, not a button in a corner.

What it must never become is decoration for its own sake. A loading spinner
shaped like a crane would be a joke told twice.

## Voice

Plain sentences. No exclamation marks, no congratulation the software has not
earned. Say the true thing in the fewest ordinary words: *on a break*, *nobody
in it yet*, *send the curator down*, *break ground*.

Empty states say what the thing is for, not that it is empty. "Nothing built
yet. Break ground on the empty lot to start your first company" is a sentence;
"No data" is a shrug.

Errors say what happened and what to do. `No such directory: /Users/you/thing.
Make it first, or point somewhere that exists.`

## Cost

A palette this constrained means some things cannot be given their own colour —
a fifth state has to earn one of the six or make do with ink. That is the point,
and it is also a real limit: this system would not survive a screen that needed
to distinguish twelve categories at once, and if one appears the answer is to
change the screen rather than to add a colour.

Naming colours by meaning rather than by hue also means a redesign is a rename.
Swapping amber for green is one token; deciding light should be green everywhere
including in the drawn city is a day. Accepted deliberately: the alternative is
`--yellow-500`, which tells you nothing about whether you may use it here.
