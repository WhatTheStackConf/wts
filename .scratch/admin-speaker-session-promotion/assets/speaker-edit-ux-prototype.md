# Speaker Edit UX Prototype

Date: 2026-07-08
Ticket: [Shape Speaker Edit UX](../issues/03-shape-speaker-edit-ux.md)

## Purpose

Low-fidelity admin UX outline for editing public **Speaker** snapshots after the source policy decision in [Decide Speaker Profile Source Policy](../issues/02-decide-speaker-profile-source-policy.md).

This is not an implementation spec for server actions or schema. It fixes the admin interaction shape so later implementation tickets can build the smallest correct UI.

## Design Decisions

- Editing happens inline on `/admin/speakers`, above the list, reusing the `AdminSessionsHub` form pattern.
- Every Speaker row/card gets an `Edit` action alongside the existing Published/Draft toggle and Preview link.
- The form is shared for CFP-origin and invited Speakers.
- Origin/source is shown as read-only context, not as a separate editing mode.
- Editable fields are `display_name`, `slug`, `affiliation`, `bio`, `social_handles`, and `photo`.
- Publishing stays in the list/card toggle. Saving profile content never publishes automatically.
- Current photo is previewed. Admins can upload a replacement or remove the current `speakers.photo`.
- Save requires `display_name` and `slug` only.
- Slug format and uniqueness are enforced server-side.
- Affiliation, bio, socials, and photo are optional.
- Socials are edited as one URL/handle per line and normalized by dropping blank lines.
- Photo upload keeps the existing limit: JPEG, PNG, or WebP, maximum 5 MB.

## Page Structure

```text
/admin/speakers

[Header]
Speakers (count)
Speaker profiles & publication
Hint: Profiles start as drafts. Toggle Published to show on the public site.
[Sessions] [Back to dashboard]

[Accepted CFP applicants without a profile]
Existing panel remains unchanged for now.

[Invite speaker] button OR [Speaker form]

[Filters]
Origin: All / CFP / Invited
Visibility: All / Published / Draft

[Speaker list]
Desktop table and mobile cards.
```

## Form States

### Create Invited Speaker

The existing `Invite speaker` action opens the shared form in create mode.

```text
Title: Invite speaker
Description: Creates a draft public Speaker profile.
Source badge: Invited
Primary action: Create draft profile
Secondary action: Cancel
```

### Edit Existing Speaker

Clicking `Edit` on a row/card opens the same form in edit mode.

```text
Title: Edit speaker
Description: Updates the public Speaker snapshot. CFP source data is not changed.
Source badge: CFP-origin copied snapshot OR Invited
Status badge: Published OR Draft
Preview link: /speakers/{slug}
Primary action: Save profile
Secondary action: Cancel
```

## Desktop Wireframe

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Edit speaker                                                [Draft] [Preview]│
│ Updates the public Speaker snapshot. CFP source data is not changed.        │
├───────────────────────────────────────┬─────────────────────────────────────┤
│ Public identity                       │ Photo                               │
│                                       │                                     │
│ Display name *                        │ ┌───────────────────────────────┐   │
│ [Ada Lovelace                    ]    │ │ Current circular photo preview │   │
│                                       │ └───────────────────────────────┘   │
│ Slug *                                │ [Choose file]                       │
│ [ada-lovelace                    ]    │ JPEG, PNG, or WebP. Max 5 MB.       │
│                                       │ [Remove photo]                      │
│ Affiliation                           │                                     │
│ [Engineer @ Example Co           ]    │ Source                              │
│                                       │ [CFP-origin copied snapshot]         │
│ Profile content                       │ Copied once from CFP Applicant/User.│
│                                       │ Future source edits do not sync.     │
│ Bio                                   │                                     │
│ [textarea                         ]   │                                     │
│                                       │                                     │
│ Social URLs                           │                                     │
│ [textarea, one per line           ]   │                                     │
├───────────────────────────────────────┴─────────────────────────────────────┤
│ Speaker changes do not affect CFP Applicant/User data. [Cancel] [Save]      │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Mobile Wireframe

```text
┌───────────────────────────────────────┐
│ Edit speaker                          │
│ [Draft] [Preview]                     │
│ Updates the public Speaker snapshot.  │
├───────────────────────────────────────┤
│ Photo                                 │
│ [Current photo preview]               │
│ [Choose file]                         │
│ [Remove photo]                        │
├───────────────────────────────────────┤
│ Source                                │
│ CFP-origin copied snapshot            │
│ Copied once; no auto-sync.            │
├───────────────────────────────────────┤
│ Public identity                       │
│ Display name *                        │
│ [input]                               │
│ Slug *                                │
│ [input]                               │
│ Affiliation                           │
│ [input]                               │
├───────────────────────────────────────┤
│ Profile content                       │
│ Bio                                   │
│ [textarea]                            │
│ Social URLs                           │
│ [textarea]                            │
├───────────────────────────────────────┤
│ [Cancel] [Save profile]               │
└───────────────────────────────────────┘
```

## Speaker List Changes

### Desktop Table

```text
Name | Slug | Origin | Visibility | Actions
Ada  | ada  | CFP    | [Draft]    | [Edit] [Preview]
```

### Mobile Card

```text
Ada Lovelace
ada-lovelace
[CFP]

[Draft] [Edit] [Preview]
```

## Field Behavior

- `display_name`: required. Existing CFP-origin records may have this already from the User name at promotion time.
- `slug`: required. Admin may edit it. Server must reject invalid or duplicate slugs with a field-specific message.
- `affiliation`: optional text.
- `bio`: optional textarea/editor-compatible HTML string. Keep the existing admin textarea approach unless the implementation ticket chooses to introduce the rich editor.
- `social_handles`: optional multiline textarea. One value per line. Empty lines are ignored on save.
- `photo`: optional file. Selecting a new file updates local preview before save.
- `remove photo`: only visible/enabled when the Speaker has a persisted `speakers.photo` or a newly selected replacement. Removing clears the preview and sends an explicit remove intent.

## Validation And Accessibility Notes

- Use native `required` attributes for display name and slug.
- Keep submit enabled; browser validation should focus the first invalid required field.
- Continue using `AdminFormField` error text and validity helpers to sync `aria-invalid` with control validity.
- Do not show required-field errors on initial render.
- Use semantic `<button type="button">` for Edit, Cancel, Remove photo, and publish toggles.
- Use an `<a>` only for Preview because it navigates to a URL.
- Keep the form in natural DOM order: title/status, photo/source context, identity fields, content fields, actions.

## Save And Cancel Behavior

- Opening `Edit` replaces the invite button area with the form and scrolls the admin to the form if needed.
- `Cancel` discards unsaved field/file changes, clears edit mode, and restores the Invite speaker button.
- Successful save clears edit mode, refetches Speakers, and shows a toast: `"{display name}" updated.`
- Failed save keeps form values intact and shows a toast or field-specific error when available.
- Save does not change `published`.

## Open Implementation Details For Later Tickets

- Whether to reuse current invite form state or extract a shared Speaker form component.
- Exact server action shape for photo replacement/removal.
- Exact slug validation rules and error plumbing.
- Whether `bio` remains a textarea or uses the existing rich editor component.
