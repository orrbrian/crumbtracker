// Reusable crop overlay. Given an image and a container, renders the image
// with a draggable/resizable rectangle and a darkened mask outside it. On
// accept, produces a PNG blob of the selected region (or the whole image).
//
//   const crop = new CropOverlay(container, { imageUrl, onAccept, onCancel });

var CT = window.CT || (window.CT = {});

class CropOverlay {
  constructor(container, opts) {
    this.container = container;
    this.imageUrl = opts.imageUrl;
    this.onAccept = opts.onAccept || (() => {});
    this.onCancel = opts.onCancel || (() => {});
    this.hint = opts.hint || 'Drag the frame over the barcode or nutrition label, then click Scan.';
    this.frame = { x: 0.1, y: 0.15, w: 0.8, h: 0.7 };
    this._drag = null;
    this._buildDOM();
    this._wire();
  }

  _buildDOM() {
    const maskId = 'crop-mask-' + Math.random().toString(36).slice(2, 8);
    this.container.innerHTML = `
      <div class="crop-host" data-crop>
        <div class="crop-wrap" data-wrap>
          <img class="crop-img" draggable="false" />
          <svg class="crop-mask" viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <mask id="${maskId}">
                <rect width="100" height="100" fill="white"/>
                <rect data-cutout x="10" y="15" width="80" height="70" fill="black"/>
              </mask>
            </defs>
            <rect width="100" height="100" fill="rgba(0,0,0,0.55)" mask="url(#${maskId})"/>
          </svg>
          <div class="crop-rect" data-rect>
            <div class="crop-handle tl" data-handle="tl"></div>
            <div class="crop-handle tr" data-handle="tr"></div>
            <div class="crop-handle bl" data-handle="bl"></div>
            <div class="crop-handle br" data-handle="br"></div>
          </div>
        </div>
        <div class="crop-hint">${escapeHtml(this.hint)}</div>
        <div class="crop-toolbar">
          <button class="ghost-btn" type="button" data-action="cancel">Cancel</button>
          <button class="ghost-btn" type="button" data-action="reset">Reset frame</button>
          <button class="ghost-btn" type="button" data-action="full">Use full image</button>
          <button class="primary-btn" type="button" data-action="scan" disabled>Scan region</button>
        </div>
      </div>
    `;
    this.host      = this.container.querySelector('[data-crop]');
    this.wrap      = this.container.querySelector('[data-wrap]');
    this.img       = this.container.querySelector('.crop-img');
    this.rect      = this.container.querySelector('[data-rect]');
    this.cutout    = this.container.querySelector('[data-cutout]');
    this.scanBtn   = this.host.querySelector('[data-action="scan"]');
    this.fullBtn   = this.host.querySelector('[data-action="full"]');

    this.img.addEventListener('load', () => {
      // Size the wrap to the image's aspect so frame coords map 1:1 to pixels.
      if (this.img.naturalWidth && this.img.naturalHeight) {
        this.wrap.style.aspectRatio = this.img.naturalWidth + ' / ' + this.img.naturalHeight;
      }
      this.scanBtn.disabled = false;
      this.fullBtn.disabled = false;
      this._updateFrame();
    });
    this.img.addEventListener('error', (e) => {
      console.error('Crop: image failed to load', this.imageUrl, e);
      this.scanBtn.disabled = true;
    });
    this.img.src = this.imageUrl;
    this._updateFrame();
  }

  _wire() {
    this.host.querySelector('[data-action="cancel"]').addEventListener('click', () => this.onCancel());
    this.host.querySelector('[data-action="reset"]').addEventListener('click', () => {
      this.frame = { x: 0.1, y: 0.15, w: 0.8, h: 0.7 };
      this._updateFrame();
    });
    this.host.querySelector('[data-action="full"]').addEventListener('click', () => this._commit(false));
    this.host.querySelector('[data-action="scan"]').addEventListener('click', () => this._commit(true));

    this.rect.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const handle = e.target.dataset.handle || null;
      const wrap = this.img.getBoundingClientRect();
      this._drag = {
        mode: handle ? 'resize' : 'move',
        handle,
        wrap,
        start: { ...this.frame },
        sx: e.clientX,
        sy: e.clientY
      };
      this.rect.setPointerCapture(e.pointerId);
    });
    this.rect.addEventListener('pointermove', (e) => {
      if (!this._drag) return;
      const d = this._drag;
      const dx = (e.clientX - d.sx) / d.wrap.width;
      const dy = (e.clientY - d.sy) / d.wrap.height;
      const f = { ...d.start };
      const MIN = 0.05;
      if (d.mode === 'move') {
        f.x = clamp(f.x + dx, 0, 1 - f.w);
        f.y = clamp(f.y + dy, 0, 1 - f.h);
      } else {
        const h = d.handle;
        if (h.includes('l')) {
          const nx = clamp(d.start.x + dx, 0, d.start.x + d.start.w - MIN);
          f.w = d.start.x + d.start.w - nx;
          f.x = nx;
        }
        if (h.includes('r')) {
          f.w = clamp(d.start.w + dx, MIN, 1 - d.start.x);
        }
        if (h.includes('t')) {
          const ny = clamp(d.start.y + dy, 0, d.start.y + d.start.h - MIN);
          f.h = d.start.y + d.start.h - ny;
          f.y = ny;
        }
        if (h.includes('b')) {
          f.h = clamp(d.start.h + dy, MIN, 1 - d.start.y);
        }
      }
      this.frame = f;
      this._updateFrame();
    });
    this.rect.addEventListener('pointerup', () => { this._drag = null; });
    this.rect.addEventListener('pointercancel', () => { this._drag = null; });
  }

  _updateFrame() {
    const { x, y, w, h } = this.frame;
    this.rect.style.left   = (x * 100) + '%';
    this.rect.style.top    = (y * 100) + '%';
    this.rect.style.width  = (w * 100) + '%';
    this.rect.style.height = (h * 100) + '%';
    this.cutout.setAttribute('x', x * 100);
    this.cutout.setAttribute('y', y * 100);
    this.cutout.setAttribute('width', w * 100);
    this.cutout.setAttribute('height', h * 100);
  }

  _commit(useCrop) {
    const iw = this.img.naturalWidth;
    const ih = this.img.naturalHeight;
    if (!iw || !ih) {
      console.warn('Crop: image not loaded yet, cannot commit.');
      return;
    }
    try {
      const canvas = document.createElement('canvas');
      if (!useCrop) {
        canvas.width = iw;
        canvas.height = ih;
        canvas.getContext('2d').drawImage(this.img, 0, 0);
      } else {
        const { x, y, w, h } = this.frame;
        const sx = Math.max(0, Math.round(iw * x));
        const sy = Math.max(0, Math.round(ih * y));
        const sw = Math.max(1, Math.round(iw * w));
        const sh = Math.max(1, Math.round(ih * h));
        canvas.width = sw;
        canvas.height = sh;
        canvas.getContext('2d').drawImage(this.img, sx, sy, sw, sh, 0, 0, sw, sh);
      }
      canvas.toBlob((blob) => {
        if (!blob) { console.error('Crop: canvas.toBlob returned null'); return; }
        this.onAccept(blob, useCrop);
      }, 'image/png');
    } catch (e) {
      console.error('Crop: _commit failed', e);
    }
  }

  destroy() {
    this.container.innerHTML = '';
    this._drag = null;
  }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

CT.CropOverlay = CropOverlay;
