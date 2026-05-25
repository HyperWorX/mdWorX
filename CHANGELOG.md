# Changelog

## 2026-05-26

### Changed

- README rewrite to catch up with the `feature/toolbar-styling-polish`
  branch. The previous README still described the v0.1.0 surface and was
  referencing image files that no longer existed (`img/split.png`,
  `img/insidepane.png`, `img/features.png`, `img/palleteL.png`,
  `img/PalleteR.png`). The rewrite covers:
  - Top toolbar (now includes Save / Save As / Wrap / Settings buttons).
    Keyboard shortcuts are wired in `viewer.js:622` and `editor.js:208`
    (Ctrl+E / Ctrl+S / Ctrl+Shift+S) and the button tooltips advertise
    them, but they don't actually fire in the DOpus host environment
    (confirmed empirically). The README does NOT promise them; needs
    investigation before any docs claim them.
  - Full editing toolbar contents in correct order (Bold, Italic, Strike,
    Inline code, Link, Footnote, H1-H3, Bullet/Numbered/Task list,
    Outdent/Indent, Quote, Code block, Image insert).
  - Image insert popup workflow including the "Copy file to this
    document's folder" affordance and Obsidian-compatible alt-text
    dimension/alignment syntax.
  - New Settings dialog: every section is named and what each section
    controls is summarised, including the new Heading underline
    thickness/style controls that are independent of HR thickness.
  - Palette system with the actual 29-preset count (17 dark, 12 light),
    enumerated by name, with a link to `docs/palettes.md` for the visual
    reference.
  - Custom theme save/delete flow and where settings + themes are
    persisted (`%APPDATA%\HyperWorX\mdWorX\`).
  - Pop-out window vs. in-pane data-loss behaviour spelled out.
  Files affected: `README.md`. Images referenced are now those in `img/`:
  `hero.png`, `liveedit.png`, `split_pane.png`, `editing_toolbar.png`,
  `palette_light.png`, `palette_dark.png`, and the new `06-settings-top.png`
  capture from the demo-reel run.
- `docs/dev-setup.md` uninstall section: added an explicit step to
  optionally delete `%APPDATA%\HyperWorX\mdWorX\` for a clean wipe of
  user settings and saved custom themes. The previous version only
  mentioned `%LOCALAPPDATA%` (WebView2 cache).

### Context

User requested a documentation pass aligning the README and supporting
docs with the latest feature set on `feature/toolbar-styling-polish`
(already merged into origin/main via PR #1 as commit `19260d1`). The
work on that branch added the entire Settings dialog, palette preset
picker with custom-theme save/delete, heading-underline thickness as a
distinct setting from HR thickness, the image-insert popup with
copy-to-folder, the live-mode list/wrap/blank-line/formatting-marks
overhaul, and the toolbar styling polish itself. None of this was
reflected in the README, and several inline image references were
broken because earlier image renames were never propagated.

Cross-checked palette names against `web/src/settings.js`
(`const palettes = { ... }`) and `docs/palettes.md` — both authoritative
sources agree on 17 dark + 12 light = 29 presets. Cross-checked toolbar
button order against `web/dist/index.html` (rendered bundle output) so
the docs match what users actually see.

Also added in this session (not yet committed): `web/_demo-reel-capture.mjs`
- a Playwright script that drives the bundled web layer via a stubbed
WebView2 bridge and emits PNG screenshots of the runthrough. Used to
produce the new `img/06-settings-top.png` referenced above. The script
is intentionally outside `web/src/` so it doesn't get bundled.

## 2026-05-24

### Changed

- README: removed Obsidian comparisons throughout. The Live mode is now
  described as "WYSIWYG with per-line marker reveal" rather than
  "Obsidian-style", and the architectural notes describe what the
  per-line decorators actually do rather than naming the inspiration.
  Reasoning: the project is its own thing inside DOpus and doesn't need
  to position itself against another editor.
- README: rewrote the "Encoding support" section as "Reads files in any
  language". The old version was a flat specification list (codepage
  numbers, BOM sniffing terminology, etc.) that read like a man page.
  The new version leads with what it does for a user opening a
  Chinese / Japanese / Korean / Arabic / Hebrew / Hindi / Thai / Greek
  file, then explains the technical bits in plain language. The
  caveat about saving back as UTF-8 only is preserved.
- GitHub repo description on HyperWorX/mdWorX: removed "Obsidian-style"
  phrasing, added a note that it has proper multi-language encoding
  support.
- GitHub repo topics on HyperWorX/mdWorX: set 16 topic tags chosen to
  reflect what the project IS and what it's FOR, not what it's built
  with. Final tags: directory-opus, dopus, dopus-plugin, viewer-plugin,
  markdown, markdown-editor, markdown-viewer, live-preview, wysiwyg,
  inline-editor, split-view, file-manager, gfm, note-taking,
  documentation, windows. Tech-stack tags considered but dropped on
  user feedback ("more specific to its application rather than
  technical jargon"): codemirror, codemirror6, webview2, cpp, cjk,
  unicode, plugin.

### Files affected

- `README.md` (lines 9, 15, 34, 52, and the entire encoding section
  around lines 89-99)
- GitHub repo metadata at https://github.com/HyperWorX/mdWorX
  (description and topics, not in-repo files)
- `CHANGELOG.md` (this file, newly created in the mdWorX project root)

### Context

User requested the Obsidian wording be dropped from the README and the
encoding section be made more user-friendly (their phrasing: "rather
than just putting out specification ... because it can handle Chinese
as well"). User also asked for GitHub tags to be set on the repo. The
user explicitly said "I'm not pushing anything" so no git commit/push
was performed for the README changes; the GitHub repo metadata edits
were applied directly via `gh repo edit` and do not require a push.
