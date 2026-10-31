#!/bin/bash
# TGTI AI Office: удаление для Linux. Убирает службу, файлы и хуки. Повторный запуск безопасен.
set -euo pipefail
BASE="${XDG_DATA_HOME:-$HOME/.local/share}/tgti-ai-office"
UNIT="tgti-ai-office.service"
UNIT_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$UNIT"
systemctl --user disable --now "$UNIT" 2>/dev/null || true
systemctl --user reset-failed "$UNIT" 2>/dev/null || true
rm -f "$UNIT_FILE"
systemctl --user daemon-reload 2>/dev/null || true
if [ -f "$BASE/src/install-hooks.mjs" ]; then
  if command -v node >/dev/null; then node "$BASE/src/install-hooks.mjs" --remove || true
  else
    echo "node was not found, so the hooks for Claude Code and Codex were left in place."
    echo "Remove them by hand: delete the entries that mention hook.mjs from ~/.claude/settings.json and ~/.codex/hooks.json."
  fi
fi
rm -rf "$BASE"
echo "TGTI AI Office removed."
echo "If you added the autostart line (exec-once / exec ... tgti-ai-office.service) to hyprland.conf or the sway config, delete it."
