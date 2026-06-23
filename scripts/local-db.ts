import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  LOCAL_PG_DATABASE_URL,
  LOCAL_PG_SCHEMA_PATH,
  LOCAL_REDIS_URL,
} from "@/lib/local-dev";

type Command = "up" | "migrate" | "seed" | "setup" | "reset" | "status" | "help";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const COMPOSE_FILE_PATH = path.join(REPO_ROOT, "docker-compose.yml");
export const COMPOSE_PROJECT_NAME = "readwise-local";

const COMPOSE_SERVICES = new Set(["postgres", "redis"]);
const COMPOSE_VOLUMES = new Set(["readwise-postgres-data"]);
const COMPOSE_LABEL_PROJECT = "com.docker.compose.project";
const COMPOSE_LABEL_SERVICE = "com.docker.compose.service";
const COMPOSE_LABEL_VOLUME = "com.docker.compose.volume";
const COMPOSE_LABEL_WORKING_DIR = "com.docker.compose.project.working_dir";
const COMPOSE_LABEL_CONFIG_FILES = "com.docker.compose.project.config_files";

type Labels = Record<string, string | undefined>;

export function parseCommand(argv: string[]): { command: Command; yes: boolean } {
  const [rawCommand = "help", ...rest] = argv;
  const command = rawCommand as Command;
  const commands: Command[] = ["up", "migrate", "seed", "setup", "reset", "status", "help"];
  if (!commands.includes(command)) {
    throw new Error(`Unknown local-db command: ${rawCommand}`);
  }
  return { command, yes: rest.includes("--yes") };
}

export function printHelp(): void {
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

export function localEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: LOCAL_PG_DATABASE_URL,
    PRISMA_SCHEMA_PATH: LOCAL_PG_SCHEMA_PATH,
    REDIS_URL: LOCAL_REDIS_URL,
  };
}

export function tryRun(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): boolean {
  const result = spawnSync(cmd(command), args, {
    stdio: "inherit",
    env,
  });
  if (result.error) {
    throw result.error;
  }
  return result.status === 0;
}

export function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
  if (!tryRun(command, args, env)) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

export function composeArgs(args: string[]): string[] {
  return ["compose", "-f", COMPOSE_FILE_PATH, "-p", COMPOSE_PROJECT_NAME, ...args];
}

export function dockerEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.COMPOSE_FILE;
  delete env.COMPOSE_PROJECT_NAME;
  delete env.DOCKER_HOST;
  return env;
}

function dockerOutput(args: string[], env: NodeJS.ProcessEnv = dockerEnv()): string {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    env,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`docker ${args.join(" ")} failed${result.stderr ? `: ${result.stderr.trim()}` : ""}`);
  }
  return result.stdout;
}

function dockerLines(args: string[], env: NodeJS.ProcessEnv = dockerEnv()): string[] {
  return dockerOutput(args, env)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function runDockerCompose(args: string[], env: NodeJS.ProcessEnv = dockerEnv()): void {
  assertLocalDockerTarget(env);
  run("docker", composeArgs(args), env);
}

export function up(): void {
  const env = dockerEnv();
  assertLocalDockerTarget(env);
  assertPortAvailable("readwise-local-postgres-1", "55432", env);
  assertPortAvailable("readwise-local-redis-1", "6379", env);
  run("docker", composeArgs(["up", "-d", "--wait", "postgres", "redis"]), env);
  assertOwnedPort("readwise-local-postgres-1", "55432", env);
  assertOwnedPort("readwise-local-redis-1", "6379", env);
}

export function assertPortAvailable(container: string, port: string, env: NodeJS.ProcessEnv = dockerEnv()): void {
  const owners = publishedPortOwners(port, env);
  const otherOwners = owners.filter((owner) => owner !== container);
  if (otherOwners.length > 0) {
    throw new Error(
      `127.0.0.1:${port} is already published by ${otherOwners.join(", ")}. Stop the older local stack, then retry.`,
    );
  }
}

export function assertOwnedPort(container: string, port: string, env: NodeJS.ProcessEnv = dockerEnv()): void {
  const result = spawnSync("docker", ["ps", "--filter", `name=${container}`, "--format", "{{.Ports}}"], {
    encoding: "utf8",
    env,
  });
  if (result.status !== 0 || !result.stdout.includes(`127.0.0.1:${port}->`)) {
    throw new Error(
      `${container} is not publishing 127.0.0.1:${port}. Stop any older ReadWise compose stack that owns the port, then retry.`,
    );
  }
}

export function publishedPortOwners(port: string, env: NodeJS.ProcessEnv = dockerEnv()): string[] {
  const result = spawnSync("docker", ["ps", "--format", "{{.Names}}\t{{.Ports}}"], {
    encoding: "utf8",
    env,
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

export function migrate(): void {
  const env = localEnv();
  run("npm", ["run", "prisma:generate:pg"], env);
  run("npm", ["run", "prisma:migrate:pg"], env);
}

export function seed(): void {
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

export function setup(): void {
  up();
  migrate();
  seed();
}

export function assertLocalDockerTarget(env: NodeJS.ProcessEnv = dockerEnv()): void {
  if (process.env.DOCKER_HOST?.trim()) {
    throw new Error(
      "Refusing to run local Docker commands while DOCKER_HOST is set. Unset DOCKER_HOST so ReadWise only targets the local Docker engine.",
    );
  }

  const context = process.env.DOCKER_CONTEXT?.trim();
  const contextArgs = ["context", "inspect", "--format", "{{json .Endpoints}}"];
  if (context) {
    contextArgs.push(context);
  }

  const endpointJson = dockerOutput(contextArgs, env).trim();
  const endpoint = parseDockerEndpoint(endpointJson);
  if (!isLocalDockerEndpoint(endpoint)) {
    throw new Error(
      `Refusing to run local Docker commands against non-local Docker context${context ? ` ${context}` : ""} (${endpoint || "unknown endpoint"}).`,
    );
  }
}

function parseDockerEndpoint(endpointJson: string): string {
  try {
    const endpoints = JSON.parse(endpointJson) as { docker?: { Host?: unknown } };
    return typeof endpoints.docker?.Host === "string" ? endpoints.docker.Host : "";
  } catch {
    return "";
  }
}

export function isLocalDockerEndpoint(endpoint: string): boolean {
  if (endpoint.startsWith("unix://") || endpoint.startsWith("npipe://")) {
    return true;
  }

  try {
    const url = new URL(endpoint);
    return url.protocol === "tcp:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function assertResetTargetsAreReadWiseLocal(env: NodeJS.ProcessEnv = dockerEnv()): void {
  const containerNames = new Set([
    ...dockerLines(["ps", "-a", "--filter", `label=${COMPOSE_LABEL_PROJECT}=${COMPOSE_PROJECT_NAME}`, "--format", "{{.Names}}"], env),
  ]);
  for (const service of COMPOSE_SERVICES) {
    const name = `${COMPOSE_PROJECT_NAME}-${service}-1`;
    if (resourceExists("container", name, env)) {
      containerNames.add(name);
    }
  }

  for (const name of containerNames) {
    const labels = inspectLabels("container", name, env);
    assertComposeContainerLabels(name, labels);
  }

  const volumeNames = new Set([
    ...dockerLines(["volume", "ls", "--filter", `label=${COMPOSE_LABEL_PROJECT}=${COMPOSE_PROJECT_NAME}`, "--format", "{{.Name}}"], env),
  ]);
  for (const volume of COMPOSE_VOLUMES) {
    const name = `${COMPOSE_PROJECT_NAME}_${volume}`;
    if (resourceExists("volume", name, env)) {
      volumeNames.add(name);
    }
  }

  for (const name of volumeNames) {
    const labels = inspectLabels("volume", name, env);
    assertComposeVolumeLabels(name, labels);
  }
}

function resourceExists(kind: "container" | "volume", name: string, env: NodeJS.ProcessEnv): boolean {
  const result = spawnSync("docker", [kind, "inspect", name, "--format", "{{.Name}}"], {
    encoding: "utf8",
    env,
  });
  if (result.error) {
    throw result.error;
  }
  return result.status === 0;
}

function inspectLabels(kind: "container" | "volume", name: string, env: NodeJS.ProcessEnv): Labels {
  const labelPath = kind === "container" ? ".Config.Labels" : ".Labels";
  const output = dockerOutput([kind, "inspect", name, "--format", `{{json ${labelPath}}}`], env).trim();
  try {
    return (JSON.parse(output || "{}") ?? {}) as Labels;
  } catch {
    throw new Error(`Unable to parse Docker labels for ${kind} ${name}`);
  }
}

function assertComposeContainerLabels(name: string, labels: Labels): void {
  assertReadWiseProjectLabel("container", name, labels);

  const service = labels[COMPOSE_LABEL_SERVICE];
  if (!service) {
    throw new Error(`Refusing reset: container ${name} is missing the Docker Compose service label.`);
  }

  assertRepoComposeLabels("container", name, labels);
}

function assertComposeVolumeLabels(name: string, labels: Labels): void {
  assertReadWiseProjectLabel("volume", name, labels);

  const volume = labels[COMPOSE_LABEL_VOLUME];
  if (!volume || !COMPOSE_VOLUMES.has(volume)) {
    throw new Error(`Refusing reset: volume ${name} is not a managed ReadWise local compose volume.`);
  }
}

function assertReadWiseProjectLabel(kind: "container" | "volume", name: string, labels: Labels): void {
  if (labels[COMPOSE_LABEL_PROJECT] !== COMPOSE_PROJECT_NAME) {
    throw new Error(
      `Refusing reset: ${kind} ${name} does not carry ${COMPOSE_LABEL_PROJECT}=${COMPOSE_PROJECT_NAME}.`,
    );
  }
}

function assertRepoComposeLabels(kind: "container" | "volume", name: string, labels: Labels): void {
  const workingDir = labels[COMPOSE_LABEL_WORKING_DIR];
  if (workingDir && path.resolve(workingDir) !== REPO_ROOT) {
    throw new Error(`Refusing reset: ${kind} ${name} belongs to a different compose working directory.`);
  }

  const configFiles = labels[COMPOSE_LABEL_CONFIG_FILES];
  if (configFiles) {
    const files = configFiles.split(",").map((file) => path.resolve(file.trim()));
    if (!files.includes(COMPOSE_FILE_PATH)) {
      throw new Error(`Refusing reset: ${kind} ${name} belongs to a different compose file.`);
    }
  }
}

export function reset(yes: boolean): void {
  if (!yes) {
    throw new Error(
      "Refusing to reset without explicit confirmation. Re-run: npm run local:pg:reset -- --yes",
    );
  }
  const env = dockerEnv();
  assertLocalDockerTarget(env);
  assertResetTargetsAreReadWiseLocal(env);
  run("docker", composeArgs(["down", "-v", "--remove-orphans"]), env);
  setup();
}

export function status(): void {
  runDockerCompose(["ps"]);
}

export async function main(): Promise<number> {
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
