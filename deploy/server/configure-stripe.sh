#!/usr/bin/env bash
# Wire Stripe into the deployed account API. Run ON THE SERVER:
#
#     cd /srv/th-labs && bash configure-stripe.sh
#
# Idempotent: every value is replaced in place if the key already exists, so
# re-running after a typo is safe and never leaves duplicate lines behind.
#
# The two secrets are read from the terminal, never from a command argument.
# An argument would land in the shell history and in `ps` output for every
# other user on the box; a here-doc in a chat log is worse. Everything else is
# public config and can be edited into this file directly.
#
# What this does NOT do: create the Payment Links or the webhook endpoint in
# the Stripe Dashboard. Those have to exist first — this only carries their
# values into the container. See README.md § 6.

set -euo pipefail

ENV_FILE=/srv/th-labs/.env
COMPOSE_DIR=/srv/th-labs

# ── The public half. Edit these before running. ─────────────────────────────
STUDIO_ORIGIN="https://isoqovjorabek2--th-labs-dubbing-web.modal.run"
APP_URL="https://th-labs.uz"
CORS_ORIGINS="https://th-labs.uz,https://www.th-labs.uz,https://aytingchi.uz,https://www.aytingchi.uz,${STUDIO_ORIGIN}"

# Payment Link URLs, created by deploy/stripe/bootstrap.sh against
# acct_1U0Ew9PGGmaP3PKr. These are TEST MODE links -- buy.stripe.com/test_...
# -- and take test cards only. Going live means re-running bootstrap.sh with
# the CLI in live mode and replacing all six; a test link in a live deploy
# takes payment from nobody and grants nothing.
# Leave a value empty to skip that plan; /payments/checkout 400s for it.
LINK_PRO_WEEKLY="https://buy.stripe.com/test_8x2bJ3fiy3Q2aqIdOc6AM00"
LINK_PRO_MONTHLY="https://buy.stripe.com/test_8x27sNc6m4U6buM11q6AM01"
LINK_PRO_YEARLY="https://buy.stripe.com/test_aFa6oJdaqeuG56o5hG6AM02"
LINK_STUDIO_WEEKLY="https://buy.stripe.com/test_14A7sN0nEcmyfL2eSg6AM03"
LINK_STUDIO_MONTHLY="https://buy.stripe.com/test_8x2dRb3zQ3Q2fL225u6AM04"
LINK_STUDIO_YEARLY="https://buy.stripe.com/test_14A5kF0nE5Ya0Q8h0o6AM05"

# ── Helpers ─────────────────────────────────────────────────────────────────
die() { echo "error: $*" >&2; exit 1; }

# Replace KEY=... in place, or append it. Matches only at line start so a key
# that appears inside a comment or a URL is never clobbered.
set_env() {
  local key=$1 value=$2
  [ -n "$value" ] || { echo "  skip  $key (empty)"; return; }
  if grep -qE "^${key}=" "$ENV_FILE"; then
    # `|` as the delimiter: every value here is a URL and contains slashes.
    # The value is written via a shell variable rather than interpolated into
    # the sed script, so a & or a \1 in a key cannot be re-expanded.
    VALUE="$value" perl -pi -e "s|^\Q${key}\E=.*|${key}=\$ENV{VALUE}|" "$ENV_FILE"
    echo "  set   $key (replaced)"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    echo "  set   $key (appended)"
  fi
}

# Read a secret without echoing it, and without it ever becoming an argument.
read_secret() {
  local prompt=$1 __var=$2 value=""
  printf '%s' "$prompt" >&2
  read -rs value
  printf '\n' >&2
  printf -v "$__var" '%s' "$value"
}

# ── Preflight ───────────────────────────────────────────────────────────────
[ -f "$ENV_FILE" ] || die "$ENV_FILE not found. Copy .env.example there first."
[ -f "$COMPOSE_DIR/docker-compose.yml" ] || die "no docker-compose.yml in $COMPOSE_DIR"

# The compose file must be the version that forwards STRIPE_* into the
# container. Without this check the script cheerfully writes a perfect .env
# that the API never sees, which is the exact failure it exists to fix.
grep -q 'STRIPE_SECRET_KEY' "$COMPOSE_DIR/docker-compose.yml" \
  || die "$COMPOSE_DIR/docker-compose.yml does not pass STRIPE_* through.
       Copy the updated deploy/server/docker-compose.yml from the repo first."

cp -a "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"
echo "backed up $ENV_FILE"

# ── Secrets ─────────────────────────────────────────────────────────────────
echo
echo "Paste the two Stripe secrets. Neither is echoed."
read_secret "  STRIPE_SECRET_KEY (sk_...):     " SECRET_KEY
read_secret "  STRIPE_WEBHOOK_SECRET (whsec_): " WEBHOOK_SECRET

case "$SECRET_KEY" in
  sk_test_*|sk_live_*) ;;
  "") die "STRIPE_SECRET_KEY is required." ;;
  pk_*) die "That is the PUBLISHABLE key. This wants the secret key (sk_...).
       The publishable key is not used anywhere in this codebase." ;;
  *) die "STRIPE_SECRET_KEY should start with sk_test_ or sk_live_." ;;
esac

case "$WEBHOOK_SECRET" in
  whsec_*) ;;
  "") die "STRIPE_WEBHOOK_SECRET is required — without it every event is rejected." ;;
  sk_*) die "That is an API key, not the webhook signing secret.
       The whsec_ value is on the webhook ENDPOINT page, not the API keys page." ;;
  *) die "STRIPE_WEBHOOK_SECRET should start with whsec_." ;;
esac

# ── Write ───────────────────────────────────────────────────────────────────
echo
echo "writing $ENV_FILE"
set_env STRIPE_SECRET_KEY     "$SECRET_KEY"
set_env STRIPE_WEBHOOK_SECRET "$WEBHOOK_SECRET"
set_env CORS_ORIGINS          "$CORS_ORIGINS"
set_env APP_URL               "$APP_URL"
set_env STRIPE_LINK_PRO_WEEKLY     "$LINK_PRO_WEEKLY"
set_env STRIPE_LINK_PRO_MONTHLY    "$LINK_PRO_MONTHLY"
set_env STRIPE_LINK_PRO_YEARLY     "$LINK_PRO_YEARLY"
set_env STRIPE_LINK_STUDIO_WEEKLY  "$LINK_STUDIO_WEEKLY"
set_env STRIPE_LINK_STUDIO_MONTHLY "$LINK_STUDIO_MONTHLY"
set_env STRIPE_LINK_STUDIO_YEARLY  "$LINK_STUDIO_YEARLY"

chmod 600 "$ENV_FILE"

# ── Apply ───────────────────────────────────────────────────────────────────
cd "$COMPOSE_DIR"
echo
echo "restarting api"
docker compose up -d api

# The Payment Links are read by prisma/seed.ts at seed time, NOT on boot, so a
# restart alone leaves Plan.stripeLinkUrl exactly as it was.
echo "re-seeding plans"
docker compose exec -T api yarn prisma:seed

# ── Verify ──────────────────────────────────────────────────────────────────
echo
echo "── verification ─────────────────────────────────────────────"

# Prove the values reached the process, not just the file. `docker compose
# exec` reads the container's actual environment, which is the thing that was
# broken. Only presence is printed — never the value.
echo "env inside the container:"
docker compose exec -T api sh -lc '
  for k in STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET CORS_ORIGINS APP_URL; do
    eval "v=\$$k"
    if [ -n "$v" ]; then echo "  ok      $k"; else echo "  MISSING $k"; fi
  done'

echo
echo "plans with a Payment Link:"
docker compose exec -T db psql -U "${POSTGRES_USER:-thlabs}" -d "${POSTGRES_DB:-thlabs}" \
  -tAc 'select tier, cycle, ("stripeLinkUrl" is not null) from "Plan" order by tier, cycle;' \
  | sed 's/^/  /'

echo
echo "startup warnings (silence is success):"
docker compose logs --since 2m api 2>&1 \
  | grep -i "not set\|not configured" | sed 's/^/  /' || echo "  none"

cat <<'DONE'

Next: send a test event from Dashboard > Developers > Webhooks.
  200  wired correctly
  503  STRIPE_WEBHOOK_SECRET never reached the container
  400  it arrived but does not match this endpoint's secret
DONE
