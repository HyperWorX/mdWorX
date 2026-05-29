# mdWorX

A Markdown viewer and editor that runs inside Directory Opus.

## Formatting

**Bold**, *italic*, ~~strikethrough~~, ==highlight==, and `inline code` all
render with palette-aware colours. Here is a [link](https://example.com), and a
footnote reference.[^1]

> Blockquotes take on the active palette, distinct from the code-block colour.

### Lists

- Bulleted item
- Another item
  - Nested item

1. First step
2. Second step

- [x] A completed task
- [ ] A pending task

## Table

| Feature | Status        |
| ------- | ------------- |
| Tables  | rendered      |
| Code    | highlighted   |
| Themes  | 29 palettes   |

## Code

```js
function greet(name) {
  const who = name || 'world';
  return `hello, ${who}`;
}

console.log(greet('mdWorX'));
```

[^1]: Footnotes are editable in place at the bottom of the document.
