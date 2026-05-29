// Animated hero GIF for the README.
//
// Opens on firstframe.png (mdWorX in the real DOpus window, full and uncropped),
// holds, then slowly zooms into the right-hand viewer pane until only the
// document is in frame (no DOpus chrome) and reveals the live viewer. Then a
// synthetic cursor drives it: Reading -> Live (typed edit) -> Source (typed
// edit) -> click again to split -> use the editing toolbar (select a word,
// Bold, preview updates live) -> deliberately resize the panes -> scroll.
//
// Run:  node web/hero-gif.mjs   Out: img/regen/hero.gif

import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'web', 'dist');
const DEMO_MD = path.join(ROOT, 'tests', 'screenshot-demo.md');
const FIRST_FRAME = path.join(ROOT, 'img', 'firstframe.png');
const VID_DIR = path.join(os.tmpdir(), 'mdwx-hero-video');

// Viewport aspect matches firstframe.png (3840x2280 = 1.684) so the intro
// image fills the frame with no cropping ("first frame out of shot" fix).
const W = 1180, H = 700;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };
function startServer(rootDir) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        let u = decodeURIComponent(req.url.split('?')[0]);
        if (u === '/') u = '/index.html';
        const fp = path.join(rootDir, u);
        if (!fp.startsWith(rootDir)) { res.writeHead(403).end(); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
        res.end(await readFile(fp));
      } catch { res.writeHead(404).end('nf'); }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const BRIDGE_STUB = `
  window.__mdwxMsgCb = null;
  window.chrome = window.chrome || {};
  window.chrome.webview = { postMessage(){}, addEventListener(t,cb){ if(t==='message') window.__mdwxMsgCb=cb; }, removeEventListener(){} };
  window.__mdwxDispatch = (o) => { if (window.__mdwxMsgCb) window.__mdwxMsgCb({ data: JSON.stringify(o) }); };
`;

const SMOOTH = 'left .5s cubic-bezier(.4,0,.2,1), top .5s cubic-bezier(.4,0,.2,1), opacity .3s';
const SCENE_JS = (dataUrl) => {
  const c = document.createElement('div');
  c.id = '__cur';
  c.style.cssText = 'position:fixed;left:590px;top:350px;width:24px;height:24px;z-index:2147483647;pointer-events:none;opacity:0;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));transition:left .5s cubic-bezier(.4,0,.2,1), top .5s cubic-bezier(.4,0,.2,1), opacity .3s;will-change:left,top;';
  c.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.5 14.8 L11.4 21.3 L14.1 20.1 L11.2 13.7 L18 13.6 Z" fill="#fff" stroke="#111" stroke-width="1.1" stroke-linejoin="round"/></svg>';
  document.body.appendChild(c);
  window.__moveCur = (x, y) => { c.style.left = x + 'px'; c.style.top = y + 'px'; };
  window.__showCur = (on) => { c.style.opacity = on ? '1' : '0'; };
  // 1:1 tracking during drags (no easing lag), smooth for point-to-point hops.
  window.__curInstant = (on) => { c.style.transition = on ? 'opacity .2s' : 'left .5s cubic-bezier(.4,0,.2,1), top .5s cubic-bezier(.4,0,.2,1), opacity .3s'; };
  window.__clickFx = () => {
    const x = parseFloat(c.style.left), y = parseFloat(c.style.top);
    const r = document.createElement('div');
    r.style.cssText = 'position:fixed;left:' + x + 'px;top:' + y + 'px;width:10px;height:10px;border:2px solid rgba(255,255,255,.95);border-radius:50%;z-index:2147483646;pointer-events:none;transform:translate(-50%,-50%);transition:width .4s ease-out,height .4s ease-out,opacity .4s ease-out;';
    document.body.appendChild(r);
    requestAnimationFrame(() => { r.style.width = '40px'; r.style.height = '40px'; r.style.opacity = '0'; });
    setTimeout(() => r.remove(), 430);
  };
  // Establishing shot: the full DOpus window. Holds, then a simple crossfade
  // (opacity only, no zoom) to the live viewer underneath.
  const ov = document.createElement('div');
  ov.id = '__ov';
  ov.style.cssText = 'position:fixed;inset:0;z-index:2147483640;background:#1b1b1b center/cover no-repeat url(' + dataUrl + ');transition:opacity 0.9s ease;will-change:opacity;';
  document.body.appendChild(ov);
  window.__fadeIntro = () => { ov.style.opacity = '0'; };
  window.__killIntro = () => { ov.remove(); };
};

const wait = (p, ms) => p.waitForTimeout(ms);
async function box(page, sel) { return (await page.$(sel)).boundingBox(); }
async function center(page, sel) { const b = await box(page, sel); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
async function moveCur(page, x, y) { await page.evaluate(({ x, y }) => window.__moveCur(x, y), { x, y }); }
async function clickSel(page, sel) {
  const { x, y } = await center(page, sel);
  await moveCur(page, x, y); await wait(page, 460);
  await page.evaluate(() => window.__clickFx()); await wait(page, 120);
  await page.click(sel); await wait(page, 180);
}
// smooth, 1:1-tracked horizontal drag of an element from its current grab point
async function dragX(page, gx, gy, dx, steps = 26) {
  await moveCur(page, gx, gy); await wait(page, 450);
  await page.evaluate(() => window.__curInstant(true));
  await page.mouse.move(gx, gy); await page.mouse.down(); await wait(page, 120);
  for (let i = 1; i <= steps; i++) { const x = gx + (dx * i) / steps; await page.mouse.move(x, gy); await moveCur(page, x, gy); await wait(page, 18); }
  await page.mouse.up();
  await page.evaluate(() => window.__curInstant(false));
}

async function main() {
  if (!existsSync(DIST)) { console.error('web/dist not found - run: node web/build.mjs'); process.exit(1); }
  if (!existsSync(FIRST_FRAME)) { console.error('img/firstframe.png missing'); process.exit(1); }
  await mkdir(path.join(ROOT, 'img', 'regen'), { recursive: true });
  await rm(VID_DIR, { recursive: true, force: true });
  await mkdir(VID_DIR, { recursive: true });
  const demoMd = await readFile(DEMO_MD, 'utf8');
  const firstFrameUrl = 'data:image/png;base64,' + (await readFile(FIRST_FRAME)).toString('base64');

  const server = await startServer(DIST);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir: VID_DIR, size: { width: W, height: H } } });
  const page = await ctx.newPage();
  await page.addInitScript(BRIDGE_STUB);
  await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('!!window.__mdwxMsgCb', null, { timeout: 5000 });
  await page.evaluate((o) => window.__mdwxDispatch(o), { type: 'theme', mode: 'dark', paneBg: '#1e1e1e' });
  await page.evaluate((o) => window.__mdwxDispatch(o), { type: 'userSettings', json: JSON.stringify({ activePalette: 'Default Dark' }) });
  await page.evaluate((o) => window.__mdwxDispatch(o), { type: 'load', path: 'demo.md', content: demoMd, encoding: 'utf-8' });
  await wait(page, 500);
  await page.evaluate(SCENE_JS, firstFrameUrl);

  // 1) hold the full DOpus window for 2s, then a simple crossfade to the viewer
  await wait(page, 2000);
  await page.evaluate(() => window.__fadeIntro());
  await wait(page, 950);                           // crossfade
  await page.evaluate(() => window.__killIntro());
  await page.evaluate(() => window.__showCur(true));
  await wait(page, 800);                           // hold on Reading

  // 2) Live: edit the TITLE to "mdWorX by HyperWorX", then select the new text
  //    and highlight it with the toolbar button (large, very visible)
  await clickSel(page, 'button[data-mode="live"]'); await wait(page, 500);
  await page.mouse.click(W * 0.32, H * 0.34); await wait(page, 160);            // focus the editor body
  await page.keyboard.press('Control+Home');                                    // -> start of line 1 ("# mdWorX")
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');          // "# mdWorX" is 8 chars -> caret after "mdWorX"
  await wait(page, 220);
  await page.keyboard.type(' by HyperWorX', { delay: 78 });                     // "mdWorX by HyperWorX"
  await wait(page, 450);
  for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowLeft');    // select "by HyperWorX"
  await wait(page, 400);
  await clickSel(page, '[data-cmd="highlight"]');                               // toolbar Highlight -> ==by HyperWorX==
  await wait(page, 450);
  await page.mouse.click(W * 0.34, H * 0.46); await wait(page, 1050);           // click away -> title renders highlighted

  // 3) move to Source mode (raw markdown, with the highlighted title)
  await clickSel(page, 'button[data-mode="source"]'); await wait(page, 900);

  // 4) click Source again -> split, then do DIFFERENT, prominent writing on the
  //    source side; the right-hand preview updates live
  await clickSel(page, 'button[data-mode="source"]'); await wait(page, 950);   // -> split
  await page.mouse.click(W * 0.20, H * 0.30); await wait(page, 160);           // focus source side
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');  // -> intro line (line 3)
  await page.keyboard.press('Home');                                           // logical line start (avoids wrap-end issue)
  await wait(page, 200);
  await page.keyboard.type('Edit anything live. ', { delay: 44 });             // prepended; preview updates at the top
  await wait(page, 1000);

  // 5) move and resize the panes (smooth, both directions)
  const hb = await box(page, '#split-handle');
  const gx = hb.x + hb.width / 2, gy = hb.y + hb.height * 0.24;
  await dragX(page, gx, gy, -170); await wait(page, 500);
  await dragX(page, gx - 170, gy, 170); await wait(page, 500);

  // 6) scroll down through the whole document, then back up
  const sx = W * 0.80, sy = H * 0.52;
  await moveCur(page, sx, sy); await wait(page, 300);
  await page.mouse.move(sx, sy);
  for (let i = 0; i < 26; i++) { await page.mouse.wheel(0, 74); await wait(page, 40); }
  await wait(page, 800);
  for (let i = 0; i < 26; i++) { await page.mouse.wheel(0, -74); await wait(page, 40); }
  await wait(page, 800);

  const videoPath = await page.video().path();
  await ctx.close();
  await browser.close();
  server.close();

  const gif = path.join(ROOT, 'img', 'regen', 'hero.gif');
  console.log('encoding gif from', videoPath);
  execFileSync('ffmpeg', ['-y', '-i', videoPath,
    '-vf', 'fps=11,scale=820:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3',
    '-loop', '0', gif], { stdio: 'inherit' });
  console.log('done -> img/regen/hero.gif');
}

main().catch((e) => { console.error(e); process.exit(1); });
