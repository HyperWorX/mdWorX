// mdWorX plugin - WebView2-hosted viewer window for Directory Opus.
//
// Stage 0+1: native plugin shell with WebView2 hosting proven inside DOpus's
// lister pane. The web layer (markdown rendering, editor, asset resolution)
// lives in HTML/CSS/JS bundled separately. At this commit the WebView2
// navigates to an inline "hello" page so we can verify hosting works before
// wiring real content.

#include <windows.h>
#include <strsafe.h>
#include <shlwapi.h>
#include <shlobj.h>
#include <shellapi.h>
#include <commdlg.h>   // GetSaveFileNameW for editor Save As
#include <wrl.h>
#include <WebView2.h>
#include <string>
#include <memory>
#include <vector>
#include <mutex>
#include <algorithm>

// The 2007-era DOpus SDK uses LPCBYTE in function-pointer typedefs.
// Modern Windows SDKs don't always expose LPCBYTE under WIN32_LEAN_AND_MEAN.
#ifndef LPCBYTE
typedef const BYTE *LPCBYTE;
#endif

// DOpus SDK
#include "viewer plugins.h"
#include "plugin support.h"

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

namespace {

// ---------------------------------------------------------------------------
// Module-level state

HINSTANCE g_hInstance     = nullptr;
HWND      g_hwndDOpusMsg  = nullptr;

// Last-seen DOpus viewer pane background colour. Tracked globally so the
// settings dialog (which is NOT a child of a viewer pane and so can't
// query DVPN_GETBGCOL itself) can render in the same light/dark palette
// as the user's most recently viewed file. Updated from ViewerWndProc on
// every pane create + REDRAW. Falls back to COLOR_WINDOW until the first
// viewer pane has been created.
COLORREF  g_lastViewerBg  = GetSysColor(COLOR_WINDOW);

// {74A3AE1F-C55E-4DAF-9107-F93E3A322CD8}
constexpr GUID kPluginGuid =
    { 0x74a3ae1f, 0xc55e, 0x4daf,
      { 0x91, 0x07, 0xf9, 0x3e, 0x3a, 0x32, 0x2c, 0xd8 } };

constexpr wchar_t kHandledExts[]     = L".md;.markdown;.mdown;.mkd;.mkdn;.mdwn";
constexpr wchar_t kName[]            = L"Markdown";
constexpr wchar_t kDescription[]     = L"mdWorX - markdown viewer/editor "
                                       L"(images, themes, in-place editing, split view)";
constexpr wchar_t kCopyright[]       = L"(c) 2026 HyperWorX. MIT licensed.";
constexpr wchar_t kURL[]             = L"https://github.com/HyperWorX/mdWorX";
constexpr wchar_t kWindowClassName[] = L"mdWorXWnd";

// Forward declaration for the openSettings message handler — DVP_Configure
// itself is defined later (it's the DOpus SDK plugin-config entrypoint), but
// the WebMessageReceived lambda above it needs to be able to call it.
extern "C" __declspec(dllexport)
HWND DVP_Configure(HWND hWndParent, HWND hWndNotify, DWORD dwNotifyData);

// Build the WebView2 user data folder under %LOCALAPPDATA% so multiple
// plugin instances and Windows users don't fight over a single state dir.
std::wstring GetUserDataFolder() {
    PWSTR raw = nullptr;
    if (FAILED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &raw))) {
        return L"";
    }
    std::wstring path = raw;
    CoTaskMemFree(raw);
    path += L"\\HyperWorX\\mdWorX\\WebView2";
    SHCreateDirectoryExW(nullptr, path.c_str(), nullptr);
    return path;
}

// User-editable settings file lives under Roaming so it syncs with the
// user's profile, while the WebView2 cache stays Local. The file is read
// verbatim and relayed to the web layer as a text payload — parsing
// happens in JS so a malformed file degrades to "ignore" rather than
// crashing the native host.
std::wstring GetUserSettingsPath() {
    PWSTR raw = nullptr;
    if (FAILED(SHGetKnownFolderPath(FOLDERID_RoamingAppData, 0, nullptr, &raw))) {
        return L"";
    }
    std::wstring dir = raw;
    CoTaskMemFree(raw);
    dir += L"\\HyperWorX\\mdWorX";
    SHCreateDirectoryExW(nullptr, dir.c_str(), nullptr);
    return dir + L"\\settings.json";
}

// Returns the directory containing this DLL. Used to locate the bundled
// web assets folder (mdWorX_assets/) which sits next to
// the DLL after install.
std::wstring GetDllDir() {
    wchar_t buf[MAX_PATH] = {};
    GetModuleFileNameW(g_hInstance, buf, MAX_PATH);
    PathRemoveFileSpecW(buf);
    return buf;
}

std::wstring GetAssetsDir() {
    std::wstring d = GetDllDir();
    if (d.empty()) return L"";
    d += L"\\mdWorX_assets";
    return d;
}

std::wstring GetParentDir(const std::wstring& path) {
    size_t pos = path.find_last_of(L"\\/");
    if (pos == std::wstring::npos) return L"";
    return path.substr(0, pos);
}

// Read a UTF-8 (optionally BOM-prefixed) file from disk and return its
// content as a wide string. Returns empty string on failure or if the file
// exceeds the 50 MiB sanity cap (no markdown file should approach that).
std::wstring ReadFileUtf8(const std::wstring& path) {
    HANDLE h = CreateFileW(path.c_str(), GENERIC_READ,
                            FILE_SHARE_READ | FILE_SHARE_WRITE,
                            nullptr, OPEN_EXISTING,
                            FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return L"";

    LARGE_INTEGER sz{};
    if (!GetFileSizeEx(h, &sz) || sz.QuadPart > (50LL * 1024 * 1024)) {
        CloseHandle(h);
        return L"";
    }

    std::string raw(static_cast<size_t>(sz.QuadPart), '\0');
    DWORD bytesRead = 0;
    BOOL ok = ReadFile(h, raw.data(), static_cast<DWORD>(raw.size()),
                       &bytesRead, nullptr);
    CloseHandle(h);
    if (!ok) return L"";
    if (bytesRead != raw.size()) raw.resize(bytesRead);

    // Strip UTF-8 BOM if present.
    if (raw.size() >= 3
        && static_cast<uint8_t>(raw[0]) == 0xEF
        && static_cast<uint8_t>(raw[1]) == 0xBB
        && static_cast<uint8_t>(raw[2]) == 0xBF) {
        raw.erase(0, 3);
    }

    int wlen = MultiByteToWideChar(CP_UTF8, 0, raw.c_str(),
                                    static_cast<int>(raw.size()),
                                    nullptr, 0);
    if (wlen <= 0) {
        // Fall back to ANSI / system codepage so we still show something
        // for files that aren't valid UTF-8.
        wlen = MultiByteToWideChar(CP_ACP, 0, raw.c_str(),
                                    static_cast<int>(raw.size()),
                                    nullptr, 0);
        std::wstring wide(static_cast<size_t>(wlen), L'\0');
        MultiByteToWideChar(CP_ACP, 0, raw.c_str(),
                            static_cast<int>(raw.size()),
                            wide.data(), wlen);
        return wide;
    }
    std::wstring wide(static_cast<size_t>(wlen), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, raw.c_str(),
                        static_cast<int>(raw.size()),
                        wide.data(), wlen);
    return wide;
}

// ---------------------------------------------------------------------------
// Settings string extractor (bounded, NOT a general JSON parser)
//
// Extracts the string value for a single top-level key from the user's
// settings.json. Pattern-matches "<key>"\s*:\s*"<value>" and unescapes
// the common JSON escapes (\", \\, \/, \n, \r, \t). Encoding values are
// ASCII so unescape coverage is intentionally minimal. Returns empty
// string if the key is absent, non-string, or the file is malformed.
//
// This deliberately stays narrow: we only use it for the 'encoding' and
// 'fallbackEncoding' keys which native must read BEFORE the file load
// happens (so we can't punt them to the JS layer like the CSS settings).
// KEY DECISION 15 (no native JSON parser) still holds for the rest of
// the settings file.
std::wstring ExtractJsonStringKey(const std::wstring& json, const wchar_t* key) {
    auto isWs = [](wchar_t c) {
        return c == L' ' || c == L'\t' || c == L'\n' || c == L'\r';
    };
    std::wstring needle = L"\"";
    needle += key;
    needle += L"\"";
    size_t pos = 0;
    while ((pos = json.find(needle, pos)) != std::wstring::npos) {
        size_t after = pos + needle.size();
        while (after < json.size() && isWs(json[after])) ++after;
        if (after >= json.size() || json[after] != L':') {
            pos = after;
            continue;
        }
        ++after;
        while (after < json.size() && isWs(json[after])) ++after;
        if (after >= json.size() || json[after] != L'"') return L"";  // null/number/bool
        ++after;
        std::wstring out;
        while (after < json.size() && json[after] != L'"') {
            if (json[after] == L'\\' && after + 1 < json.size()) {
                wchar_t esc = json[after + 1];
                // \uXXXX: decode four hex digits to a wchar (handles JSON
                // engines that escape control chars and high BMP chars).
                if (esc == L'u' && after + 5 < json.size()) {
                    wchar_t hex[5] = {
                        json[after + 2], json[after + 3],
                        json[after + 4], json[after + 5], 0,
                    };
                    wchar_t* endp = nullptr;
                    unsigned long v = wcstoul(hex, &endp, 16);
                    if (endp == hex + 4) {
                        out += static_cast<wchar_t>(v);
                        after += 6;
                        continue;
                    }
                }
                switch (esc) {
                    case L'"':  out += L'"';  break;
                    case L'\\': out += L'\\'; break;
                    case L'/':  out += L'/';  break;
                    case L'n':  out += L'\n'; break;
                    case L'r':  out += L'\r'; break;
                    case L't':  out += L'\t'; break;
                    case L'b':  out += L'\b'; break;
                    case L'f':  out += L'\f'; break;
                    default:    out += esc;   break;
                }
                after += 2;
            } else {
                out += json[after++];
            }
        }
        return out;
    }
    return L"";
}

// ---------------------------------------------------------------------------
// Encoding handling
//
// Resolution order for reading a markdown file:
//   1. Honour explicit user 'encoding' setting if set and not "auto".
//   2. Sniff BOM (UTF-8, UTF-16 LE, UTF-16 BE) and use it.
//   3. Strict UTF-8 attempt (MB_ERR_INVALID_CHARS — rejects mojibake).
//   4. Fall back to user 'fallbackEncoding' setting (default: system codepage).
//
// Why strict UTF-8 in step 3: the default MultiByteToWideChar(CP_UTF8, 0)
// silently substitutes invalid sequences with replacement characters, so a
// CP1252 file with an `©` (0xA9) renders as garbage with no signal that
// we picked the wrong encoding. MB_ERR_INVALID_CHARS makes the decoder
// REFUSE invalid input, giving us a clean signal to try the fallback.

enum DecodeKind {
    DK_INVALID,    // unrecognised name
    DK_AUTO,       // resolve via BOM + strict UTF-8 + fallback
    DK_UTF8,
    DK_UTF16LE,
    DK_UTF16BE,
    DK_CODEPAGE,   // codepage member valid
};

struct EncodingChoice {
    DecodeKind kind;
    UINT       codepage;
};

// Case-insensitive, ignores '_' and '-' for tolerance (so 'utf-8',
// 'utf_8' and 'UTF8' all resolve the same).
EncodingChoice ParseEncodingName(const std::wstring& name) {
    std::wstring n;
    n.reserve(name.size());
    for (wchar_t c : name) {
        if (c == L'_' || c == L'-') continue;
        n += static_cast<wchar_t>(towlower(c));
    }
    if (n.empty() || n == L"auto")                                          return {DK_AUTO,     0};
    if (n == L"utf8")                                                       return {DK_UTF8,     0};
    if (n == L"utf16" || n == L"utf16le")                                   return {DK_UTF16LE,  0};
    if (n == L"utf16be")                                                    return {DK_UTF16BE,  0};
    if (n == L"system" || n == L"ansi")                                     return {DK_CODEPAGE, CP_ACP};
    if (n == L"oem")                                                        return {DK_CODEPAGE, CP_OEMCP};
    if (n == L"cp1250" || n == L"windows1250")                              return {DK_CODEPAGE, 1250};
    if (n == L"cp1251" || n == L"windows1251")                              return {DK_CODEPAGE, 1251};
    if (n == L"cp1252" || n == L"windows1252")                              return {DK_CODEPAGE, 1252};
    if (n == L"cp1253" || n == L"windows1253")                              return {DK_CODEPAGE, 1253};
    if (n == L"cp1254" || n == L"windows1254")                              return {DK_CODEPAGE, 1254};
    if (n == L"cp1255" || n == L"windows1255")                              return {DK_CODEPAGE, 1255};
    if (n == L"cp1256" || n == L"windows1256")                              return {DK_CODEPAGE, 1256};
    if (n == L"cp1257" || n == L"windows1257")                              return {DK_CODEPAGE, 1257};
    if (n == L"cp1258" || n == L"windows1258")                              return {DK_CODEPAGE, 1258};
    if (n == L"iso88591"  || n == L"latin1")                                return {DK_CODEPAGE, 28591};
    if (n == L"iso88592"  || n == L"latin2")                                return {DK_CODEPAGE, 28592};
    if (n == L"iso885915" || n == L"latin9")                                return {DK_CODEPAGE, 28605};
    if (n == L"shiftjis" || n == L"sjis" || n == L"cp932" || n == L"windows932") return {DK_CODEPAGE, 932};
    if (n == L"gbk"      || n == L"cp936" || n == L"gb2312")                return {DK_CODEPAGE, 936};
    if (n == L"big5"     || n == L"cp950")                                  return {DK_CODEPAGE, 950};
    if (n == L"euckr"    || n == L"cp949")                                  return {DK_CODEPAGE, 949};
    if (n == L"koi8r")                                                      return {DK_CODEPAGE, 20866};
    if (n == L"koi8u")                                                      return {DK_CODEPAGE, 21866};
    return {DK_INVALID, 0};
}

std::wstring DecodeCodepageBytes(const BYTE* bytes, size_t len, UINT cp, DWORD flags) {
    if (len == 0) return L"";
    int wlen = MultiByteToWideChar(cp, flags,
                                    reinterpret_cast<LPCCH>(bytes),
                                    static_cast<int>(len),
                                    nullptr, 0);
    if (wlen <= 0) return L"";
    std::wstring out(static_cast<size_t>(wlen), L'\0');
    MultiByteToWideChar(cp, flags,
                        reinterpret_cast<LPCCH>(bytes),
                        static_cast<int>(len),
                        out.data(), wlen);
    return out;
}

// Windows wchar_t is already UTF-16 LE so the LE decoder is a memcpy.
std::wstring DecodeUtf16LE(const BYTE* bytes, size_t len) {
    size_t wlen = len / 2;
    std::wstring out(wlen, L'\0');
    if (wlen) memcpy(out.data(), bytes, wlen * 2);
    return out;
}

// UTF-16 BE: byteswap each pair into native LE.
std::wstring DecodeUtf16BE(const BYTE* bytes, size_t len) {
    size_t wlen = len / 2;
    std::wstring out(wlen, L'\0');
    for (size_t i = 0; i < wlen; ++i) {
        out[i] = static_cast<wchar_t>((bytes[i*2] << 8) | bytes[i*2 + 1]);
    }
    return out;
}

// Read a file as a binary blob with a 100 MiB sanity cap (well above any
// realistic image referenced from a markdown document).
std::vector<BYTE> ReadFileBytes(const std::wstring& path) {
    HANDLE h = CreateFileW(path.c_str(), GENERIC_READ,
                            FILE_SHARE_READ | FILE_SHARE_WRITE,
                            nullptr, OPEN_EXISTING,
                            FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return {};
    LARGE_INTEGER sz{};
    if (!GetFileSizeEx(h, &sz) || sz.QuadPart > (100LL * 1024 * 1024)) {
        CloseHandle(h);
        return {};
    }
    std::vector<BYTE> buf(static_cast<size_t>(sz.QuadPart));
    DWORD bytesRead = 0;
    BOOL ok = ReadFile(h, buf.data(), static_cast<DWORD>(buf.size()),
                       &bytesRead, nullptr);
    CloseHandle(h);
    if (!ok) return {};
    buf.resize(bytesRead);
    return buf;
}

// Read the user's encoding preferences out of settings.json. Called per
// file load; settings.json is tiny so the cost is dwarfed by the markdown
// read itself.
EncodingChoice ResolveUserEncoding(const wchar_t* key, EncodingChoice fallbackForInvalid) {
    std::wstring sp = GetUserSettingsPath();
    if (sp.empty()) return fallbackForInvalid;
    std::vector<BYTE> sb = ReadFileBytes(sp);
    if (sb.empty()) return fallbackForInvalid;
    // settings.json is always UTF-8 (the JS layer writes it). Decode loosely
    // here — strict mode would refuse a file with a stray invalid byte and
    // we'd lose the encoding setting along with the visual ones.
    std::wstring text = DecodeCodepageBytes(sb.data(), sb.size(), CP_UTF8, 0);
    std::wstring val  = ExtractJsonStringKey(text, key);
    EncodingChoice c = ParseEncodingName(val);
    return (c.kind == DK_INVALID) ? fallbackForInvalid : c;
}

// Stable string form of an EncodingChoice that JS can match on. Mirrors
// the names ParseEncodingName accepts. utf-8 + utf-8-bom are distinguished
// so save can preserve the original BOM (or its absence) when round-tripping.
struct DecodedFile {
    std::wstring text;
    EncodingChoice encoding{DK_AUTO, 0};
    bool hadBOM = false;
};

std::wstring EncodingChoiceToName(EncodingChoice c, bool hadBOM) {
    switch (c.kind) {
        case DK_UTF8:    return hadBOM ? L"utf-8-bom" : L"utf-8";
        case DK_UTF16LE: return L"utf-16le";
        case DK_UTF16BE: return L"utf-16be";
        case DK_CODEPAGE:
            switch (c.codepage) {
                case CP_ACP:    return L"system";
                case 1250: return L"cp1250"; case 1251: return L"cp1251";
                case 1252: return L"cp1252"; case 1253: return L"cp1253";
                case 1254: return L"cp1254"; case 1255: return L"cp1255";
                case 1256: return L"cp1256"; case 1257: return L"cp1257";
                case 1258: return L"cp1258";
                case 28591: return L"iso-8859-1";
                case 28592: return L"iso-8859-2";
                case 28605: return L"iso-8859-15";
                case 932:  return L"shift-jis";
                case 936:  return L"gbk";
                case 950:  return L"big5";
                case 949:  return L"euc-kr";
                case 20866: return L"koi8-r";
                case 21866: return L"koi8-u";
                default: {
                    wchar_t buf[16];
                    swprintf_s(buf, L"cp%u", c.codepage);
                    return buf;
                }
            }
        default: return L"unknown";
    }
}

// Read a markdown file with full encoding handling. Resolution order
// matches the SETTINGS SCHEMA in HANDOVER.md (see ReadFileWithEncoding
// docs above the helpers). Returns the decoded text plus the encoding
// kind that was actually used (so save can round-trip).
DecodedFile ReadFileDecoded(const std::wstring& path) {
    DecodedFile out;
    std::vector<BYTE> raw = ReadFileBytes(path);
    if (raw.empty()) return out;

    EncodingChoice chosen   = ResolveUserEncoding(L"encoding",        {DK_AUTO, 0});
    EncodingChoice fallback = ResolveUserEncoding(L"fallbackEncoding", {DK_CODEPAGE, CP_ACP});
    if (fallback.kind == DK_AUTO || fallback.kind == DK_INVALID) {
        fallback = {DK_CODEPAGE, CP_ACP};
    }

    // Explicit user encoding: honour it directly, but still strip a leading
    // BOM if present (e.g. user picked 'utf-8' on a BOM'd file).
    if (chosen.kind != DK_AUTO) {
        const BYTE* p = raw.data();
        size_t      n = raw.size();
        bool bom = false;
        switch (chosen.kind) {
            case DK_UTF8:
                if (n >= 3 && p[0]==0xEF && p[1]==0xBB && p[2]==0xBF) { p += 3; n -= 3; bom = true; }
                out.text = DecodeCodepageBytes(p, n, CP_UTF8, 0);
                break;
            case DK_UTF16LE:
                if (n >= 2 && p[0]==0xFF && p[1]==0xFE) { p += 2; n -= 2; bom = true; }
                out.text = DecodeUtf16LE(p, n);
                break;
            case DK_UTF16BE:
                if (n >= 2 && p[0]==0xFE && p[1]==0xFF) { p += 2; n -= 2; bom = true; }
                out.text = DecodeUtf16BE(p, n);
                break;
            case DK_CODEPAGE:
                out.text = DecodeCodepageBytes(p, n, chosen.codepage, 0);
                break;
            default: break;
        }
        out.encoding = chosen;
        out.hadBOM = bom;
        return out;
    }

    // Auto: sniff BOM.
    if (raw.size() >= 3 && raw[0]==0xEF && raw[1]==0xBB && raw[2]==0xBF) {
        out.text = DecodeCodepageBytes(raw.data() + 3, raw.size() - 3, CP_UTF8, 0);
        out.encoding = {DK_UTF8, 0};
        out.hadBOM = true;
        return out;
    }
    if (raw.size() >= 2 && raw[0]==0xFF && raw[1]==0xFE) {
        out.text = DecodeUtf16LE(raw.data() + 2, raw.size() - 2);
        out.encoding = {DK_UTF16LE, 0};
        out.hadBOM = true;
        return out;
    }
    if (raw.size() >= 2 && raw[0]==0xFE && raw[1]==0xFF) {
        out.text = DecodeUtf16BE(raw.data() + 2, raw.size() - 2);
        out.encoding = {DK_UTF16BE, 0};
        out.hadBOM = true;
        return out;
    }

    // No BOM. Try strict UTF-8 — succeeds on pure ASCII or valid UTF-8,
    // refuses anything else.
    std::wstring strict = DecodeCodepageBytes(raw.data(), raw.size(),
                                              CP_UTF8, MB_ERR_INVALID_CHARS);
    if (!strict.empty()) {
        out.text = std::move(strict);
        out.encoding = {DK_UTF8, 0};
        out.hadBOM = false;
        return out;
    }

    // Strict UTF-8 rejected the content — fall through to the user's
    // fallback encoding (defaults to system codepage / CP_ACP).
    out.text = DecodeCodepageBytes(raw.data(), raw.size(), fallback.codepage, 0);
    out.encoding = fallback;
    out.hadBOM = false;
    return out;
}

// Backwards-compatible wrapper for code paths that don't care about the
// chosen encoding (none right now, but kept as a convenience).
std::wstring ReadFileWithEncoding(const std::wstring& path) {
    return ReadFileDecoded(path).text;
}

// Map file extension to MIME type for the handful of formats markdown
// images normally use. Anything else falls back to octet-stream and the
// browser tries to sniff.
std::wstring GuessContentType(const std::wstring& path) {
    LPCWSTR ext = PathFindExtensionW(path.c_str());
    if (!ext || !*ext) return L"application/octet-stream";
    std::wstring e = ext;
    for (auto& c : e) c = static_cast<wchar_t>(towlower(c));
    if (e == L".png")  return L"image/png";
    if (e == L".jpg" || e == L".jpeg") return L"image/jpeg";
    if (e == L".gif")  return L"image/gif";
    if (e == L".webp") return L"image/webp";
    if (e == L".svg")  return L"image/svg+xml";
    if (e == L".bmp")  return L"image/bmp";
    if (e == L".ico")  return L"image/x-icon";
    if (e == L".avif") return L"image/avif";
    if (e == L".apng") return L"image/apng";
    return L"application/octet-stream";
}

// Minimal %XX URL decoder for path components.
std::wstring UrlDecodePath(const std::wstring& s) {
    auto hexv = [](wchar_t c) -> int {
        if (c >= L'0' && c <= L'9') return c - L'0';
        if (c >= L'a' && c <= L'f') return c - L'a' + 10;
        if (c >= L'A' && c <= L'F') return c - L'A' + 10;
        return -1;
    };
    std::wstring out;
    out.reserve(s.size());
    for (size_t i = 0; i < s.size(); ++i) {
        if (s[i] == L'%' && i + 2 < s.size()) {
            int h = hexv(s[i + 1]);
            int l = hexv(s[i + 2]);
            if (h >= 0 && l >= 0) {
                out += static_cast<wchar_t>((h << 4) | l);
                i += 2;
                continue;
            }
        }
        out += s[i];
    }
    return out;
}

// Reject paths that try to escape the file's directory or specify another
// drive. We only ever serve files inside the markdown file's parent dir.
bool IsSafeRelativePath(const std::wstring& p) {
    if (p.empty()) return false;
    if (p.find(L"..") != std::wstring::npos) return false;
    if (p[0] == L'\\' || p[0] == L'/') return false;
    if (p.size() >= 2 && p[1] == L':')  return false;  // C:\...
    return true;
}

// JSON-escape a wide string for use as a JSON string value (without quotes).
// Handles the mandatory characters per RFC 8259: ", \, control characters.
std::wstring JsonEscape(const std::wstring& s) {
    std::wstring out;
    out.reserve(s.size() + 16);
    for (wchar_t c : s) {
        switch (c) {
            case L'"':  out += L"\\\""; break;
            case L'\\': out += L"\\\\"; break;
            case L'\b': out += L"\\b";  break;
            case L'\f': out += L"\\f";  break;
            case L'\n': out += L"\\n";  break;
            case L'\r': out += L"\\r";  break;
            case L'\t': out += L"\\t";  break;
            default:
                if (static_cast<unsigned>(c) < 0x20) {
                    wchar_t buf[8];
                    StringCchPrintfW(buf, 8, L"\\u%04x",
                                     static_cast<int>(c));
                    out += buf;
                } else {
                    out += c;
                }
                break;
        }
    }
    return out;
}

// DPI awareness scope: forces per-monitor V2 on the current thread when the
// inherited context is UNAWARE or NULL. Critical for hosting WebView2 in a
// third-party process where we can't control the host's manifest.
//
// Rationale: WebView2's CreateCoreWebView2Controller returns E_UNEXPECTED
// when called on a thread with DPI_AWARENESS_CONTEXT_UNAWARE
// (MicrosoftEdge/WebView2Feedback#2234). Must wrap every WebView2 entry
// point (env creation, controller creation, controller methods that touch
// HWNDs).
class DpiScope {
    DPI_AWARENESS_CONTEXT prev_ = nullptr;
    bool restore_ = false;
public:
    DpiScope() {
        DPI_AWARENESS_CONTEXT current = GetThreadDpiAwarenessContext();
        bool needsOverride = (current == nullptr) ||
            AreDpiAwarenessContextsEqual(current, DPI_AWARENESS_CONTEXT_UNAWARE);
        if (needsOverride) {
            DPI_AWARENESS_CONTEXT p =
                SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            if (p != nullptr) {
                prev_ = p;
                restore_ = true;
            }
            // If SetThreadDpiAwarenessContext returned NULL the host process
            // forbids the override (manifest declares a lower max awareness).
            // Continue at the host's awareness; WebView2 will degrade
            // gracefully rather than fail outright.
        }
    }
    ~DpiScope() {
        if (restore_ && prev_ != nullptr) {
            SetThreadDpiAwarenessContext(prev_);
        }
    }
    DpiScope(const DpiScope&) = delete;
    DpiScope& operator=(const DpiScope&) = delete;
};

// Placeholder HTML loaded while real rendering is wired up.
//
// Theming: native sends {type:'theme', mode:'dark'|'light', paneBg:'#rrggbb'}.
// JS toggles a body class to switch our PREDEFINED palette rather than
// inheriting the host's raw colour directly. Reasoning: if DOpus's pane
// background is set to something unusual, mirroring it verbatim produces an
// ugly viewer. We use DOpus's colour only to detect dark vs light intent
// (and to tint the surrounding chrome), then apply tasteful palettes of our
// own choosing.
LPCWSTR kHelloPage =
    L"<!doctype html>"
    L"<html><head><meta charset='utf-8'><style>"
    L":root { color-scheme: light dark; --pane-bg: transparent; }"
    L"html,body { margin:0; padding:0; height:100%; width:100%; "
    L"  font-family: 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif; "
    L"  -webkit-font-smoothing: antialiased; }"

    // Light theme (default)
    L"body.theme-light { "
    L"  --pane:    #ecebe6; "          // chrome around the page
    L"  --page:    #fbfaf5; "          // page surface (paper)
    L"  --ink:     #1c1c1a; "          // primary text
    L"  --ink-soft:#535351; "
    L"  --rule:    #d9d6cd; "          // hairlines
    L"  --code:    rgba(0,0,0,0.045); "
    L"  --link:    #2a5fb8; "
    L"  --accent:  #b8742a; "
    L"} "

    // Dark theme
    L"body.theme-dark { "
    L"  --pane:    #1b1b1d; "
    L"  --page:    #26262a; "          // slightly lifted from pane
    L"  --ink:     #ececec; "
    L"  --ink-soft:#9b9b9b; "
    L"  --rule:    #38383c; "
    L"  --code:    rgba(255,255,255,0.07); "
    L"  --link:    #7ab7ff; "
    L"  --accent:  #f4a261; "
    L"} "

    // Layout: pane fills the host, page is centred inside with a max width
    // and breathing room. On a narrow pane the page fills the available
    // width (with edge padding) instead of being cramped on a max-width.
    L"body { background: var(--pane-bg, var(--pane)); "
    L"  color: var(--ink); display: flex; align-items: stretch; "
    L"  justify-content: center; overflow: auto; }"
    L".page { background: var(--page); width: 100%; max-width: 760px; "
    L"  margin: 24px 16px; padding: 32px 40px; "
    L"  border: 1px solid var(--rule); "
    L"  box-shadow: 0 1px 2px rgba(0,0,0,0.05), 0 2px 12px rgba(0,0,0,0.04); "
    L"  border-radius: 6px; box-sizing: border-box; "
    L"  min-height: calc(100% - 48px); }"

    // Placeholder content styling (will be replaced by real markdown styles)
    L".chip { font-size: 10px; letter-spacing: 0.12em; "
    L"  text-transform: uppercase; color: var(--accent); "
    L"  margin-bottom: 18px; font-weight: 600; }"
    L"h1 { font-size: 22px; font-weight: 600; margin: 0 0 16px; "
    L"  color: var(--ink); letter-spacing: -0.01em; }"
    L"p { margin: 0 0 12px; line-height: 1.55; color: var(--ink-soft); }"
    L".file { margin-top: 24px; padding: 10px 14px; "
    L"  background: var(--code); border-left: 3px solid var(--accent); "
    L"  font-family: 'Cascadia Code', ui-monospace, Consolas, monospace; "
    L"  font-size: 12px; word-break: break-all; color: var(--ink); }"
    L".file-label { display: block; font-size: 10px; "
    L"  letter-spacing: 0.1em; text-transform: uppercase; "
    L"  color: var(--ink-soft); margin-bottom: 4px; font-family: inherit; }"

    L"::selection { background: var(--link); color: var(--page); }"
    L"</style></head>"
    L"<body class='theme-light'><div class='page'>"
    L"<div class='chip'>mdWorX</div>"
    L"<h1>WebView2 hosting confirmed</h1>"
    L"<p>Native COM hosting in DOpus's lister pane works. Theme will follow "
    L"the pane's light/dark configuration. Real markdown rendering wires in next.</p>"
    L"<div class='file' id='file'>"
    L"<span class='file-label'>loaded file</span>(waiting for file)</div>"
    L"</div>"
    L"<script>"
    L"function setFile(p) {"
    L"  const el = document.getElementById('file');"
    L"  el.innerHTML = '';"
    L"  const lbl = document.createElement('span');"
    L"  lbl.className = 'file-label'; lbl.textContent = 'loaded file';"
    L"  el.appendChild(lbl);"
    L"  el.appendChild(document.createTextNode(p));"
    L"}"
    L"if (window.chrome && window.chrome.webview) {"
    L"  window.chrome.webview.addEventListener('message', e => {"
    L"    const m = e.data;"
    L"    if (m && m.type === 'load' && m.path) setFile(m.path);"
    L"    if (m && m.type === 'theme') {"
    L"      document.body.className = m.mode === 'dark' ? 'theme-dark' : 'theme-light';"
    L"      if (m.paneBg) document.documentElement.style.setProperty('--pane-bg', m.paneBg);"
    L"    }"
    L"  });"
    L"  window.chrome.webview.postMessage(JSON.stringify({type:'ready'}));"
    L"}"
    L"</script>"
    L"</body></html>";

// ---------------------------------------------------------------------------
// Per-viewer state

struct ViewerState {
    HWND hwndSelf       = nullptr;
    HWND hwndParent     = nullptr;
    std::wstring filePath;
    std::wstring currentFileDir;   // Updated each LOAD; used by /_local/ handler.
    COLORREF bgColour   = GetSysColor(COLOR_WINDOW);

    EncodingChoice lastReadEncoding{DK_AUTO, 0};
    bool           lastReadHadBOM = false;

    ComPtr<ICoreWebView2Environment> env;
    ComPtr<ICoreWebView2Controller>  controller;
    ComPtr<ICoreWebView2>            webview;
    EventRegistrationToken           webMessageToken{};
    EventRegistrationToken           resourceRequestedToken{};
    bool initInProgress  = false;
    bool initSucceeded   = false;
    bool destroyed       = false;
    std::wstring pendingFilePath;  // Set if LOAD arrives before init finishes.
};

inline ViewerState* GetState(HWND hwnd) {
    return reinterpret_cast<ViewerState*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
}
inline void SetState(HWND hwnd, ViewerState* s) {
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(s));
}

COLORREF QueryParentBgColour(HWND hwndParent) {
    NMHDR hdr = { nullptr, 0, DVPN_GETBGCOL };
    LRESULT r = SendMessageW(hwndParent, WM_NOTIFY, 0,
                             reinterpret_cast<LPARAM>(&hdr));
    return static_cast<COLORREF>(r);
}

// CSS-style "#rrggbb" from a Win32 COLORREF (BGR).
std::wstring CssHex(COLORREF c) {
    wchar_t buf[8];
    StringCchPrintfW(buf, 8, L"#%02x%02x%02x",
                     GetRValue(c), GetGValue(c), GetBValue(c));
    return buf;
}

// Classify a COLORREF as 'dark' or 'light' by luminance. Threshold tuned at
// 128/255 (standard mid-grey split). Pure greys near the threshold fall to
// the light side by inclusive comparison.
bool IsDarkBg(COLORREF bg) {
    int luma = (GetRValue(bg) * 299 + GetGValue(bg) * 587 + GetBValue(bg) * 114) / 1000;
    return luma < 128;
}

void PushThemeToWebView(ViewerState* state) {
    if (!state || !state->webview) return;
    // Send mode (dark|light) for the predefined palette, plus the raw pane
    // colour so the chrome around the inset page can tint to match DOpus.
    std::wstring msg = std::wstring(L"{\"type\":\"theme\",\"mode\":\"") +
        (IsDarkBg(state->bgColour) ? L"dark" : L"light") +
        L"\",\"paneBg\":\"" + CssHex(state->bgColour) + L"\"}";
    state->webview->PostWebMessageAsJson(msg.c_str());
}

// Read the user settings file as raw UTF-8 text and relay it to the web
// layer as a {type:'userSettings', json:'<rawtext>'} message. Missing or
// unreadable file -> empty string, the web layer falls back to bundled
// defaults. JSON validation happens in JS, not here.
void PushUserSettingsToWebView(ViewerState* state) {
    if (!state || !state->webview) return;
    std::wstring path = GetUserSettingsPath();
    std::wstring raw  = path.empty() ? L"" : ReadFileUtf8(path);
    std::wstring msg =
        L"{\"type\":\"userSettings\",\"json\":\"" + JsonEscape(raw) + L"\"}";
    state->webview->PostWebMessageAsJson(msg.c_str());
}

void PushFileToWebView(ViewerState* state, const std::wstring& path) {
    if (!state || !state->webview) return;

    // Record the file's directory so the WebResourceRequested handler
    // installed at controller init can resolve /_local/* paths.
    state->currentFileDir = GetParentDir(path);

    DecodedFile df = ReadFileDecoded(path);
    state->lastReadEncoding = df.encoding;
    state->lastReadHadBOM   = df.hadBOM;

    std::wstring encName = EncodingChoiceToName(df.encoding, df.hadBOM);
    std::wstring msg =
        L"{\"type\":\"load\",\"path\":\"" + JsonEscape(path) +
        L"\",\"encoding\":\""              + JsonEscape(encName) +
        L"\",\"content\":\""               + JsonEscape(df.text) + L"\"}";
    state->webview->PostWebMessageAsJson(msg.c_str());
}

void ResizeWebViewToClient(ViewerState* state) {
    if (!state || !state->controller) return;
    RECT rc{};
    GetClientRect(state->hwndSelf, &rc);
    state->controller->put_Bounds(rc);
}

// Atomic UTF-8 file write: writes to <path>.tmp then MoveFileEx replaces
// the original. WriteThrough flushes to disk so a crash mid-rename leaves
// either the old or new file intact (never both, never empty).
// addBOM prepends the UTF-8 BOM (EF BB BF) when the original file had one,
// so save round-trips encoding-as-stored. Returns false on any failure.
bool WriteUtf8FileAtomic(const std::wstring& path,
                          const std::wstring& text,
                          bool addBOM) {
    if (path.empty()) return false;
    std::wstring tmpPath = path + L".mdworx.tmp";

    int blen = WideCharToMultiByte(CP_UTF8, 0, text.c_str(),
                                   static_cast<int>(text.size()),
                                   nullptr, 0, nullptr, nullptr);
    if (blen < 0) return false;
    std::vector<BYTE> bytes;
    bytes.reserve((addBOM ? 3 : 0) + static_cast<size_t>(blen));
    if (addBOM) { bytes.push_back(0xEF); bytes.push_back(0xBB); bytes.push_back(0xBF); }
    if (blen > 0) {
        size_t off = bytes.size();
        bytes.resize(off + static_cast<size_t>(blen));
        WideCharToMultiByte(CP_UTF8, 0, text.c_str(),
                            static_cast<int>(text.size()),
                            reinterpret_cast<char*>(bytes.data() + off),
                            blen, nullptr, nullptr);
    }

    HANDLE h = CreateFileW(tmpPath.c_str(), GENERIC_WRITE, 0, nullptr,
                            CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return false;

    DWORD written = 0;
    BOOL ok = TRUE;
    if (!bytes.empty()) {
        ok = WriteFile(h, bytes.data(),
                       static_cast<DWORD>(bytes.size()),
                       &written, nullptr);
    }
    CloseHandle(h);
    if (!ok || written != bytes.size()) {
        DeleteFileW(tmpPath.c_str());
        return false;
    }

    return MoveFileExW(tmpPath.c_str(), path.c_str(),
                       MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) != FALSE;
}

// Helper to post a saveResult JSON back to the viewer page.
void PostSaveResult(ViewerState* state, bool ok, const wchar_t* error,
                    const std::wstring& encName) {
    if (!state || !state->webview) return;
    std::wstring msg = L"{\"type\":\"saveResult\",\"ok\":";
    msg += ok ? L"true" : L"false";
    if (!ok && error) {
        msg += L",\"error\":\"";
        msg += JsonEscape(error);
        msg += L"\"";
    }
    if (ok && !encName.empty()) {
        msg += L",\"encoding\":\"";
        msg += JsonEscape(encName);
        msg += L"\"";
    }
    msg += L"}";
    state->webview->PostWebMessageAsJson(msg.c_str());
}

// Helper to post a saveAsResult JSON back to the viewer page.
void PostSaveAsResult(ViewerState* state, bool ok, bool cancelled,
                      const std::wstring& newPath, const std::wstring& encName,
                      const wchar_t* error) {
    if (!state || !state->webview) return;
    std::wstring msg = L"{\"type\":\"saveAsResult\",\"ok\":";
    msg += ok ? L"true" : L"false";
    if (cancelled) msg += L",\"cancelled\":true";
    if (ok && !newPath.empty()) {
        msg += L",\"newPath\":\"";
        msg += JsonEscape(newPath);
        msg += L"\"";
    }
    if (ok && !encName.empty()) {
        msg += L",\"encoding\":\"";
        msg += JsonEscape(encName);
        msg += L"\"";
    }
    if (!ok && !cancelled && error) {
        msg += L",\"error\":\"";
        msg += JsonEscape(error);
        msg += L"\"";
    }
    msg += L"}";
    state->webview->PostWebMessageAsJson(msg.c_str());
}

// Save dispatch from a {type:'saveFile', path, content, encoding} message.
// MVP only handles utf-8 and utf-8-bom; other encodings fall through to an
// error response so the page can surface the limitation. The save target
// is always state->filePath, not the path the page sent — DOpus is the
// authority on which file this viewer is editing.
void HandleSaveFileMessage(ViewerState* state, const std::wstring& msg) {
    if (!state) return;
    if (state->filePath.empty()) {
        PostSaveResult(state, false, L"no file loaded", L"");
        return;
    }
    std::wstring encName = ExtractJsonStringKey(msg, L"encoding");
    if (encName.empty()) encName = L"utf-8";

    // MVP gate: only UTF-8 round-trips correctly. Other encodings need the
    // full save pipeline (#14) which re-encodes through the original codec.
    bool addBOM = false;
    {
        std::wstring lower = encName;
        for (auto& c : lower) c = static_cast<wchar_t>(towlower(c));
        if (lower == L"utf-8-bom") { addBOM = true; }
        else if (lower != L"utf-8") {
            PostSaveResult(state, false,
                L"save only supports utf-8 (and utf-8-bom) in this build", L"");
            return;
        }
    }

    std::wstring content = ExtractJsonStringKey(msg, L"content");
    // Empty content is a legitimate edit (e.g. user cleared the file).
    if (!WriteUtf8FileAtomic(state->filePath, content, addBOM)) {
        PostSaveResult(state, false, L"atomic write failed", L"");
        return;
    }
    PostSaveResult(state, true, nullptr, addBOM ? L"utf-8-bom" : L"utf-8");
}

// Save As dispatch from {type:'saveAs', suggestedPath, content, encoding}.
// Shows GetSaveFileNameW; on accept writes UTF-8 atomically and updates
// state->filePath to the chosen path so subsequent Save targets it.
void HandleSaveAsMessage(ViewerState* state, const std::wstring& msg) {
    if (!state) return;
    std::wstring encName = ExtractJsonStringKey(msg, L"encoding");
    if (encName.empty()) encName = L"utf-8";
    bool addBOM = false;
    {
        std::wstring lower = encName;
        for (auto& c : lower) c = static_cast<wchar_t>(towlower(c));
        if (lower == L"utf-8-bom") addBOM = true;
        else if (lower != L"utf-8") {
            PostSaveAsResult(state, false, false, L"", L"",
                L"save as only supports utf-8 in this build");
            return;
        }
    }

    // Pre-populate the dialog with the current file (or suggested) path so
    // the user lands in the right directory with a sensible default name.
    std::wstring suggested = ExtractJsonStringKey(msg, L"suggestedPath");
    if (suggested.empty()) suggested = state->filePath;

    wchar_t pathBuf[MAX_PATH] = {0};
    if (!suggested.empty()) {
        // Copy at most MAX_PATH-1 wchars; truncation is fine — the user
        // will see what we suggested and can edit before accepting.
        size_t n = std::min<size_t>(suggested.size(), MAX_PATH - 1);
        memcpy(pathBuf, suggested.c_str(), n * sizeof(wchar_t));
        pathBuf[n] = 0;
    }

    OPENFILENAMEW ofn{};
    ofn.lStructSize = sizeof(ofn);
    ofn.hwndOwner   = state->hwndSelf;
    ofn.lpstrFilter =
        L"Markdown (*.md;*.markdown;*.mdown)\0*.md;*.markdown;*.mdown\0"
        L"Text (*.txt)\0*.txt\0"
        L"All files (*.*)\0*.*\0";
    ofn.nFilterIndex = 1;
    ofn.lpstrFile    = pathBuf;
    ofn.nMaxFile     = MAX_PATH;
    ofn.lpstrDefExt  = L"md";
    ofn.Flags        = OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST
                     | OFN_HIDEREADONLY    | OFN_NOCHANGEDIR
                     | OFN_NOREADONLYRETURN;

    if (!GetSaveFileNameW(&ofn)) {
        DWORD err = CommDlgExtendedError();
        if (err == 0) {
            // User cancelled — not an error.
            PostSaveAsResult(state, false, true, L"", L"", nullptr);
        } else {
            PostSaveAsResult(state, false, false, L"", L"",
                L"save dialog failed");
        }
        return;
    }

    std::wstring chosen = pathBuf;
    std::wstring content = ExtractJsonStringKey(msg, L"content");
    if (!WriteUtf8FileAtomic(chosen, content, addBOM)) {
        PostSaveAsResult(state, false, false, L"", L"",
            L"atomic write failed");
        return;
    }

    // Adopt the new path so subsequent plain Save writes here too.
    state->filePath       = chosen;
    state->currentFileDir = GetParentDir(chosen);
    state->lastReadEncoding = addBOM ? EncodingChoice{DK_UTF8, 0}
                                     : EncodingChoice{DK_UTF8, 0};
    state->lastReadHadBOM   = addBOM;

    PostSaveAsResult(state, true, false, chosen,
                     addBOM ? L"utf-8-bom" : L"utf-8", nullptr);
}

// ---------------------------------------------------------------------------
// WebView2 lifecycle

HRESULT OnControllerCreated(ViewerState* state,
                            HRESULT result,
                            ICoreWebView2Controller* controller);

HRESULT InitWebView2(ViewerState* state) {
    if (!state || state->initInProgress) return S_FALSE;
    state->initInProgress = true;

    const std::wstring userDataFolder = GetUserDataFolder();
    if (userDataFolder.empty()) return E_FAIL;

    DpiScope dpi;  // Around the synchronous environment-creation call.

    HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
        /*browserExecutableFolder*/ nullptr,
        userDataFolder.c_str(),
        /*environmentOptions*/ nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [state](HRESULT envResult, ICoreWebView2Environment* env) -> HRESULT {
                // Callback fires on the message-pumped thread; the DPI scope
                // from InitWebView2's stack has already unwound by now.
                DpiScope dpi;
                if (state->destroyed) return S_OK;
                if (FAILED(envResult) || env == nullptr) {
                    state->initInProgress = false;
                    return envResult;
                }
                state->env = env;
                HRESULT cr = env->CreateCoreWebView2Controller(
                    state->hwndSelf,
                    Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                        [state](HRESULT controllerResult,
                                ICoreWebView2Controller* controller) -> HRESULT {
                            DpiScope dpi;  // Controller callback path.
                            return OnControllerCreated(state, controllerResult, controller);
                        }).Get());
                if (FAILED(cr)) state->initInProgress = false;
                return cr;
            }).Get());

    if (FAILED(hr)) state->initInProgress = false;
    return hr;
}

HRESULT OnControllerCreated(ViewerState* state,
                            HRESULT result,
                            ICoreWebView2Controller* controller) {
    if (!state) return E_FAIL;
    if (state->destroyed) {
        // Pane closed before controller arrived; tear down and bail.
        if (controller) controller->Close();
        return S_OK;
    }
    state->initInProgress = false;
    if (FAILED(result) || controller == nullptr) {
        return result;
    }

    state->controller = controller;
    if (FAILED(controller->get_CoreWebView2(&state->webview))) {
        return E_FAIL;
    }

    // Settings: enable scripting and the web-message bridge; disable browser
    // chrome we don't want in a viewer pane.
    ComPtr<ICoreWebView2Settings> settings;
    if (SUCCEEDED(state->webview->get_Settings(&settings))) {
        settings->put_IsScriptEnabled(TRUE);
        settings->put_IsWebMessageEnabled(TRUE);
        settings->put_AreDefaultScriptDialogsEnabled(TRUE);
        settings->put_IsStatusBarEnabled(FALSE);
        settings->put_AreDevToolsEnabled(TRUE);
        // Temporarily enable default context menus so right-click -> Inspect
        // works for diagnosing image / asset loading. Tighten before release.
        settings->put_AreDefaultContextMenusEnabled(TRUE);
        settings->put_IsZoomControlEnabled(FALSE);
    }

    // Map the bundled web assets folder to a stable virtual host so the
    // bundle's HTML/CSS/JS load via https:// rather than file://.
    ComPtr<ICoreWebView2_3> v3;
    bool haveBundle = false;
    if (SUCCEEDED(state->webview.As(&v3)) && v3) {
        std::wstring assetsDir = GetAssetsDir();
        if (!assetsDir.empty()) {
            DWORD attrs = GetFileAttributesW(assetsDir.c_str());
            if (attrs != INVALID_FILE_ATTRIBUTES &&
                (attrs & FILE_ATTRIBUTE_DIRECTORY)) {
                v3->SetVirtualHostNameToFolderMapping(
                    L"app.mdworx.test",
                    assetsDir.c_str(),
                    COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
                haveBundle = true;
            }
        }
    }

    // Local asset handler: serve every request to https://local.mdworx.test/
    // from the current markdown file's parent directory. This host has NO
    // SetVirtualHostNameToFolderMapping — that would shadow WRR per MS
    // WebView2Feedback #4201, #3038.
    state->webview->AddWebResourceRequestedFilter(
        L"https://local.mdworx.test/*",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);
    state->webview->add_WebResourceRequested(
        Callback<ICoreWebView2WebResourceRequestedEventHandler>(
            [state](ICoreWebView2*, ICoreWebView2WebResourceRequestedEventArgs* args) -> HRESULT {
                if (!state || !state->env) return S_OK;

                ComPtr<ICoreWebView2WebResourceRequest> req;
                if (FAILED(args->get_Request(&req)) || !req) return S_OK;

                LPWSTR rawUri = nullptr;
                if (FAILED(req->get_Uri(&rawUri)) || !rawUri) return S_OK;
                std::wstring uri = rawUri;
                CoTaskMemFree(rawUri);

                // Strip query/fragment so they don't end up in the file path.
                size_t q = uri.find_first_of(L"?#");
                if (q != std::wstring::npos) uri.resize(q);

                // Find the path-start (after scheme://host).
                size_t schemeEnd = uri.find(L"://");
                if (schemeEnd == std::wstring::npos) return S_OK;
                size_t pathStart = uri.find(L'/', schemeEnd + 3);
                if (pathStart == std::wstring::npos) return S_OK;
                std::wstring rel = uri.substr(pathStart + 1);  // strip leading /
                rel = UrlDecodePath(rel);

                auto respond404 = [&]() {
                    ComPtr<ICoreWebView2WebResourceResponse> resp;
                    state->env->CreateWebResourceResponse(
                        nullptr, 404, L"Not Found", L"Content-Type: text/plain",
                        &resp);
                    if (resp) args->put_Response(resp.Get());
                };

                if (rel.empty() || !IsSafeRelativePath(rel) ||
                    state->currentFileDir.empty()) {
                    respond404();
                    return S_OK;
                }

                for (auto& c : rel) if (c == L'/') c = L'\\';
                std::wstring fullPath = state->currentFileDir + L"\\" + rel;

                std::vector<BYTE> bytes = ReadFileBytes(fullPath);
                if (bytes.empty()) {
                    respond404();
                    return S_OK;
                }

                ComPtr<IStream> stream;
                stream.Attach(SHCreateMemStream(bytes.data(),
                                                static_cast<UINT>(bytes.size())));
                if (!stream) {
                    respond404();
                    return S_OK;
                }

                std::wstring ct = GuessContentType(fullPath);
                std::wstring headers =
                    L"Content-Type: " + ct +
                    L"\r\nCache-Control: no-cache"
                    L"\r\nAccess-Control-Allow-Origin: *";

                ComPtr<ICoreWebView2WebResourceResponse> resp;
                state->env->CreateWebResourceResponse(
                    stream.Get(), 200, L"OK", headers.c_str(), &resp);
                if (resp) args->put_Response(resp.Get());
                return S_OK;
            }).Get(),
        &state->resourceRequestedToken);

    // Bridge: web -> native messages arrive here.
    state->webview->add_WebMessageReceived(
        Callback<ICoreWebView2WebMessageReceivedEventHandler>(
            [state](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                LPWSTR raw = nullptr;
                if (FAILED(args->TryGetWebMessageAsString(&raw)) || !raw) {
                    return S_OK;
                }
                std::wstring msg = raw;
                CoTaskMemFree(raw);

                // {type:"ready"} -> push user settings, theme, (pending) file
                // in that order. Settings first so the override palette is
                // already on :root by the time the theme class applies and
                // the first paint resolves through the override.
                if (msg.find(L"\"ready\"") != std::wstring::npos) {
                    PushUserSettingsToWebView(state);
                    PushThemeToWebView(state);
                    if (!state->filePath.empty()) {
                        PushFileToWebView(state, state->filePath);
                    } else if (!state->pendingFilePath.empty()) {
                        state->filePath = state->pendingFilePath;
                        state->pendingFilePath.clear();
                        PushFileToWebView(state, state->filePath);
                    }
                    return S_OK;
                }

                // {type:"openExternal",url:"https://..."} -> hand off to the
                // user's default browser. Validate scheme to avoid being
                // tricked into executing arbitrary URI handlers from page
                // content.
                if (msg.find(L"\"openExternal\"") != std::wstring::npos) {
                    size_t urlPos = msg.find(L"\"url\":\"");
                    if (urlPos == std::wstring::npos) return S_OK;
                    size_t start = urlPos + 7;
                    size_t end = msg.find(L'\"', start);
                    if (end == std::wstring::npos) return S_OK;
                    std::wstring url = msg.substr(start, end - start);

                    // Minimal JSON unescape for what the bridge actually sends.
                    std::wstring unescaped;
                    unescaped.reserve(url.size());
                    for (size_t i = 0; i < url.size(); ++i) {
                        if (url[i] == L'\\' && i + 1 < url.size()) {
                            wchar_t n = url[i + 1];
                            switch (n) {
                                case L'\\': unescaped += L'\\'; ++i; continue;
                                case L'"':  unescaped += L'"';  ++i; continue;
                                case L'/':  unescaped += L'/';  ++i; continue;
                            }
                        }
                        unescaped += url[i];
                    }

                    if (unescaped.compare(0, 7, L"http://")  == 0 ||
                        unescaped.compare(0, 8, L"https://") == 0) {
                        ShellExecuteW(nullptr, L"open", unescaped.c_str(),
                                      nullptr, nullptr, SW_SHOWNORMAL);
                    }
                    return S_OK;
                }

                // {type:"saveFile",path:"...",content:"...",encoding:"utf-8"}
                // Editor save: write atomically, post saveResult back.
                if (msg.find(L"\"saveFile\"") != std::wstring::npos) {
                    HandleSaveFileMessage(state, msg);
                    return S_OK;
                }

                // {type:"saveAs",suggestedPath:"...",content:"...",encoding:"utf-8"}
                // Editor Save As: show file dialog, write atomically,
                // update current path, post saveAsResult back.
                if (msg.find(L"\"saveAs\"") != std::wstring::npos) {
                    HandleSaveAsMessage(state, msg);
                    return S_OK;
                }

                // {type:"openSettings"} - cog button in the top toolbar.
                // Forwards to DVP_Configure with the viewer pane as owner so
                // the settings dialog opens above DOpus the same way it does
                // when launched from Preferences -> Plugins -> Viewer.
                if (msg.find(L"\"openSettings\"") != std::wstring::npos) {
                    HWND owner = state->hwndSelf ? state->hwndSelf : state->hwndParent;
                    // hWndNotify = this pane's own hwnd. On Apply the dialog
                    // posts DVPLUGINMSG_REINITIALIZE here, which ViewerWndProc
                    // handles by re-reading settings.json + re-pushing to the
                    // webview (theme overrides, encoding choices, etc.). Going
                    // direct rather than via g_hwndDOpusMsg because DOpus's
                    // broadcast hub doesn't necessarily forward messages it
                    // didn't originate; the dialog→pane→webview path always
                    // works.
                    DVP_Configure(owner, state->hwndSelf, 0);
                    return S_OK;
                }

                return S_OK;
            }).Get(),
        &state->webMessageToken);

    // Bounds first, navigate second, per the docs (first paint sized correctly).
    ResizeWebViewToClient(state);
    if (haveBundle) {
        state->webview->Navigate(L"https://app.mdworx.test/index.html");
    } else {
        // Fallback: bundle missing (broken install). Show the inline page so
        // the failure is visible rather than a blank pane.
        state->webview->NavigateToString(kHelloPage);
    }
    state->initSucceeded = true;
    return S_OK;
}

void TeardownWebView2(ViewerState* state) {
    if (!state) return;
    if (state->webview) {
        if (state->webMessageToken.value != 0) {
            state->webview->remove_WebMessageReceived(state->webMessageToken);
            state->webMessageToken = {};
        }
        if (state->resourceRequestedToken.value != 0) {
            state->webview->remove_WebResourceRequested(state->resourceRequestedToken);
            state->resourceRequestedToken = {};
        }
    }
    if (state->controller) {
        state->controller->Close();
        state->controller.Reset();
    }
    state->webview.Reset();
    state->env.Reset();
}

// ---------------------------------------------------------------------------
// Window class + WndProc

LRESULT CALLBACK ViewerWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {

    case WM_CREATE: {
        auto* state = new ViewerState();
        state->hwndSelf   = hwnd;
        state->hwndParent = GetParent(hwnd);
        state->bgColour   = QueryParentBgColour(state->hwndParent);
        g_lastViewerBg    = state->bgColour;   // settings dialog reads this
        SetState(hwnd, state);

        // Best-effort COM init for the WebView2 callbacks. If COM is already
        // initialised on this thread with a compatible model, RPC_E_CHANGED_MODE
        // is returned and we leave it alone.
        CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

        InitWebView2(state);
        return 0;
    }

    case WM_DESTROY: {
        if (auto* state = GetState(hwnd)) {
            state->destroyed = true;
            TeardownWebView2(state);
            SetState(hwnd, nullptr);
            delete state;
        }
        return 0;
    }

    case WM_ERASEBKGND:
        // WebView2 fully paints our client; suppress the GDI erase to avoid
        // a momentary white flash before the renderer's first frame.
        return 1;

    case WM_PAINT: {
        // Brief solid fill before WebView2's first paint so we don't show
        // garbage if init is still in flight.
        auto* state = GetState(hwnd);
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);
        if (state) {
            RECT rc; GetClientRect(hwnd, &rc);
            HBRUSH br = CreateSolidBrush(state->bgColour);
            FillRect(hdc, &rc, br);
            DeleteObject(br);
        }
        EndPaint(hwnd, &ps);
        return 0;
    }

    case WM_SIZE: {
        if (auto* state = GetState(hwnd)) {
            if (state->controller) {
                if (wParam == SIZE_MINIMIZED) {
                    state->controller->put_IsVisible(FALSE);
                } else {
                    state->controller->put_IsVisible(TRUE);
                    ResizeWebViewToClient(state);
                }
            }
        }
        return 0;
    }

    case WM_MOVE:
    case WM_MOVING:
        if (auto* state = GetState(hwnd)) {
            if (state->controller) {
                state->controller->NotifyParentWindowPositionChanged();
            }
        }
        return 0;

    case WM_DPICHANGED:
    case WM_DPICHANGED_BEFOREPARENT:
    case WM_DPICHANGED_AFTERPARENT:
        if (auto* state = GetState(hwnd)) {
            if (state->controller) {
                ResizeWebViewToClient(state);
                state->controller->NotifyParentWindowPositionChanged();
            }
        }
        return 0;

    // --- DOpus messages ---------------------------------------------------

    case DVPLUGINMSG_LOADW: {
        auto* state = GetState(hwnd);
        if (!state) return FALSE;
        std::wstring path = reinterpret_cast<LPCWSTR>(lParam);
        if (state->webview) {
            state->filePath = path;
            PushFileToWebView(state, path);
        } else {
            // WebView2 still initialising; deliver on first 'ready' from JS.
            state->pendingFilePath = path;
        }
        return TRUE;
    }

    case DVPLUGINMSG_CLEAR: {
        auto* state = GetState(hwnd);
        if (!state) return 0;
        state->filePath.clear();
        state->pendingFilePath.clear();
        if (state->webview) {
            state->webview->PostWebMessageAsJson(L"{\"type\":\"clear\"}");
        }
        NMHDR hdr = { hwnd, 0, DVPN_CLEARED };
        SendMessageW(GetParent(hwnd), WM_NOTIFY, 0,
                     reinterpret_cast<LPARAM>(&hdr));
        return 0;
    }

    case DVPLUGINMSG_GETCAPABILITIES:
        // Only advertise capabilities we actually implement. HASDIALOGS /
        // HASACCELERATORS would make DOpus forward ISDLGMESSAGE and
        // TRANSLATEACCEL — we handle neither, and lying about it can let
        // DOpus consume keystrokes before WebView2 sees them.
        return VPCAPABILITY_WANTFOCUS
             | VPCAPABILITY_ADDCONTEXTMENU
             | VPCAPABILITY_CANTRACKFOCUS;

    case DVPLUGINMSG_REDRAW: {
        auto* state = GetState(hwnd);
        if (state && wParam) {
            state->bgColour = static_cast<COLORREF>(lParam);
            g_lastViewerBg  = state->bgColour;
            PushThemeToWebView(state);
        }
        InvalidateRect(hwnd, nullptr, FALSE);
        return 0;
    }

    case DVPLUGINMSG_REINITIALIZE: {
        // DOpus broadcasts this to every viewer instance whenever the
        // plugin posts REINITIALIZE to hWndDOpusMsgWindow (typically after
        // a config change). Re-read the user settings file and re-push to
        // this viewer's webview so visual overrides + theme refresh in
        // place. If a file is currently loaded, also re-read it so the
        // 'encoding' / 'fallbackEncoding' settings take effect on the
        // visible document instead of only on the next file load.
        if (auto* state = GetState(hwnd)) {
            PushUserSettingsToWebView(state);
            if (!state->filePath.empty()) {
                PushFileToWebView(state, state->filePath);
            }
        }
        return 0;
    }

    case DVPLUGINMSG_RESIZE: {
        int x = static_cast<short>(LOWORD(wParam));
        int y = static_cast<short>(HIWORD(wParam));
        int w = static_cast<short>(LOWORD(lParam));
        int h = static_cast<short>(HIWORD(lParam));
        SetWindowPos(hwnd, nullptr, x, y, w, h,
                     SWP_NOZORDER | SWP_NOACTIVATE);
        return 0;
    }

    case DVPLUGINMSG_GETPICSIZE:
        if (LPSIZE sz = reinterpret_cast<LPSIZE>(lParam)) sz->cx = sz->cy = 0;
        if (LPINT bits = reinterpret_cast<LPINT>(wParam)) *bits = 0;
        return FALSE;

    default:
        return DefWindowProcW(hwnd, msg, wParam, lParam);
    }
}

bool RegisterViewerWindowClass() {
    WNDCLASSEXW wc{};
    wc.cbSize        = sizeof(wc);
    wc.style         = CS_HREDRAW | CS_VREDRAW | CS_DBLCLKS;
    wc.lpfnWndProc   = ViewerWndProc;
    wc.hInstance     = g_hInstance;
    wc.hCursor       = LoadCursor(nullptr, IDC_ARROW);
    wc.hbrBackground = nullptr;
    wc.lpszClassName = kWindowClassName;

    ATOM atom = RegisterClassExW(&wc);
    if (atom == 0) {
        DWORD err = GetLastError();
        return err == ERROR_CLASS_ALREADY_EXISTS;
    }
    return true;
}

// ============================================================================
// Settings dialog (DVP_Configure target)
// ============================================================================
//
// DOpus invokes DVP_Configure when the user clicks the cog in the viewer
// pane bottom toolbar OR next to the plugin in Preferences. We return the
// HWND of a modeless WebView2-hosted settings window. The window is
// single-instance: re-clicking Configure focuses the existing window
// instead of spawning a second one.
//
// The web page (settings.html) renders form controls for every key in
// settings-defaults.json, fetches the current user settings, and on Apply
// posts {type:'saveSettings', json:'<rawtext>'} back. Native writes the
// file atomically and posts DVPLUGINMSG_REINITIALIZE to hWndNotify so
// DOpus broadcasts to every open viewer instance.

constexpr wchar_t kSettingsWindowClassName[] = L"mdWorXSettingsWnd";
constexpr wchar_t kSettingsWindowTitle[]     = L"mdWorX Settings";

HWND g_hwndSettings = nullptr;  // single-instance handle, or null

// Enumerate installed fonts via GDI for the settings dialog's font
// dropdown. DEFAULT_CHARSET means "all charsets"; the callback may emit
// the same family name multiple times (once per charset) so we dedupe
// at the end. Vertical-text variants prefixed '@' are filtered out
// because they're not useful for body prose.
int CALLBACK EnumFontFamProc(const LOGFONTW* lpelf, const TEXTMETRICW*,
                              DWORD, LPARAM lParam) {
    auto* list = reinterpret_cast<std::vector<std::wstring>*>(lParam);
    if (lpelf && lpelf->lfFaceName[0]) {
        list->emplace_back(lpelf->lfFaceName);
    }
    return 1;
}

std::vector<std::wstring> EnumerateSystemFonts() {
    std::vector<std::wstring> fonts;
    LOGFONTW lf{};
    lf.lfCharSet = DEFAULT_CHARSET;
    HDC hdc = GetDC(nullptr);
    if (hdc) {
        EnumFontFamiliesExW(hdc, &lf, EnumFontFamProc,
                            reinterpret_cast<LPARAM>(&fonts), 0);
        ReleaseDC(nullptr, hdc);
    }
    std::sort(fonts.begin(), fonts.end(),
              [](const std::wstring& a, const std::wstring& b) {
                  return _wcsicmp(a.c_str(), b.c_str()) < 0;
              });
    fonts.erase(std::unique(fonts.begin(), fonts.end(),
                            [](const std::wstring& a, const std::wstring& b) {
                                return _wcsicmp(a.c_str(), b.c_str()) == 0;
                            }), fonts.end());
    fonts.erase(std::remove_if(fonts.begin(), fonts.end(),
                                [](const std::wstring& s) {
                                    return !s.empty() && s[0] == L'@';
                                }), fonts.end());
    return fonts;
}

struct SettingsState {
    HWND hwndSelf      = nullptr;
    HWND hwndParent    = nullptr;   // DOpus passed this in DVP_Configure
    HWND hwndNotify    = nullptr;   // post REINITIALIZE here on Apply
    DWORD dwNotifyData = 0;          // lParam for the REINITIALIZE post

    ComPtr<ICoreWebView2Environment> env;
    ComPtr<ICoreWebView2Controller>  controller;
    ComPtr<ICoreWebView2>            webview;
    EventRegistrationToken           webMessageToken{};
    bool destroyed = false;
};

inline SettingsState* GetSettingsState(HWND hwnd) {
    return reinterpret_cast<SettingsState*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
}
inline void SetSettingsState(HWND hwnd, SettingsState* s) {
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(s));
}

void ResizeSettingsWebView(SettingsState* s) {
    if (!s || !s->controller) return;
    RECT rc{};
    GetClientRect(s->hwndSelf, &rc);
    s->controller->put_Bounds(rc);
}

// Atomic write of UTF-8 text to the user settings file. Writes to a
// sibling .tmp file then MoveFileEx with REPLACE_EXISTING. The wide-string
// input is converted to UTF-8 bytes before writing. Returns false on any
// step failure; caller decides whether to surface the error.
bool WriteUserSettingsAtomic(const std::wstring& settingsText) {
    std::wstring path = GetUserSettingsPath();
    if (path.empty()) return false;
    std::wstring tmpPath = path + L".tmp";

    int blen = WideCharToMultiByte(CP_UTF8, 0, settingsText.c_str(),
                                    static_cast<int>(settingsText.size()),
                                    nullptr, 0, nullptr, nullptr);
    if (blen < 0) return false;
    std::vector<char> bytes(static_cast<size_t>(blen));
    if (blen > 0) {
        WideCharToMultiByte(CP_UTF8, 0, settingsText.c_str(),
                            static_cast<int>(settingsText.size()),
                            bytes.data(), blen, nullptr, nullptr);
    }

    HANDLE h = CreateFileW(tmpPath.c_str(), GENERIC_WRITE, 0, nullptr,
                            CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return false;

    DWORD written = 0;
    BOOL ok = WriteFile(h, bytes.data(),
                        static_cast<DWORD>(bytes.size()),
                        &written, nullptr);
    CloseHandle(h);
    if (!ok || written != bytes.size()) {
        DeleteFileW(tmpPath.c_str());
        return false;
    }

    return MoveFileExW(tmpPath.c_str(), path.c_str(),
                       MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) != FALSE;
}

HRESULT OnSettingsControllerCreated(SettingsState* s,
                                    HRESULT result,
                                    ICoreWebView2Controller* controller) {
    if (!s) return E_FAIL;
    if (s->destroyed) {
        if (controller) controller->Close();
        return S_OK;
    }
    if (FAILED(result) || controller == nullptr) return result;

    s->controller = controller;
    if (FAILED(controller->get_CoreWebView2(&s->webview))) return E_FAIL;

    ComPtr<ICoreWebView2Settings> settings;
    if (SUCCEEDED(s->webview->get_Settings(&settings))) {
        settings->put_IsScriptEnabled(TRUE);
        settings->put_IsWebMessageEnabled(TRUE);
        settings->put_AreDefaultScriptDialogsEnabled(TRUE);
        settings->put_IsStatusBarEnabled(FALSE);
        settings->put_AreDevToolsEnabled(TRUE);
        settings->put_AreDefaultContextMenusEnabled(TRUE);
        settings->put_IsZoomControlEnabled(FALSE);
    }

    // Same vhost mapping as the viewer so settings.html can fetch from
    // the bundle (settings-defaults.json, viewer.css for shared styling).
    ComPtr<ICoreWebView2_3> v3;
    bool haveBundle = false;
    if (SUCCEEDED(s->webview.As(&v3)) && v3) {
        std::wstring assetsDir = GetAssetsDir();
        if (!assetsDir.empty()) {
            DWORD attrs = GetFileAttributesW(assetsDir.c_str());
            if (attrs != INVALID_FILE_ATTRIBUTES &&
                (attrs & FILE_ATTRIBUTE_DIRECTORY)) {
                v3->SetVirtualHostNameToFolderMapping(
                    L"app.mdworx.test",
                    assetsDir.c_str(),
                    COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
                haveBundle = true;
            }
        }
    }

    // Settings-only message bridge. Settings page sends:
    //   {type:'settingsReady'}                  — request the current user
    //                                             settings JSON so the form
    //                                             can populate.
    //   {type:'saveSettings', json:'<rawtext>'} — write to disk + ask
    //                                             DOpus to reinitialise
    //                                             every open viewer.
    //   {type:'closeSettings'}                  — dismiss the dialog.
    s->webview->add_WebMessageReceived(
        Callback<ICoreWebView2WebMessageReceivedEventHandler>(
            [s](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                LPWSTR raw = nullptr;
                if (FAILED(args->TryGetWebMessageAsString(&raw)) || !raw) return S_OK;
                std::wstring msg = raw;
                CoTaskMemFree(raw);

                if (msg.find(L"\"settingsReady\"") != std::wstring::npos) {
                    // Push the current user settings file contents back
                    // (same shape as the viewer's userSettings message so
                    // the JS side can reuse parsing logic).
                    std::wstring path = GetUserSettingsPath();
                    std::wstring rawText = path.empty() ? L"" : ReadFileUtf8(path);
                    std::wstring out =
                        L"{\"type\":\"userSettings\",\"json\":\"" +
                        JsonEscape(rawText) + L"\"}";
                    s->webview->PostWebMessageAsJson(out.c_str());

                    // Also push the most-recently-seen viewer pane theme so
                    // the settings dialog can render its 'auto' resolution
                    // against DOpus's pane bg (NOT Windows' OS theme).
                    std::wstring themeMsg =
                        std::wstring(L"{\"type\":\"paneTheme\",\"mode\":\"") +
                        (IsDarkBg(g_lastViewerBg) ? L"dark" : L"light") +
                        L"\",\"paneBg\":\"" + CssHex(g_lastViewerBg) + L"\"}";
                    s->webview->PostWebMessageAsJson(themeMsg.c_str());

                    // Push installed fonts list for the dialog's font
                    // dropdowns (cheap to enumerate, ~1ms typically).
                    std::vector<std::wstring> fonts = EnumerateSystemFonts();
                    std::wstring fontsMsg = L"{\"type\":\"fonts\",\"list\":[";
                    for (size_t i = 0; i < fonts.size(); ++i) {
                        if (i > 0) fontsMsg += L",";
                        fontsMsg += L"\"" + JsonEscape(fonts[i]) + L"\"";
                    }
                    fontsMsg += L"]}";
                    s->webview->PostWebMessageAsJson(fontsMsg.c_str());
                    return S_OK;
                }
                if (msg.find(L"\"saveSettings\"") != std::wstring::npos) {
                    std::wstring payload = ExtractJsonStringKey(msg, L"json");
                    bool ok = WriteUserSettingsAtomic(payload);
                    if (ok && s->hwndNotify) {
                        PostMessageW(s->hwndNotify, DVPLUGINMSG_REINITIALIZE,
                                     0, static_cast<LPARAM>(s->dwNotifyData));
                    }
                    // Echo result back so the page can show a status line.
                    std::wstring out = std::wstring(L"{\"type\":\"saveResult\",\"ok\":") +
                        (ok ? L"true" : L"false") + L"}";
                    s->webview->PostWebMessageAsJson(out.c_str());
                    return S_OK;
                }
                if (msg.find(L"\"closeSettings\"") != std::wstring::npos) {
                    PostMessageW(s->hwndSelf, WM_CLOSE, 0, 0);
                    return S_OK;
                }
                return S_OK;
            }).Get(),
        &s->webMessageToken);

    ResizeSettingsWebView(s);
    if (haveBundle) {
        s->webview->Navigate(L"https://app.mdworx.test/settings.html");
    } else {
        // Bundle missing -> show a minimal failure page so the user knows.
        s->webview->NavigateToString(
            L"<html><body style='font-family:sans-serif;padding:24px;'>"
            L"<h2>Settings unavailable</h2>"
            L"<p>The bundle folder <code>mdWorX_assets</code> "
            L"is missing or unreadable. Reinstall the plugin.</p>"
            L"</body></html>");
    }
    return S_OK;
}

HRESULT InitSettingsWebView2(SettingsState* s) {
    if (!s) return E_FAIL;
    const std::wstring userDataFolder = GetUserDataFolder();
    if (userDataFolder.empty()) return E_FAIL;

    DpiScope dpi;
    return CreateCoreWebView2EnvironmentWithOptions(
        nullptr, userDataFolder.c_str(), nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [s](HRESULT envResult, ICoreWebView2Environment* env) -> HRESULT {
                DpiScope dpi;
                if (s->destroyed) return S_OK;
                if (FAILED(envResult) || env == nullptr) return envResult;
                s->env = env;
                return env->CreateCoreWebView2Controller(
                    s->hwndSelf,
                    Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                        [s](HRESULT cr, ICoreWebView2Controller* controller) -> HRESULT {
                            DpiScope dpi;
                            return OnSettingsControllerCreated(s, cr, controller);
                        }).Get());
            }).Get());
}

void TeardownSettingsWebView2(SettingsState* s) {
    if (!s) return;
    if (s->webview && s->webMessageToken.value != 0) {
        s->webview->remove_WebMessageReceived(s->webMessageToken);
        s->webMessageToken = {};
    }
    if (s->controller) {
        s->controller->Close();
        s->controller.Reset();
    }
    s->webview.Reset();
    s->env.Reset();
}

LRESULT CALLBACK SettingsWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
    case WM_CREATE: {
        // CREATESTRUCTW::lpCreateParams was set by CreateWindowExW to the
        // pre-populated SettingsState* (carrying hwndNotify + dwNotifyData
        // from DVP_Configure).
        auto* cs = reinterpret_cast<CREATESTRUCTW*>(lParam);
        auto* s = reinterpret_cast<SettingsState*>(cs->lpCreateParams);
        s->hwndSelf = hwnd;
        SetSettingsState(hwnd, s);
        CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
        InitSettingsWebView2(s);
        return 0;
    }
    case WM_SIZE:
        if (auto* s = GetSettingsState(hwnd)) {
            if (s->controller) {
                if (wParam == SIZE_MINIMIZED) {
                    s->controller->put_IsVisible(FALSE);
                } else {
                    s->controller->put_IsVisible(TRUE);
                    ResizeSettingsWebView(s);
                }
            }
        }
        return 0;
    case WM_MOVE:
        if (auto* s = GetSettingsState(hwnd)) {
            if (s->controller) s->controller->NotifyParentWindowPositionChanged();
        }
        return 0;
    case WM_DPICHANGED: {
        if (auto* s = GetSettingsState(hwnd)) {
            RECT* prc = reinterpret_cast<RECT*>(lParam);
            if (prc) {
                SetWindowPos(hwnd, nullptr, prc->left, prc->top,
                             prc->right - prc->left, prc->bottom - prc->top,
                             SWP_NOZORDER | SWP_NOACTIVATE);
            }
            if (s->controller) {
                ResizeSettingsWebView(s);
                s->controller->NotifyParentWindowPositionChanged();
            }
        }
        return 0;
    }
    case WM_CLOSE:
        DestroyWindow(hwnd);
        return 0;
    case WM_DESTROY: {
        if (auto* s = GetSettingsState(hwnd)) {
            s->destroyed = true;
            TeardownSettingsWebView2(s);
            SetSettingsState(hwnd, nullptr);
            delete s;
        }
        if (g_hwndSettings == hwnd) g_hwndSettings = nullptr;
        return 0;
    }
    default:
        return DefWindowProcW(hwnd, msg, wParam, lParam);
    }
}

bool RegisterSettingsWindowClass() {
    WNDCLASSEXW wc{};
    wc.cbSize        = sizeof(wc);
    wc.style         = CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc   = SettingsWndProc;
    wc.hInstance     = g_hInstance;
    wc.hCursor       = LoadCursor(nullptr, IDC_ARROW);
    wc.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
    wc.lpszClassName = kSettingsWindowClassName;
    ATOM atom = RegisterClassExW(&wc);
    if (atom == 0) {
        DWORD err = GetLastError();
        return err == ERROR_CLASS_ALREADY_EXISTS;
    }
    return true;
}

}  // namespace

// ============================================================================
// SDK exports
// ============================================================================

extern "C" BOOL APIENTRY DllMain(HINSTANCE hInstance, DWORD reason, LPVOID) {
    switch (reason) {
    case DLL_PROCESS_ATTACH:
        g_hInstance = hInstance;
        DisableThreadLibraryCalls(hInstance);
        break;
    case DLL_PROCESS_DETACH:
        if (g_hInstance) {
            UnregisterClassW(kWindowClassName, g_hInstance);
        }
        break;
    }
    return TRUE;
}

extern "C" __declspec(dllexport)
BOOL DVP_InitEx(LPDVPINITEXDATA pInitExData) {
    if (!pInitExData || pInitExData->cbSize < sizeof(DVPINITEXDATA)) {
        return FALSE;
    }
    g_hwndDOpusMsg = pInitExData->hwndDOpusMsgWindow;
    if (!RegisterViewerWindowClass())   return FALSE;
    if (!RegisterSettingsWindowClass()) return FALSE;
    return TRUE;
}

extern "C" __declspec(dllexport)
void DVP_Uninit(void) {
    if (g_hInstance) {
        UnregisterClassW(kWindowClassName,         g_hInstance);
        UnregisterClassW(kSettingsWindowClassName, g_hInstance);
    }
}

extern "C" __declspec(dllexport)
HWND DVP_Configure(HWND hWndParent, HWND hWndNotify, DWORD dwNotifyData) {
    // Single-instance: if the dialog is already open, focus it instead of
    // spawning a second window.
    if (g_hwndSettings && IsWindow(g_hwndSettings)) {
        if (IsIconic(g_hwndSettings)) ShowWindow(g_hwndSettings, SW_RESTORE);
        SetForegroundWindow(g_hwndSettings);
        return g_hwndSettings;
    }

    DpiScope dpi;

    auto* state = new SettingsState();
    state->hwndParent    = hWndParent;
    state->hwndNotify    = hWndNotify;
    state->dwNotifyData  = dwNotifyData;

    // Centre over the parent. Fall back to the work area if no parent (or
    // if the parent rect is degenerate).
    // Size to the monitor that hosts hWndParent (or primary). Fixed pixel
    // counts look fine on 1080p, cramped on 1440p, tiny on 4K. Target ~60%
    // of the work area, clamped to a sensible range.
    int initialWidth  = 1000;
    int initialHeight = 1000;
    RECT workArea{};
    HMONITOR mon = hWndParent
        ? MonitorFromWindow(hWndParent, MONITOR_DEFAULTTONEAREST)
        : MonitorFromPoint({0, 0}, MONITOR_DEFAULTTOPRIMARY);
    MONITORINFO mi{ sizeof(mi) };
    if (mon && GetMonitorInfoW(mon, &mi)) {
        workArea = mi.rcWork;
        int waw = workArea.right - workArea.left;
        int wah = workArea.bottom - workArea.top;
        initialWidth  = std::min(1300, std::max(800, waw * 65 / 100));
        initialHeight = std::min(1400, std::max(800, wah * 80 / 100));
    }

    int x = CW_USEDEFAULT, y = CW_USEDEFAULT;
    RECT prc{};
    if (hWndParent && GetWindowRect(hWndParent, &prc) &&
        (prc.right > prc.left) && (prc.bottom > prc.top)) {
        x = prc.left + ((prc.right  - prc.left) - initialWidth)  / 2;
        y = prc.top  + ((prc.bottom - prc.top)  - initialHeight) / 2;
    } else if (workArea.right > workArea.left) {
        x = workArea.left + ((workArea.right  - workArea.left) - initialWidth)  / 2;
        y = workArea.top  + ((workArea.bottom - workArea.top)  - initialHeight) / 2;
    }

    // Owned modeless: pass hWndParent as owner so the dialog stays above
    // DOpus and doesn't get its own taskbar entry. Modeless (no DialogBox
    // loop blocking the lister), but Windows enforces z-order grouping.
    HWND hwnd = CreateWindowExW(
        WS_EX_DLGMODALFRAME,
        kSettingsWindowClassName,
        kSettingsWindowTitle,
        WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN,
        x, y, initialWidth, initialHeight,
        hWndParent,        // owner: stays above DOpus, no taskbar entry
        nullptr,
        g_hInstance,
        state);
    if (!hwnd) {
        delete state;
        return nullptr;
    }

    g_hwndSettings = hwnd;
    ShowWindow(hwnd, SW_SHOWNORMAL);
    UpdateWindow(hwnd);
    return hwnd;
}

extern "C" __declspec(dllexport)
BOOL DVP_USBSafe(LPOPUSUSBSAFEDATA pUSBSafeData) {
    if (pUSBSafeData && pUSBSafeData->pszOtherExports && pUSBSafeData->cchOtherExports > 0) {
        pUSBSafeData->pszOtherExports[0] = L'\0';
    }
    return TRUE;
}

extern "C" __declspec(dllexport)
BOOL DVP_IdentifyW(LPVIEWERPLUGININFOW lpInfo) {
    if (!lpInfo) return FALSE;

    lpInfo->dwFlags =
          DVPFIF_ExtensionsOnly
        | DVPFIF_NoThumbnails
        | DVPFIF_ZeroBytesOk
        | DVPFIF_CanConfigure;

    lpInfo->dwVersionHigh = MAKELPARAM(1, 0);
    lpInfo->dwVersionLow  = MAKELPARAM(0, 0);

    StringCchCopyW(lpInfo->lpszHandleExts, lpInfo->cchHandleExtsMax,  kHandledExts);
    StringCchCopyW(lpInfo->lpszName,        lpInfo->cchNameMax,        kName);
    StringCchCopyW(lpInfo->lpszDescription, lpInfo->cchDescriptionMax, kDescription);
    StringCchCopyW(lpInfo->lpszCopyright,   lpInfo->cchCopyrightMax,   kCopyright);
    StringCchCopyW(lpInfo->lpszURL,         lpInfo->cchURLMax,         kURL);

    lpInfo->dwlMinFileSize        = 0;
    lpInfo->dwlMaxFileSize        = 0;
    lpInfo->dwlMinPreviewFileSize = 0;
    lpInfo->dwlMaxPreviewFileSize = 0;

    lpInfo->uiMajorFileType = DVPMajorType_Text;
    lpInfo->idPlugin        = kPluginGuid;

    if (lpInfo->cbSize >= VIEWERPLUGININFOW_V4_SIZE) {
        lpInfo->dwOpusVerMajor = 12;
        lpInfo->dwOpusVerMinor = 0;
        lpInfo->dwInitFlags    = 0;
        lpInfo->hIconSmall     = nullptr;
        lpInfo->hIconLarge     = nullptr;
    }

    return TRUE;
}

extern "C" __declspec(dllexport)
BOOL DVP_IdentifyFileW(HWND, LPWSTR lpszName,
                       LPVIEWERPLUGINFILEINFOW lpFileInfo,
                       HANDLE) {
    if (!lpFileInfo || !lpszName) return FALSE;

    LPCWSTR ext = PathFindExtensionW(lpszName);
    if (!ext || *ext == 0) return FALSE;

    lpFileInfo->dwFlags     = DVPFIF_CanReturnViewer;
    lpFileInfo->wMajorType  = DVPMajorType_Text;
    lpFileInfo->wMinorType  = 0;
    lpFileInfo->szImageSize = SIZE{0, 0};
    lpFileInfo->iNumBits    = 0;

    if (lpFileInfo->lpszInfo && lpFileInfo->cchInfoMax > 0) {
        StringCchCopyW(lpFileInfo->lpszInfo, lpFileInfo->cchInfoMax,
                       L"Markdown document");
    }
    if (lpFileInfo->cbSize >= VIEWERPLUGINFILEINFOW_V2_SIZE) {
        lpFileInfo->iTypeHint = DVPFITypeHint_PlainText;
    }
    return TRUE;
}

extern "C" __declspec(dllexport)
HWND DVP_CreateViewer(HWND hwndParent, LPRECT lpRc, DWORD dwFlags) {
    if (!hwndParent || !lpRc) return nullptr;

    // Force per-monitor V2 DPI awareness for window creation AND the WM_CREATE
    // path (where InitWebView2 fires the first WebView2 environment call).
    // Without this, WebView2 returns E_UNEXPECTED on UNAWARE threads
    // (MicrosoftEdge/WebView2Feedback#2234).
    DpiScope dpi;

    DWORD style   = WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN;
    DWORD exStyle = (dwFlags & DVPCVF_Border) ? WS_EX_CLIENTEDGE : 0;

    HWND hwnd = CreateWindowExW(
        exStyle,
        kWindowClassName,
        L"",
        style,
        lpRc->left, lpRc->top,
        lpRc->right - lpRc->left, lpRc->bottom - lpRc->top,
        hwndParent,
        nullptr,
        g_hInstance,
        nullptr);

    return hwnd;
}
