#!/bin/bash
# Script to start PocketBase server locally with automatic superuser creation

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Function to source environment variables safely
source_env_file() {
    local env_file="$1"
    if [ -f "$env_file" ]; then
        echo "Loading environment variables from $env_file"
        # Use while loop to read each line and export only valid variables
        while IFS= read -r line || [ -n "$line" ]; do
            # Skip empty lines and comments
            if [[ $line =~ ^[^#]*= ]] && [ -n "$line" ]; then
                # Remove any trailing characters that might cause issues
                line=$(echo "$line" | sed 's/[^[:print:]]*$//')
                export "$line"
            fi
        done < "$env_file"
    fi
}

# Source environment variables if available
if [ -f "$SCRIPT_DIR/../.env.local" ]; then
    source_env_file "$SCRIPT_DIR/../.env.local"
elif [ -f "$SCRIPT_DIR/../.env" ]; then
    source_env_file "$SCRIPT_DIR/../.env"
fi

# Path to the PocketBase binary (in the same directory)
POCKETBASE_PATH="$SCRIPT_DIR/pocketbase"

# Check if PocketBase binary exists
if [ ! -f "$POCKETBASE_PATH" ]; then
    echo "PocketBase binary not found at $POCKETBASE_PATH"
    echo "Please download it first using the get-pocketbase.sh script"
    exit 1
fi

# Create or update the superuser account
echo "Setting up superuser account..."
"$SCRIPT_DIR/create-superuser.sh"

# Start PocketBase server
echo "Starting PocketBase server..."
"$POCKETBASE_PATH" serve --dir="$SCRIPT_DIR/pb_data" --http=127.0.0.1:8090
