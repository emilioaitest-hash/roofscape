# Roofscape, as a service.
#
# Two stages so the image that runs does not carry the toolchain that built it.
# Debian rather than Alpine on purpose: agents run git, and node-gyp-free as this
# project is, musl still turns ordinary developer tooling into a support burden.

FROM node:24-slim AS build
WORKDIR /src

# Dependencies first, and only the manifests, so a change to source does not
# throw away the install layer.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/cli/package.json apps/cli/
COPY apps/daemon/package.json apps/daemon/
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build && npm prune --omit=dev


FROM node:24-slim AS runtime

# git because agents work in worktrees, ripgrep because `search` prefers it and
# is markedly slower falling back to grep. ca-certificates so the providers can
# be reached at all.
RUN apt-get update \
 && apt-get install --yes --no-install-recommends git ripgrep ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/package.json ./package.json
COPY --from=build /src/packages ./packages
COPY --from=build /src/apps ./apps

# Everything Roofscape knows lives here, and it is the only thing worth keeping.
# Mount a volume over it or a container restart is a lobotomy.
ENV ROOFSCAPE_HOME=/data
# Inside a container this is the whole network namespace, not the whole machine;
# what reaches the port is decided by what you publish. See docs/DEPLOYING.md.
ENV ROOFSCAPE_HOST=0.0.0.0
ENV ROOFSCAPE_PORT=7717
ENV NODE_ENV=production

# `node` exists in the base image already. Agents write files, so the data
# directory has to belong to them.
RUN mkdir -p /data /work && chown -R node:node /data /work
USER node

EXPOSE 7717
VOLUME ["/data", "/work"]

# Asks the service itself rather than the port: a process that is listening but
# cannot open its database is not healthy, and restarting it is the right answer.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.ROOFSCAPE_PORT||7717)+'/api/health').then(r=>process.exit(r.status===401?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/daemon/dist/main.js"]
