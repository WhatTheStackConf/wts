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

## Public Landing Variant — WTS 2027

The `/` landing page is the approved, unchanged public design. Retained legal pages, public not-found responses, authentication/recovery/verification, and basic-profile routes use the compact supporting-page shell below. Private operational screens keep the established dark theme.

- Direction: hopeful space exploration with restrained cyberpunk character. One full-width starry navy cover unites navigation, original hero copy, and the planetary scene. The measured `.launch-scene` host owns its opaque navy sky, nebula, and stars. Cyan-blue atmosphere and daylight remain inside the curved planet, whose lower body fades smoothly into warm-ivory paper. Preserve the original WTS logo artwork and derive the palette from it, used provisionally until a 2027 logo is supplied.
- Starfield: header, hero, and static navigation share one cover-wide scale and origin so the star pattern does not restart beneath the header. Preserve the independent subtle twinkles and the scene's lower fade.
- Preserve the logo artwork. Use its cyan family for readable actions, with small warm accents and warm ivory rather than pure-white light surfaces; do not carry over neon glows or gradient text. The hero/header foreground is warm ivory over navy; navigation actions use bright cyan with dark ink.
- Keep self-hosted StarzoomShavian for display and Space Grotesk for body/UI. Headings stay upright; practical information stays readable.
- Composition: foreground hero copy over a full-width planetary horizon, conference/community introduction, explicitly dated previous editions, and a statement footer. The scene belongs to the hero's background rather than a separate illustration column. Avoid fake cockpit controls, telemetry, and invented metrics.
- Primary action: conference updates through the existing Listmonk newsletter integration. The light dialog uses native modal focus management and retains pending/error/success states.
- Use an icon-only DaisyUI ghost button in the newsletter dialog's top-right corner. Keep its 48px target, accessible close label, visible focus, and neutral hover fill. Reserve heading space without a separate close-button row.
- Shared interactions live in `src/styles/public-links.css`. Public buttons use flat cyan or ivory surfaces without resting shadows. Arrows inherit the text color and have no background, divider, circle, or separate pressed surface.
- Navigation, inline actions, edition rows, and footer links share underline feedback and visible keyboard focus. Fine-pointer hover brightens cyan buttons but preserves ivory buttons. Reduced motion removes arrow travel. Footer links retain 44×44px minimum targets.
- All edition rows use the same padding and background. The year, description, and outbound arrow align across editions.
- Content: 2027 date, location, venue, programme, speakers, partners, and prices are not confirmed. Do not reuse 2026 facts as 2027 announcements.
- Implementation: homepage styles and uniquely named tokens in `tokens.css`. The unified cover uses a 90px desktop / 116px mobile compact header. In browsers supporting native scroll timelines when motion is allowed, the server-rendered resting navigation is already centered immediately beneath the 2027 lockup, with the same CSS geometry used after hydration; it travels right/up into the compact header opposite the brand, reversing on scroll-up. Unsupported browsers and reduced-motion use a readable, fixed compact-header navigation fallback while the centered lockup remains visible below it. The expanded height is measured from the rendered header and hero after fonts settle, then reserved in flow so the rest of the page does not jump. A compact navy starfield plane belongs to the cover header row; the measured `.launch-scene` host owns the opaque navy sky and the self-hosted static 1200×720 WebP nebula on its own CSS background plane at 0.43 opacity with `cover` sizing and the existing crop. Header and cover continue to share the inherited `--launch-starfield` treatment.
- Cover transition: `Landing2027.tsx` measures expanded cover and compact brand/navigation geometry on mount, after `document.fonts.ready`, on resize, and when reduced-motion preference changes. It reserves the expanded height and enables the morph only when `CSS.supports` confirms `animation-timeline: scroll()` and `animation-range: 0% 100%` while motion is allowed. CSS custom properties define the expanded logo/year sizes and shared resting navigation position; hydration reads that same computed navigation top to calculate travel. One accessible header home link holds the hero lockup—LogoSolo, the full WhatTheStack wordmark at every width, and 2027 below it. The native root scroll timeline moves that same brand left while the single navigation group—The gathering, Past editions, and Get updates—travels right/up from centered beneath 2027 into the compact header; horizontal arrival completes by 60%, vertical travel finishes at the compact alignment, and all movement reverses naturally with scroll position.
- Accessibility: keyboard-visible focus, native form validation, reduced-motion support, and responsive verification at 320, 375, 414, and 768 CSS pixels plus desktop widths through 1920 CSS pixels. Maintain high-contrast ivory foreground and cyan-on-navy actions across the dark upper hero; preserve the horizon composition without horizontal overflow.
- Hero motion: a massive, full-bleed upper hemisphere spans the full host width, with only its curved limb visible. Desktop geometry is normalized ellipse center `(0.5, 1.22)`, radii `(0.66, 0.48)`, crest near 74% height and side crossings near 91%; mobile keeps the crest at 74% with center `(0.5, 0.90)` and radii `(0.66, 0.16)` to avoid a tall, mountain-like arc. Its lower body eases from cyan through the shared pale-cyan mist into warm-ivory paper; softly layered cloud bands sit within the lower atmosphere, with no complete globe or Saturn-like orbit. A broader layered cyan/ivory rim carries a smooth traveling light highlight while the curve remains fixed. The hero contains no floating WTS logo or separate logo stage.
- Rendering policy: useful static SSR horizon, starfield, nebula, and cloud artwork first; defer the separate WebGL rim-energy enhancement until load, visibility, and idle time allow it. Initial reduced-motion or data-saving preferences skip both the renderer import and GPU initialization. Target 30 draws/sec on desktop and 24 for small viewports; cap DPR at 1.25 and the backing buffer at 600,000 pixels. Stop work offscreen and while the document is hidden; pause CSS star-twinkle timelines in place while inactive, and disable them when reduced motion is preferred. Reduced-motion changes also stop renderer motion. Route disposal releases the context.
- Motion control decision: the user explicitly requested no visible pause button for this decorative background. Follow reduced-motion preferences instead. Do not treat this preference-only design as a blanket claim of [WCAG 2.2.2 conformance](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html); the criterion requires a usable mechanism to pause, stop, or hide continuous nonessential motion.
- Failure policy: unavailable WebGL or context loss leaves the original static composition intact. Animation must never gate readable content, navigation, or newsletter signup.
- Dependencies: the launch renderer is project-owned WebGL with native browser scheduling, not a general-purpose 3D/motion engine. Kiro informed the horizon/depth direction only; its media and implementation are not copied.

## Supporting Public Pages — WTS 2027

- Use the compact, non-morphing navy header with the original logo, full WhatTheStack wordmark, and 2027 identity. Provide Home, The gathering, Past editions, Get updates, and a small Sign in/Profile entry.

- The public header uses the same `PublicHeader` component on the landing and supporting pages. Supporting pages place the compact header inside a full-width sticky `.support-header` wrapper. Keep the header visible during scrolling without adding a hero transition.

- Use the shared `--orbit-header-height`: 90px on desktop and 116px below 768px. Keep landing-only geometry scoped to `.orbit-cover-stage`. Production navigation retains route stylesheets, so verify landing-to-legal navigation as well as direct page loads.
- Extend the navy background across the content width without viewport-width calculations. Keep the native scrollbar separate, with a visible muted thumb over the light page background.
- Keep the logo and navigation centered in the 1320px header content area.
- Reading surfaces use warm-ivory public tokens, ink text, and Space Grotesk for body text and every heading level. Footer layout comes from `public-support.css` on both the landing and supporting pages.
- Keep DaisyUI form controls. Public inputs, textareas, and selects use the lighter paper fill and muted-ink borders, not the card fill and divider color.
- Keep the amber keyboard-focus outline and 48px minimum field height. Disabled fields use the card fill and muted text.
- Do not add the launch planet, supporting-page hero, scroll-morphing brand, animated code background, conference/ticket menus, or ticket-sales calls to action to supporting pages.
- Preserve semantic landmarks, skip navigation, visible keyboard focus, 44px touch targets, responsive mobile navigation, reduced-motion behavior, and the native newsletter dialog.
- Scope supporting styles to each app's shell. The CFP applicant app uses the 2027 palette on all routes, including authenticated routes. Keep the existing root operational screens on their dark theme.
- Retired public routes return the shared 404 page: `/agenda`, `/speakers`, `/sessions`, `/sponsors`, `/timeline`, `/missions`, and `/qa`. Speaker details, speaker promo pages, and session details also return 404.
- Keep feedback invitations, the protected speaker guide, mission redemption, and private operational routes. MC question queues use `/mc?session=<slug>`.
- Remove navigation and admin preview links to retired pages. Keep the historical edition link at `https://2026.wts.sh`.

## Exports

These exports describe only the WTS 2027 public landing variant. They do not replace the dark operational theme. `tokens.css` is canonical; the following adapters are optional portability references, not additional loaded stylesheets.

### CSS custom properties

```css
@import "./tokens.css";
/* Consume var(--color-orbit-paper), var(--font-orbit-body), etc.
   The canonical file contains the complete color, type, spacing and motion scale. */
```

### Tailwind v4

Import the canonical CSS before this adapter in a consuming project.

```css
@theme inline {
  --color-paper: var(--color-orbit-paper);
  --color-surface: var(--color-orbit-surface);
  --color-ink: var(--color-orbit-ink);
  --color-muted: var(--color-orbit-muted);
  --color-rule: var(--color-orbit-rule);
  --color-accent: var(--color-orbit-accent);
  --color-accent-ink: var(--color-orbit-accent-ink);
  --color-focus: var(--color-orbit-focus);
  --color-error: var(--color-orbit-error);
  --color-success: var(--color-orbit-success);
  --color-amber: var(--color-orbit-amber);
  --color-magenta: var(--color-orbit-magenta);
  --color-on-dark-muted: var(--color-orbit-on-dark-muted);
  --color-line-on-dark: var(--color-orbit-line-on-dark);
  --color-star-mask-dim: var(--color-orbit-star-mask-dim);
  --color-star-mask-mid: var(--color-orbit-star-mask-mid);
  --color-star-mask-bright: var(--color-orbit-star-mask-bright);
  --color-launch-cyan: var(--launch-cyan);
  --color-launch-star: var(--launch-star);
  --color-launch-star-sparkle: var(--color-orbit-star-sparkle);
  --color-launch-twinkle: var(--color-orbit-twinkle);
  --color-launch-star-shadow: var(--color-orbit-star-shadow);
  --color-launch-sky-night: var(--launch-sky-night);
  --color-launch-sky-upper: var(--launch-sky-upper);
  --color-launch-sky-horizon: var(--launch-sky-horizon);
  --color-launch-sky-daylight: var(--launch-sky-daylight);
  --color-launch-night-deep: var(--launch-night-deep);
  --color-launch-night-floor: var(--launch-night-floor);
  --font-display: var(--font-orbit-display);
  --font-body: var(--font-orbit-body);
  --spacing-orbit-1: var(--space-orbit-1);
  --spacing-orbit-2: var(--space-orbit-2);
  --spacing-orbit-3: var(--space-orbit-3);
  --spacing-orbit-4: var(--space-orbit-4);
  --spacing-orbit-6: var(--space-orbit-6);
  --spacing-orbit-8: var(--space-orbit-8);
  --spacing-orbit-12: var(--space-orbit-12);
  --spacing-orbit-16: var(--space-orbit-16);
  --spacing-orbit-24: var(--space-orbit-24);
  --text-small: var(--text-orbit-small);
  --text-body: var(--text-orbit-body);
  --text-lede: var(--text-orbit-lede);
  --text-section: var(--text-orbit-section);
  --text-display: var(--text-orbit-display);
  --ease-orbit: var(--ease-orbit-out);
}
```

### DTCG

The responsive CSS `clamp()` expressions remain in `tokens.css`; the dimension values below record their minimums with the responsive expressions retained as descriptions.

```json
{
  "orbit": {
    "color": {
      "$type": "color",
      "paper": { "$value": { "colorSpace": "oklch", "components": [0.97, 0.018, 82] } },
      "surface": { "$value": { "colorSpace": "oklch", "components": [0.93, 0.025, 78] } },
      "ink": { "$value": { "colorSpace": "oklch", "components": [0.24, 0.03, 245] } },
      "muted": { "$value": { "colorSpace": "oklch", "components": [0.46, 0.025, 245] } },
      "rule": { "$value": { "colorSpace": "oklch", "components": [0.86, 0.025, 78] } },
      "accent": { "$value": { "colorSpace": "oklch", "components": [0.43, 0.09, 225] } },
      "accent-ink": { "$value": { "colorSpace": "oklch", "components": [0.97, 0.018, 82] } },
      "focus": { "$value": { "colorSpace": "oklch", "components": [0.54, 0.15, 65] } },
      "error": { "$value": { "colorSpace": "oklch", "components": [0.52, 0.18, 25] } },
      "success": { "$value": { "colorSpace": "oklch", "components": [0.43, 0.12, 150] } },
      "amber": { "$value": { "colorSpace": "oklch", "components": [0.65, 0.16, 72] } },
      "magenta": { "$value": { "colorSpace": "oklch", "components": [0.56, 0.18, 335] } },
      "on-dark-muted": { "$value": { "colorSpace": "oklch", "components": [0.89, 0.025, 82] } },
      "line-on-dark": { "$value": { "colorSpace": "oklch", "components": [0.97, 0.018, 82], "alpha": 0.22 } },
      "star-mask-dim": { "$value": { "colorSpace": "oklch", "components": [0, 0, 0], "alpha": 0.16 } },
      "star-mask-mid": { "$value": { "colorSpace": "oklch", "components": [0, 0, 0], "alpha": 0.5 } },
      "star-mask-bright": { "$value": { "colorSpace": "oklch", "components": [0, 0, 0], "alpha": 0.84 } }
    },
    "launch": {
      "$type": "color",
      "cyan": { "$value": { "colorSpace": "oklch", "components": [0.78, 0.11, 205] } },
      "star": { "$value": { "colorSpace": "oklch", "components": [0.91, 0.025, 220] } },
      "star-sparkle": { "$value": { "colorSpace": "oklch", "components": [0.8629, 0.0469, 255.4] } },
      "twinkle": { "$value": { "colorSpace": "oklch", "components": [0.9322, 0.0328, 256.8] } },
      "star-shadow": { "$value": { "colorSpace": "oklch", "components": [0.8459, 0.0781, 253.4], "alpha": 0.28 } },
      "night-edge": { "$value": { "colorSpace": "oklch", "components": [0.31, 0.055, 231] } },
      "night-deep": { "$value": { "colorSpace": "oklch", "components": [0.18, 0.035, 245] } },
      "night-floor": { "$value": { "colorSpace": "oklch", "components": [0.12, 0.025, 245] } },
      "sky-night": { "$value": { "colorSpace": "oklch", "components": [0.19, 0.045, 250] } },
      "sky-upper": { "$value": { "colorSpace": "oklch", "components": [0.27, 0.07, 242] } },
      "sky-horizon": { "$value": { "colorSpace": "oklch", "components": [0.53, 0.105, 220] } },
      "sky-daylight": { "$value": { "colorSpace": "oklch", "components": [0.84, 0.055, 80] } },
      "alloy-light": { "$value": { "colorSpace": "oklch", "components": [0.86, 0.022, 224] } },
      "alloy-mid": { "$value": { "colorSpace": "oklch", "components": [0.65, 0.028, 236] } },
      "alloy-shadow": { "$value": { "colorSpace": "oklch", "components": [0.43, 0.03, 245] } },
      "alloy-deep": { "$value": "{orbit.color.ink}" }
    },
    "font": {
      "$type": "fontFamily",
      "display": { "$value": ["StarzoomShavian", "sans-serif"] },
      "body": { "$value": ["Space Grotesk", "sans-serif"] }
    },
    "space": {
      "$type": "dimension",
      "1": { "$value": { "value": 0.25, "unit": "rem" } },
      "2": { "$value": { "value": 0.5, "unit": "rem" } },
      "3": { "$value": { "value": 0.75, "unit": "rem" } },
      "4": { "$value": { "value": 1, "unit": "rem" } },
      "6": { "$value": { "value": 1.5, "unit": "rem" } },
      "8": { "$value": { "value": 2, "unit": "rem" } },
      "12": { "$value": { "value": 3, "unit": "rem" } },
      "16": { "$value": { "value": 4, "unit": "rem" } },
      "24": { "$value": { "value": 6, "unit": "rem" } }
    },
    "text": {
      "$type": "dimension",
      "small": { "$value": { "value": 0.8125, "unit": "rem" } },
      "body": { "$value": { "value": 1, "unit": "rem" } },
      "lede": { "$value": { "value": 1.125, "unit": "rem" }, "$description": "clamp(1.125rem, 1.6vw, 1.375rem)" },
      "section": { "$value": { "value": 2.25, "unit": "rem" }, "$description": "clamp(2.25rem, 5vw, 4.25rem)" },
      "display": { "$value": { "value": 3.5, "unit": "rem" }, "$description": "clamp(3.5rem, 6.4vw, 6.75rem)" }
    },
    "ease": { "$type": "cubicBezier", "$value": [0.16, 1, 0.3, 1] },
    "duration": { "$type": "duration", "$value": { "value": 160, "unit": "ms" } }
  }
}
```

### shadcn/ui semantic adapter

For a future shadcn consumer only. Keep this scoped; never apply it to the current operational routes.

```css
.landing-2027 {
  --background: var(--color-orbit-paper);
  --foreground: var(--color-orbit-ink);
  --card: var(--color-orbit-surface);
  --card-foreground: var(--color-orbit-ink);
  --popover: var(--color-orbit-paper);
  --popover-foreground: var(--color-orbit-ink);
  --primary: var(--color-orbit-accent);
  --primary-foreground: var(--color-orbit-accent-ink);
  --secondary: var(--color-orbit-surface);
  --secondary-foreground: var(--color-orbit-ink);
  --muted: var(--color-orbit-surface);
  --muted-foreground: var(--color-orbit-muted);
  --accent: var(--color-orbit-surface);
  --accent-foreground: var(--color-orbit-ink);
  --destructive: var(--color-orbit-error);
  --border: var(--color-orbit-rule);
  --input: var(--color-orbit-rule);
  --ring: var(--color-orbit-focus);
}
```

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
