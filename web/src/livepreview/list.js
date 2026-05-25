// List decorator — per-ListItem per-line decoration (Obsidian / atomic-editor pattern).
//
// Strategy:
//   1. For each ListItem, apply Decoration.line .cm-md-list-item .cm-md-list-item-L<depth>
//      to each line of the item for indent.
//   2. ListMark handling per type:
//      - Bullet + task: hide line.from..ListMark.to(+space) via invisibleDecoration.
//      - Bullet + plain: hide line.from..ListMark.to(+space), replace with
//        BulletWidget (• for L0, ◦ for L1, ▪ for L2, ▫ for L3+ — matches
//        browser default <ul> rendering and Obsidian).
//      - Ordered: hide leading whitespace, mark "1." with .cm-md-list-number.

import { Decoration, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { decoratorStateField, isCursorInRange, invisibleDecoration } from './util.js';

const BULLET_GLYPHS = ['•', '◦', '▪', '▫'];

class BulletWidget extends WidgetType {
    constructor(depth) {
        super();
        this.depth = depth;
        this.glyph = BULLET_GLYPHS[Math.min(depth, BULLET_GLYPHS.length - 1)];
    }
    eq(other) { return other.depth === this.depth; }
    toDOM() {
        const s = document.createElement('span');
        s.className = 'cm-md-bullet';
        s.textContent = this.glyph;
        return s;
    }
    ignoreEvent() { return true; }
}
const bulletDecoCache = new Map();
function bulletDecoForDepth(depth) {
    const d = Math.min(depth, BULLET_GLYPHS.length - 1);
    let deco = bulletDecoCache.get(d);
    if (!deco) {
        deco = Decoration.replace({ widget: new BulletWidget(d) });
        bulletDecoCache.set(d, deco);
    }
    return deco;
}

const listNumberMark = Decoration.mark({ class: 'cm-md-list-number' });

// Marks the leading whitespace ("  " under a bullet, "    " under a nested
// item) on each continuation line so CSS can conditionally hide it. When the
// user enables the "Collapse soft line breaks" setting, viewer.css uses the
// body.collapse-soft-breaks class to set display: none on this span so the
// continuation text flows visually under the bullet line instead of showing
// a literal source indent. The source bytes are unchanged - only the visual
// rendering hides.
const contIndentMark = Decoration.mark({ class: 'cm-md-cont-indent' });

// CRITICAL: walk the underlying SyntaxNode's parent chain, not the
// SyntaxNodeRef's. SyntaxNodeRef (passed to tree.iterate's enter callback)
// does NOT expose .parent — accessing it returns undefined and the loop
// terminates immediately, returning depth 0 for EVERY ListItem including
// nested ones. Use itemNode.parent (where itemNode = nodeRef.node).
function listDepth(itemNode) {
    let depth = -1;
    let p = itemNode.parent;
    while (p) {
        if (p.name === 'BulletList' || p.name === 'OrderedList') depth += 1;
        p = p.parent;
    }
    return Math.max(0, depth);
}

function isInBulletList(itemNode) {
    let p = itemNode.parent;
    while (p) {
        if (p.name === 'BulletList') return true;
        if (p.name === 'OrderedList') return false;
        p = p.parent;
    }
    return false;
}

function hasTaskMarker(itemNode) {
    let found = false;
    itemNode.cursor().iterate((child) => {
        if (child.name === 'TaskMarker') {
            found = true;
            return false;
        }
    });
    return found;
}

const lineDecoCache = new Map();
function lineDecoFor(depth, isCont) {
    const d = Math.min(depth, 3);
    const key = `${d}-${isCont ? 'cont' : 'first'}`;
    let deco = lineDecoCache.get(key);
    if (!deco) {
        const cls = isCont
            ? `cm-md-list-item cm-md-list-item-cont cm-md-list-item-L${d}`
            : `cm-md-list-item cm-md-list-item-L${d}`;
        deco = Decoration.line({ class: cls });
        lineDecoCache.set(key, deco);
    }
    return deco;
}

export const listField = decoratorStateField((state) => {
    ensureSyntaxTree(state, state.doc.length, 200);

    const items = [];
    const tree = syntaxTree(state);

    tree.iterate({
        enter(node) {
            if (node.name !== 'ListItem') return;
            const itemNode = node.node;
            const depth    = listDepth(itemNode);
            const inBullet = isInBulletList(itemNode);
            const isTask   = inBullet && hasTaskMarker(itemNode);

            // Per-line line decoration for indent. Track whether each line
            // is the FIRST line of the ListItem (containing the marker) or a
            // CONTINUATION line (markdown's lazy-continuation, where bullet
            // text wraps across source lines indented to align under the
            // first line's text). Continuation lines get class
            // .cm-md-list-item-cont so CSS can apply hanging-indent rules
            // and additionally a mark decoration on their leading whitespace
            // so CSS can hide it when the "Collapse soft line breaks"
            // setting is on.
            let pos = node.from;
            let isFirstLine = true;
            while (pos <= node.to) {
                const line = state.doc.lineAt(pos);
                items.push({
                    from: line.from,
                    to: line.from,
                    deco: lineDecoFor(depth, !isFirstLine),
                    block: true,
                });
                if (!isFirstLine) {
                    // Find the first non-whitespace char on this continuation
                    // line - that's where the visible text starts. Mark the
                    // span from line.from to that position so CSS can hide it
                    // (display: none) when collapse-soft-breaks is enabled.
                    const lineText = state.doc.sliceString(line.from, line.to);
                    const indentLen = lineText.length - lineText.replace(/^\s+/, '').length;
                    if (indentLen > 0) {
                        items.push({
                            from: line.from,
                            to: line.from + indentLen,
                            deco: contIndentMark,
                        });
                    }
                }
                isFirstLine = false;
                if (line.to >= node.to) break;
                pos = line.to + 1;
            }

            // ListMark walk: only direct children of THIS ListItem.
            itemNode.cursor().iterate((child) => {
                if (child.name !== 'ListMark') return;
                if (child.node.parent && child.node.parent.from !== itemNode.from) return;
                const line = state.doc.lineAt(child.from);

                if (!inBullet) {
                    if (child.from > line.from) {
                        items.push({
                            from: line.from,
                            to: child.from,
                            deco: invisibleDecoration,
                        });
                    }
                    items.push({
                        from: child.from,
                        to: child.to,
                        deco: listNumberMark,
                    });
                    return;
                }

                const cursorOnLine = isCursorInRange(state, [line.from, line.to]);
                if (cursorOnLine) return;
                let to = child.to;
                if (state.doc.sliceString(to, to + 1) === ' ') to += 1;
                items.push({
                    from: line.from,
                    to: to,
                    deco: isTask ? invisibleDecoration : bulletDecoForDepth(depth),
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
