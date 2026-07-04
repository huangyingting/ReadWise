import { mock } from "node:test";
import { pathToFileURL } from "node:url";

const prismaModuleUrl = pathToFileURL(`${process.cwd()}/src/lib/prisma.ts`).href;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_PRISMA_SCHEMA_PATH = process.env.PRISMA_SCHEMA_PATH;
let importCounter = 0;

type MutableEnvKey = "DATABASE_URL" | "NODE_ENV" | "PRISMA_SCHEMA_PATH";
type MutableProcessEnv = Omit<NodeJS.ProcessEnv, MutableEnvKey> & {
  [Key in MutableEnvKey]?: string;
};

type PrismaImportOptions = {
  databaseUrl?: string;
  nodeEnv: string;
  postgres: boolean;
  existingPrisma?: unknown;
  prismaSchemaPath?: string;
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
  setMutableEnv("NODE_ENV", ORIGINAL_NODE_ENV);
  setMutableEnv("PRISMA_SCHEMA_PATH", ORIGINAL_PRISMA_SCHEMA_PATH);
  delete (globalThis as { prisma?: unknown }).prisma;
}

export async function importPrismaModule(options: PrismaImportOptions) {
  const sqliteAdapters: unknown[] = [];
  const pgAdapters: Array<{ connection: string; options: unknown }> = [];
  const prismaClientCalls: Array<{ adapter: unknown; log: string[] }> = [];

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
  }

  restorePrismaEnvironment();
  setMutableEnv("DATABASE_URL", options.databaseUrl);
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
  };
}
