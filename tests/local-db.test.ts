import assert from "node:assert/strict";
import type { SpawnSyncReturns } from "node:child_process";
import path from "node:path";
import { afterEach, before, beforeEach, mock, test } from "node:test";

type SpawnOptions = {
  encoding?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: string;
};

type SpawnCall = {
  command: string;
  args: string[];
  options: SpawnOptions;
};

type SpawnHandler = (call: SpawnCall) => Partial<SpawnSyncReturns<string>>;

let spawnCalls: SpawnCall[] = [];
let spawnHandler: SpawnHandler = () => ({ status: 0, stdout: "", stderr: "" });
let localDb: typeof import("../scripts/local-db");

const originalEnv = {
  COMPOSE_FILE: process.env.COMPOSE_FILE,
  COMPOSE_PROJECT_NAME: process.env.COMPOSE_PROJECT_NAME,
  DOCKER_HOST: process.env.DOCKER_HOST,
  DOCKER_CONTEXT: process.env.DOCKER_CONTEXT,
};

before(async () => {
  mock.module("node:child_process", {
    namedExports: {
      spawnSync(command: string, args: string[] = [], options: SpawnOptions = {}) {
        const call = { command, args, options };
        spawnCalls.push(call);
        return {
          status: 0,
          signal: null,
          output: [],
          pid: 0,
          stdout: "",
          stderr: "",
          ...spawnHandler(call),
        };
      },
    },
  });

  localDb = await import("../scripts/local-db");
});

beforeEach(() => {
  spawnCalls = [];
  spawnHandler = ({ args }) => {
    if (args[0] === "context" && args[1] === "inspect") {
      return {
        status: 0,
        stdout: JSON.stringify({ docker: { Host: "unix:///var/run/docker.sock" } }),
      };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
});

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test("local-db compose calls pin the repo compose file and project name", () => {
  process.env.COMPOSE_FILE = "other-compose.yml";
  process.env.COMPOSE_PROJECT_NAME = "shared-project";

  localDb.status();

  const composeCall = spawnCalls.find((call) => call.command === "docker" && call.args[0] === "compose");
  assert.ok(composeCall);
  assert.deepEqual(composeCall.args, [
    "compose",
    "-f",
    path.join(localDb.REPO_ROOT, "docker-compose.yml"),
    "-p",
    "readwise-local",
    "ps",
  ]);
  assert.equal(composeCall.options.env?.COMPOSE_FILE, undefined);
  assert.equal(composeCall.options.env?.COMPOSE_PROJECT_NAME, undefined);
});

test("local-db rejects Docker host override before Docker commands", () => {
  process.env.DOCKER_HOST = "tcp://shared.example.invalid:2375";

  assert.throws(() => localDb.status(), /DOCKER_HOST/);
  assert.equal(spawnCalls.some((call) => call.args[0] === "compose"), false);
});

test("local-db rejects a non-local Docker context override", () => {
  process.env.DOCKER_CONTEXT = "shared-prod";
  spawnHandler = ({ args }) => {
    if (args[0] === "context" && args[1] === "inspect") {
      return {
        status: 0,
        stdout: JSON.stringify({ docker: { Host: "ssh://shared.example.invalid" } }),
      };
    }
    return { status: 0, stdout: "", stderr: "" };
  };

  assert.throws(() => localDb.status(), /non-local Docker context shared-prod/);
  assert.equal(spawnCalls.some((call) => call.args[0] === "compose"), false);
});

test("local-db reset label verification accepts only ReadWise local compose resources", () => {
  const containerLabels = {
    "com.docker.compose.project": "readwise-local",
    "com.docker.compose.service": "postgres",
    "com.docker.compose.project.working_dir": localDb.REPO_ROOT,
    "com.docker.compose.project.config_files": localDb.COMPOSE_FILE_PATH,
  };
  const volumeLabels = {
    "com.docker.compose.project": "readwise-local",
    "com.docker.compose.volume": "readwise-postgres-data",
  };

  spawnHandler = ({ args }) => {
    const joined = args.join(" ");
    if (joined === "ps -a --filter label=com.docker.compose.project=readwise-local --format {{.Names}}") {
      return { status: 0, stdout: "readwise-local-postgres-1\n" };
    }
    if (joined === "volume ls --filter label=com.docker.compose.project=readwise-local --format {{.Name}}") {
      return { status: 0, stdout: "readwise-local_readwise-postgres-data\n" };
    }
    if (joined === "container inspect readwise-local-postgres-1 --format {{.Name}}") {
      return { status: 0, stdout: "/readwise-local-postgres-1\n" };
    }
    if (joined === "container inspect readwise-local-redis-1 --format {{.Name}}") {
      return { status: 1, stdout: "", stderr: "missing" };
    }
    if (joined === "volume inspect readwise-local_readwise-postgres-data --format {{.Name}}") {
      return { status: 0, stdout: "readwise-local_readwise-postgres-data\n" };
    }
    if (joined === "container inspect readwise-local-postgres-1 --format {{json .Config.Labels}}") {
      return { status: 0, stdout: JSON.stringify(containerLabels) };
    }
    if (joined === "volume inspect readwise-local_readwise-postgres-data --format {{json .Labels}}") {
      return { status: 0, stdout: JSON.stringify(volumeLabels) };
    }
    return { status: 0, stdout: "", stderr: "" };
  };

  assert.doesNotThrow(() => localDb.assertResetTargetsAreReadWiseLocal(localDb.dockerEnv()));
});

test("local-db reset label verification rejects an unlabeled target volume", () => {
  spawnHandler = ({ args }) => {
    const joined = args.join(" ");
    if (joined === "ps -a --filter label=com.docker.compose.project=readwise-local --format {{.Names}}") {
      return { status: 0, stdout: "" };
    }
    if (joined === "volume ls --filter label=com.docker.compose.project=readwise-local --format {{.Name}}") {
      return { status: 0, stdout: "" };
    }
    if (joined === "container inspect readwise-local-postgres-1 --format {{.Name}}") {
      return { status: 1, stdout: "", stderr: "missing" };
    }
    if (joined === "container inspect readwise-local-redis-1 --format {{.Name}}") {
      return { status: 1, stdout: "", stderr: "missing" };
    }
    if (joined === "volume inspect readwise-local_readwise-postgres-data --format {{.Name}}") {
      return { status: 0, stdout: "readwise-local_readwise-postgres-data\n" };
    }
    if (joined === "volume inspect readwise-local_readwise-postgres-data --format {{json .Labels}}") {
      return { status: 0, stdout: JSON.stringify({ "com.docker.compose.volume": "readwise-postgres-data" }) };
    }
    return { status: 0, stdout: "", stderr: "" };
  };

  assert.throws(
    () => localDb.assertResetTargetsAreReadWiseLocal(localDb.dockerEnv()),
    /does not carry com\.docker\.compose\.project=readwise-local/,
  );
});
