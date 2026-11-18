#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script targets macOS (launchd). On Windows, run install-top-capsule.ps1 instead." >&2
  exit 1
fi

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js >= 22 is required but was not found in PATH." >&2
  exit 1
fi

NODE_MAJOR="$("$NODE_BIN" -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  echo "Node.js >= 22 is required (found v$("$NODE_BIN" -v))." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALLED_SCRIPT="$HOME/.gemini/config/plugins/context-monitor/top-capsule.mjs"
if [[ -f "$INSTALLED_SCRIPT" ]]; then
  SCRIPT="$INSTALLED_SCRIPT"
else
  SCRIPT="$SCRIPT_DIR/top-capsule.mjs"
fi

PLIST="$HOME/Library/LaunchAgents/com.antigravity.context-capsule.plist"
LOG_DIR="$HOME/.gemini/antigravity/sidecar_data/context-monitor/top-capsule"
mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.antigravity.context-capsule</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${SCRIPT}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/stderr.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/com.antigravity.context-capsule" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Enabled LaunchAgent: com.antigravity.context-capsule (Node: $NODE_BIN, Script: $SCRIPT)"
