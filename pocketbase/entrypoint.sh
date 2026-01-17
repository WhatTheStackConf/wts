#!/bin/sh

# Function to create superuser via CLI
create_superuser() {
    local email="$1"
    local password="$2"

    echo "Attempting to create superuser via CLI..."

    # Use 'superuser upsert' which is idempotent and supports v0.22+
    if /pb/pocketbase superuser upsert "$email" "$password" --dir=/pb/pb_data 2>&1; then
        echo "Superuser created/updated successfully!"
        return 0
    else
        echo "Failed to create superuser."
        return 1
    fi
}

# Check for and move types.d.ts file if it exists
if [ -f "/pb/pb_data/types.d.ts" ]; then
    mv /pb/pb_data/types.d.ts /pb/pb_data/types.d.ts.backup 2>/dev/null || true
fi

# Apply migrations
# Note: --dir points to where data is stored. 
# Migrations are statically built or in pb_migrations if using Go as framework, 
# but here we are using the prebuilt binary so it looks for pb_migrations next to it or specified via flag.
# The Dockerfile copies migrations to /pb/pb_migrations.
if [ -d "/pb/pb_migrations" ]; then
    echo "Running migrations..."
    # PocketBase expects migrations in pb_migrations dir relative to execution or specified.
    # However, 'migrate' command doesn't always take --dir for MIGRATIONS, it takes --dir for DATA.
    # The migrations directory is auto-discovered if in the same folder as executable or ./pb_migrations
    # Let's explicitly try to run it.
    /pb/pocketbase migrate up --dir=/pb/pb_data --migrationsDir=/pb/pb_migrations
fi

# Create superuser if credentials are provided
if [ ! -z "$PB_SUPERUSER_EMAIL" ] && [ ! -z "$PB_SUPERUSER_PASSWORD" ]; then
    create_superuser "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD"
fi

# Start PocketBase server
echo "Starting PocketBase server..."
# We need to bind to 0.0.0.0 for Docker networking
exec /pb/pocketbase serve --http=0.0.0.0:8090 --dir=/pb/pb_data --migrationsDir=/pb/pb_migrations