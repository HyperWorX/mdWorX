# Line Ending Test

This document checks CRLF / LF handling, palette colours, and the footnote normaliser.

> Blockquotes should follow the active palette, not the code-block colour.

| Feature | Status |
| ------- | ------ |
| Tables  | header colour follows palette |
| Code    | follows the code theme |

A paragraph with a footnote reference.[^1]

[^1]: This footnote definition sits in the MIDDLE of the document on purpose, so the live-mode normaliser relocates it to the end. With the fix, that relocation must NOT mark the file dirty.

```js
function greet(name) {
  return `hello ${name}`;
}
```

Final paragraph after the footnote definition.
