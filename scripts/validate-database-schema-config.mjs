#!/usr/bin/env node

import {
  inspectDatabaseSchemaPairing,
  SQLITE_PRISMA_SCHEMA_PATH,
} from "../src/lib/database-provider-policy.mjs";

function fail(message) {
  console.error(`Database schema configuration error: ${message}`);
  process.exit(1);
}

const pairing = inspectDatabaseSchemaPairing(
  process.env.DATABASE_URL,
  process.env.PRISMA_SCHEMA_PATH ?? SQLITE_PRISMA_SCHEMA_PATH,
);
if (!pairing.ok) {
  fail(pairing.message);
}

const providerLabel = pairing.provider === "postgresql" ? "PostgreSQL" : "SQLite";
console.log(`Database schema configuration OK (${providerLabel}).`);
