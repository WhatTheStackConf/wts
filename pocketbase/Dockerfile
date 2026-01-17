FROM alpine:latest

ARG PB_VERSION=0.34.0

RUN apk add --no-cache \
    unzip \
    ca-certificates \
    bash

# download and unzip PocketBase
ADD https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip /tmp/pb.zip
RUN unzip /tmp/pb.zip -d /pb/

# Copy entrypoint script and migrations
# Note: seed_data excluded as it does not exist in the project
COPY ./entrypoint.sh /pb/entrypoint.sh
COPY ./pb_migrations /pb/pb_migrations

# Make entrypoint script executable
RUN chmod +x /pb/entrypoint.sh

EXPOSE 8090

# Run entrypoint and start PocketBase
CMD ["/pb/entrypoint.sh", "/pb/pocketbase", "serve", "--dir=/pb/pb_data", "--http=0.0.0.0:8090"]