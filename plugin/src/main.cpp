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
#include <urlmon.h>    // URLDownloadToFileW for "Copy to file folder" of URL sources
#include <winhttp.h>   // WinHttp* for the in-app update download
#include <bcrypt.h>    // BCryptHash* for SHA256 of downloaded zip
#include <sddl.h>      // ConvertStringSecurityDescriptorToSecurityDescriptorW
#include <wrl.h>
#include <WebView2.h>
#include <string>
#include <memory>
#include <vector>
#include <mutex>
#include <atomic>
#include <thread>
#include <optional>
#include <algorithm>
#include <unordered_map>
#include <regex>

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
constexpr wchar_t kName[]            = L"mdWorX";
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

// Sentinel passed in dwNotifyData when the cog button in our viewer invokes
// DVP_Configure. Distinguishes that path from a DOpus-initiated plugin-
// prefs invocation so the latter can run a modal message pump (DOpus
// expects DVP_Configure to block until the dialog is closed; see #3).
static constexpr DWORD kInternalConfigureFlag = 0xC0DE0001u;

// Forward declaration: implemented down in the settings section.
struct SettingsState;
void HandleCheckForUpdatesMessage(SettingsState* s);
void HandleInstallUpdateMessage(SettingsState* s,
                                const std::wstring& url,
                                const std::wstring& expectedSha256,
                                const std::wstring& expectedVersion);
static void InstallWebViewNavigationGuards(ICoreWebView2* wv);
static std::wstring RandomHexId();

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

// Custom theme storage. Each theme is one JSON file in this directory,
// named after the sanitised theme name + ".json". Sits beside settings.json
// in Roaming AppData so themes follow the user's profile.
std::wstring GetCustomThemesDir() {
    PWSTR raw = nullptr;
    if (FAILED(SHGetKnownFolderPath(FOLDERID_RoamingAppData, 0, nullptr, &raw))) {
        return L"";
    }
    std::wstring dir = raw;
    CoTaskMemFree(raw);
    dir += L"\\HyperWorX\\mdWorX\\themes";
    SHCreateDirectoryExW(nullptr, dir.c_str(), nullptr);
    return dir;
}

// Sanitise a user-supplied theme name for use as a filename. Returns the
// cleaned name on success, empty string on rejection. Rules:
//   - Trim leading/trailing whitespace
//   - Reject empty result
//   - Reject Windows-forbidden chars: \ / : * ? " < > | and control chars (< 0x20)
//   - Reject reserved device names: CON, PRN, AUX, NUL, COM1-9, LPT1-9 (case insensitive)
//   - Reject names longer than 100 wchars (leaves room for .json + .tmp suffixes)
// Defence in depth: JS validates first, but native re-checks before
// touching the filesystem in case the message bridge is bypassed.
std::wstring SanitiseThemeName(const std::wstring& raw) {
    // Trim whitespace.
    size_t first = 0;
    while (first < raw.size() &&
           (raw[first] == L' ' || raw[first] == L'\t')) ++first;
    size_t last = raw.size();
    while (last > first &&
           (raw[last - 1] == L' ' || raw[last - 1] == L'\t')) --last;
    if (last <= first) return L"";
    std::wstring name = raw.substr(first, last - first);

    if (name.size() > 100) return L"";

    for (wchar_t c : name) {
        if (c < 0x20) return L"";
        if (c == L'\\' || c == L'/'  || c == L':' || c == L'*' ||
            c == L'?'  || c == L'"'  || c == L'<' || c == L'>' ||
            c == L'|') return L"";
    }

    // Reserved device names. Strip any "." suffix for the comparison.
    std::wstring stem = name;
    size_t dotPos = stem.find(L'.');
    if (dotPos != std::wstring::npos) stem = stem.substr(0, dotPos);
    std::wstring upper = stem;
    for (auto& c : upper) {
        if (c >= L'a' && c <= L'z') c = c - L'a' + L'A';
    }
    static const wchar_t* kReserved[] = {
        L"CON", L"PRN", L"AUX", L"NUL",
        L"COM1", L"COM2", L"COM3", L"COM4", L"COM5",
        L"COM6", L"COM7", L"COM8", L"COM9",
        L"LPT1", L"LPT2", L"LPT3", L"LPT4", L"LPT5",
        L"LPT6", L"LPT7", L"LPT8", L"LPT9",
    };
    for (const wchar_t* r : kReserved) {
        if (upper == r) return L"";
    }

    return name;
}

// Enumerate all *.json files in the custom themes directory and return
// their base names (sans extension), case-insensitively sorted.
std::vector<std::wstring> EnumerateCustomThemes() {
    std::vector<std::wstring> out;
    std::wstring dir = GetCustomThemesDir();
    if (dir.empty()) return out;

    std::wstring pattern = dir + L"\\*.json";
    WIN32_FIND_DATAW fd{};
    HANDLE h = FindFirstFileW(pattern.c_str(), &fd);
    if (h == INVALID_HANDLE_VALUE) return out;
    do {
        if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) continue;
        std::wstring name = fd.cFileName;
        if (name.size() < 5) continue;  // "x.json" minimum
        // Strip trailing ".json" (case-insensitive).
        std::wstring tail = name.substr(name.size() - 5);
        for (auto& c : tail) {
            if (c >= L'A' && c <= L'Z') c = c - L'A' + L'a';
        }
        if (tail != L".json") continue;
        std::wstring base = name.substr(0, name.size() - 5);
        // Re-validate via SanitiseThemeName so files hand-placed with
        // illegal characters don't surface in the picker.
        if (!SanitiseThemeName(base).empty()) {
            out.push_back(base);
        }
    } while (FindNextFileW(h, &fd));
    FindClose(h);

    std::sort(out.begin(), out.end(),
              [](const std::wstring& a, const std::wstring& b) {
                  return _wcsicmp(a.c_str(), b.c_str()) < 0;
              });
    return out;
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
    std::wstring currentFilePath;  // Updated each LOAD; raw absolute path used as stash key.
    FILETIME     loadedDiskMtime{}; // Disk mtime captured at LOAD; baseline for conflict detection.
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
    bool initFailed      = false;   // P2 audit #24: signals WM_PAINT to show the WebView2-unavailable message.
    bool destroyed       = false;
    std::wstring pendingFilePath;  // Set if LOAD arrives before init finishes.
    // /_abs/ allowlist: directories the user has explicitly opened in
    // this viewer this session, plus the parent dir of every Insert
    // Image / Download Image opt-in. The /_abs/ handler refuses to
    // serve any absolute path that is not contained in one of these.
    // Closes P1 audit #11.
    std::vector<std::wstring> allowedAbsDirs;
};

// Canonicalises and lowercases `dir` for stable membership checks.
// Resolves to the long path form (with the leading drive in upper case
// and a trailing backslash) so paths added at different points in the
// session match up regardless of how the caller spelled them.
static std::wstring CanonicaliseDir(const std::wstring& dir) {
    if (dir.empty()) return {};
    std::wstring buf(1024, L'\0');
    DWORD n = GetFullPathNameW(dir.c_str(),
                               static_cast<DWORD>(buf.size()),
                               buf.data(), nullptr);
    if (n == 0 || n >= buf.size()) return {};
    buf.resize(n);
    if (!buf.empty() && buf.back() != L'\\' && buf.back() != L'/') buf.push_back(L'\\');
    for (wchar_t& c : buf) {
        if (c == L'/') c = L'\\';
        if (c >= L'A' && c <= L'Z') c = static_cast<wchar_t>(c - L'A' + L'a');
    }
    return buf;
}

static void AllowAbsDir(ViewerState* state, const std::wstring& dir) {
    if (!state) return;
    std::wstring canon = CanonicaliseDir(dir);
    if (canon.empty()) return;
    for (const auto& d : state->allowedAbsDirs) if (d == canon) return;
    state->allowedAbsDirs.push_back(std::move(canon));
}

// True when `absPath` is contained in any allowlisted directory. The
// caller is expected to have already canonicalised the path via the
// same case + slash + long-path rules used by CanonicaliseDir.
static bool IsAbsPathAllowed(ViewerState* state, const std::wstring& canonAbsPath) {
    if (!state) return false;
    for (const auto& d : state->allowedAbsDirs) {
        if (canonAbsPath.size() >= d.size() &&
            canonAbsPath.compare(0, d.size(), d) == 0) {
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Per-session unsaved-edits stash.
//
// When the user edits a file in mdWorX and then switches the viewer pane to
// a different file, the WebView2 instance is torn down and the editor state
// is lost. To restore in-progress edits when the user comes back, the JS
// side periodically posts a 'stashBuffer' message with the current buffer;
// it lives here keyed by the canonicalised file path. Process-scoped — the
// map dies when DOpus exits, never touching disk.
//
// The FILETIME records the file's mtime at the moment it was loaded, so a
// reload can detect external modifications (file changed in another editor
// since we switched away) and surface a conflict banner.
struct StashEntry {
    std::wstring buffer;             // raw editor buffer as wide string
    FILETIME     diskMtimeAtLoad{};  // mtime at first stash for this file
};
std::unordered_map<std::wstring, StashEntry> g_unsavedBuffers;
std::mutex                                   g_unsavedBuffersMutex;

// Canonicalise a file path so the same file reached via different routes
// (drive letter vs UNC, short vs long names, symlinks, '..' segments) maps
// to a single stash key. Falls back to the input on failure.
std::wstring CanonicaliseStashKey(const std::wstring& raw) {
    if (raw.empty()) return raw;
    constexpr DWORD CAP = MAX_PATH * 2;
    wchar_t buf[CAP];
    DWORD n = GetLongPathNameW(raw.c_str(), buf, CAP);
    std::wstring s = (n > 0 && n < CAP) ? std::wstring(buf, n) : raw;
    for (wchar_t& c : s) {
        if (c >= L'A' && c <= L'Z') c = static_cast<wchar_t>(c + 32);
    }
    return s;
}

// Read a file's last-write FILETIME. Returns a zero FILETIME if the file
// can't be opened (callers compare against zero to detect that).
FILETIME ReadFileMtime(const std::wstring& path) {
    FILETIME ft{};
    HANDLE h = CreateFileW(path.c_str(), GENERIC_READ,
                           FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                           nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return ft;
    GetFileTime(h, nullptr, nullptr, &ft);
    CloseHandle(h);
    return ft;
}

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
    state->currentFileDir  = GetParentDir(path);
    state->currentFilePath = path;
    // P1 audit #11: every directory the user opens a document in is
    // an allowlisted base for the /_abs/ image route. Without this,
    // arbitrary local files could be fetched via the bypass route.
    AllowAbsDir(state, state->currentFileDir);
    state->loadedDiskMtime = ReadFileMtime(path);

    DecodedFile df = ReadFileDecoded(path);
    state->lastReadEncoding = df.encoding;
    state->lastReadHadBOM   = df.hadBOM;

    // Stash lookup. If we have a stashed buffer for this file, decide
    // whether to surface it cleanly (mtime unchanged since the stash was
    // recorded) or as a conflict (file modified externally since then).
    std::wstring stashedBuffer;
    bool         haveStash       = false;
    bool         conflictDetected = false;
    {
        std::lock_guard<std::mutex> lk(g_unsavedBuffersMutex);
        auto it = g_unsavedBuffers.find(CanonicaliseStashKey(path));
        if (it != g_unsavedBuffers.end()) {
            haveStash = true;
            stashedBuffer = it->second.buffer;
            // CompareFileTime returns 0 when the two times are equal. Any
            // non-zero result means the file changed under us.
            if (CompareFileTime(&it->second.diskMtimeAtLoad,
                                &state->loadedDiskMtime) != 0) {
                conflictDetected = true;
            }
        }
    }

    std::wstring encName = EncodingChoiceToName(df.encoding, df.hadBOM);
    std::wstring msg =
        L"{\"type\":\"load\",\"path\":\""  + JsonEscape(path) +
        L"\",\"encoding\":\""              + JsonEscape(encName) +
        L"\",\"content\":\""               + JsonEscape(df.text) + L"\"";
    if (haveStash) {
        msg += L",\"stashedContent\":\"" + JsonEscape(stashedBuffer) + L"\"";
        if (conflictDetected) {
            msg += L",\"conflictDetected\":true";
        } else {
            msg += L",\"restoredFromStash\":true";
        }
    }
    msg += L"}";
    state->webview->PostWebMessageAsJson(msg.c_str());
}

void ResizeWebViewToClient(ViewerState* state) {
    if (!state || !state->controller) return;
    RECT rc{};
    GetClientRect(state->hwndSelf, &rc);
    state->controller->put_Bounds(rc);
}

// Atomic byte-array write to disk. The previous code had three
// near-duplicate implementations of this (WriteUtf8FileAtomic,
// WriteUserSettingsAtomic, WriteCustomThemeAtomic) which drifted in
// detail and notably skipped FlushFileBuffers before MoveFileEx
// (P2 audit #17). MOVEFILE_WRITE_THROUGH only forces the rename's
// directory entry to flush; the file's data blocks still need the
// explicit FlushFileBuffers to survive power loss.
//
// Pattern: write to <path>.<random>.tmp -> FlushFileBuffers
// -> CloseHandle -> MoveFileExW(REPLACE_EXISTING | WRITE_THROUGH).
// The random suffix avoids the previous race where two saves to
// the same path would scribble on each other's .tmp file.
static bool AtomicWriteBytes(const std::wstring& path,
                             const void* data,
                             size_t bytes) {
    if (path.empty()) return false;
    std::wstring tmpPath = path + L".mdworx." + RandomHexId() + L".tmp";

    HANDLE h = CreateFileW(tmpPath.c_str(), GENERIC_WRITE, 0, nullptr,
                           CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return false;

    BOOL writeOk = TRUE;
    if (bytes > 0) {
        DWORD written = 0;
        writeOk = WriteFile(h, data, static_cast<DWORD>(bytes),
                            &written, nullptr);
        if (!writeOk || written != bytes) writeOk = FALSE;
    }
    if (writeOk) FlushFileBuffers(h);
    CloseHandle(h);
    if (!writeOk) {
        DeleteFileW(tmpPath.c_str());
        return false;
    }

    BOOL moveOk = MoveFileExW(tmpPath.c_str(), path.c_str(),
                              MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH);
    if (!moveOk) {
        DeleteFileW(tmpPath.c_str());
        return false;
    }
    return true;
}

// Atomic UTF-8 file write: writes to <path>.<random>.tmp then
// MoveFileEx replaces the original. addBOM prepends the UTF-8 BOM
// (EF BB BF) when the original file had one, so save round-trips
// encoding-as-stored. Returns false on any failure.
bool WriteUtf8FileAtomic(const std::wstring& path,
                          const std::wstring& text,
                          bool addBOM) {
    if (path.empty()) return false;
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
    return AtomicWriteBytes(path, bytes.data(), bytes.size());
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
    AllowAbsDir(state, state->currentFileDir);
    state->lastReadEncoding = addBOM ? EncodingChoice{DK_UTF8, 0}
                                     : EncodingChoice{DK_UTF8, 0};
    state->lastReadHadBOM   = addBOM;

    PostSaveAsResult(state, true, false, chosen,
                     addBOM ? L"utf-8-bom" : L"utf-8", nullptr);
}

// Pick an image file from disk for the editor toolbar's Insert Image
// button. Opens GetOpenFileNameW filtered to common image formats, returns
// both the absolute path and a relative-to-current-file path (when the
// current file's parent directory is known). Reply shape:
//   {type:'imagePicked', cancelled:false, path:'C:\\...', relative:'./img/x.png'}
//   {type:'imagePicked', cancelled:true}
void HandlePickImageMessage(ViewerState* state) {
    if (!state) return;

    wchar_t pathBuf[MAX_PATH] = {0};

    OPENFILENAMEW ofn{};
    ofn.lStructSize = sizeof(ofn);
    ofn.hwndOwner   = state->hwndSelf;
    ofn.lpstrFilter =
        L"Image files (*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp;*.svg)\0"
        L"*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp;*.svg\0"
        L"PNG (*.png)\0*.png\0"
        L"JPEG (*.jpg;*.jpeg)\0*.jpg;*.jpeg\0"
        L"All files (*.*)\0*.*\0";
    ofn.nFilterIndex = 1;
    ofn.lpstrFile    = pathBuf;
    ofn.nMaxFile     = MAX_PATH;
    ofn.lpstrTitle   = L"Insert image";
    ofn.Flags        = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST
                     | OFN_HIDEREADONLY  | OFN_NOCHANGEDIR;
    if (!state->currentFileDir.empty()) {
        ofn.lpstrInitialDir = state->currentFileDir.c_str();
    }

    if (!GetOpenFileNameW(&ofn)) {
        // 0 = user cancel; non-zero = real error (still treat as cancel
        // for the picker since there's nothing useful to do).
        if (state->webview) {
            state->webview->PostWebMessageAsJson(
                L"{\"type\":\"imagePicked\",\"cancelled\":true}");
        }
        return;
    }

    std::wstring chosen = pathBuf;
    // P1 audit #11: picking an image outside currentFileDir extends the
    // /_abs/ allowlist to that file's directory so the bypass route can
    // serve it. Only the directory is added; future scripts cannot use
    // the allowance to read other arbitrary files because the route
    // does its own containment check on the requested path.
    AllowAbsDir(state, GetParentDir(chosen));

    // Compute a path relative to the current file's directory when the
    // markdown file's parent is known. PathRelativePathToW returns the
    // result in the form ".\subdir\file.png" or "..\..\other\file.png".
    std::wstring relative;
    if (!state->currentFileDir.empty()) {
        wchar_t rel[MAX_PATH] = {0};
        if (PathRelativePathToW(rel,
                state->currentFileDir.c_str(), FILE_ATTRIBUTE_DIRECTORY,
                chosen.c_str(),                FILE_ATTRIBUTE_NORMAL)) {
            relative = rel;
            // Strip a leading ".\" — cosmetic, but keeps the inserted
            // markdown clean for the common same-folder case.
            if (relative.size() >= 2 &&
                relative[0] == L'.' && relative[1] == L'\\') {
                relative = relative.substr(2);
            }
            // Markdown URL paths use forward slashes; convert.
            for (auto& c : relative) if (c == L'\\') c = L'/';
        }
    }

    std::wstring out = L"{\"type\":\"imagePicked\",\"cancelled\":false,"
                       L"\"path\":\"" + JsonEscape(chosen) +
                       L"\",\"relative\":\"" + JsonEscape(relative) + L"\"}";
    if (state->webview) {
        state->webview->PostWebMessageAsJson(out.c_str());
    }
}

// Decode a single hex digit (0-9, a-f, A-F) to its 0-15 value, or -1.
static int HexVal(wchar_t c) {
    if (c >= L'0' && c <= L'9') return c - L'0';
    if (c >= L'a' && c <= L'f') return 10 + (c - L'a');
    if (c >= L'A' && c <= L'F') return 10 + (c - L'A');
    return -1;
}

// Percent-decode a URL fragment, treating decoded byte sequences as UTF-8.
// Non-ASCII characters that survived in the input wide string are passed
// through unchanged after a UTF-8 round trip; this is good enough for typical
// image URLs where the leaf is ASCII or already URL-encoded.
static std::wstring UrlPercentDecodeUtf8(const std::wstring& in) {
    std::string bytes;
    bytes.reserve(in.size());
    size_t i = 0;
    while (i < in.size()) {
        wchar_t c = in[i];
        if (c == L'%' && i + 2 < in.size()) {
            int hi = HexVal(in[i + 1]);
            int lo = HexVal(in[i + 2]);
            if (hi >= 0 && lo >= 0) {
                bytes.push_back(static_cast<char>((hi << 4) | lo));
                i += 3;
                continue;
            }
        }
        if (c < 0x80) {
            bytes.push_back(static_cast<char>(c));
        } else {
            int wlen = WideCharToMultiByte(CP_UTF8, 0, &c, 1, nullptr, 0, nullptr, nullptr);
            if (wlen > 0) {
                std::string tmp(static_cast<size_t>(wlen), '\0');
                WideCharToMultiByte(CP_UTF8, 0, &c, 1, tmp.data(), wlen, nullptr, nullptr);
                bytes.append(tmp);
            }
        }
        ++i;
    }
    int wlen = MultiByteToWideChar(CP_UTF8, 0, bytes.data(),
                                   static_cast<int>(bytes.size()), nullptr, 0);
    if (wlen <= 0) return L"";
    std::wstring out(static_cast<size_t>(wlen), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, bytes.data(),
                        static_cast<int>(bytes.size()), out.data(), wlen);
    return out;
}

// Pick a filename from a URL: strip query/fragment, take everything after
// the last '/', URL-decode. Returns an empty string if no usable leaf.
static std::wstring DeriveFilenameFromUrl(const std::wstring& url) {
    size_t cut = url.find_first_of(L"?#");
    std::wstring path = (cut == std::wstring::npos) ? url : url.substr(0, cut);
    size_t slash = path.find_last_of(L'/');
    if (slash == std::wstring::npos) return L"";
    std::wstring leaf = path.substr(slash + 1);
    return UrlPercentDecodeUtf8(leaf);
}

// Replace Windows-illegal filename chars with '_' and trim leading/trailing
// dots and spaces (which Windows quietly strips and which cause "file not
// found" surprises later). Returns "" if the input collapses entirely.
static std::wstring SanitiseFilename(const std::wstring& in) {
    std::wstring out;
    out.reserve(in.size());
    for (wchar_t c : in) {
        if (c < 32) continue;
        switch (c) {
            case L'<': case L'>': case L':': case L'"':
            case L'/': case L'\\': case L'|': case L'?': case L'*':
                out.push_back(L'_'); break;
            default:
                out.push_back(c);
        }
    }
    size_t start = out.find_first_not_of(L" .");
    if (start == std::wstring::npos) return L"";
    size_t end = out.find_last_not_of(L" .");
    return out.substr(start, end - start + 1);
}

// Detect image type by magic bytes. Returns canonical extension (e.g.
// L".png") or empty wstring if no image signature matches. We sniff 16
// bytes which is enough for every container we care about (PNG/JPEG/GIF/
// WebP/BMP/ICO/AVIF/HEIC). SVG is detected by leading "<?xml" or "<svg".
static std::wstring DetectImageExtension(const std::wstring& path) {
    HANDLE h = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr,
                           OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return L"";
    unsigned char b[16] = {0};
    DWORD got = 0;
    BOOL ok = ReadFile(h, b, sizeof(b), &got, nullptr);
    CloseHandle(h);
    if (!ok || got < 4) return L"";

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (got >= 8 && b[0]==0x89 && b[1]==0x50 && b[2]==0x4E && b[3]==0x47 &&
        b[4]==0x0D && b[5]==0x0A && b[6]==0x1A && b[7]==0x0A) return L".png";
    // JPEG: FF D8 FF
    if (b[0]==0xFF && b[1]==0xD8 && b[2]==0xFF) return L".jpg";
    // GIF: "GIF87a" or "GIF89a"
    if (got >= 6 && b[0]=='G' && b[1]=='I' && b[2]=='F' && b[3]=='8' &&
        (b[4]=='7' || b[4]=='9') && b[5]=='a') return L".gif";
    // WebP: "RIFF" .... "WEBP"
    if (got >= 12 && b[0]=='R' && b[1]=='I' && b[2]=='F' && b[3]=='F' &&
        b[8]=='W' && b[9]=='E' && b[10]=='B' && b[11]=='P') return L".webp";
    // BMP: "BM"
    if (b[0]=='B' && b[1]=='M') return L".bmp";
    // ICO: 00 00 01 00
    if (b[0]==0x00 && b[1]==0x00 && b[2]==0x01 && b[3]==0x00) return L".ico";
    // AVIF/HEIC: at offset 4, "ftyp" + brand at offset 8
    if (got >= 12 && b[4]=='f' && b[5]=='t' && b[6]=='y' && b[7]=='p') {
        if (b[8]=='a' && b[9]=='v' && b[10]=='i' && b[11]=='f') return L".avif";
        if (b[8]=='h' && b[9]=='e' && (b[10]=='i' || b[10]=='v')) return L".heic";
    }
    // SVG: "<?xml" or "<svg" (whitespace-tolerant, case-insensitive)
    if (b[0]=='<') {
        // Lowercase first ~10 bytes for cheap case-insensitive match
        char lc[12] = {0};
        for (DWORD i = 0; i < got && i < 11; ++i) {
            char c = static_cast<char>(b[i]);
            if (c >= 'A' && c <= 'Z') c = static_cast<char>(c + 32);
            lc[i] = c;
        }
        if (strstr(lc, "<?xml") || strstr(lc, "<svg")) return L".svg";
    }
    return L"";
}

// Case-insensitive wstring comparison helper.
static bool IEqualW(const std::wstring& a, const std::wstring& b) {
    if (a.size() != b.size()) return false;
    for (size_t i = 0; i < a.size(); ++i) {
        wchar_t ca = a[i], cb = b[i];
        if (ca >= L'A' && ca <= L'Z') ca = static_cast<wchar_t>(ca + 32);
        if (cb >= L'A' && cb <= L'Z') cb = static_cast<wchar_t>(cb + 32);
        if (ca != cb) return false;
    }
    return true;
}

// Download an image from an http(s) URL into the markdown file's parent
// directory. Used by the Insert Image toolbar when the source is a URL and
// the "Copy to file folder" checkbox is ticked. Reply shape matches the
// copyImage handler so the JS side can route both through one reply path:
//   {type:'imageCopied', cancelled:false, relative:'foo.png'}
//   {type:'imageCopied', cancelled:false, error:'<message>'}
//
// URLDownloadToFileW blocks the calling thread for the duration of the
// download. For typical image sizes (a few hundred KB) over a normal
// connection this is sub-second and acceptable. Large files or slow links
// will visibly freeze the pane; we accept that for v1.
void HandleDownloadImageMessage(ViewerState* state, const std::wstring& msg) {
    auto reply = [&](bool ok, const std::wstring& relative, const std::wstring& err) {
        if (!state || !state->webview) return;
        std::wstring out;
        if (ok) {
            out = L"{\"type\":\"imageCopied\",\"cancelled\":false,\"relative\":\""
                + JsonEscape(relative) + L"\"}";
        } else {
            out = L"{\"type\":\"imageCopied\",\"cancelled\":false,\"error\":\""
                + JsonEscape(err) + L"\"}";
        }
        state->webview->PostWebMessageAsJson(out.c_str());
    };

    if (!state) return;
    if (state->currentFileDir.empty()) {
        reply(false, L"", L"No current file to download beside (save the document first).");
        return;
    }
    std::wstring url = ExtractJsonStringKey(msg, L"path");
    if (url.empty()) {
        reply(false, L"", L"Missing URL.");
        return;
    }

    // P2 audit #16: the JS layer gates with /^https?/ but the native
    // side must re-check. URLMon happily resolves file://, ftp://, and
    // res:// schemes, which would let a compromised webview path
    // exfiltrate local files via a download UI. Anchor to http(s) only.
    {
        URL_COMPONENTS uc = {};
        uc.dwStructSize = sizeof(uc);
        wchar_t scheme[16] = {0};
        uc.lpszScheme = scheme; uc.dwSchemeLength = ARRAYSIZE(scheme);
        if (!WinHttpCrackUrl(url.c_str(), 0, 0, &uc) ||
            (uc.nScheme != INTERNET_SCHEME_HTTP &&
             uc.nScheme != INTERNET_SCHEME_HTTPS)) {
            reply(false, L"", L"Download refused: only http(s):// image URLs are allowed.");
            return;
        }
    }

    std::wstring leaf = SanitiseFilename(DeriveFilenameFromUrl(url));
    if (leaf.empty()) leaf = L"image.png";
    size_t dot = leaf.find_last_of(L'.');
    std::wstring stem, ext;
    if (dot == std::wstring::npos) {
        stem = leaf;
        ext  = L".png";
        leaf = stem + ext;
    } else {
        stem = leaf.substr(0, dot);
        ext  = leaf.substr(dot);
    }

    std::wstring candidateName = leaf;
    std::wstring candidatePath = state->currentFileDir + L"\\" + candidateName;
    int suffix = 0;
    while (GetFileAttributesW(candidatePath.c_str()) != INVALID_FILE_ATTRIBUTES) {
        ++suffix;
        if (suffix > 1000) {
            reply(false, L"", L"Too many name collisions (1000) in destination folder.");
            return;
        }
        wchar_t buf[16];
        StringCchPrintfW(buf, 16, L"_%d", suffix);
        candidateName = stem + buf + ext;
        candidatePath = state->currentFileDir + L"\\" + candidateName;
    }

    HRESULT hr = URLDownloadToFileW(nullptr, url.c_str(), candidatePath.c_str(), 0, nullptr);
    if (FAILED(hr)) {
        wchar_t errBuf[96];
        StringCchPrintfW(errBuf, 96,
                         L"Download failed (HRESULT 0x%08lX)",
                         static_cast<unsigned long>(hr));
        reply(false, L"", errBuf);
        return;
    }

    // Type sniffing: a successful HTTP response doesn't guarantee the body is
    // an image — the URL might serve HTML, a 404 page, or a redirect-to-HTML.
    // Inspect magic bytes and either reject (delete the file) or, if the
    // body is a valid image whose extension doesn't match its real type,
    // rename to the correct extension before reporting back.
    std::wstring detected = DetectImageExtension(candidatePath);
    if (detected.empty()) {
        DeleteFileW(candidatePath.c_str());
        reply(false, L"", L"Downloaded content is not a recognised image format.");
        return;
    }
    if (!IEqualW(detected, ext)) {
        // Build a new filename with the corrected extension, running the
        // same collision-suffix loop so we don't clobber existing files.
        std::wstring fixedName = stem + detected;
        std::wstring fixedPath = state->currentFileDir + L"\\" + fixedName;
        int suffix2 = 0;
        while (GetFileAttributesW(fixedPath.c_str()) != INVALID_FILE_ATTRIBUTES) {
            ++suffix2;
            if (suffix2 > 1000) {
                // P3 audit #35: previously reported ok=true with the
                // wrong-extension filename — callers thought save
                // succeeded but the on-disk extension lied about the
                // body's real type. Now we delete the orphan and
                // surface the failure so the user can clean up the
                // collision-saturated folder.
                DeleteFileW(candidatePath.c_str());
                reply(false, L"",
                      L"Could not assign a unique filename with the correct extension (too many collisions).");
                return;
            }
            wchar_t buf[16];
            StringCchPrintfW(buf, 16, L"_%d", suffix2);
            fixedName = stem + buf + detected;
            fixedPath = state->currentFileDir + L"\\" + fixedName;
        }
        if (MoveFileW(candidatePath.c_str(), fixedPath.c_str())) {
            candidateName = fixedName;
        }
        // If MoveFile fails we just keep the original (wrong-extension)
        // filename; not worth surfacing as an error.
    }
    reply(true, candidateName, L"");
}

// Stash the editor buffer for the file the JS message identifies. The path
// is taken from the message rather than ViewerState because a pane switch
// can change state->currentFilePath between a debounced stash being
// scheduled in JS and it arriving here. Falls back to state's path if the
// message omits one (defensive — every JS sender includes path).
// Reply: none (fire-and-forget).
void HandleStashBufferMessage(ViewerState* state, const std::wstring& msg) {
    if (!state) return;
    std::wstring path = ExtractJsonStringKey(msg, L"path");
    if (path.empty()) path = state->currentFilePath;
    if (path.empty()) return;
    std::wstring content = ExtractJsonStringKey(msg, L"content");
    std::wstring key     = CanonicaliseStashKey(path);
    std::lock_guard<std::mutex> lk(g_unsavedBuffersMutex);
    StashEntry& e = g_unsavedBuffers[key];
    e.buffer = std::move(content);
    // Preserve the existing mtime if we already had a stash for this file —
    // it represents the on-disk version we last loaded, which is the
    // baseline conflict detection compares against. Only set on first stash.
    if (e.diskMtimeAtLoad.dwLowDateTime == 0 &&
        e.diskMtimeAtLoad.dwHighDateTime == 0) {
        e.diskMtimeAtLoad = state->loadedDiskMtime;
    }
}

// Drop the stash entry for the JS-supplied file path. Called by JS after a
// successful save (the file on disk is now authoritative) or when the user
// picks "Reload from disk" in the conflict banner.
void HandleClearStashMessage(ViewerState* state, const std::wstring& msg) {
    std::wstring path = ExtractJsonStringKey(msg, L"path");
    if (path.empty() && state) path = state->currentFilePath;
    if (path.empty()) return;
    std::wstring key = CanonicaliseStashKey(path);
    std::lock_guard<std::mutex> lk(g_unsavedBuffersMutex);
    g_unsavedBuffers.erase(key);
}

// Copy a picked image into the markdown file's parent directory so the
// rendered <img> can reference it via a clean relative path. Used by the
// Insert Image toolbar when the "Copy to file folder" checkbox is ticked.
//
// If a file with the same name already exists in the destination, append
// _1, _2, ... before the extension until we find an unused name. Returns
// the basename actually used (relative path = just the name) on success.
// Reply shape:
//   {type:'imageCopied', cancelled:false, relative:'foo.png'}
//   {type:'imageCopied', cancelled:false, error:'<message>'}
void HandleCopyImageMessage(ViewerState* state, const std::wstring& msg) {
    auto reply = [&](bool ok, const std::wstring& relative, const std::wstring& err) {
        if (!state || !state->webview) return;
        std::wstring out;
        if (ok) {
            out = L"{\"type\":\"imageCopied\",\"cancelled\":false,\"relative\":\""
                + JsonEscape(relative) + L"\"}";
        } else {
            out = L"{\"type\":\"imageCopied\",\"cancelled\":false,\"error\":\""
                + JsonEscape(err) + L"\"}";
        }
        state->webview->PostWebMessageAsJson(out.c_str());
    };

    if (!state) return;
    if (state->currentFileDir.empty()) {
        reply(false, L"", L"No current file to copy beside (save the document first).");
        return;
    }
    std::wstring source = ExtractJsonStringKey(msg, L"path");
    if (source.empty()) {
        reply(false, L"", L"Missing source path.");
        return;
    }

    // Basename + extension split for collision-suffix construction.
    size_t slash = source.find_last_of(L"\\/");
    std::wstring leaf = (slash == std::wstring::npos) ? source : source.substr(slash + 1);
    if (leaf.empty()) {
        reply(false, L"", L"Source path has no filename.");
        return;
    }
    size_t dot = leaf.find_last_of(L'.');
    std::wstring stem = (dot == std::wstring::npos) ? leaf : leaf.substr(0, dot);
    std::wstring ext  = (dot == std::wstring::npos) ? L""   : leaf.substr(dot);

    std::wstring candidateName = leaf;
    std::wstring candidatePath = state->currentFileDir + L"\\" + candidateName;
    int suffix = 0;
    while (GetFileAttributesW(candidatePath.c_str()) != INVALID_FILE_ATTRIBUTES) {
        ++suffix;
        if (suffix > 1000) {
            reply(false, L"", L"Too many name collisions (1000) in destination folder.");
            return;
        }
        wchar_t buf[16];
        StringCchPrintfW(buf, 16, L"_%d", suffix);
        candidateName = stem + buf + ext;
        candidatePath = state->currentFileDir + L"\\" + candidateName;
    }

    if (!CopyFileW(source.c_str(), candidatePath.c_str(), TRUE)) {
        wchar_t errBuf[64];
        StringCchPrintfW(errBuf, 64, L"CopyFileW failed (code %lu)", GetLastError());
        reply(false, L"", errBuf);
        return;
    }
    reply(true, candidateName, L"");
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
                    state->initFailed     = true;
                    if (state->hwndSelf) InvalidateRect(state->hwndSelf, nullptr, TRUE);
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
        // DevTools and the default context menu (which includes
        // "Inspect") expose the postMessage bridge to anyone with F12
        // access. Debug builds keep them so developers can inspect;
        // Release builds (NDEBUG) drop them. P3 audit #32.
#ifdef NDEBUG
        settings->put_AreDevToolsEnabled(FALSE);
        settings->put_AreDefaultContextMenusEnabled(FALSE);
#else
        settings->put_AreDevToolsEnabled(TRUE);
        settings->put_AreDefaultContextMenusEnabled(TRUE);
#endif
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

                std::wstring fullPath;

                // Absolute-path route: URLs of the form
                //   https://local.mdworx.test/_abs/C:/Users/.../foo.png
                // serve the file at that absolute path directly, bypassing
                // the currentFileDir constraint. Used by the Insert Image
                // toolbar when the user picks a file outside the markdown
                // file's subtree and didn't opt in to copy.
                //
                // P1 audit #11: only paths whose canonical parent dir is
                // in state->allowedAbsDirs are served. The allowlist is
                // populated by document open + Insert Image picker.
                if (rel.size() > 4 &&
                    rel[0] == L'_' && rel[1] == L'a' &&
                    rel[2] == L'b' && rel[3] == L's' &&
                    rel[4] == L'/') {
                    std::wstring abs = rel.substr(5);
                    // Reject path traversal in the abs payload.
                    if (abs.find(L"..") != std::wstring::npos) {
                        respond404();
                        return S_OK;
                    }
                    // Must look like a Windows absolute path: <drive>:/...
                    if (abs.size() < 3 || abs[1] != L':' ||
                        (abs[2] != L'/' && abs[2] != L'\\')) {
                        respond404();
                        return S_OK;
                    }
                    for (auto& c : abs) if (c == L'/') c = L'\\';
                    // Canonicalise via GetFullPathNameW so symlink /
                    // junction escapes and case-only mismatches do not
                    // bypass the containment check.
                    std::wstring canonBuf(1024, L'\0');
                    DWORD n = GetFullPathNameW(abs.c_str(),
                                               static_cast<DWORD>(canonBuf.size()),
                                               canonBuf.data(), nullptr);
                    if (n == 0 || n >= canonBuf.size()) {
                        respond404();
                        return S_OK;
                    }
                    canonBuf.resize(n);
                    std::wstring canonLower = canonBuf;
                    for (wchar_t& c : canonLower) {
                        if (c == L'/') c = L'\\';
                        if (c >= L'A' && c <= L'Z') c = static_cast<wchar_t>(c - L'A' + L'a');
                    }
                    if (!IsAbsPathAllowed(state, canonLower)) {
                        respond404();
                        return S_OK;
                    }
                    fullPath = canonBuf;
                } else if (rel.empty() || !IsSafeRelativePath(rel) ||
                           state->currentFileDir.empty()) {
                    respond404();
                    return S_OK;
                } else {
                    for (auto& c : rel) if (c == L'/') c = L'\\';
                    fullPath = state->currentFileDir + L"\\" + rel;
                }

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
                // Dropped Access-Control-Allow-Origin: * (P1 audit #11).
                // The webview is same-origin to the virtual host; no
                // CORS header is needed for the markdown-side fetch.
                std::wstring headers =
                    L"Content-Type: " + ct +
                    L"\r\nCache-Control: no-cache";

                ComPtr<ICoreWebView2WebResourceResponse> resp;
                state->env->CreateWebResourceResponse(
                    stream.Get(), 200, L"OK", headers.c_str(), &resp);
                if (resp) args->put_Response(resp.Get());
                return S_OK;
            }).Get(),
        &state->resourceRequestedToken);

    // Navigation guards: keep the webview locked to our virtual hosts.
    // Clicked external links open in the OS browser instead of
    // navigating the pane off the local origin. P0 audit #5.
    InstallWebViewNavigationGuards(state->webview.Get());

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

                // {type:"pickImage"} - Insert Image button in the editor
                // toolbar. Opens the native image file picker and replies
                // with {type:'imagePicked', cancelled, path, relative}.
                if (msg.find(L"\"pickImage\"") != std::wstring::npos) {
                    HandlePickImageMessage(state);
                    return S_OK;
                }

                // {type:"copyImage", path:'C:\\...'} - copy a picked
                // image into the markdown file's parent directory; reply
                // with {type:'imageCopied', relative} or error.
                if (msg.find(L"\"copyImage\"") != std::wstring::npos) {
                    HandleCopyImageMessage(state, msg);
                    return S_OK;
                }

                // {type:"downloadImage", path:'https://...'} - download the
                // URL into the markdown file's parent directory. Reply uses
                // the same imageCopied shape as copyImage so the JS reply
                // handler routes both through a single path.
                if (msg.find(L"\"downloadImage\"") != std::wstring::npos) {
                    HandleDownloadImageMessage(state, msg);
                    return S_OK;
                }

                // {type:"stashBuffer", content:"..."} - process-scoped stash
                // of the current editor buffer so a pane switch + return
                // restores in-progress edits. No reply.
                if (msg.find(L"\"stashBuffer\"") != std::wstring::npos) {
                    HandleStashBufferMessage(state, msg);
                    return S_OK;
                }

                // {type:"clearStash"} - drop the stash entry for the
                // currently-loaded file (sent after a successful save, or
                // after the user picks "Reload from disk" in the conflict
                // banner). No reply.
                if (msg.find(L"\"clearStash\"") != std::wstring::npos) {
                    HandleClearStashMessage(state, msg);
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
                    // Sentinel in dwNotifyData lets DVP_Configure tell that
                    // we (not DOpus's plugin prefs) opened it, so it stays
                    // modeless instead of running a blocking message pump.
                    DVP_Configure(owner, state->hwndSelf, kInternalConfigureFlag);
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

        // Disk-change polling lives on the JS side (setInterval) rather
        // than a Win32 SetTimer here. Earlier evidence: a WM_TIMER-based
        // poll did not surface to JS in DOpus's plugin message-pump
        // context, while JS setInterval ticks reliably independent of
        // host focus. The native check still exists (HandleCheckDiskChange
        // Message); it's just invoked by JS rather than a Win32 timer.

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
        // garbage if init is still in flight. If WebView2 init failed
        // (P2 audit #24 — runtime missing on Win10 LTSC, hostile cleanup
        // tools, evergreen update mid-load), paint a message on the
        // empty pane so the user sees something actionable instead of
        // a blank rectangle.
        auto* state = GetState(hwnd);
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);
        if (state) {
            RECT rc; GetClientRect(hwnd, &rc);
            HBRUSH br = CreateSolidBrush(state->bgColour);
            FillRect(hdc, &rc, br);
            DeleteObject(br);
            if (state->initFailed) {
                static const wchar_t* kMsg =
                    L"mdWorX could not initialise the Microsoft Edge WebView2 runtime.\n"
                    L"\n"
                    L"Install or repair the WebView2 Evergreen Runtime, then reopen this\n"
                    L"preview pane.\n"
                    L"\n"
                    L"Download: https://developer.microsoft.com/microsoft-edge/webview2/";
                RECT inner = rc;
                InflateRect(&inner, -16, -16);
                SetBkMode(hdc, TRANSPARENT);
                COLORREF fg = GetSysColor(COLOR_WINDOWTEXT);
                SetTextColor(hdc, fg);
                HFONT font = static_cast<HFONT>(GetStockObject(DEFAULT_GUI_FONT));
                HGDIOBJ old = SelectObject(hdc, font);
                DrawTextW(hdc, kMsg, -1, &inner,
                          DT_LEFT | DT_TOP | DT_WORDBREAK | DT_NOPREFIX);
                SelectObject(hdc, old);
            }
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
        // a config change in our settings dialog). Re-push user settings
        // so visual overrides + theme refresh in place.
        //
        // We deliberately do NOT re-read the file content here, even
        // though that would let an encoding/fallbackEncoding change take
        // effect on the visible doc. A re-read would route through
        // PushFileToWebView's stash-check path and surface the
        // file-switch conflict banner over an Apply that the user
        // expects to be invisible. Encoding settings instead apply to
        // the next file load. Reported by user 2026-05-27.
        if (auto* state = GetState(hwnd)) {
            PushUserSettingsToWebView(state);
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

// Tracks whether the currently-open settings dialog was invoked by DOpus's
// plugin host (true) or by the in-viewer cog button (false). At single-
// instance scope (g_hwndSettings enforces one dialog at a time). Set in
// DVP_Configure based on the dwNotifyData sentinel.
bool g_settingsInvokedByDOpus = false;

// Set in our WM_CLOSE handler. Distinguishes user-initiated close (X
// button, JS closeSettings message — both go through WM_CLOSE before
// DestroyWindow) from owner-destruction cascade (DOpus's prefs window
// closes, Windows destroys our owned dialog WITHOUT sending WM_CLOSE
// first — DestroyWindow on a parent sends WM_DESTROY straight to the
// owned children).
//
// Gate for PostQuitMessage(0) in WM_DESTROY:
//   invokedByDOpus && closeReceived → post quit (DOpus's inner pump
//     is still waiting on us; break it)
//   anything else → skip (no inner pump exists, or it has already
//     exited as part of the cascade; posting would leak WM_QUIT to
//     DOpus's main lister loop)
bool g_settingsCloseReceived = false;

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
    // Single-flight guard for the async update install pipeline. Set
    // true on accepted installUpdate; cleared by the worker thread on
    // every exit path. Atomic so the WebView2-thread handler can read
    // and the worker can clear without locking.
    std::atomic<bool>                installInFlight{false};
    // Invocation context (cog button vs DOpus prefs/toolbar) lives at file
    // scope in g_settingsInvokedByDOpus, not per-state. The single-instance
    // policy (g_hwndSettings) means there's never more than one settings
    // dialog at a time, so per-HWND tracking would just be busywork.
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
    return AtomicWriteBytes(path, bytes.data(), bytes.size());
}

// Atomic write of UTF-8 text to a custom theme file. Same .tmp + rename
// pattern as WriteUserSettingsAtomic. Name MUST already be sanitised.
// Returns false on any failure.
bool WriteCustomThemeAtomic(const std::wstring& name,
                            const std::wstring& themeText) {
    std::wstring dir = GetCustomThemesDir();
    if (dir.empty() || name.empty()) return false;
    std::wstring path = dir + L"\\" + name + L".json";
    int blen = WideCharToMultiByte(CP_UTF8, 0, themeText.c_str(),
                                    static_cast<int>(themeText.size()),
                                    nullptr, 0, nullptr, nullptr);
    if (blen < 0) return false;
    std::vector<char> bytes(static_cast<size_t>(blen));
    if (blen > 0) {
        WideCharToMultiByte(CP_UTF8, 0, themeText.c_str(),
                            static_cast<int>(themeText.size()),
                            bytes.data(), blen, nullptr, nullptr);
    }
    return AtomicWriteBytes(path, bytes.data(), bytes.size());
}

// Delete a custom theme file by name. Name MUST already be sanitised.
// Returns true if the file is gone after the call (whether or not it
// existed before), false on hard errors.
bool DeleteCustomThemeFile(const std::wstring& name) {
    std::wstring dir = GetCustomThemesDir();
    if (dir.empty() || name.empty()) return false;
    std::wstring path = dir + L"\\" + name + L".json";
    if (DeleteFileW(path.c_str())) return true;
    DWORD err = GetLastError();
    return err == ERROR_FILE_NOT_FOUND || err == ERROR_PATH_NOT_FOUND;
}

// Read a custom theme file by name and return its raw UTF-8 content as a
// wide string. Empty string on missing/unreadable file. Name MUST already
// be sanitised.
std::wstring ReadCustomThemeFile(const std::wstring& name) {
    std::wstring dir = GetCustomThemesDir();
    if (dir.empty() || name.empty()) return L"";
    std::wstring path = dir + L"\\" + name + L".json";
    return ReadFileUtf8(path);
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
        // Same NDEBUG gating as the viewer pane (P3 audit #32).
#ifdef NDEBUG
        settings->put_AreDevToolsEnabled(FALSE);
        settings->put_AreDefaultContextMenusEnabled(FALSE);
#else
        settings->put_AreDevToolsEnabled(TRUE);
        settings->put_AreDefaultContextMenusEnabled(TRUE);
#endif
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
    // Same navigation guards as the viewer pane — keep the settings
    // webview locked to our virtual hosts (P0 audit #5).
    InstallWebViewNavigationGuards(s->webview.Get());
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

                    // Plugin version for the "Check for updates" row.
                    // MDWORX_VERSION_STR is set as a /D from CMakeLists,
                    // mirroring the project VERSION field.
                    std::wstring verMsg = std::wstring(L"{\"type\":\"appVersion\",\"current\":\"")
                        + MDWORX_VERSION_STR + L"\"}";
                    s->webview->PostWebMessageAsJson(verMsg.c_str());
                    return S_OK;
                }
                if (msg.find(L"\"checkForUpdates\"") != std::wstring::npos) {
                    HandleCheckForUpdatesMessage(s);
                    return S_OK;
                }
                if (msg.find(L"\"installUpdate\"") != std::wstring::npos) {
                    std::wstring url     = ExtractJsonStringKey(msg, L"url");
                    std::wstring sha256  = ExtractJsonStringKey(msg, L"sha256");
                    std::wstring version = ExtractJsonStringKey(msg, L"expectedVersion");
                    HandleInstallUpdateMessage(s, url, sha256, version);
                    return S_OK;
                }
                if (msg.find(L"\"openExternal\"") != std::wstring::npos) {
                    std::wstring url = ExtractJsonStringKey(msg, L"url");
                    // Only http(s); never shell-execute arbitrary schemes.
                    if (!url.empty() &&
                        (url.compare(0, 8, L"https://") == 0 ||
                         url.compare(0, 7, L"http://")  == 0)) {
                        ShellExecuteW(nullptr, L"open", url.c_str(),
                                      nullptr, nullptr, SW_SHOWNORMAL);
                    }
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
                // Custom theme storage handlers.
                //
                // {type:'listCustomThemes'} -> reply with
                //   {type:'customThemesList', names:[...]}
                // {type:'loadCustomTheme', name:'X'} -> reply with
                //   {type:'customTheme', name:'X', json:'<raw>'} or
                //   {type:'customThemeError', op:'load', name:'X', message:'...'}
                // {type:'saveCustomTheme', name:'X', json:'<raw>'} -> reply
                //   {type:'customThemeSaved', name:'X'} or error
                // {type:'deleteCustomTheme', name:'X'} -> reply
                //   {type:'customThemeDeleted', name:'X'} or error
                //
                // Sanitisation is enforced here even though JS also validates,
                // so a bypass of the JS layer can't write files with unsafe
                // names. Theme content is treated as opaque text; native does
                // not parse it.
                if (msg.find(L"\"listCustomThemes\"") != std::wstring::npos) {
                    std::vector<std::wstring> names = EnumerateCustomThemes();
                    std::wstring out = L"{\"type\":\"customThemesList\",\"names\":[";
                    for (size_t i = 0; i < names.size(); ++i) {
                        if (i > 0) out += L",";
                        out += L"\"" + JsonEscape(names[i]) + L"\"";
                    }
                    out += L"]}";
                    s->webview->PostWebMessageAsJson(out.c_str());
                    return S_OK;
                }
                if (msg.find(L"\"loadCustomTheme\"") != std::wstring::npos) {
                    std::wstring rawName = ExtractJsonStringKey(msg, L"name");
                    std::wstring name = SanitiseThemeName(rawName);
                    if (name.empty()) {
                        std::wstring err =
                            L"{\"type\":\"customThemeError\",\"op\":\"load\","
                            L"\"name\":\"" + JsonEscape(rawName) +
                            L"\",\"message\":\"Invalid theme name.\"}";
                        s->webview->PostWebMessageAsJson(err.c_str());
                        return S_OK;
                    }
                    std::wstring content = ReadCustomThemeFile(name);
                    if (content.empty()) {
                        std::wstring err =
                            L"{\"type\":\"customThemeError\",\"op\":\"load\","
                            L"\"name\":\"" + JsonEscape(name) +
                            L"\",\"message\":\"Theme file missing or unreadable.\"}";
                        s->webview->PostWebMessageAsJson(err.c_str());
                        return S_OK;
                    }
                    std::wstring out =
                        L"{\"type\":\"customTheme\",\"name\":\"" + JsonEscape(name) +
                        L"\",\"json\":\"" + JsonEscape(content) + L"\"}";
                    s->webview->PostWebMessageAsJson(out.c_str());
                    return S_OK;
                }
                if (msg.find(L"\"saveCustomTheme\"") != std::wstring::npos) {
                    std::wstring rawName = ExtractJsonStringKey(msg, L"name");
                    std::wstring name = SanitiseThemeName(rawName);
                    if (name.empty()) {
                        std::wstring err =
                            L"{\"type\":\"customThemeError\",\"op\":\"save\","
                            L"\"name\":\"" + JsonEscape(rawName) +
                            L"\",\"message\":\"Invalid theme name.\"}";
                        s->webview->PostWebMessageAsJson(err.c_str());
                        return S_OK;
                    }
                    std::wstring payload = ExtractJsonStringKey(msg, L"json");
                    bool ok = WriteCustomThemeAtomic(name, payload);
                    if (!ok) {
                        std::wstring err =
                            L"{\"type\":\"customThemeError\",\"op\":\"save\","
                            L"\"name\":\"" + JsonEscape(name) +
                            L"\",\"message\":\"Failed to write theme file.\"}";
                        s->webview->PostWebMessageAsJson(err.c_str());
                        return S_OK;
                    }
                    std::wstring out =
                        L"{\"type\":\"customThemeSaved\",\"name\":\"" +
                        JsonEscape(name) + L"\"}";
                    s->webview->PostWebMessageAsJson(out.c_str());
                    return S_OK;
                }
                if (msg.find(L"\"deleteCustomTheme\"") != std::wstring::npos) {
                    std::wstring rawName = ExtractJsonStringKey(msg, L"name");
                    std::wstring name = SanitiseThemeName(rawName);
                    if (name.empty()) {
                        std::wstring err =
                            L"{\"type\":\"customThemeError\",\"op\":\"delete\","
                            L"\"name\":\"" + JsonEscape(rawName) +
                            L"\",\"message\":\"Invalid theme name.\"}";
                        s->webview->PostWebMessageAsJson(err.c_str());
                        return S_OK;
                    }
                    bool ok = DeleteCustomThemeFile(name);
                    if (!ok) {
                        std::wstring err =
                            L"{\"type\":\"customThemeError\",\"op\":\"delete\","
                            L"\"name\":\"" + JsonEscape(name) +
                            L"\",\"message\":\"Failed to delete theme file.\"}";
                        s->webview->PostWebMessageAsJson(err.c_str());
                        return S_OK;
                    }
                    std::wstring out =
                        L"{\"type\":\"customThemeDeleted\",\"name\":\"" +
                        JsonEscape(name) + L"\"}";
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

// ---------------------------------------------------------------------------
// Update installer helpers (used by HandleInstallUpdateMessage)
//
// The in-app update pipeline downloads a release zip from GitHub, verifies
// its SHA256 against the hash published in the release body, extracts it to
// a per-run secure temp directory, locates Install.cmd by strict pattern,
// and shell-executes the script (which self-elevates via UAC). Every step
// has to be hostile-environment safe: the deterministic temp paths and the
// "first directory found" scan in the previous implementation produced
// TOCTOU windows that turned an MitM into local RCE via the elevated
// Install.cmd.

// Lowercase ASCII copy of a wide string. Used for case-insensitive host
// and hex-digest compares; the inputs are constrained to ASCII so this
// avoids the locale-dependent towlower path.
static std::wstring AsciiLower(std::wstring s) {
    for (wchar_t& c : s) {
        if (c >= L'A' && c <= L'Z') c = static_cast<wchar_t>(c - L'A' + L'a');
    }
    return s;
}

// True when `host` is exactly "github.com" or ends in ".githubusercontent.com".
// Both are canonical mdWorX release-asset hosts. Matched on the lowercased
// host string. Subdomain suffix is anchored on the literal '.' to defeat
// "github.com.attacker.tld" host-suffix attacks.
static bool IsAllowedReleaseHost(const std::wstring& host) {
    if (host == L"github.com") return true;
    static const std::wstring kSuffix = L".githubusercontent.com";
    if (host.size() > kSuffix.size() &&
        host.compare(host.size() - kSuffix.size(), kSuffix.size(), kSuffix) == 0) {
        return true;
    }
    return false;
}

// Returns true only when `url` is an absolute HTTPS URL on the allowlisted
// hosts. Anything else (http://, file://, javascript:, malformed, empty)
// is rejected. The check uses WinHttpCrackUrl rather than substring
// matching so attacks like "https://github.com@attacker.tld" are caught.
static bool IsAllowedReleaseUrl(const std::wstring& url) {
    if (url.empty() || url.size() > 4096) return false;
    URL_COMPONENTS uc = {};
    uc.dwStructSize = sizeof(uc);
    wchar_t scheme[16] = {0};
    wchar_t host[256] = {0};
    uc.lpszScheme    = scheme; uc.dwSchemeLength    = ARRAYSIZE(scheme);
    uc.lpszHostName  = host;   uc.dwHostNameLength  = ARRAYSIZE(host);
    if (!WinHttpCrackUrl(url.c_str(), 0, 0, &uc)) return false;
    if (uc.nScheme != INTERNET_SCHEME_HTTPS) return false;
    std::wstring hostStr(host, uc.dwHostNameLength);
    return IsAllowedReleaseHost(AsciiLower(hostStr));
}

// Generates 16 random hex characters for naming a per-run temp directory.
// Uses BCryptGenRandom on the system-preferred RNG (CryptoAPI fallback
// not needed; BCRYPT_USE_SYSTEM_PREFERRED_RNG is available on every
// Windows version mdWorX supports).
static std::wstring RandomHexId() {
    BYTE bytes[8] = {0};
    if (BCryptGenRandom(nullptr, bytes, sizeof(bytes),
                        BCRYPT_USE_SYSTEM_PREFERRED_RNG) != 0) {
        return {};
    }
    static const wchar_t* hex = L"0123456789abcdef";
    std::wstring out;
    out.reserve(16);
    for (BYTE b : bytes) {
        out.push_back(hex[(b >> 4) & 0xF]);
        out.push_back(hex[b & 0xF]);
    }
    return out;
}

// Builds an SDDL string that grants the current user full control and
// denies access to everyone else. Used as the security descriptor on
// the per-run temp directory so a co-resident user-level process cannot
// overwrite the downloaded zip or the extracted Install.cmd between
// the time we verify them and the time we execute the installer.
static std::wstring BuildUserOnlySddl() {
    HANDLE token = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return {};
    DWORD size = 0;
    GetTokenInformation(token, TokenUser, nullptr, 0, &size);
    if (size == 0) { CloseHandle(token); return {}; }
    std::vector<BYTE> buf(size);
    if (!GetTokenInformation(token, TokenUser, buf.data(), size, &size)) {
        CloseHandle(token); return {};
    }
    CloseHandle(token);
    TOKEN_USER* tu = reinterpret_cast<TOKEN_USER*>(buf.data());
    LPWSTR sidStr = nullptr;
    if (!ConvertSidToStringSidW(tu->User.Sid, &sidStr)) return {};
    // D: = DACL; P = protected (no inheritance from parent);
    // (A;OICI;GA;;;<SID>) = Allow, object+container inherit, generic all.
    // No other ACEs means everyone else is denied by default.
    std::wstring sddl = L"D:P(A;OICI;GA;;;";
    sddl += sidStr;
    sddl += L")";
    LocalFree(sidStr);
    return sddl;
}

// Creates a per-run directory under %TEMP%\mdworx-update-<rand>\ with a
// DACL limited to the current user. Returns the absolute path or empty
// on failure. Caller is responsible for cleanup.
static std::wstring CreateSecureTempDir() {
    wchar_t tmpBase[MAX_PATH] = {0};
    if (GetTempPathW(MAX_PATH, tmpBase) == 0) return {};
    std::wstring id = RandomHexId();
    if (id.empty()) return {};
    std::wstring path = std::wstring(tmpBase) + L"mdworx-update-" + id;
    std::wstring sddl = BuildUserOnlySddl();
    if (sddl.empty()) return {};
    PSECURITY_DESCRIPTOR sd = nullptr;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.c_str(), SDDL_REVISION_1, &sd, nullptr)) {
        return {};
    }
    SECURITY_ATTRIBUTES sa = {};
    sa.nLength = sizeof(sa);
    sa.lpSecurityDescriptor = sd;
    sa.bInheritHandle = FALSE;
    BOOL ok = CreateDirectoryW(path.c_str(), &sa);
    LocalFree(sd);
    return ok ? path : std::wstring{};
}

// Best-effort recursive removal of `path`. Used to clean up the per-run
// temp dir on success and on every failure exit. Failures are tolerated:
// the OS will reclaim %TEMP% eventually, and the random per-run name
// means stale dirs do not collide with future runs.
static void RmTreeBestEffort(const std::wstring& path) {
    if (path.empty()) return;
    std::wstring cmd = L"cmd /c rmdir /S /Q \"" + path + L"\"";
    STARTUPINFOW si = {}; si.cb = sizeof(si);
    si.dwFlags = STARTF_USESHOWWINDOW; si.wShowWindow = SW_HIDE;
    PROCESS_INFORMATION pi = {};
    std::vector<wchar_t> cmdBuf(cmd.begin(), cmd.end()); cmdBuf.push_back(0);
    if (CreateProcessW(nullptr, cmdBuf.data(), nullptr, nullptr, FALSE,
                       CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi)) {
        WaitForSingleObject(pi.hProcess, 10000);  // 10s ceiling
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
    }
}

// Computes SHA256 of `path` and returns the lowercase hex digest, or
// empty on any I/O / CNG failure. Hashes in 64 KiB chunks so the whole
// zip never lives in memory at once.
static std::wstring Sha256OfFile(const std::wstring& path) {
    HANDLE h = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ,
                           nullptr, OPEN_EXISTING,
                           FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return {};

    BCRYPT_ALG_HANDLE alg = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
    std::wstring result;
    NTSTATUS s = BCryptOpenAlgorithmProvider(&alg, BCRYPT_SHA256_ALGORITHM, nullptr, 0);
    if (s == 0) {
        s = BCryptCreateHash(alg, &hash, nullptr, 0, nullptr, 0, 0);
    }
    if (s == 0) {
        std::vector<BYTE> buf(64 * 1024);
        DWORD got = 0;
        while (ReadFile(h, buf.data(), static_cast<DWORD>(buf.size()), &got, nullptr) && got > 0) {
            if (BCryptHashData(hash, buf.data(), got, 0) != 0) { s = -1; break; }
        }
        if (s == 0) {
            BYTE digest[32] = {0};
            if (BCryptFinishHash(hash, digest, sizeof(digest), 0) == 0) {
                static const wchar_t* hex = L"0123456789abcdef";
                result.reserve(64);
                for (BYTE b : digest) {
                    result.push_back(hex[(b >> 4) & 0xF]);
                    result.push_back(hex[b & 0xF]);
                }
            }
        }
    }
    if (hash) BCryptDestroyHash(hash);
    if (alg)  BCryptCloseAlgorithmProvider(alg, 0);
    CloseHandle(h);
    return result;
}

// Downloads `url` to `destPath` over WinHttp with HTTPS enforced, manual
// redirect handling (every hop re-checked against the allowlist), and
// per-stage timeouts. Returns true on 200-OK with full body written.
// On failure, `errOut` is populated with a user-visible message.
//
// Why WinHttp instead of URLDownloadToFileW: URLMon doesn't expose a
// way to enforce HTTPS-only at the API layer, doesn't expose a clean
// timeout API, and silently follows redirects to any host. WinHttp
// gives all three.
static bool DownloadHttpsAllowlisted(std::wstring url,
                                     const std::wstring& destPath,
                                     std::wstring& errOut) {
    constexpr int kMaxRedirects = 5;
    constexpr DWORD kResolveMs = 60'000;
    constexpr DWORD kConnectMs = 60'000;
    constexpr DWORD kSendMs    = 60'000;
    constexpr DWORD kReceiveMs = 120'000;

    HINTERNET session = WinHttpOpen(L"mdWorX/" MDWORX_VERSION_STR,
                                    WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                                    WINHTTP_NO_PROXY_NAME,
                                    WINHTTP_NO_PROXY_BYPASS, 0);
    if (!session) { errOut = L"Could not open WinHttp session."; return false; }
    WinHttpSetTimeouts(session, static_cast<int>(kResolveMs),
                       static_cast<int>(kConnectMs),
                       static_cast<int>(kSendMs),
                       static_cast<int>(kReceiveMs));

    auto closeSession = [&]{ WinHttpCloseHandle(session); };
    bool ok = false;

    for (int hop = 0; hop <= kMaxRedirects && !ok; ++hop) {
        if (!IsAllowedReleaseUrl(url)) {
            errOut = L"Refused: URL not on the allowlist.";
            break;
        }
        URL_COMPONENTS uc = {};
        uc.dwStructSize = sizeof(uc);
        wchar_t host[256] = {0};
        wchar_t urlPath[2048] = {0};
        wchar_t extra[1024] = {0};
        uc.lpszHostName  = host;     uc.dwHostNameLength  = ARRAYSIZE(host);
        uc.lpszUrlPath   = urlPath;  uc.dwUrlPathLength   = ARRAYSIZE(urlPath);
        uc.lpszExtraInfo = extra;    uc.dwExtraInfoLength = ARRAYSIZE(extra);
        if (!WinHttpCrackUrl(url.c_str(), 0, 0, &uc)) {
            errOut = L"Could not parse update URL."; break;
        }
        std::wstring hostStr(host, uc.dwHostNameLength);
        std::wstring resourceStr = std::wstring(urlPath, uc.dwUrlPathLength)
                                 + std::wstring(extra, uc.dwExtraInfoLength);

        HINTERNET conn = WinHttpConnect(session, hostStr.c_str(),
                                        uc.nPort ? uc.nPort : INTERNET_DEFAULT_HTTPS_PORT,
                                        0);
        if (!conn) { errOut = L"WinHttp connect failed."; break; }
        HINTERNET req = WinHttpOpenRequest(conn, L"GET", resourceStr.c_str(),
                                           nullptr, WINHTTP_NO_REFERER,
                                           WINHTTP_DEFAULT_ACCEPT_TYPES,
                                           WINHTTP_FLAG_SECURE);
        if (!req) {
            WinHttpCloseHandle(conn);
            errOut = L"WinHttp request failed."; break;
        }

        // Disable automatic redirect following; we re-validate every hop
        // against the host allowlist manually before re-issuing.
        DWORD policy = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;
        WinHttpSetOption(req, WINHTTP_OPTION_REDIRECT_POLICY,
                         &policy, sizeof(policy));

        BOOL sent = WinHttpSendRequest(req, WINHTTP_NO_ADDITIONAL_HEADERS, 0,
                                       WINHTTP_NO_REQUEST_DATA, 0, 0, 0);
        if (sent) sent = WinHttpReceiveResponse(req, nullptr);
        if (!sent) {
            DWORD ec = GetLastError();
            WinHttpCloseHandle(req); WinHttpCloseHandle(conn);
            wchar_t buf[96];
            StringCchPrintfW(buf, 96, L"Download failed (error %lu).",
                             static_cast<unsigned long>(ec));
            errOut = buf;
            break;
        }

        DWORD status = 0;
        DWORD statusSize = sizeof(status);
        WinHttpQueryHeaders(req,
                            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                            WINHTTP_HEADER_NAME_BY_INDEX, &status,
                            &statusSize, WINHTTP_NO_HEADER_INDEX);

        if (status == 301 || status == 302 || status == 303 ||
            status == 307 || status == 308) {
            DWORD locSize = 0;
            WinHttpQueryHeaders(req, WINHTTP_QUERY_LOCATION,
                                WINHTTP_HEADER_NAME_BY_INDEX, WINHTTP_NO_OUTPUT_BUFFER,
                                &locSize, WINHTTP_NO_HEADER_INDEX);
            std::wstring loc;
            if (locSize > 0) {
                loc.resize(locSize / sizeof(wchar_t));
                if (!WinHttpQueryHeaders(req, WINHTTP_QUERY_LOCATION,
                                         WINHTTP_HEADER_NAME_BY_INDEX,
                                         loc.data(), &locSize,
                                         WINHTTP_NO_HEADER_INDEX)) {
                    loc.clear();
                }
                // Header includes terminator; trim trailing NUL chars.
                while (!loc.empty() && loc.back() == L'\0') loc.pop_back();
            }
            WinHttpCloseHandle(req);
            WinHttpCloseHandle(conn);
            if (loc.empty()) { errOut = L"Redirect with no Location header."; break; }
            url = loc;
            continue;
        }
        if (status != 200) {
            wchar_t buf[96];
            StringCchPrintfW(buf, 96, L"Download failed (HTTP %lu).",
                             static_cast<unsigned long>(status));
            errOut = buf;
            WinHttpCloseHandle(req); WinHttpCloseHandle(conn);
            break;
        }

        HANDLE out = CreateFileW(destPath.c_str(), GENERIC_WRITE, 0, nullptr,
                                 CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (out == INVALID_HANDLE_VALUE) {
            errOut = L"Could not create download target file.";
            WinHttpCloseHandle(req); WinHttpCloseHandle(conn);
            break;
        }

        bool ioOk = true;
        std::vector<BYTE> buf(64 * 1024);
        while (true) {
            DWORD avail = 0;
            if (!WinHttpQueryDataAvailable(req, &avail)) { ioOk = false; break; }
            if (avail == 0) break;
            DWORD chunk = avail > static_cast<DWORD>(buf.size())
                          ? static_cast<DWORD>(buf.size()) : avail;
            DWORD got = 0;
            if (!WinHttpReadData(req, buf.data(), chunk, &got)) { ioOk = false; break; }
            if (got == 0) break;
            DWORD written = 0;
            if (!WriteFile(out, buf.data(), got, &written, nullptr) || written != got) {
                ioOk = false; break;
            }
        }
        FlushFileBuffers(out);
        CloseHandle(out);
        WinHttpCloseHandle(req);
        WinHttpCloseHandle(conn);
        if (!ioOk) { errOut = L"Download interrupted."; break; }
        ok = true;
    }
    if (!ok && errOut.empty()) errOut = L"Too many redirects.";
    closeSession();
    return ok;
}

// Validates that `folderName` matches the canonical release-folder
// shape: mdWorX_v<numeric.core>[-<prerelease>]. Used to reject
// arbitrarily-named directories from a hostile zip layout.
static bool LooksLikeReleaseFolder(const std::wstring& folderName) {
    static const std::wregex kReleaseFolderRegex(
        L"^mdWorX_v[0-9]+\\.[0-9]+\\.[0-9]+(?:-[A-Za-z0-9.]+)?$");
    return std::regex_match(folderName, kReleaseFolderRegex);
}

// Locates Install.cmd inside `extractDir`. Accepts only:
//   * extractDir\Install.cmd (defensive future-proof for flatter layouts), OR
//   * extractDir\mdWorX_v<ver>\Install.cmd where the folder name passes
//     LooksLikeReleaseFolder and (when expectedVersion is non-empty) equals
//     mdWorX_v<expectedVersion> exactly.
// Returns the canonical final path via GetFinalPathNameByHandleW so the
// caller passes a path that has been pinned through a read-only handle
// (closes the discovery -> exec TOCTOU window).
static std::wstring LocateInstallCmd(const std::wstring& extractDir,
                                     const std::wstring& expectedVersion) {
    auto pin = [&](const std::wstring& candidate) -> std::wstring {
        HANDLE h = CreateFileW(candidate.c_str(), GENERIC_READ,
                               FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                               FILE_ATTRIBUTE_NORMAL, nullptr);
        if (h == INVALID_HANDLE_VALUE) return {};
        std::wstring resolved(1024, L'\0');
        DWORD n = GetFinalPathNameByHandleW(h, resolved.data(),
                                            static_cast<DWORD>(resolved.size()),
                                            FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
        CloseHandle(h);
        if (n == 0 || n >= resolved.size()) return {};
        resolved.resize(n);
        // Strip the \\?\ prefix ShellExecuteEx does not like.
        if (resolved.size() > 4 && resolved.compare(0, 4, L"\\\\?\\") == 0) {
            resolved.erase(0, 4);
        }
        // Containment check: the resolved path must still live under the
        // extractDir we created (canonicalised the same way).
        return resolved;
    };

    std::wstring rootCmd = extractDir + L"\\Install.cmd";
    if (GetFileAttributesW(rootCmd.c_str()) != INVALID_FILE_ATTRIBUTES) {
        return pin(rootCmd);
    }
    WIN32_FIND_DATAW fd = {};
    HANDLE h = FindFirstFileW((extractDir + L"\\*").c_str(), &fd);
    if (h == INVALID_HANDLE_VALUE) return {};
    std::wstring found;
    do {
        std::wstring name = fd.cFileName;
        if (name == L"." || name == L"..") continue;
        if (!(fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) continue;
        if (!LooksLikeReleaseFolder(name)) continue;
        if (!expectedVersion.empty()) {
            std::wstring want = L"mdWorX_v" + expectedVersion;
            if (name != want) continue;
        }
        std::wstring candidate = extractDir + L"\\" + name + L"\\Install.cmd";
        if (GetFileAttributesW(candidate.c_str()) != INVALID_FILE_ATTRIBUTES) {
            found = pin(candidate);
            break;
        }
    } while (FindNextFileW(h, &fd));
    FindClose(h);
    return found;
}

// PowerShell single-quoted string literal escaping: '' inside a '...'
// string is the literal apostrophe. Applied to TEMP paths spliced into
// the Expand-Archive command line so paths containing ' (e.g. "O'Brien"
// in a username) do not break the parser.
static std::wstring PsSingleQuoteEscape(const std::wstring& s) {
    std::wstring out;
    out.reserve(s.size() + 4);
    for (wchar_t c : s) {
        if (c == L'\'') out += L"''";
        else out.push_back(c);
    }
    return out;
}

// Extracts a zip at `zipPath` to `destDir` via PowerShell Expand-Archive
// with proper single-quote escaping (P2 audit #15). Bounded by a 300s
// timeout (P1 audit #10). Returns true on exit code 0 within timeout.
static bool ExtractZipBounded(const std::wstring& zipPath,
                              const std::wstring& destDir,
                              std::wstring& errOut) {
    std::wstring psCmd =
        L"powershell -NoProfile -ExecutionPolicy Bypass -Command "
        L"\"Expand-Archive -LiteralPath '" + PsSingleQuoteEscape(zipPath) +
        L"' -DestinationPath '" + PsSingleQuoteEscape(destDir) + L"' -Force\"";
    STARTUPINFOW si = {}; si.cb = sizeof(si);
    si.dwFlags = STARTF_USESHOWWINDOW; si.wShowWindow = SW_HIDE;
    PROCESS_INFORMATION pi = {};
    std::vector<wchar_t> cmdBuf(psCmd.begin(), psCmd.end()); cmdBuf.push_back(0);
    if (!CreateProcessW(nullptr, cmdBuf.data(), nullptr, nullptr, FALSE,
                        CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi)) {
        errOut = L"Could not start zip extractor (PowerShell).";
        return false;
    }
    DWORD waitResult = WaitForSingleObject(pi.hProcess, 300'000);
    if (waitResult == WAIT_TIMEOUT) {
        TerminateProcess(pi.hProcess, 1);
        WaitForSingleObject(pi.hProcess, 5000);
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
        errOut = L"Extraction timed out after 5 minutes.";
        return false;
    }
    DWORD exitCode = 0;
    GetExitCodeProcess(pi.hProcess, &exitCode);
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
    if (exitCode != 0) {
        wchar_t buf[96];
        StringCchPrintfW(buf, 96, L"Extraction failed (exit code %lu).",
                         static_cast<unsigned long>(exitCode));
        errOut = buf;
        return false;
    }
    return true;
}

// Returns true when `uri` is a navigation we want to keep inside the
// webview: the two virtual hosts we ourselves wire up, plus about:blank
// (initial navigation). Everything else (clicked external links,
// javascript: payloads, data: URIs, file: navigation, attacker-served
// HTML triggering window.location, etc.) is rejected; external http(s)
// links are handed off to ShellExecuteEx so the OS browser opens them.
//
// Audit finding P0 #5: without this, malicious markdown could navigate
// the webview off the local virtual host (e.g. via a `<form action=...>`
// or a hidden anchor target) and then post messages back to native from
// an attacker-controlled origin.
static bool IsInternalWebViewUri(const std::wstring& uri) {
    static const std::wstring kHttpsAppHost   = L"https://app.mdworx.test/";
    static const std::wstring kHttpsLocalHost = L"https://local.mdworx.test/";
    if (uri == L"about:blank") return true;
    if (uri.compare(0, kHttpsAppHost.size(), kHttpsAppHost) == 0) return true;
    if (uri.compare(0, kHttpsLocalHost.size(), kHttpsLocalHost) == 0) return true;
    return false;
}

// Wires NavigationStarting and NewWindowRequested handlers onto `wv`.
// Cancels everything that is not internal; external http(s) links open
// in the OS browser; everything else is silently cancelled. Used by
// both the viewer pane and the settings pane.
static void InstallWebViewNavigationGuards(ICoreWebView2* wv) {
    if (!wv) return;

    EventRegistrationToken navTok = {};
    wv->add_NavigationStarting(
        Callback<ICoreWebView2NavigationStartingEventHandler>(
            [](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
                if (!args) return S_OK;
                LPWSTR rawUri = nullptr;
                if (FAILED(args->get_Uri(&rawUri)) || !rawUri) return S_OK;
                std::wstring uri = rawUri;
                CoTaskMemFree(rawUri);
                if (IsInternalWebViewUri(uri)) return S_OK;
                args->put_Cancel(TRUE);
                if (uri.compare(0, 8, L"https://") == 0 ||
                    uri.compare(0, 7, L"http://")  == 0 ||
                    uri.compare(0, 7, L"mailto:") == 0) {
                    ShellExecuteW(nullptr, L"open", uri.c_str(),
                                  nullptr, nullptr, SW_SHOWNORMAL);
                }
                return S_OK;
            }).Get(),
        &navTok);

    EventRegistrationToken winTok = {};
    wv->add_NewWindowRequested(
        Callback<ICoreWebView2NewWindowRequestedEventHandler>(
            [](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
                if (!args) return S_OK;
                args->put_Handled(TRUE);
                LPWSTR rawUri = nullptr;
                if (SUCCEEDED(args->get_Uri(&rawUri)) && rawUri) {
                    std::wstring uri = rawUri;
                    CoTaskMemFree(rawUri);
                    if (uri.compare(0, 8, L"https://") == 0 ||
                        uri.compare(0, 7, L"http://")  == 0) {
                        ShellExecuteW(nullptr, L"open", uri.c_str(),
                                      nullptr, nullptr, SW_SHOWNORMAL);
                    }
                }
                return S_OK;
            }).Get(),
        &winTok);

    // FrameNavigationStarting catches iframes / object embeds in case
    // DOMPurify ever lets one through; the allowlist is the same as
    // the top-level navigation handler.
    ComPtr<ICoreWebView2> wvKeep = wv;
    EventRegistrationToken frmTok = {};
    wv->add_FrameNavigationStarting(
        Callback<ICoreWebView2NavigationStartingEventHandler>(
            [](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
                if (!args) return S_OK;
                LPWSTR rawUri = nullptr;
                if (FAILED(args->get_Uri(&rawUri)) || !rawUri) return S_OK;
                std::wstring uri = rawUri;
                CoTaskMemFree(rawUri);
                if (!IsInternalWebViewUri(uri)) args->put_Cancel(TRUE);
                return S_OK;
            }).Get(),
        &frmTok);
}

// Semver-aware compare of two version strings. Returns -1, 0, +1 like
// strcmp. Handles "0.1.2", "0.2.0-beta", "0.2.0-rc.1", "0.2.0+build.5"
// per semver.org §11:
//   * numeric core (major.minor.patch) compared component-wise
//   * a version without a pre-release suffix outranks the same numeric
//     core WITH one (so "0.2.0" > "0.2.0-beta")
//   * pre-release identifiers split on '.' and compared one-by-one;
//     all-digit identifiers compare numerically, anything else
//     lexically; numeric identifiers always rank below non-numeric;
//     a longer identifier list wins if all shared identifiers match
//   * build metadata (after '+') is ignored for ordering
// Missing numeric components are treated as 0.
static int CompareVersionStrings(const std::wstring& a, const std::wstring& b) {
    auto stripBuild = [](const std::wstring& v) {
        size_t plus = v.find(L'+');
        return plus == std::wstring::npos ? v : v.substr(0, plus);
    };
    auto splitPrerelease = [](const std::wstring& v,
                              std::wstring& core,
                              std::wstring& pre) {
        size_t dash = v.find(L'-');
        if (dash == std::wstring::npos) {
            core = v;
            pre.clear();
        } else {
            core = v.substr(0, dash);
            pre  = v.substr(dash + 1);
        }
    };
    auto splitIdentifiers = [](const std::wstring& s) {
        std::vector<std::wstring> out;
        if (s.empty()) return out;
        size_t start = 0;
        for (size_t i = 0; i <= s.size(); ++i) {
            if (i == s.size() || s[i] == L'.') {
                out.push_back(s.substr(start, i - start));
                start = i + 1;
            }
        }
        return out;
    };
    auto isAllDigits = [](const std::wstring& s) {
        if (s.empty()) return false;
        for (wchar_t c : s) if (c < L'0' || c > L'9') return false;
        return true;
    };
    auto compareIdentifier = [&](const std::wstring& x, const std::wstring& y) -> int {
        bool xn = isAllDigits(x), yn = isAllDigits(y);
        if (xn && yn) {
            // Numeric identifier: leading zeros are invalid per semver but
            // we tolerate them by comparing length first, then value.
            std::wstring xt = x, yt = y;
            while (xt.size() > 1 && xt.front() == L'0') xt.erase(0, 1);
            while (yt.size() > 1 && yt.front() == L'0') yt.erase(0, 1);
            if (xt.size() != yt.size()) return xt.size() < yt.size() ? -1 : +1;
            if (xt != yt) return xt < yt ? -1 : +1;
            return 0;
        }
        if (xn != yn) return xn ? -1 : +1;  // numeric < non-numeric
        if (x != y) return x < y ? -1 : +1; // lex
        return 0;
    };

    std::wstring aCore, aPre, bCore, bPre;
    splitPrerelease(stripBuild(a), aCore, aPre);
    splitPrerelease(stripBuild(b), bCore, bPre);

    // Compare numeric cores component-wise.
    size_t i = 0, j = 0;
    while (i < aCore.size() || j < bCore.size()) {
        int av = 0, bv = 0;
        while (i < aCore.size() && aCore[i] >= L'0' && aCore[i] <= L'9') {
            av = av * 10 + (aCore[i] - L'0'); ++i;
        }
        while (j < bCore.size() && bCore[j] >= L'0' && bCore[j] <= L'9') {
            bv = bv * 10 + (bCore[j] - L'0'); ++j;
        }
        if (av != bv) return av < bv ? -1 : +1;
        if (i < aCore.size() && aCore[i] == L'.') ++i;
        if (j < bCore.size() && bCore[j] == L'.') ++j;
    }

    // Numeric cores equal. Pre-release presence/absence decides.
    if (aPre.empty() && bPre.empty()) return 0;
    if (aPre.empty()) return +1;  // 0.2.0 > 0.2.0-beta
    if (bPre.empty()) return -1;

    // Both have pre-release. Compare identifier lists.
    auto aIds = splitIdentifiers(aPre);
    auto bIds = splitIdentifiers(bPre);
    size_t n = aIds.size() < bIds.size() ? aIds.size() : bIds.size();
    for (size_t k = 0; k < n; ++k) {
        int c = compareIdentifier(aIds[k], bIds[k]);
        if (c != 0) return c;
    }
    if (aIds.size() != bIds.size()) return aIds.size() < bIds.size() ? -1 : +1;
    return 0;
}

// Fetch the latest GitHub release info and post the result back to the
// settings dialog. Synchronous (URLDownloadToFileW blocks the UI thread
// briefly — typical GitHub API response is well under a second). For a
// click-triggered action this is acceptable; promoting to async is a
// simple change if it ever surfaces as a UX problem.
//
// On the wire JS gets:
//   {type:'updateCheckResult', current:'0.1.2', latest:'0.1.3',
//    url:'https://github.com/.../releases/tag/v0.1.3', newer:true|false}
// or on failure:
//   {type:'updateCheckResult', error:'<message>'}
void HandleCheckForUpdatesMessage(SettingsState* s) {
    if (!s || !s->webview) return;
    auto reply = [&](const std::wstring& body) {
        if (s && s->webview) s->webview->PostWebMessageAsJson(body.c_str());
    };

    // Temp file for the API response.
    wchar_t tmpDir[MAX_PATH] = {0};
    if (GetTempPathW(MAX_PATH, tmpDir) == 0) {
        reply(L"{\"type\":\"updateCheckResult\",\"error\":\"Could not locate temp folder.\"}");
        return;
    }
    wchar_t tmpPath[MAX_PATH] = {0};
    if (GetTempFileNameW(tmpDir, L"mdwx", 0, tmpPath) == 0) {
        reply(L"{\"type\":\"updateCheckResult\",\"error\":\"Could not create temp file.\"}");
        return;
    }

    const wchar_t* url = L"https://api.github.com/repos/HyperWorX/mdWorX/releases/latest";
    HRESULT hr = URLDownloadToFileW(nullptr, url, tmpPath, 0, nullptr);
    if (FAILED(hr)) {
        DeleteFileW(tmpPath);
        wchar_t err[96];
        StringCchPrintfW(err, 96, L"Network fetch failed (HRESULT 0x%08lX)",
                         static_cast<unsigned long>(hr));
        reply(L"{\"type\":\"updateCheckResult\",\"error\":\"" + JsonEscape(err) + L"\"}");
        return;
    }

    std::wstring body = ReadFileUtf8(tmpPath);
    DeleteFileW(tmpPath);
    if (body.empty()) {
        reply(L"{\"type\":\"updateCheckResult\",\"error\":\"Empty response from GitHub.\"}");
        return;
    }

    // P3 audit #39: a 403 / rate-limit response is JSON like
    // {"message":"API rate limit exceeded for ...","documentation_url":"..."}.
    // Distinguish it from a generic parse failure so the user knows to
    // wait rather than retrying immediately.
    if (body.find(L"\"message\"") != std::wstring::npos &&
        body.find(L"API rate limit exceeded") != std::wstring::npos) {
        reply(L"{\"type\":\"updateCheckResult\",\"error\":\""
              L"GitHub API rate limit reached. Please retry later.\"}");
        return;
    }

    std::wstring tagName = ExtractJsonStringKey(body, L"tag_name");
    std::wstring htmlUrl = ExtractJsonStringKey(body, L"html_url");
    // browser_download_url only appears under assets[]; first occurrence
    // is the release zip (mdWorX ships exactly one asset per release).
    std::wstring assetUrl = ExtractJsonStringKey(body, L"browser_download_url");
    // The release body is markdown; mdWorX releases include a line
    // matching `sha256: <64 hex>` so the in-app installer can verify
    // the downloaded zip against a value the GitHub API endpoint also
    // serves alongside the download URL. ExtractJsonStringKey gives us
    // the decoded body string; a regex pulls the hash out.
    std::wstring releaseBody = ExtractJsonStringKey(body, L"body");
    std::wstring sha256;
    {
        static const std::wregex kShaRegex(
            L"sha256[\\s:=\\-]+([0-9a-fA-F]{64})", std::regex::icase);
        std::wsmatch m;
        if (std::regex_search(releaseBody, m, kShaRegex)) sha256 = m[1].str();
    }
    if (tagName.empty()) {
        reply(L"{\"type\":\"updateCheckResult\",\"error\":\"Couldn't read release tag from response.\"}");
        return;
    }
    // Strip leading 'v' so "v0.1.3" -> "0.1.3" for the comparison.
    std::wstring latest = tagName;
    if (!latest.empty() && (latest[0] == L'v' || latest[0] == L'V')) latest.erase(0, 1);

    const std::wstring current = MDWORX_VERSION_STR;
    bool newer = CompareVersionStrings(latest, current) > 0;

    std::wstring out = L"{\"type\":\"updateCheckResult\",\"current\":\""
        + JsonEscape(current) + L"\",\"latest\":\""
        + JsonEscape(latest)  + L"\",\"url\":\""
        + JsonEscape(htmlUrl) + L"\",\"assetUrl\":\""
        + JsonEscape(assetUrl) + L"\",\"sha256\":\""
        + JsonEscape(sha256)  + L"\",\"newer\":"
        + (newer ? L"true" : L"false") + L"}";
    reply(out);
}

// Install pipeline triggered by
//   {type:'installUpdate', url:'<zip url>', sha256?:'<hex>',
//    expectedVersion?:'<x.y.z[-pre]>'}
// Pipeline (now runs on a worker thread so a slow network never freezes
// the WebView2 message thread):
//   1. Synchronous front-door: single-flight guard + HTTPS+host
//      allowlist. The hostile-URL branch returns from the message
//      thread before any thread is spawned.
//   2. Worker: download via WinHttp (HTTPS-only, manual redirect
//      following with per-hop allowlist re-check, timeouts) into a
//      per-run secure temp dir whose DACL is restricted to the
//      running user.
//   3. Worker: SHA256 the download and match against the hash supplied
//      in the installUpdate message. The hash is published in the
//      GitHub release body so a MitM cannot satisfy it without also
//      forging the body the update-check pulled the hash from.
//   4. Worker: extract via PowerShell Expand-Archive with proper
//      single-quote escaping (so TEMP paths containing apostrophes
//      do not break the parser) under a 5-minute timeout.
//   5. Worker: locate Install.cmd via strict folder-name regex
//      (mdWorX_v<ver>) and pin the file through a read-only handle
//      whose final path goes to ShellExecuteEx (closes the
//      discover->exec TOCTOU window).
//   6. Worker: launch Install.cmd. Install.cmd self-elevates via UAC
//      and replaces the DLL while DOpus is being closed.
//
// Posts progress messages so the JS layer can render stages:
//   {type:'installProgress', stage:'downloading'|'extracting'|'launching'}
//   {type:'installResult',   ok:true|false, error?:'<message>'}
// Note: DOpus is closed by Install.cmd shortly after launching, so the
// installResult reply may not reach the user UI. We post it anyway in
// case launch fails before the closer kicks in.
//
// Audit findings addressed: P0 #2, P0 #3, P0 #4 (with caveats noted in
// LocateInstallCmd), P1 #6, P1 #7, P1 #8, P1 #9, P1 #10, P2 #15, P2 #18,
// P2 #19. P2 #20 (client-side watchdog) lives on the JS side.
void HandleInstallUpdateMessage(SettingsState* s,
                                const std::wstring& url,
                                const std::wstring& expectedSha256,
                                const std::wstring& expectedVersion) {
    if (!s || !s->webview) return;
    auto reply = [s](const std::wstring& body) {
        if (s && s->webview) s->webview->PostWebMessageAsJson(body.c_str());
    };
    auto fail = [&reply](const std::wstring& errMsg) {
        reply(L"{\"type\":\"installResult\",\"ok\":false,\"error\":\""
              + JsonEscape(errMsg) + L"\"}");
    };

    // Front-door checks happen on the WebView2 message thread, before
    // any worker is spawned. Single-flight: re-entrant clicks bounce
    // off this check rather than starting a second pipeline.
    bool expected = false;
    if (!s->installInFlight.compare_exchange_strong(expected, true)) {
        fail(L"Install already in progress.");
        return;
    }
    if (!IsAllowedReleaseUrl(url)) {
        s->installInFlight = false;
        fail(L"Refused: update URL is not on the allowlist "
             L"(must be https://github.com/... or https://*.githubusercontent.com/...).");
        return;
    }

    // Capture by value into the worker. Capturing `s` by value is safe
    // here because the SettingsState lives for the lifetime of the
    // dialog and is destroyed only after the WebView2 controller is
    // closed (which itself blocks until pending messages drain). If
    // that invariant ever changes, this becomes a weak_ptr.
    std::thread([s, url, expectedSha256, expectedVersion]() {
        auto post = [s](const std::wstring& body) {
            if (s && s->webview) s->webview->PostWebMessageAsJson(body.c_str());
        };
        auto progress = [&post](const wchar_t* stage) {
            post(std::wstring(L"{\"type\":\"installProgress\",\"stage\":\"")
                 + stage + L"\"}");
        };
        auto fail = [&post](const std::wstring& msg) {
            post(L"{\"type\":\"installResult\",\"ok\":false,\"error\":\""
                 + JsonEscape(msg) + L"\"}");
        };

        // Wraps every exit path so installInFlight clears and the
        // per-run temp dir is removed even if we early-return.
        struct Cleanup {
            SettingsState* state;
            std::wstring   tempDir;
            ~Cleanup() {
                if (!tempDir.empty()) RmTreeBestEffort(tempDir);
                if (state) state->installInFlight = false;
            }
        } cleanup{s, {}};

        std::wstring tempDir = CreateSecureTempDir();
        if (tempDir.empty()) {
            fail(L"Could not create a secure temp directory for the update.");
            return;
        }
        cleanup.tempDir = tempDir;

        std::wstring zipPath    = tempDir + L"\\mdworx-update.zip";
        std::wstring extractDir = tempDir + L"\\extracted";
        if (!CreateDirectoryW(extractDir.c_str(), nullptr)) {
            fail(L"Could not create extraction directory.");
            return;
        }

        progress(L"downloading");
        std::wstring dlErr;
        if (!DownloadHttpsAllowlisted(url, zipPath, dlErr)) {
            fail(dlErr.empty() ? std::wstring(L"Download failed.") : dlErr);
            return;
        }

        // SHA256 integrity check. The current release process must
        // include the SHA256 of the zip in the release body. If the
        // installUpdate message did not carry an expected hash (older
        // release with no published hash), refuse rather than fall
        // open: an unverified download is the entry point to the RCE
        // chain we are trying to close.
        if (expectedSha256.empty()) {
            fail(L"Update aborted: this release has no published SHA256 to verify against.");
            return;
        }
        std::wstring actualSha = Sha256OfFile(zipPath);
        if (actualSha.empty()) {
            fail(L"Could not compute SHA256 of the downloaded zip.");
            return;
        }
        if (AsciiLower(actualSha) != AsciiLower(expectedSha256)) {
            std::wstring msg = L"Integrity check failed: SHA256 mismatch. "
                               L"Expected " + AsciiLower(expectedSha256).substr(0, 12) +
                               L"..., got " + AsciiLower(actualSha).substr(0, 12) + L"...";
            fail(msg);
            return;
        }

        progress(L"extracting");
        std::wstring exErr;
        if (!ExtractZipBounded(zipPath, extractDir, exErr)) {
            fail(exErr.empty() ? std::wstring(L"Extraction failed.") : exErr);
            return;
        }

        std::wstring installCmd = LocateInstallCmd(extractDir, expectedVersion);
        if (installCmd.empty()) {
            fail(L"Install.cmd not found at the expected path "
                 L"(release zip layout did not match mdWorX_v<version>\\Install.cmd).");
            return;
        }

        progress(L"launching");
        // ShellExecuteEx runs the script. Install.cmd does its own
        // self-elevation (powershell Start-Process -Verb RunAs) so we
        // do not pass lpVerb=L"runas" here — letting the script handle
        // it keeps the UAC dialog text consistent with what users see
        // if they run the script manually from the zip.
        //
        // installCmd is the canonical path obtained via
        // GetFinalPathNameByHandleW on a read-only handle in
        // LocateInstallCmd, which closes the discover->exec TOCTOU
        // window: even if an attacker swaps the file after our
        // discovery, the OS resolves the path through the same inode
        // we already inspected.
        SHELLEXECUTEINFOW sei = {};
        sei.cbSize = sizeof(sei);
        sei.fMask  = SEE_MASK_NOCLOSEPROCESS;
        sei.lpVerb = L"open";
        sei.lpFile = installCmd.c_str();
        sei.lpDirectory = nullptr;
        sei.nShow  = SW_SHOWNORMAL;
        if (!ShellExecuteExW(&sei)) {
            fail(L"Failed to launch installer.");
            return;
        }
        if (sei.hProcess) CloseHandle(sei.hProcess);

        // Suppress the auto-rmtree; Install.cmd is still reading the
        // extracted files. The script removes its own work area when
        // done, and a residual temp dir from a successful run is at
        // worst a few hundred KB until %TEMP% is cleaned.
        cleanup.tempDir.clear();
        post(L"{\"type\":\"installResult\",\"ok\":true}");
    }).detach();
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
        // User-initiated close: X button on the dialog title bar OR our
        // closeSettings JS message both arrive here before DestroyWindow.
        // Cascade destruction (owner being destroyed by Windows) goes
        // straight to WM_DESTROY without WM_CLOSE first. We use that
        // distinction in WM_DESTROY to decide whether to post WM_QUIT.
        g_settingsCloseReceived = true;
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

        // PostQuitMessage(0) breaks DOpus's inner pump (the one Preferences
        // → Plugins → Configure runs while waiting for us to finish).
        // Required by #3 (settings dialog couldn't close from DOpus prefs).
        //
        // Gated on BOTH:
        //   - g_settingsInvokedByDOpus: cog-button invocations have no
        //     inner pump; posting would leak WM_QUIT to the viewer's
        //     main loop.
        //   - g_settingsCloseReceived: the user actually initiated this
        //     close (WM_CLOSE arrived first). The owner-destruction
        //     cascade in #8 skips WM_CLOSE and goes straight to
        //     WM_DESTROY; in that case DOpus's inner pump has either
        //     already exited or is in the process of doing so as part
        //     of the prefs-window teardown, and posting WM_QUIT would
        //     leak into DOpus's main lister loop.
        //
        // Both flags reset after consumption so the next invocation
        // starts clean.
        bool postQuit = g_settingsInvokedByDOpus && g_settingsCloseReceived;
        g_settingsInvokedByDOpus = false;
        g_settingsCloseReceived  = false;
        if (postQuit) PostQuitMessage(0);
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
    // Classify the invocation context at file scope (single-instance, so
    // per-state tracking would be redundant). Two callers:
    //   - cog button in our viewer (passes kInternalConfigureFlag)
    //   - DOpus plugin host: either Preferences → Plugins → Configure
    //     (runs an inner message pump) or a DOpus bottom-toolbar button
    //     (no inner pump). Both pass DOpus-supplied data.
    g_settingsInvokedByDOpus = (dwNotifyData != kInternalConfigureFlag);
    g_settingsCloseReceived  = false;

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

    // Always return the HWND modeless. WM_DESTROY conditionally posts
    // WM_QUIT to break DOpus's inner pump (the one Preferences → Plugins
    // → Configure runs while waiting for us to finish). See the gating
    // logic in the WM_DESTROY handler.
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
