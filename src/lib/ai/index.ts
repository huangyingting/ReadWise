/**
 * AI subsystem public entry point (RW-023).
 *
 * `@/lib/ai` is the single, stable import path the rest of the app uses for AI:
 * the provider-agnostic chat-completions client (`chatComplete` /
 * `chatCompleteWithMeta`) plus its capability/config helpers. The implementation
 * lives in `./facade`; this barrel keeps the public surface unchanged while the
 * subsystem's internals (budget, cache, ledger, usage-summary, provider, runner,
 * registry) live alongside it under `lib/ai/`.
 *
 * The sibling modules (`./budget`, `./cache`, `./ledger`, `./usage-summary`) are
 * imported directly by the features that need them; they are intentionally NOT
 * re-exported here to avoid an import cycle with `./cache`, which depends on the
 * `chatComplete*` API exposed by this entry point.
 */
export * from "./facade";
