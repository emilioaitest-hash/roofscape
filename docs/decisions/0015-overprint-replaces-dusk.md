# 0015 — Overprint replaces Dusk

**Decided.** The visual language is replaced whole, not adjusted. Roofscape is
now a sheet of warm oatmeal paper with a two-colour print on it: an ink plate
carrying every line, a colour plate carrying every flat wash, and the colour
plate landing a millimetre or two off the ink. Dusk — the night city of real
materials, under a moon — is deleted rather than repainted. `docs/DESIGN.md` is
the new language in full.

**Alternative.** Keep Dusk and warm it: raise the ground a few steps, soften the
corners, round the type. This was the obvious move and it was tried on paper
first, which is how we found out it does not work. A cream-coloured version of
the same dark app has the same density, the same boxes and the same temperature;
it satisfies the letter of "make it a bit warmer" and none of the reason anybody
asked.

**Why.** Dusk was not badly executed. It was precise, consistent, tokenised and
tested, and it drew a genuinely good city. Its fault was that the precision
arrived without warmth, which reads as a machine being careful rather than as a
person being good at something — and Roofscape's whole argument is that a company
of agents is a *place*, with people in it, that you can look at.

The specific thing that made the change large rather than small is that Dusk's
atmosphere was structural. Moonlight, streetlamp pools, haze and window glow are
not decoration you can turn down; they are how that drawing produced light at
all. Take the night away and every one of them has to be replaced by something
with a different physics. That is decision 0016, and it is the reason this record
says *replace* and not *revise*.

**Why paper, specifically.** Because the product is a drawing, and a drawing has
somewhere it lives. Choosing a real printing process rather than a mood gave the
whole system a rule to answer to — *would a press do this?* — which settles
arguments that a mood cannot. It is also where the playfulness comes from without
anybody having to be whimsical: the misregistration between the two plates is a
mechanical accident, seeded per building on its id, and it is charming precisely
because nothing is trying to be.

**What survives, and why it was never in question.** Height is headcount. A
building's form is a pure function of that headcount. Its look is derived
deterministically from its id and never stored. Colour and motion mean things
rather than decorate. Decisions 0009 and 0013 are untouched; `design.ts` keeps
its exact maths and the terminal renderer keeps its alphabet. Overprint changes
what the city is drawn *with*, not what it says.

**Cost.** Larger than any visual change should be, and worth naming in parts.

*Everything drawn is redrawn.* Twenty-three palettes, twenty-four crowns,
twenty-three ornaments, eight window shapes and six bases all had to move from
gradient-and-glow to flat-fill-and-outline, and every `#ffffff` overlay in them
had to go, because white vanishes on this ground. That is the bulk of the work
and none of it is optional: one un-migrated ornament is a smudge on a page.

*Every screenshot and every piece of documentation is stale at once.* The website,
the README, the release notes and anything anybody has ever posted show a product
that no longer exists.

*There is no dark mode any more, and adding one is not a token swap.* Dusk was
comfortable at one in the morning; warm paper at full brightness is not. A dark
Overprint needs a second material bar, a second set of socket depths, and an
answer to what a misregistered colour plate looks like against a dark ground.
Accepted, and recorded so that the next person knows the answer is not
`prefers-color-scheme`.

*The two renderers now look less alike than they did.* The terminal draws in box
characters on whatever background the terminal has, and it cannot misregister a
plate or fill a socket. Decision 0013's promise was that both renderers draw the
*same building*, and that still holds — neither of them decides anything — but
the family resemblance between the two is weaker than it was.

*A print convention has to be learned.* Somebody will see the offset colour and
think the app is rendering badly. The hover, which snaps the plate into register,
is the only thing that explains it, and it only explains it to people using a
pointer.
