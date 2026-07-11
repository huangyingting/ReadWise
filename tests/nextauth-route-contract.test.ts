process.env.LOG_LEVEL = "error";

import { before, mock, test } from "node:test";
import assert from "node:assert/strict";

let nextAuthCalls: Array<unknown> = [];

before(() => {
  mock.module("next-auth", {
    defaultExport: (options: unknown) => {
      nextAuthCalls.push(options);
      return async (request: Request) => {
        const method = request.method;
        return new Response(JSON.stringify({ ok: true, method }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };
    },
  });

  mock.module("@/lib/auth/config", {
    namedExports: {
      authOptions: { providers: ["fixture"] },
    },
  });
});

test("nextauth catch-all route exports GET/POST handlers from NextAuth(authOptions)", async () => {
  const route = await import("@/app/api/auth/[...nextauth]/route");

  assert.equal(nextAuthCalls.length, 1);
  assert.deepEqual(nextAuthCalls[0], { providers: ["fixture"] });

  assert.equal(route.GET, route.POST);

  const getRes = await route.GET(new Request("http://test/api/auth/nextauth", { method: "GET" }));
  const postRes = await route.POST(new Request("http://test/api/auth/nextauth", { method: "POST" }));

  assert.equal(getRes.status, 200);
  assert.equal(postRes.status, 200);
  assert.deepEqual(await getRes.json(), { ok: true, method: "GET" });
  assert.deepEqual(await postRes.json(), { ok: true, method: "POST" });
});
