import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeArticleHtml } from "@/lib/sanitize";

test("drops script/style tags and their content", () => {
  const out = sanitizeArticleHtml(
    "<p>Keep</p><script>alert(1)</script><style>.x{}</style>",
  );
  assert.match(out, /Keep/);
  assert.doesNotMatch(out, /alert/);
  assert.doesNotMatch(out, /\.x\{/);
});

test("removes ad/boilerplate blocks together with their content", () => {
  const out = sanitizeArticleHtml(
    '<div class="advertisement">BUY NOW</div><p>Real content here</p>',
  );
  assert.doesNotMatch(out, /BUY NOW/);
  assert.match(out, /Real content here/);
});

test("strips structural wrappers but preserves inner text", () => {
  const out = sanitizeArticleHtml("<div><span>Hello</span> world</div>");
  assert.doesNotMatch(out, /<div|<span/);
  assert.match(out, /Hello/);
  assert.match(out, /world/);
});

test("preserves safe links and drops unsafe schemes", () => {
  const out = sanitizeArticleHtml('<a href="https://x.com">link</a>');
  assert.match(out, /href="https:\/\/x\.com"/);
  assert.match(out, /link/);

  const js = sanitizeArticleHtml('<a href="javascript:alert(1)">x</a>');
  assert.doesNotMatch(js, /javascript:/);
});

test("disallowed tags are removed, text kept", () => {
  const out = sanitizeArticleHtml("<marquee>Spin</marquee><p>ok</p>");
  assert.doesNotMatch(out, /<marquee/);
  assert.match(out, /Spin/);
  assert.match(out, /<p>ok<\/p>/);
});
