# 0014 — The owner is in the post, and the post has a door onto Discord

**Decided.** Three things, which are one thing.

1. The owner is a correspondent on the message bus, represented by `null` at
   either end of a message. They are not given a floor.
2. The inbox is actually delivered. A floor is told it has post and fetches it
   with `check_mail`; it answers with `reply`. Both are bounded.
3. A building's mailroom can be mirrored to one Discord channel, and messages
   typed there become ordinary records in that mailroom.

**What was there before.** The bus was written and never read. `post()` wrote
rows, `inbox()` had no caller outside a test, and `ask_colleague` returned the
sentence *"They will answer in their own time; do not wait on it"* — describing
behaviour that could not happen, because nothing ever handed an agent its post.
Two of the seven message kinds had a producer and none had a consumer.
Coordination really ran through the tasks table.

So this is not a new feature. It is decision 0002 finished: *"each agent has an
inbox"* was the promise, and the inbox was a write-only table.

**Why null for the owner.** The column referenced `floors(id)` and was not null,
so the person who owns the building could not be at either end of a message. The
tempting fix is a reserved floor row for them. It is wrong: a floor is a hire, it
counts toward the headcount, and it changes the drawn shape of the building — the
owner would have added a storey by being written to, and `staff()` would have
listed them. Null says the true thing instead. They are the correspondent who
does not work here.

The cost is a rebuilt table (SQLite cannot drop a NOT NULL) and a nullable
reference that every read has to think about. Accepted: the alternative is a
lie in the headcount, which is the one number the whole skyline is built on.

**Why this is not agent chat.** Decision 0002 refused free-form conversation
between agents and that refusal stands. What is added here keeps every one of
its properties:

- Every message is still typed, still durable, still addressed.
- Post is **pulled, never pushed**. A turn is told *how many* messages are
  waiting — one line, and only when there are some — and spends a tool call if
  it wants them. Nothing is injected into a prompt.
- `check_mail` takes a limit and defaults to ten. An inbox is unbounded and a
  turn's context is not; a floor back from a week away must not spend its budget
  reading its own post.
- `reply` caps a message at 2000 characters and says in its own description that
  this is post rather than conversation.

0002's stated cost was *"anything the agents need to say to each other must have
a message type."* That is still what this is. `note` was added because a message
that is neither a question nor a report is a real thing people send, and forcing
it to be a `status` would have made the type meaningless.

**Why Discord.** The daemon binds to loopback and should stay there — it runs
shell commands, and one on `0.0.0.0` is a remote shell with a nice API. But the
thing people actually want is to be told their building is stuck while they are
somewhere else, and to answer. A bot connection is outbound, so it needs no port
open, no tunnel, and no certificate. The phone client the roadmap wants is a real
piece of work; this is most of the value of it for a few hundred lines.

**Why no Discord library.** The whole protocol used here is one REST call and
four gateway opcodes: hello, heartbeat, identify, dispatch. Node 24 has `fetch`
and `WebSocket` as globals. A library for that would be a dependency tree in a
repo that has kept none, and the popular ones carry optional native accelerators
— which would break the one property that makes the desktop app a single bundled
file.

**What Discord cannot do.** Nothing that arrives from a channel is an
instruction. It becomes a message in the building's own post, labelled as
relayed and with the name of whoever typed it, and the manager reads it the next
time it is set to work — the same path as typing into the mailroom. The single
exception is a line beginning `!goal`, which starts a goal and says so.

`!goal` is gated on a named list of Discord user ids, and the list is empty until
somebody fills it in. Explicitness was the first draft of this and it was not
enough: it defends against spending money by *accident*, and a channel is a room
other people can be in. Starting a goal reaches `pursueGoal`, and a coder holds
`shell`, `write_file` and `edit_file` in the owner's workspace — so the real
question is not whether the request was deliberate but whose it was. Presence in
a channel is not authority. Refusing tells you your own id, so allowing yourself
is one paste.

Mirroring outward is off for internal post by default. Most of what a building
says to itself is machinery, and a phone that buzzes for every `task` message is
a phone somebody turns the app off on.

**Cost.**

*A nullable correspondent.* Every read of a message has to decide what null
means, and getting it wrong shows up as a floor called "undefined" rather than as
a crash. Mitigated by `Correspondent`, `OWNER` and `isOwner` being the only way
it is written, and by tests that assert null survives the round trip.

*A polled mirror.* Outward mirroring polls every four seconds rather than hooking
`post()`, because a message is written by whichever process happens to be running
an agent and there is no callback to hang it on without threading one through the
whole runtime. A cursor on the rowid walks the post in the order it was written,
a bounded batch per tick, so nothing is skipped and a backlog is carried out over
several ticks. The first draft used a timestamp and a limit, which did both
things wrong: it took the *newest* rows in the window and skipped the rest for
good, and `now()` is millisecond-resolution, so a reply could overtake the
question it answered. It is still a poll.

*A privileged intent.* Reading channel messages needs MESSAGE CONTENT, which
Discord gates behind a switch in the developer portal. Somebody setting this up
will get a bot that connects and never hears anything until they find it, and no
error tells them why. Written down in `docs/DISCORD.md` because nothing in the
product can detect it.

*A secret in the settings table.* A bot token is stored like a provider
credential — either the value, or the name of an environment variable to read it
from. The env form exists for people who will not keep a token in a file. Neither
form is ever sent back to a screen; the API returns only the last four
characters.
