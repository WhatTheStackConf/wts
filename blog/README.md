# WTS Blog

The WhatTheStack blog uses EmDash 1.0.1 and Astro server rendering. Its canonical URL is `https://blog.wts.sh`.

This project uses the approved WTS 2027 public theme. The reading surface has warm-ivory pages, a compact navy header, cyan links, and self-hosted WTS fonts. The project does not announce unconfirmed 2027 event details.

## Local development

The workspace uses Node.js 24.15.0 or later and pnpm 11.24.0. Run the commands below from the repository root.
The `@wts/blog` package lives in `blog/`. The root owns `pnpm-lock.yaml` and `pnpm-workspace.yaml`.
This import contains public source and seeds, not the old local database, uploads, users, or encryption key.

1. Install the workspace dependencies with `pnpm install --frozen-lockfile`.
2. Generate a new local key with `pnpm --filter @wts/blog exec emdash secrets generate`.
3. Save the key as `EMDASH_ENCRYPTION_KEY` in a new `blog/.env` file based on `blog/.env.example`.
4. Initialize the blog with the [fresh database procedure](#restore-a-fresh-local-database).
5. Open `http://localhost:4322/`.

These instructions use port 4322 to keep the original blog on port 4321 unchanged.
Astro 7 starts its development server as a background process.
Use `pnpm --filter @wts/blog exec astro dev status` to inspect it.
Use `pnpm --filter @wts/blog exec astro dev stop` to stop only the imported blog.

Use `localhost` for CMS access. Passkeys require a hostname, so the browser rejects `127.0.0.1` as a passkey site identifier.

| Surface | Local path |
| --- | --- |
| Blog | `/` |
| All posts | `/posts` |
| Post | `/posts/:slug` |
| Search | `/search` |
| RSS | `/rss.xml` |
| CMS | `/_emdash/admin/` |

Use Ctrl+K or Command+K to focus the header search. Public URL metadata uses the configured `https://blog.wts.sh` origin.

## Team content workflow

EmDash stores editable content in SQLite, not in Markdown files. Editors can manage posts, images, drafts, revisions, publication dates, and scheduled publication through the CMS. Public pages read the published content at request time. Content changes do not require a website rebuild.

The local migration uses EmDash's development authentication. EmDash creates its local `dev@emdash.local` user for that workflow. This is not a team account. The project does not contain production accounts or credentials for team members.

Remove the development user after a fresh migration, before you register your own admin. Otherwise, the setup wizard rejects signup because an admin exists.

For the real site, complete EmDash's setup wizard with your email and passkey. Configure team access and roles through EmDash before you grant access to other contributors. Do not enable development authentication in production.

To edit a post:

1. Open `/_emdash/admin/`.
2. Select **Posts**.
3. Open the post.
4. Save the draft.
5. Select **Publish changes** when the post is ready.

Comments are disabled. The old blog did not have comments, and this project does not add a moderation task.

## Existing posts

| Post | Original date | Slug |
| --- | --- | --- |
| Inside the CfP: How We Pick Talks at WhatTheStack | 2026-04-20 | `inside-the-cfp` |
| Behind the Scenes: What It Takes to Run WhatTheStack | 2026-04-06 | `behind-the-scenes-running-wts` |

Both posts retain the author **Darko from WhatTheStack**.
The seed preserves their excerpts, text, headings, emphasis, lists, links, and scoring table.
Historical 2026 facts remain in the original posts.

`blog/seed/source/` contains byte-identical copies of the original Markdown.
`blog/public/blog/iceberg-meme.jpg` contains the original image and preserves its old asset path.

Source: the [WTS repository at revision 75718cb297362deaaf4d8993aac4036c999b63f6](https://github.com/WhatTheStackConf/wts/tree/75718cb297362deaaf4d8993aac4036c999b63f6/content/blog).
The seed downloads its image from that immutable revision.
The fresh seed procedure creates a new local EmDash media copy.
It does not copy uploads from the old blog.

The new blog redirects `/blog/:slug` to `/posts/:slug` for the two imported posts. These rules apply only on the new blog host. The existing WTS site needs separate redirects when you approve the public cutover.

### Restore a fresh local database

Use this procedure only with a new local database in `blog/`.
Do not replace an edited database.
The seed is initial content, not an ongoing sync.
Keep the original blog directory unchanged.

1. Run `pnpm --filter @wts/blog seed` before the first development-server request.
2. Start the imported blog with `pnpm --filter @wts/blog dev --port 4322`.
3. Restore the original dates with `EMDASH_URL=http://localhost:4322 pnpm --filter @wts/blog import:dates`.

CAUTION: If real accounts exist, do not use the reset command. It deletes all local users.

4. Remove the new development admin with `curl --fail-with-body -X POST -H 'Origin: http://localhost:4322' http://localhost:4322/_emdash/api/setup/dev-reset`.
5. Complete the setup wizard at `http://localhost:4322/_emdash/admin/`.

The development-only reset preserves posts, publication dates, and media.
Do not run `import:dates` after you create real accounts.
The new local database and uploads stay in ignored `blog/data.db` and `blog/uploads/`.
Never initialize this workspace with private state from `/var/home/darko/Work/wts-blog`.

The seed preserves existing posts by default.
EmDash's seed format assigns the import date as the publication date.
`import:dates` uses the supported publish API to restore the two original dates.
It accepts only a local server and refuses posts with pending drafts.
It does not replace post content.

Use `pnpm --filter @wts/blog seed:generate` to regenerate the seed from the preserved source files.
The converter rejects unsupported Markdown instead of silently losing it.
It emits editable Portable Text, including the native EmDash table format.

## Cover images

Each post uses the CMS `featured_image` field. The homepage, post cards, and social-preview metadata reuse that field. Article pages show the cover below the title, byline, and excerpt. The caption in `featured_image.meta.caption` appears below the cover.

Set the media alt text and caption before you select a cover in the post editor. Covers remain optional. The illustration uses a padded ivory canvas to preserve all four profiles in different crops.

| Post | Cover source | Credit |
| --- | --- | --- |
| Inside the CfP | [Talking Opinions](https://openclipart.org/detail/337391/talking-opinions) | j4p4n, [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Behind the Scenes | [WTS26 Stage 3 crew photograph](https://photos.google.com/share/AF1QipPq_nJHUTHdSaP1X5tYpTO8hH5etAXjD8zWBWAXQMr72o02tqdckJOQW5hl6oF7pA/photo/AF1QipP8syTNAYm7X0w7vxe1NWXjfK6yaBKz-h8aFITR?key=SE4yODRsOWNvNkZHSEQ0Y01ENlJ5c3ZxZHdhZmtn) | lupebogi photography (@lupebogi), WTS 2026 |

The original photograph's EXIF verifies its credit. Both covers use local WebP files in the production CMS media library, not external image links. The original publication dates and iceberg meme remain unchanged.

The original seed does not contain these later cover changes. Use a site export or backup to preserve the current production content.

## Theme maintenance

| File | Purpose |
| --- | --- |
| `blog/tokens.css` | WTS public palette, fonts, and spacing |
| `blog/src/styles/theme.css` | Blog overrides and self-hosted font declarations |
| `blog/src/layouts/Base.astro` | WTS logo, navigation, and footer |
| `blog/src/pages/index.astro` | Editorial index |
| `blog/astro.config.mjs` | Canonical URL, server adapter, database, and media storage |

The original logo comes from the WTS project. The header and footer logos show **Blog** without a year. StarzoomShavian supplies the wordmark. Space Grotesk supplies body text and content headings. Change the theme tokens when the conference theme changes. Do not switch themes automatically at a calendar-year boundary.

## Build and deployment

Run `pnpm --filter @wts/blog typecheck` to check Astro and TypeScript.
Run `pnpm --filter @wts/blog build` to build the standalone Node server in `blog/dist/`.

`blog/Dockerfile` uses Node 24 and pnpm 11.24.0.
It installs only the blog dependency graph from the root lockfile with a frozen install.
The build uses the `@wts/blog` filter.
`pnpm deploy --prod` copies portable production dependencies and `dist/` into the runtime image.
The root workspace must set `injectWorkspacePackages: true`.
The root `.dockerignore` controls the build context and excludes private state.
The server runs as the `node` user.
The server build bundles ESM dependencies that Astro and EmDash otherwise expose as undeclared runtime imports.
The package declares Sharp at its existing `0.35.5` version so the portable image can load its native image library.
The package also declares `sanitize-html` at its existing `2.17.7` version so Node can load it as CommonJS.

EmDash stores database and upload paths in the build output.
The Dockerfile sets `DATABASE_PATH=/app/data/data.db` and `UPLOADS_DIRECTORY=/app/data/uploads` before the build and at runtime.
If you change these paths, rebuild the image.

The new `blog/.env` contains only the new local `EMDASH_ENCRYPTION_KEY`.
Production uses a separate key in Coolify.
Preserve each key with its database.
Never commit a key.

To start the local production build from the repository root, use:

```bash
HOST=127.0.0.1 PORT=4322 pnpm --filter @wts/blog exec node --env-file=.env dist/server/entry.mjs
```

To build a production image from the repository root, use:

```bash
docker build -f blog/Dockerfile -t wts-blog:local .
```

`blog/docker-compose.yml` uses `context: ..` and `dockerfile: blog/Dockerfile`.
The Compose routes, authentication origin, and `/app/data` volume remain unchanged.
The image does not contain the old database or uploads.
An empty volume initializes an empty blog without accounts or posts.
Use the fresh local database procedure to prepare the public seed before an initial content transfer.

Use [EmDash site transfer](https://docs.emdashcms.com/guides/site-transfer/) for later content transfers. Do not reapply the initial seed over team edits.

### Current Coolify deployment

The blog deployed on 2026-09-30. The existing WTS application and local account remain unchanged.

| Setting | Value |
| --- | --- |
| Public URL | `https://blog.wts.sh` |
| CMS | `https://blog.wts.sh/_emdash/admin/` |
| Project / environment | WTS / production |
| Server | `hetzner-one` |
| Service UUID | `ejzjdlbdeatc5po2ndzncgqb` |
| Image | `wts-blog:20260930-202250` |
| Server source | `/opt/wts-blog/releases/20260930-202250` |
| Persistent volume | `ejzjdlbdeatc5po2ndzncgqb_blog-data` |
| Volume mount | `/app/data` |
| Proxy network | `coolify` |
| Runtime authentication origin | `EMDASH_SITE_URL=https://blog.wts.sh` |

The production database contains both original posts and their publication dates. The upload directory contains the original image. The initial copy excludes local users, passkeys, sessions, and tokens. Production requires its own admin account.

Coolify builds from the server source directory. A stop can remove an unused image, so the Compose service includes a build context. Keep the server source directory. The local project does not deploy changes automatically.

The Compose file publishes no host port. Traefik routes HTTPS to container port 4321. The host uses Traefik 2.10, so the setup restriction uses `ipwhitelist`.

The deployed setup restriction permits the owner's current public IP, `31.11.67.147/32`. It protects setup endpoints except the public setup-status endpoint. Normal sign-in and public pages remain available from other networks.

The source Compose file defaults to `127.0.0.1/32`. Before you deploy another instance, replace that label value with the setup owner's public IP CIDR. Use a literal value because Coolify escapes variable expressions in custom labels.

If the owner's public IP changes before signup, update `traefik.http.middlewares.wts-blog-setup-allowed.ipwhitelist.sourcerange` in Coolify's Compose configuration. Restart only the blog service afterward.

### First production signup

Existing posts are already present. Do not import them again.

The credential-free initial database must keep `emdash:setup_complete=false` until the production admin exists. Removing local accounts does not clear this flag automatically.

On 2026-10-01, the initial copy still had the local completion flag but no users. The site step rejected **Continue** as already complete. The repair cleared only that flag after a database backup. Both original posts and the image remained unchanged.

The live database and retained initial copy now have the correct flag. Do not clear it after production accounts exist. The repair backup is `/app/data/backups/setup-state-before-20261001.db` inside the persistent volume.

1. Open `https://blog.wts.sh/_emdash/admin/` from the permitted network.
2. Select **Empty site** to skip sample content.
3. Select **Continue** with the prefilled site details.
4. Enter your email for the production admin account.
5. Create your passkey through the browser prompt.

The local passkey belongs to `localhost`. Production uses `blog.wts.sh`. After you sign in, configure team roles and an email provider before you invite contributors.

### Restart and future changes

To restart the current service:

```bash
coolify service restart ejzjdlbdeatc5po2ndzncgqb
```

For a new release:

1. Copy the complete workspace source to a new directory under `/opt/wts-blog/releases/`.
2. Set `build.context` to that workspace directory in Coolify's Compose configuration.
3. Set `build.dockerfile` to `blog/Dockerfile`.
4. Set the image tag for that release.
5. Restart the service with the command above.

Keep the existing volume and production encryption key. Do not replace the database with the initial copy after editors create content.

### Backups

The database and uploads survive container replacement. Automatic backups are not configured. Back up the persistent volume and the production encryption key before maintenance.

Use SQLite's backup API or stop the service before you copy its database. Do not copy only `data.db` while the server runs because SQLite can have active WAL data.

The server release directory contains the credential-free initial database copy. It is not a backup of later editorial changes.

The cover update created `/app/data/backups/covers-before-2026-10-01T08-40-21.035Z.db` with mode `0600`. This database backup contains the state before the cover update, not the new cover media.

## EmDash references

- [Getting started](https://docs.emdashcms.com/getting-started/)
- [Content and editorial workflow](https://docs.emdashcms.com/guides/working-with-content/)
- [Authentication and roles](https://docs.emdashcms.com/guides/authentication/)
- [Seed format](https://docs.emdashcms.com/themes/seed-files/)
- [Node.js deployment](https://docs.emdashcms.com/deployment/nodejs/)
