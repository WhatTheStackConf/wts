# Deployment

Use this when changing Docker, production configuration, or deployment-sensitive environment handling.

- Production target: Coolify.
- Deployment strategy: Docker Compose.
- Root `Dockerfile` and `docker-compose.yml` define the app deployment.
- PocketBase has its own production Docker/Coolify service strategy.
- `PUBLIC_POCKETBASE_URL` must be reachable by the user's browser.
- `POCKETBASE_URL` may be Docker-internal and should be used only by server-side admin API calls.
