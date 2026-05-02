#!/usr/bin/env bash
set -e

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIAN="$REPO/kian"
LINK="/usr/local/bin/kian"

# Install dependencies
echo "Installing dependencies..."
cd "$REPO/tools/node" && npm install --silent
cd "$REPO"

# Create symlink
ln -sf "$KIAN" "$LINK"
echo "Installed: kian -> $KIAN"
echo ""
echo "Run 'kian help' to get started."
