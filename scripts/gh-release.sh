#!/bin/bash
# Create GitHub release v1.5.0 with the APK attached (permanent download link)
set -euo pipefail
# Token is NEVER hardcoded here — pass it at runtime:
#   GITHUB_TOKEN=xxxx bash scripts/gh-release.sh
TOKEN="${GITHUB_TOKEN:?Set the GITHUB_TOKEN env var first (never commit it)}"
REPO="Manojstarkm/Robin.AI"
APK=/home/z/my-project/download/ROBIN-AI.apk
H="Authorization: Bearer $TOKEN"
CT="Content-Type: application/json"

# 1. Create the release
REL_JSON=$(cat <<'EOF'
{
  "tag_name": "v1.5.0",
  "target_commitish": "main",
  "name": "ROBIN AI v1.5.0 — In-app Updates",
  "body": "## What's new\n\n- **In-app update checker**: ROBIN now shows a banner inside the app whenever a newer version is available — tap it and the new APK downloads automatically (install prompt when done).\n- **One-tap updates**: downloads go through Android's Download Manager with a completion notification.\n- **Stable signing**: all future APKs keep the same signature, so updates install over the old app without uninstalling (your API key and chats stay).\n- Includes everything from v1.4.0 and the human-like ROBIN persona (spoken Tamil, moods, curiosity, identity).\n\n## Install (fresh)\n\n1. Download `ROBIN-AI.apk` below (or from the app's update banner).\n2. Open it, allow *install unknown apps* if asked.\n\n## Update from v1.4.0 or older\n\nBecause the signing key was re-created, old installs must **uninstall first**, then install this APK. This is a one-time step — future updates install directly over the top.\n\n## Links\n\n- Always-latest APK: https://github.com/Manojstarkm/Robin.AI/releases/latest/download/ROBIN-AI.apk\n- Web version (no install): open the app URL in any browser.",
  "draft": false,
  "prerelease": false
}
EOF
)
RESP=$(curl -sS -X POST -H "$H" -H "$CT" -d "$REL_JSON" "https://api.github.com/repos/$REPO/releases")
REL_ID=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id', d.get('message','ERR')))")
echo "release id: $REL_ID"
case "$REL_ID" in
  ''|ERR|*"Already exists"*|*"message"*) echo "$RESP" | head -5; exit 1;;
esac

# 2. Upload the APK asset
UP=$(curl -sS -X POST -H "$H" -H "Content-Type: application/vnd.android.package-archive" \
  --data-binary @"$APK" \
  "https://uploads.github.com/repos/$REPO/releases/$REL_ID/assets?name=ROBIN-AI.apk")
echo "$UP" | python3 -c "import sys,json; d=json.load(sys.stdin); print('asset:', d.get('name'), d.get('size'), d.get('browser_download_url', d.get('message','ERR')))"
