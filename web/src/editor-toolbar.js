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

// Task list. Adds `- [ ] ` to each line in selection if not already a task.
// If every selected line is already `- [ ] ` or `- [x] `, removes the syntax.
// Preserves any leading indent so it works inside nested lists.
export function taskList(view) {
    const { state } = view;
    const lines = lineRangeForSelection(state);
    if (lines.length === 0) return;
    const taskRE = /^(\s*)- \[[ xX]\] /;
    const allTasks = lines.every(l => taskRE.test(l.text));
    let changes;
    if (allTasks) {
        changes = lines.map(l => {
            const m = l.text.match(taskRE);
            // Delete the "- [ ] " (6 chars) right after the indent.
            return { from: l.from + m[1].length, to: l.from + m[0].length, insert: '' };
        });
    } else {
        changes = lines.map(l => {
            // Preserve any existing indent; replace any existing bullet/number marker.
            const m = l.text.match(/^(\s*)([-*+]\s|\d+\.\s)?/);
            const indent = m[1];
            const existingMarker = (m[2] || '').length;
            return {
                from: l.from + indent.length,
                to:   l.from + indent.length + existingMarker,
                insert: '- [ ] ',
            };
        });
    }
    view.dispatch({ changes, userEvent: allTasks ? 'delete.task' : 'input.task' });
    view.focus();
}

// Indent: prepend 2 spaces to each selected line. Matches the Tab-on-list
// indent step used by editor.js's list-indent keymap.
export function indentLines(view) {
    const { state } = view;
    const lines = lineRangeForSelection(state);
    if (lines.length === 0) return;
    const changes = lines.map(l => ({ from: l.from, to: l.from, insert: '  ' }));
    view.dispatch({ changes, userEvent: 'input.indent' });
    view.focus();
}

// Outdent: remove up to 2 leading spaces from each selected line.
export function outdentLines(view) {
    const { state } = view;
    const lines = lineRangeForSelection(state);
    if (lines.length === 0) return;
    const changes = [];
    for (const l of lines) {
        const m = l.text.match(/^( {1,2})/);
        if (m) changes.push({ from: l.from, to: l.from + m[1].length, insert: '' });
    }
    if (changes.length === 0) return;
    view.dispatch({ changes, userEvent: 'delete.outdent' });
    view.focus();
}

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

    // Normal path: cursor is in body. Insert ref at cursor, def at end.
    //
    // Live mode: keep cursor where the new ref was inserted (in body) and
    // auto-open the rendered footnote section's inline-edit box so the user
    // types the description there. Source mode: jump cursor to the new def's
    // body position in source (the only edit surface available there).
    const refText = `[^${id}]`;
    const defText = `\n\n[^${id}]: `;
    const docLen = state.doc.length;
    const bodyStartAfter = docLen + refText.length + defText.length;

    const isLiveMode = (typeof document !== 'undefined') &&
        document.body && document.body.classList.contains('mode-live');
    const cursorTarget = isLiveMode
        ? (r.from + refText.length)   // right after the new ref in body
        : bodyStartAfter;             // at the new def body in source

    view.dispatch({
        changes: [
            { from: r.from, to: r.to, insert: refText },
            { from: docLen, to: docLen, insert: defText },
        ],
        selection: EditorSelection.cursor(cursorTarget),
        scrollIntoView: true,
        userEvent: 'input.footnote',
    });

    // Live mode: after the decoration pass rebuilds the footnotes section
    // widget, find the new <li>'s body <p> and synthesise a mousedown to
    // enter inline-edit mode. Poll for up to ~600ms because the widget
    // rebuild + DOM swap isn't synchronous with the dispatch.
    if (isLiveMode) {
        const targetId = id;
        const escapedId = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(targetId) : targetId;
        let attempts = 0;
        const tryOpen = () => {
            const li = document.querySelector(`li#fn-${escapedId}`);
            const p = li && li.querySelector('p.cm-md-fn-body');
            if (p) {
                p.scrollIntoView({ block: 'center', behavior: 'smooth' });
                p.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                return;
            }
            if (++attempts < 12) setTimeout(tryOpen, 50);
        };
        setTimeout(tryOpen, 50);
    }
    view.focus();
}

// Insert an image at the cursor using Obsidian-style pipe syntax for
// dimensions and alignment:
//
//   ![alt|400x300|center](path)
//
// Files written this way render at the correct size in Obsidian and in
// mdWorX (both read the alt-text tokens via lib/image-alt.js).
//
// opts: { path: string, alt: string, width: number|null,
//         height: number|null, alignment: 'none'|'left'|'center'|'right' }
export function insertImage(view, opts) {
    if (!view || !opts || !opts.path) return;
    const path   = String(opts.path);
    const alt    = String(opts.alt || '');
    const width  = (opts.width  != null && opts.width  !== '') ? Number(opts.width)  : null;
    const height = (opts.height != null && opts.height !== '') ? Number(opts.height) : null;
    const align  = (opts.alignment || 'none');

    const pipeBits = [alt];
    const hasW = width  != null && Number.isFinite(width);
    const hasH = height != null && Number.isFinite(height);
    if (hasW && hasH) pipeBits.push(`${width}x${height}`);
    else if (hasW)    pipeBits.push(String(width));
    else if (hasH)    pipeBits.push(`x${height}`);    // height-only form
    if (align !== 'none') pipeBits.push(align);

    // If only the alt text is present (no dimensions, no alignment),
    // drop the trailing pipe so the output is plain markdown.
    const finalAlt = pipeBits.length > 1
        ? pipeBits.join('|')
        : alt;
    const insertText = `![${finalAlt}](${path})`;

    const { state } = view;
    const r = state.selection.main;
    view.dispatch({
        changes: { from: r.from, to: r.to, insert: insertText },
        selection: EditorSelection.cursor(r.from + insertText.length),
        scrollIntoView: true,
        userEvent: 'input.image',
    });
    view.focus();
}

// Insert a fenced code block at the cursor. If there's a selection, wrap it;
// otherwise insert an empty fence and park the caret on the body line.
//
// Generated text always starts and ends on its own line so the markdown
// parser sees a clean block (a fence pinned mid-line would otherwise parse
// as inline code or break the surrounding paragraph).
export function insertCodeBlock(view) {
    const { state } = view;
    const r = state.selection.main;
    const selected = state.doc.sliceString(r.from, r.to);
    const line = state.doc.lineAt(r.from);
    // Insert a leading newline only if we're not already at the start of a line.
    const lead = (r.from === line.from) ? '' : '\n';
    const body = selected || '';
    const text = `${lead}\`\`\`\n${body}\n\`\`\`\n`;
    // Caret target: the body line. Position = r.from + lead + 4 (the opening
    // "```" plus its trailing newline). If the user had selected text, leave
    // the caret at the END of that selected body instead so they can keep typing.
    const caret = r.from + lead.length + 4 + body.length;
    view.dispatch({
        changes: { from: r.from, to: r.to, insert: text },
        selection: EditorSelection.cursor(caret),
        scrollIntoView: true,
        userEvent: 'input.codeblock',
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
    codeBlock:   v => insertCodeBlock(v),
    bulletList:  v => bulletedList(v),
    orderedList: v => numberedList(v),
    taskList:    v => taskList(v),
    indent:      v => indentLines(v),
    outdent:     v => outdentLines(v),
    link:        v => insertLink(v),
    footnote:    v => insertFootnote(v),
    // image is dispatched from viewer.js's popup so it can collect path /
    // dimensions / alignment before calling insertImage.
};
