# syntax=docker/dockerfile:1

# TH-LABS account API — NestJS 11 + Prisma 6 + PostgreSQL.
#
# Two properties of this dependency tree drive the shape of the file:
#
#   * bcrypt is a native addon. node-pre-gyp ships prebuilt binaries for glibc
#     but not consistently for musl, so this builds on Debian slim rather than
#     Alpine, and the dependency stage carries a toolchain for the cases where
#     it has to fall back to compiling from source.
#   * Prisma's query engine dlopens OpenSSL at runtime. Nothing in dist/ links
#     against it directly, so it is easy to leave out and only discover on the
#     first query.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*


# ── dependencies ────────────────────────────────────────────────────────────
FROM base AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile


# ── build: generate the Prisma client, then compile TypeScript ──────────────
FROM deps AS build
COPY prisma ./prisma
RUN yarn prisma generate
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN yarn build


# ── runtime ─────────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production

# node_modules is taken from `build` rather than `deps` so it carries the
# generated Prisma client. devDependencies ride along on purpose: this image is
# what runs `prisma migrate deploy` on startup and `yarn prisma:seed` on
# demand, and both need the Prisma CLI.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json yarn.lock ./
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# This repo is developed on Windows. A CRLF line ending on the shebang makes
# the kernel look for an interpreter named "/bin/sh\r", and the failure is
# reported as "no such file or directory" against a file that plainly exists.
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
 && chmod +x /usr/local/bin/docker-entrypoint.sh

USER node
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main"]
