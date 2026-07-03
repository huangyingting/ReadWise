import { dirname, join } from "node:path";
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

export default defineConfig({
  schema,
  migrations: {
    path: join(dirname(schema), "migrations"),
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  },
});