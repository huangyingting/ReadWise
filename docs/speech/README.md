---
type: "index"
status: "current"
last_updated: "2026-11-19"
description: "Narration generation (cloud TTS and on-device), word timing, and pronunciation practice."
---

# Speech

Speech generation and assessment. Media owns stored audio, Reader owns playback, and Operations owns TTS job scheduling.

Add a document here when the change affects narration, word timing, voices, or pronunciation assessment.

## Code ownership

- `src/lib/speech/`, `src/lib/ondevice-tts/`
- `src/lib/pronunciation.ts`, `src/components/pronunciation/`

## Documents

<!-- BEGIN GENERATED: docs-index (npm run docs:index) -->

| Document | Type | Status | Description |
| --- | --- | --- | --- |
| [Speech generation](./generation.md) | reference | current | Documents real-time and Batch narration, timing enrichment, voice/format fallback, and ArticleSpeech generation. Captures current Azure Speech synthesis flow, cache/storage behavior, timing migration, readiness, and graceful fallback rules. |
| [On-device narration (Paradee-8M)](./ondevice-narration.md) | reference | current | Documents default on-device Reader narration with Paradee-8M: browser worker synthesis on WebGPU with WASM fallback, self-hosted model and runtime assets, word-timestamp alignment, progressive playback, cloud fallback, and the reader preference. |
| [Pronunciation practice](./pronunciation-practice.md) | design | current | Browser-side Azure Speech pronunciation assessment with a short-lived token, attempt persistence (bounded scores and reference text only, never audio), history, and Learning mastery side effects. |

<!-- END GENERATED: docs-index -->
