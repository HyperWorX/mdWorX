// Apply a user-chosen toolbar layout to the live DOM.
//
// The user's layout is an ordered list of `{ id, visible }` pairs (see
// toolbar-manifest.js). For each pass we:
//
//   1. Resolve each manifest id to its DOM button node via domSelector.
//   2. Hide buttons whose `visible: false` flag is set.
//   3. Re-order the DOM nodes so they appear in the layout's order.
//   4. Hide static separators when a non-default layout is active (the
//      separators belong to the manufactured grouping; once the user
//      reorders, the groups don't make sense any more).
//
// `applyToolbarLayout` is idempotent — calling it twice with the same
// layout produces the same final DOM, no transient flicker.

import { TOOLBAR_MANIFESTS, reconcileLayout } from './toolbar-manifest.js';

const SEPARATOR_SELECTORS = {
    top:  ['#toolbar .tbm-sep'],
    edit: ['#editing-toolbar .etb-sep', '#editing-toolbar .etb-group'],
};

function isDefaultLayout(manifestKey, layout) {
    const manifest = TOOLBAR_MANIFESTS[manifestKey];
    if (!Array.isArray(layout) || layout.length !== manifest.length) return false;
    for (let i = 0; i < manifest.length; ++i) {
        if (layout[i].id !== manifest[i].id) return false;
        if (layout[i].visible === false)     return false;
    }
    return true;
}

export function applyToolbarLayout(manifestKey, storedLayout) {
    const manifest = TOOLBAR_MANIFESTS[manifestKey];
    if (!manifest) return;

    const layout = reconcileLayout(manifestKey, storedLayout);
    const useDefault = isDefaultLayout(manifestKey, layout);

    // Pass 1: visibility. Look up each button and apply hidden=true/false.
    for (const entry of layout) {
        const def  = manifest.find(b => b.id === entry.id);
        const node = def && document.querySelector(def.domSelector);
        if (!node) continue;
        node.hidden = entry.visible === false;
    }

    // Pass 2: re-order. Only run when the layout actually diverges from
    // the manifest default; otherwise leave the static HTML structure
    // intact (preserves the etb-group containers and tbm-sep separators
    // that the default visual grouping depends on).
    if (!useDefault) {
        const nodes = layout.map(entry => {
            const def = manifest.find(b => b.id === entry.id);
            return def && document.querySelector(def.domSelector);
        }).filter(Boolean);
        if (nodes.length > 0) {
            // For the edit toolbar, the buttons live inside multiple
            // `.etb-group` wrappers. Flatten them into a single parent
            // (the toolbar root) so cross-group reordering works. The top
            // toolbar's buttons all live under `.toolbar-main`, no
            // flattening required.
            const parent = manifestKey === 'edit'
                ? document.getElementById('editing-toolbar')
                : nodes[0].parentNode;
            if (parent) {
                for (const n of nodes) {
                    if (n.parentNode !== parent) parent.appendChild(n);
                    else parent.appendChild(n);
                }
            }
        }
        // Hide separator / group decoration since the user-chosen order
        // doesn't respect the original grouping.
        for (const sel of (SEPARATOR_SELECTORS[manifestKey] || [])) {
            document.querySelectorAll(sel).forEach(el => {
                // An `.etb-group` is the wrapper containing other
                // buttons we just relocated; leave it in DOM but empty
                // so its CSS doesn't introduce phantom gaps.
                if (el.classList.contains('etb-group')) {
                    el.hidden = el.childElementCount === 0;
                } else {
                    el.hidden = true;
                }
            });
        }
    } else {
        // Restore default: ensure separators and group wrappers are visible
        // again in case a previous call hid them.
        for (const sel of (SEPARATOR_SELECTORS[manifestKey] || [])) {
            document.querySelectorAll(sel).forEach(el => {
                el.hidden = false;
            });
        }
    }
}
