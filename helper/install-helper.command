#!/bin/zsh
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$HOME/Library/Application Support/VidPocket"
PLIST="$HOME/Library/LaunchAgents/com.vidpocket.helper.plist"
UID_VALUE="$(id -u)"
NODE_BIN="$(command -v node)"

mkdir -p "$APP_DIR" "$HOME/Library/LaunchAgents"
cp "$ROOT/helper/vidpocket-helper.mjs" "$APP_DIR/vidpocket-helper.mjs"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.vidpocket.helper</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$APP_DIR/vidpocket-helper.mjs</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$APP_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$APP_DIR/helper.log</string>
  <key>StandardErrorPath</key>
  <string>$APP_DIR/helper.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
PLIST

launchctl bootout "gui/$UID_VALUE" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$UID_VALUE" "$PLIST"
sleep 2
curl -fsS http://127.0.0.1:17384/health
echo
echo "VidPocket helper is installed and running."
