// Highlight (==text==) decorator.
//
// markdown-it-mark renders <mark> in Reading. Lezer-markdown does not have a
// native ==highlight== grammar in its extended set (the markdownLanguage base
// gives us GFM + Subscript + Superscript + Emoji, but not Highlight). This
// decorator regex-matches each line of the document. When the caret is outside
// a match, the inner text gets a cm-md-highlight mark and the `==` markers are
// hidden via invisibleDecoration. Multi-cursor safe via isCursorInRange.
//
// The regex uses lookahead/lookbehind to avoid matching `===` (Setext heading
// underline) or runs of equals.

import { Decoration } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { decoratorStateField, isCursorInRange, invisibleDecoration } from './util.js';

const highlightMark = Decoration.mark({ class: 'cm-md-highlight' });
const highlightRE = /(?<!=)==([^=\n]+?)==(?!=)/g;

export const highlightField = decoratorStateField((state) => {
    const items = [];
    const doc = state.doc;
    for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        let m;
        highlightRE.lastIndex = 0;
        while ((m = highlightRE.exec(line.text)) !== null) {
            const fullFrom  = line.from + m.index;
            const fullTo    = fullFrom + m[0].length;
            const innerFrom = fullFrom + 2;
            const innerTo   = fullTo - 2;
            if (isCursorInRange(state, [fullFrom, fullTo])) {
                // Cursor on range: keep raw == visible, but style inner text.
                items.push({ from: innerFrom, to: innerTo, deco: highlightMark });
            } else {
                items.push({ from: fullFrom,  to: innerFrom, deco: invisibleDecoration });
                items.push({ from: innerFrom, to: innerTo,   deco: highlightMark });
                items.push({ from: innerTo,   to: fullTo,    deco: invisibleDecoration });
            }
        }
    }
    items.sort((a, b) => (a.from - b.from) || (a.to - b.to));
    const builder = new RangeSetBuilder();
    for (const it of items) builder.add(it.from, it.to, it.deco);
    return builder.finish();
});
