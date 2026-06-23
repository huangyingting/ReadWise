#!/bin/sh
# Entrypoint for the ReadWise production container.
# Runs pending Prisma migrations before starting the Next.js server.
set -e

echo "Running database migrations..."
./node_modules/.bin/prisma migrate deploy --schema "${PRISMA_SCHEMA_PATH:-prisma/schema.prisma}"

echo "Starting server..."
exec node server.js
