// Inline image decorator.
//
// Replaces ![alt](url) with an <img> widget when the caret is outside the
// node. URL rewriting goes through lib/local-url.js so relative paths
// resolve via the same local.mdworx.test virtual host Reading mode uses.
//
// Adapted from silverbullet.md `web/cm_plugins/inline_image.ts` (MIT).

import { Decoration, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { decoratorStateField, isCursorInRange } from './util.js';
import { rewriteImageUrl } from '../lib/local-url.js';
import { parseImageAlt, applyImageAttrs } from '../lib/image-alt.js';

class InlineImageWidget extends WidgetType {
    constructor(src, alt, attrs) {
        super();
        this.src = src;
        this.alt = alt || '';
        // attrs is the parsed {width,height,alignment} bag from
        // image-alt.js; cached on the widget so eq() can compare and
        // toDOM() can apply without re-parsing.
        this.attrs = attrs || { width: null, height: null, alignment: 'none' };
    }
    eq(other) {
        return other.src === this.src &&
               other.alt === this.alt &&
               other.attrs.width  === this.attrs.width &&
               other.attrs.height === this.attrs.height &&
               other.attrs.alignment === this.attrs.alignment;
    }
    toDOM() {
        const wrap = document.createElement('span');
        wrap.className = 'cm-md-inline-image';
        if (!this.src) {
            // Unsupported scheme — show a placeholder rather than a
            // broken image.
            const p = document.createElement('span');
            p.className = 'cm-md-image-placeholder';
            p.textContent = this.alt || '[image]';
            wrap.appendChild(p);
            return wrap;
        }
        const img = document.createElement('img');
        img.src = this.src;
        if (this.alt) img.alt = this.alt;
        img.loading = 'lazy';
        img.decoding = 'async';
        applyImageAttrs(img, this.attrs);
        wrap.appendChild(img);
        return wrap;
    }
}

export const imageField = decoratorStateField((state) => {
    const items = [];
    const tree = syntaxTree(state);
    tree.iterate({
        enter(node) {
            if (node.name !== 'Image') return;
            const imgFrom = node.from;
            const imgTo   = node.to;
            if (isCursorInRange(state, [imgFrom, imgTo])) return;

            // Extract alt + url. The node text is `![alt](url)` — parsing
            // by regex is more robust than walking children because the
            // lezer-markdown Image grammar nests differently across
            // versions.
            const text = state.doc.sliceString(imgFrom, imgTo);
            const m = text.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
            if (!m) return;
            const rawAlt = m[1];
            const rawSrc = m[2];
            const parsed = parseImageAlt(rawAlt);
            const rewritten = rewriteImageUrl(rawSrc);
            const widget = new InlineImageWidget(rewritten.src, parsed.alt, parsed);
            items.push({
                from: imgFrom,
                to: imgTo,
                deco: Decoration.replace({ widget }),
            });
        },
    });
    items.sort((a, b) => (a.from - b.from) || (a.to - b.to));
    const builder = new RangeSetBuilder();
    for (const it of items) builder.add(it.from, it.to, it.deco);
    return builder.finish();
});
