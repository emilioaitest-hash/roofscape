# 0017 — The typefaces live in the repository

**Decided.** Instrument Sans, Fraunces and IBM Plex Mono are fetched once by
`scripts/vendor-fonts.mjs`, committed as latin-subset woff2 into
`apps/daemon/public/fonts/`, and served by the daemon from its own directory
forever after. Nothing in the product ever asks fonts.googleapis.com for
anything. The download page carries its own copies of the same three faces for
the same reason.

**Alternative.** A `<link>` to Google Fonts, which is what the first draft of
Overprint had, and which is what almost every web page does.

**Why.** Roofscape is a local app. It binds to loopback, it keeps its data in a
directory on your machine, and a good deal of the point of it is that it works on
a train. A design language that needs the network to look right is not a design
language, it is a hope.

The failure is also the quiet kind. A missing stylesheet is obvious; a missing
font is not. The app falls back to the system stack, everything still renders,
and the result is a page that is subtly wrong in a way nobody can name — line
lengths change, the display sizes lose the serif they were built around, small
caps stop being small caps. Somebody would report "it looks a bit off sometimes"
and there would be nothing to reproduce, because it depends on whether the
machine had a network when the window opened.

There is a second reason, smaller but not nothing: a font request is a request to
somebody else's server, made by an app that otherwise makes none. An application
that runs entirely on your machine should not phone anywhere merely to draw its
own interface.

**Why these three.** Instrument Sans for anything a person reads or clicks.
Fraunces for display — it carries `SOFT` and `WONK` axes, which is to say it is a
serif that can be asked to relax, and that is the whole reason it was chosen over
a stricter face. IBM Plex Mono for ids, model names, branches and commands:
things to copy rather than to read.

**Why a script rather than a note in the README.** `vendor-fonts.mjs` is run to
change or add a face and not otherwise, and it prints the `@font-face` block to
paste. It exists because the fetch has one non-obvious trick in it — Google
serves woff2 only to a user agent it believes can read woff2, and asking as Node
gets you TrueType at three times the size. That is exactly the kind of fact that
is discovered twice if it is not written down as code.

**Cost.**

*157 kB of binary in the repository, and in every build.* Fraunces is most of it,
because a variable face carrying four axes is a large file even subset to latin.
That weight is in the desktop app, in the daemon, and on the download page. It is
the price of the app looking the same offline as online, and it is paid once per
install rather than per page view.

*Three more entries in the asset allowlist.* The route that serves these files
answers **before** the token is checked, and `daemon.token` lives one directory
above the files it serves. So the allowlist is named one by one rather than
walked, and every new face is a deliberate line in `main.ts`. Three names is the
right cost for not having a path traversal in the part of the service that runs
unauthenticated.

*Latin only.* A full subset roughly triples the weight, so the app is English and
looks it. When that stops being true this decision has to be revisited properly,
with per-script subsets and `unicode-range`, rather than by making the files
bigger.

*Updates are manual and invisible.* A hosted font improves when the foundry
improves it. Ours does not, and nothing will tell us. That is the same trade this
repository has already made everywhere else — no dependency tree, nothing that
changes underneath us — and it is stated here so that "the fonts are old" is a
known state rather than a surprise.

*Two copies of the same files.* `website/` is deliberately outside the npm
workspaces and deploys separately, so it carries its own. They can drift. The
alternative was a build step that copies them across a boundary the repository
otherwise keeps closed, which is a worse trade for three files that change
approximately never.
