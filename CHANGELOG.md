# Changelog

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
