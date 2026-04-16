#!/usr/bin/env bash
# Buchat — Build Android APK
#
# Prérequis sur la machine de build (CT 109 ou laptop) :
#   - JDK 17+        : apt install openjdk-17-jdk
#   - Android SDK    : via Android Studio ou sdkmanager
#   - ANDROID_HOME   : variable d'env pointant sur le SDK
#   - Node.js 18+
#
# Produit :
#   android/app/build/outputs/apk/release/app-release.apk
#   → copié vers website/downloads/buchat-latest.apk
#
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d "node_modules" ]; then
  echo "→ npm install"
  npm install
fi

if [ ! -d "android" ]; then
  echo "→ Première configuration Capacitor"
  npx cap init Buchat com.bujaonline.buchat --web-dir=../web-preview
  npx cap add android
fi

echo "→ Synchronisation web → android"
npx cap sync android

echo "→ Build APK release"
cd android
./gradlew assembleRelease

APK_OUT="app/build/outputs/apk/release/app-release.apk"
DEST="../../website/downloads/buchat-latest.apk"

if [ -f "$APK_OUT" ]; then
  cp "$APK_OUT" "$DEST"
  echo "✓ APK généré : $DEST"
  echo "  Taille : $(du -h "$DEST" | cut -f1)"
else
  echo "✗ APK introuvable à $APK_OUT"
  exit 1
fi
