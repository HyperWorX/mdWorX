// Formatting marks decorator — line-end badges showing LF / CRLF for each
// visible line in Live mode.
//
// How it works:
//   1. viewer.js scans the raw file content on 'load' and populates
//      window.mdwxEolPerLine — an array where index N is the EOL type
//      ('lf' | 'crlf' | 'none') for source line N+1.
//   2. This field emits Decoration.line per line with class
//      cm-md-eol-{lf,crlf,none} so viewer.css can render a small badge via
//      ::after when body.mdwx-show-formatting is set.
//   3. The body class gate keeps the badges visible only when the
//      "Show formatting characters" setting is on. Classes are emitted
//      unconditionally so toggling the setting doesn't require an editor
//      rebuild — CSS visibility flip is enough.
//
// Caveat about edits: window.mdwxEolPerLine reflects the ORIGINAL file
// content at load time. As the user inserts/deletes lines, the indices
// drift relative to the editor doc. For lines beyond the original count
// we default to 'lf' (CodeMirror's normalized internal separator). For
// edits in the middle, badges may be stale until save+reload. Acceptable
// for a v0.1.x feature; a position-mapped version can come later.

import { Decoration } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { decoratorStateField } from './util.js';

const lfDeco   = Decoration.line({ class: 'cm-md-eol-lf' });
const crlfDeco = Decoration.line({ class: 'cm-md-eol-crlf' });
const noneDeco = Decoration.line({ class: 'cm-md-eol-none' });

function decoForType(type) {
    if (type === 'crlf') return crlfDeco;
    if (type === 'none') return noneDeco;
    return lfDeco;
}

export const formattingMarksField = decoratorStateField((state) => {
    const eols = (typeof window !== 'undefined' && window.mdwxEolPerLine) || [];
    const builder = new RangeSetBuilder();
    const lineCount = state.doc.lines;
    for (let i = 1; i <= lineCount; i++) {
        const line = state.doc.line(i);
        // Lookup the recorded EOL type for this 1-based line; fall back to
        // 'lf' for lines beyond the original (newly inserted by the user).
        // The last line of the editor doc has no trailing newline only if
        // the original file also ended without one; treat it specially so
        // we don't show a misleading badge there.
        let type;
        if (i === lineCount) {
            type = eols[i - 1] === 'none' ? 'none' : (eols[i - 1] || 'lf');
        } else {
            type = eols[i - 1] || 'lf';
        }
        builder.add(line.from, line.from, decoForType(type));
    }
    return builder.finish();
});
