// Shared utilities for the live-preview decorator state fields.
//
// Pattern and code shape ported from:
//   - silverbullet.md  https://github.com/silverbulletmd/silverbullet  (MIT)
//   - retronav/ixora   https://codeberg.org/retronav/ixora             (Apache-2.0)
// Silverbullet's `web/cm_plugins/util.ts` itself credits ixora; both
// licences are permissive and require only attribution in source.
//
// Adapted for this project:
//   - silverbullet-specific symbols (Client, ClickEvent, renderMarkdownToHtml,
//     resolveAttachmentPath, ../deps.ts barrel) are stripped
//   - `renderInlineMarkdown` plugs into the same markdown-it instance the
//     viewer uses for Reading mode so Live and Reading agree on inline HTML

import { StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';

// ---------------------------------------------------------------------------
// Cursor detection
//
// True when any selection range overlaps [from, to]. Multi-cursor safe.
// A range "overlaps" if it is not entirely to the left or entirely to the
// right of the target — touching the boundary counts as overlapping so the
// caret revealed markdown stays visible while you arrow off the end of a
// word too.
export function isCursorInRange(state, [from, to]) {
    for (const r of state.selection.ranges) {
        if (r.from <= to && r.to >= from) return true;
    }
    return false;
}

export function checkRangeOverlap([a1, a2], [b1, b2]) {
    return a1 <= b2 && b1 <= a2;
}

// ---------------------------------------------------------------------------
// Decoration helpers
//
// invisibleDecoration replaces a syntax marker (e.g. `**`, `#`, `[`) with
// nothing visible. The replaced text stays in the document — the editor
// just paints over it.
export const invisibleDecoration = Decoration.replace({});

// ---------------------------------------------------------------------------
// decoratorStateField factory
//
// Takes a function that produces a DecorationSet from EditorState. Returns
// a StateField that recomputes on every doc change AND every selection
// change (so marker hide/reveal flips as the caret moves).
export function decoratorStateField(stateToDecoratorSet) {
    return StateField.define({
        create(state) {
            return stateToDecoratorSet(state);
        },
        update(_oldSet, tr) {
            // Recompute on doc change OR selection change. Cheaper than
            // mapping the old set forward because our walks are visible-
            // viewport-only and stay fast on typical files.
            return stateToDecoratorSet(tr.state);
        },
        provide(field) {
            return EditorView.decorations.from(field);
        },
    });
}

// ---------------------------------------------------------------------------
// Common widgets

// LinkWidget renders an <a> for [text](url) when the caret is outside the
// link node. Clicks call the onClick callback (set up by the link plugin
// to route through window.chrome.webview for external open).
export class LinkWidget extends WidgetType {
    constructor(href, label, onClick) {
        super();
        this.href = href;
        this.label = label;
        this.onClick = onClick;
    }
    eq(other) {
        return other.href === this.href && other.label === this.label;
    }
    toDOM() {
        const a = document.createElement('a');
        a.href = this.href;
        a.textContent = this.label;
        a.className = 'cm-md-link';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.addEventListener('click', (e) => {
            e.preventDefault();
            if (this.onClick) this.onClick(this.href);
        });
        return a;
    }
    ignoreEvent() {
        // Let the click handler above fire instead of being swallowed by CM.
        return false;
    }
}

// Generic button-style widget for the task checkbox plugin.
export class ButtonWidget extends WidgetType {
    constructor(label, className, onClick) {
        super();
        this.label = label;
        this.className = className || '';
        this.onClick = onClick;
    }
    eq(other) {
        return other.label === this.label && other.className === this.className;
    }
    toDOM() {
        const b = document.createElement('span');
        b.className = this.className;
        b.textContent = this.label;
        b.addEventListener('mousedown', (e) => {
            // mousedown rather than click so CM doesn't move the caret
            // first and trigger a selection change that swaps decorations.
            e.preventDefault();
            if (this.onClick) this.onClick();
        });
        return b;
    }
    ignoreEvent() {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Inline markdown renderer
//
// Delegates to lib/markdown-it-shared.js so widget rendering uses the SAME
// markdown-it instance + plugin config that Reading mode uses. Keeps the
// renderInlineMarkdown name for back-compat with existing table.js import.

import { renderInline } from '../lib/markdown-it-shared.js';

export function renderInlineMarkdown(text) {
    return renderInline(text);
}
