// Code-block colour theme registry.
//
// Each theme provides the nine `--code-<role>` values consumed by the
// `.tok-*` rules in viewer.css. Picking a theme writes the values into
// the corresponding `--code-<role>-override` variables on the document
// root, so the body-scoped palette defaults stay intact and a switch
// back to "Match palette" is a one-line clear.
//
// Theme IDs are stable strings persisted as the `codeBlockTheme` setting.
// "match-palette" is the sentinel meaning "do not apply an override,
// fall back to whatever the active palette set". `null` and the empty
// string are treated the same way.

export const MATCH_PALETTE = 'match-palette';

// Display order is the canonical order shown in the settings dropdown.
// Light-leaning themes are listed first within each family for symmetry.
export const CODE_THEMES = {
    'match-palette': {
        label:  'Match palette',
        isDark: null,
        // Sentinel — no colour table. Selecting this clears the overrides.
    },
    'github-light': {
        label:  'GitHub Light',
        isDark: false,
        bg:     '#f6f8fa',
        fg:     '#1f2328',
        colors: {
            keyword:     '#cf222e',
            string:      '#0a3069',
            comment:     '#6e7781',
            number:      '#0550ae',
            function:    '#8250df',
            type:        '#953800',
            operator:    '#cf222e',
            variable:    '#1f2328',
            punctuation: '#57606a',
        },
    },
    'github-dark': {
        label:  'GitHub Dark',
        isDark: true,
        bg:     '#161b22',
        fg:     '#c9d1d9',
        colors: {
            keyword:     '#ff7b72',
            string:      '#a5d6ff',
            comment:     '#8b949e',
            number:      '#79c0ff',
            function:    '#d2a8ff',
            type:        '#ffa657',
            operator:    '#ff7b72',
            variable:    '#c9d1d9',
            punctuation: '#8b949e',
        },
    },
    'solarized-light': {
        label:  'Solarized Light',
        isDark: false,
        bg:     '#fdf6e3',
        fg:     '#586e75',
        colors: {
            keyword:     '#859900',
            string:      '#2aa198',
            comment:     '#93a1a1',
            number:      '#d33682',
            function:    '#268bd2',
            type:        '#b58900',
            operator:    '#cb4b16',
            variable:    '#586e75',
            punctuation: '#657b83',
        },
    },
    'solarized-dark': {
        label:  'Solarized Dark',
        isDark: true,
        bg:     '#002b36',
        fg:     '#839496',
        colors: {
            keyword:     '#859900',
            string:      '#2aa198',
            comment:     '#586e75',
            number:      '#d33682',
            function:    '#268bd2',
            type:        '#b58900',
            operator:    '#cb4b16',
            variable:    '#93a1a1',
            punctuation: '#839496',
        },
    },
    'monokai': {
        label:  'Monokai',
        isDark: true,
        bg:     '#272822',
        fg:     '#f8f8f2',
        colors: {
            keyword:     '#f92672',
            string:      '#e6db74',
            comment:     '#75715e',
            number:      '#ae81ff',
            function:    '#a6e22e',
            type:        '#66d9ef',
            operator:    '#f92672',
            variable:    '#f8f8f2',
            punctuation: '#f8f8f2',
        },
    },
    'dracula': {
        label:  'Dracula',
        isDark: true,
        bg:     '#282a36',
        fg:     '#f8f8f2',
        colors: {
            keyword:     '#ff79c6',
            string:      '#f1fa8c',
            comment:     '#6272a4',
            number:      '#bd93f9',
            function:    '#50fa7b',
            type:        '#8be9fd',
            operator:    '#ff79c6',
            variable:    '#f8f8f2',
            punctuation: '#f8f8f2',
        },
    },
    'nord': {
        label:  'Nord',
        isDark: true,
        bg:     '#2e3440',
        fg:     '#d8dee9',
        colors: {
            keyword:     '#81a1c1',
            string:      '#a3be8c',
            comment:     '#4c566a',
            number:      '#b48ead',
            function:    '#88c0d0',
            type:        '#8fbcbb',
            operator:    '#81a1c1',
            variable:    '#d8dee9',
            punctuation: '#d8dee9',
        },
    },
    'tomorrow': {
        label:  'Tomorrow',
        isDark: false,
        bg:     '#ffffff',
        fg:     '#4d4d4c',
        colors: {
            keyword:     '#8959a8',
            string:      '#718c00',
            comment:     '#8e908c',
            number:      '#f5871f',
            function:    '#4271ae',
            type:        '#c82829',
            operator:    '#3e999f',
            variable:    '#4d4d4c',
            punctuation: '#8e908c',
        },
    },
    'tomorrow-night': {
        label:  'Tomorrow Night',
        isDark: true,
        bg:     '#1d1f21',
        fg:     '#c5c8c6',
        colors: {
            keyword:     '#b294bb',
            string:      '#b5bd68',
            comment:     '#969896',
            number:      '#de935f',
            function:    '#81a2be',
            type:        '#cc6666',
            operator:    '#8abeb7',
            variable:    '#c5c8c6',
            punctuation: '#969896',
        },
    },
    'one-dark': {
        label:  'One Dark',
        isDark: true,
        bg:     '#282c34',
        fg:     '#abb2bf',
        colors: {
            keyword:     '#c678dd',
            string:      '#98c379',
            comment:     '#5c6370',
            number:      '#d19a66',
            function:    '#61afef',
            type:        '#e5c07b',
            operator:    '#56b6c2',
            variable:    '#abb2bf',
            punctuation: '#abb2bf',
        },
    },
};

// Roles we override. Tied to the `--code-<role>` set defined in viewer.css.
const ROLES = ['keyword','string','comment','number','function',
               'type','operator','variable','punctuation'];

// Apply a code theme by writing the nine `--code-<role>-override` CSS
// variables plus `--code-block-bg-override` / `--code-block-fg-override`
// on the document root. The block-level bg/fg overrides only apply to
// fenced code blocks (not blockquote, not inline code) — viewer.css
// scopes them via dedicated selectors so the rest of the palette stays
// intact when a theme is picked. Calling with "match-palette" (or
// null/empty/unknown id) clears every override so the active palette's
// defaults win again.
export function applyCodeTheme(themeId, target = document.documentElement) {
    const id = themeId || MATCH_PALETTE;
    const theme = CODE_THEMES[id];
    const useOverride = theme && theme.colors;
    for (const role of ROLES) {
        const varName = `--code-${role}-override`;
        if (useOverride) target.style.setProperty(varName, theme.colors[role]);
        else             target.style.removeProperty(varName);
    }
    // Write the theme's block bg/fg into DEDICATED theme-override variables,
    // distinct from the palette-driven --code-block-bg-override that the
    // settings.js codeBg mapping writes. The CSS cascade in viewer.css
    // resolves theme override -> palette override -> theme default, so
    // picking match-palette clears the theme override and lets the
    // palette's codeBg show through (previous behaviour cleared the
    // palette's variable too, hiding it behind the theme default
    // regardless of the active palette — bug #1 and #2).
    if (useOverride && theme.bg) target.style.setProperty('--code-theme-block-bg-override', theme.bg);
    else                         target.style.removeProperty('--code-theme-block-bg-override');
    if (useOverride && theme.fg) target.style.setProperty('--code-theme-block-fg-override', theme.fg);
    else                         target.style.removeProperty('--code-theme-block-fg-override');
}

// Convenience: settings UI can build the dropdown options from this list.
// Match-palette first, then everything else in registry-declaration order.
export function listCodeThemes() {
    return Object.entries(CODE_THEMES).map(([id, t]) => ({
        id,
        label: t.label,
        isDark: t.isDark,
    }));
}
