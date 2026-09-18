# Main-day registration: scan, manual roster and reprints

Date: 2026-09-18
Status: implementation contract; not a deployment claim.

## Operator behavior

- `/checkin` has two primary modes: **Scan** and **Manual**. Each operator can choose; both use the selected Printer and main-day event.
- Manual mode opens the entire eligible-list roster, paginated without silent truncation, with name/email search, refresh, and direct per-row **Check in & print** / **Reprint** actions. No QR and no separate select-then-confirm ceremony are required for ordinary rows.
- Explicitly cancelled/unpaid tickets are visible with their status but not printable. Searches and list membership are server-validated under the authenticated operator and selected event/list context.
- A first eligible action records admission once and queues one initial label.
- An intentional later action for an admitted attendee queues a replacement label on the currently selected printer, including a different printer. It never submits another upstream admission POST or changes the immutable original admission identity.
- Current queued/in-progress output is surfaced, not cloned. Unknown admission or possibly-printed outcomes require recovery, not automatic retransmission.
- Repeated camera frames are one capture. An explicitly released completed result followed by a new scan is a fresh intent. Network retry/reload recovery retains the original intent ID and does not print again.
- Completion feedback must follow the specific label requested by that action, not an older completed label or another operator's latest label.

## Scope and safeguards

- Reuse existing authenticated lookup/arrival/coordinator/agent workflows. No direct device writes from UI, no printer ownership changes, and no alternative admission path.
- Keep bounded pagination, validated upstream navigation, exact list/product membership, role/context refresh, and no attendee PII in URLs or persistent browser storage.
- Freeze each submitted operation before sending; block mode/printer/event changes during an unresolved action. Preserve opaque references and exact retry controls after response loss.
- Cross-printer label routing uses the destination printer's approved profile and normal runtime authorization. Historical admissions/attempts remain immutable.
- Configure source references, do not hardcode production event/list/product IDs in feature code.

## Verification

Public seams: real disposable PocketBase domain commands and runtime/coordinator integration; lookup adapter transport boundary with source-contract fixtures; HTTP/client validation; mounted browser and built-app E2E.

Must prove: first admission/print; same-printer and cross-printer replacement; no second admission; replay and concurrent deduplication; no fresh print for active/uncertain work; correct requested-label polling; large full-roster browsing; name/email filters; cancelled/unpaid rows; direct manual action; mode choice; lost response and stale actor/context privacy; mobile usable next-action controls.

No production admission or physical label is authorized merely by running automated tests. Build and verify in the isolated worktree; leave the current live service untouched during implementation.
