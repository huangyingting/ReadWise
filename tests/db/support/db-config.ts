/**
 * Shared PostgreSQL integration test configuration.
 *
 * Guards the live-PG suite behind RUN_DB_INTEGRATION=1 and a PostgreSQL
 * DATABASE_URL so tests never run accidentally against the wrong database.
 */

const POSTGRES_PROTOCOLS = ["postgresql://", "postgres://"] as const;

export const enabled = process.env.RUN_DB_INTEGRATION === "1";
export const databaseUrl = process.env.DATABASE_URL ?? "";
export const isPostgres = POSTGRES_PROTOCOLS.some((protocol) => databaseUrl.startsWith(protocol));

/** Prefix used for all integration-test rows so cleanup helpers can sweep them. */
export const PREFIX = "dbit_";
