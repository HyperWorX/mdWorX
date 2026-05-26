cmake_minimum_required(VERSION 3.20)
project(mdWorX
    VERSION 0.1.1
    DESCRIPTION "mdWorX — Directory Opus markdown viewer/editor plugin"
    LANGUAGES CXX
)

if(NOT WIN32)
    message(FATAL_ERROR "This plugin is Windows-only.")
endif()

if(NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
    message(FATAL_ERROR "x64 only.")
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Static CRT so the DLL has no MSVC redistributable dependency
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

# Vendored SDK headers (gitignored — see docs/dev-setup.md)
set(DOPUS_SDK_DIR "${CMAKE_SOURCE_DIR}/../sdk-vendored/headers")
if(NOT EXISTS "${DOPUS_SDK_DIR}/viewer plugins.h")
    message(FATAL_ERROR
        "DOpus SDK headers not found at ${DOPUS_SDK_DIR}. "
        "See docs/dev-setup.md for download instructions.")
endif()

# --- WebView2 SDK (NuGet) ----------------------------------------------------
# Fetch the Microsoft.Web.WebView2 NuGet package and link against the
# static loader (WebView2LoaderStatic.lib) so the plugin DLL has no
# WebView2Loader.dll deployment dependency.
include(FetchContent)
set(WEBVIEW2_VERSION "1.0.3179.45")
FetchContent_Declare(
    WebView2
    URL "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/${WEBVIEW2_VERSION}"
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_MakeAvailable(WebView2)
set(WEBVIEW2_INCLUDE_DIR "${webview2_SOURCE_DIR}/build/native/include")
set(WEBVIEW2_LIB         "${webview2_SOURCE_DIR}/build/native/x64/WebView2LoaderStatic.lib")
if(NOT EXISTS "${WEBVIEW2_INCLUDE_DIR}/WebView2.h")
    message(FATAL_ERROR
        "WebView2 SDK extraction failed: ${WEBVIEW2_INCLUDE_DIR}/WebView2.h not found.")
endif()
if(NOT EXISTS "${WEBVIEW2_LIB}")
    message(FATAL_ERROR
        "WebView2LoaderStatic.lib not found at ${WEBVIEW2_LIB}.")
endif()

# --- WIL (Windows Implementation Library) -----------------------------------
# Header-only; gives us wil::com_ptr, wil::unique_cotaskmem_string,
# Microsoft::WRL::Callback, and CHECK_FAILURE without writing them ourselves.
FetchContent_Declare(
    WIL
    URL "https://www.nuget.org/api/v2/package/Microsoft.Windows.ImplementationLibrary/1.0.240803.1"
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_MakeAvailable(WIL)
set(WIL_INCLUDE_DIR "${wil_SOURCE_DIR}/include")
if(NOT EXISTS "${WIL_INCLUDE_DIR}/wil/com.h")
    message(FATAL_ERROR
        "WIL extraction failed: ${WIL_INCLUDE_DIR}/wil/com.h not found.")
endif()

add_library(mdWorX SHARED
    src/main.cpp
    src/plugin.def
    src/plugin.rc
)

target_include_directories(mdWorX PRIVATE
    "${DOPUS_SDK_DIR}"
    "${WEBVIEW2_INCLUDE_DIR}"
    "${WIL_INCLUDE_DIR}"
    src
)

target_compile_definitions(mdWorX PRIVATE
    UNICODE
    _UNICODE
    WIN32_LEAN_AND_MEAN
    NOMINMAX
    _CRT_SECURE_NO_WARNINGS
    MDWORX_VERSION_STR=L"${PROJECT_VERSION}"
)

target_compile_options(mdWorX PRIVATE
    /W4
    /permissive-
    /Zc:__cplusplus
    /Zc:preprocessor
    /utf-8
    /MP
)

target_link_libraries(mdWorX PRIVATE
    "${WEBVIEW2_LIB}"
    user32
    gdi32
    shlwapi
    shell32
    ole32
    oleaut32
    uuid
    advapi32
    comctl32
    comdlg32   # GetSaveFileNameW for editor Save As
    urlmon     # URLDownloadToFileW for "Copy to file folder" of URL sources
    version
)

# Output: drop the DLL straight into build-out/ so the install script can pick it up
set_target_properties(mdWorX PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/../build-out"
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/../build-out"
    OUTPUT_NAME "mdWorX"
    PREFIX ""
)

# Stage the web bundle (built separately with `node web/build.mjs`) next to
# the DLL under build-out/mdWorX_assets/. The plugin reads
# this folder at runtime and maps it to https://app.mdworx.test/ via
# SetVirtualHostNameToFolderMapping.
set(WEB_DIST_DIR "${CMAKE_SOURCE_DIR}/../web/dist")
set(ASSETS_OUT_DIR "${CMAKE_SOURCE_DIR}/../build-out/mdWorX_assets")
add_custom_command(TARGET mdWorX POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "${ASSETS_OUT_DIR}"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${WEB_DIST_DIR}/index.html"   "${ASSETS_OUT_DIR}/index.html"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${WEB_DIST_DIR}/viewer.js"    "${ASSETS_OUT_DIR}/viewer.js"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${WEB_DIST_DIR}/viewer.css"   "${ASSETS_OUT_DIR}/viewer.css"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${WEB_DIST_DIR}/settings-defaults.json" "${ASSETS_OUT_DIR}/settings-defaults.json"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${WEB_DIST_DIR}/settings.html" "${ASSETS_OUT_DIR}/settings.html"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${WEB_DIST_DIR}/settings.css" "${ASSETS_OUT_DIR}/settings.css"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${WEB_DIST_DIR}/settings.js" "${ASSETS_OUT_DIR}/settings.js"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${WEB_DIST_DIR}/manifest.json" "${ASSETS_OUT_DIR}/manifest.json"
    COMMENT "Staging web assets alongside DLL"
    VERBATIM
)
