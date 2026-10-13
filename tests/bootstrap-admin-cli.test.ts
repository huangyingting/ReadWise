/**
 * `npm run bootstrap:admin` CLI: argument validation, help, and a password
 * read only from standard input (never from argv or printed output).
 */
import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

let stdinReads: unknown[] = [];
let bootstrapCalls: Array<Record<string, unknown>> = [];

before(() => {
  mock.module("node:fs", {
    namedExports: {
      readFileSync: (fd: unknown, encoding: unknown) => {
        stdinReads.push([fd, encoding]);
        return "correct horse battery staple\n";
      },
    },
  });
  mock.module("@/lib/auth/bootstrap", {
    namedExports: {
      bootstrapAdmin: async (input: Record<string, unknown>) => {
        bootstrapCalls.push(input);
        return { id: "admin-1" };
      },
    },
  });
});

beforeEach(() => {
  stdinReads = [];
  bootstrapCalls = [];
});

function capture() {
  const logs: string[] = [];
  const errors: string[] = [];
  return { logs, errors, io: { log: (m: string) => logs.push(m), error: (m: string) => errors.push(m) } };
}

test("bootstrap admin CLI prints help without touching the database", async () => {
  const { bootstrapAdminMain } = await import("../scripts/bootstrap-admin");
  const { logs, io } = capture();

  assert.equal(await bootstrapAdminMain(["--help"], io), 0);
  assert.match(logs[0] ?? "", /--password-stdin/);
  assert.deepEqual(bootstrapCalls, []);
});

test("bootstrap admin CLI requires an email and a stdin password", async () => {
  const { bootstrapAdminMain } = await import("../scripts/bootstrap-admin");

  for (const argv of [["--password-stdin"], ["--email", "admin@example.test"], ["--email", "  ", "--password-stdin"]]) {
    const { errors, io } = capture();
    assert.equal(await bootstrapAdminMain(argv, io), 2);
    assert.match(errors[0] ?? "", /--email <email> and --password-stdin are required/);
  }
  assert.deepEqual(stdinReads, []);
  assert.deepEqual(bootstrapCalls, []);
});

test("bootstrap admin CLI reads the password from stdin and reports only the user id", async () => {
  const { bootstrapAdminMain } = await import("../scripts/bootstrap-admin");
  const { logs, io } = capture();

  const code = await bootstrapAdminMain(
    ["--email", " admin@example.test ", "--password-stdin", "--name", "Ops Admin"],
    io,
  );

  assert.equal(code, 0);
  assert.deepEqual(stdinReads, [[0, "utf8"]]);
  assert.deepEqual(bootstrapCalls, [
    { email: "admin@example.test", password: "correct horse battery staple", name: "Ops Admin" },
  ]);
  assert.deepEqual(logs, [JSON.stringify({ ok: true, userId: "admin-1" })]);
  assert.equal(logs.join("").includes("correct horse"), false);
});

test("bootstrap admin CLI accepts an injected password reader", async () => {
  const { bootstrapAdminMain } = await import("../scripts/bootstrap-admin");
  const { io } = capture();

  await bootstrapAdminMain(["--email", "admin@example.test", "--password-stdin"], {
    ...io,
    readPassword: () => "injected secure password",
  });

  assert.deepEqual(stdinReads, []);
  assert.equal(bootstrapCalls[0]?.password, "injected secure password");
  assert.equal(bootstrapCalls[0]?.name, null);
});
