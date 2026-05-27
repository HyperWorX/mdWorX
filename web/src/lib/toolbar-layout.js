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

// Only the editing toolbar is customisable in this beta. Top-toolbar
// customisation infrastructure was previously stubbed here but never
// wired up; removed per P2 audit #25.
const TOOLBAR_ROOTS = {
    edit: '#editing-toolbar',
};

// Separator class to apply when creating new separator nodes dynamically
// from layout entries. Matches the static HTML separator class so the
// existing CSS handles spacing/visuals without extra rules.
const SEP_CLASS = {
    edit: 'etb-sep',
};

export function applyToolbarLayout(manifestKey, storedLayout) {
    const manifest = TOOLBAR_MANIFESTS[manifestKey];
    if (!manifest) return;

    const rootSel = TOOLBAR_ROOTS[manifestKey];
    const root = rootSel && document.querySelector(rootSel);
    if (!root) return;

    const layout = reconcileLayout(manifestKey, storedLayout);

    // Wipe any dynamically-created separators from the previous apply
    // pass so we don't accumulate. The static HTML separators (data-
    // static="true") and the etb-group wrappers stay so they can be
    // restored if the layout reverts to default. Buttons are MOVED, not
    // destroyed, so their event handlers (wired by viewer.js delegation
    // on the toolbar root) stay attached.
    root.querySelectorAll(`.${SEP_CLASS[manifestKey]}[data-dynamic-sep="1"]`).forEach(el => el.remove());

    // Flatten edit-toolbar grouping into the root so cross-group reorder
    // works. For the top toolbar, buttons already live directly under
    // `.toolbar-main`, so no flattening required.
    if (manifestKey === 'edit') {
        root.querySelectorAll('.etb-group').forEach(group => {
            // Move each child up to the toolbar root, in order, before
            // dropping the empty group wrapper.
            while (group.firstChild) {
                root.insertBefore(group.firstChild, group);
            }
            group.remove();
        });
    }

    // Hide every static separator. We'll either re-create them as
    // dynamic separators per the layout (custom case) or unhide the
    // statics when the layout matches the manifest default.
    const sepStatics = root.querySelectorAll(`.${SEP_CLASS[manifestKey]}:not([data-dynamic-sep])`);
    sepStatics.forEach(el => { el.hidden = true; });

    // Build the toolbar in layout order. For button entries: move the
    // existing DOM node. For separator entries: create a fresh span.
    let prevNode = null;
    for (const entry of layout) {
        const def = manifest.find(b => b.id === entry.id);
        if (!def) continue;
        if (def.isSeparator) {
            if (entry.visible === false) continue;
            const sep = document.createElement('span');
            sep.className = SEP_CLASS[manifestKey];
            sep.dataset.dynamicSep = '1';
            sep.dataset.id = def.id;
            // Insert after prevNode (or at the start if no prev).
            if (prevNode && prevNode.nextSibling) {
                root.insertBefore(sep, prevNode.nextSibling);
            } else {
                root.appendChild(sep);
            }
            prevNode = sep;
            continue;
        }
        const node = document.querySelector(def.domSelector);
        if (!node) continue;
        node.hidden = entry.visible === false;
        // Move into position. Buttons already inside root just get
        // re-ordered; ones that aren't (shouldn't happen but safe) get
        // adopted.
        if (prevNode && prevNode.nextSibling) {
            root.insertBefore(node, prevNode.nextSibling);
        } else {
            root.appendChild(node);
        }
        prevNode = node;
    }
}
