# Arrival projection checkpoint

Implemented in arrivals hook only; lifecycle owner hashes/digests/assertOutcome and recovery fences preserved. Added migration 1790000016 for first terminal print fulfillment timestamp and history/continuation indexes (no evidence was available to date print completion correctly).

Public accepted DTO now permits `printIntentId: null` ONLY with `printSuppression: "lifecycle"` and `workflow.printState: null`; the validator rejects missing suppression, invalid IDs, or contradictory queued state. UI owner must render this as admission recorded / label suppressed, NOT label queued. No UI edits in this lane.

Live workflow name/affiliation remain original admission facts. Latest valid print intent supplies printState; recovery replacement payload retains corrected label text separately. Do not replace admission facts with correction text.

Verified: final focused run passed 33 tests across 5 files (new projection, arrival client/HTTP, resume, late lifecycle). All four new real-PB tests pass: real service -> coordinator -> simulated journaled printer -> live completed history/replacement; genuine possibly-sent abandoned execution with audit-failure atomic rollback and persisted restart readback; strict closed acceptance suppression; bounded keyset pagination past 103 historical rows with foreign-station exclusion. Existing arrivals integration suite also passed in the earlier broader run. Final `tsc --noEmit --pretty false` and `git diff --check` exit 0. Test runner emits existing Nitro dev-entry warning and 10-second shutdown timeout but returns exit 0.

Boundedness: at most 100 hydrated candidates per request, plus lookahead; exception ancestry traversal caps at 100 records and conservatively retains an exception when resolution is beyond that budget. Consumers must follow nextCursor even on an empty page. Historical completed print records without a trustworthy fulfillment timestamp remain visible as unresolved rather than assigning admission time or fabricating a date. No production, external admission, DELETE, physical printing, or commits.
