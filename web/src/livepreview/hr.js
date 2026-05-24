// Horizontal rule decorator — replaces `---` / `***` / `___` lines with
// a real <hr> widget so Reading-mode styling (line 859-864 in viewer.css)
// applies natively. When the caret is on the HR line, the source markers
// stay visible for editing.

import { Decoration, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { decoratorStateField, isCursorInRange } from './util.js';

class HRWidget extends WidgetType {
    eq() { return true; }
    toDOM() {
        const wrap = document.createElement('div');
        wrap.className = 'cm-md-rendered-block cm-md-rendered-hr';
        const hr = document.createElement('hr');
        wrap.appendChild(hr);
        return wrap;
    }
    ignoreEvent() { return false; }
}
const hrDeco = Decoration.replace({ block: true, widget: new HRWidget() });

export const hrField = decoratorStateField((state) => {
    ensureSyntaxTree(state, state.doc.length, 200);

    const items = [];
    const tree = syntaxTree(state);

    tree.iterate({
        enter(node) {
            if (node.name !== 'HorizontalRule') return;
            if (isCursorInRange(state, [node.from, node.to])) return;
            items.push({ from: node.from, to: node.to, deco: hrDeco });
        },
    });

    items.sort((a, b) => (a.from - b.from) || (a.to - b.to));
    const builder = new RangeSetBuilder();
    for (const it of items) builder.add(it.from, it.to, it.deco);
    return builder.finish();
});
