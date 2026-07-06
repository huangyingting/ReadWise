import { dirname, isAbsolute, join } from "node:path";
import { defineConfig } from "prisma/config";

const DEFAULT_SCHEMA = "prisma/schema.prisma";
const SCHEMA_FLAG = "--schema";

function loadLocalEnv(): void {
  try {
    process.loadEnvFile?.(".env");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

function schemaPathFromArgs(args: string[]): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${SCHEMA_FLAG}=`));
  if (inline) {
    return inline.slice(`${SCHEMA_FLAG}=`.length);
  }

  const index = args.indexOf(SCHEMA_FLAG);
  if (index >= 0) {
    return args[index + 1];
  }

  return undefined;
}

loadLocalEnv();

const schema =
  schemaPathFromArgs(process.argv) ?? process.env.PRISMA_SCHEMA_PATH ?? DEFAULT_SCHEMA;

function splitSqliteFileUrl(databaseUrl: string): { pathPart: string; suffix: string } {
  const value = databaseUrl.slice("file:".length);
  const suffixStart = value.search(/[?#]/);
  if (suffixStart < 0) return { pathPart: value, suffix: "" };
  return {
    pathPart: value.slice(0, suffixStart),
    suffix: value.slice(suffixStart),
  };
}

function isAbsoluteSqlitePath(pathPart: string): boolean {
  return (
    pathPart.startsWith("/") ||
    pathPart.startsWith("\\") ||
    pathPart.startsWith("//") ||
    /^[a-zA-Z]:[\\/]/.test(pathPart)
  );
}

function normalizeSqliteDatasourceUrl(databaseUrl: string, schemaPath: string): string {
  if (!databaseUrl.startsWith("file:")) return databaseUrl;

  const { pathPart, suffix } = splitSqliteFileUrl(databaseUrl);
  if (
    pathPart.length === 0 ||
    pathPart === ":memory:" ||
    suffix.toLowerCase().includes("mode=memory") ||
    isAbsoluteSqlitePath(pathPart)
  ) {
    return databaseUrl;
  }

  const absoluteSchemaPath = isAbsolute(schemaPath) ? schemaPath : join(process.cwd(), schemaPath);
  return `file:${join(dirname(absoluteSchemaPath), pathPart).replace(/\\/g, "/")}${suffix}`;
}

export default defineConfig({
  schema,
  migrations: {
    path: join(dirname(schema), "migrations"),
  },
  datasource: {
    url: normalizeSqliteDatasourceUrl(process.env.DATABASE_URL ?? "file:./dev.db", schema),
  },
});