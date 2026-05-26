// Shared markdown-it instance used by live-preview widgets.
//
// Mirrors viewer.js's markdown-it setup so block-replacement widgets in
// Live mode produce the exact same HTML markdown-it produces for Reading
// mode. This means Reading-mode CSS (`#content X`) extended with
// `.cm-md-rendered-block X` applies natively to widget DOM — true visual
// parity without per-element compensation.
//
// Plugins kept in sync with viewer.js: task-lists, footnote, deflist,
// abbr, mark, sub, sup. If viewer.js's md config changes, change here too.

import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import footnote from 'markdown-it-footnote';
import deflist from 'markdown-it-deflist';
import abbr from 'markdown-it-abbr';
import markIns from 'markdown-it-mark';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import DOMPurify from 'dompurify';
import { rewriteImageUrl } from './local-url.js';
import { parseImageAlt } from './image-alt.js';
import { highlightToHtml } from './code-highlight.js';

export const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    breaks: false,
});

// Allow viewer.js to flip the `breaks` option at runtime when the user
// toggles the hardLineBreaks setting. markdown-it's md.set() reconfigures
// options without rebuilding the instance. The next renderBlock() /
// renderInline() call uses the new value. Live-mode block widgets
// (heading/list/blockquote/table) re-render through this same instance,
// so a single setter flip propagates to both Reading-mode HTML and Live
// widget HTML — provided the relevant call sites re-run after the change
// (Reading: viewer re-render; Live: editor rebuild on next mode entry).
export function setBreaks(hardBreaks) {
    md.set({ breaks: !!hardBreaks });
}

md.use(taskLists, { enabled: true, label: true, labelAfter: true });
md.use(footnote);
md.use(deflist);
md.use(abbr);
md.use(markIns);
md.use(sub);
md.use(sup);

// Image src rewriting through the local virtual host (matches viewer.js).
const defaultImageRender = md.renderer.rules.image ||
    ((tokens, idx, options, env, slf) => slf.renderToken(tokens, idx, options));

md.renderer.rules.image = (tokens, idx, options, env, slf) => {
    const token = tokens[idx];

    // Obsidian-style alt-text dimensions/alignment (matches viewer.js).
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
        } else if (rewritten.isExternal &&
                   typeof window !== 'undefined' &&
                   !window.mdwxAllowRemoteImages) {
            // Remote-image gate: external URLs are blocked unless the
            // 'Allow remote images' setting is on. Empty src + a hint in
            // alt so the reader knows to flip the setting if they expected
            // an image here.
            token.attrSet('src', '');
            token.attrSet('alt',
                (token.attrGet('alt') || '') +
                ' (remote image blocked — enable in settings)');
        } else {
            token.attrSet('src', rewritten.src);
            token.attrSet('loading', 'lazy');
            token.attrSet('decoding', 'async');
        }
    }
    return defaultImageRender(tokens, idx, options, env, slf);
};

// Fenced code block rendering. Override the default fence rule so the
// rendered HTML carries `<span class="tok-...">` token spans produced by
// the shared code-highlight module. Same tokens, same classes Live mode
// emits, so a single `.tok-*` stylesheet skins both modes identically.
md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const info  = (token.info || '').trim();
    const lang  = info.split(/\s+/)[0];
    const code  = token.content;
    const inner = highlightToHtml(code, lang);
    const cls   = lang ? ` class="language-${lang}"` : '';
    return `<pre><code${cls}>${inner}</code></pre>\n`;
};

// External link routing (matches viewer.js): add data-external attribute so
// the widget can attach click handler that posts to native.
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

const sanitizeConfig = {
    ADD_ATTR: ['target', 'rel', 'loading', 'decoding', 'data-external',
               'data-line-start', 'data-line-end'],
    ADD_TAGS: ['source', 'figure', 'figcaption'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick'],
};

export function sanitize(html) {
    return DOMPurify.sanitize(html, sanitizeConfig);
}

// Render a block of markdown source to safe HTML. Used by heading, list,
// and blockquote widget decorators.
export function renderBlock(text) {
    return sanitize(md.render(text || ''));
}

// Render inline markdown source (no <p> wrapping). Used by table widget
// for cell content; also re-exported via util.js for back-compat.
export function renderInline(text) {
    return sanitize(md.renderInline(text || ''));
}

// Attach the native-bridge click handler to all external links inside a
// widget DOM root. Called by every widget after toDOM populates innerHTML.
export function wireExternalLinks(rootEl) {
    rootEl.querySelectorAll('a[data-external="1"]').forEach(a => {
        a.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.chrome && window.chrome.webview) {
                window.chrome.webview.postMessage(JSON.stringify({
                    type: 'openExternal',
                    url: a.getAttribute('href'),
                }));
            }
        });
    });
}
