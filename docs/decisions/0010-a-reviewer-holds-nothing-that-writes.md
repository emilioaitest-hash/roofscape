# 0010 — A reviewer holds nothing that writes

**Decided.** A floor whose product is judgement — the reviewer, and any future
role like it — is given no tool that can change a file. Not `write_file`, not
`edit_file`, and **not `shell`**, because a shell can write a file.

**Alternative.** Give every floor the whole tool row and rely on its charter to
say what it should and should not do.

**Why.** A reviewer that can fix what it finds will fix it, and then it is not
reviewing, it is writing — and the work has no reader left. The separation only
holds if it is enforced by what the floor is handed rather than by what its
prompt asks of it. Prompts are advice; a missing tool is a fact.

The shell clause is the one that matters, and it is the one that is usually got
wrong. A tool row that withholds `write_file` while granting `shell` has
withheld nothing at all: `sh -c 'echo x > file'` is a write. One large public
collection of agent definitions prescribes read-only reviewers in its own
contributor guide and ships most of them holding a shell anyway.

**Cost.** A reviewer that spots a one-character typo cannot correct it; it has to
describe it and hand it back, which is slower and occasionally maddening. That is
the price of the work having been read by something that could not have written
it, and it is worth paying.
