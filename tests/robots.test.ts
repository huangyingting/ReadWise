import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  parseRobots,
  isPathAllowed,
  isUrlAllowed,
  clearRobotsCache,
  ROBOTS_USER_AGENT,
} from "@/lib/scraper/robots";

beforeEach(() => {
  clearRobotsCache();
});

test("parseRobots prefers our product-token group over the wildcard group", () => {
  const text = [
    "User-agent: *",
    "Disallow: /",
    "",
    `User-agent: ${ROBOTS_USER_AGENT}`,
    "Disallow: /private",
    "Allow: /private/ok",
  ].join("\n");
  const rules = parseRobots(text);
  assert.deepEqual(rules.disallow, ["/private"]);
  assert.deepEqual(rules.allow, ["/private/ok"]);
});

test("parseRobots falls back to wildcard rules when no UA group matches", () => {
  const text = ["User-agent: *", "Disallow: /admin"].join("\n");
  const rules = parseRobots(text, "SomeOtherBot");
  assert.deepEqual(rules.disallow, ["/admin"]);
});

test("isPathAllowed applies longest-match with Allow winning ties", () => {
  const rules = { disallow: ["/news"], allow: ["/news/sports"] };
  assert.equal(isPathAllowed(rules, "/news/politics"), false);
  assert.equal(isPathAllowed(rules, "/news/sports/article"), true);
  assert.equal(isPathAllowed(rules, "/about"), true);
});

test("isPathAllowed supports wildcards and end-anchors", () => {
  assert.equal(isPathAllowed({ disallow: ["/*.pdf$"], allow: [] }, "/files/report.pdf"), false);
  assert.equal(isPathAllowed({ disallow: ["/*.pdf$"], allow: [] }, "/files/report.pdf?x=1"), true);
  assert.equal(isPathAllowed({ disallow: ["/p/*/edit"], allow: [] }, "/p/123/edit"), false);
});

test("isUrlAllowed is fail-open when robots.txt is unreachable", async () => {
  const allowed = await isUrlAllowed("https://example.com/anything", {
    fetchText: async () => {
      throw new Error("network down");
    },
  });
  assert.equal(allowed, true);
});

test("isUrlAllowed honors a Disallow rule", async () => {
  const robots = `User-agent: *\nDisallow: /secret`;
  const allowed = await isUrlAllowed("https://example.com/secret/page", {
    fetchText: async () => robots,
  });
  assert.equal(allowed, false);
  const ok = await isUrlAllowed("https://example.com/public/page", {
    fetchText: async () => robots,
  });
  assert.equal(ok, true);
});

test("isUrlAllowed rejects non-http(s) and invalid URLs", async () => {
  assert.equal(await isUrlAllowed("ftp://example.com/x"), false);
  assert.equal(await isUrlAllowed("not a url"), false);
});

test("isUrlAllowed caches robots.txt per origin", async () => {
  let fetches = 0;
  const deps = {
    fetchText: async () => {
      fetches += 1;
      return "User-agent: *\nDisallow: /x";
    },
  };
  await isUrlAllowed("https://example.com/a", deps);
  await isUrlAllowed("https://example.com/b", deps);
  assert.equal(fetches, 1);
});
