// Table decorator.
//
// Replaces GFM tables with a rendered <table> widget when the caret is
// outside the node. Cell content is run through renderInlineMarkdown
// (util.js) so bold / italic / links / code inside cells render with the
// same engine Reading mode uses.
//
// Adapted from silverbullet.md `web/cm_plugins/table.ts` (MIT). Their
// renderMarkdownToHtml is replaced with our markdown-it-based helper.

import { Decoration, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { decoratorStateField, isCursorInRange, renderInlineMarkdown } from './util.js';

// Parse a GFM table source block into header row, alignment hints, and
// body rows. Returns null if the source doesn't look like a valid table.
function parseTableSource(src) {
    const lines = src.split('\n').filter(l => l.trim().length > 0);
    if (lines.length < 2) return null;

    const split = (row) => {
        // Strip leading/trailing pipe, then split on unescaped pipes.
        let r = row.trim();
        if (r.startsWith('|')) r = r.slice(1);
        if (r.endsWith('|'))   r = r.slice(0, -1);
        // Simple split — escaped pipes (\|) are uncommon in plain markdown
        // and not handled here; fall through to "looks broken, skip" if
        // they cause issues.
        return r.split('|').map(c => c.trim());
    };

    const header = split(lines[0]);
    const sep    = split(lines[1]);
    if (sep.length !== header.length) return null;
    // Each separator cell must look like :---: / --- / :--- / ---:
    const aligns = sep.map(cell => {
        const left  = cell.startsWith(':');
        const right = cell.endsWith(':');
        if (left && right) return 'center';
        if (right)         return 'right';
        return 'left';
    });
    if (!sep.every(cell => /^:?-{3,}:?$/.test(cell))) return null;

    const body = lines.slice(2).map(split);
    return { header, aligns, body };
}

class TableWidget extends WidgetType {
    constructor(parsed) {
        super();
        this.parsed = parsed;
        // Cheap content hash for eq() — JSON stringify keeps it simple.
        this.key = JSON.stringify(parsed);
    }
    eq(other) { return other.key === this.key; }
    toDOM() {
        // Wrap the table in an overflow-x:auto div so the widget's measured
        // height matches the actual layout height. Putting overflow on the
        // <table> itself (or using display:block) breaks table-row layout
        // and confuses CodeMirror's height calculation, causing cursor
        // clicks below the widget to land on the wrong line.
        const wrap = document.createElement('div');
        wrap.className = 'cm-md-table-wrap';

        const t = document.createElement('table');
        t.className = 'cm-md-table';
        const thead = document.createElement('thead');
        const trh = document.createElement('tr');
        this.parsed.header.forEach((cell, i) => {
            const th = document.createElement('th');
            th.style.textAlign = this.parsed.aligns[i] || 'left';
            th.innerHTML = renderInlineMarkdown(cell);
            trh.appendChild(th);
        });
        thead.appendChild(trh);
        t.appendChild(thead);
        const tbody = document.createElement('tbody');
        for (const row of this.parsed.body) {
            const tr = document.createElement('tr');
            for (let i = 0; i < this.parsed.header.length; ++i) {
                const td = document.createElement('td');
                td.style.textAlign = this.parsed.aligns[i] || 'left';
                td.innerHTML = renderInlineMarkdown(row[i] || '');
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
        t.appendChild(tbody);
        wrap.appendChild(t);
        return wrap;
    }
}

export const tableField = decoratorStateField((state) => {
    const items = [];
    const tree = syntaxTree(state);
    tree.iterate({
        enter(node) {
            if (node.name !== 'Table') return;
            if (isCursorInRange(state, [node.from, node.to])) return;
            const src = state.doc.sliceString(node.from, node.to);
            const parsed = parseTableSource(src);
            if (!parsed) return;   // malformed — let raw source show
            items.push({
                from: node.from,
                to: node.to,
                deco: Decoration.replace({
                    block: true,
                    widget: new TableWidget(parsed),
                }),
            });
        },
    });
    items.sort((a, b) => (a.from - b.from) || (a.to - b.to));
    const builder = new RangeSetBuilder();
    for (const it of items) builder.add(it.from, it.to, it.deco);
    return builder.finish();
});
