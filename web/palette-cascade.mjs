// Palette cascade image for the README.
//
// Renders the ACTUAL mdWorX viewer (toolbar + rendered document) in a range of
// palettes, then composites those live renders as overlapping "cascading
// cards" into a single transparent PNG. Real editor screenshots, not the
// swatch cards in docs/palette-images.
//
// The viewer applies CONCRETE colour keys (accentColor, h1Color, ...), not a
// palette name, so we extract the `palettes` object from web/src/settings.js
// and feed each palette's colours as userSettings.
//
// Run:  node web/palette-cascade.mjs
// Out:  img/regen/palette-cascade.png  (+ per-palette cards in img/regen/cards/)

import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'web', 'dist');
const SETTINGS_SRC = path.join(ROOT, 'web', 'src', 'settings.js');
const OUT = path.join(ROOT, 'img', 'regen');
const CARDS = path.join(OUT, 'cards');
const DEMO_MD = path.join(ROOT, 'tests', 'screenshot-demo.md');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };

function startServer(rootDir) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        let urlPath = decodeURIComponent(req.url.split('?')[0]);
        if (urlPath === '/') urlPath = '/index.html';
        const filePath = path.join(rootDir, urlPath);
        if (!filePath.startsWith(rootDir)) { res.writeHead(403).end(); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(await readFile(filePath));
      } catch { res.writeHead(404).end('not found'); }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const BRIDGE_STUB = `
  window.__mdwxMsgCb = null;
  window.chrome = window.chrome || {};
  window.chrome.webview = {
    postMessage() {},
    addEventListener(t, cb) { if (t === 'message') window.__mdwxMsgCb = cb; },
    removeEventListener() {},
  };
  window.__mdwxDispatch = (o) => { if (window.__mdwxMsgCb) window.__mdwxMsgCb({ data: JSON.stringify(o) }); };
`;

// Extract `const palettes = { ... }` from settings.js and eval the literal.
// Brace-counting handles the nested codeColors / heading-colour objects;
// the values are hex strings + comments only, so no braces hide in strings.
async function loadPalettes() {
  const src = await readFile(SETTINGS_SRC, 'utf8');
  const decl = src.indexOf('const palettes = {');
  if (decl < 0) throw new Error('palettes declaration not found');
  const braceStart = src.indexOf('{', decl);
  let depth = 0, end = -1;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  // eslint-disable-next-line no-eval
  return eval('(' + src.slice(braceStart, end + 1) + ')');
}

// Mostly dark with one light, distinct hues, popular palettes.
const SELECTION = ['Dracula', 'Tokyo Night', 'Nord', 'Gruvbox Dark', 'Catppuccin Mocha', 'Everforest', 'Rosé Pine', 'Solarized Light'];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const CARD_W = 860, CARD_H = 600;

async function main() {
  if (!existsSync(DIST)) { console.error('web/dist not found - run: node web/build.mjs'); process.exit(1); }
  await mkdir(CARDS, { recursive: true });
  const demoMd = await readFile(DEMO_MD, 'utf8');
  const palettes = await loadPalettes();
  for (const n of SELECTION) if (!palettes[n]) throw new Error('palette not found: ' + n);

  const server = await startServer(DIST);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch();

  // --- 1. capture a real viewer render per palette --------------------------
  const cards = [];
  for (const name of SELECTION) {
    const pal = palettes[name];
    const ctx = await browser.newContext({ viewport: { width: CARD_W, height: CARD_H }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.addInitScript(BRIDGE_STUB);
    await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('!!window.__mdwxMsgCb', null, { timeout: 5000 });
    await page.evaluate((o) => window.__mdwxDispatch(o), { type: 'theme', mode: pal.theme === 'light' ? 'light' : 'dark', paneBg: pal.pageColor });
    // Feed the palette's concrete colours (the viewer has no palette table).
    await page.evaluate((o) => window.__mdwxDispatch(o), { type: 'userSettings', json: JSON.stringify(pal) });
    await page.evaluate((o) => window.__mdwxDispatch(o), { type: 'load', path: 'demo.md', content: demoMd, encoding: 'utf-8' });
    await page.waitForTimeout(500);
    await page.click('button[data-mode="reading"]');
    await page.waitForTimeout(450);
    const buf = await page.screenshot();              // viewport-sized buffer
    await writeFile(path.join(CARDS, slug(name) + '.png'), buf);
    cards.push({ name, dataUrl: 'data:image/png;base64,' + buf.toString('base64') });
    console.log('  card', name);
    await ctx.close();
  }

  // --- 2. composite into an overlapping fanned deck -------------------------
  const DX = 88, DY = 62;
  const ROT = [-7, -4, -1.5, 1, 3.5, -2.5, 2, 6];
  const cardW = 520, cardH = Math.round(cardW * CARD_H / CARD_W);
  const canvasW = DX * (cards.length - 1) + cardW + 120;
  const canvasH = DY * (cards.length - 1) + cardH + 120;

  const cardsHtml = cards.map((c, i) => `
    <div class="card" style="left:${60 + i * DX}px; top:${40 + i * DY}px;
         transform: rotate(${ROT[i % ROT.length]}deg); z-index:${i + 1};">
      <img src="${c.dataUrl}" alt="${c.name}">
      <span class="tag">${c.name}</span>
    </div>`).join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body { margin:0; background:transparent; }
    #stage { position:relative; width:${canvasW}px; height:${canvasH}px; }
    .card { position:absolute; width:${cardW}px; height:${cardH}px;
            border-radius:14px; overflow:hidden;
            box-shadow: 0 22px 50px rgba(0,0,0,0.45), 0 4px 12px rgba(0,0,0,0.35);
            outline:1px solid rgba(255,255,255,0.12); background:#111; }
    .card img { width:100%; height:100%; object-fit:cover; object-position:top center; display:block; }
    .card .tag { position:absolute; left:12px; bottom:12px;
            font:600 14px/1 'Segoe UI',system-ui,sans-serif; color:#fff;
            background:rgba(0,0,0,0.6); padding:6px 10px; border-radius:8px; }
  </style></head><body><div id="stage">${cardsHtml}</div></body></html>`;

  const ctx = await browser.newContext({ viewport: { width: canvasW, height: canvasH }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const stage = await page.$('#stage');
  await stage.screenshot({ path: path.join(OUT, 'palette-cascade.png'), omitBackground: true });
  console.log('  cascade -> img/regen/palette-cascade.png');
  await ctx.close();

  await browser.close();
  server.close();
  console.log('done');
}

main().catch((e) => { console.error(e); process.exit(1); });
