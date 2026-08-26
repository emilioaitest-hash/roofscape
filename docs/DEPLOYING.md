# Running it somewhere that stays on

A laptop closes. If you want work finished overnight, the service has to live
somewhere else. This is that.

## What you get, and what you give up

You get standing orders that actually run at nine in the morning, goals that
finish while you sleep, and a dashboard you can open from your phone.

You give up Claude Code. The container has no `claude` binary and no way to log
one in, so the subscription route is not available to it and the floors there
need an API key. That is a real cost: metered billing where you had an
allowance you were already paying for. `ROOFSCAPE_CLAUDE_BIN=none` is set in the
compose file so nothing pretends otherwise.

A reasonable arrangement is both: the local service on your machine for work you
are watching, on your subscription, and a deployed one for standing orders.
They are separate data directories and separate buildings.

## Putting it up

    cp .env.example .env        # and put a key in it
    mkdir -p work               # clone the repositories to be worked on here
    docker compose up -d

The compose file publishes to `127.0.0.1:7717` **on the host**, not to the
world. That is deliberate and you should not change it. Reach it over SSH:

    ssh -N -L 7717:127.0.0.1:7717 you@your-server

Then open `http://127.0.0.1:7717` on your own machine. The token is in the
container:

    docker compose exec roofscape cat /data/daemon.token

## Why not just publish the port

Because the service starts agents, and agents run shell commands. A published
port is a remote shell with a nice API in front of it, and the only thing
between it and the internet is one bearer token in a URL. A tunnel costs you one
command and removes the entire question.

If you must expose it, put a reverse proxy with TLS and its own authentication
in front, and understand that you are trusting that proxy with a shell.

## Buildings and their workspaces

A building's workspace is a path, and inside the container that path is a
container path. Clone what you want worked on into `./work` on the host, and
break ground with `/work/<name>` as the workspace:

    curl -H "Authorization: Bearer $TOKEN" -X POST \
      -d '{"name":"College App","workspace":"/work/college-app"}' \
      http://127.0.0.1:7717/api/buildings

Give the repository a remote the container can push to if you want branches to
leave the machine. Roofscape never pushes on its own — merging is yours — but a
branch that exists only inside a container is a branch you cannot read.

## What to back up

`/data`, the named volume, and nothing else. It holds every building's database:
their staff, their work, their archives and their spending. Everything else in
the image is rebuildable from the repository.

    docker compose exec roofscape tar -cf - /data | gzip > roofscape-$(date +%F).tar.gz

## What this is not

**It is not container-per-building.** Every building in a deployment shares one
container, so an agent on one floor is confined to its own workspace by path and
by the shell allowlist — the same protection you have locally — and not by a
kernel boundary. That is proportionate for your own projects. It is not
sufficient for running work on behalf of somebody else, and Roofscape should not
be offered as a service to other people until it is. See `SECURITY.md` and
`docs/decisions/0006`.

**Nothing here has been run.** The image is written against a build that was
verified step by step outside a container — a clean clone installs from the
lockfile, builds, passes its tests, prunes its development dependencies and
still starts, and the healthcheck answers correctly. Docker itself was not
available on the machine this was written on, so the first `docker compose up`
is the first time these instructions will have been executed. Read the output
rather than trusting this file.
