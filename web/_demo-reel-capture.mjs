// One-off Playwright capture for ce-demo-reel.
// Drives the bundled mdWorX web layer in a stubbed WebView2 environment,
// then screenshots a runthrough of features.
//
// Usage:
//   node .demo-reel/capture.mjs <serverUrl> <outDir>

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const SERVER = process.argv[2];
const OUT    = process.argv[3];
if (!SERVER || !OUT) {
    console.error('usage: capture.mjs <serverUrl> <outDir>');
    process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

const DEMO_MD = `# mdWorX feature runthrough

A markdown viewer/editor that lives inside Directory Opus.
This file demonstrates the rendering pipeline, theme system,
and editor surfaces shipped on \`feature/toolbar-styling-polish\`.

## Inline formatting

Plain text, **bold**, *italic*, ~~strikethrough~~, \`inline code\`,
==highlighted== text, H~2~O and E=mc^2^, and a link to
[the GPSoftware site](https://www.gpsoft.com.au).

## Headings drive their own underline

Headings 1 and 2 get an underline whose **thickness** and **style** are
now both configurable — independent of the horizontal-rule thickness.

### Heading 3 — no underline, inherits accent

#### Heading 4

##### Heading 5

###### Heading 6

## Lists

Bulleted:

- one
- two
  - nested two-point-one with enough text to wrap onto a second line and prove the hanging indent matches Reading mode width-for-width
  - nested two-point-two
- three

Numbered:

1. first
2. second with a longer paragraph to make sure ordered-list numbers stay tied to the accent colour and the wrap width is identical between Live and Reading modes
3. third

Task:

- [x] WebView2 hosting
- [x] Theme detection
- [ ] Editor mode

## Code

Inline \`printf("hello\\n")\` and a fenced block:

\`\`\`cpp
extern "C" __declspec(dllexport)
HWND DVP_CreateViewer(HWND hwndParent, LPRECT lpRc, DWORD dwFlags) {
    DpiScope dpi;  // PowerToys-style crash avoidance.
    return CreateWindowExW(/* ... */);
}
\`\`\`

## Table

| Stage | Component         | Status     |
|-------|-------------------|------------|
| 0     | Hello-world plugin| done       |
| 1     | WebView2 hosting  | done       |
| 2     | Markdown render   | done       |
| 3     | Live preview      | done       |
| 4     | Settings dialog   | done       |

## Blockquote

> "Most of the time a rewrite is better than trying to get different
> patched bits to work together."
> — DHH-ish summary of the rewrite bias.

## Definition list

DOpus
: Directory Opus, the file manager hosting this plugin.

WebView2
: Microsoft's Chromium-based embeddable browser control.

## Footnote

The plugin uses native COM hosting[^why] rather than the WinForms wrapper.

[^why]: WinForms 9's ScaleHelper.EnterDpiAwarenessScope throws on threads
    without a DPI awareness context. Native COM bypasses that path.

---

End of runthrough.
`;

// Stub installed BEFORE any page script runs.
// Captures the host-message handler; exposes a global to fire synthetic events.
function makeInitScript() {
    return `
        (function () {
            const handlers = [];
            window.chrome = {
                webview: {
                    postMessage(m) { /* swallow native-bound messages */ },
                    addEventListener(evt, h) {
                        if (evt === 'message') handlers.push(h);
                    },
                    removeEventListener() {}
                }
            };
            window.__mdwxFire = function (msg) {
                const ev = { data: typeof msg === 'string' ? msg : JSON.stringify(msg) };
                for (const h of handlers) h(ev);
            };
            window.__mdwxHandlerCount = () => handlers.length;
        })();
    `;
}

async function loadViewer(page, { theme = 'light', userSettings = {}, content = DEMO_MD, mode = 'reading' } = {}) {
    await page.addInitScript(makeInitScript());
    await page.goto(SERVER + '/index.html', { waitUntil: 'load' });
    // Wait for viewer.js to have registered its message handler.
    await page.waitForFunction(() => typeof window.__mdwxHandlerCount === 'function' && window.__mdwxHandlerCount() > 0, null, { timeout: 5000 });
    // Theme + userSettings first, so palette is applied before content renders.
    await page.evaluate((mode) => window.__mdwxFire({
        type: 'theme',
        mode,
        paneBg: mode === 'dark' ? '#1e1f29' : '#ffffff'
    }), theme);
    await page.evaluate((us) => window.__mdwxFire({ type: 'userSettings', json: JSON.stringify(us) }), userSettings);
    // Set mode by clicking the toolbar button before loading content so
    // the right editor surface is built.
    if (mode !== 'reading') {
        await page.click(`#toolbar button[data-mode="${mode}"]`);
    }
    await page.evaluate((c) => window.__mdwxFire({
        type: 'load',
        path: 'C:/Demos/runthrough.md',
        content: c,
        encoding: 'utf-8'
    }), content);
    // Give the editor / renderer a moment to settle.
    await page.waitForTimeout(450);
}

async function loadSettings(page, { theme = 'light', userSettings = {} } = {}) {
    await page.addInitScript(makeInitScript());
    await page.goto(SERVER + '/settings.html', { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.__mdwxHandlerCount === 'function' && window.__mdwxHandlerCount() > 0, null, { timeout: 5000 });
    await page.evaluate((mode) => window.__mdwxFire({
        type: 'paneTheme',
        mode,
        paneBg: mode === 'dark' ? '#1e1f29' : '#ffffff'
    }), theme);
    await page.evaluate((us) => window.__mdwxFire({ type: 'userSettings', json: JSON.stringify(us) }), userSettings);
    await page.evaluate(() => window.__mdwxFire({
        type: 'fonts',
        list: ['Inter', 'Segoe UI', 'Arial', 'Georgia', 'Cambria', 'Consolas', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Courier New']
    }));
    await page.evaluate(() => window.__mdwxFire({ type: 'customThemesList', names: [] }));
    await page.waitForTimeout(400);
}

async function shot(page, name) {
    const file = path.join(OUT, name + '.png');
    await page.screenshot({ path: file, fullPage: false });
    console.log('  -> ' + file);
    return file;
}

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
        viewport: { width: 1280, height: 820 },
        deviceScaleFactor: 1.5
    });

    // -------- 1. Reading mode, default light theme --------
    {
        const page = await ctx.newPage();
        await loadViewer(page, { theme: 'light' });
        await shot(page, '01-reading-light');
        await page.close();
    }

    // -------- 2. Reading mode, dark theme (Dracula-ish via Ayu Dark preset) --------
    {
        const page = await ctx.newPage();
        await loadViewer(page, {
            theme: 'dark',
            userSettings: { activePalette: 'Ayu Dark' }
        });
        await shot(page, '02-reading-dark');
        await page.close();
    }

    // -------- 3. Live preview mode --------
    {
        const page = await ctx.newPage();
        await loadViewer(page, { theme: 'light', mode: 'live' });
        // Park the cursor inside the body so editing toolbar shows naturally.
        await page.evaluate(() => {
            const cm = document.querySelector('.cm-content');
            if (cm) cm.scrollTop = 0;
        });
        await page.waitForTimeout(300);
        await shot(page, '03-live-preview');
        await page.close();
    }

    // -------- 4. Source mode + split preview --------
    {
        const page = await ctx.newPage();
        await loadViewer(page, { theme: 'light', mode: 'source' });
        // Clicking the Source button a second time toggles split preview.
        await page.click('#toolbar button[data-mode="source"]');
        await page.waitForTimeout(400);
        await shot(page, '04-source-split');
        await page.close();
    }

    // -------- 5. Image insert popup (live mode, popup open) --------
    {
        const page = await ctx.newPage();
        await loadViewer(page, { theme: 'light', mode: 'live' });
        await page.click('#etb-image-btn');
        await page.waitForTimeout(250);
        // Pre-fill some fields so the popup looks realistic in the shot.
        await page.fill('#img-pop-src', 'assets/diagram.png');
        await page.fill('#img-pop-alt', 'Architecture diagram');
        await page.fill('#img-pop-width', '480');
        await page.click('input[name="img-pop-align"][value="center"]');
        await page.waitForTimeout(150);
        await shot(page, '05-image-popup');
        await page.close();
    }

    // -------- 6. Settings dialog — top of form (light) --------
    {
        const page = await ctx.newPage();
        await loadSettings(page, { theme: 'light' });
        await shot(page, '06-settings-top');
        await page.close();
    }

    // -------- 7. Settings dialog — palette preset picker opened --------
    {
        const page = await ctx.newPage();
        await loadSettings(page, { theme: 'light' });
        // Open the palette preset <select> if present; otherwise focus the picker control.
        await page.evaluate(() => {
            // Scroll the form to the palette section if there's a section header for it.
            const headings = Array.from(document.querySelectorAll('h2, h3, .section-title, legend'));
            const pal = headings.find(h => /palette/i.test(h.textContent || ''));
            if (pal) pal.scrollIntoView({ block: 'start' });
        });
        await page.waitForTimeout(300);
        await shot(page, '07-settings-palette');
        await page.close();
    }

    // -------- 8. Settings dialog — typography / heading underline thickness --------
    {
        const page = await ctx.newPage();
        await loadSettings(page, { theme: 'light' });
        await page.evaluate(() => {
            const labels = Array.from(document.querySelectorAll('label, h2, h3, .section-title, legend'));
            const ht = labels.find(l => /heading underline thickness/i.test(l.textContent || ''))
                    || labels.find(l => /typograph/i.test(l.textContent || ''));
            if (ht) ht.scrollIntoView({ block: 'center' });
        });
        await page.waitForTimeout(300);
        await shot(page, '08-settings-headings');
        await page.close();
    }

    // -------- 9. Settings dialog — dark theme --------
    {
        const page = await ctx.newPage();
        await loadSettings(page, { theme: 'dark' });
        await shot(page, '09-settings-dark');
        await page.close();
    }

    await browser.close();
    console.log('done');
})().catch(err => { console.error(err); process.exit(1); });
