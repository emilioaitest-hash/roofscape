# 0008 — A building per project, not a floor per project

**Decided.** Every project is its own building. Every agent is a floor, so a
building grows taller as it is staffed. The account is a skyline of buildings.

**Superseded.** One building, with each project as a floor inside it.

**Why.** Two reasons, one of them structural.

The visible one: height now means something. A building's storey count is its
headcount, so a skyline is an honest picture of where effort actually sits —
including the side project that has quietly grown to eleven floors while you
weren't looking. Under the old scheme every project was one floor, so the picture
carried no information at all.

The structural one matters more. A building shares nothing with its neighbours,
which makes it the natural unit of backup, export, deletion, handing a project to
a collaborator, and eventually publishing a template someone else can break
ground from. Under the old scheme the account was the only real boundary, so
"give someone this project" had no clean meaning. Storage follows: one database
per building, and a building is a folder you can copy.

**Cost.** Anything genuinely shared between projects — your own profile, facts
true everywhere — needs a home above the buildings, which is why the skyline
scope exists in the memory design. That is one extra scope to reason about, and
it is worth it.
