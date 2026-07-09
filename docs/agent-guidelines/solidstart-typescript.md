# SolidStart And TypeScript

Use this when changing `.ts`, `.tsx`, SolidStart server functions, or browser/server boundary code.

## Imports And Components

- SolidStart uses `@solidjs/start` `2.0.0-alpha.2`; prefer existing local patterns over assumptions from stable docs.
- Use named imports from `solid-js`.
- Use the `~/*` alias for imports from `src/*`.
- For component prop types, prefer interfaces.
- Do not destructure component props; access values as `props.name` so Solid reactivity is preserved.

## SolidJS Control Flow

- Render iterables with `<For each={items}>{...}</For>` instead of `items.map()` in JSX.
- Render conditionals with `<Show when={condition} fallback={...}>` instead of `condition && ...` or ternaries.
- Use `<Switch>` and `<Match>` for multi-branch UI.
- Use `createResource` for async data loaded by components.

## Server Functions

- Define server functions with a `"use server"` directive at the top of the function body.
- Validate authentication and authorization inside every server function.
- Follow the existing `requireAdmin()` pattern for admin-only functions.
- Keep server function arguments and return values Seroval-serializable.
- Do not pass class instances, functions, DOM nodes, or other non-serializable objects across the server boundary.
- See `src/lib/admin-actions.ts` for existing server-function patterns.

## Client And Server Boundary

- This repo exposes both `PUBLIC_` and `VITE_` environment variables through Vite.
- Use `PUBLIC_POCKETBASE_URL` as the canonical browser-facing PocketBase URL.
- Keep private values in non-public environment variables and read them only on the server with `process.env`.
- Use `onMount` or a `typeof window !== "undefined"` guard for browser-only APIs such as Canvas and LocalStorage.
- Keep SSR and initial client render deterministic to avoid hydration mismatches.
