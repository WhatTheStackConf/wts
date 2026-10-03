FROM node:24.15.0-bookworm-slim@sha256:152aceace5c03e2597988763165ee33e3fd3633636db0fc983cd2e126b02cfde AS build
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
RUN pnpm --filter @wts/cfp install --frozen-lockfile
COPY tsconfig.json ./
COPY cfp ./cfp
COPY scripts/check-server-bundle.mjs ./scripts/check-server-bundle.mjs
RUN pnpm --filter @wts/cfp build \
    && pnpm --filter @wts/cfp deploy --prod /production

FROM node:24.15.0-bookworm-slim@sha256:152aceace5c03e2597988763165ee33e3fd3633636db0fc983cd2e126b02cfde AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    CFP_DATA_DIR=/app/data
COPY --from=build --chown=node:node /production/package.json ./package.json
COPY --from=build --chown=node:node /production/node_modules ./node_modules
COPY --from=build --chown=node:node /production/.output ./.output
COPY --from=build --chown=node:node /production/migrations ./migrations
COPY --from=build --chown=node:node /production/scripts ./scripts
COPY --from=build --chown=node:node /production/src ./src
RUN mkdir /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
