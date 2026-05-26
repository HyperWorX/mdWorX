// Toolbar button registry.
//
// Each entry is one customisable button in the UI. The settings dialog
// reads these manifests to build the "Toolbar layout" section, the user's
// chosen layout is persisted as an array of `{ id, visible }` pairs, and
// applyToolbarLayout (lib/toolbar-layout.js) re-orders / hides the DOM
// nodes according to that array on every applySettings.
//
// `domSelector` resolves the manifest id back to the actual button node
// in index.html. Keep it stable: changing a selector invalidates any
// stored layout that references the old id.

export const TOP_TOOLBAR_BUTTONS = [
    { id: 'mode-reading',    label: 'Reading mode',  domSelector: '#toolbar [data-mode="reading"]' },
    { id: 'mode-live',       label: 'Live mode',     domSelector: '#toolbar [data-mode="live"]' },
    { id: 'mode-source',     label: 'Source mode',   domSelector: '#toolbar [data-mode="source"]' },
    { id: 'action-save',     label: 'Save',          domSelector: '#toolbar [data-action="save"]' },
    { id: 'action-saveAs',   label: 'Save As',       domSelector: '#toolbar [data-action="saveAs"]' },
    { id: 'action-wrap',     label: 'Word wrap',     domSelector: '#toolbar [data-action="wrap"]' },
    { id: 'action-settings', label: 'Settings',      domSelector: '#toolbar [data-action="settings"]' },
];

export const EDIT_TOOLBAR_BUTTONS = [
    { id: 'bold',         label: 'Bold',              domSelector: '#editing-toolbar [data-cmd="bold"]' },
    { id: 'italic',       label: 'Italic',            domSelector: '#editing-toolbar [data-cmd="italic"]' },
    { id: 'strike',       label: 'Strikethrough',     domSelector: '#editing-toolbar [data-cmd="strike"]' },
    { id: 'inlineCode',   label: 'Inline code',       domSelector: '#editing-toolbar [data-cmd="inlineCode"]' },
    { id: 'link',         label: 'Link',              domSelector: '#editing-toolbar [data-cmd="link"]' },
    { id: 'footnote',     label: 'Footnote',          domSelector: '#editing-toolbar [data-cmd="footnote"]' },
    { id: 'heading1',     label: 'Heading 1',         domSelector: '#editing-toolbar [data-cmd="heading1"]' },
    { id: 'heading2',     label: 'Heading 2',         domSelector: '#editing-toolbar [data-cmd="heading2"]' },
    { id: 'heading3',     label: 'Heading 3',         domSelector: '#editing-toolbar [data-cmd="heading3"]' },
    { id: 'bulletList',   label: 'Bulleted list',     domSelector: '#editing-toolbar [data-cmd="bulletList"]' },
    { id: 'orderedList',  label: 'Numbered list',     domSelector: '#editing-toolbar [data-cmd="orderedList"]' },
    { id: 'taskList',     label: 'Task list',         domSelector: '#editing-toolbar [data-cmd="taskList"]' },
    { id: 'outdent',      label: 'Outdent',           domSelector: '#editing-toolbar [data-cmd="outdent"]' },
    { id: 'indent',       label: 'Indent',            domSelector: '#editing-toolbar [data-cmd="indent"]' },
    { id: 'quote',        label: 'Blockquote',        domSelector: '#editing-toolbar [data-cmd="quote"]' },
    { id: 'codeBlock',    label: 'Code block',        domSelector: '#editing-toolbar [data-cmd="codeBlock"]' },
    { id: 'image',        label: 'Insert image',      domSelector: '#editing-toolbar [data-cmd="image"]' },
];

export const TOOLBAR_MANIFESTS = {
    top:  TOP_TOOLBAR_BUTTONS,
    edit: EDIT_TOOLBAR_BUTTONS,
};

// Build a default layout (every button, in manifest order, all visible).
// Used when the user has never customised, when "Reset to defaults" is
// clicked, and when migrating a stored layout that's missing entries for
// newly-added buttons (those get appended visible).
export function defaultLayoutFor(manifestKey) {
    return TOOLBAR_MANIFESTS[manifestKey].map(b => ({ id: b.id, visible: true }));
}

// Reconcile a stored layout against the current manifest:
//   - drop entries whose id is no longer in the manifest
//   - append new manifest entries (visible) at the end so new buttons
//     don't silently disappear after an update
// Returns the same shape the user stored — an array of `{ id, visible }`.
export function reconcileLayout(manifestKey, storedLayout) {
    const manifest = TOOLBAR_MANIFESTS[manifestKey];
    if (!Array.isArray(storedLayout) || storedLayout.length === 0) {
        return defaultLayoutFor(manifestKey);
    }
    const known   = new Set(manifest.map(b => b.id));
    const seen    = new Set();
    const out     = [];
    for (const entry of storedLayout) {
        if (!entry || typeof entry.id !== 'string') continue;
        if (!known.has(entry.id) || seen.has(entry.id)) continue;
        out.push({ id: entry.id, visible: entry.visible !== false });
        seen.add(entry.id);
    }
    // Append any manifest ids missing from the stored list.
    for (const b of manifest) {
        if (!seen.has(b.id)) out.push({ id: b.id, visible: true });
    }
    return out;
}
