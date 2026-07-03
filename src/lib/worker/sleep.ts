const ABORT_ERROR_NAME = "AbortError";

export class AbortError extends Error {
  constructor() {
    super("aborted");
    this.name = ABORT_ERROR_NAME;
  }
}

function createAbortError(): AbortError {
  return new AbortError();
}

/** Resolves after `ms`, or rejects with AbortError if the signal aborts first. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(createAbortError());

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === ABORT_ERROR_NAME;
}
