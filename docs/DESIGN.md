# Overprint — how Roofscape looks, and why

The city is the product. Everything else is the sheet it is printed on.

Roofscape is drawn the way a cheap and lovely two-colour book is printed: warm
oatmeal stock, one plate carrying every line in warm-black ink, a second plate
carrying every flat wash of colour, and the colour plate landing a millimetre or
two off the ink. That misregistration is the whole visual identity. It is
deliberate, it is per-building, and it is most of why the home screen looks like
something a person made rather than something a program emitted.

This document is the whole of the visual system. `apps/daemon/public/app.css`
implements the chrome and `packages/core/src/skyline/svg.ts` implements the
drawing, and neither invents a value that is not written here — which is checked
rather than hoped for. `apps/daemon/src/design.test.ts` reads the stylesheet and
fails the build if a `var()` has no token behind it, if a font size is off the
scale, if a colour appears that nobody named, or if either meaning colour ever
fills a control. `packages/core/src/skyline/design.test.ts` does the same job for
the paint the buildings are made of.

A stylesheet keeps this sort of promise for about three weeks unless something is
watching, and the failure mode is quiet: a renamed token makes CSS drop the whole
property and inherit, which usually looks *almost* right.

## What this replaces

The previous system was called **Dusk**. It drew the city at night out of real
materials — bluestone, black steel, curtain wall — under a moon, with
streetlamps pooling on the pavement. It was precise and it was cold, and
precision that arrives without warmth reads as a machine being careful rather
than as a person being good at something.

The fix was not less rigour. It was the same rigour in a warmer register, and the
move that unlocked it is a physical fact:

> **On paper you cannot emit light. You can only mark where it fell.**

Dusk made light by emitting it into darkness — glows, gradients, haze. On warm
paper none of that is available, and that turns out to be a gift, because a mark
is more honest than a glow: a mark is either there or it is not. Decision 0016
records what taking that seriously cost.

Nothing about *what* a building is changed. Height is still headcount, form is
still a pure function of headcount, and a building's look is still derived
deterministically from its id. Decisions 0009 and 0013 survive intact. What
changed is the alphabet, not the sentence.

---

## The one rule

**Nothing is decorative.** Two colours mean things, and they are the only
saturated colours anywhere in the product.

- **`--lamp` marigold means LIGHT** — a window with somebody behind it, work in
  hand, a building that just grew a storey.
- **`--flag` vermilion means YOU** — something is waiting on your say-so.

Everything else on the screen is paper and ink. Stated flatly, so that nobody has
to infer it from a palette table:

> **There is no brand colour. The primary button is `--ink`.**

A warm-black pill is the loudest a control is ever allowed to be. Focus rings are
ink at 20%. `accent-color` is ink. The moment marigold fills a button, the eye
can no longer tell a lit window from a highlight, and the city stops meaning
anything — which is to say the product stops making its argument.

### The worked example: two bugs Dusk shipped

This rule was written down in the old design document, in almost these words, and
the product broke it anyway in two places. Both are worth reading, because
between them they explain why the rule is now enforced by a test rather than by a
paragraph.

**One.** `ACCENTS[0]` in `design.ts:135` was `#d4703a`. `--flag` in `app.css:35`
was `#d4703a`. Byte-identical. The accent pool had ten entries, so roughly one
building in ten wore the *this needs you* colour as awning paint, permanently,
for no reason, on a home screen whose entire job is to let you find the thing
that needs you from across the room. Nobody chose this. Two people picked a nice
warm orange months apart, and neither had any way to find out the other had.

**Two.** `.solid` — the primary button, the one on the goal box — was
`background: var(--lamp)`. So was the focus ring, twice, as the raw literals
`#e8c15a26` and `#e8c15a4d`. So was `accent-color` on every checkbox. Four amber
fills on ordinary controls, on the same screen as the lit windows they were
supposed to be distinguishable from.

The part that matters is what the old test did about it. `design.test.ts` had a
check named *nothing is styled with a colour whose meaning is not written down*,
and inside it a list:

```js
const neutral = ['.ghost', '.pill', '.badge.quiet', '.tab', '.post-who', '.floor-no', '.vital']
```

`.solid` is not on that list. The test was written by looking at what was already
there and enumerating the things that happened to be innocent, so it passed on
the day it was written and could never fail afterwards. A test that lists the
selectors it approves of is a test shaped around the bug.

The rewritten check inverts it: scan **every** rule whose selector names
`button`, `.solid`, `.ghost`, `.chip`, `.tab` or an input, and fail if its
background resolves to either meaning colour. And assert
`.solid { background: var(--ink) }` directly, on its own, because it is the
single rule most likely to be helpfully improved later by somebody who thinks the
app looks a bit plain.

### The material bar

The same rule has to hold for paint, not only for chrome, or the first bug comes
straight back the next time somebody adds a palette.

No building paint — `wall`, `shade`, `trim`, `roof`, `lit` — may sit inside
either meaning band unless it is at least 20 L\* darker than the meaning colour
itself. The bands are hue 20°–55° with chroma above 0.09 for marigold, and hue
0°–20° with chroma above 0.10 for vermilion.

This is why the palette set contains no brass and no postbox red, and it is the
reason a single lit window still carries across a street of thirty buildings. It
is a real constraint with a real cost: two perfectly good colours are simply
unavailable to architecture, forever, and somebody will want them.

The accent pool was rebuilt with both bands purged: `#3F7FA8` signal blue,
`#4F8A5B` park green, `#7C4B8C` plum, `#2F8F88` teal, `#C25A7A` rose, `#5B6EC4`
cobalt, `#6D7F47` olive, `#CFC4B1` chalk. The decorative ornament formerly called
`flag` is renamed **pennant**, so that the word cannot mislead the next person to
read the file.

---

## Ground — warm paper, four depths

Never white. `#F1EBDD` is the stock; everything else is that stock pressed into
or lifted off the page.

| Token | Hex | Use |
|---|---|---|
| `--sunk` | `#E6DECC` | Pressed *into* the page: inputs, insets, the plate under a floor number |
| `--ground` | `#F1EBDD` | The page — the stock everything is printed on |
| `--card` | `#FAF6EC` | A card sitting on the page |
| `--raised` | `#FFFDF7` | Something on a card: a hovered row, a dialog |
| `--line` | `#DCD3BF` | An ordinary division |
| `--line-strong` | `#C0B69E` | The edge of a control |

Two grounds sit outside the four, and both for the same reason: the four are
heights above a page, and these are not heights.

- `--scrim`, `#241F17` at 46%, is the dark behind an open dialog — not a depth in
  the stack so much as the absence of one.
- `--under`, `#DFD5C0`, is below ground: the archives, and the curator who works
  down there. Darker than `--sunk`, because earth is darker than shadow.

## Ink — four weights, warm black

Never pure black either. `#1E1B16` is a warm-black ink, which is what a real
press uses, and against this paper the difference between it and `#000000` is the
difference between printed and stuck on.

| Token | Hex | Use |
|---|---|---|
| `--ink` | `#1E1B16` | What you are meant to read. Also the primary button fill |
| `--ink-2` | `#494336` | Body prose, message bodies |
| `--ink-3` | `#786F5D` | Labels, secondary facts |
| `--ink-4` | `#A2987F` | Timestamps, hints. **Forbidden from carrying a sentence** |

`--ink-4` has a rule of its own because it is the token people reach for when
they want something to look calm, and the result is a sentence nobody can read.
It may only appear on rules whose font size is `--t-micro` or `--t-plate`, and
the test checks that.

## Meaning — and nothing else is saturated

| Token | Hex | Means, and means only this |
|---|---|---|
| `--lamp` | `#EFAA22` | Light: a lit window, work in hand |
| `--lamp-lit` | `#F7C556` | The same, brighter: this floor is running right now |
| `--lamp-ink` | `#7A4E00` | Text or a rule belonging to light, readable on paper |
| `--flag` | `#D2452A` | You: waiting on your say-so |
| `--flag-deep` | `#9C2F1B` | The shadowed side of a flag mark |
| `--good` | `#46704F` | It held |
| `--alarm` | `#9E2C1A` | It did not. **Only ever ink or a 2px edge, never a filled area** |
| `--cool` | `#4A6C99` | In somebody else's hands |

`--alarm` is edge-only on purpose. A filled red panel on warm paper is the
loudest thing this system can produce, and a failed task is not the loudest thing
that can happen to somebody.

## Type

Two voices and a machine, all three **vendored into the repository** as woff2 —
see decision 0017. A local app that needs the network to look right is not
finished. Every face carries a real fallback stack besides.

- **`--sans` — Instrument Sans.** Everything a person reads or clicks.
- **`--serif` — Fraunces**, with `SOFT` and `WONK` turned up a little. The
  display voice: a building's name, a tally read across the room, the one line on
  an empty screen. This is where the playfulness lives, and it is confined to
  display sizes so that it never becomes a costume.
- **`--mono` — IBM Plex Mono.** Ids, model names, branches, commands — things to
  copy rather than to read.

Fraunces was chosen for those two axes specifically. It is a serif that can be
asked to relax, and asking it to relax by a few points is the whole difference
between a display line that is charming and one that is stern. Turned up further
it becomes a joke, which is why the setting is fixed here rather than left for a
component to choose.

Seven sizes. Nothing between them.

| Role | Size | Use |
|---|---|---|
| `plate` | 11.5 | Small caps, `.1em` tracked. The lettering on a drawing |
| `micro` | 12.5 | Timestamps, notes, help |
| `small` | 13.5 | Secondary rows, dialog prose |
| `body` | 15.5 | Default |
| `lead` | 20 | Card headings |
| `title` | 30 | A building's name — serif |
| `display` | 44 | A tally you are meant to read across the room — serif |

`plate` is the one that does the work. Small spaced capitals are how a drawing
labels a thing without competing with it, and using them consistently is most of
why the app reads as drafted rather than as assembled.

Numbers are tabular everywhere. A tally that jitters as it counts is a tally
nobody trusts.

## Space

4, 8, 12, 16, 24, 32, 48, 64, **96**. If a gap wants to be 20, it is 16 or 24.

The 96 is the point of the list. Generosity is most of what separates designed
from assembled, and there was no step large enough to be generous with before —
so every page had a ceiling on how much air it could hold, and every page hit it.

## Shape

Three, and nothing else.

| Token | Radius | Use |
|---|---|---|
| `--r-control` | 10px | Buttons, inputs, small plates |
| `--r-surface` | 20px | Cards, dialogs, the portrait |
| `--r-pill` | 999px | Pills |

Both of the first two grew — 6 to 10, 16 to 20. Softer corners turn out to be
half of what "a little more playful" means in practice, and they cost nothing but
the discipline of not adding a fourth.

## Elevation

A card gets an edge, not a shadow. The only two shadows in the product are under
an open dialog and under a building, and the second is a drawn parallelogram
rather than a blur — see below.

## Motion

One easing, `cubic-bezier(.22, 1, .36, 1)`, which arrives quickly and settles.
Three durations: `--fast` .16s for a hover, `--base` .26s for a change of state,
`--slow` .42s for something with weight behind it.

Things **rise**. Nothing bounces and nothing spins except a thing that is
genuinely turning. There are exactly two exceptions, and both are earned:

- a building **settles on a spring** when a hire adds a storey. This is the app's
  one moment of delight, and it is spent on the only event that changes the
  product's shape.
- the waiting mark **rocks gently**, 1.5° about its base over three seconds,
  because it was just pushed into the roof and has not stopped moving yet.

Every animation is off under `prefers-reduced-motion`, including the ones inside
the drawn city.

---

## The city

### No sky

The five-stop evening gradient, the haze band, the moon, the moonglow, the stars,
the lamp glows and the streetlamp pools are gone. Every one of them was night
furniture. The paper shows through and *is* the sky, which is both cheaper and
more honest: a drawing of a city on a sheet of paper does not need somebody to
draw the air.

### The press

Every building is drawn as two groups: `.rs-plate-ink` carries every line, and
`.rs-plate-colour` carries every flat wash. The colour plate is offset by
`transform: translate(dx, dy)`, where `dx` and `dy` come from that building's
seeded `Chooser` within ±1.6px under the sub-seed `${id}:register`.

So no two buildings are off by the same amount, the same building is off by the
same amount forever, and none of it involves any JavaScript at runtime.

**Hovering a building snaps its colour plate into register.**
`.rs-plot:hover .rs-plate-colour { transform: none }` at `--base`. That is the
whole hover interaction. It costs one CSS transform and it is the most satisfying
thing in the app.

The imperfection is *mechanical*, not manual. We are not learning to draw wobbly
— we are printing slightly badly on purpose. That distinction is load-bearing:
hand-wobble would have meant perturbing geometry, and the renderer's 1372 lines
of careful axis-aligned maths would have had to be rewritten to support it. A
misregistered plate survives exact geometry completely, because the geometry is
not the thing that is wrong.

### Line quality

One ink, one weight: `--ink`, 1.6px, round caps and joins. No gradients anywhere
in the drawing at all.

`weathering()`, the `#ffffff14` left highlight and the `#00000026` right shadow
are deleted. White-alpha does nothing on this ground, and black-alpha on warm
paper does not read as shading — it reads as grime.

### Ground plane

One ink line at 1.75px across the full width, and below it the paper darkens to
`--sunk`. Under each building sits a soft parallelogram shadow, down and to the
right, filled from `#6B533A` at 24% to transparent.

Drawn, not blurred. Thirty blur filters on one page is a muddy page, and a slow
one.

### The backdrop

The anonymous city behind yours becomes **outline only**: no fill, `--ink-4`,
1.25px, three depths at 10% / 16% / 24% opacity, and **no windows at all**.

It reads as somebody sketched the rest of town and did not colour it in, which is
exactly the right amount of effort to have spent on something that is not yours.
Taking its windows away also removes the only other lit-looking thing on the
screen, so a lit window is now unambiguously one of yours.

The class names `.rs-far`, `.rs-mid` and `.rs-stars` are kept, because `app.js`
parallaxes them by selector. `.rs-stars` becomes thirty to forty static dust
motes in the paper at `--ink` 5–9%, which is what stars turn into when the sky
becomes a sheet.

### Windows — the socket and the counter

This is the invention the whole redesign hangs on.

On a dark ground, "lit" can mean "lighter than the wall". On a light ground it
cannot — there is nothing above the paper to go up to. So lit stops being a
brightness and becomes a **hole that has been filled**.

Each window is a `<g class="rs-win">` holding, in order:

1. `.rs-socket` — the hole. Filled `palette.socket`: a dark, warm,
   low-saturation version of the wall, roughly 45–55 L\* below it. A recess, not
   near-black.
2. `.rs-lip` — a 1.2-unit band along the socket's top inside edge, `socket`
   darkened 25%. This is the shadow the top of the hole casts into itself, and it
   is the single detail that makes a hole read as a hole rather than as a dark
   rectangle. Skipped on sockets under 6 units tall, where it would only be mud.
3. `.rs-w` — **the counter**, carrying `data-floor`, which is the existing class
   contract the page already drives. It is the socket inset 1.5 all round. Off,
   it is `palette.socket` and therefore invisible inside the hole. `.rs-on` is
   `--lamp`. `.rs-busy` is `--lamp-lit`.
4. `.rs-body` — a circle of radius 1.9 in `--ink` at 55%, at the lower left of
   the counter, emitted only where the bay is at least 7 units wide, and hidden
   unless `.rs-busy`. **Somebody is sitting at that window.**

Three states, and each is told by figure as well as by colour:

| What you see | What it means |
|---|---|
| An empty hole | Nobody on that floor |
| A marigold counter | A light is on — work in hand |
| A brighter counter, and a small dark figure | Somebody is in there working right now |

That third state is new, and it is the thing Dusk could not say. A lit window and
a *busy* window were the same picture, so the drawing could not tell a light left
on from work being done — which is precisely the distinction the one rule claims
the city makes.

Ambient warmth still picks between three flat marigolds by `(index + floor*2) %
3`, exactly as before, so a lit facade reads as separate rooms rather than as a
painted stripe.

The eight window shapes become eight socket outlines sharing that grammar, and a
ninth is added: **porthole**, a circular socket and counter, for the newsstand
and the bodega. A drilled round hole is the most characterful opening there is,
and those two forms had the least character to spare.

### The waiting mark — a pin, not a badge

The terracotta disc with the white exclamation mark inside it is gone. It was a
notification badge, which is a thing software puts on other software.

Something waits on you, so a piece is **pushed into the roof**: a 9×3 base plate
in `--flag-deep`, a 4-wide 20-tall post in `--flag` with radius 2, and a ball of
radius 7 in `--flag` with a 2.4 crescent highlight up and to the left. Class
`rs-waiting`, parked at `y = -(height) - 4`, rocking about its base.

**Nothing else in the entire city is a vertical post with a ball on top.** Shape
carries the signal as strongly as colour does, so somebody colour-blind reads it
without help. And the two meanings occupy different parts of a building's
anatomy: light sits *inside* an opening, you sit *on top*. They cannot be
confused even at thumbnail size.

### Palettes, crowns, bases, ornaments

Six roles per palette: `wall`, `shade`, `lit`, `trim`, `roof`, `socket`. `lit` is
the wall mixed about 22% toward `#FFFAF0` and used as a 3-unit chamfer along the
top of each mass — light on paper is where the paper is least covered.

The palette ladder is New York's own stock, and it is **geological**: masonry low
down — brownstone, tenement brick, buff brick, limestone, glazed terracotta — then
painted cast iron for the lofts, and metal and glass at the top. A brownstone is
never black steel and a supertall is never red brick. That is true outside, it is
what makes a skyline legible, and the same test guards it.

**All 24 crowns and all 23 ornaments are kept.** They are the wit, and the
same-size-different-buildings test proves the variety works. Each is redrawn as
flat fill plus ink outline; every `#ffffff` overlay is replaced, because white
vanishes on this ground.

The ornaments are where the characters live. A water tower that leans. A
weathervane a few degrees off true. A plant that is clearly not being watered.

**Every beacon changes from `#ff6b5a` to `--lamp`.** A beacon is a light, and
painting it in a fifth undocumented red — right next to the mark that means *you
are needed* — was a leak nobody had written down. A bulb is allowed to be the
light colour. That is the rule, not an exception to it.

**The empty lot** is a dashed `--line-strong` outline on the ground, with the
plus in `--ink-3`. The dash *is* the meaning: nothing here yet. Hover goes to
`--ink`, never to the lamp, which is what it did before, in a file the test never
read.

### Determinism, and what the drawing costs

Every new number comes from the seeded `Chooser` with a named sub-seed, exactly
as ornament placement already does. No `Math.random`, no DOM, no measurement.
Decision 0013's promise holds: a building you have not touched in a month is the
one you recognise.

Node count is the real cost, and it was close. Four shapes per window against one
before is not a rounding error at thirty buildings. It is paid for by merging
each storey-row's sockets and lips into one path with sub-paths, and by emitting
`.rs-body` only where the bay is at least 7 units wide. That lands at roughly two
nodes per window plus two per row — comfortably under what pilasters and sills
already emit, which is the bar that mattered.

---

## Voice

Warm, plain, specific, occasionally dry. Never cute, never exclamatory, never
apologetic. Say the true thing in the fewest ordinary words.

**Every empty state names the one next action.** An empty state that describes
its own emptiness is the product shrugging at somebody who came to it for help,
and it is where this app lost most of the people it lost.

| Before | Now |
|---|---|
| `0 floors` | `nobody in yet` |
| `on a break` | `waiting for work`, or `nothing assigned` |
| Four zeros on a new skyline | `One building, nobody in it yet. Take somebody on and it grows a storey.` |
| `an empty lot` | `Room for another` |
| `Nothing waiting on you.` | `Nothing needs you. Go and do something else.` |
| `Working…` | `Ada's on it` — name the floor |
| `Nothing on.` | `Quiet. Put a goal to it and somebody will pick it up.` |
| raw `awaiting-review` | `waiting to be read` |

`on a break` is the one worth dwelling on. It was charming exactly once and wrong
immediately afterwards: with three tasks queued and every floor idle, the
building said everybody was on a break. Nobody was on a break. The building was
not running. Charm that describes the wrong state is worse than no charm, because
it makes the app look as though it does not know what it is doing.

---

## What the test checks

`apps/daemon/src/design.test.ts`, rewritten rather than patched:

1. Every `var()` has a token behind it.
2. Every `font-size` is a `--t-*` token.
3. Every colour outside `:root` is a defined token, or white or black at alpha.
4. `--lamp` and `--flag` never fill a control — scanned across every rule whose
   selector names `button`, `.solid`, `.ghost`, `.chip`, `.tab` or an input,
   rather than across a list of selectors somebody approved once.
5. `.solid { background: var(--ink) }`, asserted on its own.
6. Every space value is on the scale; every radius is one of the three.
7. `--ink-4` never carries a sentence.

And in `packages/core/src/skyline/design.test.ts`:

8. The material bar — no palette colour falls inside either meaning band.

Checks 4, 5 and 8 are the ones that protect the city. The rest protect the
tidiness.

---

## Cost

**A palette this constrained means some things cannot have their own colour.** A
fifth state has to earn one of the six or make do with ink. That is the point,
and it is also a real limit: this system would not survive a screen that needed
to distinguish twelve categories at once, and if one appears the answer is to
change the screen rather than to add a colour.

**Naming colours by meaning rather than by hue means a redesign is a rename.**
Swapping marigold for something else is one token; deciding that light should be
green *everywhere, including in the drawn city*, is a day. Accepted deliberately:
the alternative is `--yellow-500`, which tells you nothing about whether you may
use it here.

**Two good colours are now unavailable to architecture.** The material bar
removes brass and postbox red from the palette pool permanently, and a city of
thirty buildings would have enjoyed both. Paid because a lit window that does not
carry across a street is not a signal.

**The misregistration will look like a bug to somebody.** A first-time viewer may
reasonably think the app is rendering badly, and there is no tooltip that
explains a print convention. The mitigation is the hover: the moment a building
snaps into register under the pointer, the offset is obviously intentional. That
mitigation only works for people who move the mouse, which is not everybody and
is nobody on a phone.

**Paper is worse in the dark.** Dusk was, for its faults, a comfortable thing to
look at at one in the morning, and warm oatmeal at full brightness is not. There
is no dark mode, and adding one is not cheap: it would need a second material
bar, a second set of socket depths, and a second answer to the question of what a
colour plate misregistered against nothing looks like.

**The drawing costs more nodes than it did.** Roughly double per window, bought
back by path merging. It is measured rather than assumed, and it is the number to
watch first if the home screen ever gets slow.
