# Styling

Use this when changing styles, layout, or UI components.

- Tailwind CSS v4 and DaisyUI are the project styling stack.
- Use DaisyUI component classes for existing patterns. Scope supporting-page controls to the Orbit tokens in `src/styles/public-support.css`.
- Global styles live in `src/styles/app.css`.
- Preserve established local design patterns unless the task explicitly asks for a redesign.
- Public 2027 landing styles remain scoped to the landing. Import the supporting-page stylesheet from `src/App.tsx` so server-rendered headers receive styles at first paint. Legal, not-found, authentication, recovery, verification, and basic-profile routes use the compact shell in `src/components/PublicPageShell.tsx`. Keep private operational pages on the dark theme.
