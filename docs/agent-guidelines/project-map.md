# Project Map

Use this when changing routing, module placement, or high-level app behavior.

## Directories

- The repository root is the `what-the-stack` workspace package.
- `site`: independent `@wts/site` 2027 public application with server-owned SQLite and central OIDC.
- `site/src/server`: private storage, immutable public mapping, owned assets, and account sessions.
- `site/migrations`: explicit checksum-verified SQLite migrations.
- `site/scripts/site-data.ts`: local imports, migrations, edition roles, backups, and restore.
- `site/README.md`: initialization, account boundaries, and container replacement.
- `cfp`: independent `@wts/cfp` applicant app with its own SQLite and central OIDC client.
- `cfp/src/server`: private applicant transitions, storage, and OIDC sessions.
- `cfp/src/lib/cfp-model.ts`: shared speaker, settings, presentation, draft, and receipt types.
- `cfp/scripts/cfp-data.ts`: explicit migrations, edition closure, online backups, and new-directory restore.
- The root README documents CFP initialization and recovery.
- `auth`: independent `@wts/auth` shared identity app.
- `blog`: independent `@wts/blog` EmDash and Astro app.
- `pnpm-workspace.yaml`: package membership, dependency catalog, overrides, and build permissions.
- `pnpm-lock.yaml`: the shared dependency graph for every workspace package.
- Open Event Platform remains outside this repository.

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
