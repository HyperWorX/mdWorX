// Headless screenshot harness for mdWorX README/release images.
//
// mdWorX normally runs inside a WebView2 control hosted by the DOpus plugin,
// which feeds the page documents and settings over a postMessage bridge
// (window.chrome.webview). This harness stubs that bridge in a headless
// Chromium (Playwright), serves the built web/dist assets over localhost, and
// drives the same load / theme / userSettings messages the native host would.
//
// Because it renders the standalone viewer surface (no DOpus chrome, no file
// tree, no real paths) every shot is inherently free of private information:
// the only text on screen is the demo document content, which is checked in.
//
// Run:  node tests/screenshot.mjs
// Out:  img/regen/*.png   (staging dir; originals are never overwritten)

import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT    = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST    = path.join(ROOT, 'web', 'dist');
const OUT     = path.join(ROOT, 'img', 'regen');
const DEMO_MD = path.join(ROOT, 'tests', 'screenshot-demo.md');
const MIXED_MD = path.join(ROOT, 'tests', 'eol-mixed.md');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.woff2': 'font/woff2',
};

// --- tiny static server (strips ?query so cache-bust tokens resolve) --------
function startServer(rootDir) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        let urlPath = decodeURIComponent(req.url.split('?')[0]);
        if (urlPath === '/') urlPath = '/index.html';
        const filePath = path.join(rootDir, urlPath);
        if (!filePath.startsWith(rootDir)) { res.writeHead(403).end(); return; }
        const buf = await readFile(filePath);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(buf);
      } catch {
        res.writeHead(404).end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// Bridge stub injected before any page script runs. Captures the host->page
// callback the viewer/settings register, and exposes __mdwxDispatch so the
// harness can play the native host role.
const BRIDGE_STUB = `
  window.__mdwxMsgCb = null;
  window.__mdwxOutbox = [];
  window.chrome = window.chrome || {};
  window.chrome.webview = {
    postMessage(s) { window.__mdwxOutbox.push(s); },
    addEventListener(type, cb) { if (type === 'message') window.__mdwxMsgCb = cb; },
    removeEventListener() {},
  };
  window.__mdwxDispatch = (obj) => {
    if (window.__mdwxMsgCb) window.__mdwxMsgCb({ data: JSON.stringify(obj) });
  };
`;

const FONTS = ['Segoe UI', 'Consolas', 'Cascadia Code', 'Arial', 'Georgia'];

async function dispatch(page, obj) {
  await page.evaluate((o) => window.__mdwxDispatch(o), obj);
}

async function settle(page, ms = 450) { await page.waitForTimeout(ms); }

async function main() {
  if (!existsSync(DIST)) { console.error('web/dist not found — run: node web/build.mjs'); process.exit(1); }
  await mkdir(OUT, { recursive: true });

  const demoMd  = await readFile(DEMO_MD, 'utf8');
  const mixedMd = existsSync(MIXED_MD) ? await readFile(MIXED_MD, 'utf8') : demoMd;

  const server = await startServer(DIST);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  console.log('serving dist on', base);

  const browser = await chromium.launch();

  // ---- viewer shots ---------------------------------------------------------
  async function viewerShot({ name, palette, mode, paneMode, paneBg, settings = {}, content = demoMd, prep }) {
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 800 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.addInitScript(BRIDGE_STUB);
    await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('!!window.__mdwxMsgCb', null, { timeout: 5000 });

    const merged = { activePalette: palette, ...settings };
    await dispatch(page, { type: 'theme', mode: paneMode, paneBg });
    await dispatch(page, { type: 'userSettings', json: JSON.stringify(merged) });
    await dispatch(page, { type: 'load', path: 'demo.md', content, encoding: 'utf-8' });
    await settle(page);

    if (mode) { await page.click(`button[data-mode="${mode}"]`); await settle(page); }
    if (prep) { await prep(page); await settle(page); }

    await page.screenshot({ path: path.join(OUT, name + '.png') });
    console.log('  shot', name);
    await ctx.close();
  }

  // ---- settings shots (per tab) --------------------------------------------
  async function settingsShot({ name, tab, palette = 'Default Light', paneMode = 'light', paneBg = '#ffffff', width = 760, height = 920, clipTop }) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.addInitScript(BRIDGE_STUB);
    await page.goto(base + '/settings.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('!!window.__mdwxMsgCb', null, { timeout: 5000 });

    await dispatch(page, { type: 'paneTheme', mode: paneMode, paneBg });
    await dispatch(page, { type: 'userSettings', json: JSON.stringify({ activePalette: palette }) });
    await dispatch(page, { type: 'customThemesList', names: [] });
    await dispatch(page, { type: 'fonts', list: FONTS });
    await dispatch(page, { type: 'appVersion', current: '0.2.0-beta' });
    await settle(page);

    if (tab) { await page.click(`.tab-button[data-tab="${tab}"]`); await settle(page, 250); }

    const opts = { path: path.join(OUT, name + '.png') };
    if (clipTop) opts.clip = { x: 0, y: 0, width, height: clipTop };
    await page.screenshot(opts);
    console.log('  shot', name);
    await ctx.close();
  }

  console.log('viewer shots:');
  await viewerShot({ name: 'reading-light', palette: 'Default Light', mode: 'reading', paneMode: 'light', paneBg: '#ffffff' });
  await viewerShot({ name: 'reading-dark',  palette: 'Default Dark',  mode: 'reading', paneMode: 'dark',  paneBg: '#1e1e1e' });
  await viewerShot({ name: 'reading-dracula', palette: 'Dracula',     mode: 'reading', paneMode: 'dark',  paneBg: '#282a36' });
  await viewerShot({ name: 'live-light',    palette: 'Default Light', mode: 'live',    paneMode: 'light', paneBg: '#ffffff' });
  await viewerShot({ name: 'live-dark',     palette: 'Default Dark',  mode: 'live',    paneMode: 'dark',  paneBg: '#1e1e1e' });
  await viewerShot({ name: 'source-split',  palette: 'Default Light', mode: 'source',  paneMode: 'light', paneBg: '#ffffff',
    prep: async (page) => { await page.click('button[data-mode="source"]'); } }); // 2nd click toggles split
  await viewerShot({ name: 'image-popup',   palette: 'Default Light', mode: 'live',    paneMode: 'light', paneBg: '#ffffff',
    prep: async (page) => { const b = await page.$('#etb-image-btn'); if (b) await b.click(); } });
  await viewerShot({ name: 'formatting-marks', palette: 'Default Light', mode: 'source', paneMode: 'light', paneBg: '#ffffff',
    settings: { showFormattingMarks: true }, content: mixedMd });

  // Dark variants for the README. All use Default Dark on the same #1e1e1e pane
  // background so every content image shares the hero GIF's grey surround;
  // palette variety is shown separately in the palette-cascade image.
  await viewerShot({ name: 'source-split-dark', palette: 'Default Dark', mode: 'source', paneMode: 'dark', paneBg: '#1e1e1e',
    prep: async (page) => { await page.click('button[data-mode="source"]'); } });
  await viewerShot({ name: 'image-popup-dark',  palette: 'Default Dark', mode: 'live',   paneMode: 'dark', paneBg: '#1e1e1e',
    prep: async (page) => { const b = await page.$('#etb-image-btn'); if (b) await b.click(); } });
  await viewerShot({ name: 'formatting-marks-dark', palette: 'Default Dark', mode: 'source', paneMode: 'dark', paneBg: '#1e1e1e',
    settings: { showFormattingMarks: true }, content: mixedMd });

  console.log('settings shots:');
  await settingsShot({ name: 'settings-appearance', tab: 'appearance' });
  await settingsShot({ name: 'settings-document',   tab: 'document' });
  await settingsShot({ name: 'settings-toolbars',   tab: 'toolbars' });
  await settingsShot({ name: 'settings-about',      tab: 'about' });
  // Dark settings dialog for the README.
  await settingsShot({ name: 'settings-appearance-dark', tab: 'appearance', palette: 'Default Dark', paneMode: 'dark', paneBg: '#1e1e1e' });
  await settingsShot({ name: 'settings-about-dark',      tab: 'about',      palette: 'Default Dark', paneMode: 'dark', paneBg: '#1e1e1e' });
  // tight top crop of each tab to compare the subtitle/header line-break
  await settingsShot({ name: 'settings-top-appearance', tab: 'appearance', clipTop: 230 });
  await settingsShot({ name: 'settings-top-about',      tab: 'about',      clipTop: 230 });

  await browser.close();
  server.close();

  const made = (await readdir(OUT)).filter(f => f.endsWith('.png'));
  console.log(`\nDone. ${made.length} images in img/regen/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
