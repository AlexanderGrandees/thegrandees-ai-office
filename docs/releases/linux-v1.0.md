# TGTI AI Office for Linux, v1.0

The first public Linux release: the pixel office as a live wallpaper on Wayland compositors with wlr-layer-shell (Hyprland, Sway).
It is a small native window (GTK 3, gtk-layer-shell, WebKitGTK 4.1) on the background layer of every monitor.

Install (no sudo; see the README for the build dependencies of Arch, Fedora and Ubuntu):

    curl -fsSL https://raw.githubusercontent.com/AlexanderGrandees/thegrandees-ai-office/main/linux/install.sh | bash

Tested: headless Sway, several monitors plugged and unplugged in a row, running the installer and the uninstaller twice, building against GTK 3 + gtk-layer-shell + WebKitGTK 4.1.
Hyprland: targeted, community testing welcome.

Known limits:
- Wayland with wlr-layer-shell only. GNOME and X11 are not supported; KDE Plasma 6 was not tested.
- Wallpaper tools (hyprpaper, swww, swaybg) draw on the same layer and may cover the office.
- On NVIDIA a blank window may need WEBKIT_DISABLE_DMABUF_RENDERER=1.
- No automatic updates: run the install command again.

Remove: curl -fsSL https://raw.githubusercontent.com/AlexanderGrandees/thegrandees-ai-office/main/linux/uninstall.sh | bash
