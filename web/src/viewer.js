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
import attrs from 'markdown-it-attrs';
import DOMPurify from 'dompurify';
import { createEditor } from './editor.js';
import { COMMANDS as EDITOR_COMMANDS, insertImage } from './editor-toolbar.js';
import { rewriteImageUrl } from './lib/local-url.js';

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
// Attribute syntax `{width=200 height=150 .class-name #id}` after inline
// images, links, headings, code fences, etc. Used by the Insert Image
// toolbar so sized/aligned images stay as portable markdown rather than
// becoming raw <img> tags.
md.use(attrs, {
    allowedAttributes: ['id', 'class', 'width', 'height', 'title'],
});

// Image rewriting: relative paths -> virtual host the native side maps
// to the markdown file's parent directory. Absolute paths (file:// or
// C:\foo) need WebResourceRequested support; not yet implemented.
const defaultImageRender = md.renderer.rules.image ||
    ((tokens, idx, options, env, slf) => slf.renderToken(tokens, idx, options));

md.renderer.rules.image = (tokens, idx, options, env, slf) => {
    const token = tokens[idx];
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

function render(markdownText) {
    if (initialEl) initialEl.style.display = 'none';
    const html = md.render(markdownText || '');
    const clean = DOMPurify.sanitize(html, {
        ADD_ATTR: ['target', 'rel', 'loading', 'decoding', 'data-external',
                   'data-line-start', 'data-line-end'],
        ADD_TAGS: ['source', 'figure', 'figcaption'],
        FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed'],
        FORBID_ATTR: ['onerror', 'onload', 'onclick'],
    });
    contentEl.innerHTML = clean;

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
        },
        onSave:   () => triggerSave(),
        onSaveAs: () => triggerSaveAs(),
    });
    editorMode = targetMode;
    attachEditorScrollSync();
}

function setMode(next) {
    if (!MODES.includes(next)) return;
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
    // TEMP DIAGNOSTIC: log layout sizes after the DOM settles so we can see
    // exactly where source-mode width is being constrained.
    requestAnimationFrame(() => requestAnimationFrame(() => logLayout('after setMode ' + mode)));
}

// TEMP DIAGNOSTIC. Prints the box position + width of every element in the
// layout chain so we can see which one is causing the source-mode editor
// to sit on the left instead of centring. Remove once diagnosed.
function logLayout(label) {
    const pick = sel => {
        const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
            sel: typeof sel === 'string' ? sel : el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''),
            x: Math.round(r.left),
            width: Math.round(r.width),
            display: cs.display,
            maxW: cs.maxWidth,
            margin: cs.marginLeft + ' / ' + cs.marginRight,
            padding: cs.paddingLeft + ' / ' + cs.paddingRight,
            inlineW: el.style.width || '—',
        };
    };
    console.group('[layout] ' + label);
    console.log('viewport', window.innerWidth, 'visualVP', window.visualViewport && window.visualViewport.width,
                'docElClient', document.documentElement.clientWidth);
    console.table([
        pick('html'),
        pick('body'),
        pick('.page'),
        pick('.editor'),
        pick('.cm-editor'),
        pick('.cm-scroller'),
        pick('.cm-content'),
    ].filter(Boolean));
    console.groupEnd();
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
const imgInsertBtn   = document.getElementById('img-pop-insert');
const imgCancelBtn   = document.getElementById('img-pop-cancel');

// Insert is enabled whenever the source input has any non-whitespace text,
// so a typed URL counts the same as a path returned by the native Browse
// dialog.
function updateImageInsertEnabled() {
    if (!imgInsertBtn || !imgSrcInput) return;
    imgInsertBtn.disabled = imgSrcInput.value.trim() === '';
}

function resetImagePopupState() {
    if (imgSrcInput)    imgSrcInput.value    = '';
    if (imgAltInput)    imgAltInput.value    = '';
    if (imgWidthInput)  imgWidthInput.value  = '';
    if (imgHeightInput) imgHeightInput.value = '';
    const noneRadio = document.querySelector('input[name="img-pop-align"][value="none"]');
    if (noneRadio) noneRadio.checked = true;
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
    imgSrcInput.addEventListener('input', updateImageInsertEnabled);
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
        insertImage(editor.view, {
            path:      src,
            alt:       imgAltInput ? imgAltInput.value : '',
            width:     widthVal  || null,
            height:    heightVal || null,
            alignment: alignment,
        });
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
    codeBg:                '--code-override',
    linkColor:             '--link-override',
    ruleColor:             '--rule-override',
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
    pageBorderColor:       '--page-border-color-override',
    pageBorderThickness:   '--page-border-thickness-override',
};

const settingsPxKeys = new Set(['fontSize', 'maxWidth', 'pagePadding', 'hrThickness', 'pageBorderThickness']);

let defaultSettings = {};   // populated by loadDefaults()
let userSettings    = {};   // populated by 'userSettings' messages
let forcedTheme     = null; // 'light' | 'dark' | null
let lastNativeTheme = null; // 'light' | 'dark' set by 'theme' message

function applySettings(s) {
    const root = document.documentElement.style;

    for (const [k, varName] of Object.entries(settingsCssMap)) {
        const v = s[k];
        if (v === undefined || v === null || v === '') {
            root.removeProperty(varName);
        } else {
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
            }
            root.setProperty(varName, out);
        }
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
            loadedPath     = m.path || null;
            loadedBuffer   = m.content || '';
            editorBuffer   = loadedBuffer;
            loadedEncoding = m.encoding || 'utf-8';
            // Always hide the "Loading file..." placeholder once content
            // arrives, regardless of which mode we're in. (Only render()
            // used to do this; live/source modes don't call render().)
            if (initialEl) initialEl.style.display = 'none';
            if (mode === 'reading') {
                render(loadedBuffer);
            } else {
                buildEditorFor(mode);
                if (editor) editor.setDoc(loadedBuffer);
            }
            setDirty(false);
            setTitle();
            break;
        case 'saveResult':
            // {type:'saveResult', ok:bool, error?:string, encoding?:string}
            if (m.ok) {
                loadedBuffer = editorBuffer;
                if (m.encoding) loadedEncoding = m.encoding;
                setDirty(false);
                setStatus('saved', 'ok');
            } else {
                setStatus('save failed: ' + (m.error || 'unknown'), 'error');
            }
            break;
        case 'saveAsResult':
            // {type:'saveAsResult', ok:bool, cancelled?:bool, newPath?:string,
            //  encoding?:string, error?:string}
            if (m.cancelled) { setStatus(''); break; }
            if (m.ok) {
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
            // the user left it. Otherwise fill the source input, preferring
            // the relative path so the inserted markdown stays portable.
            if (m.cancelled) break;
            if (imgSrcInput) {
                const chosen = (m.relative && m.relative.length) ? m.relative : (m.path || '');
                imgSrcInput.value = chosen;
                updateImageInsertEnabled();
                imgSrcInput.focus();
                imgSrcInput.select();
            }
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
    send({ type: 'ready', version: '0.1.0' });
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
