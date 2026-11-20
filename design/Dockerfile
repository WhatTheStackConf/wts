# Build context: the repository root. Storybook reads the source and CSS of site, cfp, auth and blog.
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS build
WORKDIR /workspace
RUN npm install --global pnpm@11.24.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY auth/package.json ./auth/package.json
COPY blog/package.json ./blog/package.json
COPY site/package.json ./site/package.json
COPY cfp/package.json ./cfp/package.json
COPY design/package.json ./design/package.json
RUN pnpm --filter @wts/design --filter @wts/site --filter @wts/cfp install --frozen-lockfile
COPY tsconfig.json ./
COPY site ./site
COPY cfp ./cfp
COPY auth/src ./auth/src
COPY auth/public ./auth/public
COPY blog/tokens.css ./blog/tokens.css
COPY blog/src/styles ./blog/src/styles
COPY design ./design
RUN pnpm --filter @wts/design build

FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
COPY --from=build --chown=node:node /workspace/design/server.mjs ./server.mjs
COPY --from=build --chown=node:node /workspace/design/storybook-static ./storybook-static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
