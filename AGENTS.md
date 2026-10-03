# Agent Guidelines

WTS is a pnpm workspace for the conference site, shared auth, and blog.
The SolidStart site stays at the root, including CFP, reviewer, admin, PocketBase, and Velite workflows.
The `auth/` and `blog/` directories contain independent apps.
Open Event Platform stays in its separate repository.

- Package manager: pnpm `11.24.0`.
- Runtime: Node `>=24.15.0`.
- Install dependencies at the root with `pnpm install --frozen-lockfile`.
- Keep one root lockfile and workspace configuration.
- Use `pnpm dev` for local development. It starts PocketBase, Velite, and Vite.
- Use `pnpm build` for production builds, the server bundle check, and the check-in runtime.
- Use `pnpm test` for the configured Vitest suite.
- Use `pnpm check` for lint and `pnpm typecheck` for TypeScript checks.
- Write dates as `YYYY-MM-DD`.
- Use `pnpm build:all` and `pnpm typecheck:all` for every workspace app.
- Use `pnpm --filter @wts/auth` or `pnpm --filter @wts/blog` for app-specific commands.
- Read `auth/README.md` for auth work and `blog/README.md` for blog work.
- Use the repository root as the Docker build context for each app.
- Keep app databases, secrets, local uploads, and deployment settings separate.

Read task-specific guidance only when relevant:

- Project map and route layout: [docs/agent-guidelines/project-map.md](docs/agent-guidelines/project-map.md)
- SolidStart and TypeScript conventions: [docs/agent-guidelines/solidstart-typescript.md](docs/agent-guidelines/solidstart-typescript.md)
- PocketBase data and admin access: [docs/agent-guidelines/pocketbase.md](docs/agent-guidelines/pocketbase.md)
- Markdown and conference content: [docs/agent-guidelines/content.md](docs/agent-guidelines/content.md)
- Styling: [docs/agent-guidelines/styling.md](docs/agent-guidelines/styling.md)
- Deployment: [docs/agent-guidelines/deployment.md](docs/agent-guidelines/deployment.md)
- Issue tracker, triage labels, and domain docs: [docs/agent-guidelines/issue-workflow.md](docs/agent-guidelines/issue-workflow.md)
- Guideline structure and cleanup notes: [docs/agent-guidelines/README.md](docs/agent-guidelines/README.md)
