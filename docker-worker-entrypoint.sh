#!/bin/sh
# Entrypoint for the dedicated production worker/maintenance image target.
# Web deployment applies migrations first; release order starts workers only
# after the web tier reports ready.
set -e

echo "Validating database schema configuration..."
node ./scripts/validate-database-schema-config.mjs

exec "$@"
