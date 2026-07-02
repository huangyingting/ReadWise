import { dirname, join } from "node:path";
import { defineConfig } from "prisma/config";

try {
  process.loadEnvFile?.(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
}

function schemaPathFromArgs(args: string[]): string | undefined {
  const inline = args.find((arg) => arg.startsWith("--schema="));
  if (inline) {
    return inline.slice("--schema=".length);
  }

  const index = args.indexOf("--schema");
  if (index >= 0) {
    return args[index + 1];
  }

  return undefined;
}

const schema = schemaPathFromArgs(process.argv) ?? process.env.PRISMA_SCHEMA_PATH ?? "prisma/schema.prisma";

export default defineConfig({
  schema,
  migrations: {
    path: join(dirname(schema), "migrations"),
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  },
});