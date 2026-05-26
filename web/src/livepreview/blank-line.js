// Blank-line height collapser.
//
// In markdown source, blank lines are paragraph / block separators. Reading
// mode collapses them into the surrounding elements' top / bottom margins so
// they contribute no visible row to the document. Live mode, by contrast,
// renders each blank source line as a real `.cm-line` div with the full
// editor line-height (~22px at the default 14px font size, 1.55 line-height).
// Every block widget (image, table, fenced code, blockquote, hr, footnote
// section) preceded by a blank source line therefore sits ~10-12px further
// down in Live than in Reading.
//
// Strategy: apply a per-line `.cm-md-blank-line` class to every fully-empty
// source line that the cursor is NOT currently on. viewer.css collapses its
// height. When the caret moves onto the blank line — e.g. the user clicks
// there to start typing — the decoration is omitted on that line so it
// expands back to full height and is editable normally.
//
// Implementation note: only LITERALLY empty lines (line.text.length === 0)
// are collapsed. Whitespace-only lines (e.g. trailing-space "hard break"
// lines, or inside code/blockquote where leading whitespace is meaningful)
// keep their full height to avoid surprising the user.

import { Decoration } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { decoratorStateField, isCursorInRange } from './util.js';

const blankLineDeco = Decoration.line({ class: 'cm-md-blank-line' });

export const blankLineField = decoratorStateField((state) => {
    const items = [];
    const lineCount = state.doc.lines;
    for (let i = 1; i <= lineCount; i++) {
        const line = state.doc.line(i);
        if (line.text.length !== 0) continue;
        if (isCursorInRange(state, [line.from, line.to])) continue;
        items.push({ from: line.from, to: line.from, deco: blankLineDeco });
    }
    const builder = new RangeSetBuilder();
    for (const it of items) builder.add(it.from, it.to, it.deco);
    return builder.finish();
});
