// Obsidian-style image alt-text parser.
//
// Obsidian extends standard markdown image alt text with pipe-separated
// tokens that carry sizing and alignment:
//
//   ![alt|400](path)         -> width=400
//   ![alt|400x300](path)     -> width=400, height=300
//   ![alt|x300](path)        -> height=300 only (non-standard; our toolbar
//                               emits this when the user sets height alone)
//   ![alt|center](path)      -> alignment=center
//   ![alt|400x300|right](path) -> width=400, height=300, alignment=right
//
// Files written with this syntax render at the correct size in Obsidian
// and in mdWorX. Any pipe-separated token that isn't a recognised
// dimension or alignment keyword is kept as part of the alt text, so
// existing alt strings that legitimately contain a `|` aren't lost.
//
// Returns: { alt: string, width: number|null, height: number|null,
//            alignment: 'none'|'left'|'center'|'right' }

const ALIGN_VALUES = new Set(['left', 'center', 'right', 'none']);

export function parseImageAlt(rawAlt) {
    const result = {
        alt: rawAlt || '',
        width: null,
        height: null,
        alignment: 'none',
    };
    if (!rawAlt || rawAlt.indexOf('|') === -1) return result;

    const tokens = rawAlt.split('|');
    const altParts = [tokens[0]];

    for (let i = 1; i < tokens.length; i++) {
        const t = tokens[i].trim();

        // WxH, W, or xH (height-only). All groups must be digits; allow
        // empty width group for the height-only form.
        const dim = t.match(/^(\d*)[xX](\d+)$/) || t.match(/^(\d+)$/);
        if (dim) {
            if (dim.length === 3) {
                if (dim[1] && Number(dim[1]) > 0) result.width  = Number(dim[1]);
                if (dim[2]) result.height = Number(dim[2]);
            } else {
                result.width = Number(dim[1]);
            }
            continue;
        }

        const lower = t.toLowerCase();
        if (ALIGN_VALUES.has(lower)) {
            result.alignment = lower;
            continue;
        }

        // Unknown token - preserve it inside the alt text.
        altParts.push(t);
    }

    result.alt = altParts.join('|').trim();
    return result;
}

// Apply parsed alt-text attributes to an <img> DOM element. Width and
// height are set as HTML attributes (so the browser respects them and our
// CSS :not([width]):not([height]) guard kicks in); alignment becomes a
// .md-img-<left|center|right> class.
export function applyImageAttrs(img, parsed) {
    if (!img || !parsed) return;
    if (parsed.width  != null && Number.isFinite(parsed.width))  img.setAttribute('width',  String(parsed.width));
    if (parsed.height != null && Number.isFinite(parsed.height)) img.setAttribute('height', String(parsed.height));
    if (parsed.alignment === 'left')   img.classList.add('md-img-left');
    if (parsed.alignment === 'center') img.classList.add('md-img-center');
    if (parsed.alignment === 'right')  img.classList.add('md-img-right');
}
