/**
 * Minimal concurrency-limited map, shared by `translate.ts` (parallelizing
 * translation calls across a corpus) and `bench-concurrency.ts`
 * (benchmarking the vLLM server at different concurrency levels). No
 * dependency is pulled in for this — it's a ~15-line worker-pool pattern.
 *
 * Results preserve the input order regardless of completion order; pass
 * `onSettled` to observe completion order (e.g. for progress logging).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onSettled?: (result: R, item: T, index: number) => void,
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results: R[] = new Array(items.length);
  let next = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      const result = await worker(items[index]!, index);
      results[index] = result;
      onSettled?.(result, items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runWorker));
  return results;
}
