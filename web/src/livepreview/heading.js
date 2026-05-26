// Heading decorator — per-line decoration (Obsidian / atomic-editor pattern).
//
// Strategy:
//   1. Apply Decoration.line({ class: 'cm-md-heading-line cm-md-heading-N' })
//      to each line of every heading, REGARDLESS of cursor position. This
//      gives the line its formatted appearance (font size, weight, colour)
//      from existing viewer.css rules (lines 309-335). Setext headings
//      iterate over both lines (text + ===/---). ATX headings iterate one.
//   2. Hide HeaderMark tokens (# / ## etc. for ATX; === / --- for Setext)
//      via Decoration.replace({}) ONLY when the cursor is not on the line
//      they sit on. This is the "show markers on caret line only" pattern.
//
// References:
//   - atomic-editor architecture docs (CM6 Obsidian-style live preview)
//   - silverbullet.md web/cm_plugins/ for per-line cursor-check pattern
//   - CM6 discuss.codemirror.net/t/concealing-syntax/3135 (use replace, not mark)

import { Decoration } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { decoratorStateField, isCursorInRange, invisibleDecoration } from './util.js';

const headingLineDeco = [
    null,
    Decoration.line({ class: 'cm-md-heading-line cm-md-heading-1' }),
    Decoration.line({ class: 'cm-md-heading-line cm-md-heading-2' }),
    Decoration.line({ class: 'cm-md-heading-line cm-md-heading-3' }),
    Decoration.line({ class: 'cm-md-heading-line cm-md-heading-4' }),
    Decoration.line({ class: 'cm-md-heading-line cm-md-heading-5' }),
    Decoration.line({ class: 'cm-md-heading-line cm-md-heading-6' }),
];

function atxLevel(name) {
    if (!name.startsWith('ATXHeading')) return 0;
    const n = parseInt(name.slice(10), 10);
    return Number.isFinite(n) ? n : 0;
}
function setextLevel(name) {
    if (name === 'SetextHeading1') return 1;
    if (name === 'SetextHeading2') return 2;
    return 0;
}

export const headingField = decoratorStateField((state) => {
    // Close the async-parse-gap: on file load syntaxTree(state) may return
    // a stub tree until parse completes. ensureSyntaxTree forces synchronous
    // parse up to doc.length with a 200ms budget so first render is correct.
    ensureSyntaxTree(state, state.doc.length, 200);

    const items = [];
    const tree = syntaxTree(state);

    tree.iterate({
        enter(node) {
            const atx = atxLevel(node.name);
            const sx = atx > 0 ? 0 : setextLevel(node.name);
            const level = atx > 0 ? atx : sx;
            if (level === 0) return;

            // Line decoration on the TITLE line only.
            // For ATX (`# Title`) the node spans one line, so this is the
            // only line. For Setext (`Title\n=====`) the node spans two
            // lines; decorating both gave the empty marker line the heading
            // class and therefore a second border-bottom, producing a
            // visible double underline. Restricting to node.from's line
            // leaves the marker line as a plain cm-line: invisibleDecoration
            // below still hides the `=====` text when the cursor isn't on
            // it, but no heading styling (font-size, border) bleeds onto it.
            const titleLine = state.doc.lineAt(node.from);
            items.push({
                from: titleLine.from,
                to: titleLine.from,
                deco: headingLineDeco[level],
                block: true,
            });

            // Walk HeaderMark children; hide each on lines without the cursor.
            node.node.cursor().iterate((child) => {
                if (child.name !== 'HeaderMark') return;
                const line = state.doc.lineAt(child.from);
                const cursorOnLine = isCursorInRange(state, [line.from, line.to]);
                if (cursorOnLine) return;
                // Include the trailing space (if any) in the hide range so
                // the rendered line doesn't have a stray leading space.
                let to = child.to;
                if (state.doc.sliceString(to, to + 1) === ' ') to += 1;
                items.push({
                    from: child.from,
                    to: to,
                    deco: invisibleDecoration,
                });
            });
        },
    });

    items.sort((a, b) => {
        if (a.from !== b.from) return a.from - b.from;
        if (a.to !== b.to) return a.to - b.to;
        return (b.block ? 1 : 0) - (a.block ? 1 : 0);
    });
    const builder = new RangeSetBuilder();
    for (const it of items) builder.add(it.from, it.to, it.deco);
    return builder.finish();
});
