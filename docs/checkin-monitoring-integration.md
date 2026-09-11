# #56 parent integration contract

## Delivered locally (not release-ready)

Preserved prior migration/hook/service/worker/contract and six PB integration tests unchanged. Added strict human HTTP route, response-validated browser client, dedicated Solid 2 components, real-PB HTTP test, client failure tests, SSR display test and a focused Playwright assertion helper. No shared pages, runtime worker wiring, default-suite selection, runner, deployment or existing hooks were edited. Build-generated file-routes.d.ts change was removed to preserve ownership; regenerate in parent build.

## Integration signatures

- `POST /api/checkin-monitoring` (`src/routes/api/checkin-monitoring.ts`) uses existing `requireCheckinOperatorSession` and server-only `getAdminPB`. Same-origin JSON only, 8192-byte limit, no-store privacy headers. Commands: `{operation:"dashboard",offset?:number}`, `{operation:"configure",command:MonitoringConfigureCommand}`, `{operation:"acknowledge",incidentId:string}`. Binding comes only from the existing HttpOnly `wts_checkin_client` cookie; duplicate cookies rejected. Machine commands, actor/station injection rejected. Current PB role revalidated at durable seam.
- `monitoringDashboard(audience:"admin"|"operator",offset=0):Promise<MonitoringDashboard>`, `configureMonitoring(command):Promise<MonitoringConfig>`, `acknowledgeMonitoring(incidentId):Promise<{incidentId,acknowledgedMs}>`. Browser imports client/contract only; NEVER service/worker/admin PB. Strict audience schemas reject admin fields in operator responses. Unknown mutation outcomes retain exact config command identity for retry.
- `CheckinOperatorMonitoring({readiness:AgentReadinessDTO[]})`, `CheckinAdminMonitoring({readiness:AgentReadinessDTO[]})`, `CheckinMonitoringPanel({audience,readiness})` from `src/components/checkin/checkin-monitoring.tsx`. Parent mounts under existing authenticated guard and keys/remounts on user/role/binding changes (prevent old audience/form state retaining addresses). Pass the existing authoritative readiness projection; this component does not derive readiness. An admin receives all scope, so use admin audience even on station page for an admin. Polls dashboard every 5 seconds while visible; pauses during config editing; configuration must be saved or page exited to leave editing. Parent must wire actual shared pages.
- Pure `CheckinMonitoringView({dashboard,readiness,onAcknowledge,acknowledging?,nowMs?})` is the tested display seam, not a standalone authenticated page.
- Existing `new CheckinMonitoringWorker(serverOnlyPB,{readReadiness:()=>agentService.adminList().then(r=>r.stations),now?,transport?,deliveryLimit?})`: `observe()`, `deliver()`, `tick()`. Add independently supervised nonoverlapping periodic scheduling, not HTTP request/cron-owned effects. Call `deliver()` independently if observations fail. `transport` is TEST/alternate boundary; default uses real PB `machine_send` mailer. No live email was sent or configuration tested. Default 30s/60s/900000ms thresholds; readiness retains existing 5s/15s/10s authority.

## Verification actually run

- `pnpm exec vp test run src/lib/checkin-monitoring.integration.test.ts`: 6/6 passed (initial rerun).
- `pnpm exec vp test run src/lib/checkin-monitoring-client.test.ts src/lib/checkin-monitoring-http.test.ts src/lib/checkin-monitoring.integration.test.ts src/components/checkin/checkin-monitoring.test.tsx`: 4 files, 10/10 passed. The HTTP test uses actual temporary PB and authRefresh, but calls the Request handler in-process, not a deployed browser route. The UI test is SSR only, NOT browser integration.
- `pnpm typecheck`: passed after adapting to installed Solid 2 (`createAsyncResource`, `onSettled`).
- `pnpm check`: exit 0, 0 errors / 88 warnings. Log `/tmp/checkin-monitoring-check.log`.
- `pnpm build`: exit 0, including server bundle check and check-in runtime build. Log `/tmp/checkin-monitoring-build.log`.
- `pnpm test`: 62 files passed, 1 failed; 828 tests passed, 1 failed. Existing concurrent/uncommitted `checkin-agent-runtime.test.ts` upgrade test wrongly assumes profile-snapshot migration 1790000009 is globally last. New monitoring migration 1790000011 correctly follows it. Parent owner should limit its migration fixture to names <= target migration and compare target ordering relative to journal migration, not global tail. No change made to that owned file. Log `/tmp/checkin-monitoring-default-tests.log`.
- Vite tests return correct exit codes but emit a pre-existing close-timeout warning.

## Remaining acceptance / parent work

1. Register the four named monitoring suites in package.json default test selection; current default omits them. Update shared migration-order test as above.
2. Wire shared operator/admin pages and supervision. Mount keyed to current verified session/binding; retain existing readiness semantics. No production readiness or hardware capability enabled here.
3. Extend actual isolated browser runner: it must copy monitoring migration/hook, start worker with existing readiness + explicit simulated transport, configure one verified admin through HTTP, generate 30/60s and immediate uncertainty via actual durable seams, then render parent-wired page. Use `assertCheckinMonitoringBrowser(page,{incidentId,foreignIncidentId,privateStrings,emailOutcome})` from `tests/checkin-monitoring-browser.ts` after real login/provisioning. Verify admin recipient selection, keyboard interactions, 360px layout, reload acknowledgement, foreign scope exclusion, unknown/failed delivery and unchanged admission/output/readiness. This helper is supplied but NOT run: shared runner/page edits are outside this task ownership. Do not label SSR or fetch doubles real browser acceptance.
4. Full integrated suite/build rerun after parent merges other slices. Monitoring persistence needs lifecycle purge integration (#57); current records contain workflow references and cannot outlive the agreed attendee-linked retention lifecycle.
5. Review remaining scalability: backend bounds response pages, but reads full incident/workflow collections internally; this slice does not add indexed cursor querying.
