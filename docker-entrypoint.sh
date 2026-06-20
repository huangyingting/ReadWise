#!/bin/sh
# Entrypoint for the ReadWise production container.
# Runs pending Prisma migrations before starting the Next.js server.
set -e

echo "Running database migrations..."
./node_modules/.bin/prisma migrate deploy

echo "Starting server..."
exec node server.js
