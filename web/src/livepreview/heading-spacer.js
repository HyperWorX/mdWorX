// Heading-rhythm block-widget spacers.
//
// Why this exists:
//   Reading mode gives h1-h6 visual breathing room via element margins
//   (margin-top / margin-bottom on the <hN> element). Live mode renders
//   headings as `Decoration.line` classes on .cm-line elements; putting
//   margin on .cm-line distorts CodeMirror's per-line click-to-position
//   mapping (the cm-line's content box does not include margin, so clicks
//   in the margin region route to the wrong line). Result without this
//   module: Live mode has a tighter heading rhythm than Reading and the
//   two modes drift visually apart.
//
// What this module does:
//   For every heading line in the source, insert a block-widget spacer
//   directly above it carrying the equivalent vertical gap. CM6 treats
//   block widgets as first-class document geometry, so clicks in the
//   spacer area route correctly to the nearest neighbouring line. The
//   spacer's height is taken from the runtime-computed margin of a
//   reference h1-h6 inside an off-screen `.cm-md-rendered-block`, so the
//   Reading CSS rule remains the single source of truth — change the
//   Reading margin and the next call to applyHeadingRhythm() picks the
//   new value up.
//
// H1 additionally gets a spacer BELOW it (Reading H1 has margin-bottom
// where the other levels do not).

import { Decoration, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { decoratorStateField } from './util.js';

class RhythmSpacer extends WidgetType {
    constructor(cls) { super(); this.cls = cls; }
    eq(other) { return other.cls === this.cls; }
    toDOM() {
        const d = document.createElement('div');
        d.className = this.cls;
        d.setAttribute('aria-hidden', 'true');
        return d;
    }
    ignoreEvent() { return true; }
}

function atxLevel(name) {
    if (!name.startsWith('ATXHeading')) return 0;
    const n = parseInt(name.slice(10), 10);
    return Number.isFinite(n) ? n : 0;
}
function setextLevel(name) {
    if (name === 'SetextHeading1') return 1;
    if (name === 'SetextHeading2') return 2;
    return 0;
}

export const headingSpacerField = decoratorStateField((state) => {
    const items = [];
    const tree = syntaxTree(state);
    tree.iterate({
        enter(node) {
            const atx = atxLevel(node.name);
            const level = atx > 0 ? atx : setextLevel(node.name);
            if (level === 0) return;
            // Spacer ABOVE the heading line. side: -1 means the widget renders
            // before the line break at node.from. block: true makes CM6 give
            // it its own line of geometry (proper hit-test routing).
            items.push({
                from: node.from,
                to: node.from,
                deco: Decoration.widget({
                    widget: new RhythmSpacer(`cm-md-rhythm-spacer cm-md-rhythm-h${level}-top`),
                    side: -1,
                    block: true,
                }),
            });
            // Spacer BELOW H1 only — other heading levels in the Reading
            // rules have no margin-bottom, so emitting a zero-height widget
            // is just noise. Skip them.
            if (level === 1) {
                items.push({
                    from: node.to,
                    to: node.to,
                    deco: Decoration.widget({
                        widget: new RhythmSpacer(`cm-md-rhythm-spacer cm-md-rhythm-h1-bottom`),
                        side: 1,
                        block: true,
                    }),
                });
            }
        },
    });
    items.sort((a, b) => (a.from - b.from) || (a.to - b.to));
    const builder = new RangeSetBuilder();
    for (const it of items) builder.add(it.from, it.to, it.deco);
    return builder.finish();
});

// Probe Reading-mode h1..h6 computed margins and publish them as CSS custom
// properties on :root, so the spacer widget CSS rules in viewer.css can
// reference them. The probe lives inside a `.cm-md-rendered-block` wrapper
// because the Reading-mode rules use the
// `:is(#content, .cm-md-rendered-block) hN` selector pattern — placing the
// probe inside `.cm-md-rendered-block` makes those rules apply, which is the
// whole point: we want the actual cascaded value the live rendering uses.
//
// Idempotent: safe to call repeatedly. Call after settings changes that may
// alter font-size, line-height, or any heading-margin override so the rhythm
// tracks the new computed values.
export function applyHeadingRhythm() {
    if (typeof document === 'undefined') return;
    const probe = document.createElement('div');
    probe.className = 'cm-md-rendered-block';
    probe.style.cssText =
        'position:absolute;visibility:hidden;left:-9999px;top:0;width:600px;pointer-events:none;';
    document.body.appendChild(probe);
    try {
        const root = document.documentElement.style;
        for (let level = 1; level <= 6; level++) {
            const h = document.createElement(`h${level}`);
            h.textContent = 'M';   // single glyph so the box has real font-size
            probe.appendChild(h);
            const cs = getComputedStyle(h);
            root.setProperty(`--rhythm-h${level}-top`,    cs.marginTop);
            root.setProperty(`--rhythm-h${level}-bottom`, cs.marginBottom);
            probe.removeChild(h);
        }
    } finally {
        document.body.removeChild(probe);
    }
}
