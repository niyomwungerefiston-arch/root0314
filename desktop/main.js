/**
 * Buchat — Electron main process
 *
 * Charge la PWA distante servie depuis buchat.bujaonline.com.
 * Permet un vrai client natif Windows / macOS / Linux sans réécriture.
 *
 * Variables d'environnement :
 *   BUCHAT_URL=https://buchat.bujaonline.com/app/   (par défaut)
 *   BUCHAT_URL=http://localhost:3000/preview/        (mode dev)
 */

const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const path = require('path');

const DEFAULT_URL = 'https://buchat.bujaonline.com/app/';
const BUCHAT_URL = process.env.BUCHAT_URL || DEFAULT_URL;

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 900,
    minWidth: 380,
    minHeight: 640,
    title: 'Buchat',
    backgroundColor: '#0D1B2A',
    icon: path.join(__dirname, 'build-resources', 'icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // WebRTC + media
      webSecurity: true,
    },
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
  });

  mainWindow.loadURL(BUCHAT_URL);

  // Ouvre les liens externes dans le navigateur système, pas dans l'app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Affiche un message clair si le serveur est injoignable
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return; // ERR_ABORTED (navigation cancelled)
    dialog.showErrorBox(
      'Connexion impossible',
      `Buchat n'a pas pu se connecter à ${validatedURL}.\n\n` +
      `Erreur : ${errorDescription}\n\n` +
      'Vérifiez votre connexion internet ou contactez support@bujaonline.com.'
    );
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---- Permissions : autoriser micro + caméra pour les appels WebRTC ----
app.on('ready', () => {
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'mediaKeySystem', 'notifications', 'geolocation', 'fullscreen'];
    callback(allowed.includes(permission));
  });
  createWindow();
  buildMenu();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Une seule instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ---- Menu ----
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: 'Buchat',
      submenu: [
        { role: 'about', label: 'À propos de Buchat' },
        { type: 'separator' },
        { role: 'hide', label: 'Masquer Buchat' },
        { role: 'hideOthers', label: 'Masquer les autres' },
        { role: 'unhide', label: 'Tout afficher' },
        { type: 'separator' },
        { role: 'quit', label: 'Quitter Buchat' },
      ],
    }] : []),
    {
      label: 'Fichier',
      submenu: [
        {
          label: 'Recharger',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow?.reload(),
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: 'Fermer' } : { role: 'quit', label: 'Quitter' },
      ],
    },
    {
      label: 'Édition',
      submenu: [
        { role: 'undo', label: 'Annuler' },
        { role: 'redo', label: 'Rétablir' },
        { type: 'separator' },
        { role: 'cut', label: 'Couper' },
        { role: 'copy', label: 'Copier' },
        { role: 'paste', label: 'Coller' },
        { role: 'selectAll', label: 'Tout sélectionner' },
      ],
    },
    {
      label: 'Aide',
      submenu: [
        {
          label: 'Site web Buchat',
          click: () => shell.openExternal('https://buchat.bujaonline.com'),
        },
        {
          label: 'Contacter le support',
          click: () => shell.openExternal('mailto:support@bujaonline.com'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- IPC (pour future intégration notifications natives) ----
ipcMain.handle('app:version', () => app.getVersion());
