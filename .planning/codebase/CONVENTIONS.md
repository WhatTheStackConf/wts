# Coding Conventions

**Analysis Date:** 2026-03-29

## Naming Patterns

**Files:**
- Components: PascalCase `.tsx` files (e.g., `src/components/Hero.tsx`, `src/components/Navbar.tsx`, `src/components/RichEditor.tsx`)
- Library/utility modules: kebab-case `.ts` files (e.g., `src/lib/auth-service.ts`, `src/lib/cfp-store.ts`, `src/lib/pocketbase-utils.ts`)
- Route pages: kebab-case `.tsx` files (e.g., `src/routes/login.tsx`, `src/routes/confirm-password-reset.tsx`)
- CFP step routes: numbered prefix pattern `NN-name.tsx` (e.g., `src/routes/cfp/01-intro.tsx`, `src/routes/cfp/02-personal.tsx`)
- Sub-components in directories: PascalCase within a lowercase directory (e.g., `src/components/cfp/CfpStepLayout.tsx`, `src/components/admin/AdminProposalsTable.tsx`)

**Functions:**
- Use camelCase for all functions: `handleEmailLogin`, `fetchApplicantData`, `submitProposal`
- Event handlers: prefix with `handle` (e.g., `handleNext`, `handleInputChange`, `handleEmailLogin`)
- Async data fetchers: prefix with `fetch` (e.g., `fetchApplicantData`, `fetchProposals`, `fetchReviewerSubmissions`)
- Boolean checkers: prefix with `is` (e.g., `isAuthenticated`, `isCfpOpen`)
- Server action functions: prefix with `admin` for admin operations (e.g., `adminCreateEvent`, `adminFetchAllUsers`)

**Variables:**
- Signals: camelCase, destructured as `[value, setValue]` (e.g., `[email, setEmail]`, `[error, setError]`)
- Constants: UPPER_SNAKE_CASE for true constants (e.g., `CFP_DEADLINE` in `src/lib/cfp-utils.ts`)
- Store: camelCase (e.g., `cfpStore`, `setCfpStore` in `src/lib/cfp-store.ts`)

**Types/Interfaces:**
- PascalCase with descriptive suffixes: `Record` for PocketBase records, `Props` for component props
- Examples: `UserRecord`, `CfpSubmissionRecord`, `AuthContextType`, `CfpStepLayoutProps`, `LayoutProps`
- Defined in `src/lib/pocketbase-types.ts` for data models
- Co-located with component/module for local types

## Code Style

**Formatting:**
- No Prettier or formatting tool configured
- Double quotes for strings (consistent across codebase)
- Semicolons used consistently
- 2-space indentation (inferred from files)
- Trailing commas in multi-line constructs

**Linting:**
- No ESLint, Biome, or other linter configured
- No `.editorconfig` file present
- Code style is maintained manually

## Import Organization

**Order (observed pattern):**
1. Framework imports from `solid-js`, `solid-js/store`, `solid-js/web`
2. Router/meta imports from `@solidjs/router`, `@solidjs/meta`, `@solidjs/start`
3. Third-party library imports (e.g., `pocketbase`, `@iconify-icon/solid`)
4. Local library imports using `~/lib/*` alias
5. Local component imports using `~/components/*` alias or relative paths
6. Asset imports (SVGs, JSON, CSS)

**Path Aliases:**
- `~/` maps to `./src/` (configured in `tsconfig.json` as `~/*`)
- `.velite` maps to `./.velite` (for content system)
- Mixed usage: some files use `~/` alias, others use relative `../` paths. Prefer `~/` alias for consistency.

**Client-only imports pattern:**
```typescript
import { clientOnly } from "@solidjs/start";
const LoginMenu = clientOnly(() => import("./LoginMenu"));
const RichEditor = clientOnly(() => import("../../components/RichEditor"));
```
Use `clientOnly()` wrapper for components that require browser APIs (e.g., Lottie animations, rich text editors, newsletter popups). This is critical for SSR compatibility.

## Component Patterns

**All components are functional.** No class components anywhere.

**Named export for reusable components:**
```typescript
// src/components/Navbar.tsx
export const Navbar = () => { ... };

// src/components/Hero.tsx
export const Hero = () => { ... };
```

**Default export for route pages:**
```typescript
// src/routes/index.tsx
export default function Home() { ... }
```

**Client-only default export pattern for interactive pages:**
```typescript
// src/routes/login.tsx
const LoginPage = () => { ... };
export default clientOnly(async () => ({ default: LoginPage }), { lazy: true });
```

**Props interface pattern:**
```typescript
interface LayoutProps {
  children: JSX.Element;
  title?: string;
  description?: string;
}

export const Layout = (props: LayoutProps) => { ... };
```

**SolidJS reactivity primitives used:**
- `createSignal` for local state
- `createEffect` for side effects
- `createStore` + `makePersisted` for complex persisted state (see `src/lib/cfp-store.ts`)
- `onMount` for client-side initialization
- `onCleanup` for teardown (event listeners, timers, animation frames)
- `Show` for conditional rendering
- `Suspense` for async boundaries

**Context pattern:**
```typescript
// src/lib/auth-context.tsx
const AuthContext = createContext<AuthContextType>();

export const AuthProvider = (props: { children: any }) => {
  // ... setup signals and effects
  return (
    <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
```

## Styling Approach

**Primary: Tailwind CSS v4 + DaisyUI v5**
- Configured via `src/styles/app.css` with `@import "tailwindcss"` (Tailwind v4 syntax)
- DaisyUI loaded as plugin with custom `wts` theme
- PostCSS configured in `postcss.config.mjs`

**Custom theme colors defined in `src/styles/app.css`:**
- `primary-*` (hue 330, pink/magenta)
- `secondary-*` (hue 85, gold/amber)
- `dark-*` (hue 270, deep purple/dark)
- `accent-*` (hue 180, cyan)
- Custom fonts: `--font-sans: "Space Grotesk"`, `--font-star: "StarzoomShavian"`

**DaisyUI component classes used extensively:**
- `btn`, `btn-primary`, `btn-outline`, `btn-lg`
- `input`, `input-bordered`, `textarea`
- `navbar`, `drawer`, `menu`
- `glass-panel` (custom `@utility` defined in app.css)
- `form-control`, `label`

**Custom CSS utilities defined via `@utility` in `src/styles/app.css`:**
- `glass-panel` - frosted glass effect
- `glass-panel-light` - lighter frosted glass
- `glass-sweep` - animated sweep overlay
- `glitch-text-brand` - cyberpunk text effect
- `wts-root-bg` - root background gradient
- `wts-overlay` - scanline overlay

**Inline Tailwind classes on elements (no CSS modules, no styled-components):**
```tsx
<div class="text-2xl font-bold font-star text-white mb-6 flex items-center gap-3">
```

## TypeScript Usage

**Strictness:** `strict: true` in `tsconfig.json`

**Type assertion patterns:**
- Heavy use of `as unknown as Type` for PocketBase record casting:
  ```typescript
  const currentRecord = pb.authStore.record as unknown as UserRecord | null;
  ```
- Use `as any` for escape hatches in specific spots (e.g., SVG component props, meta fields)

**Server function typing:**
- Server actions use `"use server"` directive
- Return type pattern: `{ success: true, data: T } | { success: false, error: string }`
  ```typescript
  return { success: true, data: result };
  return { success: false, error: (error as Error).message };
  ```

**Interface definitions centralized in `src/lib/pocketbase-types.ts`:**
- All PocketBase collection types extend `RecordModel`
- Type guard functions provided: `isUserRecord()`, `isCfpApplicantRecord()`, etc.

## Error Handling

**Client-side pattern: try/catch with signal-based error display:**
```typescript
const [error, setError] = createSignal("");

try {
  await someAction();
} catch (err: any) {
  console.error("Context:", err);
  setError(err.message || "Fallback message");
}
```

**Server action pattern: try/catch returning success/error object:**
```typescript
export const adminCreateEvent = async (eventData: any) => {
  "use server";
  try {
    await requireAdmin();
    const adminService = getAdminPB();
    const result = await adminService.createRecord("events", eventData);
    return { success: true, data: result };
  } catch (error) {
    console.error("Admin create event error:", error);
    return { success: false, error: (error as Error).message };
  }
};
```

**Auth guard pattern (server-side):**
- `requireAdmin()`, `requireAuth()`, `requireReviewer()` in `src/lib/admin-security.ts`
- These throw errors on failure, caught by the wrapping try/catch
- Always called as first line inside `"use server"` functions

**Client-side auth guard (route-level):**
```typescript
const auth = useAuth();
if (!auth || !auth.record) navigate("/login");
```

## Logging

**Framework:** `console` (no structured logging library)

**Patterns:**
- `console.error("Context description:", error)` for all caught errors
- `console.warn(...)` for non-critical issues (e.g., failed auto-update)
- `console.log(...)` occasionally for debugging (e.g., `console.log(e)` in `src/routes/cfp/03-proposal.tsx` line 41 -- likely leftover debug)

## Comments

**When to Comment:**
- Inline comments explain "why" decisions, not "what" (e.g., `// Enforce verification` in auth-context)
- Section dividers used: `// --- Sub-components ---`, `// --- Main Controller Component ---`
- JSDoc/TSDoc used on `src/lib/admin-security.ts` functions with `@returns` tags
- TODO-style comments minimal

**JSDoc usage:** Sparse. Only `src/lib/admin-security.ts` has proper JSDoc blocks. Most functions have no documentation.

## Function Design

**Size:** Most functions are small (under 30 lines). Components can be large (Hero.tsx is 378 lines with sub-components).

**Parameters:** Direct parameter lists for simple functions. Object destructuring for complex inputs. Props always typed via interfaces.

**Return Values:**
- Server actions: `{ success: boolean, data?: T, error?: string }`
- Auth functions: return data or throw
- Utility functions: return primitive values

## Module Design

**Exports:**
- Named exports for utilities and reusable components
- Default exports for route page components
- Re-exports: `src/lib/pocketbase-utils.ts` re-exports `pb` from `src/lib/pocketbase.ts`

**Barrel Files:** Not used. Each module is imported directly by path.

**Server vs Client separation:**
- `"use server"` directive marks server-only functions
- `clientOnly()` wrapper marks browser-only components
- `src/lib/admin-security.ts` and `src/lib/pocketbase-admin-service.ts` are server-only modules
- `src/lib/pocketbase.ts` is the client-side PocketBase singleton

---

*Convention analysis: 2026-03-29*
