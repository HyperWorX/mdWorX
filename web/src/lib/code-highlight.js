// Shared code-block syntax highlighter.
//
// Both Reading mode (markdown-it fence rule) and Live mode (CM6
// fencedCode widget) route through this module so the rendered HTML for a
// fenced code block is identical across modes. The CM6 editor itself also
// uses the same codeHighlighter so source-mode code blocks pick up the
// same palette-driven colours.
//
// Class naming: codeHighlighter from @lezer/highlight emits classes like
// `tok-keyword`, `tok-string`, `tok-comment`, etc. The companion CSS in
// viewer.css maps each `.tok-*` class to a `--code-*` palette variable.
// A palette swap or code-theme-preset swap just flips the variables and
// every block re-skins instantly without re-tokenising.

import { highlightTree, tagHighlighter, tags as t } from '@lezer/highlight';
import { StreamLanguage } from '@codemirror/language';

// Custom tag-to-class mapping. Nine token roles, each one a `tok-*` class
// that the companion CSS resolves to a `--code-*` palette variable. Order
// matters for specialised tags: function/variable specialisations are
// listed before the bare variableName/propertyName they extend, so a
// function call gets `tok-function` rather than `tok-variable`.
const codeHighlighter = tagHighlighter([
    // Keyword family — all bucketed together.
    { tag: t.keyword,            class: 'tok-keyword' },
    { tag: t.controlKeyword,     class: 'tok-keyword' },
    { tag: t.operatorKeyword,    class: 'tok-keyword' },
    { tag: t.definitionKeyword,  class: 'tok-keyword' },
    { tag: t.modifier,           class: 'tok-keyword' },
    { tag: t.self,               class: 'tok-keyword' },
    { tag: t.null,               class: 'tok-keyword' },
    { tag: t.atom,               class: 'tok-keyword' },

    // String family — string literals, regex, escape sequences.
    { tag: t.string,             class: 'tok-string' },
    { tag: t.special(t.string),  class: 'tok-string' },
    { tag: t.escape,             class: 'tok-string' },
    { tag: t.regexp,             class: 'tok-string' },
    { tag: t.character,          class: 'tok-string' },
    { tag: t.url,                class: 'tok-string' },

    // Comments.
    { tag: t.comment,            class: 'tok-comment' },
    { tag: t.lineComment,        class: 'tok-comment' },
    { tag: t.blockComment,       class: 'tok-comment' },
    { tag: t.docComment,         class: 'tok-comment' },

    // Numerics + booleans + similar literal-value tokens.
    { tag: t.number,             class: 'tok-number' },
    { tag: t.integer,            class: 'tok-number' },
    { tag: t.float,              class: 'tok-number' },
    { tag: t.bool,               class: 'tok-number' },
    { tag: t.literal,            class: 'tok-number' },

    // Functions — anything called like a function.
    { tag: t.function(t.variableName), class: 'tok-function' },
    { tag: t.function(t.propertyName), class: 'tok-function' },
    { tag: t.macroName,                class: 'tok-function' },

    // Types — type names, class names, namespaces.
    { tag: t.typeName,           class: 'tok-type' },
    { tag: t.className,          class: 'tok-type' },
    { tag: t.namespace,          class: 'tok-type' },
    { tag: t.tagName,            class: 'tok-type' },

    // Operators.
    { tag: t.operator,           class: 'tok-operator' },
    { tag: t.arithmeticOperator, class: 'tok-operator' },
    { tag: t.logicOperator,      class: 'tok-operator' },
    { tag: t.bitwiseOperator,    class: 'tok-operator' },
    { tag: t.compareOperator,    class: 'tok-operator' },
    { tag: t.updateOperator,     class: 'tok-operator' },
    { tag: t.definitionOperator, class: 'tok-operator' },
    { tag: t.typeOperator,       class: 'tok-operator' },

    // Variables / properties / attributes.
    { tag: t.variableName,       class: 'tok-variable' },
    { tag: t.propertyName,       class: 'tok-variable' },
    { tag: t.attributeName,      class: 'tok-variable' },
    { tag: t.attributeValue,     class: 'tok-string' },
    { tag: t.labelName,          class: 'tok-variable' },

    // Punctuation — brackets, parens, separators, meta.
    { tag: t.punctuation,        class: 'tok-punctuation' },
    { tag: t.bracket,            class: 'tok-punctuation' },
    { tag: t.paren,              class: 'tok-punctuation' },
    { tag: t.brace,              class: 'tok-punctuation' },
    { tag: t.squareBracket,      class: 'tok-punctuation' },
    { tag: t.angleBracket,       class: 'tok-punctuation' },
    { tag: t.separator,          class: 'tok-punctuation' },
    { tag: t.meta,               class: 'tok-punctuation' },

    // Diff-specific.
    { tag: t.inserted,           class: 'tok-inserted' },
    { tag: t.deleted,            class: 'tok-deleted' },
    { tag: t.changed,            class: 'tok-changed' },

    // Invalid / unterminated.
    { tag: t.invalid,            class: 'tok-invalid' },
]);

import { javascriptLanguage, typescriptLanguage,
         jsxLanguage, tsxLanguage } from '@codemirror/lang-javascript';
import { htmlLanguage }     from '@codemirror/lang-html';
import { xmlLanguage }      from '@codemirror/lang-xml';
import { cssLanguage }      from '@codemirror/lang-css';
import { jsonLanguage }     from '@codemirror/lang-json';
import { yamlLanguage }     from '@codemirror/lang-yaml';
import { StandardSQL }      from '@codemirror/lang-sql';
const sqlLanguage = StandardSQL.language;
import { cppLanguage }      from '@codemirror/lang-cpp';
import { pythonLanguage }   from '@codemirror/lang-python';
import { rustLanguage }     from '@codemirror/lang-rust';
import { goLanguage }       from '@codemirror/lang-go';
import { markdownLanguage } from '@codemirror/lang-markdown';

// Legacy modes wrap old CM5 modes for CM6. We use them where no native
// Lezer parser exists: bash/shell, diff, ini.
import { shell }      from '@codemirror/legacy-modes/mode/shell';
import { diff }       from '@codemirror/legacy-modes/mode/diff';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { toml }       from '@codemirror/legacy-modes/mode/toml';

const shellLang = StreamLanguage.define(shell);
const diffLang  = StreamLanguage.define(diff);
const iniLang   = StreamLanguage.define(properties);
const tomlLang  = StreamLanguage.define(toml);

// Map fence info-strings to a Language object. Keys cover the common
// aliases people use (`js`, `javascript`, `node`, etc.). Lookup is
// case-insensitive and tolerates leading/trailing whitespace.
const aliases = {
    'js':         javascriptLanguage,
    'jsx':        jsxLanguage,
    'javascript': javascriptLanguage,
    'node':       javascriptLanguage,
    'ts':         typescriptLanguage,
    'tsx':        tsxLanguage,
    'typescript': typescriptLanguage,
    'html':       htmlLanguage,
    'htm':        htmlLanguage,
    'xml':        xmlLanguage,
    'svg':        xmlLanguage,
    'css':        cssLanguage,
    'scss':       cssLanguage,
    'less':       cssLanguage,
    'json':       jsonLanguage,
    'jsonc':      jsonLanguage,
    'yaml':       yamlLanguage,
    'yml':        yamlLanguage,
    'sql':        sqlLanguage,
    'mysql':      sqlLanguage,
    'pgsql':      sqlLanguage,
    'sqlite':     sqlLanguage,
    'c':          cppLanguage,
    'cpp':        cppLanguage,
    'c++':        cppLanguage,
    'cxx':        cppLanguage,
    'h':          cppLanguage,
    'hpp':        cppLanguage,
    'python':     pythonLanguage,
    'py':         pythonLanguage,
    'rust':       rustLanguage,
    'rs':         rustLanguage,
    'go':         goLanguage,
    'golang':     goLanguage,
    'md':         markdownLanguage,
    'markdown':   markdownLanguage,
    'sh':         shellLang,
    'bash':       shellLang,
    'shell':      shellLang,
    'zsh':        shellLang,
    'console':    shellLang,
    'diff':       diffLang,
    'patch':      diffLang,
    'ini':        iniLang,
    'properties': iniLang,
    'toml':       tomlLang,
};

// Canonical list of language IDs the highlighter advertises support for.
// Used by the README / settings UI to show "supported languages". Order is
// the canonical display order, not alphabetical.
export const supportedLanguages = [
    'javascript', 'typescript', 'python', 'rust', 'go', 'cpp', 'sql',
    'json', 'yaml', 'toml', 'ini', 'bash', 'html', 'xml', 'css',
    'markdown', 'diff',
];

export function languageFor(infoString) {
    if (!infoString) return null;
    const key = infoString.toLowerCase().trim().split(/[\s,]/)[0];
    return aliases[key] || null;
}

// Walk a parse tree and produce HTML where each token is wrapped in a
// `<span class="tok-...">`. Plain (non-tokenised) text is emitted as text
// nodes. Returns a string of safe HTML — input language tokens cannot
// inject markup because we escape the source text explicitly.
function escapeHtml(s) {
    return s.replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
}

// Highlight a source string in the given language. Returns HTML string
// containing token spans plus plain text. If no language is registered for
// the info string the source is returned escaped but unhighlighted.
export function highlightToHtml(code, infoString) {
    const lang = languageFor(infoString);
    if (!lang) return escapeHtml(code);

    try {
        const tree = lang.parser.parse(code);
        let out = '';
        let pos = 0;
        highlightTree(tree, codeHighlighter, (from, to, classes) => {
            if (from > pos) out += escapeHtml(code.slice(pos, from));
            out += `<span class="${classes}">${escapeHtml(code.slice(from, to))}</span>`;
            pos = to;
        });
        if (pos < code.length) out += escapeHtml(code.slice(pos));
        return out;
    } catch {
        // A language parser (especially the stream-based legacy modes such as
        // powershell / shell / toml) can throw on a degenerate or adversarial
        // fence body. One fenced block must never blank the whole Reading view
        // or break the Live editor build — fall back to escaped, unhighlighted
        // source. (This, not a decorator throw, was the real cause of a
        // complex README refusing to open in Live mode.)
        return escapeHtml(code);
    }
}

// Same as highlightToHtml but writes into a target DOM element via
// individual text + span nodes. Used by Live-mode widgets that already
// hold a <code> element and want to avoid an extra round-trip through
// innerHTML. Returns nothing — appends directly.
export function highlightIntoElement(code, infoString, codeEl) {
    const lang = languageFor(infoString);
    if (!lang) {
        codeEl.textContent = code;
        return;
    }
    try {
        const tree = lang.parser.parse(code);
        let pos = 0;
        highlightTree(tree, codeHighlighter, (from, to, classes) => {
            if (from > pos) {
                codeEl.appendChild(document.createTextNode(code.slice(pos, from)));
            }
            const span = document.createElement('span');
            span.className = classes;
            span.appendChild(document.createTextNode(code.slice(from, to)));
            codeEl.appendChild(span);
            pos = to;
        });
        if (pos < code.length) {
            codeEl.appendChild(document.createTextNode(code.slice(pos)));
        }
    } catch {
        // See highlightToHtml: a throwing parser must not escape the Live-mode
        // CodeBlockWidget.toDOM (which would break the editor render). Degrade
        // to plain text — textContent also clears any partial spans appended
        // before the throw.
        codeEl.textContent = code;
    }
}

// Re-export the highlighter so CM6 editor.js can install it via
// syntaxHighlighting(...) and get the same class names on its rendered
// tokens as Reading mode produces.
export { codeHighlighter };
