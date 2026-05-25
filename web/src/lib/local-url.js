// Local image URL helpers.
//
// Relative image paths in markdown (e.g. `![cat](images/cat.png)`) need to
// resolve to the current file's directory. The native side maps a virtual
// host (local.mdworx.test) to that directory via WebView2's
// WebResourceRequested; this module turns a raw markdown src into the
// virtual-host URL that triggers that intercept.
//
// MUST be a different host from the bundle host (app.mdworx.test):
// SetVirtualHostNameToFolderMapping shadows WebResourceRequested on the
// SAME host (per MS WebView2Feedback #4201, #3038).

export const LOCAL_HOST = 'https://local.mdworx.test';

export function encodePathSegments(p) {
    return p.split('/').map(encodeURIComponent).join('/');
}

// Returns {src, unsupportedScheme?, isExternal?, isData?} for a raw markdown
// image src. Caller decides how to render unsupported schemes (e.g. alt-text
// placeholder).
export function rewriteImageUrl(rawSrc) {
    const src = (rawSrc || '').trim();
    if (!src) return { src: '' };

    // Windows absolute path (e.g. C:\foo\bar.png or C:/foo/bar.png).
    // Detected BEFORE the generic scheme check below because "C:" looks
    // like a one-letter scheme to the URI grammar but is actually a drive
    // letter. Routed via the local host's `_abs/` prefix so the native
    // WebResourceRequested handler can serve the file from anywhere on
    // disk (not just the current file's parent directory).
    if (/^[A-Za-z]:[\\/]/.test(src)) {
        const normalised = src.replace(/\\/g, '/');
        return { src: `${LOCAL_HOST}/_abs/${encodePathSegments(normalised)}` };
    }

    // Has a scheme (foo:bar)?
    if (/^[a-z][a-z0-9+\-.]*:/i.test(src)) {
        if (/^(?:https?):/i.test(src)) {
            return { src, isExternal: true };
        }
        if (/^data:/i.test(src)) {
            return { src, isData: true };
        }
        // file://, custom schemes, etc. — not supported.
        return { src: '', unsupportedScheme: src.split(':')[0] };
    }

    // Relative path — rewrite through the local virtual host.
    const cleaned = src.replace(/^\.?\//, '');
    return { src: `${LOCAL_HOST}/${encodePathSegments(cleaned)}` };
}
