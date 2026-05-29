// Formatting marks decorator — a small line-end badge (LF / CRLF) on every
// newline-terminated line, in BOTH Live and Source modes, so the file's
// line-ending convention is visible (and a mixed file shows its mix).
//
// viewer.js records the per-line EOL types on window.mdwxEolPerLine from the
// raw file content (CodeMirror normalises its own buffer to LF, so this array
// is the only record of each line's original ending) plus the dominant
// convention on window.mdwxDominantEol. This field badges each terminated line
// with its recorded ending; lines past the original count (newly inserted)
// have no record and fall back to the dominant convention — which is what save
// writes for them. The final line carries no trailing newline, so no badge.
//
// Caveat: as the user inserts/deletes lines mid-document the per-line indices
// drift relative to the original; badges stay accurate for an unedited buffer
// (the common viewing case) and re-sync on save+reload.
//
// The body.mdwx-show-formatting class gates visibility in CSS, so toggling the
// "Show formatting characters" setting is a CSS flip with no editor rebuild.

import { Decoration } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { decoratorStateField } from './util.js';

const lfDeco   = Decoration.line({ class: 'cm-md-eol-lf' });
const crlfDeco = Decoration.line({ class: 'cm-md-eol-crlf' });

export const formattingMarksField = decoratorStateField((state) => {
    const eols     = (typeof window !== 'undefined' && window.mdwxEolPerLine)  || [];
    const dominant = (typeof window !== 'undefined' && window.mdwxDominantEol) || 'lf';
    const builder  = new RangeSetBuilder();
    const lineCount = state.doc.lines;
    for (let i = 1; i < lineCount; i++) {
        const line = state.doc.line(i);
        const t = eols[i - 1];
        const type = (t === 'crlf' || t === 'lf') ? t : dominant;
        builder.add(line.from, line.from, type === 'crlf' ? crlfDeco : lfDeco);
    }
    return builder.finish();
});
