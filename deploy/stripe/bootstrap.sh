#!/usr/bin/env bash
# Create every Stripe object the account API expects, from the command line.
#
#     stripe login          # once, browser-based; no key is ever typed
#     bash deploy/stripe/bootstrap.sh
#
# Runs on your laptop, not the server. Its output is the six STRIPE_LINK_*
# lines for /srv/th-labs/.env — see deploy/server/configure-stripe.sh.
#
# ── Why this is a script and not a Dashboard session ───────────────────────
# The webhook resolves a payment to a plan by EXACT AMOUNT:
#
#     resolvePlan() -> where: { priceCents: session.amount_total }
#
# Plan.stripePriceId is never seeded, so that fallback is the only path there
# is. A price off by one cent, tax added on top, or a promo code applied all
# change amount_total, no plan resolves, and the payment is logged and
# dropped -- the user is charged and credited nothing. A form is an easy place
# to make that mistake once; a table is not.
#
# The amounts below MUST stay identical to PLAN_SEED in api/prisma/seed.ts.
# They drifted once already: links were created at the yearly prices from an
# out-of-date checkout (18200/47000) while seed.ts had moved to 19900/49900,
# so both yearly plans would have taken payment and granted nothing. If you
# change a price, change it in both files in the same commit.
#
# credits is one ALLOCATION, not the advertised total -- yearly bills once and
# drips creditsGranted every 30 days, twelve times.

set -euo pipefail

MODE="${1:-}"

# tier|cycle|cents|interval|credits|env-var-name
PLANS=(
  "PRO|WEEKLY|600|week|300|STRIPE_LINK_PRO_WEEKLY"
  "PRO|MONTHLY|1900|month|1200|STRIPE_LINK_PRO_MONTHLY"
  "PRO|YEARLY|19900|year|1200|STRIPE_LINK_PRO_YEARLY"
  "STUDIO|WEEKLY|1500|week|1200|STRIPE_LINK_STUDIO_WEEKLY"
  "STUDIO|MONTHLY|4900|month|4800|STRIPE_LINK_STUDIO_MONTHLY"
  "STUDIO|YEARLY|49900|year|4800|STRIPE_LINK_STUDIO_YEARLY"
)

WEBHOOK_URL="https://th-labs.uz/v1/payments/webhook"
EVENTS=(
  checkout.session.completed
  invoice.paid
  invoice.payment_succeeded
  invoice.payment_failed
  customer.subscription.updated
  customer.subscription.deleted
)

die() { echo "error: $*" >&2; exit 1; }

command -v stripe >/dev/null 2>&1 \
  || die "stripe CLI not found. Install it:  winget install Stripe.StripeCLI"

# Fails if `stripe login` has never run. Cheapest authenticated call there is.
stripe config --list >/dev/null 2>&1 \
  || die "not logged in. Run:  stripe login"

# ── Dry run by default ─────────────────────────────────────────────────────
# Nothing is created unless you ask for it explicitly. Stripe objects cannot
# be deleted, only archived, so a mistaken run leaves permanent clutter in the
# account -- worth one extra word on the command line.
if [ "$MODE" != "--apply" ]; then
  echo "DRY RUN — nothing will be created. Re-run with --apply to proceed."
  echo
  printf '%-8s %-8s %10s  %-6s %8s\n' TIER CYCLE AMOUNT EVERY CREDITS
  for row in "${PLANS[@]}"; do
    IFS='|' read -r tier cycle cents interval credits _ <<< "$row"
    printf '%-8s %-8s %7s USD  %-6s %8s\n' \
      "$tier" "$cycle" "$(awk -v c="$cents" 'BEGIN{printf "%.2f", c/100}')" \
      "$interval" "$credits"
  done
  echo
  echo "webhook endpoint: $WEBHOOK_URL"
  printf '  %s\n' "${EVENTS[@]}"
  exit 0
fi

echo "creating 6 products, prices and payment links…"
echo

OUT=""
for row in "${PLANS[@]}"; do
  IFS='|' read -r tier cycle cents interval credits envvar <<< "$row"
  name="TH-Labs ${tier} (${cycle,,})"

  product=$(stripe products create \
    --name="$name" \
    --description="${credits} dubbing credits per ${interval}" \
    | python -c 'import sys,json;print(json.load(sys.stdin)["id"])')

  # No tax_behavior and no promo codes anywhere: both move amount_total, and
  # amount_total is the join key back to the Plan row.
  price=$(stripe prices create \
    --product="$product" \
    --unit-amount="$cents" \
    --currency=usd \
    -d "recurring[interval]=$interval" \
    | python -c 'import sys,json;print(json.load(sys.stdin)["id"])')

  link=$(stripe payment_links create \
    -d "line_items[0][price]=$price" \
    -d "line_items[0][quantity]=1" \
    | python -c 'import sys,json;print(json.load(sys.stdin)["url"])')

  printf '  ok  %-8s %-8s %7s USD  %s\n' \
    "$tier" "$cycle" "$(awk -v c="$cents" 'BEGIN{printf "%.2f", c/100}')" "$link"
  OUT+="${envvar}=${link}"$'\n'
done

echo
echo "creating webhook endpoint…"
events_args=()
for e in "${EVENTS[@]}"; do events_args+=(--enabled-events="$e"); done

# The response contains the whsec_ signing secret. It is deliberately NOT
# printed -- a secret echoed to a terminal ends up in scrollback, and from
# there in a screenshot or a pasted log. Read it from the Dashboard instead,
# where it is shown behind a click.
stripe webhook_endpoints create --url="$WEBHOOK_URL" "${events_args[@]}" \
  | python -c 'import sys,json;d=json.load(sys.stdin);print("  ok  "+d["id"]+"  "+d["url"])'

cat <<BANNER

── paste into /srv/th-labs/.env ──────────────────────────────────────────
BANNER
printf '%s' "$OUT"
cat <<'BANNER'
──────────────────────────────────────────────────────────────────────────

Still to do by hand:
  1. Dashboard > Developers > Webhooks > (the endpoint just created)
     Reveal the signing secret (whsec_...) — that is the ONE value this
     script deliberately never printed.
  2. Run deploy/server/configure-stripe.sh on the server with these links
     and that secret.
  3. Test with card 4242 4242 4242 4242, any future expiry, any CVC.
BANNER
