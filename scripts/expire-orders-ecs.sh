#!/bin/sh

set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE="$PROJECT_DIR/.env.production"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

CRON_SECRET_VALUE=$(sed -n 's/^CRON_SECRET=//p' "$ENV_FILE" | head -n 1 | tr -d '\r')

if [ -z "$CRON_SECRET_VALUE" ]; then
  echo "CRON_SECRET is missing in $ENV_FILE" >&2
  exit 1
fi

curl --fail --silent --show-error \
  -H "Authorization: Bearer $CRON_SECRET_VALUE" \
  "http://127.0.0.1:3000/api/cron/expire-orders"
