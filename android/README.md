# Buchat Android (Capacitor)

Empaquète la PWA `buchat.bujaonline.com/app/` en APK Android natif
distribuable directement depuis `buchat.bujaonline.com/downloads/`.

## Pourquoi Capacitor ?

- Utilise **le même code web** que la PWA (zéro duplication)
- APK natif avec accès caméra, micro, notifications push, contacts
- **Pas besoin du Play Store** : on distribue l'APK nous-mêmes
- Simple à builder (WebView natif Android + plugins Capacitor)

## Prérequis

Sur la machine de build (recommandé : Ubuntu 22.04 sur un VPS ou laptop) :

```bash
# Java
sudo apt install openjdk-17-jdk

# Android SDK (via sdkmanager ou Android Studio)
# Variables d'environnement
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin
```

## Premier build

```bash
cd android
./build-apk.sh
```

Le script :
1. Installe les deps (`npm install`)
2. Initialise Capacitor si nécessaire
3. Synchronise la PWA vers le projet Android
4. Build l'APK release avec Gradle
5. Copie l'APK vers `website/downloads/buchat-latest.apk`

## Signature de l'APK

Pour que les utilisateurs puissent **mettre à jour** l'APK sans le désinstaller,
il faut signer avec la même clé à chaque build.

```bash
# Générer une keystore (UNE SEULE FOIS, à garder précieusement !)
keytool -genkey -v \
  -keystore buchat-release.keystore \
  -alias buchat \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass CHANGE_ME -keypass CHANGE_ME
```

Puis configurer `android/app/build.gradle` :

```gradle
android {
  signingConfigs {
    release {
      storeFile file("../../buchat-release.keystore")
      storePassword System.getenv("BUCHAT_KEYSTORE_PW")
      keyAlias "buchat"
      keyPassword System.getenv("BUCHAT_KEY_PW")
    }
  }
  buildTypes {
    release {
      signingConfig signingConfigs.release
      minifyEnabled true
      proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
    }
  }
}
```

**⚠️ Ne commitez jamais la keystore dans Git.** Stockez-la dans un coffre-fort
(LastPass, Bitwarden, ou `/root/.secrets/` sur CT 109 avec chmod 600).

## Mode "APK en ligne" vs "APK offline"

Dans `capacitor.config.json`, la directive `server.url` fait que l'APK charge
la PWA distante. Avantages :

- ✅ Mises à jour instantanées (juste déployer la PWA sur le serveur)
- ✅ APK très léger (~5 Mo au lieu de 30 Mo)
- ❌ Requiert une connexion au premier lancement

Pour builder un APK 100% offline, retirez `server.url` : Capacitor embarquera
alors tout le dossier `web-preview/` dans l'APK.

## Distribution

- Upload manuel : `scp app-release.apk ct109:/var/www/buchat-downloads/buchat-latest.apk`
- Ou via le script `scripts/deploy-downloads.sh` (voir racine du repo)

Les utilisateurs Android téléchargent depuis `buchat.bujaonline.com/downloads/`.
Ils devront autoriser l'installation depuis "sources inconnues" la première fois
(un seul clic dans les paramètres).
