// Emphasis, strong, strikethrough and inline-code decorator.
//
// Marks the visible content with cm-md-{bold,italic,strike,inline-code}
// classes (styled in viewer.css) and hides the surrounding marker tokens
// (** _ ~~ `) when the caret is outside the parent node.

import { Decoration } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { decoratorStateField, isCursorInRange, invisibleDecoration } from './util.js';

const boldMark   = Decoration.mark({ class: 'cm-md-bold' });
const italicMark = Decoration.mark({ class: 'cm-md-italic' });
const strikeMark = Decoration.mark({ class: 'cm-md-strike' });
const codeMark   = Decoration.mark({ class: 'cm-md-inline-code' });
const subMark    = Decoration.mark({ class: 'cm-md-subscript' });
const supMark    = Decoration.mark({ class: 'cm-md-superscript' });

export const emphasisField = decoratorStateField((state) => {
    const items = [];
    const tree = syntaxTree(state);
    tree.iterate({
        enter(node) {
            const name = node.name;

            if (name === 'StrongEmphasis')    { items.push({ from: node.from, to: node.to, deco: boldMark   }); return; }
            if (name === 'Emphasis')          { items.push({ from: node.from, to: node.to, deco: italicMark }); return; }
            if (name === 'Strikethrough')     { items.push({ from: node.from, to: node.to, deco: strikeMark }); return; }
            if (name === 'InlineCode')        { items.push({ from: node.from, to: node.to, deco: codeMark   }); return; }
            if (name === 'Subscript')         { items.push({ from: node.from, to: node.to, deco: subMark    }); return; }
            if (name === 'Superscript')       { items.push({ from: node.from, to: node.to, deco: supMark    }); return; }

            if (name === 'EmphasisMark'      ||
                name === 'StrikethroughMark' ||
                name === 'CodeMark'          ||
                name === 'SubscriptMark'     ||
                name === 'SuperscriptMark') {
                const p = node.node.parent;
                if (p && !isCursorInRange(state, [p.from, p.to])) {
                    items.push({ from: node.from, to: node.to, deco: invisibleDecoration });
                }
                return;
            }
        },
    });
    // RangeSetBuilder needs ascending starts. Ties: longer-range mark
    // decorations (the wrapper) come before shorter replace decorations
    // (the markers), which is what `from` ascending + `to` ascending gives
    // us naturally.
    items.sort((a, b) => (a.from - b.from) || (a.to - b.to));
    const builder = new RangeSetBuilder();
    for (const it of items) builder.add(it.from, it.to, it.deco);
    return builder.finish();
});
