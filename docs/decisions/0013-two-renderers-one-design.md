# 0013 — Two renderers, one design

**Decided.** A building's *form* stays a function of headcount alone, exactly as
decision 0009 has it. What that form is made of — its materials, window rhythm,
crown, and roof clutter — is derived from a seed made of the building's id, and
drawn twice: as box characters for the terminal, and as SVG for the browser and
the app.

The tier ladder gains a seventh form at the top, and `landmark` gets an upper
bound it did not have:

    1 floor    a shack             corrugated, patched, leaning
    2 floors   a single storey     pitched roof, a door, two windows
    3–4        a brick walk-up     flat cornice, rows of sash windows
    5–7        a cast-iron block   SoHo: arched bays, a fire escape, ornament
    8–11       a skyscraper        setbacks, a crown
    12–17      a landmark          the crown gains a spire
    18+        an arcology         sky bridges, a halo, and it stopped being a
                                   building a while ago

**Why a second renderer.** The rule this project actually holds is in
`CLAUDE.md`: *the desktop app has no interface of its own — do not build a second
copy of the dashboard.* That rule is about the **page**, not the **paint**. One
dashboard, served by the daemon, opened by the terminal's browser and carried by
the app, so the three cannot drift.

Eleven columns of box characters is the right drawing for a terminal and the
wrong one for the home screen of an app somebody is meant to want to open. The
answer is not to hold the browser down to the terminal's resolution; it is to
make sure both are drawing *the same building*. So `design.ts` decides what a
building is, and `render.ts` and `svg.ts` each say it in their own alphabet. A
building the SVG can draw and the CLI cannot is impossible, because neither of
them decides anything.

**Why derived and not stored.** A design is a pure function of `(id, form)`. It
is never written to a database, never chosen by a person, and never migrated.
Reopening the app cannot redecorate the street; a building you have not touched
in a month is the one you recognise. The cost of that is that the look is not
customisable, which is the intended trade: the skyline is a readout, and a
readout people can tune is a readout that stops being comparable.

Growing *within* a form leaves the look alone — the seed is `id:form`, so a
sixth hire adds a storey to the same building. Growing *into* a new form is
allowed to redraw it, because it has become a different kind of thing, and that
moment is the reward the whole ladder exists for.

**Why variety at all.** Six forms across a whole account means a skyline of
eleven projects is a skyline of eleven near-identical walk-ups, which tells you
less at a glance than the list of names it was supposed to beat. Variety is what
makes the home screen legible as *places* rather than as a bar chart: you learn
the green one with the fire escape is the client work, and after that you never
read a label again. Twelve buildings of the same headcount now produce at least
eight visibly different buildings, and that is asserted in the tests rather than
hoped for.

**Why an arcology.** The ladder previously topped out at twelve and stayed there
forever. A ceiling reached at twelve staff is a ceiling most buildings that
matter will sit against, and a progression whose last step is permanent is a
progression that stops rewarding. Eighteen is far enough away to be worth
reaching.

**Cost.** Real, and in three parts.

*Two renderers to keep alive.* A new form has to be drawn twice, and the
terminal version is the harder of the two because eleven columns is not much
room. This is the cost decision 0009 already accepted, now doubled. It is
bounded by the fact that neither renderer decides anything: adding a form is one
entry in `tiers.ts`, one block of box characters, and one crown in `svg.ts`.

*A large vocabulary.* Twenty-three palettes, twenty-four crowns, six bases and
twenty-three ornaments are a lot of drawing to maintain, and every one of them
has to read at small sizes against a dark sky. The mitigation is that they are
data, not code paths — a bad palette is deleted from a list.

*Thresholds are still arbitrary at the edges.* A seventeen-storey landmark and
an eighteen-storey arcology are a line drawn somewhere, and moving the line
changes what existing buildings look like. Accepted for the same reason 0009
accepted it, and the tests pin the thresholds so the change is at least
deliberate when it happens.
