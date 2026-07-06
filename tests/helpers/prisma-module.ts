import { mock } from "node:test";
import { pathToFileURL } from "node:url";

const prismaModuleUrl = pathToFileURL(`${process.cwd()}/src/lib/prisma.ts`).href;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const ORIGINAL_DB_QUERY_TIMING_ENABLED = process.env.DB_QUERY_TIMING_ENABLED;
const ORIGINAL_DB_SLOW_QUERY_THRESHOLD_MS = process.env.DB_SLOW_QUERY_THRESHOLD_MS;
const ORIGINAL_LOG_LEVEL = process.env.LOG_LEVEL;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_PRISMA_SCHEMA_PATH = process.env.PRISMA_SCHEMA_PATH;
let importCounter = 0;

type MutableEnvKey =
  | "DATABASE_URL"
  | "DB_QUERY_TIMING_ENABLED"
  | "DB_SLOW_QUERY_THRESHOLD_MS"
  | "LOG_LEVEL"
  | "NODE_ENV"
  | "PRISMA_SCHEMA_PATH";
type MutableProcessEnv = Omit<NodeJS.ProcessEnv, MutableEnvKey> & {
  [Key in MutableEnvKey]?: string;
};

type PrismaImportOptions = {
  databaseUrl?: string;
  nodeEnv: string;
  postgres: boolean;
  existingPrisma?: unknown;
  prismaSchemaPath?: string;
  dbQueryTimingEnabled?: string;
  dbSlowQueryThresholdMs?: string;
};

const mutableProcessEnv = process.env as MutableProcessEnv;

function setMutableEnv(name: MutableEnvKey, value: string | undefined): void {
  if (value === undefined) {
    delete mutableProcessEnv[name];
  } else {
    mutableProcessEnv[name] = value;
  }
}

export function restorePrismaEnvironment(): void {
  setMutableEnv("DATABASE_URL", ORIGINAL_DATABASE_URL);
  setMutableEnv("DB_QUERY_TIMING_ENABLED", ORIGINAL_DB_QUERY_TIMING_ENABLED);
  setMutableEnv("DB_SLOW_QUERY_THRESHOLD_MS", ORIGINAL_DB_SLOW_QUERY_THRESHOLD_MS);
  setMutableEnv("LOG_LEVEL", ORIGINAL_LOG_LEVEL);
  setMutableEnv("NODE_ENV", ORIGINAL_NODE_ENV);
  setMutableEnv("PRISMA_SCHEMA_PATH", ORIGINAL_PRISMA_SCHEMA_PATH);
  delete (globalThis as { prisma?: unknown }).prisma;
}

export async function importPrismaModule(options: PrismaImportOptions) {
  const sqliteAdapters: unknown[] = [];
  const pgAdapters: Array<{ connection: string; options: unknown }> = [];
  const prismaClientCalls: Array<{ adapter: unknown; log: string[] }> = [];
  const prismaExtensions: unknown[] = [];
  const rawQueryCalls: unknown[][] = [];

  class FakePrismaBetterSqlite3 {
    constructor(config: unknown) {
      sqliteAdapters.push(config);
    }
  }

  class FakePrismaPg {
    constructor(connection: string, pgOptions?: unknown) {
      pgAdapters.push({ connection, options: pgOptions });
    }
  }

  class FakePrismaClient {
    constructor(config: { adapter: unknown; log: string[] }) {
      prismaClientCalls.push(config);
    }

    $extends(extension: unknown) {
      prismaExtensions.push(extension);
      return this;
    }

    async $queryRaw(...args: unknown[]) {
      rawQueryCalls.push(args);
      return [{ ok: true }];
    }
  }

  restorePrismaEnvironment();
  setMutableEnv("DATABASE_URL", options.databaseUrl);
  setMutableEnv("DB_QUERY_TIMING_ENABLED", options.dbQueryTimingEnabled);
  setMutableEnv("DB_SLOW_QUERY_THRESHOLD_MS", options.dbSlowQueryThresholdMs);
  setMutableEnv("LOG_LEVEL", "error");
  setMutableEnv("NODE_ENV", options.nodeEnv);
  setMutableEnv("PRISMA_SCHEMA_PATH", options.prismaSchemaPath);
  if (options.existingPrisma !== undefined) {
    (globalThis as { prisma?: unknown }).prisma = options.existingPrisma;
  }

  mock.module("@prisma/adapter-better-sqlite3", {
    namedExports: { PrismaBetterSqlite3: FakePrismaBetterSqlite3 },
  });
  mock.module("@prisma/adapter-pg", {
    namedExports: { PrismaPg: FakePrismaPg },
  });
  mock.module("@prisma/client", {
    namedExports: { PrismaClient: FakePrismaClient },
  });
  mock.module("@/lib/db-utils", {
    namedExports: { isPostgresDatabase: () => options.postgres },
  });

  importCounter += 1;
  const prismaModule = await import(`${prismaModuleUrl}?testImport=${importCounter}`);
  return {
    prisma: prismaModule.prisma,
    sqliteAdapters,
    pgAdapters,
    prismaClientCalls,
    prismaExtensions,
    rawQueryCalls,
  };
}
