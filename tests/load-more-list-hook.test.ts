import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  article,
  beginRender,
  flushAsyncWork,
  resetHookStorage,
} from "./support/react-hook-harness";

describe("useLoadMoreList hook behavior", () => {
  test("loads a page, deduplicates articles, merges progress, and notifies caller", async () => {
    const { useLoadMoreList } = await import("@/hooks/useLoadMoreList");
    const loaded: Array<{ page: unknown; ids: string[] }> = [];

    const fetchPage = async (offset: number) => {
      assert.equal(offset, 2);
      return {
        articles: [article("b"), article("c")],
        progress: { c: { readPercent: 50 } },
        offset: 4,
        hasMore: false,
      };
    };

    function useRenderLoadMoreList() {
      beginRender();
      return useLoadMoreList({
        initialArticles: [article("a"), article("b")] as never,
        initialProgress: { a: { readPercent: 10 } } as never,
        initialHasMore: true,
        initialOffset: 2,
        fetchPage: fetchPage as never,
        onPageLoaded: (page, newArticles) => {
          loaded.push({
            page,
            ids: newArticles.map((item) => item.id),
          });
        },
      });
    }

    useRenderLoadMoreList().loadMore();
    await flushAsyncWork();
    const after = useRenderLoadMoreList();

    assert.deepEqual(
      after.articles.map((item) => item.id),
      ["a", "b", "c"],
    );
    assert.deepEqual(Object.keys(after.progress).sort(), ["a", "c"]);
    assert.equal(after.hasMore, false);
    assert.equal(after.loading, false);
    assert.equal(after.loadError, null);
    assert.deepEqual(loaded[0]?.ids, ["b", "c"]);
  });

  test("does not fetch while loading or when no more pages are available", async () => {
    const { useLoadMoreList } = await import("@/hooks/useLoadMoreList");
    let calls = 0;
    let resolvePage: (page: { articles?: never[]; hasMore?: boolean }) => void =
      () => {};

    beginRender();
    const noMore = useLoadMoreList({
      initialArticles: [],
      initialProgress: {},
      initialHasMore: false,
      initialOffset: 0,
      fetchPage: (async () => {
        calls++;
        return {};
      }) as never,
    });
    noMore.loadMore();
    assert.equal(calls, 0);

    resetHookStorage();
    beginRender();
    const loading = useLoadMoreList({
      initialArticles: [article("a")] as never,
      initialProgress: {},
      initialHasMore: true,
      initialOffset: 1,
      fetchPage: (() => {
        calls++;
        return new Promise((resolve) => {
          resolvePage = resolve;
        });
      }) as never,
    });

    loading.loadMore();
    loading.loadMore();
    assert.equal(calls, 1);

    resolvePage({});
    await flushAsyncWork();
    beginRender();
    const after = useLoadMoreList({
      initialArticles: [] as never,
      initialProgress: {},
      initialHasMore: true,
      initialOffset: 1,
      fetchPage: (async () => ({})) as never,
    });
    assert.equal(after.hasMore, false);
    assert.equal(after.loading, false);
  });

  test("surfaces the configured error message after a failed page load", async () => {
    const { useLoadMoreList } = await import("@/hooks/useLoadMoreList");

    function useRenderLoadMoreList() {
      beginRender();
      return useLoadMoreList({
        initialArticles: [],
        initialProgress: {},
        initialHasMore: true,
        initialOffset: 0,
        fetchPage: (async () => {
          throw new Error("network");
        }) as never,
        errorMessage: "Custom load failure",
      });
    }

    useRenderLoadMoreList().loadMore();
    await flushAsyncWork();
    const after = useRenderLoadMoreList();

    assert.equal(after.loadError, "Custom load failure");
    assert.equal(after.loading, false);
  });
});
