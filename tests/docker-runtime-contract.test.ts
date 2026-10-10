import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const operationsDockerfile = readFileSync(
  new URL("../Dockerfile.ops", import.meta.url),
  "utf8",
);
const dockerignore = readFileSync(new URL("../.dockerignore", import.meta.url), "utf8");
const workerEntrypoint = readFileSync(
  new URL("../docker-worker-entrypoint.sh", import.meta.url),
  "utf8",
);
const ciWorkflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
const deployWorkflow = readFileSync(
  new URL("../.github/workflows/deploy-vm.yml", import.meta.url),
  "utf8",
);

const ALPINE_NODE_STAGE =
  /FROM node:24\.18\.1-alpine@sha256:[a-f0-9]{64} AS /;

test("Dockerfile exposes a non-root worker target with production CLI sources", () => {
  assert.match(dockerfile, new RegExp(`${ALPINE_NODE_STAGE.source}worker`));
  assert.match(dockerfile, /npm prune --omit=dev --ignore-scripts/);
  assert.match(dockerfile, /COPY --from=build .*\/app\/src \.\/src/);
  assert.match(dockerfile, /COPY --from=build .*\/app\/scripts \.\/scripts/);
  assert.match(dockerfile, /ENTRYPOINT \["\.\/docker-worker-entrypoint\.sh"\]/);
  assert.match(dockerfile, /CMD \["npm", "run", "worker"\]/);

  const workerStart = dockerfile.indexOf(" AS worker");
  const runnerStart = dockerfile.indexOf(" AS runner");
  assert.ok(workerStart >= 0 && runnerStart > workerStart, "web runner must remain the default final target");
  const workerStage = dockerfile.slice(workerStart, runnerStart);
  assert.match(workerStage, /USER nextjs/);
  assert.match(workerStage, /mkdir -p \/app\/\.media/);
});

test("dependency install includes the module imported by Prisma config", () => {
  const depsStart = dockerfile.indexOf(" AS deps");
  const buildStart = dockerfile.indexOf(" AS build");
  assert.ok(depsStart >= 0 && buildStart > depsStart);
  const depsStage = dockerfile.slice(depsStart, buildStart);
  assert.match(
    depsStage,
    /COPY src\/lib\/database-provider-policy\.mjs \.\/src\/lib\/database-provider-policy\.mjs/,
  );
});

test("application build uses a provider-aligned non-secret database placeholder", () => {
  const buildStart = dockerfile.indexOf(" AS build");
  const productionDepsStart = dockerfile.indexOf("FROM deps AS production-deps");
  assert.ok(buildStart >= 0 && productionDepsStart > buildStart);
  const buildStage = dockerfile.slice(buildStart, productionDepsStart);

  assert.match(buildStage, /prisma\/postgresql\/schema\.prisma\).*postgresql:\/\//s);
  assert.match(buildStage, /prisma\/schema\.prisma\).*file:\.\/dev\.db/s);
  assert.match(buildStage, /DATABASE_URL="\$BUILD_DATABASE_URL" npm run build/);
});

test("worker entrypoint validates schema pairing and execs the requested command", () => {
  assert.match(workerEntrypoint, /set -e/);
  assert.match(workerEntrypoint, /validate-database-schema-config\.mjs/);
  assert.match(workerEntrypoint, /exec "\$@"/);
  assert.doesNotMatch(workerEntrypoint, /migrate deploy/);
});

test("web runner creates a writable local-media fallback before dropping privileges", () => {
  const runnerStart = dockerfile.indexOf(" AS runner");
  const runnerStage = dockerfile.slice(runnerStart);
  assert.match(runnerStage, /mkdir -p \/app\/\.media/);
  assert.match(runnerStage, /chown nextjs:nodejs \/app\/\.media/);
  assert.match(
    runnerStage,
    /COPY --from=build .*\/app\/src\/lib\/database-provider-policy\.mjs \.\/src\/lib\/database-provider-policy\.mjs/,
  );
  assert.match(runnerStage, /COPY --from=build .*\/app\/public \.\/public/);
  assert.match(runnerStage, /HEALTHCHECK .*api\/ready/s);
  assert.match(runnerStage, /validate-database-schema-config\.mjs/);
  assert.match(runnerStage, /USER nextjs/);
  assert.doesNotMatch(runnerStage, /COPY --from=production-deps/);
  assert.doesNotMatch(runnerStage, /migrate deploy/);
});

test("operations image owns PostgreSQL migrations outside the web runtime", () => {
  assert.match(operationsDockerfile, ALPINE_NODE_STAGE);
  assert.match(operationsDockerfile, /COPY ops\/package\.json ops\/package-lock\.json/);
  assert.match(operationsDockerfile, /npm ci --omit=dev --ignore-scripts/);
  assert.match(operationsDockerfile, /prisma\/postgresql\/schema\.prisma/);
  assert.match(operationsDockerfile, /USER node/);
  assert.doesNotMatch(operationsDockerfile, /COPY package\.json package-lock\.json/);
});

test("Docker context excludes local database and scraper artifacts", () => {
  const ignoredPaths = new Set(
    dockerignore
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#")),
  );

  for (const privateOrGeneratedPath of [
    ".media",
    ".next-e2e",
    ".scraper-state",
    ".translation-lab",
    "backups",
    "prisma/provider-dbs",
    "provider-db-translations",
  ]) {
    assert.ok(
      ignoredPaths.has(privateOrGeneratedPath),
      `${privateOrGeneratedPath} must not enter the Docker build context`,
    );
  }
});

test("CI builds all PostgreSQL production image targets as a required gate", () => {
  assert.match(ciWorkflow, /^  container-builds:\s*$/m);
  assert.match(
    ciWorkflow,
    /docker build --target runner --build-arg PRISMA_SCHEMA_PATH=prisma\/postgresql\/schema\.prisma/,
  );
  assert.match(
    ciWorkflow,
    /docker build --target worker --build-arg PRISMA_SCHEMA_PATH=prisma\/postgresql\/schema\.prisma/,
  );
  assert.match(
    ciWorkflow,
    /docker build --file Dockerfile\.ops --tag readwise-ci-ops:postgres/,
  );
  assert.match(ciWorkflow, /test ! -e node_modules\/prisma\/build\/index\.js/);
  assert.match(ciWorkflow, /needs: \[[^\]]*container-builds[^\]]*\]/);
});

test("VM deployment follows the pinned WebStack PostgreSQL release contract", () => {
  assert.match(
    deployWorkflow,
    /uses: huangyingting\/webstack\/\.github\/workflows\/webstack-deploy\.yml@v1\.0\.0/,
  );
  assert.match(deployWorkflow, /app_domain: readwise\.genisisiq\.com/);
  assert.match(deployWorkflow, /host_port: 10005/);
  assert.match(deployWorkflow, /operations_dockerfile: Dockerfile\.ops/);
  assert.match(
    deployWorkflow,
    /migrate deploy --schema prisma\/postgresql\/schema\.prisma/,
  );
  assert.match(deployWorkflow, /release_env_var: APP_VERSION/);
  assert.match(
    deployWorkflow,
    /database_url_query: schema=public&sslmode=require&uselibpqcompat=true/,
  );
});

test("CI database coverage installs native dependencies before SQLite tests", () => {
  const dbIntegrationStart = ciWorkflow.indexOf("  db-integration:");
  const supplyChainStart = ciWorkflow.indexOf("  supply-chain:", dbIntegrationStart);
  assert.ok(dbIntegrationStart >= 0 && supplyChainStart > dbIntegrationStart);

  const dbIntegrationJob = ciWorkflow.slice(dbIntegrationStart, supplyChainStart);
  assert.match(dbIntegrationJob, /run: npm ci\s*$/m);
  assert.doesNotMatch(dbIntegrationJob, /npm ci --ignore-scripts/);
});
