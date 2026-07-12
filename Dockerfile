# Stage 1: Base
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Stage 2: Build
FROM base AS build
# Install python3 and make which are needed for some node modules
RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --dangerously-allow-all-builds

COPY . .

# Public values baked into the browser bundle.
ARG PUBLIC_POCKETBASE_URL
ARG VITE_POCKETBASE_URL
ARG VITE_LISTMONK_LIST_ID
ARG VITE_TURNSTILE_SITE_KEY
ARG PUBLIC_SITE_URL=https://wts.sh
ENV PUBLIC_POCKETBASE_URL=${PUBLIC_POCKETBASE_URL}
ENV VITE_POCKETBASE_URL=${VITE_POCKETBASE_URL:-$PUBLIC_POCKETBASE_URL}
ENV VITE_LISTMONK_LIST_ID=${VITE_LISTMONK_LIST_ID}
ENV VITE_TURNSTILE_SITE_KEY=${VITE_TURNSTILE_SITE_KEY}
ENV PUBLIC_SITE_URL=${PUBLIC_SITE_URL}

RUN npm_config_fsevents=false pnpm build

# Stage 3: Runner
FROM base AS runner
WORKDIR /app

# Create a non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 solidjs

# Copy only necessary files from build
COPY --from=build --chown=solidjs:nodejs /app/.output ./.output
COPY --from=build --chown=solidjs:nodejs /app/package.json ./package.json

# Switch to non-root user
USER solidjs

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
