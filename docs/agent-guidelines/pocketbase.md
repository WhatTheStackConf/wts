# PocketBase

Use this when changing data access, auth, migrations, PocketBase hooks, or collection types.

## Clients

- Use the default export from `~/lib/pocketbase.ts` for browser-facing PocketBase operations.
- Use server-side admin access for privileged operations that cannot be enforced with PocketBase API rules.
- Use `getAdminPB()` from `~/lib/pocketbase-admin-service` for server-side admin operations.
- Never import server-side admin services into client-side code.

## Server Actions And Security

- Validate authentication and authorization inside server functions before using admin access.
- Prefer existing helpers such as `requireAdmin()` for protected admin operations.
- Keep browser-facing file URLs based on the public PocketBase base URL, not Docker-internal service URLs.

## Schema And Types

- PocketBase migrations live in `pocketbase/pb_migrations`.
- PocketBase hooks live in `pocketbase/pb_hooks`.
- Manual collection types live in `src/lib/pocketbase-types.ts`.
- When changing the schema, follow `PB_TYPES_GUIDE.md` and update the TypeScript types in the same change.
- `pnpm generate:pb-types` is only a manual reminder; it does not generate types automatically.

## Conference Capability Availability

- `conference_config.availability` contains independent boolean `cfp` and `review` flags. Missing, malformed, duplicate, or unreadable configuration is unavailable.
- `cfp_open` must also be true for CFP access; it never enables review. Do not restore deadline-based or default-open behavior.
- The `1790200000_add_conference_capability_availability.js` migration removes direct client writes to `conference_config`. Only the narrow, server-validated 2027 closed-CFP preparation action can write it.
- Set `WTS_2027_ADMIN_USER_IDS` to a comma-separated list of explicitly approved PocketBase user IDs before allowing 2027 CFP preparation. Each listed account must also currently have the `admin` role. Reviewers and historical admins are not implicitly approved.
- Keep tests and disposable workspaces explicit: enable only the capability under test; suites that exercise both CFP and review must explicitly enable both in synthetic configuration. Never use production credentials or data.
- Dormant CFP and reviewer paths return HTTP 404, including trailing-slash variants; `CapabilityRouteBoundary` also blocks workflow content on client-side navigation. Server actions and PocketBase hooks enforce the same capability before protected reads or writes.
- Run `pnpm test:auth` for capability-policy and disposable PocketBase enforcement coverage.
