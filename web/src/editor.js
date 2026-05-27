// CodeMirror 6 editor wrapper.
//
// Built thin: state + view + markdown grammar + minimum keymap + a theme
// that re-uses the viewer's CSS variables so the editor inherits page bg,
// ink colour, monospace font etc. without a separate palette.

import { EditorState, Annotation } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine,
         highlightActiveLineGutter, lineNumbers, highlightWhitespace,
         highlightTrailingWhitespace } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle,
         bracketMatching, indentOnInput, syntaxTree,
         LanguageDescription, StreamLanguage } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { cpp } from '@codemirror/lang-cpp';
import { go } from '@codemirror/lang-go';
import { rust } from '@codemirror/lang-rust';
import { json } from '@codemirror/lang-json';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { perl } from '@codemirror/legacy-modes/mode/perl';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { properties } from '@codemirror/legacy-modes/mode/properties';

// Fenced-code-block language map. Each LanguageDescription is matched
// against the info string after \`\`\`, so the editor highlights inside
// the block once the fence is closed. legacy-modes entries wrap a
// StreamLanguage; bundled lang-* packages are used directly so we get
// the modern Lezer parsers when available. New languages get added
// here by:
//   1. installing the lang-* package (or use legacy-modes)
//   2. importing it above
//   3. adding a LanguageDescription entry with all aliases
// Names cover GitHub-Linguist conventional aliases so \`\`\`js and
// \`\`\`javascript both resolve.
const codeLanguages = [
    LanguageDescription.of({ name: 'javascript', alias: ['js', 'jsx', 'ts', 'tsx', 'typescript', 'node'], support: javascript() }),
    LanguageDescription.of({ name: 'python',     alias: ['py'],                                            support: python() }),
    LanguageDescription.of({ name: 'cpp',        alias: ['c', 'c++', 'cxx', 'cc', 'h', 'hpp', 'objc'],     support: cpp() }),
    LanguageDescription.of({ name: 'go',         alias: ['golang'],                                        support: go() }),
    LanguageDescription.of({ name: 'rust',       alias: ['rs'],                                            support: rust() }),
    LanguageDescription.of({ name: 'json',       alias: ['jsonc'],                                         support: json() }),
    LanguageDescription.of({ name: 'sql',        alias: ['mysql', 'postgres', 'postgresql', 'sqlite'],     support: sql() }),
    LanguageDescription.of({ name: 'xml',        alias: ['svg'],                                           support: xml() }),
    LanguageDescription.of({ name: 'yaml',       alias: ['yml'],                                           support: yaml() }),
    LanguageDescription.of({ name: 'html',       alias: ['htm'],                                           support: html() }),
    LanguageDescription.of({ name: 'css',        alias: ['scss', 'less'],                                  support: css() }),
    LanguageDescription.of({ name: 'shell',      alias: ['sh', 'bash', 'zsh'],                             support: StreamLanguage.define(shell) }),
    LanguageDescription.of({ name: 'powershell', alias: ['ps1', 'pwsh'],                                   support: StreamLanguage.define(powerShell) }),
    LanguageDescription.of({ name: 'ruby',       alias: ['rb'],                                            support: StreamLanguage.define(ruby) }),
    LanguageDescription.of({ name: 'lua',        alias: [],                                                support: StreamLanguage.define(lua) }),
    LanguageDescription.of({ name: 'perl',       alias: ['pl'],                                            support: StreamLanguage.define(perl) }),
    LanguageDescription.of({ name: 'swift',      alias: [],                                                support: StreamLanguage.define(swift) }),
    LanguageDescription.of({ name: 'dockerfile', alias: ['docker'],                                        support: StreamLanguage.define(dockerFile) }),
    LanguageDescription.of({ name: 'toml',       alias: [],                                                support: StreamLanguage.define(toml) }),
    LanguageDescription.of({ name: 'diff',       alias: ['patch'],                                         support: StreamLanguage.define(diff) }),
    LanguageDescription.of({ name: 'properties', alias: ['ini', 'conf'],                                   support: StreamLanguage.define(properties) }),
];
import { codeHighlighter } from './lib/code-highlight.js';
import { livePreviewExtension } from './editor-livepreview.js';

// Source-mode markdown highlighting.
//
// Principle: monochrome body, accented markers. The reader's eye falls on the
// words. Markers are scaffolding — visible, legible, but not competing for
// attention.
//
// Why this instead of @codemirror/language's defaultHighlightStyle:
//   defaultHighlightStyle paints with literal hex values tuned for a generic
//   light VS Code-style palette. It ignores the user's chosen palette, so on
//   theme-light its mid-grey markers wash out against #f0f0f0 (2:1 contrast),
//   and on theme-dark they clash with the warm accent. defaultHighlightStyle
//   also paints heading TEXT colour (not just markers), producing fruit-salad
//   source views where you cannot tell content from structure.
//
// Tag mapping from @lezer/markdown (markdownHighlighting in @lezer/markdown
// dist/index.js):
//   processingInstruction → HeaderMark, EmphasisMark, StrongEmphasisMark,
//                           ListMark, QuoteMark, CodeMark, LinkMark,
//                           TableDelimiter, HardBreak (the actual marker chars)
//   contentSeparator      → HorizontalRule (---)
//   url                   → URL inside (...) and autolinks
//   labelName             → CodeInfo (fence language tag), LinkLabel
//   heading1..6           → entire heading line (inherited by HeaderMark too)
//   emphasis / strong     → entire run including marks
//
// Body text (paragraphs, heading content, list content, emphasis content,
// link text, inline-code content) is NOT styled here — it inherits the
// cm-content colour, which the source-mode editor theme sets to --ink.
// Switching palettes recolours markers automatically because the colours are
// CSS variables resolved at paint time. Adding a new palette to settings.js
// requires no source-view tuning.
// Every markdown marker token routes through the palette accent so the live
// editor's revealed-source state (cursor on line) tracks the active palette
// instead of falling through to defaultHighlightStyle's hardcoded #7a757a
// (meta -> ListMark dash/asterisk) and #219 (url, contentSeparator, labelName).
//
// textDecoration: 'none' on tag.heading is REQUIRED: defaultHighlightStyle.heading
// sets textDecoration: underline, both styles' classes apply to heading tokens,
// and the cascade resolves by declaration order. By registering markdownSyntaxStyle
// AFTER defaultHighlightStyle in createEditor() below, this rule wins and the
// heading text in live mode (where cm-md-heading-N already owns heading visuals)
// is not underlined by the syntax highlighter.
const markdownSyntaxStyle = HighlightStyle.define([
    // Marker tokens carry both colour and bold weight: bold makes the thin
    // accent-coloured punctuation read as a deliberate syntax-emphasis layer
    // rather than blending into prose, especially when the same accent is
    // used for ordered-list numbers and the heading H3 default colour.
    { tag: tags.processingInstruction, color: 'var(--accent-override, var(--accent))', fontWeight: '700' },
    { tag: tags.meta,                  color: 'var(--accent-override, var(--accent))', fontWeight: '700' },
    { tag: tags.contentSeparator,      color: 'var(--accent-override, var(--accent))', fontWeight: '700' },
    { tag: tags.labelName,             color: 'var(--accent-override, var(--accent))', fontWeight: '700' },
    { tag: tags.url,                   color: 'var(--accent-override, var(--accent))', fontWeight: '700' },
    { tag: tags.heading,               fontWeight: '600', textDecoration: 'none' },
    // Wrapped CONTENT colours: each inline-emphasis kind gets its own
    // palette-derived hue so prose reads like a real syntax-highlighter view,
    // not "marker accent + plain ink for everything else". Variables are
    // pushed by settings.js for the per-palette overrides; non-override
    // fallback resolves to --strong / --emphasis / --strike / --mono defined
    // per-theme in viewer.css.
    { tag: tags.emphasis,              fontStyle: 'italic',  color: 'var(--emphasis-override, var(--emphasis))' },
    { tag: tags.strong,                fontWeight: '600',    color: 'var(--strong-override, var(--strong))' },
    { tag: tags.strikethrough,         textDecoration: 'line-through', color: 'var(--strike-override, var(--strike))' },
    { tag: tags.monospace,             color: 'var(--mono-override, var(--mono))' },
    // Per-level heading colours so source mode mirrors the per-Hn
    // palette settings the reader sees in Reading / Live. tags.heading
    // (above) sets weight + clears underline for all six; these
    // override the colour per level. Tags more specific than the
    // generic heading tag take precedence in CM's highlighter.
    { tag: tags.heading1,              color: 'var(--h1-color-override, var(--h1-color, var(--accent-override, var(--accent))))' },
    { tag: tags.heading2,              color: 'var(--h2-color-override, var(--h2-color, var(--ink-override, var(--ink))))' },
    { tag: tags.heading3,              color: 'var(--h3-color-override, var(--h3-color, var(--ink-override, var(--ink))))' },
    { tag: tags.heading4,              color: 'var(--h4-color-override, var(--h4-color, var(--ink-override, var(--ink))))' },
    { tag: tags.heading5,              color: 'var(--h5-color-override, var(--h5-color, var(--ink-override, var(--ink))))' },
    { tag: tags.heading6,              color: 'var(--h6-color-override, var(--h6-color, var(--ink-override, var(--ink))))' },
    // Block-quote text: muted relative to body ink so the > marker
    // (handled via processingInstruction above) is visibly the leading
    // structural element and the quote body recedes a touch.
    { tag: tags.quote,                 color: 'var(--blockquote-fg-override, var(--blockquote-fg, var(--ink-muted, var(--ink))))' },
    // Link content (the [bracketed] text portion of [text](url)). The
    // URL itself is tagged tags.url and styled with the accent
    // earlier. tags.link covers the whole link incl. brackets and the
    // bracketed text — match the rendered viewer where links inherit
    // the link colour.
    { tag: tags.link,                  color: 'var(--link-color-override, var(--link-color, var(--accent-override, var(--accent))))' },
    // Link title (the "title" inside [text](url "title")). Italicised
    // to disambiguate from the URL it sits next to.
    { tag: tags.string,                color: 'var(--link-color-override, var(--link-color, var(--accent-override, var(--accent))))',
                                       fontStyle: 'italic' },
    // Backslash escapes (\\*, \\_, \\[) — surface them in the accent
    // so the user can see at a glance that a character is being
    // escaped rather than acting as markup.
    { tag: tags.escape,                color: 'var(--accent-override, var(--accent))' },
    // HTML entities (&amp; &#x2014; etc.) — same family as escapes.
    { tag: tags.character,             color: 'var(--accent-override, var(--accent))' },
    // HTML comments (<!-- ... -->) — render as comment-style muted.
    { tag: tags.comment,               color: 'var(--ink-muted, var(--ink))', fontStyle: 'italic' },
]);

// List-aware Tab / Shift-Tab. When the cursor is on a line that is part of
// a markdown list (Lezer node ListItem), Tab adds 2 spaces at the START of
// the line (making the item nested) and Shift+Tab removes them (outdenting).
// Falls through to default behaviour (indentMore/indentLess from
// @codemirror/commands) for non-list lines.
function lineIsListItem(state, line) {
    const tree = syntaxTree(state);
    // Find the deepest node at line.from. Walk up; if we hit a ListItem,
    // the line is part of a list.
    let n = tree.resolveInner(line.from, 1);
    while (n) {
        if (n.name === 'ListItem' || n.name === 'BulletList' || n.name === 'OrderedList') return true;
        n = n.parent;
    }
    // Fallback: leading "- " / "* " / "+ " / "N. " text pattern.
    return /^\s*([-*+]|\d+\.)\s/.test(line.text);
}

const listIndentKeymap = [
    {
        key: 'Tab',
        run: (view) => {
            const { state } = view;
            // Only handle Tab specially for single-cursor selections.
            if (state.selection.ranges.length !== 1) return false;
            const r = state.selection.main;
            const line = state.doc.lineAt(r.head);
            if (!lineIsListItem(state, line)) return false;
            view.dispatch({
                changes: { from: line.from, insert: '  ' },
                selection: { anchor: r.head + 2 },
                userEvent: 'input.indent',
            });
            return true;
        },
        shift: (view) => {
            const { state } = view;
            if (state.selection.ranges.length !== 1) return false;
            const r = state.selection.main;
            const line = state.doc.lineAt(r.head);
            if (!lineIsListItem(state, line)) return false;
            const lead = line.text.match(/^( *)/)[1].length;
            if (lead === 0) return false;
            const remove = Math.min(2, lead);
            view.dispatch({
                changes: { from: line.from, to: line.from + remove },
                selection: { anchor: Math.max(line.from, r.head - remove) },
                userEvent: 'delete.dedent',
            });
            return true;
        },
    },
];

// Returns the EditorView theme for the requested mode. Source mode keeps
// the original monospace + padded layout. Live mode emits a minimal theme
// and defers font, colour, line-height, and padding to viewer.css's
// `body.mode-live .cm-editor` rules and the outer `.page` container, so
// the editor inherits the prose look without competing with the cascade.
function buildEditorTheme(livePreview) {
    if (livePreview) {
        return EditorView.theme({
            '&': {
                height: 'auto',
                backgroundColor: 'transparent',
                // No fontFamily / fontSize / color here — let
                // `body.mode-live .cm-editor` win via cascade.
            },
            '.cm-scroller': { fontFamily: 'inherit', overflow: 'visible' },
            '.cm-content': {
                padding: '0',
                caretColor: 'var(--ink-override, var(--ink))',
            },
            '.cm-line': { padding: '0' },
            '&.cm-focused .cm-cursor': {
                borderLeftColor: 'var(--accent-override, var(--accent))',
                borderLeftWidth: '2px',
            },
            '.cm-activeLine': { backgroundColor: 'transparent' },
            '.cm-gutters': { display: 'none' },
            '&.cm-focused .cm-selectionBackground, ::selection, .cm-selectionBackground': {
                backgroundColor: 'color-mix(in srgb, var(--accent-override, var(--accent)) 22%, transparent) !important',
            },
            '.cm-searchMatch': { backgroundColor: 'var(--accent-faded)', outline: '1px solid var(--accent)' },
        }, { dark: false });
    }
    // Source mode: unchanged from prior implementation.
    return EditorView.theme({
        '&': {
            height: '100%',
            backgroundColor: 'var(--page-override, var(--page))',
            color: 'var(--ink-override, var(--ink))',
            fontFamily: 'var(--font-mono-override, ui-monospace, Consolas, "Cascadia Code", "Segoe UI Mono", monospace)',
            fontSize: 'var(--font-size-code-override, 13px)',
        },
        '.cm-scroller': { fontFamily: 'inherit', overflow: 'auto' },
        '.cm-content': {
            padding: 'var(--page-pad-override, 32px 40px)',
            caretColor: 'var(--ink-override, var(--ink))',
            lineHeight: 'var(--line-height-code-override, var(--line-height-override, 1.55))',
        },
        '.cm-line': { padding: '0' },
        '&.cm-focused .cm-cursor': {
            borderLeftColor: 'var(--accent-override, var(--accent))',
            borderLeftWidth: '2px',
        },
        '.cm-activeLine': { backgroundColor: 'var(--code)' },
        '.cm-gutters': {
            backgroundColor: 'transparent',
            color: 'var(--ink-soft)',
            border: 'none',
            opacity: 0.5,
        },
        '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink-override, var(--ink))' },
        '&.cm-focused .cm-selectionBackground, ::selection, .cm-selectionBackground': {
            backgroundColor: 'var(--accent-faded) !important',
        },
        '.cm-searchMatch': { backgroundColor: 'var(--accent-faded)', outline: '1px solid var(--accent)' },
    }, { dark: false });
}

export function createEditor({ parent, doc, onChange, onSave, onSaveAs,
                               livePreview = false }) {
    const saveKeymap = keymap.of([
        { key: 'Mod-s',       preventDefault: true,
          run: () => { if (onSave)   onSave();   return true; } },
        { key: 'Mod-Shift-s', preventDefault: true,
          run: () => { if (onSaveAs) onSaveAs(); return true; } },
    ]);
    const baseExtensions = [
        // Line numbers + active-line gutter are SOURCE-mode only.
        ...(livePreview ? [] : [
            lineNumbers(),
            highlightActiveLineGutter(),
        ]),
        // BOTH modes get both highlighters, registered in this order:
        //   1. markdownSyntaxStyle — palette-aware overrides for markdown
        //      structural tokens (heading, emphasis, marks, etc.). MUST be
        //      first. CM6's highlightingFor() walks registered styles and
        //      uses the first match it finds for a tag — registration order
        //      is winner-takes-all, not additive.
        //   2. codeHighlighter — emits stable `tok-keyword` / `tok-string`
        //      etc. class names for everything markdownSyntaxStyle does not
        //      address (nested-language tokens inside fenced code blocks in
        //      source mode). The companion `.tok-*` CSS in viewer.css resolves
        //      those to palette `--code-*` variables, so source-mode code
        //      blocks pick up the same colours as Reading and Live modes.
        syntaxHighlighting(markdownSyntaxStyle),
        syntaxHighlighting(codeHighlighter),
        highlightActiveLine(),
        // Whitespace markers (spaces -> ·, tabs -> →, trailing spaces
        // surfaced separately) are wired here always. The marker glyphs
        // are gated by CSS on body.mdwx-show-formatting so toggling the
        // "Show formatting characters in Live mode" setting flips
        // visibility instantly without an editor rebuild.
        highlightWhitespace(),
        highlightTrailingWhitespace(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        highlightSelectionMatches(),
        // Use extended Markdown grammar (GFM + Subscript + Superscript + Emoji)
        // so strikethrough, task lists, tables, autolinks, sub/sup all parse
        // into syntax tree nodes the live-preview decorators can match. Default
        // markdown() uses commonmarkLanguage which has none of these.
        // codeLanguages passes through to lang-markdown's parseCode wrap,
        // so fenced \`\`\`<lang>\n...\n\`\`\` blocks get the nested
        // language's full Lezer parse tree. Without this, fenced bodies
        // were a flat sea of monospace ink. The companion codeHighlighter
        // (registered above) emits the .tok-* class names that resolve
        // to palette --code-* CSS variables.
        markdown({base: markdownLanguage, codeLanguages}),
        // List-aware Tab/Shift-Tab MUST come before defaultKeymap so it wins
        // over indentMore/indentLess for list lines. Falls through (returns
        // false) for non-list lines so indentWithTab still works elsewhere.
        keymap.of([
            ...listIndentKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
        ]),
        saveKeymap,
        EditorState.allowMultipleSelections.of(true),
        EditorView.lineWrapping,
        buildEditorTheme(livePreview),
        EditorView.updateListener.of(u => {
            if (!u.docChanged || !onChange) return;
            // Programmatic doc replacements (setDoc — file load, mode
            // switch, reload-from-disk) flag their transaction with the
            // programmaticDocUpdate annotation. Without this guard the
            // file-load setDoc fires onChange -> scheduleStash, which
            // creates a stash entry whose content equals the just-loaded
            // buffer. The next time the user opens the same file, native
            // sees the stash and JS shows the conflict banner because
            // CodeMirror's LF normalisation makes the stash differ from
            // the next disk read on Windows (CRLF files). Bug #3.
            if (u.transactions.some(tr => tr.annotation(programmaticDocUpdate))) return;
            onChange(u.state.doc.toString());
        }),
    ];
    if (livePreview) baseExtensions.push(livePreviewExtension());

    const state = EditorState.create({
        doc: doc || '',
        extensions: baseExtensions,
    });
    const view = new EditorView({ state, parent });
    return {
        view,
        getDoc: () => view.state.doc.toString(),
        setDoc(text) {
            view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: text || '' },
                annotations: programmaticDocUpdate.of(true),
            });
        },
        focus: () => view.focus(),
        destroy: () => view.destroy(),
    };
}

// Annotation that marks a transaction as a programmatic doc replacement
// (file load, mode switch, reload-from-disk) so the updateListener can
// skip onChange and avoid stashing the just-loaded content. See bug #3.
const programmaticDocUpdate = Annotation.define();
