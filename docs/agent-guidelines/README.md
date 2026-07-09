# Agent Guideline Index

This folder keeps task-specific guidance out of the root `AGENTS.md`. Open only the files that match the task at hand.

## Suggested Structure

- `AGENTS.md`: universal project facts and links only.
- `docs/agent-guidelines/project-map.md`: directories, route groups, and high-level architecture.
- `docs/agent-guidelines/solidstart-typescript.md`: SolidStart, SolidJS, TypeScript, server functions, and client/server boundaries.
- `docs/agent-guidelines/pocketbase.md`: PocketBase clients, admin access, migrations, and manual types.
- `docs/agent-guidelines/content.md`: Velite content rules.
- `docs/agent-guidelines/styling.md`: Tailwind, DaisyUI, and global stylesheet guidance.
- `docs/agent-guidelines/deployment.md`: Coolify and Docker Compose deployment facts.
- `docs/agent-guidelines/issue-workflow.md`: entrypoint for issue tracker, triage, and domain docs.
- `docs/agents/`: skill-specific tracker, triage, and domain configuration consumed by agent workflows.
- `docs/adr/`: optional architectural decision records.

## Contradiction Audit

- Resolved: the old root said only `VITE_` environment variables are public, while `vite.config.ts` exposes both `VITE_` and `PUBLIC_` and `README.md` documents `PUBLIC_POCKETBASE_URL` as canonical. Keep `PUBLIC_` plus `VITE_`, with `PUBLIC_POCKETBASE_URL` canonical for PocketBase.
- No other instruction-vs-instruction contradictions were found in the old root `AGENTS.md`.

## Deletion Candidates

- Full technology stack list: redundant with `README.md` and `package.json`; only the package manager, runtime, and non-standard scripts belong in root.
- `Use SolidJS primitives appropriately`: too vague; keep concrete SolidJS control-flow rules instead.
- PascalCase component names and camelCase variables/functions: standard TypeScript conventions, not repo-specific.
- `Ensure strict typing`: too broad to act on by itself; keep concrete PocketBase type sync and Seroval serialization rules instead.
- `Use utility classes for most styling`: broad and obvious; keep the Tailwind/DaisyUI/style entrypoint facts instead.
- `Be aware of potential API changes or instability`: vague; use the actionable SolidStart alpha guidance in `solidstart-typescript.md` instead.
- `Check src/app.css or index.css`: stale path; the app stylesheet is `src/styles/app.css`.
