/**
 * Unit tests for the scraper declutter pass.
 *
 * The declutter pass runs on already-extracted article HTML and removes the
 * residual boilerplate that a generic extractor (Readability / @extractus)
 * leaves behind — above all the trailing author byline/bio paragraph, plus
 * related/newsletter/share/comments widgets and high-link-density noise.
 *
 * linkedom provides the DOM, so no browser globals are required here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { declutterArticleHtml } from "@/lib/scraper/declutter";

/** Three substantial body paragraphs that must always survive decluttering. */
const BODY = [
  `<p>Deep reading is a practice that trains focus and builds comprehension far beyond surface-level skimming and the passive consumption of media.</p>`,
  `<p>Cognitive science shows that sustained reading of long-form text strengthens neural pathways associated with empathy and critical thinking over time.</p>`,
  `<p>Practitioners recommend starting with twenty minutes of uninterrupted reading and gradually increasing the duration as focus capacity grows steadily.</p>`,
].join("\n");

function assertBodyIntact(out: string): void {
  assert.ok(out.includes("Deep reading is a practice"), "first body paragraph kept");
  assert.ok(out.includes("Cognitive science"), "second body paragraph kept");
  assert.ok(out.includes("Practitioners recommend"), "third body paragraph kept");
}

test("removes a trailing author byline/bio paragraph (pattern path)", () => {
  const html =
    BODY +
    `\n<p>By Jane Doe. Jane is a senior writer at Example covering science. Follow @jane.</p>`;
  const out = declutterArticleHtml(html);

  assert.ok(!out.includes("Jane Doe"), "byline paragraph removed");
  assert.ok(!out.includes("senior writer"), "bio sentence removed");
  assertBodyIntact(out);
});

test("removes a trailing byline using the byline name hint", () => {
  // No leading "By", so only the name hint can identify this as the author block.
  const html =
    BODY + `\n<p>Jane Doe reports on science and society from Berlin.</p>`;
  const out = declutterArticleHtml(html, { byline: "Jane Doe" });

  assert.ok(!out.includes("Jane Doe"), "hinted byline removed");
  assertBodyIntact(out);
});

test("authorName hint is honored as an alias of byline", () => {
  const html = BODY + `\n<p>Jane Doe is a reporter based in Berlin.</p>`;
  const out = declutterArticleHtml(html, { authorName: "Jane Doe" });

  assert.ok(!out.includes("Jane Doe"), "authorName-hinted byline removed");
  assertBodyIntact(out);
});

test("removes a 'Related' link-list section", () => {
  const html =
    BODY +
    `<aside class="related"><h3>Related</h3><ul>` +
    `<li><a href="/a">A study on attention</a></li>` +
    `<li><a href="/b">Why we skim</a></li>` +
    `</ul></aside>`;
  const out = declutterArticleHtml(html);

  assert.ok(!out.includes("Related"), "related heading removed");
  assert.ok(!out.includes("A study on attention"), "related links removed");
  assertBodyIntact(out);
});

test("removes a 'more from' label widget even without a boilerplate class", () => {
  const html =
    BODY +
    `<div><h2>More from the magazine</h2><ul>` +
    `<li><a href="/x">Essay one</a></li>` +
    `<li><a href="/y">Essay two</a></li></ul></div>`;
  const out = declutterArticleHtml(html);

  assert.ok(!out.includes("More from"), "label heading removed");
  assert.ok(!out.includes("Essay one"), "trailing link list removed");
  assertBodyIntact(out);
});

test("removes expanded related labels but preserves article video links in prose", () => {
  const html =
    BODY +
    `<p>The team published a companion <a href="https://videos.example.com/documentary">video interview</a> explaining the field work in more detail.</p>` +
    `<div><h2>Also read</h2><ul>` +
    `<li><a href="/x">Related essay one</a></li>` +
    `<li><a href="/y">Related essay two</a></li></ul></div>` +
    `<p>Get the latest stories in your inbox.</p>`;
  const out = declutterArticleHtml(html);

  assert.ok(out.includes("video interview"), "article-related video link text kept");
  assert.ok(out.includes("https://videos.example.com/documentary"), "video link href kept");
  assert.ok(!out.includes("Also read"), "related label removed");
  assert.ok(!out.includes("Related essay one"), "related list removed");
  assert.ok(!out.includes("latest stories in your inbox"), "newsletter-like CTA removed");
  assertBodyIntact(out);
});

test("removes a newsletter / subscribe CTA block", () => {
  const html =
    BODY +
    `<div class="newsletter-cta"><p>Subscribe to our weekly newsletter for more stories like this.</p></div>`;
  const out = declutterArticleHtml(html);

  assert.ok(!out.includes("Subscribe"), "newsletter CTA removed");
  assertBodyIntact(out);
});

test("removes a share / social buttons block", () => {
  const html =
    BODY +
    `<div class="social share"><a href="#">Share on X</a><a href="#">Share on Facebook</a></div>`;
  const out = declutterArticleHtml(html);

  assert.ok(!out.includes("Share on X"), "share block removed");
  assertBodyIntact(out);
});

test("removes a high-link-density list but keeps a paragraph with one link", () => {
  const html =
    `<p>You can read the full underlying study <a href="/study">here</a> for a detailed look at the methods used.</p>` +
    BODY +
    `<ul>` +
    `<li><a href="/1">Story one headline goes here</a></li>` +
    `<li><a href="/2">Story two headline goes here</a></li>` +
    `<li><a href="/3">Story three headline goes here</a></li>` +
    `</ul>`;
  const out = declutterArticleHtml(html);

  assert.ok(!out.includes("Story one headline"), "link-dense list removed");
  assert.ok(out.includes("full underlying study"), "single-link paragraph kept");
  assert.ok(out.includes('href="/study"'), "the legitimate inline link is kept");
  assertBodyIntact(out);
});

test("keeps a legitimate mid-article paragraph that merely contains 'by'", () => {
  const html =
    `<p>The manuscript was written by hand over many years before printing presses existed widely in europe.</p>` +
    BODY +
    `<p>By Jane Doe. Jane is a staff writer at Example.</p>`;
  const out = declutterArticleHtml(html);

  assert.ok(out.includes("written by hand"), "mid-article 'by' paragraph kept");
  assert.ok(!out.includes("Jane Doe"), "actual trailing byline still removed");
  assertBodyIntact(out);
});

test("conservative guard: a short byline-like article is not gutted", () => {
  const html = `<p>By Jane Doe</p>`;
  const out = declutterArticleHtml(html, { byline: "Jane Doe" });

  assert.ok(out.trim().length > 0, "short byline-only article is not emptied");
  assert.ok(out.includes("Jane Doe"), "content preserved when removal would gut it");
});

test("is idempotent: declutter(declutter(x)) === declutter(x)", () => {
  const html =
    BODY +
    `<aside class="related"><h3>Related</h3><ul><li><a href="/a">A</a></li><li><a href="/b">B</a></li></ul></aside>` +
    `<p>By Jane Doe. Jane is a senior writer at Example. Follow @jane.</p>`;
  const once = declutterArticleHtml(html);
  const twice = declutterArticleHtml(once);

  assert.equal(twice, once, "second pass produces identical output");
});

// ---------------------------------------------------------------------------
// Class-stripped fixtures: mimic Readability output (NO class/id attributes).
// The attribute detectors can't see these; the text-based detector must.
// ---------------------------------------------------------------------------

test("class-less bio + newsletter as the last two blocks: both removed (with name hint)", () => {
  const html =
    BODY +
    `<p>By Jane Doe. Jane is a senior transportation writer at DailyExample covering cities. Follow her @janedoe.</p>` +
    `<p>Subscribe to our weekly newsletter for more stories like this.</p>`;
  const out = declutterArticleHtml(html, { byline: "Jane Doe" });

  assert.ok(!out.includes("Jane Doe"), "class-less author bio removed");
  assert.ok(!out.includes("transportation writer"), "bio sentence removed");
  assert.ok(!out.includes("Subscribe"), "class-less newsletter CTA removed");
  assertBodyIntact(out);
});

test("class-less bio + newsletter as the last two blocks: both removed (no hint, pattern path)", () => {
  // No byline hint — the bio is caught by the bio pattern, the newsletter by
  // the text-boilerplate detector, even though the CTA sits BELOW the bio.
  const html =
    BODY +
    `<p>By Jane Doe. Jane is a senior transportation writer at DailyExample covering cities. Follow her @janedoe.</p>` +
    `<p>Subscribe to our weekly newsletter for more stories like this.</p>`;
  const out = declutterArticleHtml(html);

  assert.ok(!out.includes("Jane Doe"), "byline removed via pattern");
  assert.ok(!out.includes("transportation writer"), "bio sentence removed");
  assert.ok(!out.includes("Subscribe"), "class-less newsletter CTA removed");
  assertBodyIntact(out);
});

test("a class-less newsletter / subscribe paragraph anywhere is removed", () => {
  const html =
    BODY.split("\n").slice(0, 1).join("") +
    `<p>Sign up for our newsletter to get the latest updates.</p>` +
    BODY.split("\n").slice(1).join("\n");
  const out = declutterArticleHtml(html);

  assert.ok(!out.includes("Sign up for our newsletter"), "class-less CTA removed");
  assertBodyIntact(out);
});

test("keeps legitimate prose about residents signing up for classes", () => {
  const prose =
    `<p>Each semester, hundreds of residents sign up for free classes at the ` +
    `library, where volunteers teach language, computer skills, and gardening.</p>`;
  const html =
    BODY.split("\n").slice(0, 1).join("") +
    prose +
    BODY.split("\n").slice(1).join("\n");
  const out = declutterArticleHtml(html);

  assert.ok(out.includes("residents sign up for free classes"), "ordinary sign-up prose kept");
  assertBodyIntact(out);
});

test("keeps ordinary prose where students also read primary source accounts", () => {
  const prose =
    `<p>The students also read primary source accounts from families who ` +
    `crossed the river during the spring floods and rebuilt nearby farms.</p>`;
  const html =
    BODY.split("\n").slice(0, 1).join("") +
    prose +
    BODY.split("\n").slice(1).join("\n");
  const out = declutterArticleHtml(html);

  assert.ok(out.includes("students also read primary source accounts"), "ordinary also-read prose kept");
  assertBodyIntact(out);
});

test("keeps ordinary prose where residents sign up for emergency alerts", () => {
  const prose =
    `<p>Residents sign up for emergency alerts at the town hall each spring ` +
    `because flood warnings often arrive before phone service becomes unreliable.</p>`;
  const html =
    BODY.split("\n").slice(0, 1).join("") +
    prose +
    BODY.split("\n").slice(1).join("\n");
  const out = declutterArticleHtml(html);

  assert.ok(out.includes("Residents sign up for emergency alerts"), "ordinary emergency-alert prose kept");
  assertBodyIntact(out);
});

test("keeps legitimate prose about scientists getting the latest readings", () => {
  const prose =
    `<p>Scientists get the latest readings from the coastal sensors before ` +
    `comparing the measurements with decades of tidal records.</p>`;
  const html =
    BODY.split("\n").slice(0, 1).join("") +
    prose +
    BODY.split("\n").slice(1).join("\n");
  const out = declutterArticleHtml(html);

  assert.ok(out.includes("Scientists get the latest readings"), "ordinary get-latest prose kept");
  assertBodyIntact(out);
});

test("keeps legitimate prose mentioning a weekly neighborhood newsletter", () => {
  const prose =
    `<p>The weekly neighborhood newsletter documented school meetings, market ` +
    `closures, and volunteer repairs long before the city created an archive.</p>`;
  const html =
    BODY.split("\n").slice(0, 1).join("") +
    prose +
    BODY.split("\n").slice(1).join("\n");
  const out = declutterArticleHtml(html);

  assert.ok(out.includes("weekly neighborhood newsletter"), "ordinary newsletter prose kept");
  assertBodyIntact(out);
});

test("keeps latest-newsletter prose that is not an inbox CTA", () => {
  const prose =
    `<p>The latest newsletter documented school meetings, cafeteria changes, ` +
    `and repairs to the gym before the district posted minutes online.</p>`;
  const html =
    BODY.split("\n").slice(0, 1).join("") +
    prose +
    BODY.split("\n").slice(1).join("\n");
  const out = declutterArticleHtml(html);

  assert.ok(out.includes("The latest newsletter documented"), "ordinary latest-newsletter prose kept");
  assertBodyIntact(out);
});

test("keeps ordinary prose about an actual delivered newsletter", () => {
  const prose =
    `<p>The newsletter is delivered every Tuesday with city updates, school ` +
    `board notes, and a calendar of public meetings for residents.</p>`;
  const html =
    BODY.split("\n").slice(0, 1).join("") +
    prose +
    BODY.split("\n").slice(1).join("\n");
  const out = declutterArticleHtml(html);

  assert.ok(out.includes("newsletter is delivered every Tuesday"), "ordinary delivered-newsletter prose kept");
  assertBodyIntact(out);
});

test("removes duplicated-candidate newsletter CTA in a shorter article", () => {
  const cta =
    `<p class="newsletter-cta">Get the latest newsletters delivered directly ` +
    `to your inbox every Friday with practical reading ideas, local events, ` +
    `selected essays, classroom notes, and archive links.</p>`;
  const html = BODY + cta;
  const out = declutterArticleHtml(html);

  assert.ok(!out.includes("Get the latest newsletters"), "duplicated CTA candidate removed");
  assertBodyIntact(out);
});

test("removes sign-up CTAs when account or promotional context is present", () => {
  const html =
    BODY +
    `<p>Sign up for a free account to save this article.</p>` +
    `<p>Sign up today for subscriber-only deals and discounts.</p>`;
  const out = declutterArticleHtml(html);

  assert.ok(!out.includes("free account"), "account sign-up CTA removed");
  assert.ok(!out.includes("subscriber-only deals"), "promotional sign-up CTA removed");
  assertBodyIntact(out);
});

test("guard: a long body paragraph that merely contains 'subscribe' is KEPT", () => {
  const longPara =
    `<p>Readers who want to subscribe to the underlying dataset can do so through ` +
    `the public portal, but the more important point is that the methodology itself ` +
    `was peer reviewed across several institutions before the figures were released.</p>`;
  const html = BODY + longPara;
  const out = declutterArticleHtml(html);

  assert.ok(out.includes("subscribe to the underlying dataset"), "long prose with 'subscribe' kept");
  assertBodyIntact(out);
});

test("removes longer newsletter preference/signup residue without removing subscribe prose", () => {
  const html =
    BODY +
    `<p>We’re having trouble saving your preferences. Try refreshing this page and updating them one more time. If you continue to get this message, reach out to customer service about newsletters and account preferences.</p>` +
    `<p>SIGN UP FOR NEWSLETTER JOURNEYS: Dive deeper into pressing issues with our limited run newsletters, delivered weekly with hand-picked archive excerpts and updates. ${Array.from({ length: 55 }, () => "archive").join(" ")}</p>` +
    `<p>Researchers can subscribe to the underlying dataset through the public portal after agreeing to the license terms for reproducibility.</p>`;
  const out = declutterArticleHtml(html);

  assert.ok(!out.includes("trouble saving your preferences"), "preference residue removed");
  assert.ok(!out.includes("SIGN UP FOR NEWSLETTER JOURNEYS"), "long newsletter CTA removed");
  assert.ok(out.includes("subscribe to the underlying dataset"), "legitimate subscribe prose kept");
  assertBodyIntact(out);
});

test("removes favicon and newsletter promo images while keeping article media", () => {
  const html =
    `<p>A field camera recorded the owl after dusk. <img src="https://cdn.example.org/favicon.ico" alt="" /></p>` +
    `<figure><img src="https://cdn.example.org/photos/owl-flight.jpg" alt="An owl in flight" /><figcaption>A genuine article photo.</figcaption></figure>` +
    BODY +
    `<hr /><p><img src="https://undark.org/wp-content/uploads/2024/11/compass.png" alt="Newsletter Journeys" /></p><hr />` +
    `<p>The closing paragraph discusses comments about donated clothing, a public comment period, and requests for comment from officials.</p>`;
  const out = declutterArticleHtml(html);

  assert.ok(!out.includes("favicon.ico"), "favicon image removed");
  assert.ok(!out.includes("compass.png"), "newsletter promo image removed");
  assert.ok(!out.includes("Newsletter Journeys"), "promo alt text removed");
  assert.ok(out.includes("owl-flight.jpg"), "article image kept");
  assert.ok(out.includes("A genuine article photo"), "article caption kept");
  assert.ok(out.includes("comments about donated clothing"), "legitimate comments prose kept");
  assert.ok(out.includes("public comment period"), "legitimate public-comment prose kept");
  assert.ok(out.includes("requests for comment"), "legitimate requests-for-comment prose kept");
  assertBodyIntact(out);
});

test("removes trailing publication CTA and newsletter signup residue", () => {
  const html =
    BODY +
    `<p><em>Enjoying </em><a href="https://nautil.us/">Nautilus</a><em>? Subscribe to our free </em><a href="/newsletter"><em>newsletter</em></a>.</p>` +
    `<h3>Stay connected</h3>` +
    `<h2>Get the latest updates from<br />MIT Technology Review</h2>` +
    `<p>Discover special offers, top stories, upcoming events, and more.</p>` +
    `<p>Thank you for submitting your email!</p>` +
    `<p>It looks like something went wrong.</p>`;
  const out = declutterArticleHtml(html);

  assert.ok(!out.includes("Enjoying"), "publication subscribe CTA removed");
  assert.ok(!out.includes("Stay connected"), "signup heading removed");
  assert.ok(!out.includes("latest updates"), "signup title removed");
  assert.ok(!out.includes("special offers"), "signup description removed");
  assert.ok(!out.includes("submitting your email"), "signup success residue removed");
  assert.ok(!out.includes("something went wrong"), "signup error residue removed");
  assertBodyIntact(out);
});

test("removes ranked recirculation item without touching ordinary popular prose", () => {
  const html =
    BODY +
    `<p><strong>10 Grok’s most popular feature? Smut</strong><br />It accounts for a large share of the chatbot’s traffic.</p>` +
    `<p>The exhibit became popular with students after teachers used it to explain voting trends in local history.</p>`;
  const out = declutterArticleHtml(html);

  assert.ok(!out.includes("Grok’s most popular feature"), "ranked recirc item removed");
  assert.ok(out.includes("became popular with students"), "ordinary popular prose kept");
  assertBodyIntact(out);
});

test("returns empty / whitespace-only input unchanged", () => {
  assert.equal(declutterArticleHtml(""), "");
  assert.equal(declutterArticleHtml("   "), "   ");
});

test("does not throw on garbage input and returns a string", () => {
  assert.doesNotThrow(() => declutterArticleHtml("<<>not real html"));
  const out = declutterArticleHtml("<<>not real html");
  assert.equal(typeof out, "string");
  assert.ok(out.includes("not real html"), "text content is preserved");
});

// ---------------------------------------------------------------------------
// Leading credits / author-bio removal (Improvement D)
// ---------------------------------------------------------------------------

test("removes a leading 'Credits … is a researcher at …' block, keeps the lede", () => {
  const html =
    `<p>Credits Houda Nait El Barj is a researcher at OpenAI working on alignment.</p>\n` +
    BODY;
  const out = declutterArticleHtml(html, { authorName: "Houda Nait El Barj" });

  assert.ok(!out.includes("Credits Houda"), "leading credits block removed");
  assert.ok(!out.includes("is a researcher at OpenAI"), "leading bio removed");
  assertBodyIntact(out);
});

test("leading credits removal is idempotent", () => {
  const html =
    `<p>Credits Houda Nait El Barj is a researcher at OpenAI working on alignment.</p>\n` +
    BODY;
  const once = declutterArticleHtml(html, { authorName: "Houda Nait El Barj" });
  const twice = declutterArticleHtml(once, { authorName: "Houda Nait El Barj" });
  assert.equal(twice, once, "declutter(declutter(x)) === declutter(x)");
});

test("does NOT remove a genuine opening paragraph that merely names a person", () => {
  const lede =
    `<p>Maria Santos arrived at the laboratory before dawn, determined to finish the ` +
    `experiment she had spent three long years designing and refining with her team.</p>\n`;
  const html = lede + BODY;
  const out = declutterArticleHtml(html);

  assert.ok(out.includes("Maria Santos arrived at the laboratory"), "real lede kept");
  assertBodyIntact(out);
});
