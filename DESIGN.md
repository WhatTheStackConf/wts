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

## CFP applicant app

The independent `cfp/` app uses the 2027 supporting-page palette on every route, including authenticated applicant routes.
Its compact header uses navy with the original WTS logo.
Pages and form fields use warm ivory with dark ink.
Primary actions use cyan with dark ink.
Keep Space Grotesk, DaisyUI controls, and the amber keyboard-focus outline.
The semantic theme in `cfp/src/styles/app.css` owns the app's colors.
The existing root operational screens retain their dark theme.

### Auth and CFP task layouts

The independent auth and CFP apps retain the public supporting-page identity.
Starzoom Shavian appears in the compact wordmark only.
Headings, forms, navigation, and staff controls use Space Grotesk.
Both apps serve their fonts locally.

Auth uses a narrow form column without an outer card.
Rules separate identity, shared profile, security, and consent details.
Password, recovery, and consent controls retain their existing behavior.
The auth stylesheet is `auth/public/account.css`.

The CFP landing shows the live submission status beside the next applicant action.
The CFP header collapses navigation below 1024 pixels.
Its menu exposes the current page and closes after a route change.
Speaker profile fields form two groups: speaker details and links with speaking experience.
Staff filters use a compact grid.
Wide staff tables scroll within their own container, not the page.
Empty states, retry controls, and server-enforced permissions remain part of each workflow.
