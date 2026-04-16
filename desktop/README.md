# Buchat Desktop (Electron)

Wrapper Electron qui charge la PWA `buchat.bujaonline.com/app/` dans une
fenêtre native Windows / macOS / Linux.

## Pourquoi Electron ?

- Utilise le **même code** que la PWA (zéro duplication)
- Accès complet à la webcam/micro pour les appels WebRTC
- Distribution directe via `buchat.bujaonline.com/downloads/`
- Pas besoin de compte Microsoft Store ni Mac App Store

## Développement

```bash
cd desktop
npm install
npm run dev    # charge http://localhost:3000/preview/
```

## Build

```bash
npm run build:win    # → Buchat-Setup.exe (NSIS)
npm run build:mac    # → Buchat.dmg
npm run build:linux  # → Buchat.AppImage + .deb
npm run build:all    # les trois
```

Les binaires atterrissent dans `../website/downloads/` et sont servis
directement par Nginx.

## Important : cross-compilation

- **Windows .exe** : peut être buildé depuis Linux avec `wine` installé
- **macOS .dmg** : DOIT être buildé sur un Mac (signature Apple obligatoire)
- **Linux AppImage** : buildé depuis Linux (le plus simple)

Sur le CT 109 (Linux), on peut builder Windows + Linux. Pour le Mac,
utiliser un Mac du bureau ou un runner GitHub Actions (macos-latest).

## Signature de code

Pour éviter les avertissements SmartScreen (Windows) et Gatekeeper (macOS) :

- **Windows** : certificat EV Code Signing (~200-400 $/an)
- **macOS** : Apple Developer ID (~99 $/an — mais sans App Store)

Optionnel — tant que les utilisateurs font "Exécuter quand même", ça fonctionne.

## Auto-update

electron-builder génère automatiquement un `latest.yml` qui permet aux
clients existants de vérifier et télécharger les nouvelles versions
depuis `buchat.bujaonline.com/downloads/`. Voir `electron-updater` pour
l'intégration côté app.
