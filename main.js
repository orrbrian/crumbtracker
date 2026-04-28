const { app, BrowserWindow, session, ipcMain, desktopCapturer, screen, nativeTheme, clipboard, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const remoteScanner = require('./remote-scanner');
const qrcode = require('qrcode');
const { autoUpdater } = require('electron-updater');

nativeTheme.themeSource = 'dark';

// Refuse to start a second instance — IndexedDB / LevelDB only allows one
// writer at a time, so a duplicate launch would crash the renderer with
// "Internal error" on every DB call. Instead, focus the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

let mainWindow = null;
let viewfinderWindow = null;
let viewfinderResolve = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#111418',
    title: 'CrumbTracker',
    icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createViewfinderWindow() {
  viewfinderWindow = new BrowserWindow({
    width: 520,
    height: 460,
    minWidth: 200,
    minHeight: 140,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: 'Viewfinder',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  viewfinderWindow.loadFile(path.join(__dirname, 'renderer', 'viewfinder.html'));
  viewfinderWindow.on('closed', () => {
    viewfinderWindow = null;
    if (mainWindow) {
      try { mainWindow.show(); mainWindow.focus(); } catch {}
    }
    if (viewfinderResolve) {
      const r = viewfinderResolve;
      viewfinderResolve = null;
      r(null);
    }
  });
}

ipcMain.handle('viewfinder:open', () => {
  if (viewfinderWindow) return null;
  if (mainWindow) { try { mainWindow.hide(); } catch {} }
  return new Promise((resolve) => {
    viewfinderResolve = resolve;
    createViewfinderWindow();
  });
});

ipcMain.handle('viewfinder:capture', async (_e, { toolbarHeight = 0 } = {}) => {
  if (!viewfinderWindow || !viewfinderResolve) return null;
  const bounds = viewfinderWindow.getBounds();
  try { viewfinderWindow.hide(); } catch {}
  await new Promise(r => setTimeout(r, 150));
  try {
    const display = screen.getDisplayMatching(bounds);
    const scale = display.scaleFactor || 1;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width:  Math.round(display.size.width * scale),
        height: Math.round(display.size.height * scale)
      }
    });
    const source = sources.find(s => String(s.display_id) === String(display.id)) || sources[0];
    if (!source) throw new Error('No screen source available');
    const img = source.thumbnail;
    // Derive the real scale from the thumbnail Electron actually returned —
    // thumbnailSize is a *max*, so it can come back smaller than requested.
    const imgSize = img.getSize();
    const sx = imgSize.width  / display.bounds.width;
    const sy = imgSize.height / display.bounds.height;
    const rectX = (bounds.x - display.bounds.x) * sx;
    const rectY = (bounds.y - display.bounds.y + toolbarHeight) * sy;
    const rectW = bounds.width * sx;
    const rectH = (bounds.height - toolbarHeight) * sy;
    const cropRect = {
      x: Math.max(0, Math.min(imgSize.width  - 1, Math.round(rectX))),
      y: Math.max(0, Math.min(imgSize.height - 1, Math.round(rectY))),
      width:  Math.max(1, Math.min(imgSize.width,  Math.round(rectW))),
      height: Math.max(1, Math.min(imgSize.height, Math.round(rectH)))
    };
    const cropped = img.crop(cropRect);
    const buffer = cropped.toPNG();
    const r = viewfinderResolve;
    viewfinderResolve = null;
    r(buffer);
    return { ok: true };
  } catch (err) {
    console.error('viewfinder:capture failed', err);
    try { viewfinderWindow && viewfinderWindow.show(); } catch {}
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    if (viewfinderWindow) { try { viewfinderWindow.close(); } catch {} }
  }
});

ipcMain.handle('pdf:exportDiary', async (_e, { html, defaultFilename = 'crumbtracker-diary.pdf' } = {}) => {
  if (typeof html !== 'string' || !html.length) return { ok: false, error: 'No HTML provided' };

  const saveRes = await dialog.showSaveDialog(mainWindow, {
    title: 'Save diary as PDF',
    defaultPath: defaultFilename,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (saveRes.canceled || !saveRes.filePath) return { ok: false, canceled: true };

  // Render in a hidden off-screen window so the print layout doesn't disturb
  // the main window. The window is disposable — loaded via data URL, printed,
  // and closed in the finally block.
  const printWin = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  try {
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    await printWin.loadURL(dataUrl);
    const pdf = await printWin.webContents.printToPDF({
      pageSize: 'Letter',
      printBackground: true,
      margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
    });
    await fs.promises.writeFile(saveRes.filePath, pdf);
    return { ok: true, path: saveRes.filePath };
  } catch (e) {
    console.error('[pdf:exportDiary] failed', e);
    return { ok: false, error: String(e && e.message || e) };
  } finally {
    try { printWin.destroy(); } catch {}
  }
});

ipcMain.handle('clipboard:readImage', async () => {
  const formats = clipboard.availableFormats();
  const img = clipboard.readImage();
  if (img && !img.isEmpty()) {
    return { dataUrl: img.toDataURL(), debug: { via: 'native', formats } };
  }

  let url = null, source = null;
  const html = clipboard.readHTML();
  if (html) {
    const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m) { url = m[1]; source = 'html'; }
  }
  if (!url) {
    const text = clipboard.readText();
    if (text && /^https?:\/\/\S+$/i.test(text.trim())) { url = text.trim(); source = 'text'; }
  }
  if (!url) {
    return { dataUrl: null, debug: { via: 'none', formats, htmlLen: html ? html.length : 0 } };
  }

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return { dataUrl: null, debug: { via: source, formats, url, status: res.status } };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = (res.headers.get('content-type') || 'image/png').split(';')[0].trim();
    return {
      dataUrl: `data:${ct};base64,${buf.toString('base64')}`,
      debug: { via: source, formats, url, status: res.status, contentType: ct }
    };
  } catch (e) {
    return { dataUrl: null, debug: { via: source, formats, url, error: String(e && e.message || e) } };
  }
});

ipcMain.handle('remote-scan:start', async () => {
  try {
    const info = await remoteScanner.start({
      onCode: (code) => {
        if (mainWindow) { try { mainWindow.webContents.send('remote-scan:code', code); } catch {} }
      },
      onError: (err) => {
        if (mainWindow) { try { mainWindow.webContents.send('remote-scan:error', String(err && err.message || err)); } catch {} }
      }
    });
    const qrDataUrl = await qrcode.toDataURL(info.url, {
      margin: 1, scale: 6, errorCorrectionLevel: 'M',
      color: { dark: '#0f1216', light: '#ffffff' }
    });
    return { ok: true, url: info.url, urls: info.urls, qr: qrDataUrl };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
});

ipcMain.handle('remote-scan:stop', () => {
  remoteScanner.stop('renderer cancel');
  return { ok: true };
});

ipcMain.handle('viewfinder:cancel', () => {
  if (viewfinderWindow) { try { viewfinderWindow.close(); } catch {} }
  return true;
});

ipcMain.handle('app:getVersion', () => app.getVersion());

function setupAutoUpdates() {
  // The portable target can't be updated in place (electron-updater rewrites
  // the NSIS install dir), and dev runs have no signed bundle to compare against.
  if (!app.isPackaged) return;
  if (process.env.PORTABLE_EXECUTABLE_DIR) return;

  autoUpdater.autoDownload = false;
  autoUpdater.on('error', (err) => console.error('[updater]', err));

  autoUpdater.on('update-available', async (info) => {
    if (!mainWindow) return;
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update available',
      message: `CrumbTracker ${info.version} is available.`,
      detail: 'Download the update now? The app will keep running while it downloads.'
    });
    if (response === 0) {
      autoUpdater.downloadUpdate().catch(err => console.error('[updater] download', err));
    }
  });

  autoUpdater.on('update-downloaded', async (info) => {
    if (!mainWindow) return;
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `CrumbTracker ${info.version} has been downloaded.`,
      detail: 'Restart now to apply the update.'
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.checkForUpdates().catch(err => console.error('[updater] check', err));
}

app.whenReady().then(() => {
  // Auto-grant camera permission so the barcode scanner works without prompts.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });

  createWindow();
  setupAutoUpdates();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
