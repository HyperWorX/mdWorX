// Fenced code block decorator.
//
// When the caret is outside a fenced code block, replace the whole block
// with a syntax-highlighted <pre><code> widget (per Marijn's CM6 forum
// guidance — call highlightTree with a parsed inner-language tree). When
// the caret is inside, show raw markdown including the ``` fences.
//
// Language detection: @codemirror/lang-markdown is already configured in
// editor.js. Languages it has installed (lang-javascript, lang-html,
// lang-css, lang-markdown itself) get full highlighting; unknown
// languages render as plain monospace.

import { Decoration, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree, defaultHighlightStyle } from '@codemirror/language';
import { highlightTree } from '@lezer/highlight';
import { javascriptLanguage } from '@codemirror/lang-javascript';
import { htmlLanguage } from '@codemirror/lang-html';
import { cssLanguage } from '@codemirror/lang-css';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { decoratorStateField, isCursorInRange } from './util.js';

// Map fenced language tag -> parser. Strings come from the fenced code
// info string (e.g. `lang-js` / `js` / `javascript`).
const languageMap = {
    'js': javascriptLanguage,
    'jsx': javascriptLanguage,
    'javascript': javascriptLanguage,
    'ts': javascriptLanguage,
    'tsx': javascriptLanguage,
    'typescript': javascriptLanguage,
    'json': javascriptLanguage,
    'html': htmlLanguage,
    'htm':  htmlLanguage,
    'xml':  htmlLanguage,
    'svg':  htmlLanguage,
    'css':  cssLanguage,
    'scss': cssLanguage,
    'md':   markdownLanguage,
    'markdown': markdownLanguage,
};

function parserFor(lang) {
    if (!lang) return null;
    const k = lang.toLowerCase().trim();
    const langObj = languageMap[k];
    return langObj ? langObj.parser : null;
}

class CodeBlockWidget extends WidgetType {
    constructor(lang, code) {
        super();
        this.lang = lang;
        this.code = code;
    }
    eq(other) { return other.lang === this.lang && other.code === this.code; }
    toDOM() {
        // Wrap pre in code-block-wrap so the copy button can sit at the
        // corner without being clipped by pre's overflow-x: auto.
        const wrap = document.createElement('div');
        wrap.className = 'code-block-wrap';

        const pre = document.createElement('pre');
        pre.className = 'cm-md-codeblock';
        const codeEl = document.createElement('code');
        if (this.lang) codeEl.className = 'language-' + this.lang;
        const parser = parserFor(this.lang);
        if (parser) {
            const tree = parser.parse(this.code);
            let pos = 0;
            highlightTree(tree, defaultHighlightStyle, (from, to, classes) => {
                if (from > pos) {
                    codeEl.appendChild(document.createTextNode(this.code.slice(pos, from)));
                }
                const span = document.createElement('span');
                span.className = classes;
                span.appendChild(document.createTextNode(this.code.slice(from, to)));
                codeEl.appendChild(span);
                pos = to;
            });
            if (pos < this.code.length) {
                codeEl.appendChild(document.createTextNode(this.code.slice(pos)));
            }
        } else {
            codeEl.textContent = this.code;
        }
        pre.appendChild(codeEl);
        wrap.appendChild(pre);

        // Copy button. mousedown handler so CM6 doesn't move the caret
        // before the click registers (same pattern as task.js).
        const codeText = this.code;
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
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                await navigator.clipboard.writeText(codeText);
                btn.classList.add('copied');
                btn.title = 'Copied';
                clearTimeout(btn._t);
                btn._t = setTimeout(() => {
                    btn.classList.remove('copied');
                    btn.title = 'Copy code';
                }, 1500);
            } catch { /* clipboard unavailable */ }
        });
        wrap.appendChild(btn);
        return wrap;
    }
    // Tell CM6 not to handle events targeting the widget — its own native
    // click/mousedown listeners run instead. Without this, CM6 could reposition
    // the caret on click and the button feels unresponsive.
    ignoreEvent(e) {
        if (e && e.target && e.target.closest && e.target.closest('.code-copy-btn')) {
            return true;
        }
        return false;
    }
}

// Extract `lang` and the inner code text from a FencedCode node's source.
//
//     ```lang
//     code...
//     ```
//
// We slice the source and pull the info string from the opening fence;
// drop the first and last lines (the fences).
function parseFenced(source) {
    const lines = source.split('\n');
    if (lines.length < 2) return { lang: '', code: '' };
    const opener = lines[0];
    const m = opener.match(/^(?:```|~~~)\s*([\w+\-]*)/);
    const lang = m ? m[1] : '';
    let endIdx = lines.length - 1;
    // Trim trailing fence if present.
    if (/^(?:```|~~~)\s*$/.test(lines[endIdx])) endIdx -= 1;
    const code = lines.slice(1, endIdx + 1).join('\n');
    return { lang, code };
}

export const fencedCodeField = decoratorStateField((state) => {
    const items = [];
    const tree = syntaxTree(state);
    tree.iterate({
        enter(node) {
            if (node.name !== 'FencedCode') return;
            if (isCursorInRange(state, [node.from, node.to])) return;
            const src = state.doc.sliceString(node.from, node.to);
            const { lang, code } = parseFenced(src);
            items.push({
                from: node.from,
                to: node.to,
                deco: Decoration.replace({
                    block: true,
                    widget: new CodeBlockWidget(lang, code),
                }),
            });
        },
    });
    items.sort((a, b) => (a.from - b.from) || (a.to - b.to));
    const builder = new RangeSetBuilder();
    for (const it of items) builder.add(it.from, it.to, it.deco);
    return builder.finish();
});
