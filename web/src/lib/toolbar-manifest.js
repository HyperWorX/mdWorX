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

// `glyph` holds the inner markup (span or svg) for the settings drag-list
// tile preview. Same source as the live button in index.html so the user
// sees the actual icon they're rearranging, not just a text label.
export const EDIT_TOOLBAR_BUTTONS = [
    { id: 'bold',         label: 'Bold',              domSelector: '#editing-toolbar [data-cmd="bold"]',
      glyph: '<span class="etb-glyph etb-glyph-bold">B</span>' },
    { id: 'italic',       label: 'Italic',            domSelector: '#editing-toolbar [data-cmd="italic"]',
      glyph: '<span class="etb-glyph etb-glyph-italic">I</span>' },
    { id: 'strike',       label: 'Strikethrough',     domSelector: '#editing-toolbar [data-cmd="strike"]',
      glyph: '<span class="etb-glyph etb-glyph-strike">S</span>' },
    { id: 'highlight',    label: 'Highlight',         domSelector: '#editing-toolbar [data-cmd="highlight"]',
      glyph: '<svg viewBox="0 0 24 24" class="etb-icon"><path d="M14.5 3.5 20.5 9.5 11 19l-4.5 1.5L8 16Z"/><path d="m6 20 1-3"/><path d="M14.5 3.5 11 7l6 6 3.5-3.5z" fill="currentColor" stroke="none"/></svg>' },
    { id: 'inlineCode',   label: 'Inline code',       domSelector: '#editing-toolbar [data-cmd="inlineCode"]',
      glyph: '<svg viewBox="0 0 24 24" class="etb-icon"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>' },
    { id: 'link',         label: 'Link',              domSelector: '#editing-toolbar [data-cmd="link"]',
      glyph: '<svg viewBox="0 0 24 24" class="etb-icon"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' },
    { id: 'footnote',     label: 'Footnote',          domSelector: '#editing-toolbar [data-cmd="footnote"]',
      glyph: '<svg viewBox="0 0 24 24" class="etb-icon"><path d="M4 6h11"/><path d="M9.5 6v13"/><text x="17" y="11" font-size="9" font-weight="700" fill="currentColor" stroke="none" font-family="system-ui, sans-serif">1</text></svg>' },
    { id: 'sep-1',        label: 'Separator',         isSeparator: true },
    { id: 'heading',      label: 'Heading (cycles H1-H6)', domSelector: '#editing-toolbar [data-cmd="heading"]',
      glyph: '<span class="etb-glyph etb-glyph-h">H<span class="etb-glyph-num">1</span></span>' },
    { id: 'sep-2',        label: 'Separator',         isSeparator: true },
    { id: 'bulletList',   label: 'Bulleted list',     domSelector: '#editing-toolbar [data-cmd="bulletList"]',
      glyph: '<svg viewBox="0 0 24 24" class="etb-icon"><line x1="9" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="9" y1="18" x2="21" y2="18"/><circle cx="4.5" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>' },
    { id: 'orderedList',  label: 'Numbered list',     domSelector: '#editing-toolbar [data-cmd="orderedList"]',
      glyph: '<svg viewBox="0 0 24 24" class="etb-icon"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 4v4M3 4h2M3 8h3"/><path d="M3 10.5c0-.8.7-1.5 1.5-1.5S6 9.7 6 10.5c0 1.5-3 2-3 3.5h3"/><path d="M3 16h2.5c.8 0 1.5.7 1.5 1.5S6.3 19 5.5 19H4M5.5 19c.8 0 1.5.7 1.5 1.5S6.3 22 5.5 22H3"/></svg>' },
    { id: 'taskList',     label: 'Task list',         domSelector: '#editing-toolbar [data-cmd="taskList"]',
      glyph: '<svg viewBox="0 0 24 24" class="etb-icon"><rect x="3" y="4" width="7" height="7" rx="1.5"/><polyline points="4.5 7.5 6 9 9 6" stroke-width="2"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><line x1="13" y1="7.5" x2="21" y2="7.5"/><line x1="13" y1="17.5" x2="21" y2="17.5"/></svg>' },
    { id: 'sep-3',        label: 'Separator',         isSeparator: true },
    { id: 'outdent',      label: 'Outdent',           domSelector: '#editing-toolbar [data-cmd="outdent"]',
      glyph: '<svg viewBox="0 0 24 24" class="etb-icon"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/><line x1="11" y1="12" x2="21" y2="12"/><polyline points="7 8 3 12 7 16"/></svg>' },
    { id: 'indent',       label: 'Indent',            domSelector: '#editing-toolbar [data-cmd="indent"]',
      glyph: '<svg viewBox="0 0 24 24" class="etb-icon"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/><line x1="11" y1="12" x2="21" y2="12"/><polyline points="3 8 7 12 3 16"/></svg>' },
    { id: 'sep-4',        label: 'Separator',         isSeparator: true },
    { id: 'quote',        label: 'Blockquote',        domSelector: '#editing-toolbar [data-cmd="quote"]',
      glyph: '<svg viewBox="0 0 24 24" class="etb-icon" fill="currentColor" stroke="none"><path d="M9 7H5a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v1c0 1.1-.9 2-2 2H4v2h1c2.2 0 4-1.8 4-4V9c0-1.1-.9-2-2-2zm10 0h-4a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v1c0 1.1-.9 2-2 2h-1v2h1c2.2 0 4-1.8 4-4V9c0-1.1-.9-2-2-2z"/></svg>' },
    { id: 'codeBlock',    label: 'Code block',        domSelector: '#editing-toolbar [data-cmd="codeBlock"]',
      glyph: '<svg viewBox="0 0 24 24" class="etb-icon"><rect x="3" y="4" width="18" height="16" rx="2"/><polyline points="10 9 7 12 10 15"/><polyline points="14 9 17 12 14 15"/></svg>' },
    { id: 'image',        label: 'Insert image',      domSelector: '#editing-toolbar [data-cmd="image"]',
      glyph: '<svg viewBox="0 0 24 24" class="etb-icon"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6" fill="currentColor" stroke="none"/><path d="M21 17l-5-5-8 8" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
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

// Migrate ids that have been renamed / consolidated between versions.
// Returns the current-manifest id for a stored id, or the original id
// when no migration applies. Used by reconcileLayout so existing user
// layouts keep their position after a button is renamed or collapsed.
//   heading1 / heading2 / heading3 -> heading  (collapsed to one
//                                               cycling button in 0.2.0)
function migrateLegacyId(id) {
    if (id === 'heading1' || id === 'heading2' || id === 'heading3') {
        return 'heading';
    }
    return id;
}

// Reconcile a stored layout against the current manifest:
//   - drop entries whose id is no longer in the manifest
//   - migrate legacy ids to their current equivalents (preserves
//     position so the heading button stays where heading1 used to be)
//   - when several legacy ids collapse to one target, OR their
//     visibility together so a user who showed heading2 but hid
//     heading1 still gets a visible heading button after migration
//   - append new manifest entries (visible) at the end so new buttons
//     don't silently disappear after an update
// Returns the same shape the user stored — an array of `{ id, visible }`.
export function reconcileLayout(manifestKey, storedLayout) {
    const manifest = TOOLBAR_MANIFESTS[manifestKey];
    if (!Array.isArray(storedLayout) || storedLayout.length === 0) {
        return defaultLayoutFor(manifestKey);
    }
    const known   = new Set(manifest.map(b => b.id));
    // First pass: collect per-target merged visibility. When several
    // legacy ids migrate to the same target, OR their visibility so
    // ANY visible legacy id keeps the merged button visible.
    const mergedVisibility = new Map();
    for (const entry of storedLayout) {
        if (!entry || typeof entry.id !== 'string') continue;
        const id = migrateLegacyId(entry.id);
        if (!known.has(id)) continue;
        const wasVisible = entry.visible !== false;
        mergedVisibility.set(id, (mergedVisibility.get(id) ?? false) || wasVisible);
    }
    // Second pass: emit each target in first-seen order with its
    // merged visibility.
    const seen = new Set();
    const out  = [];
    for (const entry of storedLayout) {
        if (!entry || typeof entry.id !== 'string') continue;
        const id = migrateLegacyId(entry.id);
        if (!known.has(id) || seen.has(id)) continue;
        out.push({ id, visible: mergedVisibility.get(id) });
        seen.add(id);
    }
    // Append any manifest ids missing from the stored list.
    for (const b of manifest) {
        if (!seen.has(b.id)) out.push({ id: b.id, visible: true });
    }
    return out;
}
