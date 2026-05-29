// Shared CodeMirror transaction annotation.
//
// Marks a transaction as a PROGRAMMATIC (non-user) document change — file
// load, mode switch, reload-from-disk, footnote auto-normalisation — so the
// editor's updateListener skips the dirty / stash bookkeeping that a real
// user edit triggers. Without it, an auto-dispatched doc rewrite reads as a
// user edit and writes a stash, which then fires the conflict banner on the
// next swap-back even though the user typed nothing.
//
// Lives in its own module so both editor.js and the live-preview plugins can
// import the SAME annotation instance without a circular dependency.

import { Annotation } from '@codemirror/state';

export const programmaticDocUpdate = Annotation.define();

// Like programmaticDocUpdate, but for an auto-applied normalisation (e.g. the
// footnote reorder) that we DO want mirrored into editorBuffer. When it lands
// on a clean (non-dirty) buffer it is adopted as the new clean baseline rather
// than marked as a user edit; when it lands on top of unsaved edits it is
// treated as part of those edits. See viewer.js onChange.
export const programmaticBaselineUpdate = Annotation.define();
