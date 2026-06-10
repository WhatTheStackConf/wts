# WTS Design Context

## Theme

Scene: WTS organizers are updating public conference content on laptops during planning calls, late-night review sessions, and on-site prep, usually in dim or mixed lighting where a dark interface lowers glare and makes publication state feel operational.

Use the existing dark WTS theme as the base. For admin, keep the cyberpunk atmosphere but sharpen it into a console-like product surface.

## Color Strategy

Restrained product palette with cyberpunk accents. Tinted dark neutrals carry most surfaces; primary magenta, secondary amber, accent cyan, and semantic states should be reserved for action, selection, status, and meaningful alerts.

Use existing OKLCH tokens in `src/styles/app.css` and DaisyUI theme tokens before introducing new values.

## Typography

- Primary UI font: Space Grotesk.
- Use mono styling sparingly for metadata, slugs, filters, and system labels.
- Avoid decorative display styling in form labels and dense table content.
- Admin headings should be strong and system-like, but not rely on gradient text.

## Forms

- Labels are always visible and above controls.
- Required fields are marked in the label, not only in placeholder text.
- Placeholder text is an example or formatting hint, never the label.
- Use `name`, `id`, `autocomplete`, `aria-describedby`, and native constraints where useful.
- Show helper text before the input when it affects what the user types.
- Validation should not shout while typing. Prefer native `:user-invalid` timing with clear error copy and non-color cues where possible.
- Keep submit buttons enabled until a valid submit starts; disable during save to prevent double posts.

## Layout And Components

- Admin pages use a shared shell, consistent header rhythm, shared panels, and the same form vocabulary.
- Avoid nested cards. If a panel contains fields, use internal sections and fieldsets rather than more cards.
- Use generous top-level spacing and tighter field-group spacing for scanning.
- Tables and mobile record cards should expose the same primary state and actions.

## Motion And Interaction

- Transitions are short and state-driven, generally 150 to 250ms.
- Do not animate layout properties.
- Focus states must be visible for keyboard users.
- Loading states should preserve layout and make the pending action clear.
