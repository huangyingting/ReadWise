import { spawnSync } from "node:child_process";
import {
  LOCAL_PG_DATABASE_URL,
  LOCAL_PG_SCHEMA_PATH,
  LOCAL_REDIS_URL,
} from "@/lib/local-dev";

type Command = "up" | "migrate" | "seed" | "setup" | "reset" | "status" | "help";

function parseCommand(argv: string[]): { command: Command; yes: boolean } {
  const [rawCommand = "help", ...rest] = argv;
  const command = rawCommand as Command;
  const commands: Command[] = ["up", "migrate", "seed", "setup", "reset", "status", "help"];
  if (!commands.includes(command)) {
    throw new Error(`Unknown local-db command: ${rawCommand}`);
  }
  return { command, yes: rest.includes("--yes") };
}

function printHelp(): void {
  console.log(`ReadWise local PostgreSQL/Redis parity helper

Usage:
  npm run local:pg:up       Start PostgreSQL + Redis and wait for health checks
  npm run local:pg:migrate  Generate the PostgreSQL Prisma client and deploy migrations
  npm run local:pg:seed     Seed deterministic local users/sessions/content
  npm run local:pg:setup    Run up + migrate + seed
  npm run local:pg:reset -- --yes
                            Remove the local compose volume, then setup again
  npm run local:pg:status   Show compose service status

Injected local environment:
  DATABASE_URL=${LOCAL_PG_DATABASE_URL}
  PRISMA_SCHEMA_PATH=${LOCAL_PG_SCHEMA_PATH}
  REDIS_URL=${LOCAL_REDIS_URL}`);
}

function cmd(name: string): string {
  return process.platform === "win32" && name === "npm" ? "npm.cmd" : name;
}

function localEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: LOCAL_PG_DATABASE_URL,
    PRISMA_SCHEMA_PATH: LOCAL_PG_SCHEMA_PATH,
    REDIS_URL: LOCAL_REDIS_URL,
  };
}

function tryRun(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): boolean {
  const result = spawnSync(cmd(command), args, {
    stdio: "inherit",
    env,
  });
  if (result.error) {
    throw result.error;
  }
  return result.status === 0;
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
  if (!tryRun(command, args, env)) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

function up(): void {
  assertPortAvailable("readwise-local-postgres-1", "55432");
  assertPortAvailable("readwise-local-redis-1", "6379");
  run("docker", ["compose", "up", "-d", "--wait", "postgres", "redis"]);
  assertOwnedPort("readwise-local-postgres-1", "55432");
  assertOwnedPort("readwise-local-redis-1", "6379");
}

function assertPortAvailable(container: string, port: string): void {
  const owners = publishedPortOwners(port);
  const otherOwners = owners.filter((owner) => owner !== container);
  if (otherOwners.length > 0) {
    throw new Error(
      `127.0.0.1:${port} is already published by ${otherOwners.join(", ")}. Stop the older local stack, then retry.`,
    );
  }
}

function assertOwnedPort(container: string, port: string): void {
  const result = spawnSync("docker", ["ps", "--filter", `name=${container}`, "--format", "{{.Ports}}"], {
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout.includes(`127.0.0.1:${port}->`)) {
    throw new Error(
      `${container} is not publishing 127.0.0.1:${port}. Stop any older ReadWise compose stack that owns the port, then retry.`,
    );
  }
}

function publishedPortOwners(port: string): string[] {
  const result = spawnSync("docker", ["ps", "--format", "{{.Names}}\t{{.Ports}}"], {
    encoding: "utf8",
  });
  if (result.status !== 0) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.includes(`127.0.0.1:${port}->`))
    .map((line) => line.split("\t")[0])
    .filter(Boolean);
}

function migrate(): void {
  const env = localEnv();
  run("npm", ["run", "prisma:generate:pg"], env);
  run("npm", ["run", "prisma:migrate:pg"], env);
}

function seed(): void {
  run(
    "node",
    [
      "--experimental-strip-types",
      "--import",
      "./scripts/register-ts.mjs",
      "--no-warnings",
      "scripts/local-seed.ts",
    ],
    localEnv(),
  );
}

function setup(): void {
  up();
  migrate();
  seed();
}

function reset(yes: boolean): void {
  if (!yes) {
    throw new Error(
      "Refusing to reset without explicit confirmation. Re-run: npm run local:pg:reset -- --yes",
    );
  }
  run("docker", ["compose", "down", "-v", "--remove-orphans"]);
  setup();
}

function status(): void {
  run("docker", ["compose", "ps"]);
}

async function main(): Promise<number> {
  const { command, yes } = parseCommand(process.argv.slice(2));
  switch (command) {
    case "up":
      up();
      break;
    case "migrate":
      migrate();
      break;
    case "seed":
      seed();
      break;
    case "setup":
      setup();
      break;
    case "reset":
      reset(yes);
      break;
    case "status":
      status();
      break;
    case "help":
      printHelp();
      break;
  }
  return 0;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
