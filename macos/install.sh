#!/bin/bash
# TGTI AI Office: installer for macOS.
# Run in Terminal:  curl -fsSL https://raw.githubusercontent.com/AlexanderGrandees/thegrandees-ai-office/main/macos/install.sh | bash
# What it does (no admin password needed):
#   1. downloads the ready app into ~/Applications/TGTI AI Office.app;
#   2. uses Node.js if it is installed, otherwise downloads a private copy of Node.js LTS
#      into ~/Library/Application Support/TGTI AI Office (PATH is not changed);
#   3. adds the hooks for Claude Code and Codex;
#   4. starts the app at login and opens it now.
# The office server runs only while the app is open and stops when you quit it.
# Running it again updates everything. Uninstall: curl -fsSL .../macos/uninstall.sh | bash
set -euo pipefail
REPO="AlexanderGrandees/thegrandees-ai-office"
APP="$HOME/Applications/TGTI AI Office.app"
SUP="$HOME/Library/Application Support/TGTI AI Office"
AGENT="$HOME/Library/LaunchAgents/com.thegrandees.aioffice.plist"
say() { printf '  %s\n' "$*"; }
step() { printf '\n\033[36m> %s\033[0m\n' "$*"; }
printf '\n\033[35mTGTI AI Office: installing\033[0m\n'
[ "$(uname)" = "Darwin" ] || { echo "This installer is for macOS."; exit 1; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
FRESH=1; [ -f "$SUP/version" ] && FRESH=0   # first install on this Mac (updates rerun this script)

step "Downloading the app"
pkill -x AIOffice 2>/dev/null || true
if [ -n "${TGTI_APP_ZIP:-}" ]; then cp "$TGTI_APP_ZIP" "$TMP/app.zip"
else curl -fsSL "https://github.com/$REPO/releases/download/mac-latest/TGTI-AI-Office-mac.zip" -o "$TMP/app.zip"; fi
mkdir -p "$HOME/Applications" "$SUP"
rm -rf "$APP"
ditto -x -k "$TMP/app.zip" "$HOME/Applications/"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
say "installed: $APP"

step "Checking Node.js"
node_ok() { [ -x "$1" ] && [ "$("$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 18 ]; }
NODE=""
if [ -z "${TGTI_FORCE_PORTABLE_NODE:-}" ]; then
  for c in "$(command -v node 2>/dev/null || true)" /opt/homebrew/bin/node /usr/local/bin/node "$SUP/node/bin/node"; do
    if [ -n "$c" ] && node_ok "$c"; then NODE="$c"; break; fi
  done
fi
if [ -n "$NODE" ]; then say "using $NODE ($("$NODE" -v))"
else
  say "Node.js not found: downloading a private copy of Node.js LTS (about 50 MB)"
  curl -fsSL https://nodejs.org/dist/index.tab -o "$TMP/index.tab"
  VER="$(awk -F'\t' 'NR>1 && $10!="-" {print $1; exit}' "$TMP/index.tab")"
  ARCH="$(uname -m)"; [ "$ARCH" = "arm64" ] || ARCH="x64"
  curl -fsSL "https://nodejs.org/dist/$VER/node-$VER-darwin-$ARCH.tar.gz" -o "$TMP/node.tgz"
  rm -rf "$SUP/node"; mkdir -p "$SUP/node"
  tar -xzf "$TMP/node.tgz" -C "$SUP/node" --strip-components 1
  NODE="$SUP/node/bin/node"
  say "Node.js $VER is in $SUP/node (only for the office)"
fi
printf '%s\n' "$NODE" > "$SUP/node-path"

# version for the automatic updates (the office checks GitHub twice a day and reruns this installer quietly)
VERSION=local
if [ -z "${TGTI_APP_ZIP:-}" ]; then
  VERSION="$(curl -fsSL "https://github.com/$REPO/releases/download/mac-latest/VERSION" 2>/dev/null || echo local)"
fi
printf '%s\n' "$VERSION" > "$SUP/version"

step "Adding hooks for Claude Code and Codex"
( cd "$APP/Contents/Resources" && "$NODE" install-hooks.mjs | sed 's/^/  /' )

step "Start at login"
mkdir -p "$(dirname "$AGENT")"
cat > "$AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.thegrandees.aioffice</string>
  <key>ProgramArguments</key><array><string>/usr/bin/open</string><string>-a</string><string>$APP</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>
PLIST
say "the app opens after login (switch it off in the menu bar icon > Запускати при вході)"

# anonymous install counter: on the first install only, download a tiny empty file from GitHub; the author sees only its download count (nothing is sent)
if [ "$FRESH" = 1 ] && [ -z "${GITHUB_ACTIONS:-}" ]; then
  curl -fsSL -m 10 "https://github.com/$REPO/releases/download/stats/install-mac.txt" -o /dev/null 2>/dev/null || true
fi

if [ -z "${TGTI_NO_OPEN:-}" ]; then open "$APP"; fi
printf '\n\033[32mDone.\033[0m\n'
say "The office is now your desktop wallpaper. On a MacBook with a notch, touch the notch with the mouse."
say "Menu bar icon (building): wallpaper, notch panel, season, weather, sound, quit."
say "Codex: open Codex, type /hooks and trust the AI-Office hooks once."
