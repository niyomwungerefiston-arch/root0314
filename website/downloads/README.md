# Buchat — Binaires de téléchargement

Ce dossier contient les binaires installables servis par `buchat.bujaonline.com`.

## Fichiers attendus

| Fichier | Plateforme | Généré par |
|---|---|---|
| `Buchat-Setup.exe` | Windows 10/11 | `cd desktop && npm run build:win` |
| `Buchat.dmg` | macOS | `cd desktop && npm run build:mac` |
| `Buchat.AppImage` | Linux | `cd desktop && npm run build:linux` |
| `buchat-latest.apk` | Android | `cd android && ./build-apk.sh` |
| `latest.yml` | Auto-update Electron | Généré par electron-builder |
| `SHA256SUMS` | Vérification d'intégrité | `sha256sum *.{exe,dmg,apk,AppImage}` |

## Générer tous les binaires en une commande

```bash
./scripts/build-all.sh
```

## Sur le CT 109 (serveur Proxmox)

Nginx sert ce dossier à l'URL `https://buchat.bujaonline.com/downloads/` —
voir `deploy/nginx-buchat-site.conf`.

**Important :** ce dossier est dans `.gitignore` pour les binaires (gros fichiers).
Les binaires sont déposés manuellement après chaque build, ou via CI/CD.
