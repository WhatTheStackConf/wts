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
RUN pnpm install --frozen-lockfile --dangerously-allow-all-builds

COPY . .
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