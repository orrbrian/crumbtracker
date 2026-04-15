// Barcode scanner — uses ZXing (bundled locally) so it works on platforms
// without native BarcodeDetector (e.g. Windows Chromium).

var CT = window.CT || (window.CT = {});

class BarcodeScanner {
  constructor() {
    this.modal = document.getElementById('scanner-modal');
    this.video = document.getElementById('scanner-video');
    this.status = document.getElementById('scanner-status');
    this.cameraSel = document.getElementById('scanner-camera');
    this.manualBtn = document.getElementById('scanner-manual');
    this.manualForm = document.getElementById('scanner-manual-form');
    this.manualInput = document.getElementById('scanner-manual-input');
    this.uploadBtn = document.getElementById('scanner-upload');
    this.fileInput = document.getElementById('scanner-file');
    this.reader = null;
    this.controls = null;
    this._onDetected = null;

    this.modal.addEventListener('click', (e) => {
      if (e.target.dataset.close !== undefined || e.target === this.modal) this.close();
    });
    this.cameraSel.addEventListener('change', () => this._restart());
    this.manualBtn.addEventListener('click', () => this._toggleManual());
    this.manualForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = this.manualInput.value.trim();
      if (!code) return;
      this.close();
      if (this._onDetected) this._onDetected(code);
    });
    this.uploadBtn.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => this._decodeFile());

    const desktopBtn = document.getElementById('scanner-desktop');
    if (desktopBtn) desktopBtn.addEventListener('click', () => this._desktopSnip());
  }

  async _desktopSnip() {
    if (!window.ct || !window.ct.openViewfinder) {
      this.status.textContent = 'Desktop snip not available in this build.';
      return;
    }
    this.status.textContent = 'Viewfinder open — position it on your desktop and click Capture.';
    try {
      const data = await window.ct.openViewfinder();
      if (!data) return; // user cancelled
      const blob = new Blob([data], { type: 'image/png' });
      this._openCrop(blob);
    } catch (e) {
      console.error(e);
      this.status.textContent = 'Desktop snip failed: ' + (e.message || e);
    }
  }

  _decodeFile() {
    const file = this.fileInput.files[0];
    this.fileInput.value = '';
    if (!file) return;
    this._openCrop(file);
  }

  _openCrop(fileOrBlob) {
    // Temporarily stop the live scanner while cropping.
    if (this.controls) { try { this.controls.stop(); } catch {} this.controls = null; }
    const stream = this.video.srcObject;
    if (stream) stream.getTracks().forEach(t => t.stop());
    this.video.srcObject = null;
    this.video.classList.add('hidden');
    this.cameraSel.disabled = true;
    this.status.textContent = 'Position the frame over the barcode.';

    const url = URL.createObjectURL(fileOrBlob);
    let cropEl = document.getElementById('scanner-crop');
    if (cropEl) cropEl.remove();
    cropEl = document.createElement('div');
    cropEl.id = 'scanner-crop';
    cropEl.className = 'scanner-crop';
    this.video.parentElement.insertBefore(cropEl, this.video.nextSibling);

    new CT.CropOverlay(cropEl, {
      imageUrl: url,
      hint: 'Drag the frame over the barcode, then click Scan region.',
      onCancel: () => {
        URL.revokeObjectURL(url);
        cropEl.remove();
        this.video.classList.remove('hidden');
        this.cameraSel.disabled = false;
        this._start().catch((e) => { this.status.textContent = 'Camera error: ' + (e.message || e); });
      },
      onAccept: async (cropped) => {
        URL.revokeObjectURL(url);
        cropEl.remove();
        this.video.classList.remove('hidden');
        this.cameraSel.disabled = false;
        await this._decodeBlob(cropped);
      }
    });
  }

  async _decodeBlob(blob) {
    if (!window.ZXingBrowser) { this.status.textContent = 'Scanner library failed to load.'; return; }
    if (!this.reader) this.reader = new window.ZXingBrowser.BrowserMultiFormatReader();
    this.status.textContent = 'Decoding image…';

    // Try preprocessed (upscale + grayscale + contrast stretch) first, fall
    // back to the raw crop if ZXing can't read it either way.
    const candidates = [];
    try {
      const prepared = await preprocessForBarcode(blob);
      if (prepared) candidates.push(prepared);
    } catch (e) {
      console.warn('Barcode preprocess failed:', e);
    }
    candidates.push(blob);

    for (const b of candidates) {
      const url = URL.createObjectURL(b);
      try {
        const result = await this.reader.decodeFromImageUrl(url);
        const code = result && result.getText ? result.getText() : null;
        if (code) {
          URL.revokeObjectURL(url);
          this.close();
          if (this._onDetected) this._onDetected(code);
          return;
        }
      } catch (e) {
        // Continue to next candidate; keep the last failure for reporting.
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    this.status.textContent = 'No barcode found. Try cropping tighter or a clearer shot.';
  }

  async open(onDetected) {
    this._onDetected = onDetected;
    this.manualForm.classList.add('hidden');
    this.manualInput.value = '';
    this.modal.classList.remove('hidden');
    this.status.textContent = 'Starting camera…';

    if (!window.ZXingBrowser) {
      this.status.textContent = 'Scanner library failed to load. Enter manually.';
      this.manualForm.classList.remove('hidden');
      return;
    }

    try {
      this.reader = new window.ZXingBrowser.BrowserMultiFormatReader();
      await this._populateCameras();
      await this._start();
    } catch (e) {
      console.error(e);
      this.status.textContent = 'Camera error: ' + (e.message || e) + '. Enter manually.';
      this.manualForm.classList.remove('hidden');
    }
  }

  close() {
    if (this.controls) { try { this.controls.stop(); } catch {} this.controls = null; }
    const stream = this.video.srcObject;
    if (stream) stream.getTracks().forEach(t => t.stop());
    this.video.srcObject = null;
    this.modal.classList.add('hidden');
  }

  async _populateCameras() {
    // Request a stream first so labels become available.
    let tempStream;
    try {
      tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch (e) {
      throw new Error('Camera permission denied or unavailable');
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    tempStream.getTracks().forEach(t => t.stop());

    const cams = devices.filter(d => d.kind === 'videoinput');
    const prev = this.cameraSel.value;
    this.cameraSel.innerHTML = '';
    cams.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Camera ${i + 1}`;
      this.cameraSel.appendChild(opt);
    });
    if (!cams.length) throw new Error('No cameras found');
    if (prev && cams.some(c => c.deviceId === prev)) this.cameraSel.value = prev;
  }

  async _start() {
    if (this.controls) { try { this.controls.stop(); } catch {} this.controls = null; }
    const deviceId = this.cameraSel.value || undefined;
    this.status.textContent = 'Point camera at a UPC/EAN barcode…';
    this.controls = await this.reader.decodeFromVideoDevice(deviceId, this.video, (result, err) => {
      if (result) {
        const code = result.getText();
        if (code) {
          this.status.textContent = 'Detected ' + code;
          this.close();
          if (this._onDetected) this._onDetected(code);
        }
      }
      // err is typically NotFoundException every frame — ignore.
    });
  }

  async _restart() {
    try { await this._start(); }
    catch (e) { this.status.textContent = 'Camera error: ' + (e.message || e); }
  }

  _toggleManual() {
    this.manualForm.classList.toggle('hidden');
    if (!this.manualForm.classList.contains('hidden')) this.manualInput.focus();
  }
}

CT.scanner = new BarcodeScanner();

// Scale, grayscale, and stretch contrast on a barcode crop before handing it
// to ZXing. Tuned lighter than the OCR pipeline: ZXing does its own
// binarization, so we deliberately skip thresholding to avoid introducing
// jaggies that break bar-width detection.
const _scannerPica = (typeof pica === 'function') ? pica({ features: ['js', 'wasm'] }) : null;

async function preprocessForBarcode(blob, targetMin = 1200) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });

    const iw = img.naturalWidth, ih = img.naturalHeight;
    const shortSide = Math.min(iw, ih);
    const scale = shortSide < targetMin ? (targetMin / shortSide) : 1;
    const w = Math.round(iw * scale);
    const h = Math.round(ih * scale);

    const src = document.createElement('canvas');
    src.width = iw;
    src.height = ih;
    src.getContext('2d').drawImage(img, 0, 0);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    if (_scannerPica && scale !== 1) {
      await _scannerPica.resize(src, canvas, { filter: 'lanczos3', unsharpAmount: 60, unsharpRadius: 0.5, unsharpThreshold: 2 });
    } else {
      const c = canvas.getContext('2d');
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      c.drawImage(img, 0, 0, w, h);
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const pixels = ctx.getImageData(0, 0, w, h);
    const d = pixels.data;

    // Grayscale + luminance histogram.
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      const y = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
      d[i] = d[i + 1] = d[i + 2] = y;
      hist[y]++;
    }

    // 2/98 percentile stretch to kill screen glare and shadows without
    // binarizing: ZXing wants grayscale with good contrast, not 1-bit.
    const total = w * h;
    const loCut = total * 0.02, hiCut = total * 0.98;
    let acc = 0, lo = 0, hi = 255;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= loCut) { lo = i; break; } }
    acc = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= hiCut) { hi = i; break; } }
    if (hi - lo >= 16) {
      const range = hi - lo;
      for (let i = 0; i < d.length; i += 4) {
        let v = (d[i] - lo) * 255 / range;
        if (v < 0) v = 0; else if (v > 255) v = 255;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    }
    ctx.putImageData(pixels, 0, 0);

    return await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
