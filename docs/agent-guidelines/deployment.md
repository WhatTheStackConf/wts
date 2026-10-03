# Deployment

Use this when changing Docker, production configuration, or deployment-sensitive environment handling.

- Production target: Coolify.
- Deployment strategy: Docker Compose.
- Root `Dockerfile` and `docker-compose.yml` define the conference site deployment.
- `auth/Dockerfile` and `auth/compose.yml` define the independent auth deployment.
- `blog/Dockerfile` and `blog/docker-compose.yml` define the independent blog deployment.
- `site/Dockerfile` and `site/compose.yml` define the independent 2027 SQLite deployment.
- `cfp/Dockerfile` and `cfp/compose.yml` define the independent CFP applicant deployment.
- Use the repository root as the build context for every app.
- Each Dockerfile installs from the root lockfile and builds only its selected package.
- Each app uses `pnpm deploy` to package its isolated production dependencies.
- Keep deployment secrets and persistent database volumes outside source archives and images.
- A workspace change does not authorize changes to live Coolify resources.
- Preserve the existing 2026 PocketBase deployment and its volumes.
- Mount the 2027 site's persistent SQLite and owned assets separately at `/app/data`.
- Initialize the selected edition explicitly before startup.
- Use the maintenance CLI for migrations and consistent backups.
- Restore into a new directory and verify records and assets with a replacement container.
- Keep session encryption keys outside database backups.
- Enable `SITE_TRUST_PROXY` only behind a proxy that replaces forwarded headers and blocks direct application access.
- Production OIDC client registration, callbacks, content imports, and deployment need separate authorization.
- Mount the CFP database separately at `/app/data`.
- Initialize its edition explicitly with `scripts/cfp-data.ts init EDITION`.
- New CFP editions remain closed until an operator opens them.
- CFP restore clears sessions and flows and closes every restored edition.
- Recover `CFP_SESSION_KEY` separately from the database backup.
- Enable `CFP_TRUST_PROXY` only behind a proxy that replaces forwarded headers and blocks direct application access.
- Build Podman images with `--format docker` to retain the Docker healthcheck.
- PocketBase has its own production Docker/Coolify service strategy.
- `PUBLIC_POCKETBASE_URL` must be reachable by the user's browser.
- `POCKETBASE_URL` may be Docker-internal and should be used only by server-side admin API calls.
