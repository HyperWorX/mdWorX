// mdWorX - web layer entry point.
//
// Hosted inside WebView2 by the native plugin. Communicates with the native
// host via window.chrome.webview.postMessage / .addEventListener('message').
// Renders markdown using markdown-it + DOMPurify. Images with relative paths
// are rewritten to the local.dopus-md.test virtual host the native side
// maps to the current file's parent directory.

import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import footnote from 'markdown-it-footnote';
import deflist from 'markdown-it-deflist';
import abbr from 'markdown-it-abbr';
import markIns from 'markdown-it-mark';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import DOMPurify from 'dompurify';
import { parseImageAlt } from './lib/image-alt.js';
import { createEditor } from './editor.js';
import { COMMANDS as EDITOR_COMMANDS, insertImage } from './editor-toolbar.js';
import { rewriteImageUrl } from './lib/local-url.js';
import { setBreaks as setSharedBreaks } from './lib/markdown-it-shared.js';
import { highlightToHtml } from './lib/code-highlight.js';
import { applyCodeTheme, applyPaletteCodeColors }  from './lib/code-themes.js';
import { applyToolbarLayout } from './lib/toolbar-layout.js';

// ---------------------------------------------------------------------------
// Markdown configuration

const md = new MarkdownIt({
    // Raw HTML is allowed because the Insert Image toolbar (and users
    // writing markdown by hand) need <img width=...> tags for sized and
    // aligned images. DOMPurify after render is the safety net: scripts,
    // iframes, on* handlers, and other dangerous constructs are stripped.
    html: true,
    linkify: true,
    typographer: true,
    breaks: false,
});

md.use(taskLists, { enabled: true, label: true, labelAfter: true });
md.use(footnote);
md.use(deflist);
md.use(abbr);
md.use(markIns);
md.use(sub);
md.use(sup);

// Image rewriting: relative paths -> virtual host the native side maps
// to the markdown file's parent directory. Absolute paths (file:// or
// C:\foo) need WebResourceRequested support; not yet implemented.
const defaultImageRender = md.renderer.rules.image ||
    ((tokens, idx, options, env, slf) => slf.renderToken(tokens, idx, options));

md.renderer.rules.image = (tokens, idx, options, env, slf) => {
    const token = tokens[idx];

    // Parse Obsidian-style alt-text tokens (`alt|400x300|center`) and
    // hoist dimensions/alignment to real img attributes. The token's
    // content (text inside `[...]`) is the alt; markdown-it stores it
    // in token.children before render.
    const rawAlt = token.attrGet('alt') || (token.content || '');
    const parsed = parseImageAlt(rawAlt);
    token.attrSet('alt', parsed.alt);
    if (parsed.width  != null) token.attrSet('width',  String(parsed.width));
    if (parsed.height != null) token.attrSet('height', String(parsed.height));
    if (parsed.alignment !== 'none') {
        const existing = token.attrGet('class') || '';
        const cls = (existing ? existing + ' ' : '') + 'md-img-' + parsed.alignment;
        token.attrSet('class', cls);
    }

    const raw = token.attrGet('src');
    if (raw) {
        const rewritten = rewriteImageUrl(raw);
        if (rewritten.unsupportedScheme) {
            token.attrSet('src', '');
            token.attrSet('alt',
                (token.attrGet('alt') || '') +
                ` (unsupported scheme: ${rewritten.unsupportedScheme})`);
        } else {
            token.attrSet('src', rewritten.src);
            token.attrSet('loading', 'lazy');
            token.attrSet('decoding', 'async');
        }
    }
    return defaultImageRender(tokens, idx, options, env, slf);
};

// Fenced code blocks: run the body through the shared code-highlight
// module so Reading mode emits the same `<span class="tok-...">` tokens
// Live mode renders. A single `.tok-*` stylesheet in viewer.css skins both.
md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const info  = (token.info || '').trim();
    const lang  = info.split(/\s+/)[0];
    const code  = token.content;
    const inner = highlightToHtml(code, lang);
    const cls   = lang ? ` class="language-${lang}"` : '';
    return `<pre><code${cls}>${inner}</code></pre>\n`;
};

// Links: open external (http/https) in the user's default browser via the
// native side. Internal links (#anchor) stay in-page.
md.renderer.rules.link_open = (tokens, idx, options, env, slf) => {
    const token = tokens[idx];
    const href = token.attrGet('href');
    if (href && /^https?:\/\//i.test(href)) {
        token.attrSet('target', '_blank');
        token.attrSet('rel', 'noopener noreferrer');
        token.attrSet('data-external', '1');
    }
    return slf.renderToken(tokens, idx, options);
};

// ---------------------------------------------------------------------------
// Render pipeline

const contentEl       = document.getElementById('content');
const initialEl       = document.getElementById('initial');
const editorWrapEl    = document.getElementById('editor');
const toolbarEl       = document.getElementById('toolbar');
const editingToolbarEl = document.getElementById('editing-toolbar');
const statusEl        = document.getElementById('status');
const conflictBannerEl = document.getElementById('conflict-banner');
const conflictKeepBtn  = document.getElementById('conflict-keep');
const conflictReloadBtn = document.getElementById('conflict-reload');

// Allow-list DOMPurify config (P0 audit #5).
//
// Previously this used FORBID_TAGS, which is fail-open: any new tag
// the markdown-it pipeline started emitting (or any DOMPurify default
// the upstream library tightened or loosened later) silently re-opened
// the sanitiser surface. Form/input/meta/base/link were all in
// DOMPurify's default allowlist, so authored markdown could include
// `<form action="https://attacker.tld">` and would render with the
// form intact; combined with the unrestricted updater pipeline it
// shipped the RCE chain documented in the audit.
//
// The allowlist below is the union of:
//   * structural elements markdown-it produces (block + inline + table)
//   * inline semantic tags users commonly rely on (kbd, mark, abbr, ...)
//   * the figure/figcaption pair we explicitly added for image captions
// It excludes everything that can drive navigation, post messages, or
// run script: form, input, button, meta, base, link, style, script,
// iframe, object, embed, audio, video, source, picture, template, slot.
const SANITIZER_CONFIG = {
    ALLOWED_TAGS: [
        // Block structural
        'p', 'div', 'span', 'br', 'hr',
        'pre', 'code', 'blockquote',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li', 'dl', 'dt', 'dd',
        'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
        'figure', 'figcaption',
        'details', 'summary',
        'section', 'article', 'header', 'footer', 'nav', 'aside', 'main',
        // Inline
        'a', 'strong', 'em', 's', 'del', 'ins', 'mark',
        'sub', 'sup', 'small', 'kbd', 'samp', 'var', 'abbr', 'dfn', 'cite', 'q',
        'time', 'data', 'bdi', 'bdo', 'ruby', 'rt', 'rp',
        'img',
        'input', // checkbox-only, gated by sanitiseListInputs() below
    ],
    ALLOWED_ATTR: [
        'id', 'class',
        'href', 'src', 'alt', 'title',
        'lang', 'dir',
        'colspan', 'rowspan', 'scope', 'headers', 'abbr',
        'start', 'reversed', 'value', 'type',
        'datetime',
        'open',
        'loading', 'decoding',
        'data-external', 'data-line-start', 'data-line-end',
        'checked', 'disabled',
        // target/rel only meaningful on <a>; DOMPurify will drop them
        // from other elements via the schema.
        'target', 'rel',
    ],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|app\.mdworx\.test\/|local\.mdworx\.test\/)/i,
    FORBID_TAGS: [
        // Defence-in-depth: explicitly deny these even though they're
        // already absent from ALLOWED_TAGS. Future allowlist additions
        // would have to consciously remove them from this list too.
        'style', 'script', 'iframe', 'object', 'embed',
        'form', 'button', 'select', 'option', 'textarea', 'fieldset', 'legend',
        'meta', 'base', 'link', 'audio', 'video', 'source', 'track', 'picture',
        'template', 'slot', 'svg', 'math',
    ],
    FORBID_ATTR: [
        'style',
        'onerror', 'onload', 'onclick', 'onmouseover', 'onmouseout',
        'onfocus', 'onblur', 'onchange', 'onsubmit',
        'formaction', 'srcdoc', 'srcset',
    ],
    USE_PROFILES: { html: true },
};

function sanitiseListInputs(root) {
    // markdown-it-task-lists renders task items as <input type="checkbox" disabled>.
    // After sanitisation, strip any <input> that is not exactly that
    // shape — this is the only <input> we intentionally allow.
    root.querySelectorAll('input').forEach((el) => {
        const t = (el.getAttribute('type') || '').toLowerCase();
        if (t !== 'checkbox' || !el.hasAttribute('disabled')) {
            el.remove();
            return;
        }
        // Drop any attribute that is not part of the checkbox shape.
        for (const attr of Array.from(el.attributes)) {
            if (attr.name === 'type' || attr.name === 'disabled' ||
                attr.name === 'checked' || attr.name === 'class' ||
                attr.name === 'id') continue;
            el.removeAttribute(attr.name);
        }
    });
}

function render(markdownText) {
    if (initialEl) initialEl.style.display = 'none';
    const html = md.render(markdownText || '');
    const clean = DOMPurify.sanitize(html, SANITIZER_CONFIG);
    contentEl.innerHTML = clean;
    sanitiseListInputs(contentEl);

    // Rewrite <img src> for any raw HTML <img> tags the user authored or
    // the Insert Image toolbar produced. Markdown image syntax already
    // routes through md.renderer.rules.image; this catches the HTML path
    // so both produce the same final URL (relative -> local virtual host;
    // http/https stays as-is; unsupported schemes get blanked with an
    // alt-text note).
    contentEl.querySelectorAll('img').forEach(img => {
        const raw = img.getAttribute('src');
        if (!raw) return;
        if (raw.startsWith('https://local.mdworx.test/') ||
            raw.startsWith('https://app.mdworx.test/')) return;
        const rewritten = rewriteImageUrl(raw);
        if (rewritten.unsupportedScheme) {
            img.removeAttribute('src');
            const prevAlt = img.getAttribute('alt') || '';
            img.setAttribute('alt',
                prevAlt + ` (unsupported scheme: ${rewritten.unsupportedScheme})`);
        } else if (rewritten.src && rewritten.src !== raw) {
            img.setAttribute('src', rewritten.src);
        }
    });

    // Intercept external link clicks: hand to native to open in default browser.
    contentEl.querySelectorAll('a[data-external="1"]').forEach(a => {
        a.addEventListener('click', e => {
            e.preventDefault();
            send({ type: 'openExternal', url: a.getAttribute('href') });
        });
    });

    attachCodeCopyButtons(contentEl);
}

// Wrap every <pre> block under `root` in a relative-positioned container and
// hang a circular copy button off the wrapper's top-right corner. The wrapper
// is needed because <pre> has overflow-x:auto for long lines, which clips any
// absolutely-positioned child including the button.
function attachCodeCopyButtons(root) {
    if (!root) return;
    root.querySelectorAll('pre').forEach(pre => {
        if (pre.parentElement && pre.parentElement.classList.contains('code-block-wrap')) return;

        const wrap = document.createElement('div');
        wrap.className = 'code-block-wrap';
        pre.parentNode.insertBefore(wrap, pre);
        wrap.appendChild(pre);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'code-copy-btn';
        btn.title = 'Copy code';
        btn.setAttribute('aria-label', 'Copy code to clipboard');
        btn.innerHTML =
            '<svg class="code-copy-icon code-copy-icon-default" viewBox="0 0 24 24" aria-hidden="true">' +
                '<rect x="9" y="9" width="11" height="11" rx="2" ry="2"/>' +
                '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
            '</svg>' +
            '<svg class="code-copy-icon code-copy-icon-ok" viewBox="0 0 24 24" aria-hidden="true">' +
                '<polyline points="20 6 9 17 4 12"/>' +
            '</svg>';
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const code = pre.querySelector('code')?.textContent ?? pre.textContent ?? '';
            try {
                await navigator.clipboard.writeText(code);
                btn.classList.add('copied');
                btn.title = 'Copied';
                clearTimeout(btn._t);
                btn._t = setTimeout(() => {
                    btn.classList.remove('copied');
                    btn.title = 'Copy code';
                }, 1500);
            } catch { /* clipboard unavailable; silently ignore */ }
        });
        wrap.appendChild(btn);
    });
}

function clearContent() {
    contentEl.innerHTML = '';
    if (initialEl) initialEl.style.display = '';
}

// ---------------------------------------------------------------------------
// Editor / mode state
//
// Three modes:
//   live    — CodeMirror with live-preview decorations (default; what
//             Obsidian calls "Live Preview"). The pane looks like the
//             rendered output; clicking text reveals raw markdown markers
//             for the node under the caret.
//   source  — CodeMirror without live-preview decorations. Power-user
//             plain text editing.
//   reading — Pure rendered HTML (no editor). Read-only.
//
// Switching between live and source recreates the CodeMirror instance
// because the extension array is built at construction time. Switching
// into reading destroys the editor (it'll be recreated lazily next time
// the user enters live/source).

const MODES = ['reading', 'live', 'source'];
const DEFAULT_MODE = 'reading';

let mode = DEFAULT_MODE;
let editor = null;
let editorMode = null;          // which mode the current editor was built for
let loadedPath = null;
let loadedBuffer = '';          // canonical text after last load OR last save
let editorBuffer = '';          // current editor text (== loadedBuffer when clean)
let loadedEncoding = 'utf-8';   // populated by 'load' messages; informs save
let dirty = false;
let splitMode = false;          // source-mode side-by-side reading preview
let splitRenderTimer = null;
let linkedScroll = true;        // sync split-view scrolling between panes
let wordWrap    = true;         // wrap long lines in rendered <pre>/<code> by default

function renderSplitPreview() {
    render(dirty ? editorBuffer : loadedBuffer);
}
function scheduleSplitRender() {
    clearTimeout(splitRenderTimer);
    splitRenderTimer = setTimeout(renderSplitPreview, 80);
}
function setSplit(on) {
    splitMode = !!on;
    document.body.classList.toggle('split', splitMode);
    syncToolbar();
    if (splitMode && mode === 'source') renderSplitPreview();
}

function setWordWrap(on) {
    wordWrap = !!on;
    document.body.classList.toggle('wrap-on', wordWrap);
    syncToolbar();
}

// Apply the initial wrap state on first script load so default-on actually
// shows wrapped content (without this the body lacks the class until the
// user clicks the toggle once).
document.body.classList.toggle('wrap-on', wordWrap);

function fileBaseName() {
    return loadedPath ? loadedPath.split(/[\\/]/).pop() : 'mdWorX';
}

function setTitle() {
    document.title = (dirty ? '● ' : '') + fileBaseName();
}

function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.className = 'status' + (kind ? ' status-' + kind : '');
    clearTimeout(setStatus._t);
    if (text && (kind === 'error' || kind === 'ok')) {
        setStatus._t = setTimeout(() => setStatus(''), kind === 'error' ? 6000 : 2000);
    }
}

function setDirty(d) {
    dirty = d;
    setTitle();
    syncToolbar();
}

// Cheap content normalisation used when comparing two strings for
// semantic equality on the conflict-banner path. Strips the UTF-8 BOM
// if present and folds CRLF / CR line endings down to LF so a stash
// that round-tripped through CodeMirror (which normalises everything
// to LF internally) doesn't read as "different" from a fresh disk
// read of the same file on a Windows machine writing CRLF.
function normaliseForCompare(s) {
    if (typeof s !== 'string' || s.length === 0) return '';
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// Process-scoped unsaved-edits stash.
//
// While the buffer is dirty, post the current contents to native on a
// debounce so a viewer pane switch + return restores in-progress edits.
// Native side keys the stash by canonicalised file path and holds it in
// process memory; it does not touch disk and dies when DOpus exits.
//
// flushStashNow() is for save / mode-switch points where we want the
// latest content captured immediately.
let stashTimer = null;
const STASH_DEBOUNCE_MS = 750;
// Each message carries the file path it applies to. The native side keys
// the stash by message path rather than its own current state, because
// a pane switch can change native state->currentFilePath before a
// debounced stash arrives.
function scheduleStash() {
    if (!dirty || !loadedPath) return;
    if (stashTimer) clearTimeout(stashTimer);
    const pathAtSchedule = loadedPath;
    stashTimer = setTimeout(() => {
        stashTimer = null;
        if (!dirty) return;
        send({ type: 'stashBuffer', path: pathAtSchedule, content: editorBuffer });
    }, STASH_DEBOUNCE_MS);
}
function flushStashNow() {
    if (stashTimer) { clearTimeout(stashTimer); stashTimer = null; }
    if (!dirty || !loadedPath) return;
    send({ type: 'stashBuffer', path: loadedPath, content: editorBuffer });
}
function clearStash() {
    if (stashTimer) { clearTimeout(stashTimer); stashTimer = null; }
    if (!loadedPath) return;
    send({ type: 'clearStash', path: loadedPath });
}

// Auto-save: when the setting is > 0, fire triggerSave() every N minutes
// while the buffer is dirty AND there's a loaded path. triggerSave already
// short-circuits when !dirty, so this is a no-op the moment the buffer
// matches disk again. Re-called from applySettings on every settings
// change so flipping the value takes effect immediately without reload.
let autoSaveTimer = null;
function applyAutoSave(minutesRaw) {
    if (autoSaveTimer) { clearInterval(autoSaveTimer); autoSaveTimer = null; }
    const minutes = Number(minutesRaw);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    const intervalMs = minutes * 60 * 1000;
    autoSaveTimer = setInterval(() => {
        if (dirty && loadedPath) triggerSave();
    }, intervalMs);
}

// Conflict-banner state and wiring.
//
// pendingConflictStash holds the user's stashed buffer while the banner is
// visible; it's the source for the "Keep my edits" action. The banner is
// non-dismissable except via the two buttons — we want the user to
// explicitly choose one path or the other so unsaved work is never
// silently lost.
let pendingConflictStash = null;
function showConflictBanner() {
    if (conflictBannerEl) conflictBannerEl.hidden = false;
}
function hideConflictBanner() {
    if (conflictBannerEl) conflictBannerEl.hidden = true;
    pendingConflictStash = null;
}
if (conflictKeepBtn) {
    conflictKeepBtn.addEventListener('click', () => {
        if (pendingConflictStash === null) { hideConflictBanner(); return; }
        editorBuffer = pendingConflictStash;
        if (mode === 'reading') {
            render(editorBuffer);
        } else if (editor) {
            editor.setDoc(editorBuffer);
        }
        setDirty(editorBuffer !== loadedBuffer);
        setStatus('using your unsaved edits', 'ok');
        hideConflictBanner();
    });
}
if (conflictReloadBtn) {
    conflictReloadBtn.addEventListener('click', () => {
        editorBuffer = loadedBuffer;
        if (mode === 'reading') {
            render(loadedBuffer);
        } else if (editor) {
            editor.setDoc(loadedBuffer);
        }
        setDirty(false);
        clearStash();
        setStatus('reloaded from disk', 'ok');
        hideConflictBanner();
    });
}


function syncToolbar() {
    if (toolbarEl) {
        toolbarEl.querySelectorAll('[data-mode]').forEach(b => {
            const isCurrent = b.dataset.mode === mode;
            b.classList.toggle('active', isCurrent);
            // Source button shows an additional split-on visual when split is
            // active (a CSS pseudo-element renders the indicator).
            if (b.dataset.mode === 'source') {
                b.classList.toggle('split-on', splitMode && isCurrent);
            }
        });
        const saveBtn   = toolbarEl.querySelector('[data-action="save"]');
        const saveAsBtn = toolbarEl.querySelector('[data-action="saveAs"]');
        const wrapBtn   = toolbarEl.querySelector('[data-action="wrap"]');
        if (saveBtn)   saveBtn.disabled   = !dirty || !loadedPath;
        if (saveAsBtn) saveAsBtn.disabled = !loadedBuffer && !editorBuffer;
        if (wrapBtn)   wrapBtn.classList.toggle('active', wordWrap);
    }
    if (editingToolbarEl) {
        editingToolbarEl.hidden = (mode === 'reading');
    }
}

function destroyEditor() {
    if (editor) {
        try { editor.destroy(); } catch {}
        editor = null;
        editorMode = null;
    }
    if (editorWrapEl) editorWrapEl.innerHTML = '';
    // P2 audit #22: an in-flight image insert (user clicked the popup
    // Insert button, native is copying / downloading) would otherwise
    // resolve its eventual imageCopied reply against the new editor
    // built on the next buildEditorFor — which inserts the image into
    // the wrong document mode and leaves the popup orphaned. Drop
    // the pending state along with the editor it referred to. The
    // imageCopied handler's no-editor branch then surfaces the cancel
    // cleanly. Also re-enable the Insert button in case mode-switch
    // happened while it was disabled.
    pendingImageInsert = null;
    if (imgInsertBtn) updateImageInsertEnabled();
}

function buildEditorFor(targetMode) {
    if (!editorWrapEl) return;
    if (editor && editorMode === targetMode) return;   // already correct shape
    destroyEditor();
    editor = createEditor({
        parent: editorWrapEl,
        doc: editorBuffer || loadedBuffer,
        livePreview: targetMode === 'live',
        onChange: (text) => {
            editorBuffer = text;
            if (!dirty && text !== loadedBuffer) setDirty(true);
            else if (dirty && text === loadedBuffer) setDirty(false);
            if (mode === 'source' && splitMode) scheduleSplitRender();
            scheduleStash();
        },
        onSave:   () => triggerSave(),
        onSaveAs: () => triggerSaveAs(),
    });
    editorMode = targetMode;
    attachEditorScrollSync();
}

function setMode(next) {
    if (!MODES.includes(next)) return;
    // Capture any pending dirty buffer before tearing down the editor; if
    // the pane is then swapped to a different file, the stash for THIS
    // file is already up to date.
    flushStashNow();
    mode = next;
    document.body.classList.remove('mode-live', 'mode-source', 'mode-reading');
    document.body.classList.add('mode-' + mode);
    if (mode === 'reading') {
        // Reading: render current buffer as HTML; tear down the editor.
        render(dirty ? editorBuffer : loadedBuffer);
        destroyEditor();
    } else {
        buildEditorFor(mode);
        if (editor) editor.focus();
        if (mode === 'source' && splitMode) renderSplitPreview();
    }
    syncToolbar();
}

function cycleMode() {
    setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
}

function triggerSave() {
    if (!loadedPath) { setStatus('use Save As — no path yet', 'error'); return; }
    if (!dirty)      { setStatus('nothing to save'); return; }
    const enc = (loadedEncoding || '').toLowerCase();
    if (enc !== 'utf-8' && enc !== 'utf-8-bom') {
        setStatus(`save not yet supported for encoding "${loadedEncoding}"`, 'error');
        return;
    }
    setStatus('saving...');
    send({
        type:     'saveFile',
        path:     loadedPath,
        content:  editorBuffer,
        encoding: enc,
    });
}

function triggerSaveAs() {
    // Save As works regardless of dirty state — the user may want to
    // duplicate the file under a different name without changing anything.
    const enc = (loadedEncoding || 'utf-8').toLowerCase();
    const useEnc = (enc === 'utf-8' || enc === 'utf-8-bom') ? enc : 'utf-8';
    setStatus('save as...');
    send({
        type:          'saveAs',
        suggestedPath: loadedPath || '',
        content:       editorBuffer || loadedBuffer,
        encoding:      useEnc,
    });
}

if (toolbarEl) {
    toolbarEl.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.dataset.mode) {
            // Clicking Source while already in source mode toggles split.
            // This replaces a separate split button.
            if (btn.dataset.mode === 'source' && mode === 'source') setSplit(!splitMode);
            else setMode(btn.dataset.mode);
        }
        else if (btn.dataset.action === 'save')   triggerSave();
        else if (btn.dataset.action === 'saveAs') triggerSaveAs();
        else if (btn.dataset.action === 'wrap')   setWordWrap(!wordWrap);
        else if (btn.dataset.action === 'settings') send({ type: 'openSettings' });
    });
}

if (editingToolbarEl) {
    editingToolbarEl.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn || !btn.dataset.cmd) return;
        if (!editor) return;
        // Image button: open the image insert popup (which collects path
        // via native file picker, plus optional dimensions + alignment).
        if (btn.dataset.cmd === 'image') {
            toggleImagePopup();
            return;
        }
        const cmd = EDITOR_COMMANDS[btn.dataset.cmd];
        if (cmd) cmd(editor.view);
    });
}

// Translate vertical mouse-wheel input into horizontal scroll on toolbars
// that overflow horizontally. The toolbars use overflow-x: auto + overflow-y:
// hidden, so a normal scroll wheel's deltaY otherwise produces no toolbar
// scroll and bubbles to the page. preventDefault unconditionally when the
// toolbar has overflow so the page never also scrolls; passive: false is
// required for preventDefault on wheel.
function wireHorizontalWheelScroll(el) {
    if (!el) return;
    el.addEventListener('wheel', (e) => {
        // Trackpad horizontal swipes set deltaX; let the browser handle those.
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        if (el.scrollWidth <= el.clientWidth) return;
        e.preventDefault();
        el.scrollLeft += e.deltaY;
    }, { passive: false });
}
wireHorizontalWheelScroll(editingToolbarEl);
// Top toolbar's actual scroll container is each .toolbar-group child; the
// outer #toolbar is just a centred positioning shell with pointer-events: none.
if (toolbarEl) {
    toolbarEl.querySelectorAll('.toolbar-group').forEach(wireHorizontalWheelScroll);
}

// --- Image insert popup ----------------------------------------------------
//
// User clicks the image button -> popup opens. Browse... posts pickImage
// to native, which opens GetOpenFileNameW and replies with an absolute
// path plus (when the current file's parent dir is known) a relative
// path. We prefer the relative one for the inserted markdown since it
// keeps the .md file portable across machines.
//
// The Insert button is disabled until a path is chosen; the path label
// shows whichever path will actually be inserted.

const imagePopupEl   = document.getElementById('image-popup');
const imgSrcInput    = document.getElementById('img-pop-src');
const imgBrowseBtn   = document.getElementById('img-pop-browse');
const imgAltInput    = document.getElementById('img-pop-alt');
const imgWidthInput  = document.getElementById('img-pop-width');
const imgHeightInput = document.getElementById('img-pop-height');
const imgCopyChk     = document.getElementById('img-pop-copy');
const imgInsertBtn   = document.getElementById('img-pop-insert');
const imgCancelBtn   = document.getElementById('img-pop-cancel');

// When the copy checkbox is ticked and the source is a local file path,
// Insert sends a copyImage message to native and waits for the reply
// before calling insertImage. pendingImageInsert stashes the other form
// fields so the reply handler can call insertImage with everything.
let pendingImageInsert = null;

// Insert is enabled whenever the source input has any non-whitespace text,
// so a typed URL counts the same as a path returned by the native Browse
// dialog.
function updateImageInsertEnabled() {
    if (!imgInsertBtn || !imgSrcInput) return;
    imgInsertBtn.disabled = imgSrcInput.value.trim() === '';
}

// Copy-to-folder behaviour for URLs, conditional on the "Allow remote
// images" setting:
//
//   Allow remote images OFF (default):
//     The saved markdown MUST reference a local file, because an external
//     URL reference would be blocked by the remote-image gate and render
//     as a placeholder. Force-tick and lock the checkbox — no choice.
//
//   Allow remote images ON:
//     The user has opted into remote loading, so either path is valid.
//     Auto-tick on the first URL transition (private default) but leave
//     the box interactive so it can be unticked to keep the URL.
let copyAutoTickedForUrl = false;
function syncCopyForUrl() {
    if (!imgCopyChk || !imgSrcInput) return;
    const isUrl = /^https?:\/\//i.test(imgSrcInput.value.trim());
    const allowRemote = !!window.mdwxAllowRemoteImages;
    if (isUrl) {
        if (!allowRemote) {
            imgCopyChk.checked  = true;
            imgCopyChk.disabled = true;
            imgCopyChk.title    = 'Remote images are disabled in settings, so URLs must be downloaded into the document folder. Enable "Allow remote images" in settings to unlock this.';
        } else {
            imgCopyChk.disabled = false;
            if (!copyAutoTickedForUrl) {
                imgCopyChk.checked   = true;
                copyAutoTickedForUrl = true;
            }
            imgCopyChk.title = 'Recommended for URLs: downloads the image into the document folder so the markdown stays self-contained and no third-party host is hit when the document is opened later.';
        }
    } else {
        imgCopyChk.disabled  = false;
        copyAutoTickedForUrl = false;
        imgCopyChk.title     = '';
    }
}

function resetImagePopupState() {
    if (imgSrcInput)    imgSrcInput.value    = '';
    if (imgAltInput)    imgAltInput.value    = '';
    if (imgWidthInput)  imgWidthInput.value  = '';
    if (imgHeightInput) imgHeightInput.value = '';
    if (imgCopyChk)     imgCopyChk.checked   = false;
    const noneRadio = document.querySelector('input[name="img-pop-align"][value="none"]');
    if (noneRadio) noneRadio.checked = true;
    pendingImageInsert    = null;
    copyAutoTickedForUrl  = false;
    updateImageInsertEnabled();
}

function toggleImagePopup(force) {
    if (!imagePopupEl) return;
    const willOpen = (typeof force === 'boolean') ? force : imagePopupEl.hidden;
    if (willOpen) resetImagePopupState();
    imagePopupEl.hidden = !willOpen;
    if (willOpen && imgSrcInput) imgSrcInput.focus();
}

if (imgSrcInput) {
    imgSrcInput.addEventListener('input', () => {
        updateImageInsertEnabled();
        syncCopyForUrl();
    });
    imgSrcInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && imgInsertBtn && !imgInsertBtn.disabled) {
            e.preventDefault();
            imgInsertBtn.click();
        }
    });
}
if (imgBrowseBtn) {
    imgBrowseBtn.addEventListener('click', () => {
        send({ type: 'pickImage' });
    });
}
if (imgCancelBtn) {
    imgCancelBtn.addEventListener('click', () => toggleImagePopup(false));
}
if (imgInsertBtn) {
    imgInsertBtn.addEventListener('click', () => {
        if (!editor || !imgSrcInput) return;
        const src = imgSrcInput.value.trim();
        if (!src) return;
        const alignChosen = document.querySelector('input[name="img-pop-align"]:checked');
        const alignment = alignChosen ? alignChosen.value : 'none';
        const widthVal  = imgWidthInput  ? imgWidthInput.value.trim()  : '';
        const heightVal = imgHeightInput ? imgHeightInput.value.trim() : '';
        const opts = {
            alt:       imgAltInput ? imgAltInput.value : '',
            width:     widthVal  || null,
            height:    heightVal || null,
            alignment: alignment,
        };

        // Copy mode routes:
        //   - Local absolute path  -> copyImage   (file copy)
        //   - http(s) URL          -> downloadImage (URL fetch to disk)
        //   - anything else        -> insert as-is (relative path, data: URI, etc.)
        // Both copy paths reply with the same imageCopied message shape,
        // so the reply handler routes both through one branch.
        const wantsCopy   = imgCopyChk && imgCopyChk.checked;
        const isAbsLocal  = /^[A-Za-z]:[\\/]/.test(src);
        const isHttpUrl   = /^https?:\/\//i.test(src);
        if (wantsCopy && isAbsLocal) {
            pendingImageInsert = opts;
            send({ type: 'copyImage', path: src });
            imgInsertBtn.disabled = true;  // re-enabled by reply or error
            return;
        }
        if (wantsCopy && isHttpUrl) {
            pendingImageInsert = opts;
            send({ type: 'downloadImage', path: src });
            imgInsertBtn.disabled = true;  // re-enabled by reply or error
            return;
        }

        insertImage(editor.view, { ...opts, path: src });
        toggleImagePopup(false);
    });
}
if (imagePopupEl) {
    // Close on outside click.
    document.addEventListener('mousedown', (e) => {
        if (imagePopupEl.hidden) return;
        if (imagePopupEl.contains(e.target)) return;
        const btn = e.target.closest('[data-cmd="image"]');
        if (btn) return;
        toggleImagePopup(false);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !imagePopupEl.hidden) toggleImagePopup(false);
    });
}

// --- Split-view scroll sync and resize handle ------------------------------
// Ratio-based scroll sync. Source pane is monospace, preview is variable-
// height prose; perfect line-to-line alignment requires source-mapped offsets
// the renderer doesn't expose. Ratio sync keeps the two panes roughly in step
// for typical documents and adds no per-render cost.
let _syncingScroll = false;
function syncScrollFrom(source, target) {
    if (_syncingScroll) return;
    const sMax = source.scrollHeight - source.clientHeight;
    const tMax = target.scrollHeight - target.clientHeight;
    if (sMax <= 0 || tMax <= 0) return;
    _syncingScroll = true;
    target.scrollTop = (source.scrollTop / sMax) * tMax;
    requestAnimationFrame(() => { _syncingScroll = false; });
}
function attachEditorScrollSync() {
    if (!editor) return;
    const sd = editor.view.scrollDOM;
    if (sd._splitListenerAttached) return;
    sd._splitListenerAttached = true;
    sd.addEventListener('scroll', () => {
        if (mode === 'source' && splitMode && linkedScroll) syncScrollFrom(sd, contentEl);
    });
}
if (contentEl) {
    contentEl.addEventListener('scroll', () => {
        if (mode === 'source' && splitMode && linkedScroll && editor)
            syncScrollFrom(contentEl, editor.view.scrollDOM);
    });
}

// Link/unlink toggle on the split handle. Mousedown stops propagation so
// the click doesn't start a drag-resize on the surrounding handle.
const linkToggleEl = document.getElementById('split-link-toggle');
if (linkToggleEl) {
    linkToggleEl.addEventListener('mousedown', (e) => { e.stopPropagation(); });
    linkToggleEl.addEventListener('click', (e) => {
        e.stopPropagation();
        linkedScroll = !linkedScroll;
        linkToggleEl.classList.toggle('off', !linkedScroll);
        linkToggleEl.title = linkedScroll
            ? 'Linked scrolling (click to unlink)'
            : 'Unlinked scrolling (click to link)';
    });
}

// Drag handle: editor flex-basis follows the mouse; content takes the rest.
const splitHandleEl = document.getElementById('split-handle');
let _dragging = false;
if (splitHandleEl) {
    splitHandleEl.addEventListener('mousedown', (e) => {
        if (!(mode === 'source' && splitMode)) return;
        _dragging = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
        if (!_dragging) return;
        const pageEl = document.querySelector('.page');
        if (!pageEl) return;
        const rect = pageEl.getBoundingClientRect();
        const leftPx = e.clientX - rect.left;
        const pct = Math.min(85, Math.max(15, (leftPx / rect.width) * 100));
        if (editorWrapEl) editorWrapEl.style.flexBasis = pct + '%';
        if (contentEl)    contentEl.style.flexBasis    = (100 - pct) + '%';
    });
    document.addEventListener('mouseup', () => {
        if (!_dragging) return;
        _dragging = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });
}

// Ctrl+E cycles modes (live -> source -> reading -> live).
// Ctrl+S triggers save. Ctrl+Shift+S triggers Save As. Editor swallows
// these when focused; this handler catches them when reading-mode preview
// has the focus instead.
document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (e.shiftKey && k === 's') { e.preventDefault(); triggerSaveAs(); return; }
    if (e.shiftKey) return;
    if (k === 'e') { e.preventDefault(); cycleMode();   return; }
    if (k === 's') { e.preventDefault(); triggerSave(); return; }
});

// ---------------------------------------------------------------------------
// Settings application
//
// Two-source resolution:
//   1. settings-defaults.json   — shipped in the bundle, fetched at startup.
//      All keys present, mostly null. Defines the schema.
//   2. user settings file       — %APPDATA%\Mogwai\DOpusMarkdownViewer\settings.json,
//      passed in by native as {type:'userSettings', json:'<rawtext>'}.
//
// User keys win over defaults via shallow merge. Each resolved setting
// becomes a CSS variable override on :root (cleared when null/empty).
// Theme key is handled separately: 'auto' follows native theme push,
// 'light'/'dark' pins to that palette regardless of the pane background.

const settingsCssMap = {
    textColor:             '--ink-override',
    pageColor:             '--page-override',
    accentColor:           '--accent-override',
    // codeBg writes the palette-layer override. applyCodeTheme writes a
    // DIFFERENT variable (--code-theme-block-bg-override) so the two
    // coexist in the CSS cascade: code-theme override > palette codeBg
    // override > theme default. Picking match-palette clears only the
    // theme layer, letting the palette colour show through. The form's
    // clearOtherCodeField mutex still applies so the codeBg field is
    // empty when a syntax theme is active (no point editing a value the
    // theme override hides).
    codeBg:                '--code-block-bg-override',
    blockquoteBg:          '--blockquote-bg-override',
    blockquoteFg:          '--blockquote-fg-override',
    tableHeaderBg:         '--table-header-bg-override',
    tableHeaderFg:         '--table-header-fg-override',
    linkColor:             '--link-override',
    // ruleColor controls TABLE / IMAGE / FOOTNOTE borders only. It used
    // to write --rule-override, which is the generic UI rule colour
    // shared with the settings dialog chrome. Now points at a content-
    // specific var so editing this setting no longer changes the
    // settings dialog's own borders.
    ruleColor:             '--content-rule-override',
    hrColor:               '--hr-color-override',
    headingUnderlineColor: '--heading-underline-override',
    h1Color:               '--h1-color-override',
    h2Color:               '--h2-color-override',
    h3Color:               '--h3-color-override',
    h4Color:               '--h4-color-override',
    h5Color:               '--h5-color-override',
    h6Color:               '--h6-color-override',
    highlightBg:           '--highlight-bg-override',
    highlightFg:           '--highlight-fg-override',
    highlightOpacity:      '--highlight-opacity-override',
    // Per-palette wrapped-content colours: bold / italic / strike / inline-code.
    // CSS uses var(--strong-override, var(--strong)) so a palette can override
    // each independently and the theme-light/-dark defaults from viewer.css
    // take over when null.
    strongColor:           '--strong-override',
    emphasisColor:         '--emphasis-override',
    strikeColor:           '--strike-override',
    monoColor:             '--mono-override',
    fontFamily:            '--font-prose-override',
    proseFontWeight:       '--font-weight-prose-override',
    codeFont:              '--font-mono-override',
    codeFontWeight:        '--font-weight-mono-override',
    codeFontSize:          '--font-size-code-override',
    codeLineHeight:        '--line-height-code-override',
    highlightFontWeight:   '--font-weight-highlight-override',
    fontSize:              '--font-size-override',
    lineHeight:            '--line-height-override',
    maxWidth:              '--page-max-override',
    pagePadding:           '--page-pad-override',
    hrThickness:           '--hr-thickness-override',
    headingUnderlineThickness: '--heading-underline-thickness-override',
    pageBorderColor:       '--page-border-color-override',
    pageBorderThickness:   '--page-border-thickness-override',
    pageShadow:            '--page-shadow-override',
};

const settingsPxKeys = new Set(['fontSize', 'maxWidth', 'pagePadding', 'hrThickness', 'headingUnderlineThickness', 'pageBorderThickness']);

// Page shadow levels: the settings dialog stores a named choice; this
// map translates it to an actual CSS box-shadow value at apply time.
// Progression: none -> floating mirrors a typical Material/elevation
// scale, with rgba(0,0,0,X) values that read decently on both light
// and dark pane backgrounds.
// Opacity values bumped per user feedback: shadows should be visibly
// stronger without growing in size. Blur/offset unchanged; alpha values
// roughly +50-75% across the scale so each level reads as a clear
// elevation step against both light and dark pane backgrounds.
const PAGE_SHADOW_MAP = {
    'none':       'none',
    'subtle':     '0 2px 6px rgba(0, 0, 0, 0.14)',
    'soft':       '0 4px 14px rgba(0, 0, 0, 0.20)',
    'medium':     '0 8px 24px rgba(0, 0, 0, 0.30)',
    'strong':     '0 14px 36px rgba(0, 0, 0, 0.42)',
    'floating':   '0 24px 60px rgba(0, 0, 0, 0.60)',
};

let defaultSettings = {};   // populated by loadDefaults()
let userSettings    = {};   // populated by 'userSettings' messages
let forcedTheme     = null; // 'light' | 'dark' | null
let lastNativeTheme = null; // 'light' | 'dark' set by 'theme' message
let lastHardLineBreaks = false; // tracks previous toggle state so we know when to re-render

function applySettings(s) {
    const root = document.documentElement.style;

    for (const [k, varName] of Object.entries(settingsCssMap)) {
        const v = s[k];
        if (v === undefined || v === null || v === '') {
            root.removeProperty(varName);
            continue;
        }
        // Px-typed keys: coerce numbers OR numeric strings to "<n>px".
        // The number-only check missed text-input values like "5" that
        // older settings.json files store as strings, producing invalid
        // CSS (`border: 5 solid ...` instead of `5px solid ...`).
        let out = v;
        if (settingsPxKeys.has(k)) {
            if (typeof v === 'number') {
                out = `${v}px`;
            } else if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) {
                out = `${v.trim()}px`;
            }
        } else if (k === 'pageShadow') {
            // The select stores a named choice ('none' / 'subtle' / ...).
            // Map to a real CSS box-shadow value here; unknown names
            // clear the override so the theme default takes over.
            const css = PAGE_SHADOW_MAP[String(v).toLowerCase()];
            if (css === undefined) {
                root.removeProperty(varName);
                continue;
            }
            out = css;
        }
        root.setProperty(varName, out);
    }

    // Theme override: pin or release. Theme class is rebuilt from scratch
    // below alongside the underline style class so they don't fight.
    let themeClass;
    if (s.theme === 'light' || s.theme === 'dark') {
        forcedTheme = s.theme;
        themeClass = 'theme-' + forcedTheme;
    } else {
        forcedTheme = null;
        themeClass = 'theme-' + (lastNativeTheme || 'light');
    }

    // Heading underline style: side-effect body class controlling H1-H6
    // underline. Three options: solid, gradient, none.
    const us = s.headingUnderlineStyle;
    const underlineClass =
        us === 'gradient' ? 'heading-underline-gradient' :
        us === 'none'     ? 'heading-underline-none'     :
                            'heading-underline-solid';

    // Preserve runtime classes (mode-*, etc.); rewrite only theme + underline
    // classes. Wholesale className overwrite here previously stripped mode-live
    // class set by HTML on first file load, hiding #editor via the default
    // .editor{display:none} CSS rule. setMode (and toolbar clicks) restored it,
    // hence the "switch and back" workaround. Filter+push preserves arbitrary
    // runtime classes (mode-*, sister-skill annotations, etc.).
    const preserved = document.body.className.split(/\s+/).filter(c =>
        c && !c.startsWith('theme-') && !c.startsWith('heading-underline-') && !c.startsWith('heading-text-')
    );
    document.body.className = [...preserved, themeClass, ...underlineClass.split(/\s+/).filter(Boolean)].join(' ');

    // Hard line breaks toggle.
    //
    // OFF (default, CommonMark): single newlines inside a paragraph or list
    // item are treated as whitespace; multi-line source flows as one
    // wrapped paragraph in Reading. Live still shows the source layout
    // because that's what a source-view editor does.
    //
    // ON: single newlines are hard breaks; markdown-it inserts <br> for
    // each newline. Reading now shows visible line breaks matching Live's
    // source-line layout.
    //
    // Implementation: flip the `breaks` option on BOTH markdown-it
    // instances (this file's `md` used by Reading + render() and the
    // shared `md` in lib/markdown-it-shared.js used by Live-mode block
    // widgets). If the value changed since the last apply, trigger a
    // re-render in Reading mode or rebuild the editor in Live/Source so
    // the new option propagates to currently-rendered HTML.
    const newBreaks = s.hardLineBreaks === true;
    const breaksChanged = newBreaks !== lastHardLineBreaks;
    md.set({ breaks: newBreaks });
    setSharedBreaks(newBreaks);
    lastHardLineBreaks = newBreaks;

    // Show-formatting-marks toggle: viewer.css renders a small "LF" /
    // "CRLF" badge at the end of each cm-line in Live mode when this class
    // is set. Pure CSS — no editor rebuild needed when toggled. The
    // formattingMarksField decorator always emits per-line classes; the
    // body class controls only whether the ::after badges show.
    document.body.classList.toggle('mdwx-show-formatting', s.showFormattingMarks === true);

    // Remote-image gate. Read by lib/markdown-it-shared.js (Reading mode
    // renderer) and livepreview/image.js (Live mode widget) when deciding
    // whether to honour an http(s) URL in an ![alt](url) reference. When
    // false, those callsites swap in a placeholder so no external request
    // is made and the host can't learn the document was opened.
    const newAllowRemote = s.allowRemoteImages === true;
    const remoteChanged  = newAllowRemote !== !!window.mdwxAllowRemoteImages;
    window.mdwxAllowRemoteImages = newAllowRemote;

    // Auto-reload-external setting. When ON, the load handler silently
    // applies disk content over any stash on file-return. The settings
    // dialog itself surfaces a temporary warning when the user ticks
    // the box (see settings.js), so no persistent in-viewer warning
    // is needed here.
    window.mdwxAlwaysReloadExternal = s.alwaysReloadExternal === true;

    // Auto-save: optional periodic Ctrl+S equivalent. 0 disables.
    applyAutoSave(s.autoSaveMinutes);

    // Three-layer code-block colour cascade:
    //   1. applyCodeTheme writes --code-<role>-theme-override and
    //      --code-theme-block-bg-override when codeBlockTheme is a
    //      specific theme (not match-palette).
    //   2. applyPaletteCodeColors writes --code-<role>-palette-override
    //      from the active palette's curated codeColors map. This
    //      layer is independent of codeBlockTheme — it's the active
    //      palette's identity colours, applied unconditionally.
    //   3. viewer.css derives --code-<role> defaults from palette CSS
    //      variables (accent, strong, mono, etc.) as the bottom-most
    //      fallback when neither override layer is set.
    // Layer 1 wins over 2 wins over 3 via CSS var() fallback chain in
    // the .tok-* rules. Picking match-palette clears layer 1 only.
    applyCodeTheme(s.codeBlockTheme);
    applyPaletteCodeColors(s.codePaletteColors);

    // Edit toolbar layout. Null/missing falls back to the manifest default
    // (every button visible, original HTML order, group separators
    // intact). A custom layout reorders and/or hides buttons; the apply
    // function reconciles stored ids against the current manifest so
    // newly-added buttons in future versions appear automatically.
    // (Top toolbar isn't customisable — it only has a handful of fixed
    // mode + action buttons that don't benefit from reordering.)
    applyToolbarLayout('edit', s.editToolbarLayout);

    // Toolbar display modes. The body classes are read by viewer.css to
    // overlay each toolbar over the content and slide it off-screen unless
    // the shared hot-zone strip at the top of the viewport (or the toolbar
    // itself, or any descendant that holds keyboard focus) is hovered.
    document.body.classList.toggle('top-toolbar-autohide',  s.topToolbarMode  === 'auto-hide');
    document.body.classList.toggle('edit-toolbar-autohide', s.editToolbarMode === 'auto-hide');

    if (breaksChanged || remoteChanged) {
        if (mode === 'reading') {
            render(dirty ? editorBuffer : loadedBuffer);
        } else if (editor) {
            destroyEditor();
            buildEditorFor(mode);
        }
    }
}

function resolveAndApply() {
    applySettings({ ...defaultSettings, ...userSettings });
}

async function loadDefaults() {
    try {
        const res = await fetch('settings-defaults.json', { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        defaultSettings = await res.json();
        // Strip the documentation comment field if present.
        delete defaultSettings._comment_;
    } catch (err) {
        console.warn('[viewer] settings-defaults.json load failed:', err);
        defaultSettings = {};
    }
    resolveAndApply();
}

// ---------------------------------------------------------------------------
// Bridge

function send(msg) {
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(JSON.stringify(msg));
    }
}

function onHostMessage(event) {
    let m = event.data;
    if (typeof m === 'string') {
        try { m = JSON.parse(m); } catch (err) { console.warn('bad host msg', err); return; }
    }
    if (!m || !m.type) return;

    switch (m.type) {
        case 'load':
            // {type:'load', path:'...', content:'...', encoding:'...'}
            //
            // Pre-swap: flush any pending stash for the OUTGOING file
            // before overwriting loadedPath. The 750ms debounce timer
            // might not have fired since the user's last keystroke,
            // and once we run setDirty(false) below the timer's
            // early-exit guard would discard the send. Without this,
            // edits made in the last ~1s before switching files are
            // lost from the stash, and the "click back to see the
            // banner" flow can't fire because there's nothing to
            // compare disk against.
            if (loadedPath && loadedPath !== m.path && dirty && editorBuffer !== loadedBuffer) {
                send({ type: 'stashBuffer', path: loadedPath, content: editorBuffer });
            }
            if (stashTimer) { clearTimeout(stashTimer); stashTimer = null; }

            loadedPath     = m.path || null;
            loadedBuffer   = m.content || '';
            editorBuffer   = loadedBuffer;
            loadedEncoding = m.encoding || 'utf-8';

            // Build per-line EOL type array from the raw content so the
            // formatting-marks decorator in Live mode can render the right
            // badge per line. CodeMirror normalizes line endings internally
            // (default to LF) — this is the only point where the original
            // CRLF/LF/CR-only distinction is preserved. Stored on window so
            // the decorator can read it without an EditorState facet.
            window.mdwxEolPerLine = (() => {
                const text = loadedBuffer;
                const result = [];
                let i = 0;
                while (i < text.length) {
                    const lf = text.indexOf('\n', i);
                    if (lf < 0) {
                        // Final line has no terminator.
                        result.push('none');
                        break;
                    }
                    result.push(lf > 0 && text.charCodeAt(lf - 1) === 13 ? 'crlf' : 'lf');
                    i = lf + 1;
                }
                if (text.length === 0) result.push('none');
                else if (text.endsWith('\n')) result.push('none');   // trailing-newline file has one empty line after
                return result;
            })();
            // Always hide the "Loading file..." placeholder once content
            // arrives, regardless of which mode we're in. (Only render()
            // used to do this; live/source modes don't call render().)
            if (initialEl) initialEl.style.display = 'none';

            // Stash restoration (process-scoped unsaved edits).
            //
            //   restoredFromStash: file unchanged on disk since the stash
            //   was recorded, so the user's unsaved edits are the right
            //   thing to show. Swap stashedContent in as the editor's
            //   live buffer; loadedBuffer stays as the disk version so
            //   the dirty-check still works.
            //
            //   conflictDetected: the file was modified externally
            //   between when we stashed and now. Show the disk version
            //   as the live buffer and pin the stashed content into
            //   pendingConflictStash for the banner's "Keep my edits"
            //   button to apply.
            pendingConflictStash = null;
            // What the editor should display on load + whether to show
            // the banner:
            //
            // Any stash present (restoredFromStash OR conflictDetected) +
            // setting OFF: show the banner asking "Keep my edits / Reload
            // original". Editor under the banner shows the stashed
            // (in-progress) content so the user sees what they would keep.
            //
            // conflictDetected + "Always reload external changes" ON:
            // silently use disk content. The user accepted that trade-off
            // when they enabled the setting; the persistent auto-reload
            // warning banner near the bottom keeps them aware of it.
            //
            // restoredFromStash + setting ON: still show the banner. The
            // setting only auto-discards when there's been an EXTERNAL
            // change — without one, no work would be saved by skipping
            // the prompt.
            //
            // No stash: plain load, disk content.
            const haveStash = (m.restoredFromStash || m.conflictDetected) &&
                              typeof m.stashedContent === 'string';
            // Only meaningful to surface a stash when it actually differs
            // from disk. If they're byte-identical, there's nothing to
            // choose between — silently treat it as a clean load.
            //
            // Normalise both sides before comparing. CodeMirror folds line
            // endings to LF when it ingests text into its EditorState, so
            // a stash that round-trips through the editor ends up with LF
            // even if the source file on disk had CRLF (Windows default).
            // A naive byte-for-byte check then declares the stash
            // "different from disk" even though the content is identical,
            // and the conflict banner shows on a file the user never
            // edited. Same logic for UTF-8 BOM presence which can come
            // and go through the encoding pipeline.
            const stashDiffersFromDisk =
                haveStash && normaliseForCompare(m.stashedContent) !== normaliseForCompare(loadedBuffer);
            let displayBuffer = loadedBuffer;
            let shouldBeDirty = false;
            if (haveStash && stashDiffersFromDisk) {
                if (window.mdwxAlwaysReloadExternal) {
                    // Setting on: discard stash silently regardless of
                    // whether the file changed externally. The user
                    // accepted the "save before switching" trade-off
                    // when they enabled this.
                    editorBuffer = loadedBuffer;
                    displayBuffer = loadedBuffer;
                    setStatus('reloaded from disk (auto-reload on)', 'ok');
                } else {
                    pendingConflictStash = m.stashedContent;
                    editorBuffer = m.stashedContent;
                    displayBuffer = m.stashedContent;
                    shouldBeDirty = (m.stashedContent !== loadedBuffer);
                    // Banner copy adapts to whether there was an external
                    // change since the stash, so the user knows what
                    // "Reload original" actually reverts to.
                    const bannerMsg = document.querySelector('#conflict-banner .conflict-banner-msg');
                    if (bannerMsg) {
                        bannerMsg.textContent = m.conflictDetected
                            ? 'This file changed on disk while you were viewing another file. You have unsaved edits stashed.'
                            : 'You have unsaved edits stashed for this file from earlier in this session.';
                    }
                }
            } else {
                editorBuffer = loadedBuffer;
            }

            if (mode === 'reading') {
                render(displayBuffer);
            } else {
                buildEditorFor(mode);
                if (editor) editor.setDoc(displayBuffer);
            }
            setDirty(shouldBeDirty);
            setTitle();
            if (pendingConflictStash !== null) {
                showConflictBanner();
            } else {
                hideConflictBanner();
            }
            break;
        case 'saveResult':
            // {type:'saveResult', ok:bool, error?:string, encoding?:string}
            if (m.ok) {
                loadedBuffer = editorBuffer;
                if (m.encoding) loadedEncoding = m.encoding;
                setDirty(false);
                setStatus('saved', 'ok');
                clearStash();
            } else {
                setStatus('save failed: ' + (m.error || 'unknown'), 'error');
            }
            break;
        case 'saveAsResult':
            // {type:'saveAsResult', ok:bool, cancelled?:bool, newPath?:string,
            //  encoding?:string, error?:string}
            if (m.cancelled) { setStatus(''); break; }
            if (m.ok) {
                // Clear stash for the OLD path before swapping loadedPath:
                // the edits have just been saved (to a different file),
                // so the original file's stash is stale.
                clearStash();
                if (m.newPath) loadedPath = m.newPath;
                loadedBuffer = editorBuffer || loadedBuffer;
                if (m.encoding) loadedEncoding = m.encoding;
                setDirty(false);
                setTitle();
                setStatus('saved as ' + (loadedPath ? loadedPath.split(/[\\/]/).pop() : 'file'), 'ok');
            } else {
                setStatus('save as failed: ' + (m.error || 'unknown'), 'error');
            }
            break;
        case 'imagePicked':
            // {type:'imagePicked', cancelled:bool, path:string, relative:string}
            // Native reply to pickImage. If cancelled, leave the popup as
            // the user left it. Otherwise fill the source input with the
            // ABSOLUTE path by default (renderer serves any local file via
            // the local-host _abs/ route). Users can edit it down to a
            // relative path or URL, or tick the copy checkbox to vendor
            // the file into the document's folder.
            if (m.cancelled) break;
            if (imgSrcInput) {
                const chosen = m.path || m.relative || '';
                imgSrcInput.value = chosen;
                updateImageInsertEnabled();
                syncCopyForUrl();
                imgSrcInput.focus();
                imgSrcInput.select();
            }
            break;
        case 'imageCopied':
            // {type:'imageCopied', cancelled, relative?, error?}
            // Reply to copyImage / downloadImage. P2 audit #21 + #22:
            // the old handler only covered the error path and the
            // success-with-pending-and-editor path. A {cancelled:true}
            // reply, OR an imageCopied that arrived after a mode switch
            // had nulled the editor (and our pending state), left
            // imgInsertBtn stuck disabled and the popup orphaned.
            // Every branch below explicitly re-runs updateImageInsertEnabled
            // so the button can never end up stuck unless the popup itself
            // is closed.
            if (m.cancelled === true) {
                pendingImageInsert = null;
                if (imgInsertBtn) updateImageInsertEnabled();
                break;
            }
            if (m.error) {
                setStatus('image copy failed: ' + m.error, 'error');
                pendingImageInsert = null;
                if (imgInsertBtn) updateImageInsertEnabled();
                break;
            }
            if (m.relative && pendingImageInsert && editor) {
                insertImage(editor.view, { ...pendingImageInsert, path: m.relative });
                pendingImageInsert = null;
                toggleImagePopup(false);
                if (imgInsertBtn) updateImageInsertEnabled();
                break;
            }
            // Reply arrived after the editor was destroyed (mode
            // switch in flight) or with no pending state. Drop the
            // result cleanly so the popup doesn't strand.
            pendingImageInsert = null;
            toggleImagePopup(false);
            if (imgInsertBtn) updateImageInsertEnabled();
            break;
        case 'theme':
            // {type:'theme', mode:'dark'|'light', paneBg:'#rgb'}
            lastNativeTheme = m.mode === 'dark' ? 'dark' : 'light';
            if (!forcedTheme) {
                // Preserve any existing heading-underline-* class while
                // swapping the theme-* class.
                const cls = document.body.className.split(/\s+/)
                    .filter(c => !c.startsWith('theme-'));
                cls.push('theme-' + lastNativeTheme);
                document.body.className = cls.join(' ');
            }
            if (m.paneBg) document.documentElement.style.setProperty('--pane-bg', m.paneBg);
            break;
        case 'userSettings':
            // {type:'userSettings', json:'<rawtext>'} — native relays the
            // user's settings file verbatim, JSON parsing happens here so a
            // malformed file degrades to "ignore" rather than crashing native.
            try {
                userSettings = m.json && m.json.trim()
                    ? JSON.parse(m.json)
                    : {};
                delete userSettings._comment_;
            } catch (err) {
                console.warn('[viewer] user settings.json parse failed:', err);
                userSettings = {};
            }
            resolveAndApply();
            break;
        case 'settings':
            // Legacy/direct-set path (kept for in-page configuration UI later).
            applySettings(m.settings || {});
            break;
        case 'clear':
            clearContent();
            break;
        default:
            console.warn('[viewer] unknown msg type:', m.type);
    }
}

if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener('message', onHostMessage);
    // Kick off defaults load in parallel with the ready handshake. Native
    // will respond with userSettings, theme, and (optionally) load — the
    // merge runs whenever either side updates.
    loadDefaults();
    send({ type: 'ready', version: '0.1.2' });
    console.log('[viewer] bridge connected, ready sent');
} else {
    console.warn('[viewer] no chrome.webview — running outside WebView2');
    loadDefaults();
}

// Diagnostics: surface broken image loads in the console so we can see what
// went wrong without leaving DevTools open all the time.
document.addEventListener('error', e => {
    if (e.target && e.target.tagName === 'IMG') {
        console.error('[viewer] IMG load failed:', e.target.src,
                      '(natural size:', e.target.naturalWidth, 'x',
                      e.target.naturalHeight + ')');
    }
}, /* useCapture */ true);
