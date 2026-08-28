# 0018 — The city is New York

**Decided.** The ladder is made of named New York building types, and says so:

    1 floor    a newsstand         plywood, a roll-down shutter, a bare bulb
    2          a bodega            a striped awning, a neon sign, crates outside
    3–4        a brownstone        a high stoop with iron railings, a cornice
    5–7        a cast-iron loft    SoHo: arched bays, columns, a front fire escape
    8–11       a setback tower     the 1916 zoning envelope, a water tower
    12–17      a landmark          Art Deco: a crown, a lantern, a spire
    18+        a supertall         slender, dark glass, the crane still on it

The materials are New York's stock — brownstone, tenement brick, buff brick,
limestone, glazed terracotta, granite, painted cast iron in cream and bottle
green and slate and oxblood, then pale glass, white concrete, bronze and black
steel — and the ladder is **geological**: masonry low down, metal and glass at
the top. A brownstone is never black steel; a supertall is never red brick.

This supersedes the ladder tables in decisions 0009 and 0013. Those records stand
as written: they say what was decided then, and why, and rewriting them would
destroy the only account of it.

**Alternative.** Keep the generic ladder — shack, single-storey, brick walk-up,
cast-iron block, skyscraper, landmark, arcology. It was already half New York
without admitting it: "brick walk-up" and "cast-iron block" are New York words
wearing a disguise, and the disguise bought nothing.

**Why.** Because a caricature is funny when it is *specific*, not when it is
silly, and a generic city cannot be either. Everyone knows a brownstone stoop, a
rooftop water tower, a fire escape down a SoHo facade, a setback Art Deco crown.
Naming them means the drawing can lean on recognition the way a good illustration
does, and it gives every ornament a reason to exist rather than a slot to fill.
The sidewalk shed — the green plywood-and-pipe tunnel outside every building in
the city — is the clearest case: it costs three rectangles, and it is funny only
because it is true.

**What it cost.**

*A rename that reaches everywhere.* The form is a string that travels: it is in
the store, the API, both renderers, the terminal's box art, the tier blurbs, the
lobby's reply, the README, the website, and the seed of every building's own
design. A half-renamed ladder is worse than none, and one assertion in
`lobby/lobby.test.ts` was still expecting `single-storey` after everything else
had moved, which is exactly the sort of thing that survives a rename and then
fails at the wrong moment.

*Every building was redrawn.* The seed hashes the form, so `b2cir:shack` and
`b9kc:single-storey` are not addresses in this city any more. Nobody's skyline
looks the way it did yesterday. That is a real cost and it is paid once; the
guarantee that matters — that a building looks the same *tomorrow* as today — is
untouched.

*Arcology is gone, and it was the only rung that was not a place.* It topped the
ladder with sky bridges and a halo, and it stopped being a building somewhere
around the second setback. A supertall is the same idea — the absurd top of the
ladder — and you can point at it from the park.

*The vocabulary is now regional.* A drawing that leans on recognising New York is
a drawing that lands less well for somebody who has never been. That is accepted:
the alternative was a city nobody recognises at all, which lands less well for
everybody.
