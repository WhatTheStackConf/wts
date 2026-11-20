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

The `/` landing page is the launch. Supporting pages use the light shell below. Private operational screens keep the established dark theme.

- Direction: "Section through the sky, from Skopje". The reader sits in the vehicle, so the viewport is the window. No rocket, plume, gantry, or drawn trajectory appears. The background carries all motion.
- Story: a page scroll is one climb from the ground in Skopje to orbit. The sky goes from warm ivory paper through cyan to navy. Navy appears only at orbit.
- Stations: page blocks carry `data-launch-station`. The hero is countdown (▽ +240 m), the about heading is liftoff (▽ ≈1 km), and the about copy is max-Q (▽ ≈12 km).
- More stations: the past editions are MECO (▽ ≈50 km), the signup is second burn (▽ 100 km), and the signup action is orbit (▽ ≈400 km). Datums show real values only.
- A station starts when its top crosses 40% of the viewport height. `reachableTops()` in `launch-model.ts` pulls low station tops up, so the reader can reach orbit at maximum scroll.
- Preserve the original WTS logo artwork and derive the palette from it. Keep self-hosted StarzoomShavian for display and Space Grotesk for body text. Do not use neon glow or gradient text.
- Content: the 2027 date, location, venue, programme, speakers, partners, and prices are not confirmed. Do not reuse 2026 facts as 2027 announcements. Avoid fake cockpit controls, telemetry, and invented metrics.
- Primary action: conference updates through the existing Listmonk newsletter dialog. The dialog uses native modal focus management and keeps its pending, error, and success states.

### Scene layers

- `LaunchScene.tsx` is one fixed full-viewport layer behind the whole page. Whole-document scroll progress drives it. The scene smooths the flight value itself, because the renderer applies no smoothing.
- Layer order from back to front: the static CSS sky, the opaque WebGL canvas, the nebula veils and cloud planes, then the DOM Skopje skyline. The opaque building fills hide the shader behind them.
- `launch-model.ts` is a pure model. `launchState(flight)` returns the uniforms for the sky altitude, horizon, ground, cloud rush, cloud floor, low clouds, nebula, shake, and night.
- `launch-renderer.ts` reads its palette from computed CSS (`--alt-0` to `--alt-7`, the orbit tokens, and `--launch-cyan`). The shader has no hard-coded colours.
- The skyline (`SkopjeSkyline.tsx`) is a hairline elevation in two planes. The far row holds the Goce Delčev dormitory and the MRT Center. The near row holds the Post Office, the GTC, and the City Wall.
- The future city layer (`skyline-future.tsx`) adds a maglev viaduct with a train, air taxis on dotted lanes, solar roofs, trees, and mast beacons. Do not add a launch tower or gantry.
- Countdown clouds and the upper-sky nebula are ordered-dither masks from `site/scripts/generate-cloud-masks.py` (seed 2027). They exist in every render mode. The `lowClouds` and `nebula` model channels fade them.
- On phones, the CSS ground line sets the countdown horizon through `--launch-ground-level`. `LaunchScene` reads that line and gives it to the model, so CSS stays the single source.

### Motion

- Motion follows a 100 BPM bar clock: a 600ms beat for reveals, a 150ms eighth note for staggers and state, and a 2.4s bar for loops.
- Liftoff and max-Q get a small background shake of about 1.5px. The shake moves only the scene.
- HUD boot: content blocks with `data-hud` open from a centre hairline and type in their real text. `hud-boot.ts` starts each block once it is in view. The hero stays static.
- Dither and glitch: the sky uses an ordered Bayer dot screen. Glitch hits are rare and subtle: 120ms long, every 6 to 14 bars, as thin row shifts with no colour split.
- Hero-to-header change: the brand and navigation dissolve in place through 16 Bayer mask steps, then resolve in the header. They do not travel. The `2027` year stays at 26px at every width.
- The header is light glass over the sky and changes to night glass at orbit through `data-sky="night"`.
- The scroll-driven change runs only when `CSS.supports` confirms `animation-timeline: scroll()` and motion is allowed. Other browsers show the compact header from the start.

### Rendering policy

- Paint a static CSS countdown sky first. The first WebGL frame must match it, with no flash. Load the renderer on idle.
- Skip WebGL for reduced motion, data saving, or missing WebGL. These modes get a per-section altitude gradient sky.
- Draw at most 30 frames per second on desktop and 24 on small viewports. Cap the device pixel ratio at 1.25 and the backing buffer at 600,000 pixels.
- Stop work offscreen and while the document is hidden. Context loss leaves the static composition. Animation must never block content, navigation, or newsletter signup.
- Reduced motion keeps every end state: no drift, no shake, no glitch, and no HUD boot. Text shows at once.

### Readability

- Every content block after the hero sits on a light glass panel with ink text. The signup panel is night glass with paper text. These panels keep text contrast at 4.5:1 or more over any sky.
- The signup ending centres between the header and the footer at maximum scroll. `Landing2027.tsx` publishes the footer height as `--orbit-footer-height`.
- Verify at 320, 360, 375, 390, 414, and 768 CSS pixels, and at desktop widths through 1920. Check contrast at each station, in reduced motion, and without WebGL.
- Motion control decision: the user asked for no visible pause button. Reduced-motion preferences control the motion. This is not a claim of [WCAG 2.2.2 conformance](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html), which needs a usable pause, stop, or hide mechanism.
- Dependencies: the launch renderer is project-owned WebGL with native browser scheduling. Do not add a general-purpose 3D or motion engine.

## Supporting Public Pages — WTS 2027

- Use the compact, non-morphing light glass header with the original logo, full WhatTheStack wordmark, and 2027 identity. Provide Home, The gathering, Past editions, Get updates, and a small Sign in/Profile entry. Navy appears only at orbit on the landing. The `data-sky="night"` header variant exists for that case only.

- The public header uses the same `PublicHeader` component on the landing and supporting pages. Supporting pages place the compact header inside a full-width sticky `.support-header` wrapper. Keep the header visible during scrolling without adding a hero transition.

- Use the shared `--orbit-header-height`: 90px on desktop and 64px below 768px. Below 768px the navigation moves into a Menu panel. Keep landing-only geometry scoped to `.orbit-cover-stage`. Production navigation keeps route stylesheets, so verify landing-to-legal navigation as well as direct page loads.
- The header glass blurs the page behind it. If the browser has no `backdrop-filter`, the header uses a paper-tinted solid fill. Keep the native scrollbar separate, with a visible muted thumb over the light page background.
- Keep the logo and navigation centered in the 1320px header content area.
- Reading surfaces use warm-ivory public tokens, ink text, and Space Grotesk for body text and prose headings. Footer layout comes from `public-support.css` on both the landing and supporting pages.
- A supporting page can open with an altitude band (`.support-band`). The band has a sky gradient, a label row, a StarzoomShavian title, and an optional lede. The 404 page uses the `lost` band variant.
- All supporting surfaces have square corners: panels, fields, buttons, the newsletter dialog, and prose images. Prose images get a hairline frame.
- Primary buttons use the `--color-orbit-accent` fill with `--color-orbit-accent-ink` text. On fine-pointer hover, the fill mixes 22% toward `--color-orbit-ink`. Do not use bright cyan as a button fill on light surfaces.
- Keep DaisyUI form controls. Public inputs, textareas, and selects use the lighter paper fill and muted-ink borders, not the card fill and divider color.
- Keep the amber keyboard-focus outline and 48px minimum field height. Disabled fields use the card fill and muted text.
- Do not add the launch planet, supporting-page hero, scroll-morphing brand, animated code background, conference/ticket menus, or ticket-sales calls to action to supporting pages.
- Preserve semantic landmarks, skip navigation, visible keyboard focus, 44px touch targets, responsive mobile navigation, reduced-motion behavior, and the native newsletter dialog.
- Scope supporting styles to each app's shell. The CFP applicant app uses the 2027 palette on all routes, including authenticated routes. Keep the existing root operational screens on their dark theme.
- Retired public routes return the shared 404 page: `/agenda`, `/speakers`, `/sessions`, `/sponsors`, `/timeline`, `/missions`, and `/qa`. Speaker details, speaker promo pages, and session details also return 404.
- Keep feedback invitations, the protected speaker guide, mission redemption, and private operational routes. MC question queues use `/mc?session=<slug>`.
- Remove navigation and admin preview links to retired pages. Keep the historical edition link at `https://2026.wts.sh`.

## Storybook — WTS 2027

The `design/` workspace package (`@wts/design`) is a Storybook of the 2027 design system. It is published at `https://design.wts.sh`.

- Run it locally with `pnpm --filter @wts/design storybook` on port 6007.
- Stories render the real code. Site and CFP stories mount the real Solid components. Auth stories render the real `renderPage()` HTML. Blog stories use the blog's global CSS with markup from its templates, because Storybook has no Astro renderer.
- Each story sets `parameters.app` to `site`, `cfp`, `auth`, or `blog`. The preview loads only that app's CSS, because each app has its own DaisyUI theme.
- Both Solid apps use the `~` alias. `design/vite.config.ts` resolves it from the importing file's app.
- Add a story when you add a shared component or control. The CI quality matrix builds Storybook, and a broken story fails the build.
- Stories use invented sample data. Never put real speaker or attendee data in a story.
- The Storybook frame uses the orbit theme in `design/.storybook/theme.ts`: paper, ink, the dark accent, and Space Grotesk. The hex values copy `site/tokens.css`. Change them together.
- The preview puts the app CSS first in `<head>`, as production does. CSS that a component imports loads after it.
- A story that is not a whole app page starts with an `.sb-page` title and a one-line note. CFP specimen pages sit on the CFP content column.
- Route CSS loads in the story file, as the route imports it. For example, the account stories import `site/src/styles/account.css`.
- `design/src/styles/blog-base.css` copies the global `<style>` block of `blog/src/layouts/Base.astro`. Change both together.
- The preview answers every request to Listmonk with a local 200. The newsletter story shows the real form, and Storybook never subscribes anyone.

## Flight controls — WTS 2027

All 2027 apps (site, auth, blog, cfp) use one control language. The reference recipes are in `design/src/flight-kit/flight-kit.css`, and the Storybook "Foundations/Flight kit" pages show each family. Each app copies the recipes onto its own class names: `site/src/styles/public-links.css`, `auth/public/account.css`, `blog/src/styles/controls.css`, and `cfp/src/styles/app.css`. Change these copies together.

- Primary actions are notched plates. The top-right and bottom-left corners have a 9px cut. Small items such as tags and pagination use a 6px cut.
- Secondary actions, icon buttons, tags, and pagination are 1px notched frames. A pressed tool (`aria-pressed="true"`) and the current page become plates.
- A disabled plate is a surface plate with muted text. It keeps its notch and has no border and no opacity change.
- Copy links in prose have a dotted 1px rule at rest, a 2px rule on hover and focus, and a solid rule on press. Inline links inside a sentence stay on the text line.
- Danger actions, such as revoke and reject, use the error-red plate.
- Draw fills and frames on `::before`, `::after`, or background layers. Declare `--ctl-plate` on each control. Never put `clip-path` on a focusable element, because it clips the focus outline.
- Hover and focus print a 3px dot screen. Press makes it 2px. The dots always move away from the text color, so a state never lowers text contrast.
- Focus is one 3px amber rectangle (`--color-orbit-focus`).
- Links in copy keep a dotted underline at rest. Nav links show a 2px dot rule on hover and focus, and a solid rule on the current page.
- Fields have the same notched frame: muted ink at rest, accent on hover, and 2px accent on focus with a dot rule that scans along the bottom. `:user-invalid` shows a 2px error frame.
- A select uses the field frame with the ▽ datum mark as its arrow. The mark turns over while the list is open. Where the browser supports `appearance: base-select`, CSS draws the open list with the menu recipe: a paper panel, a hairline border, two corner marks, and 44px rows. Hover and focus print a 3px dot screen, and the chosen row is bold with an accent square. The list opens below the field and flips above only when it does not fit. Browsers without `base-select` show their own list under the same framed field.
- A field that fails validation also shows one short error line directly below it. The line names the problem, for example "Enter a full email address, such as name@example.com.". The `field-errors` script writes the line on submit or after the user leaves a changed field. It sets `aria-invalid` and adds the line to `aria-describedby`, and it clears both when the value becomes valid. Each app has a copy: `site/src/lib/field-errors.ts`, `cfp/src/lib/field-errors.ts`, and `auth/public/field-errors.mjs`.
- Browsers force their own autofill colors and remove the frame layers. Redraw an autofilled field with inset shadows: a 2px accent ring over the field fill.
- Short field labels name a value and are tracked uppercase. A label that asks a full question uses sentence case at body size (`label-question` in cfp, `.fk-label.is-question` in the kit).
- Status chips and notices show a status square, and their text names the state. Green is active or accepted, amber is pending or stale, and red is rejected or revoked. An empty square means closed, not granted, or draft. Mix status colors `in oklab`, because `oklch` mixes of red drift to purple.
- Motion is stepped on the 150 ms eighth. Reduced motion keeps every end state with no scan, turn, or slide.

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
Its compact header uses light glass with the original WTS logo, the WhatTheStack wordmark, and a `CALL FOR PAPERS` label.
Pages and form fields use warm ivory with dark ink.
Primary actions obey the supporting-page primary button rule.
Keep Space Grotesk for body text, DaisyUI controls, and the amber keyboard-focus outline.
The semantic theme in `cfp/src/styles/app.css` owns the app's colors. All DaisyUI radii are 0.
The CFP tokens are a copy of `site/tokens.css`, because the CFP Docker build cannot import site files. If you change a shared token, change both files.
The existing root operational screens retain their dark theme.

### Auth and CFP task layouts

The independent auth and CFP apps retain the public supporting-page identity.
Both apps serve their fonts locally.

Auth uses an ALT 0 layout: a narrow form column with no band and no outer card.
The page title uses StarzoomShavian. Forms and controls use Space Grotesk.
Rules separate identity, shared profile, security, and consent details.
Password, recovery, and consent controls retain their existing behavior.
The auth stylesheet is `auth/public/account.css`.

CFP applicant pages open with the `PageBand` component (`cfp/src/components/PageBand.tsx`).
The index, applications list, and 404 use the tall band. Detail and form pages use the short band.
The band shows still streaks, corner marks, a label row, and a StarzoomShavian title.
The CFP landing shows the live submission status beside the next applicant action, as glass over the lower band.
The CFP header collapses navigation below 1024 pixels.
Its menu exposes the current page and closes after a route change.
Speaker profile fields form three groups: speaker details, links with speaking experience, and contact and travel. A labeled rule separates the groups.
The profile page holds every reusable speaker field. `/settings` sends the speaker to `/profile`.
Staff routes use the paper ground, a StarzoomShavian title, hairline panels, and underline tabs.
Staff filters use a compact grid.
Staff tables have hairline rules and uppercase headers, with no zebra stripes.
Wide staff tables scroll within their own named region, not the page.
Empty states, retry controls, and server-enforced permissions remain part of each workflow.

### CFP flow rules

- Call the thing a speaker sends a "talk proposal", or "proposal" for short, in all three roles.
- Do not show revision, operation, assessment, or witness numbers in visible copy. Keep them in requests only.
- Give each screen one primary action.
- Admin: the proposal list opens with status tabs. Gate state is one quiet row. Mail shows only as an alert when it fails.
- Admin: the proposal page starts with a Decision panel. Bulk decisions ask once and list the titles.
- Reviewer: score on a 1 to 5 scale of 48px cells, with anchors at 1, 3, and 5. "Save and next" is the primary action.
- The criterion definitions live in `CRITERION_HINTS` in `cfp/src/lib/staff-model.ts`. The CFP home page and the reviewer form use the same text.
- On phones, admin table rows become stacked cards with labels.
- Speaker: the proposal form has four steps: About you, Talk, Experience and travel, and Review.
- Speaker: when the name and bio are saved, the form opens at Talk with a "Speaking as" row. The speaker can go back to About you at any time.
- Speaker: the travel question shows in every proposal with the saved answer filled in. The answer saves to the profile.
- A button that acts as a text link uses `.link-button`, which has the same dotted underline as copy links.
- Admin: a decision stays private until an organizer uses "Send decision emails" on the proposal list. Each proposal gets one decision email, sent to the address of its latest submission.
- Admin: when a decision changes after its email, no new email goes out. The proposal page and the list show the mismatch, and the organizers contact the speaker.
- Speaker email copy lives in `cfp/src/lib/mail-copy.ts`. It uses the WTS voice: plain, honest, "we", with no IDs or revision numbers.

## Blog

The independent `blog/` app uses the ALT 1 supporting-page identity, the same haze as the site's legal pages. Reading pages (legal, MCP, blog) use ALT 1. The 404 pages keep the ALT 2 horizon.
On a post, the band title, the meta strip, the cover, and the table of contents share the page's left edge. Do not center the article grid under a left-aligned band.
`blog/tokens.css` is a copy of `site/tokens.css`. Keep the two files identical below the header comment.
The header uses light glass with the logo, the StarzoomShavian wordmark, and a `BLOG` label. Navigation, live search, and the Ctrl/⌘K shortcut stay in the header.
The `SkyBand` component (`blog/src/components/SkyBand.astro`) opens the home, posts, category, tag, search, page, and 404 routes.
On a post, the band holds the title, excerpt, and a meta strip with author, date, reading time, and tags. The cover sits below the band in a hairline frame.
Cards and the featured post use hairline panels with square corners. Corner marks show on hover and keyboard focus.
The posts index is a list of rows with a date column.
The table of contents uses a left hairline with an accent marker on the current item. It keeps `aria-current` in sync.
At 1100px and below, the table of contents sits above the post text as a collapsed hairline panel with a 48px "On this page" summary. A tap on a section link closes the panel. The `h2` stays outside `<details>`, because Chromium removes a heading inside `<summary>` from the accessibility tree.
Prose uses Space Grotesk headings, a line length of about 70 characters, accent links, and hairline tables.
The footer uses the site footer layout with the blog's own links.
