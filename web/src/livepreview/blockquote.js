// Blockquote decorator — block widget rendering real <blockquote> via markdown-it.
//
// Reverted from per-line decoration because:
//   1. Per-line decoration produced banded backgrounds (no single rounded box)
//   2. .cm-md-quote-line background was not visually matching Reading reliably
//   3. User explicitly wants Reading visual match
//
// Tradeoff: caret inside the blockquote reverts the WHOLE block to source
// (no Obsidian-style per-line cursor reveal). Acceptable per user priority.
//
// Nested blockquotes: only the outermost is widget-rendered. Inner sources
// are part of the outer widget's HTML.

import { Decoration, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { decoratorStateField, isCursorInRange } from './util.js';
import { renderBlock, wireExternalLinks } from '../lib/markdown-it-shared.js';

class BlockquoteWidget extends WidgetType {
    constructor(source) {
        super();
        this.source = source;
    }
    eq(other) { return other.source === this.source; }
    toDOM() {
        const wrap = document.createElement('div');
        wrap.className = 'cm-md-rendered-block cm-md-rendered-blockquote';
        // Trailing newlines: markdown-it requires them for block-level
        // recognition (per the original Path B rewrite).
        const src = this.source.endsWith('\n') ? this.source : this.source + '\n\n';
        wrap.innerHTML = renderBlock(src);
        wireExternalLinks(wrap);
        return wrap;
    }
    ignoreEvent() { return false; }
}

function hasBlockquoteAncestor(node) {
    let p = node.node ? node.node.parent : (node.parent && node.parent());
    while (p) {
        if (p.name === 'Blockquote') return true;
        p = p.parent;
    }
    return false;
}

export const blockquoteField = decoratorStateField((state) => {
    ensureSyntaxTree(state, state.doc.length, 200);

    const items = [];
    const tree = syntaxTree(state);

    tree.iterate({
        enter(node) {
            if (node.name !== 'Blockquote') return;
            if (hasBlockquoteAncestor(node)) return;
            if (isCursorInRange(state, [node.from, node.to])) return;
            const source = state.doc.sliceString(node.from, node.to);
            items.push({
                from: node.from,
                to: node.to,
                deco: Decoration.replace({
                    block: true,
                    widget: new BlockquoteWidget(source),
                }),
            });
        },
    });
    items.sort((a, b) => (a.from - b.from) || (a.to - b.to));
    const builder = new RangeSetBuilder();
    for (const it of items) builder.add(it.from, it.to, it.deco);
    return builder.finish();
});
