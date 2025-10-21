#!/bin/sh

# Function to create superuser via CLI
create_superuser() {
    local email="$1"
    local password="$2"

    echo "Attempting to create superuser via CLI..."

    # Try to create the superuser
    if /pb/pocketbase admin create "$email" "$password" --dir=/pb/pb_data 2>&1; then
        echo "Superuser created successfully!"
        return 0
    else
        echo "Failed to create superuser. It may already exist."
        return 1
    fi
}

# Check for and move types.d.ts file if it exists
if [ -f "/pb/pb_data/types.d.ts" ]; then
    mv /pb/pb_data/types.d.ts /pb/pb_data/types.d.ts.backup 2>/dev/null || true
fi

# Apply migrations if needed
if [ -d "/pb/pb_migrations" ] && [ ! -z "/pb/pb_migrations" ]; then
    echo "Running migrations..."
    /pb/pocketbase migrate up --dir=/pb/pb_migrations
fi

# Create superuser if credentials are provided
if [ ! -z "$PB_SUPERUSER_EMAIL" ] && [ ! -z "$PB_SUPERUSER_PASSWORD" ]; then
    create_superuser "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD"
else
    echo "Warning: PB_SUPERUSER_EMAIL or PB_SUPERUSER_PASSWORD not set, skipping superuser creation"
fi

# Start PocketBase server
echo "Starting PocketBase server..."
/pb/pocketbase serve --http=0.0.0.0:8090 --dir=/pb/pb_data