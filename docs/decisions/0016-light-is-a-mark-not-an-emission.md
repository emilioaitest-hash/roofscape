# 0016 — Light is a mark, not an emission

**Decided.** Nothing in Roofscape glows. A lit window is not a bright thing on a
dark thing; it is **a hole that has been filled**. Each window is a socket cut
into the wall, a lip of shadow under its top edge, and a counter inside it that
is either the colour of the socket — invisible — or marigold. A floor with
somebody actually working on it gets a small dark figure at the counter as well.

The same physics decides the other signal. Something waiting on your say-so is
not a badge stuck to the building; it is **a pin pushed into the roof** — a base
plate, a post, and a ball on top, rocking slightly because it was just put there.

**Why.** On paper you cannot emit light. You can only mark where it fell.

That is not a metaphor, it is the constraint that falls out of decision 0015 the
moment the ground stops being dark, and it removes the entire mechanism Dusk used
for its most important signal. On an indigo sky, *lit* could mean "lighter than
the wall", and radial gradients did the rest. On warm oatmeal there is nothing
above the paper to be lighter than. A glow on this ground is a pale smear.

So light had to be told a different way, and the honest way a printed drawing
tells it is by *figure*: the shape is different, not the brightness. A recess
that is empty and a recess that is filled are two different pictures at any size,
in any lighting, in a screenshot, and to somebody who cannot distinguish the two
colours at all.

**What it bought that Dusk could not do.** Dusk drew "this window is lit" and
"somebody is working at this window" as the same picture, because both were the
same glow. The one rule the design rests on says a lit window means *work in
hand* — and the drawing could not tell a light left on from work being done,
which is the most important distinction the city claims to make. It can now, and
it costs one circle.

**Why the pin, and not a better badge.** The old mark was a terracotta disc with
a white exclamation mark in it. That is a notification badge, which is a thing
software puts on other software; it sat on the roof of a hand-drawn building
looking like it had been pasted there from a different product.

More usefully, the pin separates the two signals by *anatomy*. Light lives
**inside an opening**. You live **on top of the building**. Nothing else in the
city is a vertical post with a ball on it, so the two meanings can never be
confused at thumbnail size, on a bad monitor, or by somebody colour-blind — none
of which was true when they were both small warm-coloured blobs.

**Why it is drawn and not animated.** The mark rocks and a building settles on a
spring when it grows, and those are the only two exceptions to "everything
rises". Both are physical: a thing just pushed in has not stopped moving, and a
storey added has weight. Neither is a loop. A permanent pulse on the home screen
is a thing people close.

**Cost.**

*Four shapes per window instead of one.* This was the number that nearly stopped
it. A thirty-building skyline with nine storeys each is a lot of SVG, and node
count is the honest measure of whether the home screen stays fast. It is paid
back by merging each storey-row's sockets and lips into a single path with
sub-paths, and by emitting the figure only where the bay is at least seven units
wide — which lands it at roughly two nodes per window plus two per row, under
what pilasters and sills already cost. Measured, not assumed. It is the first
number to look at if the city ever feels slow.

*Every palette needs a sixth colour.* `socket` is a dark, warm, low-saturation
version of the wall, 45–55 L\* below it, and it has to be chosen per palette
rather than derived by a formula, because a formula produced near-black holes on
the dark palettes and grey ones on the pale. Twenty-three hand-picked values is
twenty-three chances to get one wrong.

*A recess is subtler than a glow.* Dusk's lit windows shouted. A filled counter
in a hole is quieter, and at small sizes the lip is doing a lot of the work of
making the hole read as a hole — so it is skipped below six units, where the
window is simply a filled rectangle and slightly less legible than it should be.
Accepted: the alternative, at that size, is mud.

*The terminal cannot follow.* Box characters have colour and nothing else, so the
terminal still lights a window by recolouring the same glyph. The two renderers
now say the same thing in genuinely different ways, rather than in the same way
at two resolutions.
