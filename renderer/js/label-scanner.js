// Nutrition-label OCR scanner. Uses tesseract.js (bundled locally).

var CT = window.CT || (window.CT = {});

let _tessWorker = null;
async function getTessWorker(onProgress) {
  if (_tessWorker) return _tessWorker;
  const opts = {
    workerPath: 'vendor/tesseract/worker.min.js',
    corePath: 'vendor/tesseract/',
    langPath: 'vendor/tesseract/',
    logger: (m) => onProgress && onProgress(m)
  };
  _tessWorker = await Tesseract.createWorker('eng', 1, opts);
  return _tessWorker;
}

function parseNutritionText(raw) {
  const text = raw.replace(/\r/g, '').replace(/[|]/g, ' ').replace(/\s+/g, ' ');
  const result = {
    name: '',
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    serving_size: 0,
    serving_unit: 'g',
    raw: raw
  };

  // Calories — just the number after the word.
  const calMatch = text.match(/calories[^0-9]{0,8}(\d{1,4})/i);
  if (calMatch) result.calories = Number(calMatch[1]);

  // Total fat — prefer "Total Fat", fall back to "Fat" at start of a number context.
  const fatMatch = text.match(/total\s*fat[^0-9]{0,6}([\d.]+)\s*g/i)
                || text.match(/\bfat[^0-9]{0,6}([\d.]+)\s*g/i);
  if (fatMatch) result.fat = Number(fatMatch[1]);

  // Total carbohydrate. OCR mangles this often; allow fuzzy letters.
  const carbMatch = text.match(/total\s*carbo\w*[^0-9]{0,6}([\d.]+)\s*g/i)
                 || text.match(/carbo\w*[^0-9]{0,6}([\d.]+)\s*g/i)
                 || text.match(/\bcarbs?\b[^0-9]{0,6}([\d.]+)\s*g/i);
  if (carbMatch) result.carbs = Number(carbMatch[1]);

  const protMatch = text.match(/protein[^0-9]{0,6}([\d.]+)\s*g/i);
  if (protMatch) result.protein = Number(protMatch[1]);

  // Serving size. Labels often read "Serving size 1 cup (30g)" — prefer parens in g/ml.
  const servParen = text.match(/serving\s*size[^()]{0,40}\(\s*([\d.]+)\s*(g|ml)\s*\)/i);
  if (servParen) {
    result.serving_size = Number(servParen[1]);
    result.serving_unit = servParen[2].toLowerCase();
  } else {
    const servSimple = text.match(/serving\s*size[^0-9]{0,8}([\d.]+)\s*(g|ml|mg|oz|cup|cups|tbsp|tsp|piece|pieces|slice|slices)?/i);
    if (servSimple) {
      result.serving_size = Number(servSimple[1]);
      result.serving_unit = (servSimple[2] || 'g').toLowerCase();
    }
  }

  return result;
}

class LabelScanner {
  constructor() {
    this.modal = document.getElementById('label-modal');
    this.video = document.getElementById('label-video');
    this.image = document.getElementById('label-image');
    this.status = document.getElementById('label-status');
    this.cameraSel = document.getElementById('label-camera');
    this.captureBtn = document.getElementById('label-capture');
    this.uploadBtn = document.getElementById('label-upload');
    this.retryBtn = document.getElementById('label-retry');
    this.fileInput = document.getElementById('label-file');
    this.progressEl = document.getElementById('label-progress');
    this.progressFill = document.getElementById('label-progress-fill');
    this.progressText = document.getElementById('label-progress-text');
    this.resultsEl = document.getElementById('label-results');
    this.stream = null;
    this._onParsed = null;

    this.modal.addEventListener('click', (e) => {
      if (e.target.dataset.close !== undefined || e.target === this.modal) this.close();
    });
    this.cameraSel.addEventListener('change', () => this._restartCamera());
    this.captureBtn.addEventListener('click', () => this._capture());
    this.uploadBtn.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => this._uploadFile());
    this.retryBtn.addEventListener('click', () => this._reset());

    const desktopBtn = document.getElementById('label-desktop');
    if (desktopBtn) desktopBtn.addEventListener('click', () => this._desktopSnip());
  }

  async _desktopSnip() {
    if (!window.ct || !window.ct.openViewfinder) {
      this.status.textContent = 'Desktop snip not available in this build.';
      return;
    }
    this._stopCamera();
    this.status.textContent = 'Viewfinder open — position it over the nutrition label and click Capture.';
    try {
      const data = await window.ct.openViewfinder();
      if (!data) {
        // Cancelled. Try to resume camera.
        this._startCamera().catch(() => {});
        return;
      }
      const blob = new Blob([data], { type: 'image/png' });
      this._openCrop(blob);
    } catch (e) {
      console.error(e);
      this.status.textContent = 'Desktop snip failed: ' + (e.message || e);
    }
  }

  async open(onParsed) {
    this._onParsed = onParsed;
    this._reset();
    this.modal.classList.remove('hidden');
    try {
      await this._populateCameras();
      await this._startCamera();
    } catch (e) {
      this.status.textContent = 'Camera unavailable — use 📁 Image to upload instead.';
    }
  }

  close() {
    this._stopCamera();
    this.modal.classList.add('hidden');
  }

  _reset() {
    this.image.src = '';
    this.image.classList.add('hidden');
    this.video.classList.remove('hidden');
    this.progressEl.classList.add('hidden');
    this.resultsEl.classList.add('hidden');
    this.resultsEl.innerHTML = '';
    this.retryBtn.classList.add('hidden');
    this.captureBtn.classList.remove('hidden');
    this.uploadBtn.classList.remove('hidden');
    this.status.textContent = 'Frame the Nutrition Facts panel, then click Capture.';
  }

  async _populateCameras() {
    let temp;
    try {
      temp = await navigator.mediaDevices.getUserMedia({ video: true });
    } catch (e) {
      throw new Error('Camera permission denied.');
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    temp.getTracks().forEach(t => t.stop());
    const cams = devices.filter(d => d.kind === 'videoinput');
    const prev = this.cameraSel.value;
    this.cameraSel.innerHTML = '';
    cams.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Camera ${i + 1}`;
      this.cameraSel.appendChild(opt);
    });
    if (prev && cams.some(c => c.deviceId === prev)) this.cameraSel.value = prev;
  }

  async _startCamera() {
    this._stopCamera();
    const deviceId = this.cameraSel.value;
    const constraints = {
      video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } },
      audio: false
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.video.srcObject = this.stream;
    await this.video.play();
  }

  async _restartCamera() {
    try { await this._startCamera(); } catch (e) { this.status.textContent = 'Camera error: ' + e.message; }
  }

  _stopCamera() {
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    this.video.srcObject = null;
  }

  _capture() {
    if (!this.stream) { this.status.textContent = 'No camera. Use 📁 Image instead.'; return; }
    const canvas = document.createElement('canvas');
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh) { this.status.textContent = 'Camera not ready yet.'; return; }
    canvas.width = vw;
    canvas.height = vh;
    canvas.getContext('2d').drawImage(this.video, 0, 0, vw, vh);
    this._stopCamera();
    canvas.toBlob((blob) => this._openCrop(blob), 'image/png');
  }

  _uploadFile() {
    const file = this.fileInput.files[0];
    this.fileInput.value = '';
    if (!file) return;
    this._stopCamera();
    this._openCrop(file);
  }

  _openCrop(blobOrFile) {
    const url = URL.createObjectURL(blobOrFile);
    const stage = this.video.parentElement; // .label-stage
    // Hide the camera/result stage and all action buttons during cropping.
    stage.classList.add('hidden');
    this.captureBtn.classList.add('hidden');
    this.uploadBtn.classList.add('hidden');
    this.retryBtn.classList.add('hidden');
    this.cameraSel.disabled = true;
    this.status.textContent = 'Position the frame over the Nutrition Facts panel.';

    let cropEl = document.getElementById('label-crop');
    if (cropEl) cropEl.remove();
    cropEl = document.createElement('div');
    cropEl.id = 'label-crop';
    cropEl.className = 'scanner-crop';
    stage.parentElement.insertBefore(cropEl, stage.nextSibling);

    new CT.CropOverlay(cropEl, {
      imageUrl: url,
      hint: 'Drag the frame over the nutrition facts panel, then click Scan region.',
      onCancel: () => {
        URL.revokeObjectURL(url);
        cropEl.remove();
        stage.classList.remove('hidden');
        this.cameraSel.disabled = false;
        this._reset();
        this._startCamera().catch(() => {});
      },
      onAccept: (cropped) => {
        URL.revokeObjectURL(url);
        cropEl.remove();
        stage.classList.remove('hidden');
        this.cameraSel.disabled = false;
        this._showImageFromBlob(cropped);
        this._scrollToTop();
        this._runOcr(cropped);
      }
    });
  }

  _scrollToTop() {
    const card = this.modal.querySelector('.modal-card');
    if (card) card.scrollTop = 0;
  }

  _showImageFromBlob(blob) {
    const u = URL.createObjectURL(blob);
    this.image.src = u;
    this.image.onload = () => URL.revokeObjectURL(u);
    this.image.classList.remove('hidden');
    this.video.classList.add('hidden');
    this.captureBtn.classList.add('hidden');
    this.uploadBtn.classList.add('hidden');
  }

  _showImage(url) {
    this.image.src = url;
    this.image.classList.remove('hidden');
    this.video.classList.add('hidden');
    this.captureBtn.classList.add('hidden');
    this.uploadBtn.classList.add('hidden');
  }

  async _runOcr(source) {
    this.progressEl.classList.remove('hidden');
    this.progressFill.style.width = '0%';
    this.progressText.textContent = 'Loading OCR engine…';
    this.status.textContent = '';
    try {
      const worker = await getTessWorker((m) => {
        if (m.status === 'recognizing text' && typeof m.progress === 'number') {
          this.progressFill.style.width = Math.round(m.progress * 100) + '%';
          this.progressText.textContent = `Recognizing… ${Math.round(m.progress * 100)}%`;
        } else if (m.status) {
          this.progressText.textContent = m.status;
        }
      });
      this.progressText.textContent = 'Preparing image…';
      const prepared = await preprocessForOcr(source, {
        onProgress: (msg) => { this.progressText.textContent = msg; }
      });
      const { data } = await worker.recognize(prepared);
      const parsed = parseNutritionText(data.text);
      this._showResults(parsed, data.text);
    } catch (e) {
      console.error(e);
      this.status.textContent = 'OCR failed: ' + (e.message || e);
      this.retryBtn.classList.remove('hidden');
      this.progressEl.classList.add('hidden');
    }
  }

  _showResults(parsed, rawText) {
    this.progressEl.classList.add('hidden');
    const found = [];
    if (parsed.calories) found.push(`${parsed.calories} kcal`);
    if (parsed.protein)  found.push(`${parsed.protein}g protein`);
    if (parsed.carbs)    found.push(`${parsed.carbs}g carbs`);
    if (parsed.fat)      found.push(`${parsed.fat}g fat`);
    if (parsed.serving_size) found.push(`serving ${parsed.serving_size} ${parsed.serving_unit}`);

    if (!found.length) {
      this.resultsEl.innerHTML = `
        <div class="label-empty">Couldn't find nutrition values. Raw text:</div>
        <pre class="label-raw">${escapeHtml(rawText.slice(0, 400))}${rawText.length > 400 ? '…' : ''}</pre>
      `;
      this.retryBtn.classList.remove('hidden');
      this.resultsEl.classList.remove('hidden');
      return;
    }

    this.resultsEl.innerHTML = `
      <div class="label-found">Found:</div>
      <div class="label-values">${found.join(' · ')}</div>
      <div class="label-actions">
        <button class="ghost-btn" id="label-raw-toggle" type="button">Show raw text</button>
        <button class="primary-btn" id="label-accept" type="button">Use these values</button>
      </div>
      <pre class="label-raw hidden" id="label-raw-text">${escapeHtml(rawText)}</pre>
    `;
    this.resultsEl.classList.remove('hidden');
    this.retryBtn.classList.remove('hidden');

    document.getElementById('label-raw-toggle').addEventListener('click', () => {
      document.getElementById('label-raw-text').classList.toggle('hidden');
    });
    document.getElementById('label-accept').addEventListener('click', () => {
      this.close();
      if (this._onParsed) this._onParsed(parsed);
    });
  }
}

// Skip web-worker path — pica's data:-URI worker is blocked by our CSP.
const _pica = (typeof pica === 'function') ? pica({ features: ['js', 'wasm'] }) : null;

// Sauvola adaptive threshold on a grayscale Uint8ClampedArray. Uses integral
// images so the window mean + variance are O(1) per pixel regardless of window
// size. `window` should be odd and roughly text stroke × 15–20; `k` tunes
// sensitivity (higher = more text kept as foreground).
function sauvolaThreshold(gray, w, h, window = 25, k = 0.2, R = 128) {
  const half = window >> 1;
  const n = w * h;
  // Integral images of I and I^2, padded by 1 row/col so we can do
  // sum(x0,y0..x1,y1) = I[x1+1][y1+1] - I[x0][y1+1] - I[x1+1][y0] + I[x0][y0].
  const pw = w + 1, ph = h + 1;
  const sum = new Float64Array(pw * ph);
  const sum2 = new Float64Array(pw * ph);
  for (let y = 0; y < h; y++) {
    let rowSum = 0, rowSum2 = 0;
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x];
      rowSum += v; rowSum2 += v * v;
      const i = (y + 1) * pw + (x + 1);
      sum[i]  = sum[i - pw]  + rowSum;
      sum2[i] = sum2[i - pw] + rowSum2;
    }
  }
  const out = new Uint8ClampedArray(n);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(h - 1, y + half);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(w - 1, x + half);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const a = y0 * pw + x0;
      const b = y0 * pw + (x1 + 1);
      const c = (y1 + 1) * pw + x0;
      const d = (y1 + 1) * pw + (x1 + 1);
      const s  = sum[d]  - sum[b]  - sum[c]  + sum[a];
      const s2 = sum2[d] - sum2[b] - sum2[c] + sum2[a];
      const mean = s / area;
      const varr = Math.max(0, s2 / area - mean * mean);
      const std = Math.sqrt(varr);
      const t = mean * (1 + k * (std / R - 1));
      out[y * w + x] = gray[y * w + x] > t ? 255 : 0;
    }
  }
  return out;
}

// Preprocess a blob for OCR. Pipeline:
//   1. Decode + upscale so shorter edge ≥ targetMin (Pica/Lanczos if available).
//   2. Grayscale.
//   3. Sauvola adaptive threshold → binary PNG.
async function preprocessForOcr(blob, opts = {}) {
  const { targetMin = 1600, onProgress } = opts;
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
    if (_pica && scale !== 1) {
      onProgress && onProgress('Upscaling…');
      await _pica.resize(src, canvas, { filter: 'lanczos3', unsharpAmount: 80, unsharpRadius: 0.6, unsharpThreshold: 2 });
    } else {
      const c = canvas.getContext('2d');
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      c.drawImage(img, 0, 0, w, h);
    }

    onProgress && onProgress('Thresholding…');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const pixels = ctx.getImageData(0, 0, w, h);
    const d = pixels.data;
    const gray = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      gray[j] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    }

    // Window scales with text stroke; ~1/30th of image height typically lands
    // in the 40–70 px range for a well-framed label.
    const win = (Math.max(15, Math.round(h / 30)) | 1);
    const bin = sauvolaThreshold(gray, w, h, win, 0.2, 128);

    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const v = bin[j];
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

CT.labelScanner = new LabelScanner();
CT.parseNutritionText = parseNutritionText;
