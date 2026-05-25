# Wrap Comparison Test

This document exists to compare line-break behaviour between mdWorX's Live view and Reading view. Switch between the two modes (toolbar) and look for any divergence in how each paragraph below wraps. The same source text should wrap to the same number of visible lines in both modes, at the same column.

## Plain prose, no special punctuation

Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum.

## Prose with hyphens and slashes

The configuration file lives at C:/Users/Mogwai/AppData/Roaming/HyperWorX/mdWorX/settings.json and the per-pane state-machine handles split-mode and non-split-mode separately. Inter-process communication uses the WebView2 host-binding pattern with a JSON-RPC-style message envelope sent over the post-message channel. Long unbreakable identifiers such as `MyExtraordinarilyLongCamelCaseIdentifierName` and `another_unreasonably_long_snake_case_identifier_name` should be handled identically in both modes.

## Prose with em-dashes and quoted phrases

This sentence contains an em dash like "the rule of thumb here" and double-quoted phrases such as "WYSIWYG with per-line marker reveal" plus a parenthetical aside (which itself spans multiple words and should not affect wrapping). Single-quoted snippets like 'foo bar' and bracketed references [see section 3.2] should also wrap identically across both modes regardless of their punctuation density.

## Unordered list, mixed line lengths

- Short bullet.
- A medium-length bullet that takes about one full visible line of text but does not exceed the container before wrapping happens.
- Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum. Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.
- README: removed Obsidian comparisons throughout. The Live mode is now described as "WYSIWYG with per-line marker reveal" rather than "Obsidian-style", and the architectural notes describe what the per-line decorators actually do rather than naming the inspiration. Reasoning: the project is its own thing inside DOpus and doesn't need to position itself against another editor. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt. Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit, sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem.
- A bullet packed with hyphenated-words, file/path/segments, CamelCaseIdentifiers, snake_case_names and a long-running-identifier-with-many-dashes plus inline `code spans` mixed in so we can see whether punctuation drives any wrap-column divergence between the two modes. At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident, similique sunt in culpa qui officia deserunt mollitia animi, id est laborum et dolorum fuga. Et harum quidem rerum facilis est et expedita distinctio.

## Unordered list, nested

- Top-level bullet one with enough text to wrap once or twice on a typical viewer pane width.
    - Nested bullet under one, also long enough to wrap. Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
    - Another nested bullet under one.
        - Doubly nested bullet under nested-one. Wraps once on most pane widths.
- Top-level bullet two with similar length to bullet one for parallel comparison.

## Ordered list, mixed line lengths

1. Short ordered item.
2. A medium-length ordered item that takes about one full visible line before wrapping.
3. Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum.
4. An ordered item packed with hyphenated-words, file/path/segments, CamelCaseIdentifiers, and a quoted "WYSIWYG with per-line marker reveal" to mirror the bullet test above so we can compare ordered-vs-unordered behaviour. Nam libero tempore, cum soluta nobis est eligendi optio cumque nihil impedit quo minus id quod maxime placeat facere possimus, omnis voluptas assumenda est, omnis dolor repellendus. Temporibus autem quibusdam et aut officiis debitis aut rerum necessitatibus saepe eveniet ut et voluptates repudiandae sint et molestiae non recusandae.
5. Itaque earum rerum hic tenetur a sapiente delectus, ut aut reiciendis voluptatibus maiores alias consequatur aut perferendis doloribus asperiores repellat. Hanc ego cum teneam sententiam, quid est cur verear ne ad eam non possim accommodare? Quae quidem mihi a te per litteras tuas significata sunt, ut paene admirer nec rationem reddere nec rationem accipere.

## Ordered list, nested

1. Top-level ordered one with enough text to wrap once or twice on a typical pane width.
    1. Nested ordered under one, also wrapping. Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
    2. Another nested ordered under one.
2. Top-level ordered two for parallel comparison.

## Blockquote

> A blockquote with enough text to wrap on a typical pane width. Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

> A second blockquote with hyphen-words and `inline code` and a quoted phrase "WYSIWYG with per-line marker reveal" to see whether blockquote wrap differs between modes.

## Heading line wrap

### A long third-level heading that should wrap to two lines on a typical pane width so we can confirm heading wrap behaviour matches between modes Lorem ipsum dolor sit amet

#### A long fourth-level heading mirroring the H3 above so we can compare heading wrap across levels Lorem ipsum dolor sit amet

## Paragraph immediately after a heading

Some prose immediately following a heading, to confirm that the gap between a heading and the next block does not push the paragraph's wrap column. Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam.

## Mixed: paragraph then list then paragraph

A paragraph before the list, with enough length to wrap once. Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

- One bullet.
- A bullet that wraps to two visible lines. Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

A paragraph after the list, with enough length to wrap once. Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

## Inline-heavy paragraph

A paragraph mixing **bold runs**, *italic runs*, ~~strikethrough runs~~, `inline code`, [a link target](https://example.com/long/path/segment) and ==highlighted text== to check whether inline marker decorations in Live mode change the wrap column relative to Reading's parsed inline elements. Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor.

## Task list

- [ ] An unchecked task with enough text to wrap to two visible lines on a typical pane width. Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore.
- [x] A checked task with similar length. Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
- [ ] Another unchecked task to compare wrap behaviour against the checked one above.
