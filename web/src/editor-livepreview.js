// Live-preview extension: composes the per-feature decorator StateFields
// into a single extension array suitable for inclusion in an EditorView
// when the editor is operating in Live mode.
//
// Order matters very slightly — when two decorations overlap exactly on
// the same range, the later-declared one wins for replacement and the
// earlier one wins for marking. Practical impact: headings (line decos)
// before inline marks; replacement widgets (image / link / table /
// fenced-code) before the same-range invisible-marker hides. The current
// ordering is by file size and dependency, which happens to align with
// what the editor needs.

import { headingField    } from './livepreview/heading.js';
import { emphasisField   } from './livepreview/emphasis.js';
import { linkField       } from './livepreview/link.js';
import { imageField      } from './livepreview/image.js';
import { listField       } from './livepreview/list.js';
import { taskField       } from './livepreview/task.js';
import { blockquoteField } from './livepreview/blockquote.js';
import { fencedCodeField } from './livepreview/fenced-code.js';
import { tableField      } from './livepreview/table.js';
import { highlightField  } from './livepreview/highlight.js';
import { hrField         } from './livepreview/hr.js';
import { deflistField    } from './livepreview/deflist.js';
import { footnoteField, footnoteNormalizer } from './livepreview/footnote.js';

// blank-line collapser and heading-spacer fields are intentionally NOT
// registered here. Both were experiments to make Live's vertical rhythm
// match Reading. They turned out to interact badly with CodeMirror's
// click-to-position mapping, and the user requested a clean baseline where
// Live renders from source with no margin/spacing compensation. The source
// files remain at livepreview/blank-line.js and livepreview/heading-spacer.js
// for reference but are not active.

export function livePreviewExtension() {
    return [
        headingField,
        emphasisField,
        linkField,
        imageField,
        listField,
        taskField,
        blockquoteField,
        fencedCodeField,
        tableField,
        highlightField,
        hrField,
        deflistField,
        footnoteField,
        footnoteNormalizer,
    ];
}
