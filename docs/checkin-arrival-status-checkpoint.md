# Arrival per-operation status checkpoint

Scope: arrival contract/service/HTTP/client/hook and manual/camera polling only; no migration, producer/runtime, lookup/recovery API, production or physical-print changes.

Implemented `CheckinArrivalService.status(bindingToken, operationId)` and browser `checkinArrivalStatus(operationId)`, via existing POST `/api/checkin-arrivals` operation `status`. DTO: `{operationId,result:Decision|null,operationsEnabled:false}`. Hook validates the live human role and current binding, then performs an indexed UUID lookup scoped to the owning station. Read-only observation survives a login handoff or a new phone binding at that station; original actor/binding/context metadata and mutation authorization remain unchanged. Missing/foreign/pending returns null (unknown). No writes/audit/rebase. Hidden cached `existing` commands project accepted/rejected later without rewriting original result. Latest print projection retains original label text and caller UUID.

Manual tracking starts for every workflow result, not just accepted; bounded status reads, in-flight flag, epoch guards, private display/QR redaction on verification and 401/403, frozen retry retained after stale replies. Camera refresh uses bounded status plus unchanged opaque resume descriptor API instead of scanning history; in-flight guard and conservative private-state clearing.

Modified files:
- pocketbase/pb_hooks/checkin-arrivals.pb.js
- src/lib/checkin-arrival-contract.ts
- src/lib/checkin-arrival-service.ts
- src/lib/checkin-arrival-http.ts
- src/lib/checkin-arrival-client.ts
- src/components/checkin/CheckinArrivalPreflight.tsx
- src/components/checkin/checkin-camera-arrival.tsx
- src/lib/checkin-arrival-client.test.ts
- src/lib/checkin-arrival-http.test.ts
- src/lib/checkin-arrival-projections.integration.test.ts
- tests/checkin-camera.spec.ts

Integrated verification: 28 focused tests passed, including real PocketBase/coordinator/AgentRuntime/SimulatedNiimbotPrinter progression, hidden cached existing, and read-only owning-station login/phone handoffs with foreign-station denial. Typecheck passed. All nine actual-app camera/lookup/manual browser scenarios passed, including manual pending→accepted progress, 403 DOM/QR redaction, and rejection of a delayed real response after New arrival. Camera changed-context actions remain blocked while owning-station workflow observation remains available. Independent bounded review found no blocker.

Integrated logs: `/tmp/wts-arrival-status-merged.log`, `/tmp/wts-status-browser-combined-green.log`. Earlier worker logs are superseded for integration claims.

Environment: pnpm exec tried to auto-install over linked node_modules and correctly refused. Use node_modules/.bin/vp and node_modules/.bin/tsc directly; browser runner uses temporary PATH wrapper /tmp/wts-status-tool-bin/pnpm that passes --config.verify-deps-before-run=false to real pnpm. No dependency/config edits. Vite tests emit existing Nitro dev-entry warning and a 10s shutdown warning but pass.
