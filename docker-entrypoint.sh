#!/bin/sh
# Entrypoint for the ReadWise production container.
# Runs pending Prisma migrations before starting the Next.js server.
set -e

SCHEMA_PATH="${PRISMA_SCHEMA_PATH:-prisma/schema.prisma}"

echo "Validating database schema configuration..."
node ./scripts/validate-database-schema-config.mjs

echo "Running database migrations..."
node ./node_modules/prisma/build/index.js migrate deploy --schema "$SCHEMA_PATH"

echo "Starting server..."
exec node server.js
