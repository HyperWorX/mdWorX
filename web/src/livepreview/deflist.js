// Definition-list decorator (regex-based — lezer-markdown has no grammar).
//
// Pandoc/markdown-it-deflist syntax:
//   term
//   : description
//
// A line beginning with `: ` is a definition. The non-blank line directly
// above (with no `: ` prefix) is the term. Both get line decorations to
// match Reading's <dl><dt><dd> visual via the .cm-md-deflist-* CSS classes.
// The leading `: ` of the description line is hidden when the caret is
// off-line so the rendered view looks like an indented description.

import { Decoration } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { decoratorStateField, isCursorInRange, invisibleDecoration } from './util.js';

const termDeco = Decoration.line({ class: 'cm-md-deflist-term' });
const descDeco = Decoration.line({ class: 'cm-md-deflist-desc' });

export const deflistField = decoratorStateField((state) => {
    const items = [];
    const doc = state.doc;

    for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        const text = line.text;
        const m = text.match(/^(\s*):(\s)(.*)$/);
        if (!m) continue;

        // Mark this line as description.
        items.push({
            from: line.from,
            to: line.from,
            deco: descDeco,
            block: true,
        });

        // Hide the leading ":<space>" when the caret is elsewhere.
        const colonStart = line.from + m[1].length;
        const colonEnd = colonStart + 2;
        const cursorOnLine = isCursorInRange(state, [line.from, line.to]);
        if (!cursorOnLine) {
            items.push({
                from: colonStart,
                to: colonEnd,
                deco: invisibleDecoration,
            });
        }

        // Mark the immediately-preceding non-blank line as the term, unless
        // it's also a definition line (consecutive descriptions for the same
        // term — keep the term mark from the first one only).
        if (i > 1) {
            const prev = doc.line(i - 1);
            const ptext = prev.text;
            if (ptext.trim() !== '' && !/^\s*:\s/.test(ptext)) {
                items.push({
                    from: prev.from,
                    to: prev.from,
                    deco: termDeco,
                    block: true,
                });
            }
        }
    }

    items.sort((a, b) => {
        if (a.from !== b.from) return a.from - b.from;
        if (a.to !== b.to) return a.to - b.to;
        return (b.block ? 1 : 0) - (a.block ? 1 : 0);
    });
    const builder = new RangeSetBuilder();
    for (const it of items) builder.add(it.from, it.to, it.deco);
    return builder.finish();
});
