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

> **Caddy here is not a system service.** It is `solpro-caddy-1`, a
> `caddy:2-alpine` container from the stack in `/opt/solpro`, and it is the
> only thing on the box bound to :80 and :443. There is no
> `/etc/caddy/Caddyfile` on the host — the config lives at
> **`/opt/solpro/Caddyfile`**, bind-mounted read-only into the container.
>
> That same file serves **solpra.uz**, which is live. Append to it; never
> replace it. And do not install nginx — Caddy already owns those ports, and a
> second web server contending for them is the likeliest way to break solpra.

Back up, then append [`aytingchi.caddy`](./aytingchi.caddy):

```bash
cp /opt/solpro/Caddyfile /opt/solpro/Caddyfile.bak.$(date +%F)
```

Validate, and confirm solpra survived, **before** reloading:

```bash
docker exec solpro-caddy-1 caddy validate --config /etc/caddy/Caddyfile && grep -c solpra.uz /opt/solpro/Caddyfile
```

Then reload in place:

```bash
docker exec solpro-caddy-1 caddy reload --config /etc/caddy/Caddyfile
```

`caddy reload` swaps the config inside the running container, so solpra.uz
never drops a connection. `docker compose restart caddy` would briefly
interrupt it, and `docker compose down` in `/opt/solpro` would take it offline
outright — neither is needed for a config change.

Watch the certificates arrive, then verify **every** host — solpra included, to
prove the shared config still serves it:

```bash
docker logs -f --tail 50 solpro-caddy-1
```

```bash
for h in solpra.uz aytingchi.uz th-labs.uz; do printf '%s ' "$h"; curl -sI "https://$h" | head -1; done
```

`aytingchi.uz` and `th-labs.uz` are one site block serving identical content, so
they should return the same status. Each gets its own certificate, which Caddy
requests on first reload — expect a few seconds before the second one answers.

Roll back at any point with:

```bash
cp /opt/solpro/Caddyfile.bak.$(date +%F) /opt/solpro/Caddyfile && docker exec solpro-caddy-1 caddy reload --config /etc/caddy/Caddyfile
```

### Joining the network

This stack attaches to `solpro_default` as an external network and publishes no
host ports, so Caddy reaches it by the `thlabs-api` / `thlabs-web` aliases the
way it already reaches `solpra:4000`. It is a separate compose project, so
stopping one stack never affects the other.

If `docker compose up` fails with *network solpro_default not found*, the
solpro stack is down — start it first.

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

## 6. Stripe

Payments run **here**, on this API — not on Modal. The Studio has no Stripe code
at all; it calls `/v1/payments/*` and follows the URL it is given.

The API boots and serves `/payments/plans` whether or not Stripe is configured,
so a broken setup is quiet. It shows up only when someone tries to pay.

**1. Payment Links** — Dashboard → Payment Links, one per paid plan (PRO and
STUDIO × weekly/monthly/yearly). Leave client-reference-ID passthrough enabled:
the API appends `?client_reference_id=<userId>` to the link, and the webhook
reads that field to decide whose credits to grant. A payment arriving without it
is logged and ignored. Put the six URLs in `.env` as `STRIPE_LINK_*`.

**2. Webhook endpoint** — Dashboard → Developers → Webhooks → Add endpoint:

```
https://th-labs.uz/v1/payments/webhook
```

Subscribe to exactly the events the handler dispatches:
`checkout.session.completed`, `invoice.paid`, `invoice.payment_succeeded`,
`invoice.payment_failed`, `customer.subscription.updated`,
`customer.subscription.deleted`. Copy the `whsec_...` signing secret into
`STRIPE_WEBHOOK_SECRET`.

**3. Secret key** — `STRIPE_SECRET_KEY` in `.env`. The publishable key is not
used anywhere: checkout is a redirect to a Payment Link, so Stripe.js never
loads and no key ships to the browser.

**4. Apply.** The links are read at seed time, not on boot, so re-seed:

```bash
cd /srv/th-labs && docker compose up -d api && docker compose exec api yarn prisma:seed
```

**Verify** — the warning is the tell. If Stripe is wired up, this prints nothing:

```bash
docker compose logs api | grep -i "STRIPE_SECRET_KEY not set\|not configured"
```

Then confirm the links actually landed on the plan rows:

```bash
docker compose exec -T db psql -U thlabs -d thlabs -tAc 'select tier, cycle, ("stripeLinkUrl" is not null) as has_link from "Plan" order by tier, cycle;'
```

Finally send a test event from the Dashboard and watch for a 200. A 503 means
`STRIPE_WEBHOOK_SECRET` never reached the container; a 400 means it reached it
but does not match the endpoint you created.

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
