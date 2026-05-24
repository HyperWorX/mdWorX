# mdWorX - render test

This file exercises the markdown rendering pipeline plus image asset resolution via the `local.mdworx.test` virtual host mapping.

## Inline formatting

Plain text, **bold**, *italic*, ~~strikethrough~~, `inline code`, ==highlighted== text, H~2~O and E=mc^2^, and a link to
[the GPSoftware site](https://www.gpsoft.com.au).

## Lists

Bullets:

- one
- two
  - nested
  - nested
- three

Numbered:

1. first
2. second
3. third

Task list:

- [x] WebView2 hosting works
- [x] Theme detection
- [ ] Editor mode

## Code

Inline `printf("hello\n")` and a block:

```cpp
extern "C" __declspec(dllexport)
HWND DVP_CreateViewer(HWND hwndParent, LPRECT lpRc, DWORD dwFlags) {
    DpiScope dpi;  // PowerToys-style crash avoidance.
    return CreateWindowExW(/* ... */);
}
```

## Table

| Stage | Component | Status |
|-------|-----------|--------|
| 0 | Hello-world plugin | done |
| 1 | WebView2 hosting | done |
| 2 | Markdown rendering | testing now |
| 3 | Image resolution | testing now |

## Blockquote

> "Most of the time a rewrite is better than trying to get different
> patched bits to work together."
> — DHH-ish summary of the rewrite bias from the framework-docs research.

## Images

Relative path:

![Blue test image](sample-image.png)

Second image with explicit dimensions in the alt text:

![80x80 orange square](sample-image-2.png)

## Definition list

DOpus
: Directory Opus, the file manager hosting this plugin.

WebView2
: Microsoft's Chromium-based embeddable browser control.

## Footnote

The plugin uses native COM hosting[^why] rather than the WinForms wrapper.

[^why]: WinForms 9's `ScaleHelper.EnterDpiAwarenessScope` throws on threads
    without a DPI awareness context, which is exactly what happens when a
    third-party file manager loads PowerToys' preview handler. Native COM
    bypasses that code path entirely.

## Horizontal rule

---

End of test file.
