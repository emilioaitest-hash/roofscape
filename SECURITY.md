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

## Reporting

The project is private and pre-release. Report anything you find by opening an
issue, or directly to the repository owner if it should not be public.
