#!/bin/bash
# TGTI AI Office: removes everything the macOS installer added.
#   curl -fsSL https://raw.githubusercontent.com/AlexanderGrandees/thegrandees-ai-office/main/macos/uninstall.sh | bash
APP="$HOME/Applications/TGTI AI Office.app"
SUP="$HOME/Library/Application Support/TGTI AI Office"
AGENT="$HOME/Library/LaunchAgents/com.thegrandees.aioffice.plist"
pkill -x AIOffice 2>/dev/null || true
NODE="$(cat "$SUP/node-path" 2>/dev/null || command -v node || true)"
if [ -n "$NODE" ] && [ -f "$APP/Contents/Resources/install-hooks.mjs" ]; then
  ( cd "$APP/Contents/Resources" && "$NODE" install-hooks.mjs --remove )
fi
rm -f "$AGENT"
rm -rf "$APP" "$SUP"
defaults delete com.thegrandees.aioffice 2>/dev/null || true
echo "Done: app, hooks, login item and Node.js copy are removed."
