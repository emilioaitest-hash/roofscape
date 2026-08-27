# Carrying the post to Discord

A building's mailroom can be mirrored to one Discord channel. What the building
says comes out; what you type there goes in, as a message from you to the
manager. It is how you find out something is stuck while you are not at the
machine, and how you answer without opening a port.

Why this rather than a phone app, and what it deliberately cannot do, is in
`docs/decisions/0014`.

## Making the bot

1. Go to <https://discord.com/developers/applications> and hit **New
   Application**. The name is what people will see in the channel.
2. **Bot** in the sidebar → **Reset Token** → copy it. This is the only time
   Discord shows it to you.
3. On the same page, scroll to **Privileged Gateway Intents** and switch on
   **MESSAGE CONTENT INTENT**.

   **This is the step everybody misses.** Without it the bot connects, reports
   itself live, and never hears a word — Discord delivers the messages with the
   content field blank. Nothing in Roofscape can tell the difference between
   that and a quiet channel, so there is no error message to go looking for.

4. **OAuth2 → URL Generator**: tick `bot`, then under permissions tick **View
   Channels**, **Send Messages** and **Read Message History**. Open the URL it
   builds and add the bot to your server.

## Wiring it up

In the app: open a building, go to **Mailroom**, and press **Connect Discord**.
Paste the token, pick the server and the channel, save.

The token can be kept out of the database by typing `env:SOME_VARIABLE` instead
of pasting it — the same convention a provider credential uses. The daemon reads
the variable at startup, so it has to be set in the daemon's own environment.

> On macOS an app launched from Finder gets launchd's environment, not your
> shell's. `export` in a terminal does nothing to the installed app. See the note
> in `CLAUDE.md`.

## Using it

Anything the building says to you appears in the channel. Anything you type
appears in the manager's inbox and is read the next time it is set to work.

To set it going, start a line with `!goal`:

    !goal work out why the Tuesday digest went to nobody

The bot answers with what it did — that it started, or why it could not.
Ordinary lines never start work, on purpose: somebody chatting in a channel
should not be able to spend money by accident.

**Mirror the whole mailroom** is a setting, and it is off. On, you also see the
building talking to itself — every assignment, every question between floors.
That is interesting once and noisy afterwards.

## When it does not work

**"Discord refused that bot token."** The token is wrong, or it was reset after
you copied it. The bridge stops rather than retrying, because no amount of
waiting fixes a bad token.

**Connected, but nothing arrives.** The MESSAGE CONTENT intent, nine times out of
ten. Otherwise the bot cannot see the channel — check it has View Channels
permission there, not just in the server.

**Nothing goes out.** The bot needs Send Messages *in that channel*. A
channel-level permission override beats the server-level one.

**It says "retrying".** Ordinary. The connection drops when the machine sleeps
and comes back on its own, with a backoff up to a minute. Nothing is lost while
it is away: the mirror sends everything written since the last thing it sent.

## What it is not

It is not a second inbox to keep in step, and it is not a chat interface to the
agents. It is a window onto the mailroom, which is the real thing — the records
in the building's own database. Delete the channel and nothing is lost.
