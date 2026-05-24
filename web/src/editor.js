// CodeMirror 6 editor wrapper.
//
// Built thin: state + view + markdown grammar + minimum keymap + a theme
// that re-uses the viewer's CSS variables so the editor inherits page bg,
// ink colour, monospace font etc. without a separate palette.

import { EditorState } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine,
         highlightActiveLineGutter, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle,
         bracketMatching, indentOnInput, syntaxTree } from '@codemirror/language';
import { tags } from '@lezer/highlight';
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
const markdownSyntaxStyle = HighlightStyle.define([
    { tag: tags.processingInstruction, color: 'var(--accent-override, var(--accent))' },
    { tag: tags.contentSeparator,      color: 'var(--accent-override, var(--accent))' },
    { tag: tags.url,                   color: 'var(--link-override, var(--link))' },
    { tag: tags.labelName,             color: 'var(--link-override, var(--link))' },
    { tag: tags.heading,               fontWeight: '600' },
    { tag: tags.emphasis,              fontStyle: 'italic' },
    { tag: tags.strong,                fontWeight: '600' },
    { tag: tags.strikethrough,         textDecoration: 'line-through' },
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
            lineHeight: 'var(--line-height-code-override, 1.55)',
        },
        '.cm-line': { padding: '0' },
        '&.cm-focused .cm-cursor': {
            borderLeftColor: 'var(--accent-override, var(--accent))',
            borderLeftWidth: '2px',
        },
        '.cm-activeLine': { backgroundColor: 'var(--code-override, var(--code))' },
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
        // Line numbers + active-line gutter + default syntax highlighting are
        // SOURCE-mode only. In Live mode the syntax highlighter applies tag-
        // based styling (e.g. text-decoration:underline on headings) which
        // conflicts with the WYSIWYG cm-md-* decorations we want to win.
        ...(livePreview ? [] : [
            lineNumbers(),
            highlightActiveLineGutter(),
            syntaxHighlighting(markdownSyntaxStyle),
        ]),
        highlightActiveLine(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        highlightSelectionMatches(),
        // Use extended Markdown grammar (GFM + Subscript + Superscript + Emoji)
        // so strikethrough, task lists, tables, autolinks, sub/sup all parse
        // into syntax tree nodes the live-preview decorators can match. Default
        // markdown() uses commonmarkLanguage which has none of these.
        markdown({base: markdownLanguage}),
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
            if (u.docChanged && onChange) onChange(u.state.doc.toString());
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
            });
        },
        focus: () => view.focus(),
        destroy: () => view.destroy(),
    };
}
