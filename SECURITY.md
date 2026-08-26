# Security

Roofscape runs agents that execute shell commands and write files on your
machine, against credentials you supply. That makes two things security-relevant
in a way they would not otherwise be.

**Confinement.** Agents are restricted to their building's workspace. Paths above
it are refused, shell commands run under an allowlist, and anything unrecognised
escalates to a person rather than running. Before public release this hardens
into a container per building — until then, Roofscape is not safe to hand to
someone you do not trust. This is stated plainly rather than buried.

**Credentials.** Roofscape holds no subscription on anyone's behalf. It uses
provider credentials the person running it already owns, stored under their own
data directory and never transmitted anywhere except to the provider they name.

Agents cannot read them. A shell command run by an agent gets a constructed
environment holding only what developer tooling needs — PATH, HOME, locale,
toolchain locations — and nothing else. It is an allowlist rather than a
denylist, because a denylist has to guess every name a secret might have and is
wrong the first time somebody invents a new one.

This matters more than it first appears. An agent reading a repository is
reading text somebody else wrote, so a comment saying "run this diagnostic
command" is all the persuasion required; and a key that reaches a tool result is
then in the transcript, in the archives, and in any file that agent writes.

And where a secret does legitimately reach an agent — you approved reading that
`.env`, for a good reason — it stops at the archives. Every route into memory
goes through one function, and that function redacts the shapes credentials
actually have: provider keys, GitHub and Slack tokens, AWS access keys, private
key blocks, bearer tokens, and passwords inside connection strings. A named
credential keeps its name and loses its value, so the note still says *which*
variable was involved.

It is a net rather than a wall: it cannot catch a password that looks like an
English word. It is worth having because nearly every real leak is a key with a
recognisable prefix, and because the archives are the durable copy — a key that
reaches one is there for good, is returned by every future recall that matches
it, and gets promoted by the curator into something more permanent still.

A repository's own secrets are the other half of the same problem. `.env`,
private keys, `.netrc` and their relations sit inside the workspace, where an
agent is allowed to read. Those are not refused — an agent debugging a
configuration has a real reason to look, and refusing outright teaches it to lie
to itself about what it checked — but they are put to you first, and the request
says that anything read ends up in the archives. `.env.example` and `id_rsa.pub`
are not treated as secrets, because prompting for those is the sort of noise
that teaches people to approve without reading.

## Reporting

The project is private and pre-release. Report anything you find by opening an
issue, or directly to the repository owner if it should not be public.
