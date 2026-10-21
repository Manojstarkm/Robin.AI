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
  "tag_name": "v1.6.0",
  "target_commitish": "main",
  "name": "ROBIN AI v1.6.0 — Fully Ours: Own Brain + Identity Lock",
  "body": "## What's new\n\n- **ROBIN runs on her own GLM brain now** — every chat goes through the app's built-in brain. No Google API key needed, nothing to configure, and the app no longer carries anyone's personal Google key.\n- **Identity locked in code**: ask ROBIN who created her and she will always answer *\"I am developed by Manoj M, founder of Stark Industry, with GLM.\"* — in English, Tanglish or Tamil (என்னை Stark Industry-ன் founder Manoj M, GLM வெச்சு develop பண்ணிருக்காரு.) — never Google, no matter what.\n- **Your own Google key still works**: paste it in Settings and ROBIN calls Gemini straight from your phone.\n- Includes everything from v1.5.0 (in-app update banner, one-tap updates).\n\n## Update from v1.5.0\n\nTap the update banner inside the app, or just install this APK over the old one — same signature, your key and chats stay.\n\n## Install (fresh)\n\n1. Download `ROBIN-AI.apk` below.\n2. Open it, allow *install unknown apps* if asked.\n\n## Links\n\n- Always-latest APK: https://github.com/Manojstarkm/Robin.AI/releases/latest/download/ROBIN-AI.apk\n- Web version (no install): open the app URL in any browser.",
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
