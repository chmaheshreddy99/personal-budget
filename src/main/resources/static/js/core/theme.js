/**
 * The look of the app, chosen in Settings → Appearance and kept in this browser (preference "look"):
 *   classic  the original Glacier & Ocean look (the default)
 *   ocean    the richer look: open rows as aligned tiles on glossy ocean, lifecycles told step by step, charts that
 *            animate in, refined icons (css/polish.css with the markup and icons that go with it)
 *   breeze   Classic with CSS on top (css/breeze.css) and a few parts of its own (isBreeze()): deep coloured headers,
 *            open rows in brand tones with labelled actions, live charts, progress bars and lifecycles
 *   pearl    Breeze, compact and glossy (css/breeze.css with css/pearl.css on top; isBreeze() is true too): smaller type
 *            and icons, shorter rows, panels and chips, no bold text, in a navy and crimson banking look
 *   custom:<id>  a theme of your own (core/custom-theme.js): one of the above as its base, with its options on top
 * index.html applies the theme before the first paint (<html data-theme> set to the theme or its base, each sheet on
 * or off, a custom theme's compiled sheet last); the rest of the app asks isOcean() / isBreeze(). Changing it reloads
 * the page so every part redraws in the new look.
 */
import { getPref, setPref } from './prefs.js';
import { CUSTOM_PREFIX, customTheme, isCustomId, rememberApplied } from './custom-theme.js';

export const THEMES = [
    { id: 'classic', label: 'Classic', hint: 'The original Glacier & Ocean look: compact strips under an open row, plain charts.' },
    { id: 'ocean', label: 'Ocean', hint: 'Open rows as aligned tiles on glossy ocean, lifecycles told step by step, animated charts, refined icons.' },
    { id: 'breeze', label: 'Breeze', hint: 'Classic, alive: deep coloured headers, an open expense in thin brand tints, live charts, progress bars and lifecycles.' },
    { id: 'pearl', label: 'Pearl', hint: 'Breeze, compact and glossy, with a banking look: navy and crimson, white panels, small type and icons, short rows, no bold text.' },
];
export const DEFAULT_THEME = 'classic';

/** The chosen theme's id: a built-in one, or custom:<id> while that theme still exists (the default otherwise). */
export function currentTheme() {
    const id = getPref('look', {}).theme;
    if (isCustomId(id)) return customTheme(id.slice(CUSTOM_PREFIX.length)) ? id : DEFAULT_THEME;
    return THEMES.some(t => t.id === id) ? id : DEFAULT_THEME;
}

/** True when the page is drawn in the Ocean theme (as applied to <html>, so a page without the theme stays classic). */
export const isOcean = () => document.documentElement.dataset.theme === 'ocean';

/**
 * True when the page is drawn in the Breeze theme (Classic's markup, with a few richer parts of its own), or in Pearl,
 * which is built on it (a custom theme on either counts too: <html data-theme> is its base).
 */
export const isBreeze = () => ['breeze', 'pearl'].includes(document.documentElement.dataset.theme);

/** Saves the theme (a built-in id, or custom:<id>) and reloads the page in it. */
export function setTheme(id) {
    rememberApplied(isCustomId(id) ? customTheme(id.slice(CUSTOM_PREFIX.length)) : null);   // the sheet for the first paint, or none
    setPref('look', { ...getPref('look', {}), theme: id });
    location.reload();
}
