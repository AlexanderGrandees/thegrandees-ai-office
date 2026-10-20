#!/bin/bash
# Builds "TGTI AI Office.app" (universal: Apple Silicon + Intel). Needs Xcode Command Line Tools.
# Usage: macos/build.sh [output folder]   (default: build/)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-build}"
APP="$OUT/TGTI AI Office.app"
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos12.0" -o "$OUT/AIOffice-$arch" macos/main.swift -framework Cocoa -framework WebKit
done
lipo -create -output "$APP/Contents/MacOS/AIOffice" "$OUT/AIOffice-arm64" "$OUT/AIOffice-x86_64"
rm -f "$OUT"/AIOffice-arm64 "$OUT"/AIOffice-x86_64
cp macos/Info.plist "$APP/Contents/"
cp index.html office-server.mjs hook.mjs install-hooks.mjs test-agent.mjs LICENSE "$APP/Contents/Resources/"
cp -R fonts "$APP/Contents/Resources/"
codesign --force --deep -s - "$APP"
echo "built: $APP"
