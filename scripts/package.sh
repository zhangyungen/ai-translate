#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
UNPACKED_DIR="$DIST_DIR/unpacked"
PKG_NAME="ai-translate-extension-$(date +%Y%m%d-%H%M%S).zip"
PKG_PATH="$DIST_DIR/$PKG_NAME"

mkdir -p "$DIST_DIR"
rm -rf "$UNPACKED_DIR"
mkdir -p "$UNPACKED_DIR"

cp "$ROOT_DIR/manifest.json" "$UNPACKED_DIR/"
cp -R "$ROOT_DIR/src" "$UNPACKED_DIR/"
cp "$ROOT_DIR/README.md" "$UNPACKED_DIR/"

cd "$UNPACKED_DIR"
zip -r "$PKG_PATH" . -x "*.DS_Store"

echo "Unpacked extension: $UNPACKED_DIR"
echo "Package created: $PKG_PATH"
