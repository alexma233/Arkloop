---
title: Installation
description: Download and install Arkloop on your platform.
---

## Download

Grab the latest release for your platform from the [download page](https://arkloop.ai/download).

| Platform | Format | Notes |
|----------|--------|-------|
| macOS (Apple Silicon) | `.dmg` | Universal binary, runs on M-series and Intel |
| Windows | `.exe` | Installer with auto-update |
| Linux | `.AppImage` / `.deb` / `.rpm` | AppImage is portable; deb/rpm for package managers |

## Install

### macOS

Open the DMG → drag Arkloop to Applications.

> [!WARNING] Gatekeeper may block the app on first launch. Right-click the app → Open → Open to bypass. This is only needed once.

### Windows

Run the `.exe` installer and follow the prompts.

> [!WARNING] SmartScreen may show an "unrecognized app" warning. Click "More info" → "Run anyway".

### Linux

**AppImage** — make it executable and run:

```bash
chmod +x Arkloop.AppImage
./Arkloop.AppImage
```

**deb / rpm** — install with your package manager:

```bash
sudo dpkg -i arkloop.deb      # Debian/Ubuntu
sudo rpm -i arkloop.rpm       # Fedora/RHEL
```

## First Launch

When you start Arkloop for the first time, several things happen automatically:

- Sidecar services download and start in the background
- Local database is created
- Built-in agents are seeded and ready to use

No manual configuration is needed at this stage — the setup wizard handles the rest.

## Window Management

| Action | Shortcut |
|--------|----------|
| Show / hide window | `Cmd+Shift+A` (macOS) or `Ctrl+Shift+A` (Windows/Linux) |

Arkloop adds a system tray icon. Minimizing the window sends it to the tray instead of the taskbar. The tray menu offers Show, Settings, and Quit.

You can configure close behavior in Settings: keep running in the background (default), or quit entirely when the window is closed.
