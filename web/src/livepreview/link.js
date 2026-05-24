// Link decorator.
//
// When the caret is OUT of a Link node ([text](url)), the whole node is
// replaced by a LinkWidget showing only the label text styled as a link.
// Clicking the widget posts {type:'openExternal', url} so the native side
// can shell out to the OS default browser.
//
// When the caret is IN the node, raw source is visible; the label range
// gets cm-md-link styling so it still reads as a link visually.
//
// Adapted from silverbullet.md `web/cm_plugins/link.ts` (MIT) with the
// silverbullet ClickEvent / Client glue replaced by a direct postMessage.

import { Decoration } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { decoratorStateField, isCursorInRange, invisibleDecoration, LinkWidget } from './util.js';

const linkLabelMark = Decoration.mark({ class: 'cm-md-link' });

function postExternal(url) {
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(JSON.stringify({ type: 'openExternal', url }));
    }
}

export const linkField = decoratorStateField((state) => {
    const items = [];
    const tree = syntaxTree(state);
    tree.iterate({
        enter(node) {
            if (node.name !== 'Link') return;
            // Skip if this is actually an Image (lezer-markdown nests
            // Image under Link in some grammars). Image plugin handles it.
            if (node.node.parent && node.node.parent.name === 'Image') return;
            // Skip footnote-ref shaped Links: [^id]. Lezer-markdown has
            // no footnote grammar so [^why] should NOT be a Link node,
            // but be defensive in case it ever is (would cause empty
            // LinkWidget to replace the footnote ref, hiding it). Pattern:
            // bracketed text starting with ^ and not followed by (url).
            const linkText = state.doc.sliceString(node.from, node.to);
            if (/^\[\^[^\]]+\](?!\()/.test(linkText)) return;

            const linkFrom = node.from;
            const linkTo   = node.to;
            const cursorIn = isCursorInRange(state, [linkFrom, linkTo]);

            // Extract label + URL by walking children.
            let labelFrom = -1, labelTo = -1, urlText = '';
            const cursor = node.node.cursor();
            if (cursor.firstChild()) {
                do {
                    const cn = cursor.name;
                    if (cn === 'LinkMark') continue;
                    if (cn === 'URL') {
                        urlText = state.doc.sliceString(cursor.from, cursor.to);
                    } else if (labelFrom === -1) {
                        labelFrom = cursor.from;
                        labelTo = cursor.to;
                    } else {
                        labelTo = cursor.to;
                    }
                } while (cursor.nextSibling());
            }
            // Fallback: if no children walked (rare), regex-extract.
            if (labelFrom === -1) {
                const text = state.doc.sliceString(linkFrom, linkTo);
                const m = text.match(/^\[([^\]]*)\]\(([^)]*)\)/);
                if (m) {
                    labelFrom = linkFrom + 1;
                    labelTo = linkFrom + 1 + m[1].length;
                    urlText = m[2];
                }
            }

            if (cursorIn) {
                // Style the label so the user can still see it as a link.
                if (labelFrom >= 0) {
                    items.push({ from: labelFrom, to: labelTo, deco: linkLabelMark });
                }
            } else {
                // Replace entire [text](url) with a widget rendering the label.
                const label = labelFrom >= 0
                    ? state.doc.sliceString(labelFrom, labelTo)
                    : urlText;
                const widget = Decoration.replace({
                    widget: new LinkWidget(urlText, label, postExternal),
                });
                items.push({ from: linkFrom, to: linkTo, deco: widget });
            }
        },
    });
    items.sort((a, b) => (a.from - b.from) || (a.to - b.to));
    const builder = new RangeSetBuilder();
    for (const it of items) builder.add(it.from, it.to, it.deco);
    return builder.finish();
});

// Re-export for the URL marker hiding inside our composer if needed later.
export { invisibleDecoration };
