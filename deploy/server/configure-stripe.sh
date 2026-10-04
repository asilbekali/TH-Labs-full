#!/usr/bin/env bash
# Wire Stripe into the deployed account API. Run ON THE SERVER:
#
#     cd /srv/th-labs && bash configure-stripe.sh
#
# Idempotent: every value is replaced in place if the key already exists, so
# re-running after a typo is safe and never leaves duplicate lines behind.
#
# The secret key is read from the terminal, never from a command argument. An
# argument would land in the shell history and in `ps` output for every other
# user on the box; a here-doc in a chat log is worse. Everything else is public
# config and can be edited into this file directly.
#
# There is NO webhook secret any more. This API has no webhook endpoint: a
# purchase is confirmed by reading the Checkout Session back from Stripe when
# the buyer returns (api/src/payment/stripe.service.ts). An earlier version of
# this script asked for STRIPE_WEBHOOK_SECRET; nothing reads it now.
#
# What this does NOT do: create the Payment Links in the Stripe Dashboard, or
# set their redirect. Both have to be done there first — this only carries the
# values into the container. See README.md § 6.

set -euo pipefail

ENV_FILE=/srv/th-labs/.env
COMPOSE_DIR=/srv/th-labs

# ── The public half. Edit these before running. ─────────────────────────────
STUDIO_ORIGIN="https://isoqovjorabek2--th-labs-dubbing-web.modal.run"
APP_URL="https://th-labs.uz"
CORS_ORIGINS="https://th-labs.uz,https://www.th-labs.uz,https://aytingchi.uz,https://www.aytingchi.uz,${STUDIO_ORIGIN}"

# Payment Link URLs. These are TEST MODE links -- buy.stripe.com/test_... --
# and take test cards only. Going live means replacing every one of them AND
# the secret key together: a test link with a live key (or the reverse) charges
# the customer and then fails to credit them, because a key can only read a
# Checkout Session from its own mode.
#
# EACH LINK must have its Stripe-side redirect set to
#     ${APP_URL}/plans/success?session_id={CHECKOUT_SESSION_ID}
# under "After payment -> Redirect customers to a custom page", including the
# brace token. That is what the claim reads; without it the customer pays and
# lands on a page with nothing to verify. The links below predate that
# requirement -- check all of them in the Dashboard before trusting this script.
# `GET /v1/admin/billing/overview` prints the exact URL to paste.
#
# Leave a value empty to skip that item; its Buy button is then disabled.
LINK_PRO_MONTHLY="https://buy.stripe.com/test_8x27sNc6m4U6buM11q6AM01"
LINK_PRO_YEARLY="https://buy.stripe.com/test_7sYdRb0nEgCO0Q8bG46AM07"
LINK_STUDIO_MONTHLY="https://buy.stripe.com/test_8x2dRb3zQ3Q2fL225u6AM04"
LINK_STUDIO_YEARLY="https://buy.stripe.com/test_aFaaEZeeubiueGY5hG6AM06"

# One-time credit packs. Price each Stripe product to match
# api/src/payment/credit-packs.ts exactly -- $1.19 / $4.99 / $17.99 -- because
# a claim compares what Stripe charged against the catalog and refuses to grant
# credits when they disagree.
LINK_PACK_100=""
LINK_PACK_500=""
LINK_PACK_2000=""

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
echo "Paste the Stripe secret key. It is not echoed."
echo "A RESTRICTED key (rk_...) with 'Checkout Sessions: read' is enough —"
echo "that single permission is all this API uses."
read_secret "  STRIPE_SECRET_KEY (sk_... or rk_...): " SECRET_KEY

case "$SECRET_KEY" in
  sk_test_*|sk_live_*|rk_test_*|rk_live_*) ;;
  "") die "STRIPE_SECRET_KEY is required — without it a purchase cannot be
       verified, and therefore cannot be credited." ;;
  pk_*) die "That is the PUBLISHABLE key. This wants the secret or restricted
       key. The publishable key is not used anywhere in this codebase." ;;
  whsec_*) die "That is a webhook signing secret. This setup has no webhook —
       a purchase is confirmed by reading the Checkout Session back from
       Stripe. Paste the secret or restricted API key instead." ;;
  *) die "STRIPE_SECRET_KEY should start with sk_ or rk_." ;;
esac

# ── Write ───────────────────────────────────────────────────────────────────
echo
echo "writing $ENV_FILE"
set_env STRIPE_SECRET_KEY     "$SECRET_KEY"
set_env CORS_ORIGINS          "$CORS_ORIGINS"
set_env APP_URL               "$APP_URL"
set_env STRIPE_LINK_PRO_MONTHLY    "$LINK_PRO_MONTHLY"
set_env STRIPE_LINK_PRO_YEARLY     "$LINK_PRO_YEARLY"
set_env STRIPE_LINK_STUDIO_MONTHLY "$LINK_STUDIO_MONTHLY"
set_env STRIPE_LINK_STUDIO_YEARLY  "$LINK_STUDIO_YEARLY"
set_env STRIPE_LINK_PACK_100       "$LINK_PACK_100"
set_env STRIPE_LINK_PACK_500       "$LINK_PACK_500"
set_env STRIPE_LINK_PACK_2000      "$LINK_PACK_2000"

chmod 600 "$ENV_FILE"

# ── Apply ───────────────────────────────────────────────────────────────────
cd "$COMPOSE_DIR"
echo
echo "restarting api"
docker compose up -d api

# The Payment Links are read by prisma/seed.ts at seed time, NOT on boot, so a
# restart alone leaves Plan.stripePaymentLink exactly as it was. Note the seed
# only fills a link in when it CREATES the row — a link already set from the
# admin panel wins and is never overwritten, which is deliberate.
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
  for k in STRIPE_SECRET_KEY CORS_ORIGINS APP_URL; do
    eval "v=\$$k"
    if [ -n "$v" ]; then echo "  ok      $k"; else echo "  MISSING $k"; fi
  done'

echo
echo "plans with a Payment Link:"
docker compose exec -T db psql -U "${POSTGRES_USER:-thlabs}" -d "${POSTGRES_DB:-thlabs}" \
  -tAc 'select tier, cycle, ("stripePaymentLink" is not null) from "Plan" order by tier, cycle;' \
  | sed 's/^/  /'

echo
echo "startup warnings (silence is success):"
docker compose logs --since 2m api 2>&1 \
  | grep -i "not set\|not configured" | sed 's/^/  /' || echo "  none"

cat <<'DONE'

Next, and this is the step that is easy to miss: open each Payment Link in
Dashboard > Payment links and confirm its "After payment" redirect is

    <APP_URL>/plans/success?session_id={CHECKOUT_SESSION_ID}

That token is what the claim reads. Without it the customer pays, lands on the
success page with nothing to verify, and no credits are granted. Check it with
a test card end to end:

  credits appear          wired correctly
  "Nothing to confirm"    the redirect is missing the session_id token
  "could not find that    the key and the link are from different modes
   payment at Stripe"     (test key + live link, or the reverse)
DONE
