# Contributing

## The shape of a change

Read `docs/ARCHITECTURE.md` first — it says what each piece is for, which is
usually enough to know where a change belongs.

Anything with a real alternative gets a decision record in `docs/decisions/`,
numbered in sequence. The format is short on purpose: what was decided, what the
alternative was, why, and **what it costs**. The cost line is not optional and
"nothing" is rarely true. A record that only lists benefits is not a decision,
it is an advertisement, and it will not help whoever revisits this in a year.

## Running it

    npm install
    npm run typecheck
    npm test

Node 24 or later. Storage uses `node:sqlite`, built into Node, so there is no
native module to compile.

## Conventions

Commit messages say what changed and why in plain sentences. Subject lines are
not prefixed with types or scopes; they describe the change.

Tests cover behaviour that was changed on purpose. Tests that only restate the
implementation are worse than none, because they make the implementation harder
to change without telling you anything about whether it still works.
