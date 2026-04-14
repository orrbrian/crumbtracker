const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ct', {
  platform: process.platform,
  version: process.versions.electron,
  openViewfinder:     () => ipcRenderer.invoke('viewfinder:open'),
  viewfinderCapture:  (opts) => ipcRenderer.invoke('viewfinder:capture', opts || {}),
  viewfinderCancel:   () => ipcRenderer.invoke('viewfinder:cancel'),
  clipboardReadImage: () => ipcRenderer.invoke('clipboard:readImage')
});

