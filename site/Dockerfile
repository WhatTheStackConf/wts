FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS build
WORKDIR /workspace
RUN npm install --global pnpm@11.24.0
RUN apt-get update \
    && apt-get install --no-install-recommends --yes python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY auth/package.json ./auth/package.json
COPY blog/package.json ./blog/package.json
COPY site/package.json ./site/package.json
COPY cfp/package.json ./cfp/package.json
RUN pnpm --filter @wts/site install --frozen-lockfile
COPY tsconfig.json ./
COPY site ./site
COPY scripts/check-server-bundle.mjs ./scripts/check-server-bundle.mjs
ARG PUBLIC_SITE_URL=https://wts.sh
ARG VITE_LISTMONK_LIST_ID=""
ARG VITE_TURNSTILE_SITE_KEY=""
ENV PUBLIC_SITE_URL=${PUBLIC_SITE_URL} \
    VITE_LISTMONK_LIST_ID=${VITE_LISTMONK_LIST_ID} \
    VITE_TURNSTILE_SITE_KEY=${VITE_TURNSTILE_SITE_KEY}
RUN pnpm --filter @wts/site build \
    && pnpm --filter @wts/site deploy --prod /production

FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    SITE_PUBLIC_DIR=/app/public \
    SITE_DATA_DIR=/app/data
COPY --from=build --chown=node:node /production/package.json ./package.json
COPY --from=build --chown=node:node /production/node_modules ./node_modules
COPY --from=build --chown=node:node /production/.output ./.output
COPY --from=build --chown=node:node /production/.output/public ./public
COPY --from=build --chown=node:node /production/migrations ./migrations
COPY --from=build --chown=node:node /production/scripts ./scripts
COPY --from=build --chown=node:node /production/src ./src
RUN mkdir /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
