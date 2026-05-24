// Footnote decorator — Decoration.mark for refs + block-hide for defs +
// section widget at doc end. Defensive: any throw inside compute is
// caught and surfaced via diagnostic banner so badges still render.

import { Decoration, WidgetType, ViewPlugin } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { decoratorStateField, isCursorInRange } from './util.js';
import { renderInline } from '../lib/markdown-it-shared.js';

// ============= Normalizer: move all def lines to end of doc =============
// Runs ONCE when the editor mounts. Scans for footnote def lines anywhere
// in the doc; if any are NOT after the last non-def content line, removes
// them in place and re-appends them in original order at the end of the
// doc. This makes click-to-edit always land cursor near the bottom (next
// to the rendered footnotes section widget).

function normalizeFootnoteDefs(view) {
    const state = view.state;
    const doc = state.doc;
    if (doc.length === 0) return;

    // Collect defs (multi-line: starts at [^id]: , continuation = 4-space).
    const defs = [];
    let cur = null;
    for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        const text = line.text;
        if (text.trim() === '') {
            if (cur) { defs.push(cur); cur = null; }
            continue;
        }
        const defMatch = text.match(/^\[\^([^\]]+)\]:/);
        if (defMatch) {
            if (cur) defs.push(cur);
            cur = { id: defMatch[1], text: text, firstLine: i, lastLine: i };
            continue;
        }
        if (cur && /^ {4}/.test(text)) {
            cur.text += '\n' + text;
            cur.lastLine = i;
            continue;
        }
        if (cur) { defs.push(cur); cur = null; }
    }
    if (cur) defs.push(cur);
    if (defs.length === 0) return;

    // Find last non-def content line.
    let lastContentLine = 0;
    for (let i = doc.lines; i >= 1; i--) {
        const line = doc.line(i);
        const t = line.text;
        if (t.trim() === '') continue;
        if (/^\[\^[^\]]+\]:/.test(t)) continue;
        if (/^ {4}/.test(t)) continue;
        lastContentLine = i;
        break;
    }

    // If all defs already after lastContentLine, nothing to do.
    if (defs.every(d => d.firstLine > lastContentLine)) return;

    // Build removal changes (reverse order to keep positions valid).
    const changes = [];
    const defsByLineDesc = defs.slice().sort((a, b) => b.firstLine - a.firstLine);
    for (const d of defsByLineDesc) {
        const fromLine = doc.line(d.firstLine);
        const removeFrom = fromLine.from;
        const removeTo = (d.lastLine < doc.lines)
            ? doc.line(d.lastLine + 1).from
            : doc.length;
        changes.push({ from: removeFrom, to: removeTo, insert: '' });
    }

    // Append all defs in original order at end of doc.
    let appendText = '';
    const tail = doc.toString().slice(-2);
    if (!tail.endsWith('\n\n')) appendText += tail.endsWith('\n') ? '\n' : '\n\n';
    appendText += defs.map(d => d.text).join('\n\n');
    changes.push({ from: doc.length, to: doc.length, insert: appendText });

    view.dispatch({
        changes,
        userEvent: 'footnote.normalize',
    });
}

export const footnoteNormalizer = ViewPlugin.fromClass(class {
    constructor(view) {
        // Defer to next microtask so the initial render completes first
        // and other extensions get to see the original doc state.
        Promise.resolve().then(() => {
            try { normalizeFootnoteDefs(view); } catch (e) {
                if (typeof window !== 'undefined') window.__fnNormError = String(e);
            }
        });
    }
});

// Diagnostic banner removed. If a real error occurs in compute we surface
// it via window.__fnError (visible via DevTools console) instead of a
// visible badge — no green pill cluttering the viewer.
function ensureDiagBanner(text, colour) {
    if (typeof window === 'undefined') return;
    // Visible diag is opt-in via window.__fnShowDiag = true (set in
    // console). Otherwise silent. Existing banner from previous build
    // gets removed on first call.
    const existing = document.getElementById('__fn-diag');
    if (existing) existing.remove();
    if (!window.__fnShowDiag) return;
    try {
        const b = document.createElement('div');
        b.id = '__fn-diag';
        b.style.cssText = 'position:fixed;top:60px;right:8px;background:'
                        + (colour || '#0a0') + ';color:#fff;'
                        + 'padding:4px 8px;z-index:99999;font:11px monospace;'
                        + 'border-radius:3px;opacity:0.85;cursor:pointer;';
        b.textContent = text || 'fn.js OK';
        b.onclick = () => b.remove();
        document.body.appendChild(b);
    } catch {}
}

function scrollToId(id) {
    const target = document.getElementById(id);
    if (target) {
        // 'start' lands target at top of viewport so user sees it
        // immediately rather than scrolling past extra content above.
        target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        target.classList.add('cm-md-footnote-flash');
        setTimeout(() => target.classList.remove('cm-md-footnote-flash'), 1200);
    }
}

// Use Decoration.line + display:none CSS to hide def lines.
// CRITICAL: do NOT use Decoration.replace({block:true}) — that makes the
// range ATOMIC per CM6 spec, which means dispatched cursor positions
// INSIDE the range get clipped to BEFORE it. Result: clicking a section
// <li> to edit the def lands cursor above the def line, not on it.
// Line decorations with display:none leave the source positions
// addressable by cursor dispatch; decorator's next pass sees cursor in
// range and removes the hide.
const hiddenDefLineDeco = Decoration.line({ class: 'cm-md-footnote-def-hidden' });

// Ref widget — single <a> rendered as small superscript accent link [N].
// Matches Reading-mode markdown-it-footnote output (<sup><a>[N]</a></sup>)
// visually using display:inline-block + vertical-align:super on the <a>
// directly (avoids <sup> wrapper line-height-collapse issue).
class FootnoteRefWidget extends WidgetType {
    constructor(id, num) {
        super();
        this.id = id;
        this.num = num;
    }
    eq(other) { return other.id === this.id && other.num === this.num; }
    toDOM() {
        const a = document.createElement('a');
        a.className = 'cm-md-footnote-ref-link';
        a.id = `fnref-${this.id}`;
        a.href = `#fn-${this.id}`;
        a.textContent = `[${this.num}]`;
        a.title = `Footnote ${this.num}: jump to definition`;
        // mousedown (not click) — CM6 places its cursor on mousedown,
        // BEFORE click fires. Use mousedown + preventDefault to stop
        // CM6's cursor placement, then run our scroll.
        a.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            scrollToId(`fn-${this.id}`);
        });
        return a;
    }
    ignoreEvent() { return true; }
}

class FootnotesSectionWidget extends WidgetType {
    constructor(defs) {
        super();
        this.defs = defs;
        this._key = defs.map(d =>
            `${d.id}\x01${d.num}\x01${d.bodyText}\x01${d.bodyStart}\x01${d.bodyEnd}`).join('\x02');
    }
    eq(other) { return other._key === this._key; }
    toDOM(view) {
        const wrap = document.createElement('div');
        wrap.className = 'cm-md-rendered-block cm-md-footnotes-section';
        let html = '<hr class="footnotes-sep"/><section class="footnotes"><ol>';
        for (const d of this.defs) {
            let inner;
            try {
                inner = renderInline(d.bodyText);
            } catch {
                inner = String(d.bodyText)
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;');
            }
            html += `<li id="fn-${escapeAttr(d.id)}" value="${d.num}" `
                  + `data-body-start="${d.bodyStart}" `
                  + `data-body-end="${d.bodyEnd}" `
                  + `title="Click to edit in place">`
                  + `<p class="cm-md-fn-body">${inner}</p>`
                  + `<a href="#fnref-${escapeAttr(d.id)}" class="footnote-backref" `
                  + `title="Back to reference">↩</a></li>`;
        }
        html += '</ol></section>';
        wrap.innerHTML = html;

        wrap.querySelectorAll('.footnote-backref').forEach(a => {
            a.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const href = a.getAttribute('href');
                if (href && href.startsWith('#')) scrollToId(href.slice(1));
            });
        });

        // Inline edit: click on <p> body → swap to contenteditable showing
        // raw source body text; on blur or Enter, dispatch a transaction
        // replacing the source def body. No cursor jump to source.
        wrap.querySelectorAll('li').forEach(li => {
            const p = li.querySelector('p.cm-md-fn-body');
            if (!p) return;
            p.addEventListener('mousedown', (e) => {
                if (e.target.closest('.footnote-backref')) return;
                if (p.dataset.editing === '1') return;
                e.preventDefault();
                e.stopPropagation();
                const bodyStart = parseInt(li.dataset.bodyStart, 10);
                const bodyEnd = parseInt(li.dataset.bodyEnd, 10);
                if (isNaN(bodyStart) || isNaN(bodyEnd) || !view) return;
                const rawBody = view.state.doc.sliceString(bodyStart, bodyEnd);
                p.dataset.editing = '1';
                p.classList.add('cm-md-fn-body-editing');
                p.textContent = rawBody;
                p.setAttribute('contenteditable', 'true');
                setTimeout(() => {
                    p.focus();
                    const range = document.createRange();
                    range.selectNodeContents(p);
                    range.collapse(false);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                }, 0);

                let saved = false;
                const save = (commit) => {
                    if (saved) return;
                    saved = true;
                    p.removeEventListener('blur', onBlur);
                    p.removeEventListener('keydown', onKey);
                    if (commit) {
                        const newBody = p.textContent;
                        view.dispatch({
                            changes: { from: bodyStart, to: bodyEnd, insert: newBody },
                            userEvent: 'edit.footnote',
                        });
                    } else {
                        view.dispatch({});
                    }
                };
                const onBlur = () => save(true);
                const onKey = (ev) => {
                    if (ev.key === 'Escape') {
                        ev.preventDefault();
                        save(false);
                        view.focus();
                    } else if (ev.key === 'Enter' && !ev.shiftKey) {
                        ev.preventDefault();
                        save(true);
                        view.focus();
                    }
                };
                p.addEventListener('blur', onBlur);
                p.addEventListener('keydown', onKey);
            });
        });

        return wrap;
    }
    ignoreEvent() { return true; }
}

function escapeAttr(s) {
    return String(s).replace(/[&<>"']/g, c =>
        ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

if (typeof document !== 'undefined' && typeof window !== 'undefined' && !window.__fnClickInstalled) {
    window.__fnClickInstalled = true;
    document.addEventListener('click', (e) => {
        const t = e.target;
        const ref = (t && t.classList && t.classList.contains('cm-md-footnote-ref-mark'))
            ? t
            : (t && t.closest && t.closest('.cm-md-footnote-ref-mark'));
        if (ref) {
            const id = ref.getAttribute('data-fnref');
            if (id) {
                e.preventDefault();
                scrollToId(`fn-${id}`);
            }
        }
    });
}

// Use Decoration.replace + FootnoteRefWidget so source [^why] gets
// REPLACED by a clean [N] superscript (not styled as a red badge of the
// raw source). The widget's <a> renders inline-block with vertical-align:
// super for the superscript effect.
function makeRefDeco(id, num) {
    return Decoration.replace({ widget: new FootnoteRefWidget(id, num) });
}

// Internal compute wrapped so throws don't kill the decoration set.
function computeFootnotes(state) {
    const items = [];
    const doc = state.doc;

    const defs = [];
    let cur = null;
    function flushCur() { if (cur) { defs.push(cur); cur = null; } }

    for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        const text = line.text;
        if (text.trim() === '') { flushCur(); continue; }
        const defMatch = text.match(/^(\[\^[^\]]+\]:\s*)(.*)$/);
        if (defMatch) {
            flushCur();
            cur = {
                id: defMatch[0].match(/\[\^([^\]]+)\]/)[1],
                bodyParts: [defMatch[2]],
                firstLine: i,
                lastLine: i,
                bodyStart: line.from + defMatch[1].length,
                bodyEnd: line.to,
            };
            continue;
        }
        if (cur && /^ {4}/.test(text)) {
            cur.bodyParts.push(text.replace(/^ {4}/, ''));
            cur.lastLine = i;
            cur.bodyEnd = line.to;
            continue;
        }
        flushCur();
    }
    flushCur();

    const defNumberById = new Map();
    defs.forEach((d, idx) => {
        d.num = idx + 1;
        d.sourceFrom = doc.line(d.firstLine).from;
        defNumberById.set(d.id, d.num);
    });

    if (typeof window !== 'undefined') window.__fnRefs = [];

    let inDef = false;
    for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        const text = line.text;
        if (/^\[\^[^\]]+\]:/.test(text)) { inDef = true; continue; }
        if (inDef && /^ {4}/.test(text)) continue;
        if (text.trim() === '') { inDef = false; continue; }
        inDef = false;

        const refRegex = /\[\^([^\]]+)\](?!:)/g;
        let m;
        while ((m = refRegex.exec(text)) !== null) {
            const start = line.from + m.index;
            const end = start + m[0].length;
            // Cursor-in-range: show raw source so user can type/edit the
            // [^id] text. Without this, the widget replaces [^new] the
            // moment the closing ] is typed, locking the user out of
            // further edits.
            if (isCursorInRange(state, [start, end])) continue;
            const id = m[1];
            const num = defNumberById.has(id) ? defNumberById.get(id) : `?${id}`;
            if (typeof window !== 'undefined') {
                try { window.__fnRefs.push({ id, num, start, end, line: i }); } catch {}
            }
            items.push({ from: start, to: end, deco: makeRefDeco(id, num) });
        }
    }

    for (const def of defs) {
        // Always hide def lines — editing happens exclusively via the
        // rendered footnotes section's contenteditable bodies. Previously
        // this had a cursor-in-range escape so the source def became
        // visible when the caret landed on it, but that meant any stray
        // click could reveal a hidden line and let the user edit in two
        // places. Always-hidden keeps the def out of view; the section
        // widget at doc end is the single edit surface.
        for (let ln = def.firstLine; ln <= def.lastLine; ln++) {
            const line = doc.line(ln);
            items.push({
                from: line.from,
                to: line.from,
                deco: hiddenDefLineDeco,
                block: true,
            });
        }
    }

    if (defs.length > 0) {
        const rendered = defs.map(d => ({
            id: d.id, num: d.num,
            sourceFrom: d.sourceFrom,
            bodyStart: d.bodyStart || d.sourceFrom,
            bodyEnd: d.bodyEnd != null ? d.bodyEnd : (d.bodyStart || d.sourceFrom),
            bodyText: d.bodyParts.join(' '),
        }));
        items.push({
            from: doc.length, to: doc.length,
            deco: Decoration.widget({
                widget: new FootnotesSectionWidget(rendered),
                side: 1, block: true,
            }),
        });
    }

    items.sort((a, b) => {
        if (a.from !== b.from) return a.from - b.from;
        if (a.to !== b.to) return a.to - b.to;
        return (b.block ? 1 : 0) - (a.block ? 1 : 0);
    });
    const builder = new RangeSetBuilder();
    for (const it of items) builder.add(it.from, it.to, it.deco);
    return builder.finish();
}

export const footnoteField = decoratorStateField((state) => {
    try {
        const set = computeFootnotes(state);
        ensureDiagBanner('fn.js OK', '#0a0');
        return set;
    } catch (e) {
        // Surface the error visibly so we can see WHAT broke instead of
        // silently losing all decorations.
        ensureDiagBanner('fn.js ERR: ' + String(e).slice(0, 80), '#c00');
        if (typeof window !== 'undefined') window.__fnError = String(e);
        return Decoration.none;
    }
});
