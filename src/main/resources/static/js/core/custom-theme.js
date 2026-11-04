/**
 * Custom themes: a look of your own, built in Settings → Appearance and kept in this browser.
 * A custom theme starts from one of the built-in themes (its base: Classic, Breeze, Pearl or Ocean, whose sheets and
 * markup it keeps) and overrides it with the options below (colours, type, sizes, panels, buttons, tables, open rows,
 * icons, menu, motion), compiled into one stylesheet that goes after every other one.
 *
 * Stored as preferences (core/prefs.js):
 *   customThemes  { themes: [{ id, name, base, opts, updatedAt }] }
 *   customCss     { id, base, css }: the applied theme, compiled, so index.html can put it on before the first paint
 *   look.theme    'custom:<id>' while one is applied (js/core/theme.js)
 */
import { getPref, setPref } from './prefs.js';

export const CUSTOM_PREFIX = 'custom:';
export const BASES = [
    { id: 'classic', label: 'Classic', hint: 'The original look' },
    { id: 'breeze', label: 'Breeze', hint: 'Rich open rows, labelled actions, live motion' },
    { id: 'pearl', label: 'Pearl', hint: 'Breeze, compact, glossy, banking' },
    { id: 'ocean', label: 'Ocean', hint: 'Tiles on glossy ocean' },
];

const FONTS = {
    system: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    segoe: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
    inter: 'Inter, "Segoe UI", system-ui, sans-serif',
    roboto: 'Roboto, "Segoe UI", system-ui, sans-serif',
    helvetica: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    verdana: 'Verdana, Geneva, sans-serif',
    trebuchet: '"Trebuchet MS", "Segoe UI", sans-serif',
    georgia: 'Georgia, "Times New Roman", serif',
    mono: 'Consolas, "SF Mono", Menlo, monospace',
};

/**
 * Every option, in the groups the editor shows: { key, label, type (color | range | choice | toggle), default, ... }.
 * choice: options [[value, label]]; range: min, max, step, unit.
 */
export const GROUPS = [
    { id: 'colors', label: 'Colours', iconName: 'droplet', hint: 'Brand, frame and text', options: [
        { key: 'primary', label: 'Brand colour', type: 'color', default: '#0b6aa6', hint: 'Buttons, links, icons, selection' },
        { key: 'accent', label: 'Accent', type: 'color', default: '#13a89a', hint: 'Highlights and accent lines' },
        { key: 'topbar', label: 'Top bar', type: 'color', default: '#143f62' },
        { key: 'header', label: 'Header band', type: 'color', default: '#1a4a6e', hint: 'Table headers and dark heads' },
        { key: 'pageBg', label: 'Page background', type: 'color', default: '#e6edf3' },
        { key: 'panelBg', label: 'Panel background', type: 'color', default: '#ffffff' },
        { key: 'text', label: 'Text', type: 'color', default: '#0d1f33' },
        { key: 'positive', label: 'Money in', type: 'color', default: '#0b7a3b' },
        { key: 'negative', label: 'Money out', type: 'color', default: '#c2363a' },
    ] },
    { id: 'type', label: 'Fonts', iconName: 'edit', hint: 'Family, size, weight', options: [
        { key: 'font', label: 'Font', type: 'choice', default: 'system', options: [['system', 'System'], ['segoe', 'Segoe UI'], ['inter', 'Inter'], ['roboto', 'Roboto'],
            ['helvetica', 'Helvetica'], ['verdana', 'Verdana'], ['trebuchet', 'Trebuchet'], ['georgia', 'Georgia'], ['mono', 'Mono']] },
        { key: 'fontSize', label: 'Text size', type: 'range', default: 12.5, min: 10, max: 15, step: 0.5, unit: 'px' },
        { key: 'weight', label: 'Emphasis', type: 'choice', default: 'bold', options: [['regular', 'No bold'], ['medium', 'Medium'], ['bold', 'Bold']] },
        { key: 'tracking', label: 'Letter spacing', type: 'range', default: 0, min: -0.02, max: 0.04, step: 0.01, unit: 'em' },
        { key: 'titleSize', label: 'Panel title size', type: 'range', default: 12.5, min: 10, max: 16, step: 0.5, unit: 'px' },
        { key: 'numbers', label: 'Amounts', type: 'choice', default: 'tabular', options: [['tabular', 'Aligned digits'], ['mono', 'Monospace'], ['plain', 'As the text']] },
        { key: 'caps', label: 'Small labels', type: 'choice', default: 'upper', options: [['upper', 'UPPER CASE'], ['normal', 'Normal case']] },
    ] },
    { id: 'sizes', label: 'Sizes & spacing', iconName: 'ruler', hint: 'Rows, gaps, controls, corners', options: [
        { key: 'gap', label: 'Space between panels', type: 'range', default: 10, min: 4, max: 18, step: 1, unit: 'px' },
        { key: 'controlHeight', label: 'Buttons & inputs height', type: 'range', default: 29, min: 22, max: 36, step: 1, unit: 'px' },
        { key: 'radius', label: 'Corner roundness', type: 'range', default: 12, min: 0, max: 18, step: 1, unit: 'px' },
    ] },
    { id: 'panels', label: 'Panels', iconName: 'layers', hint: 'Surface, shadow, title bar', options: [
        { key: 'panelStyle', label: 'Surface', type: 'choice', default: 'glass', options: [['glass', 'Glass'], ['glossy', 'Glossy'], ['flat', 'Flat'], ['outlined', 'Outlined']] },
        { key: 'shadow', label: 'Shadow', type: 'choice', default: 'soft', options: [['none', 'None'], ['soft', 'Soft'], ['strong', 'Strong']] },
        { key: 'panelHead', label: 'Title bar', type: 'choice', default: 'plain', options: [['plain', 'Plain'], ['tinted', 'Tinted'], ['band', 'Dark band']] },
        { key: 'panelHeadSize', label: 'Title bar height', type: 'range', default: 38, min: 26, max: 46, step: 1, unit: 'px' },
        { key: 'panelPadding', label: 'Inner padding', type: 'range', default: 12, min: 4, max: 18, step: 1, unit: 'px' },
        { key: 'borderWidth', label: 'Border', type: 'range', default: 1, min: 0, max: 3, step: 1, unit: 'px' },
        { key: 'titleLine', label: 'Brand line under the title', type: 'toggle', default: true },
    ] },
    { id: 'buttons', label: 'Buttons', iconName: 'check', hint: 'Shape and finish', options: [
        { key: 'buttonShape', label: 'Shape', type: 'choice', default: 'rounded', options: [['square', 'Square'], ['rounded', 'Rounded'], ['pill', 'Pill']] },
        { key: 'buttonStyle', label: 'Finish', type: 'choice', default: 'gradient', options: [['gradient', 'Glossy'], ['flat', 'Flat'], ['outline', 'Outline']] },
        { key: 'buttonCase', label: 'Label', type: 'choice', default: 'normal', options: [['normal', 'Normal'], ['upper', 'UPPER CASE']] },
        { key: 'inputStyle', label: 'Inputs', type: 'choice', default: 'outlined', options: [['outlined', 'Outlined'], ['filled', 'Filled'], ['underline', 'Underline']] },
        { key: 'focusRing', label: 'Focus ring', type: 'choice', default: 'soft', options: [['soft', 'Soft glow'], ['strong', 'Strong'], ['none', 'Outline only']] },
    ] },
    { id: 'tables', label: 'Tables', iconName: 'list', hint: 'Row height, headers, stripes', options: [
        { key: 'rowHeight', label: 'Row height', type: 'range', default: 30, min: 20, max: 48, step: 1, unit: 'px', hint: 'Every entry and expense line' },
        { key: 'headerHeight', label: 'Header height', type: 'range', default: 27, min: 20, max: 42, step: 1, unit: 'px' },
        { key: 'tableText', label: 'Row text size', type: 'range', default: 0, min: -2, max: 2, step: 0.5, unit: 'px', hint: 'Against the text size' },
        { key: 'headerStyle', label: 'Column header', type: 'choice', default: 'band', options: [['light', 'Light'], ['tinted', 'Tinted'], ['band', 'Dark band']] },
        { key: 'headerLine', label: 'Accent line under the header', type: 'toggle', default: true },
        { key: 'zebra', label: 'Striped rows', type: 'toggle', default: false },
        { key: 'rowLines', label: 'Lines between rows', type: 'toggle', default: true },
        { key: 'rowHover', label: 'Highlight the row under the pointer', type: 'toggle', default: true },
        { key: 'selectColor', label: 'Selected row', type: 'color', default: '#dbeaf6' },
    ] },
    { id: 'lists', label: 'Lists & cards', iconName: 'grid', hint: 'Account, chit and budget lists, figure chips', options: [
        { key: 'listStyle', label: 'List items', type: 'choice', default: 'card', options: [['card', 'Cards'], ['flat', 'Flat'], ['lines', 'Lines']] },
        { key: 'listGap', label: 'Space between items', type: 'range', default: 4, min: 0, max: 10, step: 1, unit: 'px' },
        { key: 'listPadding', label: 'Item padding', type: 'range', default: 7, min: 2, max: 12, step: 1, unit: 'px' },
        { key: 'selectedStyle', label: 'Selected item', type: 'choice', default: 'edge', options: [['edge', 'Accent edge'], ['filled', 'Filled dark'], ['outline', 'Outline']] },
        { key: 'chipStyle', label: 'Figure chips', type: 'choice', default: 'card', options: [['card', 'Cards'], ['plain', 'Plain'], ['edge', 'Accent edge']] },
        { key: 'chipValue', label: 'Figure size', type: 'range', default: 14, min: 11, max: 20, step: 0.5, unit: 'px' },
        { key: 'badgeShape', label: 'Badges & tags', type: 'choice', default: 'pill', options: [['pill', 'Pill'], ['rounded', 'Rounded'], ['square', 'Square']] },
    ] },
    { id: 'open', label: 'Expanded rows', iconName: 'eye', hint: 'An opened expense, entry or item', options: [
        { key: 'expandedStyle', label: 'Style', type: 'choice', default: 'card', options: [['plain', 'Plain'], ['card', 'Card'], ['statement', 'Statement (dark head)']] },
        { key: 'expandedWash', label: 'Background behind it', type: 'color', default: '#e8f0f7' },
        { key: 'boxTint', label: 'Tinted figure boxes', type: 'toggle', default: true },
    ] },
    { id: 'icons', label: 'Icons', iconName: 'sparkles', hint: 'Size and style', options: [
        { key: 'iconScale', label: 'Icon size', type: 'range', default: 1, min: 0.7, max: 1.3, step: 0.05, unit: '×' },
        { key: 'iconStyle', label: 'Icon tiles', type: 'choice', default: 'soft', options: [['soft', 'Soft'], ['solid', 'Solid'], ['outline', 'Outline']] },
    ] },
    { id: 'frame', label: 'Menu & motion', iconName: 'settings', hint: 'Top menu, animation', options: [
        { key: 'menuStyle', label: 'Menu item', type: 'choice', default: 'pill', options: [['pill', 'Pill'], ['tab', 'Tab with underline'], ['underline', 'Underline only']] },
        { key: 'topbarHeight', label: 'Top bar height', type: 'range', default: 50, min: 40, max: 60, step: 1, unit: 'px' },
        { key: 'menuSize', label: 'Menu text size', type: 'range', default: 12.5, min: 10, max: 15, step: 0.5, unit: 'px' },
        { key: 'menuIcons', label: 'Icons in the menu', type: 'toggle', default: true },
        { key: 'contentWidth', label: 'Page width', type: 'choice', default: 'full', options: [['full', 'Full window'], ['1800', 'Up to 1800px'], ['1500', 'Up to 1500px']] },
        { key: 'scrollbar', label: 'Scrollbars', type: 'choice', default: 'thin', options: [['thin', 'Thin'], ['normal', 'Normal'], ['hidden', 'Hidden until hover']] },
        { key: 'motion', label: 'Animations', type: 'toggle', default: true },
    ] },
];

const OPTIONS = GROUPS.flatMap(g => g.options);
export const defaultOptions = () => Object.fromEntries(OPTIONS.map(o => [o.key, o.default]));

/** Ready-made starting points: a base and the options that differ from the defaults. */
export const PRESETS = [
    { id: 'ocean-glass', name: 'Ocean glass', base: 'breeze', opts: {} },
    { id: 'banking', name: 'Banking navy', base: 'pearl', opts: { primary: '#1f4fa3', accent: '#c8102e', topbar: '#012169', header: '#012169', pageBg: '#eef1f5',
        panelStyle: 'glossy', panelHead: 'plain', buttonShape: 'rounded', rowHeight: 24, headerHeight: 23, fontSize: 11.5, weight: 'regular', menuStyle: 'tab',
        expandedStyle: 'statement', expandedWash: '#e9eef6', iconScale: 0.85, radius: 8, panelHeadSize: 30, controlHeight: 26, gap: 8, panelPadding: 10 } },
    { id: 'emerald', name: 'Emerald', base: 'breeze', opts: { primary: '#0f7a5c', accent: '#d4a72c', topbar: '#0b3d2e', header: '#0f5a45', pageBg: '#e9f2ee',
        expandedWash: '#e6f2ec', menuStyle: 'pill' } },
    { id: 'plum', name: 'Plum', base: 'breeze', opts: { primary: '#6a3fb5', accent: '#e0567a', topbar: '#2c1a4d', header: '#3e2570', pageBg: '#f0edf6',
        expandedWash: '#efeaf7', buttonShape: 'pill' } },
    { id: 'graphite', name: 'Graphite', base: 'pearl', opts: { primary: '#3d5a80', accent: '#ee6c4d', topbar: '#1f2933', header: '#2b3640', pageBg: '#eceff2',
        panelStyle: 'flat', shadow: 'none', panelHead: 'tinted', buttonStyle: 'flat', headerLine: false, rowHeight: 26, headerHeight: 24, weight: 'medium', radius: 6, listStyle: 'lines', chipStyle: 'edge' } },
    { id: 'sunrise', name: 'Sunrise', base: 'breeze', opts: { primary: '#c2571a', accent: '#1b8a8f', topbar: '#5a2a0c', header: '#7a3a12', pageBg: '#f6efe8',
        expandedWash: '#f7ece2', panelStyle: 'glossy' } },
    { id: 'clean', name: 'Clean & light', base: 'classic', opts: { primary: '#2563eb', accent: '#14b8a6', topbar: '#1e293b', header: '#e8eef8', pageBg: '#f5f7fa',
        panelStyle: 'outlined', shadow: 'none', headerStyle: 'light', buttonStyle: 'outline', expandedStyle: 'plain', iconStyle: 'outline', menuStyle: 'underline', radius: 6 } },
];

// ===================================================================== storage

const store = () => getPref('customThemes', { themes: [] });
export const customThemes = () => (Array.isArray(store().themes) ? store().themes : []);
export const customTheme = id => customThemes().find(t => t.id === id) || null;
export const isCustomId = id => typeof id === 'string' && id.startsWith(CUSTOM_PREFIX);

/** Saves (adds or replaces) a theme; returns it as saved. */
export function saveCustomTheme(theme) {
    const saved = { ...theme, id: theme.id || `t${Date.now().toString(36)}`, opts: { ...defaultOptions(), ...theme.opts }, updatedAt: new Date().toISOString() };
    const themes = customThemes().filter(t => t.id !== saved.id);
    setPref('customThemes', { themes: [...themes, saved] });
    if (getPref('customCss', {}).id === saved.id) rememberApplied(saved);   // the applied one stays in step
    return saved;
}

export function deleteCustomTheme(id) {
    setPref('customThemes', { themes: customThemes().filter(t => t.id !== id) });
}

/** Keeps the compiled sheet of the applied theme for the first paint (index.html). */
export function rememberApplied(theme) {
    setPref('customCss', theme ? { id: theme.id, base: theme.base, css: compileTheme(theme) } : {});
}

// ===================================================================== applying (live, without a reload)

/** Turns the base theme's sheets on (as index.html does) and puts the custom sheet after them; null css removes it. */
export function applyLive(base, css) {
    const root = document.documentElement;
    root.dataset.theme = base;
    const sheet = id => document.getElementById(id);
    if (sheet('theme-ocean')) sheet('theme-ocean').disabled = base !== 'ocean';
    if (sheet('theme-breeze')) sheet('theme-breeze').disabled = base !== 'breeze' && base !== 'pearl';
    if (sheet('theme-pearl')) sheet('theme-pearl').disabled = base !== 'pearl';
    let style = document.getElementById('custom-theme');
    if (css == null) { style?.remove(); return; }
    if (!style) {
        style = document.createElement('style');
        style.id = 'custom-theme';
    }
    document.head.appendChild(style);   // always last
    style.textContent = css;
}

// ===================================================================== compiling

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function rgb(hex) {
    const h = String(hex || '#000000').replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, '0').slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const hex = ([r, g, b]) => `#${[r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
/** Mixes a colour toward white (amount > 0) or black (amount < 0). */
const shade = (c, amount) => {
    const [r, g, b] = rgb(c);
    const t = amount < 0 ? 0 : 255, p = Math.abs(amount);
    return hex([r + (t - r) * p, g + (t - g) * p, b + (t - b) * p]);
};
const rgba = (c, a) => `rgba(${rgb(c).join(', ')}, ${a})`;
/** Light text on a dark colour, dark text on a light one. */
const inkOn = c => { const [r, g, b] = rgb(c); return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#13212f' : '#ffffff'; };
const px = v => `${Math.round(v * 100) / 100}px`;

/** The stylesheet for a theme's options. */
export function compileTheme(theme) {
    const o = { ...defaultOptions(), ...(theme?.opts || {}) };
    const P = o.primary, A = o.accent, H = o.header, T = o.text;
    const deep = shade(P, -0.45), deeper = shade(P, -0.65);
    const s = Number(o.iconScale) || 1;
    const fs = Number(o.fontSize);
    if (theme?.opts && theme.opts.rowHeight == null && theme.opts.density) {   // a theme saved before the row-height sliders
        o.rowHeight = { compact: 24, normal: 30, comfortable: 36 }[theme.opts.density] || 30;
        o.headerHeight = { compact: 23, normal: 27, comfortable: 31 }[theme.opts.density] || 27;
    }
    const rowH = Number(o.rowHeight), thHeight = Number(o.headerHeight);
    const rowPad = Math.max(1, Math.floor((rowH - 18) / 2)), thPad = Math.max(1, Math.floor((thHeight - 15) / 2));
    const r = Number(o.radius);
    const btnRadius = o.buttonShape === 'pill' ? '999px' : o.buttonShape === 'square' ? '2px' : px(Math.max(4, r * 0.6));
    const headInk = inkOn(H);
    const shadow = { none: 'none', soft: `0 1px 2px ${rgba(deep, 0.06)}, 0 6px 18px ${rgba(deep, 0.08)}`,
        strong: `0 2px 4px ${rgba(deep, 0.1)}, 0 12px 30px ${rgba(deep, 0.16)}` }[o.shadow];
    const css = [];
    const add = (...lines) => css.push(...lines);

    add(`/* custom theme: ${String(theme?.name || 'Untitled').replace(/\*\//g, '')} (base ${theme?.base || 'classic'}) */`,
        ':root {',
        `  --font: ${FONTS[o.font] || FONTS.system};`,
        `  --font-size: ${px(fs)}; --font-size-sm: ${px(fs - 1)}; --font-size-xs: ${px(fs - 2)};`,
        `  --gap: ${px(o.gap)}; --gap-sm: ${px(Math.round(o.gap * 0.6))}; --control-height: ${px(o.controlHeight)}; --topbar-height: ${px(o.topbarHeight)};`,
        `  --radius-xs: ${px(Math.max(0, r - 6))}; --radius-sm: ${px(Math.max(0, r - 4))}; --radius: ${px(r)}; --radius-lg: ${px(r + 2)};`,
        `  --ocean-950: ${shade(P, -0.7)}; --ocean-900: ${deeper}; --ocean-800: ${deep}; --ocean-700: ${shade(P, -0.22)}; --ocean-600: ${P};`,
        `  --ocean-500: ${shade(P, 0.15)}; --ocean-400: ${shade(P, 0.35)}; --ocean-300: ${shade(P, 0.55)};`,
        `  --glacier-200: ${shade(P, 0.8)}; --glacier-100: ${shade(P, 0.9)}; --glacier-50: ${shade(P, 0.95)};`,
        `  --aqua-500: ${A}; --aqua-100: ${shade(A, 0.85)}; --brand-accent: ${A}; --link: ${P}; --info: ${P};`,
        `  --page-bg: linear-gradient(180deg, ${shade(o.pageBg, 0.25)} 0%, ${o.pageBg} 100%);`,
        `  --surface: ${o.panelStyle === 'glass' ? rgba(o.panelBg, 0.78) : o.panelBg}; --surface-solid: ${o.panelBg}; --surface-sunken: ${shade(P, 0.93)};`,
        `  --surface-hover: ${rgba(P, 0.06)}; --surface-selected: ${rgba(P, 0.12)};`,
        `  --hairline: ${rgba(deep, 0.12)}; --hairline-strong: ${rgba(deep, 0.22)}; --glass-border: ${o.panelStyle === 'glass' ? 'rgba(255, 255, 255, 0.85)' : rgba(deep, 0.14)};`,
        `  --text-primary: ${T}; --text-secondary: ${shade(T, 0.3)}; --text-muted: ${shade(T, 0.5)};`,
        `  --positive: ${o.positive}; --negative: ${o.negative};`,
        `  --grad-ocean: linear-gradient(100deg, ${shade(o.topbar, -0.25)} 0%, ${o.topbar} 50%, ${shade(o.topbar, 0.12)} 100%);`,
        `  --grad-navy: linear-gradient(135deg, ${shade(H, -0.25)} 0%, ${H} 60%, ${shade(H, 0.14)} 100%);`,
        `  --grad-brand: linear-gradient(135deg, ${shade(P, -0.15)} 0%, ${P} 50%, ${A} 100%);`,
        `  --grad-brand-soft: linear-gradient(135deg, ${rgba(P, 0.1)}, ${rgba(A, 0.1)});`,
        `  --grad-button: linear-gradient(180deg, ${shade(P, 0.15)}, ${shade(P, -0.08)});`,
        `  --shadow: ${shadow === 'none' ? 'none' : shadow}; --shadow-sm: ${o.shadow === 'none' ? 'none' : `0 1px 2px ${rgba(deep, 0.06)}, 0 2px 8px ${rgba(deep, 0.05)}`};`,
        `  --bz-ocean: ${P}; --bz-ocean-tint: ${rgba(P, 0.08)}; --bz-ocean-line: ${rgba(P, 0.24)}; --bz-aqua: ${shade(A, -0.15)};`,
        `  --bz-value: ${deeper}; --bz-wash: ${o.expandedWash};`,
        `  --bz-th-bg: linear-gradient(180deg, ${shade(H, 0.1)}, ${H}); --bz-th-ink: ${headInk}; --bz-th-rule: ${o.headerLine ? A : shade(H, -0.3)};`,
        `  --pl-navy: ${deeper}; --pl-blue: ${P}; --pl-red: ${A};`,
        '}',
        `body { letter-spacing: ${o.tracking}em; }`);

    // ---- type: emphasis
    if (o.weight === 'regular') add('*, *::before, *::after { font-weight: 400 !important; }',
        ':is(b, strong, th, h1, h2, h3, h4, .title, .strong, .btn, .tab.active, .seg-chip.active, .badge, .mono) { font-weight: 500 !important; }');
    else add(`:is(b, strong, th, h1, h2, h3, h4, .title, .strong) { font-weight: ${o.weight === 'medium' ? 600 : 700} !important; }`,
        `:is(.btn, .tab.active, .seg-chip.active) { font-weight: ${o.weight === 'medium' ? 550 : 600} !important; }`);

    // ---- frame: top bar and menu
    add(`.topbar { background: var(--grad-ocean); color: ${inkOn(o.topbar)}; }`,
        `.topbar::after { height: 2px; opacity: 1; background: linear-gradient(90deg, transparent, ${A} 20%, ${shade(A, 0.3)} 50%, ${A} 80%, transparent); }`,
        `.menu a { color: ${rgba(inkOn(o.topbar), 0.86)}; }`,
        `.menu a svg { width: ${px(15 * s)}; height: ${px(15 * s)}; }`);
    if (o.menuStyle === 'tab') add(`.menu a { border-radius: ${px(Math.max(4, r * 0.5))}; }`,
        `.menu a.active { background: #ffffff; color: ${deeper}; box-shadow: inset 0 -2px 0 ${A}, 0 1px 4px rgba(0, 0, 0, 0.2); }`);
    else if (o.menuStyle === 'underline') add('.menu a { border-radius: 0; height: 100%; }',
        `.menu a.active { background: transparent; color: ${inkOn(o.topbar)}; box-shadow: inset 0 -3px 0 ${A}; }`);
    else add(`.menu a.active { background: linear-gradient(180deg, #ffffff, ${shade(P, 0.9)}); color: ${shade(P, -0.2)}; }`);

    // ---- panels
    add(`.panel { border-radius: var(--radius-lg); box-shadow: ${shadow}; }`,
        `.panel-head { min-height: ${px(o.panelHeadSize)}; padding: ${px(Math.max(2, (o.panelHeadSize - 26) / 2))} ${px(o.panelPadding - 2)} ${px(Math.max(2, (o.panelHeadSize - 28) / 2))} ${px(o.panelPadding)}; }`,
        `.panel-head::after { left: ${px(o.panelPadding)}; right: ${px(o.panelPadding)}; background: linear-gradient(90deg, ${rgba(P, 0.4)}, ${rgba(A, 0.25)} 40%, transparent); }`,
        `.panel-body { padding: ${px(Math.round(o.panelPadding * 0.5))} ${px(o.panelPadding)} ${px(Math.round(o.panelPadding * 0.8))}; }`,
        `.panel-head h3 { color: ${deeper}; }`,
        `.panel-head h3 .ico { background: var(--grad-brand); width: ${px(22 * s)}; height: ${px(22 * s)}; }`,
        `.panel-head h3 .ico svg { width: ${px(13 * s)}; height: ${px(13 * s)}; }`);
    if (o.panelStyle === 'glossy') add(`.panel { background: linear-gradient(180deg, ${o.panelBg}, ${shade(P, 0.94)}); backdrop-filter: none; -webkit-backdrop-filter: none; border-color: ${rgba(deep, 0.12)}; }`,
        '.panel::before { height: 22px; background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0)); }');
    if (o.panelStyle === 'flat') add(`.panel { background: ${o.panelBg}; backdrop-filter: none; -webkit-backdrop-filter: none; border-color: ${rgba(deep, 0.1)}; }`, '.panel::before { display: none; }');
    if (o.panelStyle === 'outlined') add(`.panel { background: ${o.panelBg}; backdrop-filter: none; -webkit-backdrop-filter: none; border: 1px solid ${rgba(deep, 0.24)}; }`, '.panel::before { display: none; }');
    if (o.panelHead === 'tinted') add(`.panel-head { background: linear-gradient(180deg, ${shade(P, 0.9)}, ${shade(P, 0.95)}); }`);
    if (o.panelHead === 'band') add(`.panel-head { background: var(--grad-navy); }`, `.panel-head::after { background: ${A}; left: 0; right: 0; height: 2px; }`,
        `.panel-head h3, .panel-head h3 * { color: ${headInk}; }`, `.panel-head .sub, .panel-head .muted { color: ${rgba(headInk, 0.72)}; }`,
        `.panel-head h3 .ico { background: ${rgba(headInk, 0.16)}; box-shadow: none; }`);

    // ---- buttons
    add(`.btn { border-radius: ${btnRadius}; }`, `.btn.icon { border-radius: ${o.buttonShape === 'pill' ? '50%' : btnRadius}; }`,
        `.btn { color: ${deep}; }`, `.btn.primary { background: var(--grad-button); border-color: ${shade(P, -0.2)}; color: ${inkOn(P)}; box-shadow: 0 1px 3px ${rgba(P, 0.35)}; }`,
        `.btn svg { width: ${px(14 * s)}; height: ${px(14 * s)}; }`, `.btn.sm svg { width: ${px(13 * s)}; height: ${px(13 * s)}; }`,
        `.btn.sm { height: ${px(Math.max(20, o.controlHeight - 5))}; }`,
        `.seg-chip.active { background: var(--grad-navy); color: ${headInk}; }`,
        `input:focus, select:focus, textarea:focus { border-color: ${P}; box-shadow: 0 0 0 3px ${rgba(P, 0.18)}; }`);
    if (o.buttonStyle === 'flat') add(`.btn { background: ${shade(P, 0.92)}; border-color: transparent; box-shadow: none; }`,
        `.btn.primary { background: ${P}; box-shadow: none; }`, '.btn.primary::after, .btn.glossy::after { display: none; }', '.btn.ghost { background: transparent; }');
    if (o.buttonStyle === 'outline') add(`.btn { background: transparent; border: 1px solid ${rgba(P, 0.5)}; box-shadow: none; }`,
        `.btn:hover { background: ${rgba(P, 0.08)}; }`, `.btn.primary { background: ${P}; border-color: ${P}; }`, '.btn.primary::after, .btn.glossy::after { display: none; }',
        '.btn.ghost { border-color: transparent; }');

    // ---- tables
    // rows: every line exactly rowHeight tall (padding around one line of text), the header headerHeight
    add(`table.grid td, table.grid.compact td, table.grid.dense td, .xp-table td { height: ${px(rowH)}; padding-top: ${px(rowPad)}; padding-bottom: ${px(rowPad)}; }`,
        `table.grid { font-size: ${px(fs + Number(o.tableText))}; line-height: 1.3; }`,
        `table.grid > thead > tr > th, table.grid.compact > thead > tr > th, table.grid.dense > thead > tr > th, .tile-scroll table.grid > thead > tr > th {`,
        `  height: ${px(thHeight)}; padding-top: ${px(thPad)}; padding-bottom: ${px(thPad)}; line-height: 14px; box-sizing: border-box; }`,
        `.day-row td, table.grouped tr.group-row td { top: ${px(thHeight)}; }`,
        `table.grid tbody tr.selected > td, table.grid tbody tr.expanded > td { background: ${o.selectColor}; }`);
    if (!o.rowHover) add('table.grid tbody tr:hover { background: transparent; }', 'table.grid tbody tr:hover > td { background: inherit; }');
    const thBg = o.headerStyle === 'band' ? `linear-gradient(180deg, ${shade(H, 0.1)}, ${H})`
        : o.headerStyle === 'tinted' ? `linear-gradient(180deg, ${shade(P, 0.86)}, ${shade(P, 0.8)})` : `linear-gradient(180deg, ${shade(o.panelBg, 0)}, ${shade(P, 0.94)})`;
    const thInk = o.headerStyle === 'band' ? headInk : o.headerStyle === 'tinted' ? deeper : shade(T, 0.3);
    add(`table.grid > thead > tr > th, .emi-sched > thead > tr > th { background: ${thBg} !important; color: ${thInk} !important;`,
        `  border-bottom-color: ${o.headerLine ? A : rgba(deep, 0.2)} !important; box-shadow: ${o.headerLine ? `inset 0 -2px 0 ${A}` : 'none'} !important; }`,
        `table.grid > thead > tr > th :is(small, b, em, strong, .muted, .secondary) { color: ${o.headerStyle === 'band' ? rgba(headInk, 0.78) : 'inherit'} !important; }`,
        `table.grid > thead > tr > th svg { color: ${o.headerStyle === 'band' ? rgba(headInk, 0.8) : P} !important; }`,
        `.day-head-inner, .grp-head { background: linear-gradient(90deg, ${rgba(P, 0.12)}, ${rgba(P, 0.03)}); box-shadow: inset 3px 0 0 ${P}; }`);
    if (o.zebra) add(`table.grid > tbody > tr:not(.detail-row):not(.day-row):not(.group-row):nth-child(even) > td { background: ${rgba(P, 0.035)}; }`);
    if (!o.rowLines) add('table.grid td { border-bottom-color: transparent; }');

    // ---- expanded rows
    add(`tr.detail-row > td { background: ${o.expandedWash} !important; }`);
    const cards = '.xp-detail2, tr.detail-row .entry-detail, .claim-panel';
    if (o.expandedStyle === 'plain') add(`${cards} { background: transparent !important; border: 0 !important; box-shadow: none !important; }`);
    else add(`${cards} { background: ${o.panelBg} !important; border: 1px solid ${rgba(deep, 0.14)} !important; border-radius: ${px(Math.max(4, r - 4))};`,
        `  box-shadow: ${o.shadow === 'none' ? 'none' : `0 1px 2px ${rgba(deep, 0.07)}, 0 4px 14px ${rgba(deep, 0.08)}`} !important; }`,
        // one padding on every base, so the statement head below meets the card's edges
        '.xp-detail2 { margin: 3px 8px 6px 18px; padding: 6px 9px; }',
        'tr.detail-row .entry-detail { margin: 3px 8px 6px 18px; padding: 6px 9px; border-left-width: 1px !important; }');
    if (o.expandedStyle === 'statement') {
        const band = '.xd-top, .bz-claim .ce-main, .claim-panel > .claim-head';
        add(`${band} { background: var(--grad-navy) !important; color: ${rgba(headInk, 0.9)}; box-shadow: inset 0 -2px 0 ${A} !important; border: 0 !important; }`,
            `.xd-top { margin: -6px -9px 0; padding: 5px 9px 6px; border-radius: ${px(Math.max(3, r - 5))} ${px(Math.max(3, r - 5))} 0 0; }`,
            `.claim-panel > .claim-head { margin-left: -9px; margin-right: -9px; padding-left: 9px; padding-right: 9px; }`,
            `:is(${band}) :is(b, strong, .mono, .title) { color: ${headInk}; }`,
            `:is(${band}) :is(.muted, .small, small, .secondary) { color: ${rgba(headInk, 0.72)}; }`,
            `:is(${band}) svg { color: ${rgba(headInk, 0.8)}; }`,
            `:is(${band}) .btn { background: ${rgba(headInk, 0.1)}; border: 1px solid ${rgba(headInk, 0.3)}; color: ${headInk}; box-shadow: none; }`,
            `:is(${band}) :is(.btn.primary, .btn.bz-edit) { background: ${headInk}; color: ${H}; border-color: ${headInk}; }`);
    }
    add(`.xd-card, .bz-claim-card, .cfig { border-color: ${rgba(P, 0.2)} !important; background: ${o.boxTint ? `linear-gradient(180deg, ${rgba(P, 0.07)}, ${o.panelBg} 80%)` : o.panelBg} !important;`,
        `  box-shadow: inset 0 2px 0 ${rgba(P, 0.8)} !important; }`,
        `.xd-card.xd-category { box-shadow: inset 0 2px 0 ${A} !important; }`,
        `.xd-card-head, .xd-card-head svg, .bz-card-head, .cfig .label { color: ${deep} !important; }`,
        `.xd-card b.mono, .cfig b, .cc-fig b { color: ${deeper}; }`,
        `.xd-bar em, .bs-track .seg.s { background: linear-gradient(90deg, ${shade(P, 0.2)}, ${P}); }`);

    // ---- icons
    add(`.chip-icon { width: ${px(28 * s)}; height: ${px(28 * s)}; }`, `.chip-icon svg { width: ${px(14 * s)}; height: ${px(14 * s)}; }`,
        `.chip-icon.sm, .acct-item.rich .chip-icon.sm { width: ${px(22 * s)}; height: ${px(22 * s)}; }`,
        `.chip-icon.sm svg, .acct-item.rich .chip-icon.sm svg { width: ${px(11 * s)}; height: ${px(11 * s)}; }`,
        `.acct-item.rich, .acct-item { grid-template-columns: ${px(22 * s)} minmax(0, 1fr); }`,
        `.chip-icon.sm.art, .acct-item.rich .chip-icon.sm.art { width: ${px(24 * s)}; height: ${px(24 * s)}; }`,
        `.chip-icon.sm.art svg.icon.art { width: ${px(22 * s)}; height: ${px(22 * s)}; }`,
        `.metric-icon, .ov-ico { width: ${px(20 * s)}; height: ${px(20 * s)}; }`, `.metric-icon svg, .ov-ico svg { width: ${px(11 * s)}; height: ${px(11 * s)}; }`,
        `.tl-dot { width: ${px(18 * s)}; height: ${px(18 * s)}; }`);
    if (o.iconStyle === 'solid') add(`.chip-icon:not(.art) { background: linear-gradient(180deg, ${shade(P, 0.15)}, ${shade(P, -0.1)}) !important; color: #ffffff !important; box-shadow: 0 1px 3px ${rgba(P, 0.35)} !important; }`);
    if (o.iconStyle === 'outline') add(`.chip-icon:not(.art) { background: transparent !important; box-shadow: inset 0 0 0 1px currentColor !important; }`);

    // ---- selection and lists
    add(`.acct-item.rich.selected, .acct-item.selected { box-shadow: inset 3px 0 0 ${A}, 0 2px 8px ${rgba(deep, 0.12)}; }`,
        `.bn-item.selected { background: linear-gradient(90deg, ${rgba(P, 0.12)}, ${rgba(P, 0.03)}); box-shadow: inset 3px 0 0 ${P}; }`);

    // ---- type extras
    add(`.panel-head h3 { font-size: ${px(o.titleSize)}; }`);
    if (o.numbers === 'mono') add(':is(.mono, .amount, td.r, .metric .value, .bs-stat b, .cfig b) { font-family: Consolas, "SF Mono", Menlo, monospace; font-variant-numeric: tabular-nums; }');
    if (o.numbers === 'tabular') add(':is(.mono, .amount, td.r, .metric .value, .bs-stat b, .cfig b) { font-variant-numeric: tabular-nums; }');
    if (o.caps === 'normal') add(':is(table.grid th, .section-title, .metric .label, .field > span, .cfig .label, .xd-card-head, .bs-label, .bs-stat small, .bo-tile small, .cc-fig small, .edb-head) { text-transform: none !important; letter-spacing: 0 !important; }');

    // ---- panel extras
    add(`.panel { border-width: ${px(o.borderWidth)}; border-style: solid; }`);
    if (!o.titleLine) add('.panel-head::after { display: none; }');

    // ---- buttons, inputs, focus
    if (o.buttonCase === 'upper') add('.btn { text-transform: uppercase; letter-spacing: 0.04em; font-size: 0.92em; }');
    if (o.inputStyle === 'filled') add(`:is(input, select, textarea):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]) { background: ${shade(P, 0.93)}; border-color: transparent; }`);
    if (o.inputStyle === 'underline') add(`:is(input, select, textarea):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]) { background: transparent; border-width: 0 0 1.5px; border-radius: 0; border-color: ${rgba(deep, 0.35)}; box-shadow: none; }`);
    if (o.focusRing === 'strong') add(`input:focus, select:focus, textarea:focus, .btn:focus-visible { outline: 2px solid ${P}; outline-offset: 1px; box-shadow: 0 0 0 4px ${rgba(P, 0.25)}; }`);
    if (o.focusRing === 'none') add(`input:focus, select:focus, textarea:focus { box-shadow: none; border-color: ${P}; }`);

    // ---- lists and figure chips
    const items = '.acct-item, .acct-item.rich, .list-item.clickable, .bn-item';
    add(`:is(${items}) { margin-bottom: ${px(o.listGap)}; padding-top: ${px(o.listPadding * 0.6)}; padding-bottom: ${px(o.listPadding * 0.6)}; }`);
    if (o.listStyle === 'flat') add(`:is(${items}) { background: transparent !important; border-color: transparent !important; box-shadow: none !important; }`,
        `:is(${items}):hover { background: ${rgba(P, 0.06)} !important; }`);
    if (o.listStyle === 'lines') add(`:is(${items}) { background: transparent !important; border: 0 !important; border-bottom: 1px solid ${rgba(deep, 0.12)} !important; border-radius: 0 !important; box-shadow: none !important; margin-bottom: 0; }`);
    if (o.selectedStyle === 'filled') add(`.acct-item.selected, .acct-item.rich.selected, .bn-item.selected, .list-item.selected { background: var(--grad-navy) !important; color: ${headInk} !important; }`,
        `:is(.acct-item.selected, .acct-item.rich.selected, .bn-item.selected) :is(b, .title, .acct-name, .acct-bal, .acct-meta, .fact, small, span) { color: ${headInk} !important; }`);
    if (o.selectedStyle === 'outline') add(`.acct-item.selected, .acct-item.rich.selected, .bn-item.selected, .list-item.selected { background: ${o.panelBg} !important; box-shadow: 0 0 0 2px ${P} !important; }`);
    add(`:is(.metric .value, .ov-chip b, .bo-tile b, .bs-stat b, .cstat .value) { font-size: ${px(o.chipValue)}; }`);
    const chips = '.metric, .ov-chip, .bo-tile, .stat, .cstat, .ov-card';
    if (o.chipStyle === 'plain') add(`:is(${chips}) { background: transparent !important; border-color: transparent !important; box-shadow: none !important; }`);
    if (o.chipStyle === 'edge') add(`:is(${chips}) { background: ${o.panelBg} !important; border: 1px solid ${rgba(deep, 0.12)} !important; box-shadow: inset 3px 0 0 ${A} !important; }`);
    add(`.badge, .tag, .pace-chip, .bs-pct { border-radius: ${o.badgeShape === 'pill' ? '999px' : o.badgeShape === 'rounded' ? '5px' : '2px'}; }`);

    // ---- frame extras
    add(`.menu a { font-size: ${px(o.menuSize)}; }`);
    if (!o.menuIcons) add('.menu a svg { display: none; }');
    if (o.contentWidth !== 'full') add(`#view.view { max-width: ${o.contentWidth}px; width: 100%; margin-left: auto; margin-right: auto; }`);
    if (o.scrollbar === 'thin') add('* { scrollbar-width: thin; }');
    if (o.scrollbar === 'hidden') add('* { scrollbar-width: none; }', '*:hover { scrollbar-width: thin; }');

    // ---- motion
    if (!o.motion) add('*, *::before, *::after { animation: none !important; transition: none !important; }');
    return css.join('\n');
}
