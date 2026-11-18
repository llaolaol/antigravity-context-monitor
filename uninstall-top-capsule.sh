#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script targets macOS (launchd). On Windows, run uninstall-top-capsule.ps1 instead." >&2
  exit 1
fi

PLIST="$HOME/Library/LaunchAgents/com.antigravity.context-capsule.plist"
launchctl bootout "gui/$(id -u)/com.antigravity.context-capsule" 2>/dev/null || true
rm -f "$PLIST"
echo "Disabled and removed LaunchAgent: com.antigravity.context-capsule"
