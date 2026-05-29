// Web-layer build script for the mdWorX plugin.
//
// Bundles the markdown renderer + bridge into a single JS file and copies
// the static index.html + viewer.css into web/dist/. The native side serves
// this folder via SetVirtualHostNameToFolderMapping.
//
// Usage:
//   node build.mjs           one-shot build
//   node build.mjs --watch   rebuild on change

import { build, context } from 'esbuild';
import { mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root      = __dirname;
const srcDir    = path.join(root, 'src');
const distDir   = path.join(root, 'dist');

const isWatch = process.argv.includes('--watch');

// Per-build cache-bust token appended to local css/js refs in the HTML.
// WebView2 applies Chromium HTTP caching to virtual-host-mapped files, so
// without a changing URL it serves a stale viewer.js / settings.js even
// after the file is replaced on disk and DOpus is restarted. A fresh token
// each build forces WebView2 to re-fetch.
const BUILD_TOKEN = Date.now().toString(36);

const commonOptions = {
    entryPoints: {
        viewer:   path.join(srcDir, 'viewer.js'),
        settings: path.join(srcDir, 'settings.js'),
    },
    bundle: true,
    minify: !isWatch,
    sourcemap: isWatch ? 'inline' : false,
    target: ['es2022'],
    format: 'iife',
    outdir: distDir,
    legalComments: 'none',
    loader: { '.css': 'css', '.html': 'text', '.svg': 'dataurl' },
    logLevel: 'info',
};

async function ensureClean() {
    if (existsSync(distDir)) await rm(distDir, { recursive: true });
    await mkdir(distDir, { recursive: true });
}

async function copyHtmlCacheBusted(name) {
    let html = await readFile(path.join(srcDir, name), 'utf8');
    // Append ?v=<token> to local viewer/settings css+js refs so WebView2's
    // HTTP cache can't serve a stale asset after an in-place update.
    html = html.replace(/(href|src)="((?:viewer|settings)\.(?:css|js))"/g,
                        `$1="$2?v=${BUILD_TOKEN}"`);
    await writeFile(path.join(distDir, name), html);
}

async function copyStatic() {
    await copyHtmlCacheBusted('index.html');
    await copyFile(path.join(srcDir, 'viewer.css'),             path.join(distDir, 'viewer.css'));
    await copyFile(path.join(srcDir, 'settings-defaults.json'), path.join(distDir, 'settings-defaults.json'));
    await copyHtmlCacheBusted('settings.html');
    await copyFile(path.join(srcDir, 'settings.css'),           path.join(distDir, 'settings.css'));
    // settings.js is built by esbuild from settings.js entry point — no copy.
}

async function writeManifest() {
    await writeFile(
        path.join(distDir, 'manifest.json'),
        JSON.stringify({
            files: ['index.html', 'viewer.js', 'viewer.css',
                    'settings-defaults.json',
                    'settings.html', 'settings.css', 'settings.js'],
            builtAt: new Date().toISOString(),
        }, null, 2)
    );
}

async function run() {
    await ensureClean();

    if (isWatch) {
        const ctx = await context(commonOptions);
        await ctx.watch();
        await copyStatic();
        await writeManifest();
        console.log('[build] watching...');
    } else {
        await build(commonOptions);
        await copyStatic();
        await writeManifest();
        console.log('[build] done -> ' + distDir);
    }
}

run().catch(err => {
    console.error('[build] failed:', err);
    process.exit(1);
});
