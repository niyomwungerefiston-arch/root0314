#!/usr/bin/env bash
# ==========================================================
# Buchat — Build de tous les binaires distribuables
# ==========================================================
#
# Produit (dans website/downloads/) :
#   - Buchat-Setup.exe        (Windows NSIS installer)
#   - Buchat.dmg              (macOS — ⚠ requiert un Mac)
#   - Buchat.AppImage         (Linux portable)
#   - Buchat.deb              (Debian/Ubuntu)
#   - buchat-latest.apk       (Android — requiert SDK)
#   - SHA256SUMS              (vérification d'intégrité)
#
# Usage :
#   ./scripts/build-all.sh             # build tout ce qui est possible
#   ./scripts/build-all.sh --desktop   # seulement Electron
#   ./scripts/build-all.sh --android   # seulement APK
#   ./scripts/build-all.sh --icons     # seulement régénération icônes
# ==========================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DL_DIR="$ROOT/website/downloads"
mkdir -p "$DL_DIR"

MODE="${1:-all}"

build_icons() {
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ICÔNES"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  cd "$ROOT"
  node scripts/generate-icons.js
}

build_desktop() {
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  DESKTOP (Electron)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  cd "$ROOT/desktop"

  if [ ! -d "node_modules" ]; then
    echo "→ npm install"
    npm install
  fi

  # Linux AppImage (toujours faisable depuis Linux)
  echo "→ Build Linux AppImage + deb"
  npm run build:linux || echo "⚠ Échec Linux build"

  # Windows (faisable depuis Linux avec wine)
  if command -v wine &>/dev/null; then
    echo "→ Build Windows NSIS"
    npm run build:win || echo "⚠ Échec Windows build"
  else
    echo "⚠ Wine non installé — Windows build sauté."
    echo "   Installez : apt install wine wine64"
  fi

  # macOS (uniquement sur Mac)
  if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "→ Build macOS DMG"
    npm run build:mac || echo "⚠ Échec macOS build"
  else
    echo "⚠ macOS build sauté (nécessite un Mac)."
  fi
}

build_android() {
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ANDROID (APK)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  cd "$ROOT/android"

  if [ -z "${ANDROID_HOME:-}" ]; then
    echo "⚠ ANDROID_HOME non défini — APK build sauté."
    echo "   Installez Android SDK : https://developer.android.com/studio"
    return
  fi

  ./build-apk.sh
}

generate_checksums() {
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  CHECKSUMS"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  cd "$DL_DIR"
  if ls *.{exe,dmg,apk,AppImage,deb} &>/dev/null; then
    sha256sum *.{exe,dmg,apk,AppImage,deb} 2>/dev/null > SHA256SUMS || true
    echo "✓ SHA256SUMS généré"
    cat SHA256SUMS
  else
    echo "⚠ Aucun binaire à checksummer."
  fi
}

case "$MODE" in
  --icons)   build_icons ;;
  --desktop) build_desktop && generate_checksums ;;
  --android) build_android && generate_checksums ;;
  all|"")    build_icons && build_desktop && build_android && generate_checksums ;;
  *)
    echo "Usage: $0 [--icons|--desktop|--android|all]"
    exit 1
    ;;
esac

echo ""
echo "✓ Build terminé."
echo "  Binaires dans : $DL_DIR"
ls -lh "$DL_DIR" 2>/dev/null | grep -v '^total' || true
