# Check-in Tools dashboard

Implemented 2026-09-11 for `/checkin-tools`. The primary `/checkin` scanner is unchanged.

## Operator experience

- Scanner-matched, 42rem dark shell; station/event and short, live readiness status.
- Work is the default: recent/unresolved records, attendee name, event and meaningful state. No permanent setup warning, disabled placeholder actions, generation dump or recovery manual.
- Selecting a record opens recovery. Text editing, handwriting and immutable history use progressive disclosure; isolated work exposes its finish/reconnect controls. Parking preserves the unresolved state in the list.
- Arrivals contains existing camera/manual/lookup and held-work workflows. Phone contains event selection and pairing. Diagnostics contains explicit technical details. Admin-only station administration and role links remain available.
- Existing opaque camera/lookup holds appear as a concise Review held scan action on the dashboard, rather than automatically replacing it with the entire recovery surface.

## Safety and continuity

- Secondary arrivals mount only on first bound entry, then remain mounted across view changes.
- Pending/ambiguous or unacknowledged manual commands, held camera/lookup work, and saved recovery retries block navigation while the binding remains current. Unbound arrivals are unavailable without trapping phone setup; revoked scope cannot strand logout behind an orphan busy flag.
- Actor/binding fences and failed status reads redact private content. Transient status failure preserves the exact recovery command until explicit access re-verification and same-command retry.
- Event display uses the same source fence as selection. A visibility change cannot hide a retained failed preflight and leave navigation permanently locked.
- Recovery history distinguishes loading/error/empty pages and retries the failed offset; previous-page navigation is available. Physical observation, protocol completion, cancellation and handwriting confirmations remain distinct.

## Verification

- `pnpm test`: 1,150 tests passed across 108 files.
- All 47 configured browser scenarios passed across all 15 `checkin*.spec.ts` files, split into two independently provisioned groups: 32 operational scenarios and 15 camera/lookup/scanner/Tools scenarios. Separate artifact directories avoid concurrent Playwright trace deletion.
- `pnpm test:checkin-components`: passed, including new compact recovery pagination, disclosure, busy lifetime, privacy, exact retry, isolation and parking cases.
- Typecheck passed. `pnpm check`: 0 errors, 120 warnings. Production builds and server-bundle syntax check passed.
- Actual private HTTPS preview: login, current Tools UI, six completed labels visible, no new prints, no browser errors and no horizontal overflow at 390px/320px verified. Preview refresh changed only the seven owned frontend sources in its isolated app copy; PocketBase and physical journals were not restarted or reset.

Regression evidence: `.scratch/wts-checkin-print/tools-ui-evidence/browser-verification.json`. Preview evidence and ownership: `/tmp/wts-checkin-browser-L7tkXG/tools-preview/`. Private fixture/session files contain generated credentials and must not be printed wholesale.

No commits, pushes, production activation, or additional physical printing were performed for this UI change. The earlier six-label owner acceptance remains separate from real Hi.Events admission and Wi-Fi reliability, which this redesign does not establish.
