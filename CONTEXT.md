# ReadWise Context

Canonical language for article reading, generated narration, and stored media.

## Language

### Speech

**Narration**:
Synthesized speech audio and word timings attached to an article for reader playback.
_Avoid_: Speech cache, TTS output, audio track

**Reader text**:
The canonical plain-text form of an article used as the basis for narration and word highlighting.
_Avoid_: Stripped HTML, article plain text

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