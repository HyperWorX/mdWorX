// Task checkbox decorator.
//
// Replaces `[ ]` / `[x]` with a clickable <input type="checkbox">. Clicking
// the checkbox dispatches a transaction that toggles the marker in source.
//
// Adapted from silverbullet.md `web/cm_plugins/task.ts` (MIT). silverbullet
// uses a custom ButtonWidget; we use a real checkbox input for native
// accessibility.

import { Decoration, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { decoratorStateField, isCursorInRange } from './util.js';

class TaskCheckboxWidget extends WidgetType {
    constructor(checked, from, to) {
        super();
        this.checked = checked;
        this.from = from;
        this.to = to;
    }
    eq(other) {
        return other.checked === this.checked &&
               other.from    === this.from &&
               other.to      === this.to;
    }
    // CM6 passes the EditorView to toDOM; we use it to dispatch the
    // toggle transaction without needing a captured reference.
    toDOM(view) {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = this.checked;
        cb.className = 'cm-md-task-checkbox';
        cb.addEventListener('mousedown', (e) => {
            // mousedown so CM doesn't move the caret first (which would
            // re-render the marker as raw text via cursor-in-range).
            e.preventDefault();
            const next = this.checked ? '[ ]' : '[x]';
            view.dispatch({
                changes: { from: this.from, to: this.to, insert: next },
                userEvent: 'input.toggleTask',
            });
        });
        return cb;
    }
    ignoreEvent() { return false; }
}

export const taskField = decoratorStateField((state) => {
    const items = [];
    const tree = syntaxTree(state);
    tree.iterate({
        enter(node) {
            if (node.name !== 'TaskMarker') return;
            // Marker text is "[ ]" or "[x]" (or "[X]"). Three chars.
            const lineFrom = state.doc.lineAt(node.from).from;
            const lineTo   = state.doc.lineAt(node.from).to;
            if (isCursorInRange(state, [lineFrom, lineTo])) return;
            const text = state.doc.sliceString(node.from, node.to);
            const checked = /\[[xX]\]/.test(text);
            // We can't pass `view` into a StateField easily; the widget
            // grabs it from the dispatch context via EditorView at toDOM
            // time. Use the view passed through editor.js's facet.
            items.push({
                from: node.from,
                to: node.to,
                deco: Decoration.replace({
                    widget: new TaskCheckboxWidget(checked, node.from, node.to, null),
                }),
            });
        },
    });
    items.sort((a, b) => (a.from - b.from) || (a.to - b.to));
    const builder = new RangeSetBuilder();
    for (const it of items) builder.add(it.from, it.to, it.deco);
    return builder.finish();
});
