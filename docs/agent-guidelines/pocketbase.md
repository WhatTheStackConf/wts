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
