# Run the account API locally with Docker

Brings up the NestJS account API and a PostgreSQL 16 database — the same
service that runs at `http://3.120.245.167/v1`, but against a local database so
you can develop auth changes without touching the shared server.

The Studio is not here: [`deploy/modal/`](../modal/) builds its own image and
needs a GPU. The landing page lives in a separate repo and deploys to Vercel.

## Start

```bash
cp .env.example .env
```

Fill in the three required values — `POSTGRES_PASSWORD`, `JWT_SECRET`,
`JWT_REFRESH_SECRET`. For the two secrets:

```bash
openssl rand -hex 32
```

Then, from the repo root:

```bash
docker compose up --build
```

First build takes a few minutes (bcrypt may compile from source). After that,
layers are cached and it starts in seconds.

| | |
|---|---|
| API | http://localhost:3000/v1 |
| Swagger | http://localhost:3000/docs |
| OpenAPI JSON | http://localhost:3000/docs-json |
| PostgreSQL | `localhost:5432` |

Migrations under `api/prisma/migrations` are applied automatically on every
start, by `docker-entrypoint.sh`.

## Create a SUPERADMIN

The admin-scoped endpoints (`/v1/users/all-users-data`, `/v1/wait-list`,
`/v1/admin`) need an account with the role. Seeding is a separate opt-in step
rather than part of startup, so no environment ever gets a predictable
superuser by accident:

```bash
docker compose exec api yarn prisma:seed
```

Set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in `.env` first — without
them `prisma/seed.ts` falls back to `admin@thlabs.dev` / `Admin123!`, which is
fine for a throwaway local database and nowhere else.

## Everyday commands

```bash
docker compose logs -f api
```
```bash
docker compose exec db psql -U thlabs -d thlabs
```
```bash
docker compose exec api npx prisma migrate status
```

Stop, keeping data:

```bash
docker compose down
```

Stop and **destroy the database volume** — every user, waitlist entry, and
admin goes with it:

```bash
docker compose down -v
```

## Pointing the landing page at it

In the `ProLend` repo, set `.env.local`:

```
BACKEND_API_URL=http://localhost:3000/v1
```

That is the only change needed. `lib/backend.ts` reads it and every route
handler goes through that one gateway.

## Notes on how it is built

- **Debian slim, not Alpine.** `bcrypt` is a native addon whose prebuilt
  binaries target glibc; on musl it falls back to compiling, and the toolchain
  is only present in the dependency stage.
- **OpenSSL in the runtime stage.** Prisma's query engine loads it at runtime
  even though nothing in `dist/` links against it — omit it and the image
  builds cleanly, then fails on the first query.
- **devDependencies are kept in the final image**, deliberately. The container
  runs `prisma migrate deploy` on startup and `prisma:seed` on demand, and both
  need the Prisma CLI. Dropping them would save perhaps 150 MB and cost the
  ability of the image to manage its own schema.
- **`node_modules` is copied from the build stage**, so it carries the
  generated Prisma client rather than regenerating it.
- **Both ports bind `127.0.0.1`**, not `0.0.0.0`. Nothing here should be
  reachable from the rest of the network.
- **Compose fails fast on missing secrets** (`${JWT_SECRET:?…}`). The app's own
  fallbacks are the string literals `dev-secret` and `dev-refresh-secret`; a
  container that silently inherited those would sign forgeable tokens.
- **`.gitattributes` pins `*.sh` to LF.** This repo is developed on Windows,
  and a CRLF shebang fails inside the container as `no such file or directory`
  on a file that is plainly there.

## Deploying this image

The production host currently runs the API behind nginx 1.24.0 on Ubuntu, over
plain HTTP. Two things to fix whenever that gets revisited, neither of which
this compose file addresses:

- **No TLS.** `https://3.120.245.167` does not answer. A bare IP cannot be
  issued a certificate, so this needs a hostname and a DNS A record before
  Let's Encrypt is even an option.
- **CORS reflects any origin** with `credentials: true` — `src/main.ts` sets
  `origin: true`. It should read an allowlist from the environment.
