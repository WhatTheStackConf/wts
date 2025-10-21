FROM node:22-alpine

# Install python3 and make which are needed for some node modules
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install pnpm
RUN npm install -g pnpm

# Enable pre and post scripts
ENV PNPM_ENABLE_PRE_POST_SCRIPTS=true

# Install dependencies
RUN pnpm install

# Copy source code
COPY . .

# Build the application with additional environment variables to handle platform-specific packages
RUN npm_config_fsevents=false pnpm build

# Expose port
EXPOSE 3000

# Start the application
CMD ["pnpm", "start"]