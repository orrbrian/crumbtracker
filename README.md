# CrumbTracker

Local, stand-alone calorie and nutrition tracker. Electron app — every entry stays on your machine.

## Download

Pre-built Windows binaries are attached to each [Release](../../releases):

- **Setup `.exe`** — standard installer (per-user, no admin required).
- **Portable `.exe`** — run from anywhere, no install.

## Features

- **Daily diary** with Breakfast / Lunch / Dinner / Snacks. Calorie and macro targets, progress bars, over-budget quips.
- **Food search** via Open Food Facts, with exact-match barcode lookup pinned to top.
- **Barcode scanning** — webcam UPC/EAN via ZXing, or drop in a photo/screenshot and crop.
- **Nutrition-label OCR** — Tesseract.js reads a Nutrition Facts panel locally. Lanczos upscale + Sauvola adaptive threshold preprocess the image for accuracy.
- **Desktop snip** — transparent always-on-top viewfinder that captures any rectangle of your desktop (browser tab, PDF, other app) for barcode or label scanning.
- **Custom foods** with image (file/paste/drop — handles Snipping Tool and browser "Copy Image"), barcode attach, and macro entry.
- **Meals** — compose saved recipes from existing foods (e.g. "Turkey sandwich" = bread + turkey + lettuce + mayo). Log as a single diary entry with snapshot macros.
- **Exercise** logged separately; shows as net calories in the sidebar.
- **Progress** chart with weigh-ins, plan line, and projection under your current calorie target.
- **Body profile** → BMR / TDEE (Mifflin–St Jeor) with one-click calorie targets.
- **Notes** per day, auto-saved.
- **Units toggle** (lb/ft·in ↔ kg/cm) with automatic conversion.

## Run from source

```
npm install
npm start
```

## Build

```
npm run dist
```

Output goes in `dist/` — installer, portable `.exe`, and unpacked directory.

## Data

Everything lives in IndexedDB inside Electron's per-app user-data directory. Object stores: `foods`, `entries`, `settings`, `notes`, `weights`, `exercise`, `meals`. Nothing leaves your machine except requests to `world.openfoodfacts.org` / `search.openfoodfacts.org` when you search or scan a barcode.

## Credits

Nutrition data from [Open Food Facts](https://world.openfoodfacts.org/). Barcode decoding via [ZXing](https://github.com/zxing-js/browser). OCR via [Tesseract.js](https://tesseract.projectnaptha.com/). Lanczos resize via [pica](https://github.com/nodeca/pica).
