import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  beginRender,
  getHookRef,
  installDom,
  resetHookStorage,
  runCleanups,
} from "./support/react-hook-harness";

describe("TTS prose highlight behavior", () => {
  type ProseWordForTest = {
    startNode: Text;
    start: number;
    endNode: Text;
    end: number;
  };

  function rangeText(
    container: HTMLElement,
    word: ProseWordForTest,
  ): string {
    if (word.startNode === word.endNode) {
      return word.startNode.textContent?.slice(word.start, word.end) ?? "";
    }
    const parts: string[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
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
      if (collecting) parts.push(content);
    }
    return parts.join("");
  }

  function audio(overrides: Record<string, unknown> = {}) {
    return {
      activeIndex: -1,
      listenActive: false,
      plainText: "",
      words: [],
      ...overrides,
    } as never;
  }

  function installCssHighlightEnvironment(rects: Array<{ top: number; bottom: number }> = []) {
    const registry = {
      deleted: [] as string[],
      setCalls: [] as Array<{ key: string; value: unknown }>,
      delete(key: string) {
        this.deleted.push(key);
      },
      set(key: string, value: unknown) {
        this.setCalls.push({ key, value });
      },
    };

    class FakeRange {
      static throwOnSet = false;

      setStart() {
        if (FakeRange.throwOnSet) throw new Error("bad start");
      }

      setEnd() {
        if (FakeRange.throwOnSet) throw new Error("bad end");
      }

      getClientRects() {
        return rects;
      }
    }

    class FakeHighlight {
      readonly range: unknown;

      constructor(range: unknown) {
        this.range = range;
      }
    }

    Object.assign(globalThis, {
      CSS: { highlights: registry },
      Highlight: FakeHighlight,
      Range: FakeRange,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 1000,
      configurable: true,
    });

    return { FakeRange, registry };
  }

  test("buildProseWordMap falls back when offset text mismatches or spans exceed text", async () => {
    const { buildProseWordMap } = await import(
      "@/components/reader/wordLookup/useTtsProseHighlight"
    );
    const document = installDom("<div id='prose'>Hello world</div>");
    const prose = document.getElementById("prose") as HTMLElement;

    const mismatch = buildProseWordMap(
      prose,
      [{ word: "Hello", textStart: 0, textEnd: 5 }],
      "Hxllo world",
    );
    const outOfRange = buildProseWordMap(
      prose,
      [{ word: "world", textStart: 6, textEnd: 99 }],
      "Hello world",
    );

    assert.equal(rangeText(prose, mismatch[0]!), "Hello");
    assert.equal(rangeText(prose, outOfRange[0]!), "world");
    assert.deepEqual(buildProseWordMap(prose, [], "Hello world"), []);
  });

  test("clears map without prose or words and exits when CSS highlights are unavailable", async () => {
    const { useTtsProseHighlight } = await import(
      "@/components/reader/wordLookup/useTtsProseHighlight"
    );

    beginRender();
    useTtsProseHighlight({ current: null }, audio({ words: [] }), []);

    assert.deepEqual(getHookRef<unknown[]>(0)?.current, []);
  });

  test("deletes stale CSS highlights for inactive or unmapped active words", async () => {
    const { useTtsProseHighlight } = await import(
      "@/components/reader/wordLookup/useTtsProseHighlight"
    );
    const document = installDom("<div id='prose'>Hello</div>");
    const prose = document.getElementById("prose") as HTMLElement;
    const { registry } = installCssHighlightEnvironment();

    beginRender();
    useTtsProseHighlight(
      { current: prose },
      audio({
        activeIndex: -1,
        plainText: "Hello",
        words: [{ word: "Hello", textStart: 0, textEnd: 5 }],
      }),
      [],
    );
    assert.deepEqual(registry.deleted, ["tts-active"]);

    resetHookStorage();
    const second = installCssHighlightEnvironment();
    beginRender();
    useTtsProseHighlight(
      { current: prose },
      audio({
        activeIndex: 0,
        plainText: "Hello",
        words: [{ word: "Missing" }],
      }),
      [],
    );
    assert.deepEqual(second.registry.deleted, ["tts-active"]);
  });

  test("deletes CSS highlight when Range construction fails", async () => {
    const { useTtsProseHighlight } = await import(
      "@/components/reader/wordLookup/useTtsProseHighlight"
    );
    const document = installDom("<div id='prose'>Hello</div>");
    const prose = document.getElementById("prose") as HTMLElement;
    const { FakeRange, registry } = installCssHighlightEnvironment();
    FakeRange.throwOnSet = true;

    beginRender();
    useTtsProseHighlight(
      { current: prose },
      audio({
        activeIndex: 0,
        plainText: "Hello",
        words: [{ word: "Hello", textStart: 0, textEnd: 5 }],
      }),
      [],
    );

    assert.deepEqual(registry.deleted, ["tts-active"]);
  });

  test("sets the active CSS highlight, scrolls while listening, and cleans up", async () => {
    const { useTtsProseHighlight } = await import(
      "@/components/reader/wordLookup/useTtsProseHighlight"
    );
    const document = installDom("<div id='prose'>Hello</div>");
    const prose = document.getElementById("prose") as HTMLElement & {
      scrollIntoView?: (options: ScrollIntoViewOptions) => void;
    };
    let scrollOptions: ScrollIntoViewOptions | null = null;
    prose.scrollIntoView = (options) => {
      scrollOptions = typeof options === "object" ? options : null;
    };
    const { registry } = installCssHighlightEnvironment([
      { top: 10, bottom: 40 },
    ]);

    beginRender();
    useTtsProseHighlight(
      { current: prose },
      audio({
        activeIndex: 0,
        listenActive: true,
        plainText: "Hello",
        words: [{ word: "Hello", textStart: 0, textEnd: 5 }],
      }),
      [],
    );
    runCleanups();

    assert.equal(registry.setCalls[0]?.key, "tts-active");
    assert.deepEqual(scrollOptions, { behavior: "smooth", block: "center" });
    assert.deepEqual(registry.deleted, ["tts-active"]);
  });
});
