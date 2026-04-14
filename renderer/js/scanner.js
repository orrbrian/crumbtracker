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
    const url = URL.createObjectURL(blob);
    this.status.textContent = 'Decoding image…';
    try {
      const result = await this.reader.decodeFromImageUrl(url);
      const code = result && result.getText ? result.getText() : null;
      if (code) {
        this.close();
        if (this._onDetected) this._onDetected(code);
      } else {
        this.status.textContent = 'No barcode found. Try cropping tighter.';
      }
    } catch (e) {
      console.warn('Image decode failed:', e);
      this.status.textContent = 'No barcode found. Try cropping tighter or a clearer shot.';
    } finally {
      URL.revokeObjectURL(url);
    }
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
