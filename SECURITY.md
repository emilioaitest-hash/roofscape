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

## Reporting

The project is private and pre-release. Report anything you find by opening an
issue, or directly to the repository owner if it should not be public.
