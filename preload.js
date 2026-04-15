const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ct', {
  platform: process.platform,
  version: process.versions.electron,
  openViewfinder:     () => ipcRenderer.invoke('viewfinder:open'),
  viewfinderCapture:  (opts) => ipcRenderer.invoke('viewfinder:capture', opts || {}),
  viewfinderCancel:   () => ipcRenderer.invoke('viewfinder:cancel'),
  clipboardReadImage: () => ipcRenderer.invoke('clipboard:readImage'),
  exportDiaryPdf:     (opts) => ipcRenderer.invoke('pdf:exportDiary', opts || {}),
  remoteScanStart:    () => ipcRenderer.invoke('remote-scan:start'),
  remoteScanStop:     () => ipcRenderer.invoke('remote-scan:stop'),
  onRemoteScanCode:   (fn) => { const h = (_e, code) => fn(code); ipcRenderer.on('remote-scan:code', h); return () => ipcRenderer.removeListener('remote-scan:code', h); },
  onRemoteScanError:  (fn) => { const h = (_e, msg)  => fn(msg);  ipcRenderer.on('remote-scan:error', h); return () => ipcRenderer.removeListener('remote-scan:error', h); }
});

