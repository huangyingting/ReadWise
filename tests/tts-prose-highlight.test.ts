import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { buildProseWordMap } from "@/components/reader/wordLookup/useTtsProseHighlight";

function installDom(html: string): Document {
  const { document, window } = parseHTML(html);
  Object.assign(globalThis, {
    document,
    NodeFilter: window.NodeFilter ?? { SHOW_TEXT: 4 },
  });
  return document;
}

function rangeText(container: HTMLElement, word: NonNullable<ReturnType<typeof buildProseWordMap>[number]>): string {
  if (word.startNode === word.endNode) {
    return word.startNode.textContent?.slice(word.start, word.end) ?? "";
  }

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  let collecting = false;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node as Text;
    const content = text.textContent ?? "";
    if (text === word.startNode) {
      collecting = true;
      parts.push(content.slice(word.start));
      continue;
    }
    if (text === word.endNode) {
      parts.push(content.slice(0, word.end));
      break;
    }
    if (collecting) {
      parts.push(content);
    }
  }
  return parts.join("");
}

test("buildProseWordMap anchors enriched text offsets without sequence alignment", () => {
  const document = installDom(
    `<div id="prose"><p>Hello<strong>world</strong> , again.</p><span class="sr-only">hidden</span></div>`,
  );
  const prose = document.getElementById("prose") as HTMLElement;
  const words = [
    { word: "Hello", offset: 0, duration: 100, textOffset: 0, wordLength: 5 },
    { word: "world", offset: 100, duration: 100, textOffset: 6, wordLength: 5 },
    { word: "again", offset: 200, duration: 100, textOffset: 13, wordLength: 5 },
  ];

  const map = buildProseWordMap(prose, words, "Hello world, again.");

  assert.equal(rangeText(prose, map[0]!), "Hello");
  assert.equal(rangeText(prose, map[1]!), "world");
  assert.equal(rangeText(prose, map[2]!), "again");
});

test("buildProseWordMap falls back to token alignment for legacy words", () => {
  const document = installDom(`<div id="prose">Japan's growth won 1st Place.</div>`);
  const prose = document.getElementById("prose") as HTMLElement;

  const map = buildProseWordMap(
    prose,
    [{ word: "Japan" }, { word: "growth" }, { word: "1st Place" }],
    "Japan's growth won 1st Place.",
  );

  assert.equal(rangeText(prose, map[0]!), "Japan's");
  assert.equal(rangeText(prose, map[1]!), "growth");
  assert.equal(rangeText(prose, map[2]!), "1st Place");
});
