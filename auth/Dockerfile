FROM node:24.15.0-bookworm-slim@sha256:152aceace5c03e2597988763165ee33e3fd3633636db0fc983cd2e126b02cfde AS build
WORKDIR /app
RUN npm install --global pnpm@11.24.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY auth/package.json ./auth/package.json
COPY blog/package.json ./blog/package.json
COPY site/package.json ./site/package.json
COPY cfp/package.json ./cfp/package.json
RUN pnpm --filter @wts/auth install --frozen-lockfile
COPY auth/tsconfig.json ./auth/
COPY auth/src ./auth/src
COPY auth/migrations ./auth/migrations
COPY auth/public ./auth/public
COPY auth/scripts/provision-runtime.mjs ./auth/scripts/provision-runtime.mjs
COPY public/favicon.svg ./auth/public/favicon.svg
COPY public/fonts/space-grotesk-latin.woff2 public/fonts/space-grotesk-latin-ext.woff2 ./auth/public/fonts/
COPY src/assets/images/LogoSolo.svg ./auth/public/logo.svg
RUN pnpm --filter @wts/auth build
RUN pnpm --filter @wts/auth deploy --prod /prod/auth

FROM node:24.15.0-bookworm-slim@sha256:152aceace5c03e2597988763165ee33e3fd3633636db0fc983cd2e126b02cfde AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /prod/auth/package.json ./package.json
COPY --from=build --chown=node:node /prod/auth/node_modules ./node_modules
COPY --from=build --chown=node:node /prod/auth/dist ./dist
COPY --from=build --chown=node:node /prod/auth/migrations ./migrations
COPY --from=build --chown=node:node /prod/auth/public ./public
COPY --from=build --chown=node:node /prod/auth/scripts ./scripts
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
