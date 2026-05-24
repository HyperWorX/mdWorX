// Editor toolbar commands.
//
// Each command takes an EditorView and dispatches a transaction. They
// fall into three families:
//
//   wrapSelection(view, before, after = before)
//     Inline emphasis/strong/strike/inline-code. Wraps each selection
//     range with the prefix and suffix. Empty selection inserts both
//     and parks the caret between them.
//
//   toggleLinePrefix(view, prefix)
//     Headings, blockquote, lists. Adds the prefix to the start of every
//     line touched by any selection range. If every line already starts
//     with the prefix, removes it (toggle off).
//
//   numberedList(view) / bulletedList(view)
//     Add / remove "1. " / "- " line prefixes; numbered list re-numbers
//     consecutive lines.
//
//   insertLink(view, label?, url?)
//     Inserts [text](url). If selection is non-empty, uses it as the link
//     label. URL is prompted if not provided.

import { EditorSelection } from '@codemirror/state';

export function wrapSelection(view, before, after = before) {
    const { state } = view;
    const changes = [];
    const newRanges = [];
    for (const range of state.selection.ranges) {
        const slice = state.doc.sliceString(range.from, range.to);
        const replacement = before + slice + after;
        changes.push({ from: range.from, to: range.to, insert: replacement });
        // Park caret between the markers when selection is empty,
        // otherwise select the wrapped text.
        if (slice.length === 0) {
            const pos = range.from + before.length;
            newRanges.push(EditorSelection.cursor(pos));
        } else {
            newRanges.push(EditorSelection.range(
                range.from + before.length,
                range.from + before.length + slice.length,
            ));
        }
    }
    view.dispatch({
        changes,
        selection: EditorSelection.create(newRanges),
        userEvent: 'input.wrap',
    });
    view.focus();
}

function lineRangeForSelection(state) {
    // Returns sorted unique [fromLine, toLine] pairs as line objects.
    const lines = new Set();
    for (const r of state.selection.ranges) {
        const a = state.doc.lineAt(r.from).number;
        const b = state.doc.lineAt(r.to).number;
        for (let n = a; n <= b; ++n) lines.add(n);
    }
    return Array.from(lines).sort((a, b) => a - b).map(n => state.doc.line(n));
}

export function toggleLinePrefix(view, prefix) {
    const { state } = view;
    const lines = lineRangeForSelection(state);
    if (lines.length === 0) return;
    const allHave = lines.every(l => l.text.startsWith(prefix));
    const changes = lines.map(l => allHave
        ? { from: l.from, to: l.from + prefix.length, insert: '' }
        : { from: l.from, to: l.from, insert: prefix });
    view.dispatch({ changes, userEvent: allHave ? 'delete.prefix' : 'input.prefix' });
    view.focus();
}

export function bulletedList(view) { toggleLinePrefix(view, '- '); }

// Numbered list: assigns 1. 2. 3. to consecutive lines covered by the
// selection. If every line already starts with "<number>. ", removes the
// prefix instead.
export function numberedList(view) {
    const { state } = view;
    const lines = lineRangeForSelection(state);
    if (lines.length === 0) return;
    const numRE = /^(\d+)\.\s/;
    const allNumbered = lines.every(l => numRE.test(l.text));
    let changes;
    if (allNumbered) {
        changes = lines.map(l => {
            const m = l.text.match(numRE);
            return { from: l.from, to: l.from + m[0].length, insert: '' };
        });
    } else {
        changes = lines.map((l, i) => ({
            from: l.from, to: l.from, insert: (i + 1) + '. ',
        }));
    }
    view.dispatch({ changes, userEvent: 'input.list' });
    view.focus();
}

export function insertLink(view) {
    const { state } = view;
    const r = state.selection.main;
    const sel = state.doc.sliceString(r.from, r.to);
    const url = window.prompt('Link URL', sel.startsWith('http') ? sel : 'https://');
    if (!url) return;
    const label = sel || 'link text';
    const replacement = '[' + label + '](' + url + ')';
    view.dispatch({
        changes: { from: r.from, to: r.to, insert: replacement },
        selection: EditorSelection.create([
            EditorSelection.range(r.from + 1, r.from + 1 + label.length),
        ]),
        userEvent: 'input.link',
    });
    view.focus();
}

// Insert a new footnote: inserts [^N] at the cursor in body and appends
// [^N]: <space> at the END of the document. N is auto-chosen as the next
// available numeric id. Cursor stays in BODY immediately after the new ref
// so subsequent button clicks don't insert into the previous def's body
// (which was the bug causing duplicate/contaminated footnote entries).
//
// To edit the description, click the corresponding entry in the
// footnotes section at the bottom — it jumps the cursor to the def's
// body for typing.
export function insertFootnote(view) {
    const { state } = view;
    const docText = state.doc.toString();

    // Find next free numeric id.
    const idRE = /\[\^([^\]]+)\]/g;
    const used = new Set();
    let m;
    while ((m = idRE.exec(docText)) !== null) used.add(m[1]);
    let next = 1;
    while (used.has(String(next))) next += 1;
    const id = String(next);

    const r = state.selection.main;

    // SAFETY: refuse to insert when cursor is on a def line or its
    // continuation. Otherwise we'd inject the new ref INTO the previous
    // def's body and create a malformed [^N]: [^M] mess.
    const cursorLine = state.doc.lineAt(r.head);
    const onDefLine = /^\[\^[^\]]+\]:/.test(cursorLine.text);
    const onDefContinuation = /^ {4}/.test(cursorLine.text);
    if (onDefLine || onDefContinuation) {
        // Try to find a safe body insertion point: the end of the line
        // before any def block. Fallback: just append a placeholder note.
        let safeFrom = -1;
        for (let n = cursorLine.number - 1; n >= 1; n--) {
            const line = state.doc.line(n);
            const txt = line.text;
            if (txt.trim() === '') continue;
            if (/^\[\^[^\]]+\]:/.test(txt)) continue;
            if (/^ {4}/.test(txt)) continue;
            safeFrom = line.to;
            break;
        }
        if (safeFrom === -1) {
            // No safe spot — bail out silently (don't corrupt source).
            view.focus();
            return;
        }
        const refText = `[^${id}]`;
        const defText = `\n\n[^${id}]: `;
        const docLen = state.doc.length;
        view.dispatch({
            changes: [
                { from: safeFrom, to: safeFrom, insert: refText },
                { from: docLen, to: docLen, insert: defText },
            ],
            selection: EditorSelection.cursor(safeFrom + refText.length),
            scrollIntoView: true,
            userEvent: 'input.footnote',
        });
        view.focus();
        return;
    }

    // Normal path: cursor is in body. Insert ref at cursor, def at end,
    // and JUMP cursor to the NEW def's body position so the user can type
    // the description directly. The previous "keep cursor in body" approach
    // made users type the description into body prose by mistake.
    //
    // Safety against double-click contamination: if user clicks button
    // again without moving cursor, the onDefLine check at top of this
    // function catches it and re-routes to a safe body position.
    const refText = `[^${id}]`;
    const defText = `\n\n[^${id}]: `;
    const docLen = state.doc.length;
    // Where the new def's BODY starts (after refText insert shifts everything,
    // after defText insert at original docLen, after the def's prefix length):
    //   newDocLen = docLen + refText.length + defText.length
    //   bodyStart = newDocLen (since defText ends with the space; cursor
    //              there is at the body position, ready to type).
    const bodyStartAfter = docLen + refText.length + defText.length;
    view.dispatch({
        changes: [
            { from: r.from, to: r.to, insert: refText },
            { from: docLen, to: docLen, insert: defText },
        ],
        selection: EditorSelection.cursor(bodyStartAfter),
        scrollIntoView: true,
        userEvent: 'input.footnote',
    });
    view.focus();
}

// Convenience map for toolbar wiring.
export const COMMANDS = {
    bold:        v => wrapSelection(v, '**'),
    italic:      v => wrapSelection(v, '*'),
    strike:      v => wrapSelection(v, '~~'),
    inlineCode:  v => wrapSelection(v, '`'),
    heading1:    v => toggleLinePrefix(v, '# '),
    heading2:    v => toggleLinePrefix(v, '## '),
    heading3:    v => toggleLinePrefix(v, '### '),
    quote:       v => toggleLinePrefix(v, '> '),
    bulletList:  v => bulletedList(v),
    orderedList: v => numberedList(v),
    link:        v => insertLink(v),
    footnote:    v => insertFootnote(v),
};
