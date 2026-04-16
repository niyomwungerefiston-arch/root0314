/**
 * Génère les icônes PNG de Buchat à partir des SVG sources.
 * Utilise Puppeteer (déjà installé pour les screenshots).
 *
 * Tailles générées :
 *   - PWA : 192, 512 (any + maskable)
 *   - iOS apple-touch-icon : 180
 *   - Favicon : 32, 16
 *   - Android : 48, 72, 96, 144, 192, 512
 *   - Windows (Electron) : 256, 512
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const ICONS_DIR = path.join(__dirname, '..', 'web-preview', 'icons');

const SIZES = [
  { name: 'icon-16.png',      size: 16,  src: 'icon.svg' },
  { name: 'icon-32.png',      size: 32,  src: 'icon.svg' },
  { name: 'icon-48.png',      size: 48,  src: 'icon.svg' },
  { name: 'icon-72.png',      size: 72,  src: 'icon.svg' },
  { name: 'icon-96.png',      size: 96,  src: 'icon.svg' },
  { name: 'icon-144.png',     size: 144, src: 'icon.svg' },
  { name: 'icon-180.png',     size: 180, src: 'icon.svg' }, // Apple touch icon
  { name: 'icon-192.png',     size: 192, src: 'icon.svg' },
  { name: 'icon-256.png',     size: 256, src: 'icon.svg' },
  { name: 'icon-512.png',     size: 512, src: 'icon.svg' },
  { name: 'icon-192-maskable.png', size: 192, src: 'icon-maskable.svg' },
  { name: 'icon-512-maskable.png', size: 512, src: 'icon-maskable.svg' },
];

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  for (const { name, size, src } of SIZES) {
    const svg = fs.readFileSync(path.join(ICONS_DIR, src), 'utf8');
    const html = `<!DOCTYPE html><html><head><style>
      body{margin:0;padding:0;background:transparent;}
      svg{width:${size}px;height:${size}px;display:block;}
    </style></head><body>${svg}</body></html>`;

    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10000 });

    await page.screenshot({
      path: path.join(ICONS_DIR, name),
      type: 'png',
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });

    console.log(`✓ ${name} (${size}x${size})`);
  }

  // Favicon ICO: use the 32x32 PNG as favicon.ico (most browsers accept PNG-in-ICO)
  fs.copyFileSync(
    path.join(ICONS_DIR, 'icon-32.png'),
    path.join(ICONS_DIR, 'favicon.ico')
  );
  console.log('✓ favicon.ico');

  await browser.close();
  console.log(`\nDone! ${SIZES.length + 1} icons generated in ${ICONS_DIR}`);
})();
