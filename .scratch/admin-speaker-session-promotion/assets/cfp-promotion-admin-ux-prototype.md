# CFP Promotion Admin UX Prototype

Date: 2026-07-08
Ticket: [Shape CFP Promotion Admin UX](../issues/05-shape-cfp-promotion-admin-ux.md)

## Purpose

Low-fidelity admin UX outline for promoting an accepted **CFP Submission** into a draft public **Session** linked to the right **Speaker**.

This is not an app-code implementation spec. It fixes the admin interaction shape so later tickets can design schema/actions and implementation slices without reopening product decisions.

## Decision Being Tested

Use the proposal leaderboard as the primary promotion surface, because promotion is per **CFP Submission**, not per **CFP Applicant**.

Keep the existing **Create draft profile** affordance on `/admin/speakers` as a speaker-only escape hatch. Do not keep a separate speaker-only action on the proposal leaderboard once **Create draft session** exists there, because promotion already creates or reuses the Speaker.

## Recommended Flow

1. Admin accepts a proposal on `/admin/proposals`.
2. The accepted row/card shows a primary `Create draft session` action.
3. Clicking `Create draft session` creates or reuses the unpublished CFP-origin Speaker, then creates one unpublished Session copied from the CFP Submission.
4. Success keeps the admin on the leaderboard and shows a toast with `Review draft session`.
5. `Review draft session` opens `/admin/sessions?edit={sessionId}` with the new draft loaded in the existing Session edit form.
6. The Session edit form shows a read-only `From CFP` source panel and leaves schedule fields empty for admin review.
7. Admin edits the public Session and Speaker records directly, then explicitly publishes each when ready.

## Proposal Leaderboard

### Desktop Row

```text
/admin/proposals

# | SCORE | PROPOSAL               | SPEAKER       | STATUS    | REVIEWS | ACTION
1 | 4.70  | Practical Type Safety   | Ada Lovelace  | Accepted  | 5       | [Create draft session] [Review]
2 | 4.30  | SolidStart in Anger     | Grace Hopper  | Accepted  | 4       | [Draft session exists] [Review draft] [Review]
3 | 3.90  | Private Systems Notes   | Alan Turing   | Pending   | 3       | [Review]
```

### Mobile Card

```text
Practical Type Safety
Ada Lovelace
[Accepted] [4.70] [5 reviews]

[Create draft session]
[Review]
```

### Row Action States

```text
Pending/rejected proposal
- No promotion button.
- Optional disabled hint: Accept proposal first.

Accepted, promotable proposal
- Primary action: Create draft session.
- Button label while busy: Creating draft...
- Review link remains available.

Accepted, already promoted to unpublished Session
- Status pill: Draft session exists.
- Action: Review draft.
- No create button.

Accepted, already promoted to published Session
- Status pill: Published session exists.
- Action: View session or Edit session.
- No create button.

Accepted, invalid source data
- Disabled action: Cannot promote.
- Inline/help text explains the missing linked CFP Applicant or other blocking fact.
```

## Promotion Confirmation

No modal by default. The action is reversible enough because it creates drafts, not public records.

Use a browser-confirm modal only if implementation discovers a non-atomic partial-create risk that cannot be made safe. The default UX should stay one click from an accepted row.

## Success States

```text
Toast title: Draft session created.
Toast body: Created draft Session "Practical Type Safety" and reused Speaker "Ada Lovelace".
Toast action: Review draft session
```

If the promotion created a new Speaker:

```text
Toast title: Draft session created.
Toast body: Created draft Speaker "Ada Lovelace" and draft Session "Practical Type Safety".
Toast action: Review draft session
```

The row immediately changes from `Create draft session` to `Draft session exists` plus `Review draft` after refetch or optimistic local update.

## Error States

```text
Could not create draft session.
No public Session was created. Try again or open the CFP review detail.
```

Specific server-side validation should replace the generic body when known:

```text
This proposal is no longer accepted.
Set it back to Accepted before creating a draft Session.
```

```text
This proposal already has a draft Session.
Open the existing draft instead of creating another one.
```

```text
This proposal is missing a linked CFP Applicant.
Fix the source data before promoting it.
```

The failed row keeps its current state and leaves `Create draft session` available only when retrying is valid.

## Duplicate And Already-Promoted State

The UI should key duplicate prevention off Session provenance, not title, Speaker, or Applicant inference.

```text
CFP Submission -> sessions.cfp_submission -> Session
```

If any Session exists with `cfp_submission = item.id`, the proposal row is already promoted.

Display state by the promoted Session:

```text
Unpublished Session: Draft session exists [Review draft]
Published Session: Published session exists [Edit session] [View public]
```

Do not offer a second create action for the same CFP Submission.

## Sessions Admin Review Path

### Entry From Toast Or Row

```text
/admin/sessions?edit={sessionId}

[Edit session]                                      [Draft] [From CFP]
Saves as draft. Toggle Published when ready for the public site.

Source
From CFP Submission: Practical Type Safety
Copied once from accepted proposal on 2026-07-08.
Private CFP fields were not copied.
[Open CFP review detail]

Public identity
Title *  [Practical Type Safety]
Slug     [practical-type-safety]

Schedule
Format   [          ]
Starts   [          ]
Track    [          ]
Room     [          ]

Public copy
Abstract * [copied abstract]

Speakers
[x] Ada Lovelace

Sessions save as drafts until you toggle Published in the list.
[Cancel] [Update session]
```

### Session List

```text
Title                    | Schedule       | Speakers      | Source   | Visibility | Actions
Practical Type Safety    | Not scheduled  | Ada Lovelace  | From CFP  | Draft      | [Edit] [Preview]
```

The `From CFP` badge is read-only context. It does not sync later CFP edits into the Session.

## Speakers Admin Relationship

`/admin/speakers` keeps the existing accepted-CFP applicant panel, but its copy should clarify that this creates only a draft **Speaker** profile.

```text
Accepted CFP applicants without a profile
Create standalone draft Speaker profiles here. Promoting an accepted proposal from the leaderboard will also create or reuse the Speaker automatically.

Ada Lovelace
Accepted proposals: Practical Type Safety, SolidStart in Anger
[Create draft profile]
```

Rules:

- Keep `Create draft profile` for speaker-first workflows, such as preparing a public Speaker page before choosing which accepted Session to promote.
- Remove or replace the leaderboard's old speaker-only `Publish speaker` action so admins do not need to decide between two nearly identical proposal-row buttons.
- If a Speaker already exists for the CFP Applicant, the Speakers admin panel does not show `Create draft profile` for that Applicant.
- Promoting any accepted CFP Submission for that Applicant reuses the existing Speaker.
- A CFP Applicant with multiple accepted CFP Submissions may produce multiple draft Sessions, but only one Speaker.

## Data Shown, Data Not Shown

Copied into the draft Session:

- `cfp_submissions.session_title` -> `sessions.title`
- `cfp_submissions.abstract` -> `sessions.abstract`
- Generated unique `sessions.slug`
- Linked Speaker created or reused by the promotion action
- Provenance link from Session to CFP Submission

Never copied into public Session or Speaker fields:

- Key takeaways
- Technical requirements
- Internal notes
- Reviewer notes or scores
- Private CFP metadata
- Any other CFP review-only content

## Validation And Accessibility Notes

- Keep required-field timing consistent with existing admin forms: required errors show after interaction or submit, not on initial render.
- Keep the promotion button enabled only for valid accepted rows; use disabled state plus non-color text when the reason is visible.
- Use `<button type="button">` for create/retry/edit-loading actions and links only for navigation.
- Preserve existing desktop table and mobile card shapes.
- Do not add bulk promotion in this flow; each draft Session should be reviewed deliberately.

## Open Implementation Details For Later Tickets

- Exact server action name and return shape for CFP Submission promotion.
- Query-param or route-state mechanism for opening `/admin/sessions` directly into edit mode.
- How to fetch promoted Session provenance efficiently for proposal rows.
- Whether the promotion action can be transactional at the PocketBase layer or needs explicit partial-failure recovery.
- Exact copy for row hints once backend validation errors are known.
