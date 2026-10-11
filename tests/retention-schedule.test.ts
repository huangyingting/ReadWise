import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/retention-maintenance.yml", import.meta.url),
  "utf8",
);
const deploymentWorkflow = readFileSync(
  new URL("../.github/workflows/deploy-vm.yml", import.meta.url),
  "utf8",
);

test("retention workflow executes daily and keeps manual runs dry by default", () => {
  assert.match(workflow, /cron: "47 3 \* \* \*"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /dry_run:[\s\S]*default: true/);
  assert.match(workflow, /RETENTION_MAINTENANCE_ENABLED/);
  assert.match(workflow, /RETENTION_MAINTENANCE_URL/);
  assert.match(workflow, /RETENTION_WORKER_SECRET/);
  assert.match(workflow, /Authorization: Bearer \$\{RETENTION_SECRET\}/);
});

test("deployment forwards the retention worker secret to the application", () => {
  assert.match(
    deploymentWorkflow,
    /RETENTION_WORKER_SECRET=\{0\}[\s\S]*secrets\.RETENTION_WORKER_SECRET/,
  );
});
