---
updated_at: 2026-06-20T21:34:23+00:00
focus_area: Second global review complete; issues #79–#99 ready to work
active_issues: [79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99]
---

# What We're Focused On

The second post-fix global review is complete. Basher walked 22 pages headlessly with no regressions and verified all 41 prior fixes; Saul and Livingston supplied design/UX and backend/static findings; Rusty consolidated the batch into 21 new GitHub issues (#79–#99).

Board status: 21 open issues are ready to work across search/FTS, rate limiting, push hardening, build reliability, reader a11y/UX, dark-mode tokens, backend/API bundles, and selected feature proposals.

Coordinator follow-up confirmed the build failure report was a concurrent-dev-server/`.next` artifact with clean build passing, and confirmed #85's legacy `.btn` usage is currently visibly unstyled after #66 removed the CSS.
