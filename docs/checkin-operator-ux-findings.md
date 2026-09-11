# Check-in operator UX findings — 2026-09-11

Status: findings and proposed direction, not an implemented redesign.

## Owner-led physical test

Owner used Android on Wi-Fi/Tailscale, logged in to the disposable app, bound the phone to station 1, selected the synthetic event and scanned the synthetic attendee QR. Owner confirmed one label printed, centered, with correct text. No additional physical prints are needed for this UX work; preserve the printer profile and safeguards.

Separate evidence:
- Hi.Events admission: explicitly simulated, not a production check-in.
- Central print `worro8gf8jsug5j`: `completed`.
- Agent attempt `2c647bftubatcoc`: `protocol_complete`.
- Pi journal readback: `reported`, `protocol_complete` (sequence 1644 at readback).
- Physical appearance: owner-confirmed centered/correct text.

## Reported UX failures

Too much text, excessive scrolling and buttons, confusing scan discovery, and a repeating refresh/page jump. The operator surface mixes setup, diagnostics, normal intake and exceptional recovery. Disabled placeholder scan/find/print buttons compete with the real camera controls. Test/readiness copy also contradicts actual capabilities.

## Reproduced page jump

`.scratch/wts-checkin-print/reproduce-ux-jump.mjs` drives the current live disposable app without submitting an attendee or requesting a print. Chromium mobile emulation at 390×844; ordinary background status responses delayed by 300 ms to reproduce a slower network.

Observed: initial document height 7030 px; 25 visible buttons; document height varied by 1268 px and scroll position by 720 px over 11 seconds. The command exits nonzero when the task surface moves. Screenshot and samples are in `/tmp/wts-checkin-browser-YvbidE/phone-test/ux-before.png` and `ux-jump-evidence.json`.

Ranked hypotheses: background verification removes/replaces sections; remount/focus effects move the viewport; browser anchoring responds to changing document geometry. `status.loading` propagates as verification into the event/intake/history surfaces; confirm exact contributing nodes before changing authorization or privacy behavior. Do not solve movement by allowing stale mutations or retaining private details after an actual denial.

## Proposed operator-first flow

- Setup once: sign in → pair station → choose event. Keep setup out of the normal scan screen afterward.
- Normal operation: compact station/event/status header, prominent camera, one start-scanning action. No need to find the camera by scrolling.
- Keep a scanning session active across routine refreshes. Pause accepting scans for the current attendee; resume only after the existing safe outcome/parking rules permit it.
- One compact attendee/result area; concise actionable uncertainty/errors. Keep duplicate prevention and physical-output uncertainty intact underneath the UI.
- Lookup and pause are secondary controls. History, recovery details, change-station/event and diagnostics live behind intentional entry points.
- Background refresh must not remove page structure, steal focus or reset scroll/camera. Actual authority loss must still pause intake and redact private data.
- Verify task completion without coaching, stable scroll/focus across delayed refreshes, repeated scans, denials and handoffs on the actual Android phone. iPhone remains separately unverified.
