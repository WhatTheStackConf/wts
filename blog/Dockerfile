FROM node:24-bookworm-slim AS dependencies
WORKDIR /workspace
RUN npm install --global pnpm@11.24.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY auth/package.json ./auth/package.json
COPY blog/package.json ./blog/package.json
COPY site/package.json ./site/package.json
COPY cfp/package.json ./cfp/package.json
RUN pnpm --filter @wts/blog... install --frozen-lockfile

FROM dependencies AS build
# EmDash embeds these paths in the server bundle when Astro builds it.
ENV DATABASE_PATH=/app/data/data.db \
    UPLOADS_DIRECTORY=/app/data/uploads
COPY blog/astro.config.mjs blog/tsconfig.json blog/emdash-env.d.ts blog/tokens.css ./blog/
COPY blog/src ./blog/src
COPY blog/public ./blog/public
COPY blog/seed ./blog/seed
RUN pnpm --filter @wts/blog build \
    && pnpm --filter @wts/blog deploy --prod /production

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321 \
    DATABASE_PATH=/app/data/data.db \
    UPLOADS_DIRECTORY=/app/data/uploads
COPY --from=build --chown=node:node /production/package.json ./package.json
COPY --from=build --chown=node:node /production/node_modules ./node_modules
COPY --from=build --chown=node:node /production/dist ./dist
RUN mkdir -p /app/data/uploads \
    && chown -R node:node /app/data
USER node
EXPOSE 4321
CMD ["node", "./dist/server/entry.mjs"]
