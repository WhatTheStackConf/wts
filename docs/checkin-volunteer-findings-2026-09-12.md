# Check-in changes after volunteer testing

Date: 2026-09-12
Status: owner findings and revised requirements; not an implementation or deployment claim.

These requirements supersede conflicting repeat-scan and all-events-printing assumptions in [the earlier check-in specification](wts-2026-checkin-print-spec.md). Recommendations below remain distinct from owner decisions. Preserve the existing scan-first interface unless a specific change is required here.

## Owner decisions

### Headless Wi-Fi onboarding

Stations need a practical way to join a new Wi-Fi network without a screen, SSH knowledge or an Ethernet connection. Ethernet cannot be an operational prerequisite.

Owner follow-up: venue networks will be known before each event. Preconfigure saved Wi-Fi profiles ahead of time; a custom setup portal is not required for the initial delivery. Deploy the coordinator on the always-available WTS host as the immediate priority, removing laptop/SSH-tunnel dependence from normal station operation.

Acceptance: an operator can bring a headless station onto a new network, see success/failure, recover from a wrong password, and reconnect after reboot. Changing networks preserves station identity, pairing QR, approved configuration and journal.

### Rescan means another label when already checked in

A deliberate repeat scan is a valid operator request to reprint the name label. An authoritative existing check-in for the selected admission list is not a reason to block label fulfilment. Do not submit another check-in just to obtain another label.

Distinguish three cases:
- New eligible attendee: record check-in, then print.
- Valid attendee already checked in on the selected list: print another label without another admission POST.
- Existing queued/in-progress attempt: surface that attempt rather than letting repeated camera frames create parallel copies. An intentional replacement must preserve and safely settle/fence earlier work.

A camera continuously seeing the same QR is one capture, not repeated operator intent. Transport retries retain their command identity; a deliberate later rescan creates a new print intent. Preserve original attempts, outcome evidence and replacement history. An unknown admission outcome is not permission to issue another admission POST.

Acceptance: initial scan, intentional reprint after success, intentional replacement after a failed print, continuous-frame suppression and lost-response recovery are tested. An already-checked-in path produces no extra upstream check-in mutation.

### Manual lookup becomes a direct fulfilment path

Search by attendee name or email, select the correct person, and invoke one obvious action that performs any needed check-in and prints. Already-checked-in attendees use the reprint path. Avoid a separate manual admission step, multi-screen technical workflow or obligatory trip through recovery tools for ordinary cases.

Ambiguous results still require choosing a person; never automatically act on the first name match. Keep email in the authorized lookup surface, not labels, logs or printer payloads. Scan and lookup should use the same admission/print decision rules.

Acceptance: name and email searches, multiple matches, keyboard/touch selection, first check-in, existing check-in and request retry all work without duplicate admission or accidental extra copies.

### One active scanner per station is an operating agreement

Volunteers will agree on one active scanner per station. Do not add a software-enforced active-scanner lock or prevent multiple phones from being paired for handover. Retain printer serialization and per-job correctness protections for accidental overlap. Defer multi-party rapid-scanning UX/throughput work unless it reveals a data-integrity defect.

### Main-day labels; pre-conf registration/check-in only

Physical name badges/name labels are issued on the main day only. Pre-conf events still need event-specific registration rosters and arrival tracking, without printing.

Keep registration entitlement, check-in and physical label fulfilment distinct. A pre-conf check-in must not count as main-day admission. Pre-conf operation must not depend on printer readiness, a label profile or station pairing merely to record arrival.

Owner follow-up: check-in operators need a central, role-protected registration view at wts.sh with names and emails grouped by pre-conf event. Initial scope is read-only refresh/sync from Hi.Events with search and freshness information; Hi.Events remains the actual pre-conf check-in tool. This view must work without station pairing and keep roster PII out of public pages, analytics and public caches.

Acceptance: each pre-conf roster/list contains only the appropriate reservations; search and arrival tracking work with all printers offline; no label work is queued; main-day entitlements and admission status remain independent.

## Recommended approach — not yet selected or implemented

- Initial network delivery is saved venue Wi-Fi profiles prepared before events. An organizer-controlled hotspot or station setup portal remains an optional fallback, not a prerequisite for this delivery.
- Keep network setup separate from the existing station-pairing QR. Restrict Wi-Fi credential entry to the setup surface and keep credentials out of URLs, printed operational codes and logs.
- Resolve the coordinator's hosting dependency along with connectivity. The volunteer runner currently depends on the organizer laptop and an SSH tunnel; Pi Ethernet/Wi-Fi connectivity alone is insufficient. Choose and test an always-available coordinator location rather than quietly assuming the laptop will stay awake or venue clients can reach one another.
- For the quickest pre-conf delivery, use existing Hi.Events registration data and dedicated product-scoped check-in lists, with roster export as an operational fallback. A unified WTS check-in-only screen is an alternative requiring explicit printer-independent admission support; merely hiding a Print button is insufficient.
- Existing weekday reservations share a Hi.Events event with the main conference. Scope lists by the actual ticket products; an upstream event ID or a person's presence in another programme is not enough.

## Suggested delivery order

1. Pre-conf registration/check-in lists and independent entitlement verification.
2. Repeatable Wi-Fi/network onboarding and coordinator startup.
3. Shared initial-print/reprint semantics for scan and manual lookup.
4. Simplified lookup surface and volunteer instructions.
5. Dress rehearsal: cold boot on Wi-Fi, new attendee, deliberate rescan, manual lookup, a printer failure, scanner handover, and pre-conf check-in with no printers.

No network credentials, live ticket changes, deployments or additional print jobs are authorized by this document itself.
