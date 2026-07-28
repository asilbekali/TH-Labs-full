#!/bin/sh
set -e

# Compose gates this container on the database's healthcheck, so Postgres is
# already accepting connections by the time this runs.
#
# `migrate deploy` is the non-interactive apply: it replays the migrations
# committed under prisma/migrations and will never generate a new one or reset
# the database, which is what makes it safe to run on every start.
echo "→ applying database migrations"
npx prisma migrate deploy

exec "$@"
