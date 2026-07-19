# ReadWise Context

Canonical language for article reading, generated narration, and stored media.

## Language

### Reader

**Reader floating surface**:
A transient Reader surface that presents actions or derived information in the context of selected or highlighted Reader text.
_Avoid_: Reader popover, overlay, floating panel

### Speech

**Narration**:
Synthesized speech audio and word timings attached to an article for reader playback.
_Avoid_: Speech cache, TTS output, audio track

**Narration text basis**:
The exact Reader text scope synthesized for a Narration and used to index its word timings.
_Avoid_: TTS input, speech text, cached plain text

**Reader text**:
The canonical plain-text form of an article used as the basis for narration and word highlighting.
_Avoid_: Stripped HTML, article plain text

**Reader text map**:
The Reader-owned mapping from the current prose DOM to persistent annotation anchors and live Narration word ranges, rebuilt after semantic highlight marks mutate text nodes.
_Avoid_: TTS node cache, highlight walker

**Speech timing enrichment**:
Normalization that gives each playable narration word a corresponding span in the reader text.
_Avoid_: Span repair, timing repair, word alignment

**Batch narration**:
Narration generated asynchronously for one or more full articles through provider batch jobs rather than on demand during reading.
_Avoid_: Batch TTS, offline speech

### Media

**Media asset retirement**:
Permanent removal of tracked article media from both relational records and object storage as one lifecycle outcome.
_Avoid_: Blob cleanup, storage purge, file deletion

### Operations

**Claimed-job execution**:
The Operations-owned lifecycle for one already-claimed Job, from its start transition through heartbeat-protected handler execution and its terminal transition or ownership-loss outcome.
_Avoid_: Worker processing, claim-and-run, job runner

### Content Ingestion

**Public-library URL intake**:
The lifecycle for accepting a web article URL into the shared library, ending in an ownerless draft or a non-saving outcome.
_Avoid_: Admin scrape, scrape-and-save

**Source extraction policy**:
The exceptional extraction and declutter decisions owned by one Content Ingestion source adapter and executed by the shared extraction pipeline.
_Avoid_: Provider branch, scraper special case

### Account Lifecycle

**Personal-data export policy**:
The explicit field allowlist and include/exclude decision for every Prisma `User` relation; Prisma remains authoritative for relation and cascade behavior.
_Avoid_: Lifecycle registry, export-all schema

### Today Session

**Today Session action**:
A controlled learner intent that advances or skips the current learner-local-day workflow without carrying article, question, answer, or word content.
_Avoid_: Today mutation, step request

**Today action delivery**:
The client-owned lifecycle for one Today Session action, ending either in immediate delivery with a server result or durable queuing for replay without a server result.
_Avoid_: Offline Today fetch, Today request helper

### Learning

**Learner evidence**:
A controlled, content-free description of a completed learner activity that Learning translates into one or more best-effort Skill Mastery signals.
_Avoid_: Raw skill update, mastery side effect, activity score write