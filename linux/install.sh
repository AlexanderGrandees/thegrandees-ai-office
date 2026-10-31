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
main() {
  printf '\n\033[35mTGTI AI Office: installing\033[0m\n'
  [ "$(uname)" = "Linux" ] || { echo "This installer is for Linux."; exit 1; }

  step "Checking tools and libraries"
  missing=()
  command -v pkg-config >/dev/null || missing+=("pkg-config")
  if command -v pkg-config >/dev/null; then
    for m in gtk+-3.0 gtk-layer-shell-0 webkit2gtk-4.1; do pkg-config --exists "$m" || missing+=("$m"); done
  fi
  command -v cc >/dev/null || missing+=("cc (C compiler)")
  command -v node >/dev/null || missing+=("node (Node.js 18+)")
  if [ "${#missing[@]}" -gt 0 ]; then
    say "missing: ${missing[*]}"
    say "Arch / Hyprland:  sudo pacman -S --needed base-devel gtk3 gtk-layer-shell webkit2gtk-4.1 nodejs"
    say "Fedora:           sudo dnf install gcc pkgconf gtk3-devel gtk-layer-shell-devel webkit2gtk4.1-devel nodejs"
    say "Ubuntu / Debian:  sudo apt install build-essential pkg-config libgtk-3-dev libgtk-layer-shell-dev libwebkit2gtk-4.1-dev nodejs"
    say "Install them and run this script again."
    exit 1
  fi
  NODE="$(command -v node)"
  node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' || { say "Node.js 18 or newer is needed"; exit 1; }
  say "node $("$NODE" -v) at $NODE"

  step "Downloading the office"
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  # всё готовим во временной папке: старая установка остаётся рабочей, пока сборка не удалась
  mkdir -p "$TMP/src"
  if [ -n "${TGTI_SOURCE:-}" ]; then cp -r "$TGTI_SOURCE"/. "$TMP/src"
  else
    curl -fsSL "https://github.com/$REPO/archive/refs/heads/main.tar.gz" -o "$TMP/src.tgz"
    tar -xzf "$TMP/src.tgz" -C "$TMP/src" --strip-components 1
  fi
  say "downloaded"

  step "Building the wallpaper window"
  if ! cc -O2 "$TMP/src/linux/host.c" -o "$TMP/tgti-office-host" $(pkg-config --cflags --libs gtk+-3.0 gtk-layer-shell-0 webkit2gtk-4.1); then
    say "the build failed: the previous installation (if any) was left as it was"
    exit 1
  fi
  say "built"

  step "Installing the files"
  systemctl --user stop "$UNIT" 2>/dev/null || true
  mkdir -p "$BASE/bin"
  rm -rf "$BASE/src"; mv "$TMP/src" "$BASE/src"
  mv -f "$TMP/tgti-office-host" "$BASE/bin/tgti-office-host"
  say "installed: $BASE"

  step "Adding the hooks for Claude Code and Codex"
  "$NODE" "$BASE/src/install-hooks.mjs" || say "the hooks were not added: run  $NODE $BASE/src/install-hooks.mjs  by hand"

  step "Starting the office at login"
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_DIR/$UNIT" <<UNITEOF
[Unit]
Description=TGTI AI Office wallpaper
PartOf=graphical-session.target
After=graphical-session.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Environment="NODE=$NODE"
ExecCondition=/bin/sh -c 'test -n "\$WAYLAND_DISPLAY"'
ExecStart="$BASE/bin/tgti-office-host" "$BASE/src"
Restart=on-failure
RestartSec=3
RestartPreventExitStatus=2

[Install]
WantedBy=graphical-session.target
UNITEOF
  if systemctl --user daemon-reload 2>/dev/null; then
    systemctl --user enable "$UNIT" >/dev/null 2>&1 || true
    [ -n "${WAYLAND_DISPLAY:-}" ] && { systemctl --user import-environment WAYLAND_DISPLAY || true; }
    systemctl --user restart "$UNIT" 2>/dev/null || true
    sleep 2
    if systemctl --user is-active --quiet "$UNIT"; then say "the service is running: systemctl --user status $UNIT"
    else say "the service is installed but is not running now (no Wayland session here?): see  journalctl --user -u $UNIT"; fi
  else
    say "systemd --user not found: the service file is in $UNIT_DIR/$UNIT"
  fi

  printf '\n\033[32mDone.\033[0m\n'
  if ! systemctl --user is-active --quiet graphical-session.target 2>/dev/null; then
    say "Required: your session does not start graphical-session.target, so add the autostart line yourself."
    say "Hyprland (~/.config/hypr/hyprland.conf):"
    say "  exec-once = systemctl --user import-environment WAYLAND_DISPLAY XDG_CURRENT_DESKTOP && systemctl --user restart $UNIT"
    say "Sway (~/.config/sway/config):"
    say "  exec systemctl --user import-environment WAYLAND_DISPLAY XDG_CURRENT_DESKTOP && systemctl --user restart $UNIT"
  fi
  say "Uninstall: curl -fsSL https://raw.githubusercontent.com/$REPO/main/linux/uninstall.sh | bash"
}

main "$@"
