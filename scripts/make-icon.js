// Generate a square app icon from the mascot. Source is 256x384 (taller than
// wide); crop to the top 256x256 (chef hat + head + upper body), then upscale
// to 512x512 for high-quality ICO conversion. Saves to renderer/assets/icon.png
// which electron-builder picks up via build.win.icon and main.js BrowserWindow.

const path = require('path');
const sharp = require('sharp');

const SRC = path.join(__dirname, '..', 'renderer', 'assets', 'mascot.png');
const DST = path.join(__dirname, '..', 'renderer', 'assets', 'icon.png');

(async () => {
  const meta = await sharp(SRC).metadata();
  console.log(`Source: ${SRC} (${meta.width}x${meta.height})`);

  const side = Math.min(meta.width, meta.height);

  await sharp(SRC)
    .extract({ left: Math.floor((meta.width - side) / 2), top: 0, width: side, height: side })
    .resize(512, 512, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9 })
    .toFile(DST);

  console.log(`Wrote: ${DST} (512x512)`);
})().catch(err => { console.error(err); process.exit(1); });
