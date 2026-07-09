# Project Map

Use this when changing routing, module placement, or high-level app behavior.

## Directories

- `src/routes`: SolidStart file-system routes.
- `src/components`: reusable UI components.
- `src/lib`: shared utilities, API clients, services, and server actions.
- `src/lib/pocketbase.ts`: browser-facing PocketBase singleton.
- `src/lib/pocketbase-types.ts`: manual PocketBase collection types.
- `src/lib/hievents.ts`: HiEvents integration logic.
- `content`: Markdown and MDX content managed by Velite.
- `pocketbase`: local PocketBase executable, hooks, migrations, and scripts.
- `public`: static assets.
- `src/styles/app.css`: global Tailwind and DaisyUI stylesheet.

## Route Areas

- `/`: public pages.
- `/admin/*`: protected admin dashboard.
- `/reviewer/*`: protected reviewer interface.
- `/cfp/*`: CFP flow and submission views.
- `/api/*`: SolidStart API routes.

## Architecture

- Client tier: browser-facing auth and public views, including direct PocketBase Web API calls where collection API rules enforce access.
- Server tier: privileged admin, reviewer, webhook, and cross-collection operations through SolidStart server functions and server-side PocketBase admin access.
