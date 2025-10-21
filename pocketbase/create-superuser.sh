#!/bin/bash

# Script to create a PocketBase superuser if one doesn't already exist
# This script will be called both in local and Docker setups

set -e  # Exit on any error

# Default values (can be overridden by environment variables)
SUPERUSER_EMAIL=${POCKETBASE_SUPERUSER_EMAIL}
SUPERUSER_PASSWORD=${POCKETBASE_SUPERUSER_PASSWORD}
POCKETBASE_DIR=${POCKETBASE_DIR:-"./pocketbase"}

echo "Creating/updating PocketBase superuser..."

# Path to the PocketBase binary
if [ -f "$POCKETBASE_DIR/pocketbase" ]; then
    POCKETBASE_BIN="$POCKETBASE_DIR/pocketbase"
elif [ -f "./pocketbase/pocketbase" ]; then
    POCKETBASE_BIN="./pocketbase/pocketbase"
else
    echo "Error: PocketBase binary not found"
    exit 1
fi

# Use the upsert command to create or update the superuser
# This command will create the user if it doesn't exist, or update if it does
echo "Using PocketBase binary at: $POCKETBASE_BIN"
"$POCKETBASE_BIN" superuser upsert "$SUPERUSER_EMAIL" "$SUPERUSER_PASSWORD"

echo "Superuser setup completed."
