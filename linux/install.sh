#!/bin/bash
# TGTI AI Office: установщик для Linux (Wayland: Hyprland, Sway и другие с wlr-layer-shell).
# Запуск в терминале:  curl -fsSL https://raw.githubusercontent.com/AlexanderGrandees/thegrandees-ai-office/main/linux/install.sh | bash
# Что делает (без прав администратора):
#   1. скачивает исходники в ~/.local/share/tgti-ai-office/src;
#   2. собирает маленькое окно обоев (нужны системные библиотеки, см. ниже);
#   3. добавляет хуки для Claude Code и Codex;
#   4. ставит пользовательскую службу systemd, которая запускает офис при входе в сессию.
# Повторный запуск обновляет всё. Удаление: curl -fsSL .../linux/uninstall.sh | bash
set -euo pipefail
REPO="AlexanderGrandees/thegrandees-ai-office"
BASE="${XDG_DATA_HOME:-$HOME/.local/share}/tgti-ai-office"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="tgti-ai-office.service"
say() { printf '  %s\n' "$*"; }
step() { printf '\n\033[36m> %s\033[0m\n' "$*"; }
printf '\n\033[35mTGTI AI Office: installing\033[0m\n'
[ "$(uname)" = "Linux" ] || { echo "This installer is for Linux."; exit 1; }

step "Checking tools and libraries"
missing=()
for m in gtk+-3.0 gtk-layer-shell-0 webkit2gtk-4.1; do pkg-config --exists "$m" || missing+=("$m"); done
command -v cc >/dev/null || missing+=("cc (компилятор C)")
command -v node >/dev/null || missing+=("node (Node.js 18+)")
if [ "${#missing[@]}" -gt 0 ]; then
  say "не хватает: ${missing[*]}"
  say "Arch / Hyprland:  sudo pacman -S --needed base-devel gtk3 gtk-layer-shell webkit2gtk-4.1 nodejs"
  say "Fedora:           sudo dnf install gcc gtk3-devel gtk-layer-shell-devel webkit2gtk4.1-devel nodejs"
  say "Ubuntu / Debian:  sudo apt install build-essential libgtk-3-dev libgtk-layer-shell-dev libwebkit2gtk-4.1-dev nodejs"
  say "Установите и запустите этот скрипт ещё раз."
  exit 1
fi
NODE="$(command -v node)"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' || { say "нужен Node.js 18 или новее"; exit 1; }
say "node $("$NODE" -v) at $NODE"

step "Downloading the office"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
if [ -n "${TGTI_SOURCE:-}" ]; then rm -rf "$BASE/src"; mkdir -p "$BASE/src"; cp -r "$TGTI_SOURCE"/. "$BASE/src"
else
  curl -fsSL "https://github.com/$REPO/archive/refs/heads/main.tar.gz" -o "$TMP/src.tgz"
  rm -rf "$BASE/src"; mkdir -p "$BASE/src"
  tar -xzf "$TMP/src.tgz" -C "$BASE/src" --strip-components 1
fi
say "installed: $BASE/src"

step "Building the wallpaper window"
mkdir -p "$BASE/bin"
cc -O2 "$BASE/src/linux/host.c" -o "$BASE/bin/tgti-office-host" $(pkg-config --cflags --libs gtk+-3.0 gtk-layer-shell-0 webkit2gtk-4.1)
say "built: $BASE/bin/tgti-office-host"

step "Adding the hooks for Claude Code and Codex"
"$NODE" "$BASE/src/install-hooks.mjs" || say "хуки не добавились: запустите node $BASE/src/install-hooks.mjs вручную"

step "Starting the office at login"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/$UNIT" <<UNITEOF
[Unit]
Description=TGTI AI Office wallpaper
PartOf=graphical-session.target
After=graphical-session.target

[Service]
Environment=NODE=$NODE
ExecStart=$BASE/bin/tgti-office-host $BASE/src
Restart=on-failure
RestartSec=3

[Install]
WantedBy=graphical-session.target
UNITEOF
if systemctl --user daemon-reload 2>/dev/null; then
  systemctl --user enable "$UNIT" >/dev/null 2>&1 || true
  systemctl --user restart "$UNIT" 2>/dev/null && say "служба запущена: systemctl --user status $UNIT" \
    || say "служба установлена, но не запустилась здесь (нет графической сессии): запустите её из Hyprland"
else
  say "systemd --user не найден: служба установлена в $UNIT_DIR/$UNIT"
fi

printf '\n\033[32mDone.\033[0m\n'
say "Hyprland: если обои не появились, добавьте в ~/.config/hypr/hyprland.conf строку:"
say "  exec-once = systemctl --user import-environment WAYLAND_DISPLAY && systemctl --user restart $UNIT"
say "Удалить: curl -fsSL https://raw.githubusercontent.com/$REPO/main/linux/uninstall.sh | bash"
