# Ship the account API to the server via GHCR

GitHub Actions builds `api/` into a container image, publishes it to GitHub
Container Registry, and the server pulls it. The server never builds anything
and needs no checkout of this repo — only `docker-compose.yml`, `.env`, and
credentials to pull.

```
push to main (api/**)
  → .github/workflows/api-image.yml
  → ghcr.io/asilbekali/th-labs-full/api:latest   (+ :sha-<commit>)
  → ssh into the server, docker compose pull && up -d
  → Caddy terminates TLS, proxies to 127.0.0.1:3000
```

---

## 1. Server, once

Docker Engine plus the compose plugin:

```bash
curl -fsSL https://get.docker.com | sudo sh
```

Create the deploy directory and copy two files into it — this compose file as
`/srv/th-labs/docker-compose.yml`, and `.env.example` as `/srv/th-labs/.env`:

```bash
sudo mkdir -p /srv/th-labs && sudo chown "$USER:$USER" /srv/th-labs
```

Fill in `.env` (`POSTGRES_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET` are all
required — `openssl rand -hex 32` for the secrets), then lock it down:

```bash
chmod 600 /srv/th-labs/.env
```

## 2. Let the server pull from GHCR

A package inherits the visibility of its repository, and this repository is
private — so the image is private too and the server has to authenticate.

Create a classic PAT with `read:packages` and nothing else, then on the server:

```bash
echo "<PAT>" | docker login ghcr.io -u asilbekali --password-stdin
```

That writes `~/.docker/config.json` and persists across reboots. This token only
ever needs to read, so grant it nothing further.

**Do not "fix" a pull failure by making the package public.** It is the quickest
path and it publishes a built image of a private repository — source included,
since the image carries `dist/` and `node_modules/`. Authenticate instead.

## 3. GitHub secrets

Repository → Settings → Secrets and variables → Actions. The build needs
nothing (it uses the automatic `GITHUB_TOKEN`); these four are for the deploy
step:

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | `aytingchi.uz` |
| `DEPLOY_USER` | the SSH user on the box |
| `DEPLOY_SSH_KEY` | private half of a **deploy-only** keypair |
| `DEPLOY_KNOWN_HOSTS` | output of `ssh-keyscan aytingchi.uz` |

Generate a dedicated keypair rather than reusing your own — this one lives in
GitHub and should be revocable without touching your personal access:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/th-labs-deploy -C "github-actions-deploy" -N ""
```

Append the **public** half to `~/.ssh/authorized_keys` on the server; paste the
**private** half into `DEPLOY_SSH_KEY`.

`DEPLOY_KNOWN_HOSTS` is pinned from a secret rather than scanned at run time on
purpose — `ssh-keyscan` inside the job would trust whatever answers that day,
which is no verification at all.

## 4. Caddy

Copy [`Caddyfile`](./Caddyfile) to `/etc/caddy/Caddyfile`, then:

```bash
sudo systemctl reload caddy && sudo journalctl -u caddy -f --no-pager
```

Watch for the certificate to be obtained. If it does not appear, the cause is
almost always a leftover `redir` catch-all on `:80` shadowing
`/.well-known/acme-challenge/` — see the comment at the top of the Caddyfile.

## 5. First deploy

```bash
cd /srv/th-labs && docker compose up -d
```

Migrations under `api/prisma/migrations` are applied by the container's own
entrypoint on every start, so there is no separate migrate step.

Verify from anywhere:

```bash
curl https://aytingchi.uz/v1/users/all-users
```

Create the SUPERADMIN once. Pass the credentials on the command — **not** in
`.env`, where they would be silently ignored and `prisma/seed.ts` would fall
back to `admin@thlabs.dev` / `Admin123!`, which must never be what ships here:

```bash
docker compose exec -e SEED_ADMIN_EMAIL=you@example.com -e SEED_ADMIN_PASSWORD='<strong password>' api yarn prisma:seed
```

Confirm it landed as intended before moving on — the fallback is silent:

```bash
docker compose exec -T db psql -U thlabs -d thlabs -tAc 'select email, role from "User";'
```

After this, every push to `main` touching `api/**` deploys on its own.

---

## Rolling back

Every build is also tagged with its commit sha, so the previous image is still
in the registry:

```bash
API_IMAGE=ghcr.io/asilbekali/th-labs-full/api:sha-<commit> docker compose up -d api
```

Make it stick by setting `API_IMAGE` in `.env`. Remove the line to resume
tracking `latest`.

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

## Backups

The database lives in the `th-labs_db-data` volume. Nothing backs it up yet —
`docker compose down -v` erases every user, waitlist entry, and admin with no
recovery path. A starting point:

```bash
docker compose exec -T db pg_dump -U thlabs thlabs | gzip > "backup-$(date +%F).sql.gz"
```

Worth putting on a cron job with off-box copies before this holds anything you
would miss.

## Notes

- **`linux/amd64` only.** If the host turns out to be arm64, add it to
  `platforms:` in the workflow — but expect a slow build, since bcrypt compiles
  under QEMU emulation.
- **Postgres publishes no ports.** It is reachable over the compose network by
  the API and nothing else. Use `docker compose exec` for a shell.
- **The API binds `127.0.0.1:3000`**, so it is reachable only through Caddy and
  never unencrypted from outside.
- **Container logs are capped** at 3 × 10 MB. Docker's default is unbounded,
  which fills a small VPS disk eventually.
- **Secrets are not in the image.** They come from `/srv/th-labs/.env` at run
  time, so rotating one is an edit and a restart, not a rebuild.
