#!/bin/bash
# Script to download the latest PocketBase binary

# Determine OS and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

# Convert architecture names to PocketBase format
if [[ "$OS" == "linux" ]]; then
    PLATFORM="linux"
elif [[ "$OS" == "darwin" ]]; then
    PLATFORM="darwin"
else
    PLATFORM="windows"
fi

if [[ "$ARCH" == "x86_64" ]]; then
    ARCH="amd64"
elif [[ "$ARCH" == "aarch64" || "$ARCH" == "arm64" ]]; then
    ARCH="arm64"
fi

# Set extension for Windows
if [[ "$OS" == "mingw64_nt"* || "$OS" == "windows" ]]; then
    EXT=".exe"
else
    EXT=""
fi

# Download the latest version (v0.30.4)
BINARY_NAME="pocketbase_${PLATFORM}_${ARCH}.zip"
DOWNLOAD_URL="https://github.com/pocketbase/pocketbase/releases/download/v0.30.4/${BINARY_NAME}"

echo "Downloading PocketBase v0.30.4 for ${PLATFORM}/${ARCH}..."
curl -L -o pocketbase.zip $DOWNLOAD_URL

# Unzip and clean up
unzip pocketbase.zip
rm pocketbase.zip

# Make the binary executable
chmod +x pocketbase${EXT}

echo "PocketBase v0.30.4 binary downloaded. You can run it with: ./pocketbase --help"