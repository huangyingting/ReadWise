import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import type { Highlight } from "@/components/ReaderHighlightsProvider";
import { synchronizeReaderTextMap } from "@/components/reader/wordLookup/useReaderTextMap";

function installDom(html: string): Document {
  const { document, window } = parseHTML(html);
  const textPrototype = Object.getPrototypeOf(document.createTextNode("x")) as {
    splitText?: (offset: number) => Text;
  };
  if (typeof textPrototype.splitText !== "function") {
    Object.defineProperty(textPrototype, "splitText", {
      configurable: true,
      value(this: Text, offset: number) {
        const content = this.textContent ?? "";
        this.textContent = content.slice(0, offset);
        const next = document.createTextNode(content.slice(offset));
        this.parentNode?.insertBefore(next, this.nextSibling);
        return next;
      },
    });
  }
  Object.assign(globalThis, {
    document,
    NodeFilter: window.NodeFilter ?? { SHOW_TEXT: 4 },
  });
  return document;
}

test("synchronizes Narration ranges against text nodes created by persistent marks", () => {
  const document = installDom('<div id="prose">Hello world</div>');
  const prose = document.getElementById("prose") as HTMLElement;
  const highlight: Highlight = {
    id: "hl-1",
    quote: "Hello",
    startOffset: 0,
    endOffset: 5,
    prefix: "",
    suffix: " world",
    note: "Remember this",
    color: "yellow",
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
  };

  const map = synchronizeReaderTextMap(
    prose,
    [highlight],
    () => assert.fail("highlight should remain anchored"),
    [
      { word: "Hello", textStart: 0, textEnd: 5 },
      { word: "world", textStart: 6, textEnd: 11 },
    ],
    "Hello world",
  );

  assert.equal(prose.querySelector("mark.rw-hl")?.textContent, "Hello");
  assert.equal(
    prose.querySelector("mark.rw-hl")?.getAttribute("aria-description"),
    "Has note",
  );
  assert.equal(prose.textContent, "Hello world");
  assert.equal(prose.contains(map[0]!.startNode), true);
  assert.equal(prose.contains(map[1]!.startNode), true);
  assert.equal(map[0]!.startNode.textContent?.slice(map[0]!.start, map[0]!.end), "Hello");
  assert.equal(map[1]!.startNode.textContent?.slice(map[1]!.start, map[1]!.end), "world");
});