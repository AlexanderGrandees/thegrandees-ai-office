#!/bin/bash
# TGTI AI Office: удаление для Linux. Убирает службу, файлы и хуки.
set -euo pipefail
BASE="${XDG_DATA_HOME:-$HOME/.local/share}/tgti-ai-office"
UNIT="tgti-ai-office.service"
UNIT_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$UNIT"
systemctl --user disable --now "$UNIT" 2>/dev/null || true
rm -f "$UNIT_FILE"
systemctl --user daemon-reload 2>/dev/null || true
if [ -f "$BASE/src/install-hooks.mjs" ] && command -v node >/dev/null; then node "$BASE/src/install-hooks.mjs" --remove || true; fi
rm -rf "$BASE"
echo "TGTI AI Office удалён."
