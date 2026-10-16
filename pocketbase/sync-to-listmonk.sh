#!/bin/bash
# One-time sync of existing PocketBase users to listmonk
# Usage: ./sync-to-listmonk.sh
#
# Required env vars (set in .env.local or export manually):
#   POCKETBASE_SUPERUSER_EMAIL
#   POCKETBASE_SUPERUSER_PASSWORD
#   LISTMONK_USERNAME
#   LISTMONK_API_TOKEN

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

load_env() {
    if [ -f "$SCRIPT_DIR/../.env.local" ]; then
        source <(grep -E '^(POCKETBASE_|LISTMONK_)' "$SCRIPT_DIR/../.env.local")
    elif [ -f "$SCRIPT_DIR/../.env" ]; then
        source <(grep -E '^(POCKETBASE_|LISTMONK_)' "$SCRIPT_DIR/../.env")
    fi
}

require_vars() {
    for var in POCKETBASE_SUPERUSER_EMAIL POCKETBASE_SUPERUSER_PASSWORD LISTMONK_USERNAME LISTMONK_API_TOKEN; do
        if [ -z "${!var}" ]; then
            echo "Error: $var is not set"
            exit 1
        fi
    done
}

authenticate() {
    echo "Authenticating with PocketBase at $PB_URL..."
    TOKEN=$(curl -s "$PB_URL/api/collections/_superusers/auth-with-password" \
        -H "Content-Type: application/json" \
        -d "{\"identity\":\"$POCKETBASE_SUPERUSER_EMAIL\",\"password\":\"$POCKETBASE_SUPERUSER_PASSWORD\"}" \
        | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")

    if [ -z "$TOKEN" ]; then
        echo "Error: Failed to authenticate with PocketBase"
        exit 1
    fi
}

count_status() {
    local status="$1"
    local subscriber="$2"
    if [ "$status" = "200" ]; then
        echo "  + $subscriber"
        ((SYNCED++))
    elif [ "$status" = "409" ]; then
        echo "  ~ $subscriber (already exists)"
        ((SKIPPED++))
    else
        echo "  ! $subscriber (HTTP $status)"
        ((FAILED++))
    fi
}

sync_items() {
    while IFS=$'\x1f' read -r email name; do
        [ -z "$email" ] && continue

        STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$LISTMONK_URL/api/subscribers" \
            -u "$LISTMONK_USERNAME:$LISTMONK_API_TOKEN" \
            -H "Content-Type: application/json" \
            -d "{\"email\":\"$email\",\"name\":\"$name\",\"status\":\"enabled\",\"lists\":[$LISTMONK_LIST_ID],\"preconfirm_subscriptions\":true}")

        count_status "$STATUS" "$email"
    done <<< "$ITEMS"
}

load_env

PB_URL="${PB_REMOTE_URL:-https://pb-2026.wts.sh}"
LISTMONK_URL="${LISTMONK_REMOTE_URL:-https://listmonk.wts.sh}"
LISTMONK_LIST_ID="${LISTMONK_LIST_ID:-2}"

require_vars
authenticate

# Fetch all users (paginate)
echo "Fetching users..."
PAGE=1
SYNCED=0
SKIPPED=0
FAILED=0

while true; do
    RESPONSE=$(curl -s "$PB_URL/api/collections/users/records?perPage=100&page=$PAGE&fields=email,name" \
        -H "Authorization: $TOKEN")

    TOTAL=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('totalItems',0))")
    ITEMS=$(echo "$RESPONSE" | python3 -c "
import sys, json
items = json.load(sys.stdin).get('items', [])
for item in items:
    print(item.get('email','') + '\x1f' + item.get('name',''))
")

    if [ -z "$ITEMS" ]; then
        break
    fi

    sync_items

    TOTAL_PAGES=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('totalPages',1))")
    if [ "$PAGE" -ge "$TOTAL_PAGES" ]; then
        break
    fi
    ((PAGE++))
done

echo ""
echo "Done. Total: $TOTAL users"
echo "  Synced:  $SYNCED"
echo "  Skipped: $SKIPPED (already in listmonk)"
echo "  Failed:  $FAILED"
