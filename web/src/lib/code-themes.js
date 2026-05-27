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
    // Palette-derived themes. Each entry mirrors the codeColors map on
    // the corresponding palette in settings.js so picking the palette's
    // name as a syntax theme renders the palette's canonical syntax
    // colours regardless of the active global palette.
    //
    // Important: this duplicates the codeColors data already declared
    // on the palette object in settings.js. The duplication is
    // intentional — code-themes.js is imported by BOTH the settings
    // dialog and the viewer, but the palettes dict lives only in
    // settings.js, so the viewer can't read the palettes object at all.
    // Earlier attempt: settings.js mutated CODE_THEMES at boot, which
    // populated the dialog but not the viewer (separate module graphs
    // per bundle entry point). Visible symptom: picking 'Red Rascal'
    // in the Syntax theme dropdown updated the dialog mini-preview but
    // the actual code blocks in the viewer fell back to match-palette
    // because CODE_THEMES['red-rascal'] was undefined there.
    //
    // When adding a new palette to settings.js, ALSO add its
    // palette-derived theme here so both bundles see it.
    'ayu-dark': {
        label: 'Ayu Dark', isDark: true, bg: '#01060e', fg: '#cccac2',
        colors: { keyword: '#ff8f40', string: '#aad94c', comment: '#5c6773', number: '#d2a6ff', function: '#ffb454', type: '#73d0ff', operator: '#f29668', variable: '#cccac2', punctuation: '#cccac2' },
    },
    'catppuccin-mocha': {
        label: 'Catppuccin Mocha', isDark: true, bg: '#181825', fg: '#cdd6f4',
        colors: { keyword: '#cba6f7', string: '#a6e3a1', comment: '#6c7086', number: '#fab387', function: '#89b4fa', type: '#f9e2af', operator: '#94e2d5', variable: '#cdd6f4', punctuation: '#9399b2' },
    },
    'gruvbox-dark': {
        label: 'Gruvbox Dark', isDark: true, bg: '#3c3836', fg: '#ebdbb2',
        colors: { keyword: '#fb4934', string: '#b8bb26', comment: '#928374', number: '#d3869b', function: '#8ec07c', type: '#fabd2f', operator: '#fe8019', variable: '#ebdbb2', punctuation: '#a89984' },
    },
    'tokyo-night': {
        label: 'Tokyo Night', isDark: true, bg: '#24283b', fg: '#c0caf5',
        colors: { keyword: '#bb9af7', string: '#9ece6a', comment: '#565f89', number: '#ff9e64', function: '#7aa2f7', type: '#0db9d7', operator: '#89ddff', variable: '#c0caf5', punctuation: '#a9b1d6' },
    },
    'obsidianite': {
        label: 'Obsidianite', isDark: true, bg: '#191621', fg: '#e5e7eb',
        colors: { keyword: '#c084fc', string: '#86efac', comment: '#71717a', number: '#fb923c', function: '#60a5fa', type: '#fde047', operator: '#f87171', variable: '#e5e7eb', punctuation: '#9ca3af' },
    },
    'pln-dark': {
        label: 'PLN Dark', isDark: true, bg: '#2e3440', fg: '#9cdcfe',
        colors: { keyword: '#f48771', string: '#ce9178', comment: '#6a9955', number: '#b5cea8', function: '#dcdcaa', type: '#4ec9b0', operator: '#d4d4d4', variable: '#9cdcfe', punctuation: '#808080' },
    },
    'pln-light': {
        label: 'PLN Light', isDark: false, bg: '#eceff4', fg: '#001080',
        colors: { keyword: '#0000ff', string: '#a31515', comment: '#008000', number: '#098658', function: '#795e26', type: '#267f99', operator: '#000000', variable: '#001080', punctuation: '#808080' },
    },
    'anuppuccin-frappe': {
        label: 'AnuPpuccin Frappé', isDark: true, bg: '#232634', fg: '#c6d0f5',
        colors: { keyword: '#ca9ee6', string: '#a6d189', comment: '#737994', number: '#ef9f76', function: '#8caaee', type: '#e5c890', operator: '#81c8be', variable: '#c6d0f5', punctuation: '#949cbb' },
    },
    'everforest': {
        label: 'Everforest', isDark: true, bg: '#343f44', fg: '#d3c6aa',
        colors: { keyword: '#e67e80', string: '#a7c080', comment: '#7a8478', number: '#d699b6', function: '#a7c080', type: '#dbbc7f', operator: '#83c092', variable: '#d3c6aa', punctuation: '#9da9a0' },
    },
    'rose-pine': {
        label: 'Rosé Pine', isDark: true, bg: '#1f1d2e', fg: '#e0def4',
        colors: { keyword: '#c4a7e7', string: '#f6c177', comment: '#6e6a86', number: '#eb6f92', function: '#9ccfd8', type: '#ebbcba', operator: '#31748f', variable: '#e0def4', punctuation: '#908caa' },
    },
    'vesper': {
        label: 'Vesper', isDark: true, bg: '#1C1C1C', fg: '#FFFFFF',
        colors: { keyword: '#A0A0A0', string: '#90B99F', comment: '#505050', number: '#FFC799', function: '#FFC799', type: '#A0A0A0', operator: '#FFC799', variable: '#FFFFFF', punctuation: '#A0A0A0' },
    },
    'red-rascal': {
        label: 'Red Rascal', isDark: true, bg: '#3e1414', fg: '#f0d8d0',
        colors: { keyword: '#FF6347', string: '#E5C07B', comment: '#737373', number: '#FF9F43', function: '#DE5757', type: '#FFAB91', operator: '#FF6E6E', variable: '#FFD8D8', punctuation: '#E0A0A0' },
    },
    'ayu-light': {
        label: 'Ayu Light', isDark: false, bg: '#f6f8fa', fg: '#5c6166',
        colors: { keyword: '#fa8d3e', string: '#86b300', comment: '#abb0b6', number: '#a37acc', function: '#f2ae49', type: '#399ee6', operator: '#ed9366', variable: '#5c6166', punctuation: '#5c6166' },
    },
    'gruvbox-light': {
        label: 'Gruvbox Light', isDark: false, bg: '#ebdbb2', fg: '#3c3836',
        colors: { keyword: '#9d0006', string: '#79740e', comment: '#928374', number: '#8f3f71', function: '#427b58', type: '#b57614', operator: '#af3a03', variable: '#3c3836', punctuation: '#7c6f64' },
    },
    'catppuccin-latte': {
        label: 'Catppuccin Latte', isDark: false, bg: '#e6e9ef', fg: '#4c4f69',
        colors: { keyword: '#8839ef', string: '#40a02b', comment: '#9ca0b0', number: '#fe640b', function: '#1e66f5', type: '#df8e1d', operator: '#179299', variable: '#4c4f69', punctuation: '#7c7f93' },
    },
    'one-light': {
        label: 'One Light', isDark: false, bg: '#f0f0f0', fg: '#383a42',
        colors: { keyword: '#a626a4', string: '#50a14f', comment: '#a0a1a7', number: '#986801', function: '#4078f2', type: '#c18401', operator: '#0184bc', variable: '#383a42', punctuation: '#383a42' },
    },
    'tokyo-night-day': {
        label: 'Tokyo Night Day', isDark: false, bg: '#d0d5e3', fg: '#3760bf',
        colors: { keyword: '#9854f1', string: '#587539', comment: '#9699a3', number: '#965027', function: '#2e7de9', type: '#007197', operator: '#3e6968', variable: '#3760bf', punctuation: '#6172b0' },
    },
    'nord-light': {
        label: 'Nord Light', isDark: false, bg: '#e5e9f0', fg: '#2e3440',
        colors: { keyword: '#5e81ac', string: '#a3be8c', comment: '#7b88a1', number: '#b48ead', function: '#5e81ac', type: '#88c0d0', operator: '#5e81ac', variable: '#2e3440', punctuation: '#4c566a' },
    },
    'alucard': {
        label: 'Alucard', isDark: false, bg: '#eeeed8', fg: '#1f1f1f',
        colors: { keyword: '#9844c5', string: '#947100', comment: '#a4a6a8', number: '#cb3a2a', function: '#1f8f00', type: '#036a96', operator: '#cb3a2a', variable: '#1f1f1f', punctuation: '#5e5e5e' },
    },
    'obsidianite-light': {
        label: 'Obsidianite Light', isDark: false, bg: '#f3f4f5', fg: '#18181b',
        colors: { keyword: '#7c3aed', string: '#15803d', comment: '#71717a', number: '#c2410c', function: '#2563eb', type: '#a16207', operator: '#dc2626', variable: '#18181b', punctuation: '#52525b' },
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
    // Write the theme's syntax-token colours into DEDICATED theme-override
    // variables. They're a separate layer from the palette-override
    // layer (written by applyPaletteCodeColors) so picking match-palette
    // can clear ONLY this layer and let the palette layer show through.
    // Previously both layers shared --code-<role>-override and a
    // match-palette pick wiped the palette colours along with the
    // theme (bug #2 — every global palette produced identical code
    // tokens because nothing was filling the gap below the cleared
    // override).
    for (const role of ROLES) {
        const varName = `--code-${role}-theme-override`;
        if (useOverride) target.style.setProperty(varName, theme.colors[role]);
        else             target.style.removeProperty(varName);
    }
    // Same separate-layer treatment for the block bg/fg.
    if (useOverride && theme.bg) target.style.setProperty('--code-theme-block-bg-override', theme.bg);
    else                         target.style.removeProperty('--code-theme-block-bg-override');
    if (useOverride && theme.fg) target.style.setProperty('--code-theme-block-fg-override', theme.fg);
    else                         target.style.removeProperty('--code-theme-block-fg-override');
}

// Writes the active palette's curated per-token code colours into the
// --code-<role>-palette-override layer. Called from viewer.js
// applySettings whenever userSettings.codePaletteColors is present.
// The layer sits BETWEEN the theme override (highest) and the
// palette-derived CSS variable defaults (lowest), so:
//   - codeBlockTheme = match-palette: theme layer absent ->
//     palette layer wins -> user sees Dracula/Nord/etc. colours
//   - codeBlockTheme = any specific theme: theme layer wins,
//     palette layer is ignored
// Each palette's codeColors lives in the palette definition in
// settings.js and follows the same nine-role schema as CODE_THEMES.
export function applyPaletteCodeColors(colors, target = document.documentElement) {
    if (!colors || typeof colors !== 'object') {
        for (const role of ROLES) target.style.removeProperty(`--code-${role}-palette-override`);
        return;
    }
    for (const role of ROLES) {
        const v = colors[role];
        const varName = `--code-${role}-palette-override`;
        if (typeof v === 'string' && v.length > 0) target.style.setProperty(varName, v);
        else                                       target.style.removeProperty(varName);
    }
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
