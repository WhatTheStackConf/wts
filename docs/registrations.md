# Pre-conference registration rosters

`/registrations` is an admin/check-in-operator-only, read-only view of tickets in **WhatTheStack 2026 (Hi.Events event 5)**. Programme options and the backend attendee filter use the same mapping from `conference-week.ts` through `registrationProgrammes`.

| Programme | Product ID | Admission |
|---|---|---|
| InfoSec Monday | 15 | Free |
| Workshop Tuesday: iOS + AI | 16 | Free |
| DevFest | 9 | Paid |
| Workshop Thursday | 14 | Paid |
| Angular Day | 17 | Free |

The paid mappings were verified against the public WTS event catalogue at `https://hievents.foundry.mk/api/public/events/5`: product 9 is **Pre-DevFest Day: Day Zero** and product 14 is **Payments and Monetization at Scale for Frontend Engineers Workshop**, both `PAID` / `TICKET`.

`registrationProductId` adds explicit roster mappings without changing `freeTicketProductId`, free-ticket grouping, booking links, or main-conference eligibility. Programmes with neither field are not listed. Main conference entry, student tickets, swag, speaker dinner and unknown products remain excluded.

This includes WTS-issued DevFest tickets, not registrations made independently on GDG, Eventbrite or another platform. MAUI Day has no verified WTS product mapping and is unchanged.

## Safety and behavior

- Upstream requests remain GET-only, paginated in stable ID order. No registrations, orders, ticket prices, admissions, labels or check-in status are changed.
- Names/emails remain private, served with no-store headers. Live operator identity/role is revalidated before and after the upstream read.
- Switching programmes clears the search; each programme shows its own registrations and counts. Cancelled tickets retain their cancellation status.
- Unknown ticket status remains Unknown. Arrival and payment settlement are not inferred.
- Refresh failure is distinct from an empty roster and clears prior rows; revoked access clears rows and search.

## Verification

- `pnpm exec vp test run src/lib/registrations.test.ts src/lib/conference-week.test.ts src/lib/ticket-groups.test.ts`
- `pnpm test:checkin-browser tests/checkin-registrations.spec.ts` builds the app with real disposable PocketBase authentication and a synthetic Hi.Events upstream, then exercises free/paid selection, search, refresh, cancellation, mobile layout and access-loss redaction.
- The optional `registrations-live.test.ts` requires an explicitly supplied private `WTS_REGISTRATION_LIVE_CONFIG`; ordinary CI does not access production attendees.

No schema migration or new integration credential is needed for these two paid products.
