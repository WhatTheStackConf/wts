FROM alpine:latest

ARG PB_VERSION=0.39.7

RUN apk add --no-cache \
    unzip \
    ca-certificates \
    bash

# download and unzip PocketBase
ADD https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip /tmp/pb.zip
RUN echo "0fe09a4e1a8f6e5b53d206c2e6b94a5812febcb43082d66d69bc8ba4d8e8429c  /tmp/pb.zip" | sha256sum -c - \
    && unzip /tmp/pb.zip -d /pb/

# Copy entrypoint script and migrations
# Note: seed_data excluded as it does not exist in the project
COPY ./entrypoint.sh /pb/entrypoint.sh
COPY ./pb_migrations /pb/pb_migrations
COPY ./pb_hooks /pb/pb_hooks
COPY ./pb_public /pb/pb_public

# Make entrypoint script executable
RUN chmod +x /pb/entrypoint.sh

EXPOSE 8090

# Run entrypoint and start PocketBase
CMD ["/pb/entrypoint.sh", "/pb/pocketbase", "serve", "--dir=/pb/pb_data", "--http=0.0.0.0:8090"]