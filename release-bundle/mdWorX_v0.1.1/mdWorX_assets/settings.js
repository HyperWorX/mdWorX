// Settings dialog — form generator and bridge to the native side.
//
// Flow:
//   1. Page loads. Fetches settings-defaults.json from the bundle.
//   2. Posts {type:'settingsReady'} to native. Native responds with
//      {type:'userSettings', json:'<rawtext>'} carrying the current
//      user settings file contents (or empty string if absent).
//   3. We merge user-over-defaults (user keys win) and populate form.
//   4. Apply: serialise current form values to a JSON object (omitting
//      keys equal to their default and omitting empty strings), post
//      {type:'saveSettings', json:'<rawtext>'} to native. Native writes
//      the file atomically and posts DVPLUGINMSG_REINITIALIZE to DOpus
//      so every open viewer pane reloads.
//   5. Close: post {type:'closeSettings'} so native DestroyWindow's the
//      dialog. (Plain X button works too via DOpus' window chrome.)

// ---------------------------------------------------------------------------
// Preset palettes
//
// Each preset is a coordinated set of colour values plus a forced theme
// (so picking a dark palette on a light DOpus pane actually goes dark).
// Sourced from each project's published palette. Highlight opacity is
// intentionally set per-preset so highlighter readability is sensible
// against that palette's page background.

const palettes = {
    // ---- Dark ---------------------------------------------------------
    // All palettes below ported field-by-field from each theme's canonical
    // source (project palette spec or theme.css). Heading colour rainbows
    // chosen to match the theme's own accent set; underline styles match
    // each theme's visual character (gradient for vibrant themes, solid
    // for minimalist ones).
    'Dracula': {
        theme: 'dark',
        pageColor: '#282a36',
        textColor: '#f8f8f2',
        accentColor: '#bd93f9',
        pageBorderColor: '#bd93f9',           // palette accent — page border follows the palette identity
        linkColor: '#8be9fd',
        codeBg: '#44475a',
        ruleColor: '#44475a',
        hrColor: '#6272a4',
        headingUnderlineColor: '#6272a4',
        headingUnderlineStyle: 'gradient',
        // Dracula for Obsidian (jarodise port) — rainbow per heading.
        // Matches the canonical Obsidian-Dracula look.
        h1Color: '#ff79c6',             // pink
        h2Color: '#bd93f9',             // purple
        h3Color: '#ff5555',             // red
        h4Color: '#ffb86c',             // orange
        h5Color: '#50fa7b',             // green
        h6Color: '#8be9fd',             // cyan
        highlightBg: '#f1fa8c',
        highlightFg: '#282a36',
        highlightOpacity: 0.9,
        strongColor:   '#ffb86c',
        emphasisColor: '#ff79c6',
        strikeColor:   '#6272a4',
        monoColor:     '#f1fa8c',
    },
    'Solarized Dark': {
        theme: 'dark',
        pageColor: '#002b36',
        textColor: '#93a1a1',
        accentColor: '#b58900',
        pageBorderColor: '#b58900',           // palette accent — page border follows the palette identity
        linkColor: '#3295da',
        codeBg: '#073642',
        ruleColor: '#586e75',
        hrColor: '#586e75',
        headingUnderlineColor: '#586e75',
        headingUnderlineStyle: 'gradient',
        // Solarized: single accent (blue #268bd2 — most common Markdown choice).
        h1Color: '#268bd2', h2Color: '#268bd2', h3Color: '#268bd2',
        h4Color: '#268bd2', h5Color: '#268bd2', h6Color: '#268bd2',
        highlightBg: '#b58900',
        highlightFg: '#002b36',
        highlightOpacity: 0.85,
        strongColor:   '#d33682',
        emphasisColor: '#859900',
        strikeColor:   '#586e75',
        monoColor:     '#2aa198',
    },
    'Nord': {
        theme: 'dark',
        pageColor: '#2e3440',
        textColor: '#d8dee9',
        accentColor: '#88c0d0',
        pageBorderColor: '#88c0d0',           // palette accent — page border follows the palette identity
        linkColor: '#81a1c1',
        codeBg: '#3b4252',
        ruleColor: '#4c566a',
        hrColor: '#4c566a',
        headingUnderlineColor: '#4c566a',
        headingUnderlineStyle: 'gradient',
        // Nord: Aurora rainbow per insanum/obsidian_nord (most-forked port).
        // H6 uses Frost nord10 to avoid repeating an Aurora colour.
        h1Color: '#bf616a',             // nord11 red
        h2Color: '#d08770',             // nord12 orange
        h3Color: '#ebcb8b',             // nord13 yellow
        h4Color: '#a3be8c',             // nord14 green
        h5Color: '#b48ead',             // nord15 purple
        h6Color: '#5e81ac',             // nord10 frost blue
        highlightBg: '#ebcb8b',
        highlightFg: '#2e3440',
        highlightOpacity: 1.0,
        strongColor:   '#d08770',
        emphasisColor: '#b48ead',
        strikeColor:   '#4c566a',
        monoColor:     '#8fbcbb',
    },
    'Gruvbox Dark': {
        theme: 'dark',
        pageColor: '#282828',
        textColor: '#ebdbb2',
        accentColor: '#fabd2f',
        pageBorderColor: '#fabd2f',           // palette accent — page border follows the palette identity
        linkColor: '#83a598',
        codeBg: '#3c3836',
        ruleColor: '#504945',
        hrColor: '#665c54',
        headingUnderlineColor: '#665c54',
        headingUnderlineStyle: 'gradient',
        // Gruvbox Dark: rainbow per insanum/obsidian_gruvbox using the
        // "neutral" tier (warm→cool arc: red/orange/yellow/green/aqua/blue).
        h1Color: '#e96761',             // neutral-red
        h2Color: '#d65d0e',             // neutral-orange
        h3Color: '#d79921',             // neutral-yellow
        h4Color: '#98971a',             // neutral-green
        h5Color: '#689d6a',             // neutral-aqua
        h6Color: '#458588',             // neutral-blue
        highlightBg: '#fabd2f',
        highlightFg: '#282828',
        highlightOpacity: 1.0,
        strongColor:   '#fabd2f',
        emphasisColor: '#d3869b',
        strikeColor:   '#928374',
        monoColor:     '#b8bb26',
    },
    'One Dark': {
        // Atom One Dark — accent is BLUE (@hue-2 #61afef), Atom's editor
        // primary, not purple (purple is a syntax token for keywords).
        theme: 'dark',
        pageColor: '#282c34',           // syntax-bg
        textColor: '#abb2bf',           // syntax-fg / mono-1
        accentColor: '#61afef',         // @hue-2 blue (Atom's editor accent)
        pageBorderColor: '#61afef',           // palette accent — page border follows the palette identity
        linkColor: '#61afef',           // same blue (markdown links)
        codeBg: '#21252b',
        ruleColor: '#3e4451',
        hrColor: '#5c6370',
        headingUnderlineColor: '#5c6370',
        headingUnderlineStyle: 'gradient',
        // Heading rainbow drawn from the full Atom hue palette, warm→cool.
        // Canonical markup.heading is just @hue-5 red but with 6 distinct
        // levels available, the full palette reads better in a viewer.
        h1Color: '#e06c75',             // @hue-5 red
        h2Color: '#d19a66',             // @hue-6 orange
        h3Color: '#e5c07b',             // @hue-6-2 yellow
        h4Color: '#98c379',             // @hue-4 green
        h5Color: '#61afef',             // @hue-2 blue
        h6Color: '#c678dd',             // @hue-3 purple
        // Highlight: bright orange (--hue-6 #d19a66) at high opacity for
        // strong contrast against the dark grey bg, and visually distinct
        // from the yellow #e5c07b H3 colour.
        highlightBg: '#d19a66',
        highlightFg: '#282c34',
        highlightOpacity: 1.0,
        strongColor:   '#d19a66',
        emphasisColor: '#c678dd',
        strikeColor:   '#5c6370',
        monoColor:     '#98c379',
    },
    'Tokyo Night': {
        // Canonical Tokyo Night Night (enkia VS Code theme) palette.
        theme: 'dark',
        pageColor: '#1a1b26',           // bg
        textColor: '#c0caf5',           // fg
        accentColor: '#7aa2f7',         // blue — canonical Tokyo Night primary accent
        pageBorderColor: '#7aa2f7',           // palette accent — page border follows the palette identity
        linkColor: '#7aa2f7',           // blue — canonical link colour
        codeBg: '#24283b',
        ruleColor: '#292e42',
        hrColor: '#292e42',
        headingUnderlineStyle: 'gradient',
        // Warm→cool rainbow using the canonical palette colours.
        h1Color: '#f7768e',             // red
        h2Color: '#ff9e64',             // orange
        h3Color: '#e0af68',             // yellow
        h4Color: '#9ece6a',             // green
        h5Color: '#7aa2f7',             // blue
        h6Color: '#bb9af7',             // magenta
        highlightBg: '#e0af68',         // yellow accent — distinct from orange h2
        highlightFg: '#1a1b26',
        highlightOpacity: 1.0,
        strongColor:   '#e0af68',
        emphasisColor: '#bb9af7',
        strikeColor:   '#51597d',
        monoColor:     '#9ece6a',
    },
    'Ayu Dark': {
        theme: 'dark',
        pageColor: '#0a0e14',
        textColor: '#b3b1ad',
        accentColor: '#e6b450',
        pageBorderColor: '#e6b450',           // palette accent — page border follows the palette identity
        linkColor: '#59c2ff',
        codeBg: '#01060e',
        ruleColor: '#11151c',
        hrColor: '#273747',
        headingUnderlineColor: '#273747',
        headingUnderlineStyle: 'gradient',
        // Ayu Dark: yellow #e6b450 (Ayu's --func/accent token, also the
        // accentColor for this palette). Originally orange #ff8f40 but user
        // requested it match the yellow that appears elsewhere in the
        // palette - the accent yellow is the right pick because it ties
        // the headings to the rest of the Ayu Dark identity.
        h1Color: '#e6b450', h2Color: '#e6b450', h3Color: '#e6b450',
        h4Color: '#e6b450', h5Color: '#e6b450', h6Color: '#e6b450',
        // Highlight: yellow (Ayu's --func token) so it stands clear of the
        // orange headings instead of blending into them.
        highlightBg: '#ffb454',
        highlightFg: '#0a0e14',
        highlightOpacity: 1.0,
        strongColor:   '#ffb454',
        emphasisColor: '#ff7733',
        strikeColor:   '#5c6773',
        monoColor:     '#bbe67e',
    },
    'Catppuccin Mocha': {
        theme: 'dark',
        pageColor: '#1e1e2e',
        textColor: '#cdd6f4',
        accentColor: '#cba6f7',
        pageBorderColor: '#cba6f7',           // palette accent — page border follows the palette identity
        linkColor: '#89b4fa',
        codeBg: '#181825',
        ruleColor: '#313244',
        hrColor: '#45475a',
        headingUnderlineColor: '#45475a',
        headingUnderlineStyle: 'gradient',
        // Catppuccin: Neovim port rainbow (red/peach/yellow/green/sapphire/lavender).
        // The canonical markdown-rendering choice across the Catppuccin ecosystem.
        h1Color: '#f38ba8',             // red
        h2Color: '#fab387',             // peach
        h3Color: '#f9e2af',             // yellow
        h4Color: '#a6e3a1',             // green
        h5Color: '#74c7ec',             // sapphire
        h6Color: '#b4befe',             // lavender
        highlightBg: '#f9e2af',
        highlightFg: '#1e1e2e',
        highlightOpacity: 1.0,
        strongColor:   '#89b4fa',
        emphasisColor: '#a6e3a1',
        strikeColor:   '#6c7086',
        monoColor:     '#f9e2af',
    },
    'GitHub Dark': {
        theme: 'dark',
        pageColor: '#0d1117',
        textColor: '#f0f6fc',           // current Primer fg.default (was legacy #c9d1d9)
        accentColor: '#4493f8',         // current Primer accent.fg (was legacy #58a6ff)
        pageBorderColor: '#4493f8',           // palette accent — page border follows the palette identity
        linkColor: '#4493f8',
        codeBg: '#151b23',              // current Primer canvas.subtle (was legacy #161b22)
        ruleColor: '#3d444d',           // current Primer border.default (was legacy #30363d)
        hrColor: '#3d444d',
        headingUnderlineColor: '#3d444d',
        headingUnderlineStyle: 'solid',
        // GitHub Primer: H1-H5 inherit text colour (#f0f6fc dark default);
        // H6 alone takes a muted shade (#9198a1). Matches current github.com rendering.
        h1Color: '#f0f6fc', h2Color: '#f0f6fc', h3Color: '#f0f6fc',
        h4Color: '#f0f6fc', h5Color: '#f0f6fc', h6Color: '#9198a1',
        // Highlight: github.com renders <mark> as yellow.4 #bb8009 at ~15% alpha,
        // which is too subtle for a viewer. Kept yellow.3 #d29922 with high opacity
        // for visible highlighter behaviour - still a canonical Primer yellow token.
        highlightBg: '#d29922',
        highlightFg: '#0d1117',
        highlightOpacity: 0.85,
        strongColor:   '#79c0ff',
        emphasisColor: '#d2a8ff',
        strikeColor:   '#6e7681',
        monoColor:     '#a5d6ff',
    },

    // ---- Additional themed palettes -----------------------------------
    // Each ported from its source CSS by a dedicated extraction agent,
    // resolving every var() chain to a concrete hex/rgb/hsl value.
    // Source files cached at /tmp/obsidian_themes/.

    // bennyxguo/Obsidian-Obsidianite — dark only (light variant is
    // commented out in source per author "work in progress" note).
    'Obsidianite': {
        theme: 'dark',
        pageColor: '#100e17',           // --background-primary
        textColor: '#bebebe',           // --text-normal
        accentColor: '#0fb6d6',         // --text-accent
        pageBorderColor: '#0fb6d6',           // palette accent — page border follows the palette identity
        linkColor: '#6bcafb',           // --text-a
        codeBg: '#191621',              // --background-secondary
        ruleColor: '#4aa8fb',           // --blockquote-border
        hrColor: '#0fb6d6',
        headingUnderlineColor: '#f4569d', // sub-accent pink for the underline accent
        headingUnderlineStyle: 'gradient',
        h1Color: '#0fb6d6',             // --text-title-h1 = --text-accent
        h2Color: '#cbdbe5',             // --text-title-h2..h5 all same in source
        h3Color: '#cbdbe5',
        h4Color: '#cbdbe5',
        h5Color: '#cbdbe5',
        h6Color: '#cbdbe5',
        highlightBg: '#f4569d',         // sub-accent pink (--bg-sub-accent-55)
        highlightFg: '#100e17',         // theme self-overrides text to white at use site
        highlightOpacity: 0.55,         // matches source --bg-sub-accent-55 (more visible)
        strongColor:   '#87c2fd',
        emphasisColor: '#bb9af7',
        strikeColor:   '#6272a4',
        monoColor:     '#0fd6f0',
    },
    // pipeittodevnull/PLN — Nord-derived palette, ships an opt-in
    // .pln-hdcl class with Nord-coloured headings; we apply them as
    // the default for this preset since the user is opting into the theme.
    'PLN Dark': {
        theme: 'dark',
        pageColor: '#3b4252',           // Nord polar-night 3 (--b1)
        textColor: '#f5f7f9',           // Nord snow-storm-derived
        accentColor: '#c4a7bf',         // Nord aurora purple — runtime --color-accent default
        pageBorderColor: '#c4a7bf',           // palette accent — page border follows the palette identity
        linkColor: '#c4a7bf',
        codeBg: '#2e3440',              // Nord polar-night 0
        ruleColor: '#4c566a',           // Nord polar-night 4
        hrColor: '#4c566a',
        headingUnderlineStyle: 'solid',
        h1Color: '#d89fa4',             // Nord aurora red (from .pln-hdcl)
        h2Color: '#d08770',             // Nord aurora orange
        h3Color: '#ebcb8b',             // Nord aurora yellow
        h4Color: '#a3be8c',             // Nord aurora green
        h5Color: '#8fbcbb',             // Nord frost cyan
        h6Color: '#88c0d0',             // Nord frost light cyan
        highlightBg: '#b48ead',         // text-highlight-bg
        highlightFg: '#1a1d24',
        highlightOpacity: 1.0,
        strongColor:   '#f4a261',
        emphasisColor: '#c084fc',
        strikeColor:   '#6b7280',
        monoColor:     '#34d399',
    },
    'PLN Light': {
        theme: 'light',
        pageColor: '#f5f7f9',
        textColor: '#2e3440',
        accentColor: '#906088',
        pageBorderColor: '#906088',           // palette accent — page border follows the palette identity
        linkColor: '#906088',
        codeBg: '#eceff4',
        ruleColor: '#d8dee9',
        hrColor: '#d8dee9',
        headingUnderlineStyle: 'solid',
        h1Color: '#b84f59',
        h2Color: '#b0563a',
        h3Color: '#916919',
        h4Color: '#5c7844',
        h5Color: '#487978',
        h6Color: '#387a8d',
        highlightBg: '#b48ead',
        highlightFg: '#1a1d24',
        highlightOpacity: 1.0,
        strongColor:   '#7c3aed',
        emphasisColor: '#0891b2',
        strikeColor:   '#9ca3af',
        monoColor:     '#059669',
    },
    // AnubisNekhet/AnuPpuccin — Catppuccin port. The bare .theme-dark
    // resolves to Mocha (which we already have as "Catppuccin Mocha"),
    // so we ship Frappé here as the distinct contribution.
    'AnuPpuccin Frappé': {
        theme: 'dark',
        pageColor: '#303446',           // Frappé base
        textColor: '#c6d0f5',           // Frappé text
        accentColor: '#ca9ee6',         // Frappé mauve
        pageBorderColor: '#ca9ee6',           // palette accent — page border follows the palette identity
        linkColor: '#ca9ee6',
        codeBg: '#232634',              // Frappé crust (--background-secondary-alt)
        ruleColor: '#414559',           // Frappé surface0
        hrColor: '#414559',
        headingUnderlineStyle: 'gradient',
        // Source default has all headings = text-normal; we treat that
        // as "no per-heading override" so the gradient still draws but
        // the text colour cascades from text-normal.
        highlightBg: '#e5c890',         // Frappé yellow
        highlightFg: '#303446',
        highlightOpacity: 1.0,
        strongColor:   '#8caaee',
        emphasisColor: '#a6d189',
        strikeColor:   '#737994',
        monoColor:     '#e5c890',
    },
    // Everforest — sainnhe/everforest (dark / medium). Warm green accent,
    // pastel rainbow per heading (red→orange→yellow→green→aqua→blue). Body
    // text is the canonical low-contrast warm cream #d3c6aa.
    'Everforest': {
        theme: 'dark',
        pageColor: '#2d353b',
        textColor: '#d3c6aa',
        accentColor: '#a7c080',
        pageBorderColor: '#a7c080',           // palette accent — page border follows the palette identity
        linkColor: '#7fbbb3',
        codeBg: '#343f44',
        ruleColor: '#4f585e',
        hrColor: '#3d484d',
        headingUnderlineColor: '#a7c080',
        headingUnderlineStyle: 'gradient',
        h1Color: '#e67e80',             // red
        h2Color: '#e69875',             // orange
        h3Color: '#dbbc7f',             // yellow
        h4Color: '#a7c080',             // green
        h5Color: '#83c092',             // aqua
        h6Color: '#7fbbb3',             // blue
        highlightBg: '#dbbc7f',
        highlightFg: '#2d353b',
        highlightOpacity: 0.85,
        strongColor:   '#a7c080',       // green / function
        emphasisColor: '#d699b6',       // purple / keyword
        strikeColor:   '#859289',       // grey1 / comment
        monoColor:     '#dbbc7f',       // yellow / string
    },
    // Rosé Pine — rose-pine/palette (main "Rosé Pine" dark variant). Dusty
    // rose accent, six-token rainbow per heading (love/gold/rose/pine/foam/iris).
    'Rosé Pine': {
        theme: 'dark',
        pageColor: '#191724',
        textColor: '#e0def4',
        accentColor: '#ebbcba',         // rose
        pageBorderColor: '#ebbcba',           // palette accent — page border follows the palette identity
        linkColor: '#9ccfd8',           // foam
        codeBg: '#1f1d2e',
        ruleColor: '#21202e',
        hrColor: '#403d52',
        headingUnderlineColor: '#ebbcba',
        headingUnderlineStyle: 'gradient',
        h1Color: '#eb6f92',             // love
        h2Color: '#f6c177',             // gold
        h3Color: '#ebbcba',             // rose
        h4Color: '#31748f',             // pine
        h5Color: '#9ccfd8',             // foam
        h6Color: '#c4a7e7',             // iris
        highlightBg: '#f6c177',
        highlightFg: '#191724',
        highlightOpacity: 1.0,
        strongColor:   '#9ccfd8',       // foam (canonical bold)
        emphasisColor: '#c4a7e7',       // iris (keyword)
        strikeColor:   '#6e6a86',       // muted
        monoColor:     '#ebbcba',       // rose (inline code)
    },
    // Vesper — raunofreiberg/vesper (Adam Wathan). Near-black bg, single
    // warm-peach accent across all six heading levels (the theme's canonical
    // monochrome treatment), mint-green for inline-code.
    'Vesper': {
        theme: 'dark',
        pageColor: '#101010',
        textColor: '#ffffff',
        accentColor: '#FFC799',
        pageBorderColor: '#FFC799',           // palette accent — page border follows the palette identity
        linkColor: '#FFC799',
        codeBg: '#1C1C1C',
        ruleColor: '#232323',
        hrColor: '#232323',
        headingUnderlineColor: '#FFC799',
        headingUnderlineStyle: 'gradient',
        // Vesper is intentionally monochrome on heading colours — single
        // peach across H1-H6. Distinction is by font size only.
        h1Color: '#FFC799',
        h2Color: '#FFC799',
        h3Color: '#FFC799',
        h4Color: '#FFC799',
        h5Color: '#FFC799',
        h6Color: '#FFC799',
        highlightBg: '#FFC799',
        highlightFg: '#000000',
        highlightOpacity: 1.0,
        strongColor:   '#FFC799',       // function/peach
        emphasisColor: '#A0A0A0',       // keyword/grey
        strikeColor:   '#8B8B8B',       // comment
        monoColor:     '#99FFE4',       // string/mint
    },
    // Red Rascal — inspired by douggrubba/terminal-themes "red-rascal" preset
    // (canonical bg #0F0202, red TextColor #EE304B) but with body text lifted
    // for high contrast (~12:1 vs page). Red→amber→gold→rose heading rainbow.
    // Designed for low-blue-light night reading.
    'Red Rascal': {
        theme: 'dark',
        pageColor: '#2c0a0a',
        textColor: '#f0d8d0',
        accentColor: '#ff7575',
        pageBorderColor: '#ff7575',           // palette accent — page border follows the palette identity
        linkColor: '#d4a04a',
        codeBg: '#3e1414',
        ruleColor: '#6a2828',
        hrColor: '#ff7575',
        headingUnderlineColor: '#ff7575',
        headingUnderlineStyle: 'gradient',
        h1Color: '#ff5a5a',             // pure red
        h2Color: '#ff7a4a',             // red-orange
        h3Color: '#f0a040',             // amber
        h4Color: '#e8c060',             // gold
        h5Color: '#e8a0a0',             // rose
        h6Color: '#c88888',             // dusty rose
        highlightBg: '#5a2020',
        highlightFg: '#ffe8d0',
        highlightOpacity: 1.0,
        strongColor:   '#fcdada',       // near-white pink
        emphasisColor: '#e8b890',       // peach
        strikeColor:   '#a06868',       // muted rose
        monoColor:     '#d4a04a',       // amber/gold
    },
    // ---- Light --------------------------------------------------------
    'Solarized Light': {
        theme: 'light',
        pageColor: '#fdf6e3',
        textColor: '#657b83',
        accentColor: '#8c6a00',
        pageBorderColor: '#8c6a00',           // palette accent — page border follows the palette identity
        linkColor: '#2074af',
        codeBg: '#eee8d5',
        ruleColor: '#93a1a1',
        hrColor: '#93a1a1',
        headingUnderlineColor: '#93a1a1',
        headingUnderlineStyle: 'gradient',
        // Solarized: single accent (blue #268bd2).
        h1Color: '#2074af', h2Color: '#2074af', h3Color: '#2074af',
        h4Color: '#2074af', h5Color: '#2074af', h6Color: '#2074af',
        highlightBg: '#b58900',
        highlightFg: '#002b36',
        highlightOpacity: 0.55,
        strongColor:   '#d33682',
        emphasisColor: '#268bd2',
        strikeColor:   '#93a1a1',
        monoColor:     '#2aa198',
    },
    'GitHub Light': {
        theme: 'light',
        pageColor: '#ffffff',
        textColor: '#1f2328',           // current Primer fg.default (was legacy #24292f)
        accentColor: '#0969da',
        pageBorderColor: '#0969da',           // palette accent — page border follows the palette identity
        linkColor: '#0969da',
        codeBg: '#f6f8fa',
        ruleColor: '#d1d9e0',           // current Primer border.default (was legacy #d0d7de)
        hrColor: '#d1d9e0',
        headingUnderlineColor: '#d1d9e0',
        headingUnderlineStyle: 'solid',
        // GitHub Light: H1-H5 text colour (#1f2328), H6 muted (#59636e).
        h1Color: '#1f2328', h2Color: '#1f2328', h3Color: '#1f2328',
        h4Color: '#1f2328', h5Color: '#1f2328', h6Color: '#59636e',
        highlightBg: '#fff8c5',
        highlightFg: '#1f2328',         // matches current fg.default (was legacy #24292f)
        highlightOpacity: 1.0,
        strongColor:   '#0550ae',
        emphasisColor: '#8250df',
        strikeColor:   '#6e7681',
        monoColor:     '#0a3069',
    },
    'Ayu Light': {
        theme: 'light',
        pageColor: '#fafafa',
        textColor: '#6c7680',           // common.fg per ayu-theme/ayu-colors v7.1.0
        accentColor: '#ba5700',
        pageBorderColor: '#ba5700',           // palette accent — page border follows the palette identity
        linkColor: '#1877bb',
        codeBg: '#f3f4f5',
        ruleColor: '#dadfe5',
        hrColor: '#dadfe5',
        headingUnderlineColor: '#dadfe5',
        headingUnderlineStyle: 'gradient',
        // Ayu Light: single orange (--keyword equivalent, the iconic Ayu accent).
        h1Color: '#be5305', h2Color: '#be5305', h3Color: '#be5305',
        h4Color: '#be5305', h5Color: '#be5305', h6Color: '#be5305',
        // Highlight: yellow (--func) - stands clear of the orange headings.
        highlightBg: '#f2ae49',
        highlightFg: '#0f1419',         // common.bg (was #0f1419, the dark-variant bg)
        highlightOpacity: 0.55,
        strongColor:   '#f29718',
        emphasisColor: '#ff7733',
        strikeColor:   '#abb0b6',
        monoColor:     '#86b300',
    },
    'Gruvbox Light': {
        theme: 'light',
        pageColor: '#fbf1c7',
        textColor: '#3c3836',
        accentColor: '#956110',
        pageBorderColor: '#956110',           // palette accent — page border follows the palette identity
        linkColor: '#076678',
        codeBg: '#ebdbb2',
        ruleColor: '#d5c4a1',
        hrColor: '#bdae93',
        headingUnderlineColor: '#bdae93',
        headingUnderlineStyle: 'gradient',
        // Gruvbox Light: rainbow per insanum/obsidian_gruvbox using the
        // "faded" tier for legibility on cream bg.
        h1Color: '#9d0006',             // faded-red
        h2Color: '#af3a03',             // faded-orange
        h3Color: '#956110',             // faded-yellow
        h4Color: '#79740e',             // faded-green
        h5Color: '#427b58',             // faded-aqua
        h6Color: '#076678',             // faded-blue
        highlightBg: '#fabd2f',
        highlightFg: '#3c3836',
        highlightOpacity: 0.65,
        strongColor:   '#b57614',
        emphasisColor: '#8f3f71',
        strikeColor:   '#928374',
        monoColor:     '#79740e',
    },
    'Catppuccin Latte': {
        theme: 'light',
        pageColor: '#eff1f5',
        textColor: '#4c4f69',
        accentColor: '#8839ef',
        pageBorderColor: '#8839ef',           // palette accent — page border follows the palette identity
        linkColor: '#145ff5',
        codeBg: '#e6e9ef',
        ruleColor: '#ccd0da',
        hrColor: '#bcc0cc',
        headingUnderlineColor: '#bcc0cc',
        headingUnderlineStyle: 'gradient',
        // Catppuccin Latte: Neovim port rainbow (same role mapping as Mocha).
        h1Color: '#d20f39',             // red
        h2Color: '#bc4501',             // peach
        h3Color: '#976014',             // yellow
        h4Color: '#327c21',             // green
        h5Color: '#187585',             // sapphire
        h6Color: '#3b58fc',             // lavender
        highlightBg: '#df8e1d',         // canonical Latte yellow
        highlightFg: '#1e1e2e',
        highlightOpacity: 0.40,         // dropped from 0.95 since solid yellow is much stronger than the previous pastel
        strongColor:   '#1e66f5',
        emphasisColor: '#40a02b',
        strikeColor:   '#8c8fa1',
        monoColor:     '#df8e1d',
    },
    'One Light': {
        theme: 'light',
        pageColor: '#fafafa',
        textColor: '#383a42',
        accentColor: '#a626a4',
        pageBorderColor: '#a626a4',           // palette accent — page border follows the palette identity
        linkColor: '#2d6af1',
        codeBg: '#f0f0f0',
        ruleColor: '#e5e5e6',
        hrColor: '#a0a1a7',
        headingUnderlineColor: '#a0a1a7',
        headingUnderlineStyle: 'gradient',
        // One Light: single colour @hue-5 #e45649 (red) per canonical
        // Atom one-light-syntax. Same role as One Dark, lighter-bg variant.
        h1Color: '#da3020', h2Color: '#da3020', h3Color: '#da3020',
        h4Color: '#da3020', h5Color: '#da3020', h6Color: '#da3020',
        highlightBg: '#ffeb8a',
        highlightFg: '#383a42',
        highlightOpacity: 0.95,
        strongColor:   '#986801',
        emphasisColor: '#a626a4',
        strikeColor:   '#a0a1a7',
        monoColor:     '#50a14f',
    },
    'Tokyo Night Day': {
        // Canonical folke/tokyonight.nvim Day palette
        // (extras/lua/tokyonight_day.lua on main). Prior values matched a
        // c. 2022 revision of the same upstream; refreshed to current canon.
        theme: 'light',
        pageColor: '#e1e2e7',           // bg
        textColor: '#3760bf',           // fg
        accentColor: '#1561ca',         // blue - canonical Day primary accent
        pageBorderColor: '#1561ca',           // palette accent — page border follows the palette identity
        linkColor: '#1561ca',
        codeBg: '#d0d5e3',              // bg_dark (analogous to dark's Storm bg used for code)
        ruleColor: '#c4c8da',           // bg_highlight
        hrColor: '#c4c8da',
        headingUnderlineStyle: 'gradient',
        // Warm to cool rainbow using canonical Day palette - parallels dark variant.
        h1Color: '#f52a65',             // red
        h2Color: '#b15c00',             // orange
        h3Color: '#8c6c3e',             // yellow
        h4Color: '#587539',             // green
        h5Color: '#1561ca',             // blue
        h6Color: '#9854f1',             // magenta
        highlightBg: '#8c6c3e',         // yellow - distinct from orange h2
        highlightFg: '#ffffff',         // page bg (mirror of dark variant's choice)
        highlightOpacity: 0.40,
        strongColor:   '#8c4351',
        emphasisColor: '#7847bd',
        strikeColor:   '#7482a0',
        monoColor:     '#587539',
    },
    'Nord Light': {
        // Community-style inversion — Nord ships only as a dark theme;
        // this uses Snow Storm for bg and Polar Night for text, all from
        // the canonical 16-colour palette.
        theme: 'light',
        pageColor: '#eceff4',
        textColor: '#2e3440',
        accentColor: '#4d6d95',
        pageBorderColor: '#4d6d95',           // palette accent — page border follows the palette identity
        linkColor: '#4d6d95',
        codeBg: '#e5e9f0',
        ruleColor: '#d8dee9',
        hrColor: '#d8dee9',
        headingUnderlineColor: '#d8dee9',
        headingUnderlineStyle: 'solid',
        // Nord Light: same Aurora rainbow as Nord dark — Aurora colours
        // are spec-mandated to work on both ambiances.
        h1Color: '#b44953', h2Color: '#a85237', h3Color: '#8d6618',
        h4Color: '#597442', h5Color: '#8a5c82', h6Color: '#5e81ac',
        highlightBg: '#ebcb8b',
        highlightFg: '#2e3440',
        highlightOpacity: 0.60,
        strongColor:   '#d08770',
        emphasisColor: '#b48ead',
        strikeColor:   '#9aa5be',
        monoColor:     '#8fbcbb',
    },
    'Alucard': {
        theme: 'light',
        pageColor: '#fffbeb',           // spec Background (was #f8f8f2)
        textColor: '#1f1f1f',
        accentColor: '#644ac9',
        pageBorderColor: '#644ac9',           // palette accent — page border follows the palette identity
        linkColor: '#036a96',
        codeBg: '#eeeed8',
        ruleColor: '#cfcfde',
        hrColor: '#6c664b',             // spec Comment/Current Line (was #635d80)
        headingUnderlineColor: '#6c664b',
        headingUnderlineStyle: 'solid',
        // Alucard: single accent (purple #644ac9, Dracula light equivalent).
        h1Color: '#644ac9', h2Color: '#644ac9', h3Color: '#644ac9',
        h4Color: '#644ac9', h5Color: '#644ac9', h6Color: '#644ac9',
        // Highlight: custom soft yellow. Canonical Alucard Yellow #846e15 is
        // a dark mustard that would render as a brown bar on the cream page;
        // #f4e8a0 keeps the highlighter-marker look.
        highlightBg: '#f4e8a0',
        highlightFg: '#1f1f1f',
        highlightOpacity: 0.95,
        strongColor:   '#e05252',
        emphasisColor: '#b87bc8',
        strikeColor:   '#7a7a7a',
        monoColor:     '#6aaf6a',
    },
    // Obsidianite Light: source theme.css commented out a light variant
    // as "work in progress". Shipped here as a paired light partner using
    // the same cyan accent + pink highlight family on a near-white bg.
    'Obsidianite Light': {
        theme: 'light',
        pageColor: '#fbfbfb',
        textColor: '#333333',
        accentColor: '#0a7d93',
        pageBorderColor: '#0a7d93',           // palette accent — page border follows the palette identity
        linkColor: '#667676',
        codeBg: '#f0f0f0',
        ruleColor: '#92a1a17a',
        hrColor: '#92a1a1',
        headingUnderlineColor: '#f4569d',
        headingUnderlineStyle: 'gradient',
        h1Color: '#0a7d93',
        h2Color: '#666666',
        h3Color: '#666666',
        h4Color: '#666666',
        h5Color: '#666666',
        h6Color: '#666666',
        highlightBg: '#f4569d',
        highlightFg: '#100e17',
        highlightOpacity: 0.55,
        strongColor:   '#0fb6d6',
        emphasisColor: '#9155c4',
        strikeColor:   '#8a8a8a',
        monoColor:     '#f4569d',
    },
};

const ENCODINGS_FULL = [
    'auto', 'utf-8', 'utf-16', 'utf-16le', 'utf-16be', 'system',
    'cp1250', 'cp1251', 'cp1252', 'cp1253', 'cp1254', 'cp1255', 'cp1256', 'cp1257', 'cp1258',
    'iso-8859-1', 'iso-8859-2', 'iso-8859-15',
    'shift-jis', 'gbk', 'big5', 'euc-kr', 'koi8-r', 'koi8-u',
];
const ENCODINGS_NO_AUTO = ENCODINGS_FULL.filter(e => e !== 'auto');

const schema = [
    // ---- Theme & presets -----------------------------------------------
    // The Theme dropdown was removed in favour of preset selection — the
    // preset palette IS the theme. 'theme' is still a valid settings key
    // (presets write it, viewer reads it) but it's managed via the preset
    // picker, not a dedicated form field. When no preset is set, theme
    // resolves to 'auto' which follows DOpus pane bg luminance.
    //
    // IMPORTANT: renderForm() injects the preset picker + custom-themes
    // actions when it sees `entry.section === 'Theme & presets'`. Renaming
    // this header without also updating renderForm() removes that picker
    // from the dialog (the regression that caused commit 9cf896e's
    // sibling bug-fix).
    { section: 'Theme & presets' },

    // ---- Document handling (file decode + source-rendering behaviour) -
    { section: 'Document handling' },
    { key: 'encoding', label: 'Decode markdown as', type: 'select',
      options: ENCODINGS_FULL,
      tooltip: '"auto" sniffs BOM, then tries strict UTF-8, then falls back to the encoding below.' },
    { key: 'fallbackEncoding', label: 'Fallback when auto fails', type: 'select',
      options: ENCODINGS_NO_AUTO,
      tooltip: 'Used only when "Decode markdown as" is "auto". "system" = your Windows ANSI codepage.' },
    { key: 'hardLineBreaks', label: 'Render single newlines as line breaks', type: 'check',
      tooltip: 'ON: each newline shows as a visible break in Reading. OFF (default): newlines flow as whitespace.' },
    { key: 'showFormattingMarks', label: 'Show formatting characters in Live mode', type: 'check',
      tooltip: 'Shows an LF or CRLF badge at the end of each line in Live mode. Spaces appear as · and tabs as → so whitespace is visible too.' },

    // ---- Page surface --------------------------------------------------
    { section: 'Page surface' },
    { key: 'pageColor',           label: 'Page background',    type: 'colour',
      tooltip: 'Background colour of the centred page card. The pane background behind it stays the host theme.' },
    { key: 'pageBorderColor',     label: 'Page border',        type: 'colour',
      tooltip: 'Colour of the border around the centred page card. Defaults to the rule colour when unset.' },
    { key: 'pageBorderThickness', label: 'Page border thickness', type: 'range',
      min: 0, max: 10, step: 1, emptyDisplay: 0,
      tooltip: 'Pixel thickness. 0 hides the border (default), 10 is a thick frame.' },
    { key: 'pageShadow', label: 'Page shadow', type: 'select',
      options: ['none', 'subtle', 'soft', 'medium', 'strong', 'floating'],
      tooltip: 'Drop shadow behind the page card. Higher levels lift the page off the pane background.' },
    { key: 'textColor',   label: 'Body text',          type: 'colour',
      tooltip: 'Default text colour for paragraphs, list content, table cells, and any element that doesn\'t have its own colour override.' },
    { key: 'accentColor', label: 'Accent',             type: 'colour',
      tooltip: 'Used for bullet markers, list numbers, H3, ::marker, blockquote left bar, code-block left bar, ::selection.' },
    { key: 'linkColor',   label: 'Link',               type: 'colour',
      tooltip: 'Anchor colour for inline links and Reading-mode external links.' },
    { key: 'codeBg',      label: 'Code background',    type: 'colour',
      tooltip: 'Used for inline code, code blocks, blockquotes, and table headers. Supports rgba().' },

    // ---- Highlight (mark) ----------------------------------------------
    { section: 'Highlight (==marked text==)' },
    { key: 'highlightBg',      label: 'Highlight background', type: 'colour',
      tooltip: 'Background colour of <mark> highlights. Separate from accent so a yellow highlighter look stays distinct.' },
    { key: 'highlightFg',      label: 'Highlight text colour', type: 'colour',
      tooltip: 'Text colour inside <mark>. Stays opaque regardless of background opacity.' },
    { key: 'highlightOpacity', label: 'Highlight background opacity', type: 'range',
      min: 0, max: 1, step: 0.05,
      tooltip: '0 = invisible bg (text only), 1 = fully opaque.' },
    { key: 'highlightFontWeight', label: 'Highlight font weight', type: 'number',
      min: 100, max: 900, step: 100,
      tooltip: '100 = thin, 400 = normal, 700 = bold, 900 = black.' },

    // ---- Heading colours -----------------------------------------------
    // Per-heading colour overrides. Several Obsidian themes assign a
    // different accent to each heading level (Tokyo Night: red/yellow/
    // green/cyan/blue/magenta). When unset, each heading falls back to
    // the theme's accent or text colour.
    { section: 'Heading colours' },
    { key: 'h1Color', label: 'H1 colour', type: 'colour',
      tooltip: 'Colour for H1 headings. Falls back to the theme\'s H1 default when unset.' },
    { key: 'h2Color', label: 'H2 colour', type: 'colour',
      tooltip: 'Colour for H2 headings. Falls back to body text colour when unset.' },
    { key: 'h3Color', label: 'H3 colour', type: 'colour',
      tooltip: 'Colour for H3 headings. Falls back to body text colour when unset.' },
    { key: 'h4Color', label: 'H4 colour', type: 'colour',
      tooltip: 'Colour for H4 headings. Falls back to body text colour when unset.' },
    { key: 'h5Color', label: 'H5 colour', type: 'colour',
      tooltip: 'Colour for H5 headings. Renders in small caps with letter-spacing in Reading mode.' },
    { key: 'h6Color', label: 'H6 colour', type: 'colour',
      tooltip: 'Colour for H6 headings. Smallest level, paired with H5 for caption-style headings.' },

    // ---- Rules and dividers --------------------------------------------
    { section: 'Rules and dividers' },
    { key: 'hrColor',               label: 'Horizontal rule colour', type: 'colour',
      tooltip: 'Colour of the <hr> divider line only.' },
    { key: 'hrThickness',           label: 'Horizontal rule thickness', type: 'number',
      min: 1, max: 8, step: 1, suffix: 'px',
      tooltip: 'Pixel height of the <hr> divider. Default 1px.' },
    { key: 'headingUnderlineColor', label: 'Heading underline (H1 / H2)', type: 'colour',
      tooltip: 'Colour of the line under H1 and H2 headings. Ignored when underline style is "gradient" (gradient uses each heading\'s own colour).' },
    { key: 'headingUnderlineThickness', label: 'Heading underline thickness', type: 'number',
      min: 0, max: 6, step: 1, suffix: 'px',
      tooltip: 'Pixel thickness. 0 hides the underline.' },
    { key: 'headingUnderlineStyle', label: 'Heading underline style', type: 'select',
      options: ['solid', 'gradient', 'none'],
      tooltip: '"solid" = flat line under H1 and H2. "gradient" = fading line under H1-H6 in their own colours. "none" = no underline anywhere.' },
    { key: 'ruleColor',             label: 'Table / image / footnote borders', type: 'colour',
      tooltip: 'Border colour for tables, images, the footnote section divider, and the page-card border (when set). Defaults to the palette accent.' },

    // ---- Body typography (the main prose) ------------------------------
    { section: 'Body text' },
    { key: 'fontFamily', label: 'Body font',  type: 'font',
      placeholder: "Start typing or pick from list. Supports fallbacks: 'Segoe UI', sans-serif",
      tooltip: 'Prose font for paragraphs, headings, lists, tables. Accepts a CSS font stack with fallbacks (e.g. \'Inter\', sans-serif).' },
    { key: 'proseFontWeight', label: 'Body font weight', type: 'number',
      min: 100, max: 900, step: 100,
      tooltip: '100 = thin, 400 = normal, 700 = bold. Variable fonts ignore values their axis doesn\'t define.' },
    { key: 'fontSize',   label: 'Body font size', type: 'number',
      min: 8, max: 32, step: 1, suffix: 'px',
      tooltip: 'Headings and other text scale relative to this via em units.' },
    { key: 'lineHeight', label: 'Body line height', type: 'number',
      min: 1.0, max: 3.0, step: 0.05,
      tooltip: 'Multiplier. 1.55 = default.' },

    // ---- Code typography ----------------------------------------------
    { section: 'Code text' },
    { key: 'codeFont',       label: 'Code font',  type: 'font',
      placeholder: "Start typing or pick. Fallbacks: 'Cascadia Code', Consolas, monospace",
      tooltip: 'Monospace font for inline code and code blocks. Accepts a CSS font stack with fallbacks.' },
    { key: 'codeFontWeight', label: 'Code font weight', type: 'number',
      min: 100, max: 900, step: 100,
      tooltip: 'Applies to inline code and code blocks.' },
    { key: 'codeFontSize',   label: 'Code font size', type: 'text',
      placeholder: "0.92em (inline default), or px value e.g. 13px",
      tooltip: 'CSS length. em = relative to body, px = absolute. Defaults: inline 0.92em, pre 12px.' },
    { key: 'codeLineHeight', label: 'Code line height', type: 'number',
      min: 1.0, max: 3.0, step: 0.05,
      tooltip: 'Multiplier for code blocks. Default 1.5.' },

    // ---- Page layout ---------------------------------------------------
    { section: 'Page layout' },
    { key: 'maxWidth',    label: 'Page max width', type: 'number',
      min: 400, max: 2000, step: 10, suffix: 'px',
      tooltip: 'Maximum width of the centred page card in pixels. Content beyond this stays bounded.' },
    { key: 'pagePadding', label: 'Page padding',   type: 'text',
      placeholder: "e.g. '32px 40px' or 24",
      tooltip: 'CSS padding shorthand, or a single number (interpreted as px).' },

];

// ---------------------------------------------------------------------------
// State

let defaultSettings = {};
let userSettings    = {};
let panePaletteMode = null;   // 'dark' | 'light' set by native via paneTheme
let panePaneBg      = null;   // raw '#rrggbb' from DOpus
let systemFonts     = [];     // string list set by native via 'fonts' message

// Custom theme state. customThemes is the sorted name list from native;
// currentCustomTheme is the active custom (if any); appliedSnapshot is the
// THEMABLE_KEYS map of the most recently applied custom theme's file
// contents, used to detect form divergence for the asterisk indicator.
let customThemes        = [];
let currentCustomTheme  = null;
let appliedSnapshot     = null;
// Tracks the most recently selected BUILT-IN palette name (e.g. 'Dracula',
// 'PLN Dark', 'Tokyo Night Day') so the preset picker can simply show
// that name back on dialog open instead of trying to auto-detect a match
// against every palette - which is fragile when a palette omits some
// PRESET_KEYs or when the user has tweaked one colour after applying.
// Persisted as `activePalette` in settings.json. Cleared when the user
// picks Default Auto / Light / Dark (returning to no-preset state).
let currentBuiltinPalette = null;
// When loading a custom theme, the reply handler needs to know whether
// to apply the values to the form (user picked it from the picker) or
// just store the snapshot for comparison (dialog open with an already-
// active theme).
let pendingLoadMode     = null;  // 'apply' | 'compare' | null

const form = document.getElementById('settings-form');
const statusEl = document.getElementById('status');

// ---------------------------------------------------------------------------
// Helpers

function send(msg) {
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(JSON.stringify(msg));
    }
}

function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = 'status' + (cls ? ' ' + cls : '');
}

function isEmpty(v) {
    return v === undefined || v === null || v === '';
}

// Tolerant hex parser: accepts #RGB, RGB, #RRGGBB, RRGGBB, #RRGGBBAA,
// RRGGBBAA (alpha stripped for swatch since <input type="color"> can't
// represent alpha). Returns canonical "#RRGGBB" or null if not a hex
// shape. Used to mirror text-field values into the native colour picker
// whenever the user types or pastes a hex literal.
function parseHexColour(s) {
    if (!s) return null;
    const t = s.trim().replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{3}$/.test(t)) {
        return '#' + t[0]+t[0] + t[1]+t[1] + t[2]+t[2];
    }
    if (/^[0-9a-f]{6}$/.test(t) || /^[0-9a-f]{8}$/.test(t)) {
        return '#' + t.substring(0, 6);
    }
    return null;
}

// Returns the value the form should display for `key`, prefering user
// override over default. May be null (= cleared).
function effectiveValue(key) {
    if (userSettings[key] !== undefined) return userSettings[key];
    return defaultSettings[key];
}

// Theme is special — no schema entry (the preset picker manages it), so
// it doesn't appear in the form. Read/write via these helpers, which
// keep userSettings as the source of truth. 'auto' = absent from
// userSettings (defaults are 'auto' too); concrete 'dark'/'light' are
// stored explicitly when a preset pins them.
function getThemeValue() {
    if (!isEmpty(userSettings.theme))    return userSettings.theme;
    if (!isEmpty(defaultSettings.theme)) return defaultSettings.theme;
    return 'auto';
}

function setThemeValue(value) {
    if (isEmpty(value) || value === 'auto') {
        delete userSettings.theme;
    } else {
        userSettings.theme = value;
    }
}

// ---------------------------------------------------------------------------
// Form rendering

function makeRow(entry) {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.key = entry.key;

    const label = document.createElement('label');
    label.htmlFor = 'input-' + entry.key;
    // If the schema entry carries `tooltip`, append a small (?) icon
    // next to the label. To prevent the icon from ever landing on its
    // own line away from the label, the LAST WORD of the label text and
    // the icon are wrapped in a non-breaking inline span (.help-icon-
    // tail). When the label needs to wrap, that last-word-plus-icon
    // unit wraps as a single piece, never orphaning the icon. Single-
    // word labels just append the icon with a non-breaking space.
    if (entry.tooltip) {
        const icon = document.createElement('span');
        icon.className = 'help-icon';
        icon.setAttribute('data-tooltip', entry.tooltip);
        icon.setAttribute('role', 'note');
        icon.setAttribute('aria-label', entry.tooltip);
        icon.tabIndex = 0;
        icon.textContent = '?';

        const text = entry.label;
        const lastSpace = text.lastIndexOf(' ');
        if (lastSpace >= 0) {
            label.textContent = text.substring(0, lastSpace + 1);
            const tail = document.createElement('span');
            tail.className = 'help-icon-tail';
            tail.textContent = text.substring(lastSpace + 1);
            tail.appendChild(document.createTextNode(' '));
            tail.appendChild(icon);
            label.appendChild(tail);
        } else {
            label.textContent = text;
            label.appendChild(document.createTextNode(' '));
            label.appendChild(icon);
        }
    } else {
        label.textContent = entry.label;
    }
    row.appendChild(label);

    let control;
    if (entry.type === 'select') {
        control = document.createElement('select');
        control.id = 'input-' + entry.key;
        for (const opt of entry.options) {
            const o = document.createElement('option');
            o.value = opt;
            o.textContent = opt;
            control.appendChild(o);
        }
        // Wrap selects so we can render a palette-coloured caret via the
        // wrap's ::after pseudo-element. Native <select> arrow is hard
        // to see on some palettes. Wrap is appended below; we still
        // skip the late row.appendChild for type 'select'.
        const selectWrap = document.createElement('div');
        selectWrap.className = 'select-wrap';
        selectWrap.appendChild(control);
        row.appendChild(selectWrap);
    } else if (entry.type === 'colour') {
        // Colour rows use a swatch + text input pair so users can either
        // pick visually or paste an rgba() / hsl() / named-colour / hex value.
        const group = document.createElement('div');
        group.className = 'colour-group';
        const swatch = document.createElement('input');
        swatch.type = 'color';
        swatch.id = 'input-' + entry.key + '-swatch';
        const text = document.createElement('input');
        text.type = 'text';
        text.id = 'input-' + entry.key;
        text.placeholder = 'e.g. #ff8800, rgba(...), red';
        // Wiring: swatch -> text (push picked hex value)
        //         text   -> swatch (best-effort if value parses as a colour)
        swatch.addEventListener('input', () => {
            text.value = swatch.value;
            text.dispatchEvent(new Event('input'));
        });
        text.addEventListener('input', () => {
            const hex = parseHexColour(text.value);
            if (hex) swatch.value = hex;
            updateResetState(row, entry);
        });
        group.appendChild(swatch);
        group.appendChild(text);
        row.appendChild(group);
        control = text;
    } else if (entry.type === 'number') {
        control = document.createElement('input');
        control.type = 'number';
        control.id = 'input-' + entry.key;
        if (entry.min !== undefined)  control.min  = entry.min;
        if (entry.max !== undefined)  control.max  = entry.max;
        if (entry.step !== undefined) control.step = entry.step;
        control.placeholder = '';
    } else if (entry.type === 'range') {
        // Range row pairs a slider with a live numeric readout. The text
        // representation is the canonical value (so collectForSave reads
        // a sane number even at 0).
        const group = document.createElement('div');
        group.className = 'range-group';
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = 'input-' + entry.key + '-slider';
        if (entry.min !== undefined)  slider.min  = entry.min;
        if (entry.max !== undefined)  slider.max  = entry.max;
        if (entry.step !== undefined) slider.step = entry.step;
        const readout = document.createElement('input');
        readout.type = 'number';
        readout.id = 'input-' + entry.key;
        readout.placeholder = '';
        if (entry.min !== undefined)  readout.min  = entry.min;
        if (entry.max !== undefined)  readout.max  = entry.max;
        if (entry.step !== undefined) readout.step = entry.step;
        slider.addEventListener('input', () => {
            readout.value = slider.value;
            readout.dispatchEvent(new Event('input'));
        });
        readout.addEventListener('input', () => {
            if (readout.value !== '') slider.value = readout.value;
            updateResetState(row, entry);
        });
        group.appendChild(slider);
        group.appendChild(readout);
        row.appendChild(group);
        control = readout;
    } else if (entry.type === 'font') {
        // Font row: text input backed by a <datalist> populated from the
        // 'fonts' message (native-side EnumFontFamiliesEx). Users get
        // autocomplete + visual list but can still type CSS font stacks
        // with fallbacks like "'Segoe UI', sans-serif".
        control = document.createElement('input');
        control.type = 'text';
        control.id = 'input-' + entry.key;
        control.setAttribute('list', 'system-fonts-datalist');
        control.autocomplete = 'off';
        if (entry.placeholder) control.placeholder = entry.placeholder;
    } else if (entry.type === 'check') {
        // Boolean toggle. Value is true/false in the user-settings JSON;
        // omitted (null/undefined) means use the default from settings-
        // defaults.json. The reset button below clears it back to the
        // default just like every other field.
        control = document.createElement('input');
        control.type = 'checkbox';
        control.id = 'input-' + entry.key;
    } else {
        control = document.createElement('input');
        control.type = 'text';
        control.id = 'input-' + entry.key;
        if (entry.placeholder) control.placeholder = entry.placeholder;
    }

    if (entry.type !== 'colour' && entry.type !== 'range' && entry.type !== 'select') {
        row.appendChild(control);
    }

    // input/change fire on every keystroke / slider drag / colour pick.
    // updateResetState toggles the reset button's enabled state, and
    // applyOwnPalette + syncPresetPicker refresh the dialog's own chrome
    // and preset dropdown live so the user sees the effect of their
    // edit immediately - no more 'close and reopen to see the change'.
    const onEdit = () => {
        updateResetState(row, entry);
        applyOwnPalette();
        syncPresetPicker();
    };
    control.addEventListener('input',  onEdit);
    control.addEventListener('change', onEdit);

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'reset-link';
    reset.textContent = 'reset';
    reset.title = 'Clear this field back to the theme default';
    reset.addEventListener('click', () => {
        setControlValue(entry, null);
        updateResetState(row, entry);
    });
    row.appendChild(reset);

    return row;
}

// Theme defaults: for each settings key, the value the dialog should
// SHOW the user when their override is empty. Two sources:
//   1. CSS variables on documentElement - looked up via getComputedStyle.
//      Body theme classes (theme-light / theme-dark / palette overrides)
//      determine which value is active, so the dialog reflects the real
//      live default at any given moment.
//   2. A static fallback map for keys without a corresponding CSS variable
//      (numeric layout/typography defaults that live as inline `var(...,
//      <literal>)` fallbacks in viewer.css rather than as named theme vars).
// The returned value is a STRING ready for display as placeholder or
// initial visual state (swatch colour, slider position, etc.).
const themeDefaultVarMap = {
    textColor:             '--ink',
    pageColor:             '--page',
    pageBorderColor:       '--accent',
    accentColor:           '--accent',
    linkColor:             '--link',
    codeBg:                '--code',
    ruleColor:             '--rule',
    hrColor:               '--accent',
    headingUnderlineColor: '--accent',
    h1Color:               '--h1',
    h2Color:               '--ink',
    h3Color:               '--ink',
    h4Color:               '--ink',
    h5Color:               '--ink-soft',
    h6Color:               '--ink-soft',
    highlightBg:           '--mark-bg',
    highlightFg:           '--mark-fg',
};
const themeDefaultStatic = {
    maxWidth:                  '760px',
    pagePadding:               '36px 36px',
    hrThickness:               '1px',
    pageBorderThickness:       '0',
    headingUnderlineThickness: '2px',
    fontSize:                  '14px',
    lineHeight:                '2',
    proseFontWeight:           '400',
    codeFontWeight:            '400',
    codeFontSize:              '0.92em',
    codeLineHeight:            '1.5',
    highlightOpacity:          '0.75',
    highlightFontWeight:       '500',
    headingUnderlineStyle:     'gradient',
    encoding:                  'auto',
    fallbackEncoding:          'system',
    fontFamily:                "'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, sans-serif",
    codeFont:                  "'Cascadia Code', Consolas, ui-monospace, monospace",
};

function themeDefaultFor(key) {
    const varName = themeDefaultVarMap[key];
    if (varName) {
        // CRITICAL: theme variables (--ink, --page, --accent, ...) are
        // declared on body.theme-light / body.theme-dark in viewer.css,
        // NOT on :root. getComputedStyle(documentElement) returns ''
        // for them. Must read from document.body. Override variables
        // (--ink-override, etc) ARE on documentElement (set by
        // applyOwnPalette) but those are USER values, not theme defaults.
        const v = getComputedStyle(document.body).getPropertyValue(varName).trim();
        if (v) return v;
    }
    return themeDefaultStatic[key] || null;
}

function setControlValue(entry, value) {
    if (entry.type === 'select') {
        const sel = document.getElementById('input-' + entry.key);
        if (!sel) return;
        const defVal = defaultSettings[entry.key];
        sel.value = isEmpty(value) ? (defVal ?? entry.options[0]) : String(value);
    } else if (entry.type === 'colour') {
        const text   = document.getElementById('input-' + entry.key);
        const swatch = document.getElementById('input-' + entry.key + '-swatch');
        if (!text || !swatch) return;
        const themeDef = themeDefaultFor(entry.key);
        // Text input stays EMPTY when there is no user override so the
        // form clearly distinguishes 'no override' (empty) from 'user
        // value' (populated). The placeholder surfaces the current
        // resolved value (from the active palette / theme) so the user
        // can see what is in effect without confusing it for a real
        // override (which would break preset-matching when a palette
        // omits some PRESET_KEYs).
        text.value = isEmpty(value) ? '' : String(value);
        text.placeholder = themeDef
            ? String(themeDef)
            : 'e.g. #ff8800, rgba(...), red';
        const hex = parseHexColour(text.value) || parseHexColour(themeDef || '');
        swatch.value = hex || '#888888';
    } else if (entry.type === 'range') {
        const readout = document.getElementById('input-' + entry.key);
        const slider  = document.getElementById('input-' + entry.key + '-slider');
        if (!readout || !slider) return;
        if (isEmpty(value)) {
            const themeDef = themeDefaultFor(entry.key);
            const themeNum = themeDef !== null ? parseFloat(themeDef) : NaN;
            // Slider parks at the theme default position if parseable, so
            // the visual state reflects what's in effect. Readout stays
            // empty (matches 'no override' for save / preset matching).
            const parked = Number.isFinite(themeNum)
                         ? themeNum
                         : (entry.emptyDisplay !== undefined ? entry.emptyDisplay : entry.max);
            readout.value = '';
            readout.placeholder = themeDef ? String(themeDef) : '';
            slider.value = String(parked);
        } else {
            readout.value = String(value);
            slider.value  = String(value);
        }
    } else if (entry.type === 'number') {
        const inp = document.getElementById('input-' + entry.key);
        if (!inp) return;
        const themeDef = themeDefaultFor(entry.key);
        inp.value = isEmpty(value) ? '' : String(value);
        inp.placeholder = themeDef ? String(themeDef) : '';
    } else if (entry.type === 'font') {
        const inp = document.getElementById('input-' + entry.key);
        if (!inp) return;
        const themeDef = themeDefaultFor(entry.key);
        inp.value = isEmpty(value) ? '' : String(value);
        const showDef = themeDef ? (themeDef.length > 50 ? themeDef.slice(0, 47) + '...' : themeDef) : null;
        inp.placeholder = showDef ? String(showDef) : (entry.placeholder || 'Start typing or pick from list');
    } else if (entry.type === 'check') {
        const inp = document.getElementById('input-' + entry.key);
        if (!inp) return;
        const defVal = defaultSettings[entry.key];
        inp.checked = isEmpty(value) ? (defVal === true) : (value === true);
    } else {
        const inp = document.getElementById('input-' + entry.key);
        if (!inp) return;
        const themeDef = themeDefaultFor(entry.key);
        inp.value = isEmpty(value) ? '' : String(value);
        if (themeDef) inp.placeholder = String(themeDef);
    }
}

function getControlValue(entry) {
    if (entry.type === 'select') {
        return document.getElementById('input-' + entry.key)?.value || null;
    } else if (entry.type === 'colour') {
        const v = document.getElementById('input-' + entry.key)?.value.trim();
        return v ? v : null;
    } else if (entry.type === 'number' || entry.type === 'range') {
        const v = document.getElementById('input-' + entry.key)?.value.trim();
        if (!v) return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    } else if (entry.type === 'check') {
        const inp = document.getElementById('input-' + entry.key);
        if (!inp) return null;
        return inp.checked === true;
    } else {
        const v = document.getElementById('input-' + entry.key)?.value;
        return (v === undefined || v === null || v === '') ? null : v;
    }
}

function updateResetState(row, entry) {
    const reset = row.querySelector('.reset-link');
    if (!reset) return;
    // Enabled only when the field differs from the default. For colour
    // fields the default is null; any non-empty text means "user has set
    // something" so reset is meaningful. For select fields the default is
    // whatever's in defaultSettings (typically 'auto'/'system'/...).
    const current = getControlValue(entry);
    let isDefault;
    if (entry.type === 'select') {
        const def = defaultSettings[entry.key] ?? entry.options[0];
        isDefault = String(current ?? '') === String(def);
    } else {
        // null / empty == default
        isDefault = isEmpty(current);
    }
    reset.disabled = isDefault;
}

// Keys a preset can touch. Other settings (font, sizes, encoding) are
// considered personal preference and untouched by preset selection.
const PRESET_KEYS = ['theme', 'pageColor', 'textColor', 'accentColor',
    'linkColor', 'codeBg', 'ruleColor', 'hrColor', 'headingUnderlineColor',
    'headingUnderlineStyle',
    'h1Color','h2Color','h3Color','h4Color','h5Color','h6Color',
    'highlightBg', 'highlightFg', 'highlightOpacity',
    'strongColor', 'emphasisColor', 'strikeColor', 'monoColor',
    'pageBorderColor'];
// pageBorderColor is in PRESET_KEYS so that picking any built-in palette
// writes that palette's own colour into the setting. Every built-in palette
// defines pageBorderColor (mirroring its accent), so the page border
// always reflects the active palette's identity and the settings dialog
// shows the colour explicitly rather than relying on a CSS fallback chain.

// Keys a CUSTOM (user-defined) theme snapshots. Per user decision: every
// form field except file encoding settings. The 'theme' key is included
// too (managed via getThemeValue/setThemeValue, not the schema). Built
// from the schema at startup so adding a new visual setting auto-includes
// it in custom themes without touching this constant.
function buildThemableKeys() {
    const out = ['theme'];
    for (const e of schema) {
        if (e.section) continue;
        if (e.key === 'encoding' || e.key === 'fallbackEncoding') continue;
        out.push(e.key);
    }
    return out;
}
const THEMABLE_KEYS = buildThemableKeys();

function buildPresetOptions(select) {
    select.innerHTML = '';

    // Default Auto stays at the top, outside any optgroup. It has no
    // light/dark association — it follows the host pane's background.
    const autoOpt = document.createElement('option');
    autoOpt.value = 'Default Auto';
    autoOpt.textContent = 'Default Auto (follows DOpus theme)';
    select.appendChild(autoOpt);

    // Partition built-in palettes by light/dark, sort within each.
    const lightNames = [];
    const darkNames  = [];
    for (const [name, p] of Object.entries(palettes)) {
        (p.theme === 'dark' ? darkNames : lightNames).push(name);
    }
    lightNames.sort((a, b) => a.localeCompare(b));
    darkNames.sort((a, b)  => a.localeCompare(b));

    // Light group: Default Light pinned first, then palettes alphabetical.
    const lightGroup = document.createElement('optgroup');
    lightGroup.label = 'Light';
    appendOption(lightGroup, 'Default Light', 'Default Light');
    for (const name of lightNames) appendOption(lightGroup, name, name);
    select.appendChild(lightGroup);

    // Dark group: Default Dark pinned first, then palettes alphabetical.
    const darkGroup = document.createElement('optgroup');
    darkGroup.label = 'Dark';
    appendOption(darkGroup, 'Default Dark', 'Default Dark');
    for (const name of darkNames) appendOption(darkGroup, name, name);
    select.appendChild(darkGroup);

    // User-saved entries. Until native sends per-entry _kind metadata in
    // customThemesList, we partition opportunistically: any entry whose
    // kind we've observed locally (via save action or load reply) goes
    // into its specific group; the rest fall into "Your saved" combined.
    if (customThemes.length > 0) {
        const known = { palette: [], style: [], theme: [] };
        const unknown = [];
        for (const name of customThemes) {
            const k = customEntryKinds.get(name);
            if (k === 'palette' || k === 'style' || k === 'theme') known[k].push(name);
            else unknown.push(name);
        }
        known.palette.sort((a, b) => a.localeCompare(b));
        known.style.sort((a, b)   => a.localeCompare(b));
        known.theme.sort((a, b)   => a.localeCompare(b));
        unknown.sort((a, b)       => a.localeCompare(b));

        const appendGroup = (label, names) => {
            if (names.length === 0) return;
            const g = document.createElement('optgroup');
            g.label = label;
            for (const name of names) appendOption(g, 'custom:' + name, name);
            select.appendChild(g);
        };
        appendGroup('Your palettes', known.palette);
        appendGroup('Your styles',   known.style);
        appendGroup('Your themes',   known.theme);
        if (unknown.length > 0) {
            const anyKnown = known.palette.length || known.style.length || known.theme.length;
            appendGroup(anyKnown ? 'Your saved (kind unknown)' : 'Your saved', unknown);
        }
    }
}

function appendOption(parent, value, text) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    parent.appendChild(o);
}

// Local cache of per-entry kind, populated on save (we know the kind we
// chose) and on load reply (the JSON's _kind field). Entries not yet
// touched in this session have unknown kind. See buildPresetOptions.
const customEntryKinds = new Map();

function makePresetRow() {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.special = 'preset';

    const label = document.createElement('label');
    label.textContent = 'Load preset palette';
    label.htmlFor = 'preset-picker';
    row.appendChild(label);

    // Picker + menu trigger live in one wrap inside the row's control
    // column. The select grows to fill the column; the kebab button sits
    // tight to its right and opens the save/delete menu just below it.
    const pickerWrap = document.createElement('div');
    pickerWrap.className = 'preset-picker-wrap';

    const selectWrap = document.createElement('div');
    selectWrap.className = 'select-wrap';
    const select = document.createElement('select');
    select.id = 'preset-picker';
    buildPresetOptions(select);

    // Apply the picker's selection. Bound to BOTH 'change' (commit-style
    // events from click + keyboard-Enter) AND 'input' (fires on arrow-key
    // navigation through options in most browsers, preserving the
    // "scroll through presets and see live preview" behaviour). Both
    // events are idempotent for the same value, so duplicate firing is
    // harmless.
    const handlePickerChange = () => {
        const name = select.value;
        if (!name) return;
        if (name.startsWith('custom:')) {
            const themeName = name.substring(7);
            pendingLoadMode = 'apply';
            send({ type: 'loadCustomTheme', name: themeName });
            return;
        }
        // Built-in selection clears any custom-theme active state.
        currentCustomTheme = null;
        appliedSnapshot = null;
        if (name === 'Default Auto')       { currentBuiltinPalette = null; applyDefault('auto');  }
        else if (name === 'Default Light') { currentBuiltinPalette = null; applyDefault('light'); }
        else if (name === 'Default Dark')  { currentBuiltinPalette = null; applyDefault('dark');  }
        else {
            const p = palettes[name];
            if (!p) return;
            currentBuiltinPalette = name;
            applyPreset(p);
        }
        syncPresetPicker();
        updateThemeActionsVisibility();
        setStatus(`Loaded "${name}". Click Apply to save, or tweak any field first.`, '');
    };
    select.addEventListener('change', handlePickerChange);
    select.addEventListener('input',  handlePickerChange);
    selectWrap.appendChild(select);
    pickerWrap.appendChild(selectWrap);

    // Menu trigger (kebab) and popup. Same IDs as the footer used to use
    // so existing boot() wire-up (open/close/click-outside, item dispatch
    // to revealSaveAsInput / deleteCurrentCustomTheme) keeps working.
    const menuWrap = document.createElement('div');
    menuWrap.className = 'preset-menu-wrap';

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.id = 'btn-themes-menu';
    menuBtn.className = 'btn-save-menu';
    menuBtn.title = 'Save the current configuration as a palette, style, or theme. Also lets you delete the current custom selection.';
    menuBtn.setAttribute('aria-haspopup', 'menu');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.textContent = 'Save…';
    menuWrap.appendChild(menuBtn);

    const menu = document.createElement('div');
    menu.id = 'themes-menu';
    menu.className = 'preset-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    menu.innerHTML =
        '<button type="button" class="menu-item" data-action="save-palette" role="menuitem">Save as palette<span class="menu-hint">colours only</span></button>' +
        '<button type="button" class="menu-item" data-action="save-style" role="menuitem">Save as style<span class="menu-hint">typography, sizes, layout</span></button>' +
        '<button type="button" class="menu-item" data-action="save-theme" role="menuitem">Save as theme<span class="menu-hint">palette + style</span></button>' +
        '<div class="menu-sep"></div>' +
        '<button type="button" class="menu-item" data-action="delete" id="menu-delete" role="menuitem" disabled>Delete current<span class="menu-hint" id="menu-delete-hint">no custom selection</span></button>';
    menuWrap.appendChild(menu);

    pickerWrap.appendChild(menuWrap);

    row.appendChild(pickerWrap);
    row.appendChild(document.createElement('span'));  // grid spacer for "reset" col

    return row;
}

// All custom-theme/palette actions live in the footer "Themes ▾" menu now
// (see settings.html). The form's old "Your themes" row was removed
// because the only action that lived there (Delete) is now in the menu.

function updateThemeActionsVisibility() {
    // Enable/disable the menu's Delete item based on whether a custom
    // theme or palette is currently active. The menu trigger button
    // itself stays enabled (Save actions are always available).
    const del = document.getElementById('menu-delete');
    const hint = document.getElementById('menu-delete-hint');
    if (!del) return;
    if (currentCustomTheme) {
        del.disabled = false;
        if (hint) hint.textContent = `"${currentCustomTheme}"`;
    } else {
        del.disabled = true;
        if (hint) hint.textContent = 'no custom selection';
    }
}

// What kind of entity the name-entry is collecting a name for. Set when
// the user picks Save-as-palette / Save-as-style / Save-as-theme from
// the menu; read by submitSaveAsInput to choose which snapshot keys go
// in and which _kind tag gets written to the saved JSON.
let currentSaveKind = 'theme';   // 'palette' | 'style' | 'theme'

function revealSaveAsInput(kind) {
    // Entry and footer-actions both live in the footer (settings.html).
    // Reveal swaps them: hide the regular footer buttons, show the name
    // entry inline. Submit/Cancel restore the footer.
    currentSaveKind = (kind === 'palette' || kind === 'style' || kind === 'theme') ? kind : 'theme';
    const entry = document.getElementById('save-theme-entry');
    const footerActions = document.getElementById('footer-actions');
    if (!entry || !footerActions) return;
    footerActions.style.display = 'none';
    entry.style.display = '';
    const label = document.getElementById('save-theme-entry-label');
    if (label) label.textContent = 'Save as ' + currentSaveKind;
    const nameInput = document.getElementById('save-theme-name');
    if (nameInput) {
        nameInput.value = currentCustomTheme || '';
        const kindLabel = currentSaveKind.charAt(0).toUpperCase() + currentSaveKind.slice(1);
        nameInput.placeholder = kindLabel + ' name';
        nameInput.focus();
        nameInput.select();
    }
}

function hideSaveAsInput() {
    const entry = document.getElementById('save-theme-entry');
    const footerActions = document.getElementById('footer-actions');
    if (entry) entry.style.display = 'none';
    if (footerActions) footerActions.style.display = '';
    updateThemeActionsVisibility();
}

function submitSaveAsInput() {
    const nameInput = document.getElementById('save-theme-name');
    if (!nameInput) return;
    const raw = nameInput.value;
    const err = validateThemeName(raw);
    if (err) {
        setStatus(err, 'fail');
        nameInput.focus();
        return;
    }
    const trimmed = raw.trim();
    const kindLabel = currentSaveKind.charAt(0).toUpperCase() + currentSaveKind.slice(1);
    const exists = customThemes.some(t => t.toLowerCase() === trimmed.toLowerCase());
    if (exists && !window.confirm(`${kindLabel} "${trimmed}" already exists. Overwrite it?`)) {
        nameInput.focus();
        return;
    }
    const snapshot = snapshotCurrentTheme(currentSaveKind);
    // Tag with _kind so the loader knows whether to apply all keys (theme)
    // or only colour keys (palette). Native side stores the JSON verbatim,
    // so the tag round-trips on load. Also cache locally so the picker
    // can group this entry under the right "Your palettes"/"Your themes"
    // optgroup without needing a load round-trip.
    snapshot._kind = currentSaveKind;
    customEntryKinds.set(trimmed, currentSaveKind);
    send({ type: 'saveCustomTheme', name: trimmed, json: JSON.stringify(snapshot, null, 2) });
}

function deleteCurrentCustomTheme() {
    if (!currentCustomTheme) return;
    if (!window.confirm(`Delete the custom theme "${currentCustomTheme}"? The current settings are not affected.`)) return;
    send({ type: 'deleteCustomTheme', name: currentCustomTheme });
}

function validateThemeName(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return 'Theme name cannot be empty.';
    if (trimmed.length > 100) return 'Theme name too long (max 100 characters).';
    if (/[\\\/:*?"<>|]/.test(trimmed)) {
        return 'Theme name contains illegal characters: \\ / : * ? " < > |';
    }
    if (/[\x00-\x1f]/.test(trimmed)) return 'Theme name contains control characters.';
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(trimmed)) {
        return 'Theme name is a reserved Windows filename.';
    }
    const builtIns = ['Default Auto', 'Default Light', 'Default Dark',
                      ...Object.keys(palettes)];
    if (builtIns.some(b => b.toLowerCase() === trimmed.toLowerCase())) {
        return `"${trimmed}" matches a built-in palette name. Pick another name.`;
    }
    return null;
}

// Three kinds of user-saved snapshots and the keys each captures:
//
//   palette = colours and opacities only. Strict: no fonts, sizes,
//             borders, behavioural toggles. Loading a palette over the
//             top of an existing configuration changes ONLY colours.
//   style   = everything non-palette and non-encoding: typography,
//             sizing, layout, border thickness, heading underline style,
//             plus behavioural toggles (hardLineBreaks, showFormattingMarks).
//             "Anything non-palette is styling" (user direction).
//   theme   = palette + style + the light/dark base. Full snapshot.
//
// THEMABLE_KEYS (built from schema at startup) is the superset = theme.
// PALETTE_KEYS + STYLE_KEYS + 'theme' should equal THEMABLE_KEYS.
const PALETTE_KEYS = [
    'pageColor', 'textColor', 'accentColor', 'linkColor', 'codeBg',
    'ruleColor', 'hrColor', 'headingUnderlineColor',
    'h1Color', 'h2Color', 'h3Color', 'h4Color', 'h5Color', 'h6Color',
    'highlightBg', 'highlightFg', 'highlightOpacity',
    'strongColor', 'emphasisColor', 'strikeColor', 'monoColor',
    'pageBorderColor',
];
const STYLE_KEYS = [
    'headingUnderlineStyle',
    'pageBorderThickness', 'pageShadow',
    'fontFamily', 'proseFontWeight', 'fontSize', 'lineHeight',
    'codeFont', 'codeFontWeight', 'codeFontSize', 'codeLineHeight',
    'highlightFontWeight',
    'maxWidth', 'pagePadding',
    'hrThickness', 'headingUnderlineThickness',
    'hardLineBreaks', 'showFormattingMarks',
];

function keysForKind(kind) {
    if (kind === 'palette') return PALETTE_KEYS;
    if (kind === 'style')   return STYLE_KEYS;
    return THEMABLE_KEYS;   // 'theme' (or unspecified/legacy)
}

// Snapshot the current form state into a JSON-serialisable map of values
// for whichever kind is requested (palette / style / theme). Empty
// fields are omitted so loading is additive within the snapshot's scope.
function snapshotCurrentTheme(kind) {
    const keys = keysForKind(kind);
    const out = {};
    for (const key of keys) {
        if (key === 'theme') {
            const t = getThemeValue();
            if (t && t !== 'auto') out.theme = t;
            continue;
        }
        const entry = schema.find(s => s.key === key);
        if (!entry) continue;
        const cur = getControlValue(entry);
        if (!isEmpty(cur)) out[key] = cur;
    }
    return out;
}

// Fill the form from a saved snapshot. The JSON's _kind field decides
// scope:
//   'palette' -> only PALETTE_KEYS touched; fonts/sizes/etc unchanged
//   'style'   -> only STYLE_KEYS touched; colours unchanged
//   'theme'   -> full replace across THEMABLE_KEYS (also light/dark base)
//   missing   -> treated as 'theme' for backward compatibility with
//                saves from before the kind tag existed.
function applyCustomTheme(themeData) {
    const kind = (themeData._kind === 'palette' || themeData._kind === 'style')
        ? themeData._kind
        : 'theme';
    const keys = keysForKind(kind);
    for (const key of keys) {
        if (key === 'theme') {
            setThemeValue(themeData.theme || 'auto');
            continue;
        }
        const entry = schema.find(s => s.key === key);
        if (!entry) continue;
        const v = (themeData[key] !== undefined) ? themeData[key] : null;
        setControlValue(entry, v);
        const row = form.querySelector(`.row[data-key="${key}"]`);
        if (row) updateResetState(row, entry);
    }
    applyOwnTheme();
}

// True if the current form state differs from the most recently applied
// custom theme's snapshot. Drives the asterisk on the picker.
function formDivergesFromSnapshot() {
    if (!appliedSnapshot) return false;
    const current = snapshotCurrentTheme();
    const keys = new Set([...Object.keys(appliedSnapshot), ...Object.keys(current)]);
    for (const k of keys) {
        const a = appliedSnapshot[k];
        const b = current[k];
        if (String(a == null ? '' : a) !== String(b == null ? '' : b)) return true;
    }
    return false;
}

// Rebuild the preset picker's <option>/<optgroup> children so a new
// custom themes list shows up. Preserves prior selection where possible;
// syncPresetPicker will reconcile.
function refreshPresetPicker() {
    const sel = document.getElementById('preset-picker');
    if (!sel) return;
    const prev = sel.value;
    buildPresetOptions(sel);
    if (prev) sel.value = prev;
    if (!sel.value) sel.value = 'Default Auto';
}

function renderForm() {
    form.innerHTML = '';

    // Track the current section so each row can be tagged with it via
    // data-section. CSS uses that to override grid-template-columns per
    // section (e.g. Document handling gets a wider label column because
    // its labels are longer than every other section's).
    let currentSection = null;

    for (const entry of schema) {
        if (entry.section) {
            currentSection = entry.section.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            const h = document.createElement('div');
            h.className = 'section-head';
            h.textContent = entry.section;
            form.appendChild(h);

            // Inject the preset picker as the first row of the Theme &
            // presets section so it sits at the top of the dialog. Save /
            // delete actions for custom themes and palettes live in the
            // footer "Themes ▾" menu (see settings.html + boot wire-up).
            if (entry.section === 'Theme & presets') {
                const presetRow = makePresetRow();
                form.appendChild(presetRow);
                // Help text + live colour preview rolled into one
                // paragraph. The inline syntax (bold, italic, strike,
                // code, highlight, sub, sup, link) renders through the
                // same .cm-md-rendered-block CSS Reading mode uses, so
                // each coloured element repaints live as the user
                // scrolls through palettes (applyOwnPalette updates the
                // CSS variables this block reads).
                const helpEl = document.createElement('div');
                helpEl.className = 'help cm-md-rendered-block preset-help';
                helpEl.innerHTML =
                    'Picking a preset palette changes only the colours; fonts, ' +
                    'sizes, and layout stay as they are. Use the Save… button to ' +
                    'save or delete your own palettes, styles, and themes. ' +
                    'Sample: Plain text, <strong>bold</strong>, <em>italic</em>, ' +
                    '<del>strikethrough</del>, <code>inline code</code>, ' +
                    '<mark>highlighted</mark> text, H<sub>2</sub>O and ' +
                    'E=mc<sup>2</sup>, and a link to ' +
                    '<a href="https://www.gpsoft.com.au" target="_blank" rel="noopener noreferrer">' +
                    'the GPSoftware site</a>.';
                presetRow.appendChild(helpEl);
            }
            continue;
        }
        const row = makeRow(entry);
        if (currentSection) row.dataset.section = currentSection;
        form.appendChild(row);
        if (entry.help) {
            const help = document.createElement('div');
            help.className = 'help';
            help.textContent = entry.help;
            row.appendChild(help);
        }
    }
    populateFromState();
    syncPresetPicker();
}

// Iterate EVERY preset-touched key. Keys present in `palette` get its
// value; keys absent get cleared (null). Without this, switching presets
// would leave stale values in fields the new preset doesn't define, and
// later presetMatches would fail to identify the saved palette on reopen.
function applyPreset(palette) {
    for (const key of PRESET_KEYS) {
        const v = (palette[key] !== undefined) ? palette[key] : null;
        if (key === 'theme') {
            setThemeValue(v ?? 'auto');
            continue;
        }
        const entry = schema.find(s => s.key === key);
        if (!entry) continue;
        setControlValue(entry, v);
        const row = form.querySelector(`.row[data-key="${key}"]`);
        if (row) updateResetState(row, entry);
    }
    applyOwnTheme();
}

// "Default <theme>" preset: clear every palette override back to the
// built-in default, with the theme set to the supplied value. Three
// callers: Default Auto / Default Light / Default Dark.
function applyDefault(theme) {
    for (const key of PRESET_KEYS) {
        if (key === 'theme') {
            setThemeValue(theme);
            continue;
        }
        const entry = schema.find(s => s.key === key);
        if (!entry) continue;
        setControlValue(entry, null);
        const row = form.querySelector(`.row[data-key="${key}"]`);
        if (row) updateResetState(row, entry);
    }
    applyOwnTheme();
}

// Reconcile the preset picker with the currently-loaded settings.
//
// If a custom theme is active, select its option (creating it ad hoc if
// the customThemes list hasn't arrived yet) and append a trailing ' *'
// to its label when the form has drifted from the loaded snapshot.
//
// Otherwise: pick whichever built-in preset's values match the form
// exactly, else "Default <theme>" when nothing's overridden. No
// "Custom" placeholder for never-saved-before states (existing decision).
function syncPresetPicker() {
    const sel = document.getElementById('preset-picker');
    if (!sel) return;

    // Reset every option's text to its base label so stale asterisks from
    // a previous sync don't carry over.
    for (const opt of sel.querySelectorAll('option')) {
        if (opt.value.startsWith('custom:')) {
            opt.textContent = opt.value.substring(7);
        } else if (opt.value === 'Default Auto') {
            opt.textContent = 'Default Auto (follows DOpus theme)';
        } else {
            opt.textContent = opt.value;
        }
    }

    // Helper: append " *" to the option matching `value` to flag drift
    // from what that selection represents.
    const markDrift = (value) => {
        const opt = sel.querySelector(`option[value="${CSS.escape(value)}"]`);
        if (opt) opt.textContent = opt.textContent + ' *';
    };

    if (currentCustomTheme) {
        let optValue = 'custom:' + currentCustomTheme;
        let opt = sel.querySelector(`option[value="${CSS.escape(optValue)}"]`);
        if (!opt) {
            // customThemes list hasn't arrived yet — inject a placeholder
            // option so the picker can still display the active name.
            opt = document.createElement('option');
            opt.value = optValue;
            opt.textContent = currentCustomTheme;
            sel.appendChild(opt);
        }
        sel.value = optValue;
        if (formDivergesFromSnapshot()) markDrift(optValue);
        updateThemeActionsVisibility();
        return;
    }

    // Built-in palette tracked by name (set by the picker change handler
    // and persisted as `activePalette` in settings.json). When set, show
    // that name back. NO defensive re-hydration from userSettings here:
    // the userSettings handler restores currentBuiltinPalette ONCE on
    // dialog open. Re-reading it on every sync would re-inject the stale
    // saved name even after the user has explicitly picked Default
    // Light/Dark/Auto (which clears currentBuiltinPalette to null) — the
    // bug that made the picker label "jump back" to the previous palette
    // immediately after picking Default.
    if (currentBuiltinPalette && palettes[currentBuiltinPalette]) {
        sel.value = currentBuiltinPalette;
        // Drift indicator: form values deviate from the palette's defs.
        if (!presetMatches(palettes[currentBuiltinPalette])) markDrift(currentBuiltinPalette);
        updateThemeActionsVisibility();
        return;
    }

    // No custom theme, no tracked built-in palette: show the Default
    // option matching the active light/dark theme. The drift indicator
    // fires whenever any colour override is set (Default has none by
    // design, so any colour value is a drift).
    const hasColourOverride = PRESET_KEYS.some(k => {
        if (k === 'theme') return false;
        const entry = schema.find(s => s.key === k);
        if (!entry) return false;
        return !isEmpty(getControlValue(entry));
    });

    const themeVal = getThemeValue();
    const defaultName = themeVal === 'dark'  ? 'Default Dark'
                      : themeVal === 'light' ? 'Default Light'
                      :                        'Default Auto';

    sel.value = defaultName;
    if (hasColourOverride) markDrift(defaultName);
    updateThemeActionsVisibility();
}

function presetMatches(palette) {
    for (const k of PRESET_KEYS) {
        let current, wanted;
        if (k === 'theme') {
            current = getThemeValue();
            wanted  = palette.theme ?? 'auto';
        } else {
            const entry = schema.find(s => s.key === k);
            if (!entry) continue;
            current = getControlValue(entry);
            wanted  = palette[k];
        }
        const curNorm  = isEmpty(current) ? null : String(current).toLowerCase();
        const wantNorm = isEmpty(wanted)  ? null : String(wanted).toLowerCase();
        if (curNorm !== wantNorm) return false;
    }
    return true;
}

function populateFromState() {
    for (const entry of schema) {
        if (entry.section) continue;
        setControlValue(entry, effectiveValue(entry.key));
        const row = form.querySelector(`.row[data-key="${entry.key}"]`);
        if (row) updateResetState(row, entry);
    }
    applyOwnTheme();
}

// The settings dialog renders itself in the same light/dark palette as
// the DOpus viewer pane (NOT the Windows OS theme). Native pushes the
// most-recently-seen pane bg via a 'paneTheme' message right after the
// userSettings response; 'auto' resolves against that. Explicit 'light'
// / 'dark' override regardless. Falls back to light only if no pane has
// ever been opened (g_lastViewerBg defaults to COLOR_WINDOW on the
// native side, which the luminance check classifies as light anyway).
function resolveTheme() {
    const t = getThemeValue();
    if (t === 'dark')  return 'dark';
    if (t === 'light') return 'light';
    return panePaletteMode === 'dark' ? 'dark' : 'light';
}

// Map of settings keys -> CSS variables, kept in sync with viewer.js
// settingsCssMap. The settings dialog applies the same overrides as the
// viewer so the form chrome (background, text, borders, accent) matches
// the active custom palette instead of staying on the bundled defaults.
const settingsCssMap = {
    textColor:             '--ink-override',
    pageColor:             '--page-override',
    accentColor:           '--accent-override',
    codeBg:                '--code-override',
    linkColor:             '--link-override',
    ruleColor:             '--rule-override',
    fontFamily:            '--font-prose-override',
    proseFontWeight:       '--font-weight-prose-override',
    fontSize:              '--font-size-override',
    lineHeight:            '--line-height-override',
};
const settingsPxKeys = new Set(['fontSize']);

function applyOwnPalette() {
    const root = document.documentElement.style;
    // Source of truth: the CURRENT FORM VALUES, not userSettings. Lets
    // the dialog chrome update LIVE as the user picks a different
    // palette or edits an individual colour - no need to click Apply
    // and reopen to see the change reflected in the dialog itself.
    //
    // For un-overridden fields getControlValue returns null/empty, which
    // clears the override variable so the theme CSS naturally takes
    // over.
    for (const [k, varName] of Object.entries(settingsCssMap)) {
        const entry = schema.find(s => s.key === k);
        const v = entry ? getControlValue(entry) : effectiveValue(k);
        if (v === undefined || v === null || v === '') {
            root.removeProperty(varName);
            continue;
        }
        let out = v;
        if (settingsPxKeys.has(k)) {
            if (typeof v === 'number') out = `${v}px`;
            else if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) out = `${v.trim()}px`;
        }
        root.setProperty(varName, out);
    }
}

function applyOwnTheme() {
    document.body.className = 'theme-' + resolveTheme();
    if (panePaneBg) {
        document.documentElement.style.setProperty('--pane-bg', panePaneBg);
    }
    applyOwnPalette();
}

// ---------------------------------------------------------------------------
// Save / apply

function collectForSave() {
    // Produce a JSON object containing ONLY keys whose form value differs
    // from the bundled default. Empty fields = 'use theme default' and
    // are NOT written to settings.json, so the value stays adaptive across
    // theme switches.
    const out = { _comment_: 'Generated by mdWorX Settings. Hand-edit at your own risk.' };

    if (!isEmpty(userSettings.theme) && userSettings.theme !== 'auto') {
        out.theme = userSettings.theme;
    }

    for (const entry of schema) {
        if (entry.section) continue;
        const cur = getControlValue(entry);
        const def = defaultSettings[entry.key];
        if (entry.type === 'select') {
            const defVal = def ?? entry.options[0];
            if (cur !== defVal) out[entry.key] = cur;
        } else if (entry.type === 'check') {
            if (cur !== (def === true)) out[entry.key] = cur;
        } else {
            if (!isEmpty(cur)) out[entry.key] = cur;
        }
    }

    if (currentCustomTheme) {
        out.activeCustomTheme = currentCustomTheme;
    }
    // Persist the selected built-in palette name so the next dialog
    // open can restore the picker selection without any matching
    // heuristic. Only when no custom theme is active (custom themes
    // take priority).
    if (!currentCustomTheme && currentBuiltinPalette) {
        out.activePalette = currentBuiltinPalette;
    }

    return out;
}

function apply() {
    const payload = collectForSave();
    setStatus('Saving...', '');
    send({ type: 'saveSettings', json: JSON.stringify(payload, null, 2) });
}

// ---------------------------------------------------------------------------
// Bridge

function onHostMessage(event) {
    let m = event.data;
    if (typeof m === 'string') {
        try { m = JSON.parse(m); } catch { return; }
    }
    if (!m || !m.type) return;

    switch (m.type) {
        case 'userSettings':
            try {
                userSettings = m.json && m.json.trim() ? JSON.parse(m.json) : {};
                delete userSettings._comment_;
            } catch (err) {
                console.warn('[settings] user JSON parse failed:', err);
                userSettings = {};
                setStatus('Warning: your existing settings.json is malformed, defaults loaded', 'fail');
            }
            populateFromState();

            // Restore active custom theme name (if any) from persisted
            // settings, then ask native for its snapshot so the asterisk
            // indicator has something to compare against.
            if (typeof userSettings.activeCustomTheme === 'string' &&
                userSettings.activeCustomTheme) {
                currentCustomTheme = userSettings.activeCustomTheme;
                pendingLoadMode = 'compare';
                send({ type: 'loadCustomTheme', name: currentCustomTheme });
            } else {
                currentCustomTheme = null;
                appliedSnapshot = null;
            }

            // Restore the active BUILT-IN palette name. This is the
            // simple, robust mechanism the user asked for: instead of
            // syncPresetPicker auto-detecting which palette matches the
            // current form values, the picker just shows whichever
            // palette was selected last. Cleared if user picked a
            // Default Auto/Light/Dark or a custom theme.
            if (!currentCustomTheme && typeof userSettings.activePalette === 'string' &&
                userSettings.activePalette && palettes[userSettings.activePalette]) {
                currentBuiltinPalette = userSettings.activePalette;
            } else {
                currentBuiltinPalette = null;
            }

            // Always ask for the custom themes list so the picker can
            // surface 'Your themes'. Reply arrives async; syncPresetPicker
            // is called both here (without customs yet) and on reply.
            send({ type: 'listCustomThemes' });

            syncPresetPicker();
            updateThemeActionsVisibility();
            break;
        case 'paneTheme':
            // Native: {type:'paneTheme', mode:'dark'|'light', paneBg:'#rrggbb'}
            // Sets the resolution target for theme='auto'. Re-apply
            // immediately in case userSettings already arrived.
            panePaletteMode = (m.mode === 'dark') ? 'dark' : 'light';
            panePaneBg      = m.paneBg || null;
            applyOwnTheme();
            break;
        case 'fonts':
            // Native: {type:'fonts', list:[...installed font face names]}
            // Populate the shared datalist used by every font-type field.
            systemFonts = Array.isArray(m.list) ? m.list : [];
            populateFontsDatalist();
            break;
        case 'saveResult':
            if (m.ok) {
                setStatus('Applied. All open viewers reloaded.', 'ok');
                // userSettings.theme was already mutated directly by the
                // preset picker; collectForSave reads it from there, so
                // we don't need to clobber userSettings here. Re-apply
                // the dialog's own theme in case the user's tweaks
                // changed the preset match.
                applyOwnTheme();
                // Refresh asterisk: the form may have diverged from the
                // saved theme snapshot before this Apply ran.
                syncPresetPicker();
            } else {
                setStatus('Save failed — check that %APPDATA%\\HyperWorX\\mdWorX\\ is writable.', 'fail');
            }
            break;
        case 'customThemesList':
            customThemes = Array.isArray(m.names) ? m.names : [];
            refreshPresetPicker();
            syncPresetPicker();
            updateThemeActionsVisibility();
            break;
        case 'customTheme': {
            // Reply to loadCustomTheme. pendingLoadMode says whether to
            // apply the values to the form or just record the snapshot
            // for asterisk comparison.
            let themeData = {};
            try {
                themeData = m.json && m.json.trim() ? JSON.parse(m.json) : {};
            } catch (err) {
                setStatus(`Could not parse theme "${m.name}": ${err.message}`, 'fail');
                pendingLoadMode = null;
                break;
            }
            // Cache the kind so the picker can group this entry under
            // "Your palettes" / "Your styles" / "Your themes" without
            // a re-load.
            if (themeData._kind === 'palette' || themeData._kind === 'style' || themeData._kind === 'theme') {
                customEntryKinds.set(m.name, themeData._kind);
            }
            if (pendingLoadMode === 'apply') {
                applyCustomTheme(themeData);
                currentCustomTheme = m.name;
                appliedSnapshot = themeData;
                setStatus(`Loaded "${m.name}". Click Apply to save.`, '');
            } else {
                // 'compare' (or null fallback): keep current form values,
                // store snapshot for divergence detection.
                appliedSnapshot = themeData;
            }
            pendingLoadMode = null;
            syncPresetPicker();
            updateThemeActionsVisibility();
            break;
        }
        case 'customThemeSaved':
            setStatus(`Saved theme "${m.name}".`, 'ok');
            currentCustomTheme = m.name;
            appliedSnapshot = snapshotCurrentTheme();
            hideSaveAsInput();
            // Refresh list so the new name appears in the picker.
            send({ type: 'listCustomThemes' });
            // syncPresetPicker runs after the list reply; pre-sync now so
            // the picker reflects the save immediately if the option
            // already existed (overwrite case).
            syncPresetPicker();
            updateThemeActionsVisibility();
            break;
        case 'customThemeDeleted':
            setStatus(`Deleted theme "${m.name}".`, 'ok');
            if (currentCustomTheme === m.name) {
                currentCustomTheme = null;
                appliedSnapshot = null;
            }
            send({ type: 'listCustomThemes' });
            syncPresetPicker();
            updateThemeActionsVisibility();
            break;
        case 'customThemeError': {
            const op = m.op || 'operation';
            const name = m.name || '';
            const message = m.message || 'Unknown error.';
            setStatus(`Theme ${op} failed${name ? ` ("${name}")` : ''}: ${message}`, 'fail');
            pendingLoadMode = null;
            break;
        }
        default:
            // settings page ignores theme / load messages
            break;
    }
}

// ---------------------------------------------------------------------------
// Boot

// Build the <datalist> the font input fields reference via `list=`.
// Lives at the bottom of <body>. Replaced wholesale whenever native
// pushes a new 'fonts' message.
function populateFontsDatalist() {
    let dl = document.getElementById('system-fonts-datalist');
    if (!dl) {
        dl = document.createElement('datalist');
        dl.id = 'system-fonts-datalist';
        document.body.appendChild(dl);
    }
    dl.innerHTML = '';
    for (const name of systemFonts) {
        const opt = document.createElement('option');
        opt.value = name;
        dl.appendChild(opt);
    }
}

async function loadDefaults() {
    try {
        const res = await fetch('settings-defaults.json', { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        defaultSettings = await res.json();
        delete defaultSettings._comment_;
    } catch (err) {
        console.warn('[settings] defaults load failed:', err);
        defaultSettings = {};
        setStatus('Could not load defaults — install may be incomplete', 'fail');
    }
}

async function boot() {
    await loadDefaults();
    renderForm();

    document.getElementById('btn-apply').addEventListener('click', apply);
    document.getElementById('btn-close').addEventListener('click', () => {
        send({ type: 'closeSettings' });
    });
    // Footer "Themes ▾" menu: trigger button + popup + click-outside-to-
    // close. Menu items dispatch by data-action: save-theme | save-palette
    // | delete. The name-entry that appears after Save-as is wired below.
    const menuBtn  = document.getElementById('btn-themes-menu');
    const menuEl   = document.getElementById('themes-menu');
    function openMenu() {
        if (!menuEl || !menuBtn) return;
        menuEl.hidden = false;
        menuBtn.setAttribute('aria-expanded', 'true');
        updateThemeActionsVisibility();
    }
    function closeMenu() {
        if (!menuEl || !menuBtn) return;
        menuEl.hidden = true;
        menuBtn.setAttribute('aria-expanded', 'false');
    }
    if (menuBtn) menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (menuEl && menuEl.hidden) openMenu(); else closeMenu();
    });
    if (menuEl) menuEl.addEventListener('click', (e) => {
        const item = e.target.closest('.menu-item');
        if (!item || item.disabled) return;
        const action = item.dataset.action;
        closeMenu();
        if (action === 'save-palette')      revealSaveAsInput('palette');
        else if (action === 'save-style')   revealSaveAsInput('style');
        else if (action === 'save-theme')   revealSaveAsInput('theme');
        else if (action === 'delete')       deleteCurrentCustomTheme();
    });
    // Click outside the menu closes it. Captured on document, but the
    // menu itself stops propagation on its own clicks above.
    document.addEventListener('click', (e) => {
        if (!menuEl || menuEl.hidden) return;
        if (menuBtn && menuBtn.contains(e.target)) return;
        if (menuEl.contains(e.target)) return;
        closeMenu();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && menuEl && !menuEl.hidden) {
            e.preventDefault();
            closeMenu();
            if (menuBtn) menuBtn.focus();
        }
    });

    // Inline name-entry (revealed after Save-as-theme / Save-as-palette).
    const saveConfirmBtn = document.getElementById('btn-save-theme-confirm');
    if (saveConfirmBtn) saveConfirmBtn.addEventListener('click', submitSaveAsInput);
    const saveCancelBtn = document.getElementById('btn-save-theme-cancel');
    if (saveCancelBtn) saveCancelBtn.addEventListener('click', hideSaveAsInput);
    const saveNameInput = document.getElementById('save-theme-name');
    if (saveNameInput) saveNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')       { e.preventDefault(); submitSaveAsInput(); }
        else if (e.key === 'Escape') { e.preventDefault(); hideSaveAsInput(); }
    });
    document.getElementById('btn-reset').addEventListener('click', () => {
        for (const entry of schema) {
            if (entry.section) continue;
            setControlValue(entry, null);
            const row = form.querySelector(`.row[data-key="${entry.key}"]`);
            if (row) updateResetState(row, entry);
        }
        // Theme isn't in the schema — clear via the dedicated helper.
        setThemeValue('auto');
        // Reset also drops the custom-theme association: the form no
        // longer matches any saved snapshot, so picker should fall back
        // to Default rather than show an asterisk-marked stale name.
        currentCustomTheme = null;
        appliedSnapshot = null;
        // Re-theme the dialog AND snap the preset picker back to
        // "Default Auto" so the dropdown reflects the cleared state.
        applyOwnTheme();
        syncPresetPicker();
        updateThemeActionsVisibility();
        setStatus('All fields cleared. Click Apply to save, or Close to discard.', '');
    });

    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.addEventListener('message', onHostMessage);
        send({ type: 'settingsReady' });
    } else {
        console.warn('[settings] no chrome.webview — standalone preview only');
    }
}

boot();
