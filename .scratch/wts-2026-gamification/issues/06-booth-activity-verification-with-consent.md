# Automated Booth Activity And Optional Partner Contact Consent

Status: ready-for-agent
Type: AFK
Created: 2026-06-06

## Parent

`.scratch/wts-2026-gamification/PRD.md`

The closed decisions in `.scratch/wts-2026-gamification/wayfinder/MAP.md` supersede conflicting PRD text.

## What to build

Support sponsor booth **Partner Activities** through WTS-controlled QR/link/code/static evidence. WTS admins link each Activity to the existing partner record and configure distinct automated outcomes; event support resolves legitimate exceptions through audited manual awards. No booth staff account, scanner, delegated award endpoint, User lookup, raw-code access, or partner dashboard exists.

This slice supports any organizer-enabled `visit`, `participation`, or `completion` slot; it does not seed or require every slot. QR, link, and manual code are delivery forms for the same WTS-generated bearer evidence; an external partner form or URL click is never evidence. Optional partner contact consent is a separate current-User action and never changes gamification accounting.

Inventory constraint: each configured booth Mission uses an immutable `booth.{partnerKey}.{activityKey}` key, has one independently enabled Activity per outcome, and relates to an existing `partners` record with gamification `partnerKind = sponsor`. Organizers choose the actual outcome slots and WTS-controlled artifact deployment; no partner name, booth content, or raw-code distribution is assumed by this brief.

## Acceptance criteria

- [ ] Admins configure sponsor booth Activities only under `/admin/gamification`, with the existing partner relation, Mission/Activity keys, outcome, WTS evidence channel/role, active window, per-User/global limits, related-group/partner/category/day/conference cap membership, Achievement rule, and code-batch deployment label.
- [ ] `visit`, `participation`, and `completion` are separate Activities with separate WTS-generated evidence and independently create an idempotent **Activity Claim** and configured Badge/XP result.
- [ ] Repeated scans and reissued/different codes for one Activity cannot create another claim, Badge, or XP award; an accepted Activity whose XP cap is exhausted remains recorded and auditable without extra XP.
- [ ] Booth `visit`, `participation`, and `completion` use 5/5, 10/10, and 20/15 total-XP/**Leaderboard XP** policies. All booth outcomes for one sponsor share the active highest booth-group/partner cap, up to 35/25, independently for total and ranking XP.
- [ ] The current User alone can view/grant/withdraw separate consent summaries. Consent DTOs expose only the named partner/activity, notice, fields, grant/withdraw state, and handoff state; no public or partner-facing consent/claim surface exists.
- [ ] Tests cover WTS-only evidence, idempotency/reissue, independent cap application, current-User consent boundaries, and no partner/staff privilege.
- [ ] Regular **Users**, booth staff, and partners cannot self-award or award another User. Partners have no WTS User history, raw-code, scanner, award, lookup, or code-management access. Only an admin can make an exceptional manual award through the audited support flow.
- [ ] An unchecked, separate `partner_follow_up` consent action may share only the User's name and email with the named partner through an admin-audited one-time handoff. It records its purpose/notice version and never conditions or changes an **Activity Claim**, Badge, XP Event, or **Leaderboard XP** result.
- [ ] The current User can view and withdraw their own consent; withdrawal prevents future WTS handoffs but leaves all gamification results untouched. No automatic contact sharing, partner portal, CRM push, or gamification/contact history disclosure is added.
- [ ] The User can see booth achievements in their profile summary.
- [ ] The build completes successfully.

## Blocked by

- `.scratch/wts-2026-gamification/issues/01-september-gamification-accounting-foundation-and-profile-read-model.md`
- `.scratch/wts-2026-gamification/issues/02-secure-mission-code-redemption.md`
- `.scratch/wts-2026-gamification/issues/03-admin-gamification-configuration-and-code-operations.md`
- `.scratch/wts-2026-gamification/issues/11-admin-manual-awards-and-audit-history.md`
