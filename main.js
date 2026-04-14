const { app, BrowserWindow, session, ipcMain, desktopCapturer, screen, nativeTheme, clipboard } = require('electron');
const path = require('path');

nativeTheme.themeSource = 'dark';

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

ipcMain.handle('viewfinder:cancel', () => {
  if (viewfinderWindow) { try { viewfinderWindow.close(); } catch {} }
  return true;
});

app.whenReady().then(() => {
  // Auto-grant camera permission so the barcode scanner works without prompts.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
