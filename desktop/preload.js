/**
 * Buchat — Electron preload script
 * Expose une API minimale et sûre à la PWA.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buchatNative', {
  platform: process.platform,
  isDesktop: true,
  getVersion: () => ipcRenderer.invoke('app:version'),
});
