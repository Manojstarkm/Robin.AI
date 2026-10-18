#!/bin/bash
# Build ROBIN AI Android APK (raw pipeline: aapt2 -> javac -> d8 -> zipalign -> apksigner)
set -euo pipefail

TOOLS=/home/z/android-build/tools
JDK="$TOOLS/jdk-21.0.12.1+1"
BT="$TOOLS/build-tools-34"
PLATFORM="$TOOLS/android-34/android.jar"
PROJ=/home/z/android-build/project
BUILD="$PROJ/build"
OUT_APK=/home/z/my-project/download/ROBIN-AI.apk

JAVA="$JDK/bin/java"
JAVAC="$JDK/bin/javac"
JAR="$JDK/bin/jar"
KEYTOOL="$JDK/bin/keytool"

echo "==> Clean"
rm -rf "$BUILD"
mkdir -p "$BUILD/gen" "$BUILD/classes" "$BUILD/dex" "$BUILD/out"

echo "==> aapt2 compile"
"$BT/aapt2" compile --dir "$PROJ/res" -o "$BUILD/res.zip"

echo "==> aapt2 link"
"$BT/aapt2" link \
    -o "$BUILD/base.apk" \
    -I "$PLATFORM" \
    --manifest "$PROJ/AndroidManifest.xml" \
    --java "$BUILD/gen" \
    --min-sdk-version 23 \
    --target-sdk-version 34 \
    --version-code 3 \
    --version-name 1.2.0 \
    "$BUILD/res.zip"

echo "==> javac"
"$JAVAC" --release 8 \
    -classpath "$PLATFORM" \
    -d "$BUILD/classes" \
    "$BUILD/gen/com/aura/assistant/R.java" \
    "$PROJ/java/com/aura/assistant/MainActivity.java"

echo "==> jar classes"
"$JAR" cf "$BUILD/classes.jar" -C "$BUILD/classes" .

echo "==> d8 desugar/dex"
# Use standalone D8 8.5.35 — the d8 8.2.2-dev bundled in build-tools 34 has an NPE bug
"$JAVA" -cp "$TOOLS/r8-new.jar" com.android.tools.r8.D8 \
    --release \
    --lib "$PLATFORM" \
    --min-api 23 \
    --output "$BUILD/dex" \
    "$BUILD/classes.jar"

echo "==> package dex into apk"
cp "$BUILD/base.apk" "$BUILD/unsigned.apk"
cd "$BUILD/dex" && zip -q -j "$BUILD/unsigned.apk" classes.dex && cd /

echo "==> zipalign"
"$BT/zipalign" -f 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"

echo "==> keystore"
KS="$PROJ/robin.keystore"
if [ ! -f "$KS" ]; then
    "$KEYTOOL" -genkeypair -v \
        -keystore "$KS" -alias robin \
        -keyalg RSA -keysize 2048 -validity 10950 \
        -storepass robin2026 -keypass robin2026 \
        -dname "CN=ROBIN AI, OU=ROBIN, O=ROBIN AI, C=US"
fi

echo "==> apksigner sign"
"$JAVA" -jar "$BT/lib/apksigner.jar" sign \
    --ks "$KS" --ks-key-alias robin \
    --ks-pass pass:robin2026 --key-pass pass:robin2026 \
    --out "$BUILD/ROBIN.apk" \
    "$BUILD/aligned.apk"

echo "==> verify"
"$JAVA" -jar "$BT/lib/apksigner.jar" verify --print-certs "$BUILD/ROBIN.apk" | head -5

mkdir -p "$(dirname "$OUT_APK")"
cp "$BUILD/ROBIN.apk" "$OUT_APK"
echo "==> DONE: $OUT_APK ($(du -h "$OUT_APK" | cut -f1))"
