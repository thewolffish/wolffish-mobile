#!/usr/bin/env bash
# Push the built demo dataset into the app's sandbox so demo mode can ingest
# it. iOS: booted simulator container. Android: app files dir via run-as.
#
# Conversations and config only — a few MB of JSON. The files those
# conversations reference are downloaded from cdn.wolffi.sh on first view, so
# there is no media to push.
#
#   scripts/demo/push-demo-data.sh          # iOS simulator (default)
#   scripts/demo/push-demo-data.sh android  # Android emulator/device via adb
set -euo pipefail

BUNDLE_ID="sh.wolffi.mobile"
SRC_DIR="$(cd "$(dirname "$0")/../.." && pwd)/demo-data"
TARGET="${1:-ios}"

if [[ ! -d "$SRC_DIR/conversations" ]]; then
  echo "demo-data/ not built — run: node scripts/demo/build-demo-data.mjs" >&2
  exit 1
fi

if [[ "$TARGET" == "ios" ]]; then
  CONTAINER="$(xcrun simctl get_app_container booted "$BUNDLE_ID" data)"
  DEST="$CONTAINER/Documents/demo-source"
  rm -rf "$DEST"
  mkdir -p "$DEST"
  cp -R "$SRC_DIR/conversations" "$SRC_DIR/manifest.json" \
    "$SRC_DIR/config-snapshot.json" "$DEST/"
  echo "pushed $(du -sh "$DEST" | cut -f1) to $DEST"
elif [[ "$TARGET" == "android" ]]; then
  # files/ dir of the app sandbox; expo-file-system Paths.document maps there.
  adb shell "run-as $BUNDLE_ID mkdir -p files" >/dev/null
  adb shell "run-as $BUNDLE_ID rm -rf files/demo-source" >/dev/null || true
  TMP="/data/local/tmp/wolffish-demo"
  adb shell "rm -rf $TMP" >/dev/null || true
  adb push "$SRC_DIR" "$TMP" >/dev/null
  adb shell "run-as $BUNDLE_ID cp -R $TMP files/demo-source"
  adb shell "rm -rf $TMP" >/dev/null || true
  echo "pushed demo-data to $BUNDLE_ID files/demo-source"
else
  echo "unknown target: $TARGET (use ios|android)" >&2
  exit 1
fi
