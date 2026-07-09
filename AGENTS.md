# Agent Guidelines

WTS is a SolidStart conference app for the WhatTheStack 2026 public site, CFP/reviewer/admin workflows, PocketBase data, and Velite content.

- Package manager: `pnpm`.
- Runtime: Node `>=22.13.0`.
- Use `pnpm dev` for local development; it starts PocketBase, Velite watch, and Vite.
- Use `pnpm build` for production builds; it runs `velite && vite build`.
- Use `pnpm test` for the configured Vitest suite.
- No dedicated lint or typecheck script is configured.
- Write dates as `YYYY-MM-DD`.

Read task-specific guidance only when relevant:

- Project map and route layout: [docs/agent-guidelines/project-map.md](docs/agent-guidelines/project-map.md)
- SolidStart and TypeScript conventions: [docs/agent-guidelines/solidstart-typescript.md](docs/agent-guidelines/solidstart-typescript.md)
- PocketBase data and admin access: [docs/agent-guidelines/pocketbase.md](docs/agent-guidelines/pocketbase.md)
- Velite content: [docs/agent-guidelines/content.md](docs/agent-guidelines/content.md)
- Styling: [docs/agent-guidelines/styling.md](docs/agent-guidelines/styling.md)
- Deployment: [docs/agent-guidelines/deployment.md](docs/agent-guidelines/deployment.md)
- Issue tracker, triage labels, and domain docs: [docs/agent-guidelines/issue-workflow.md](docs/agent-guidelines/issue-workflow.md)
- Guideline structure and cleanup notes: [docs/agent-guidelines/README.md](docs/agent-guidelines/README.md)
