/**
 * The look of the app, chosen in Settings → Appearance and kept in this browser (preference "look"):
 *   classic  the original Glacier & Ocean look (the default)
 *   ocean    the richer look: open rows as aligned tiles on glossy ocean, lifecycles told step by step, charts that
 *            animate in, refined icons (css/polish.css with the markup and icons that go with it)
 * index.html applies the theme before the first paint (<html data-theme>, the Ocean sheet on or off); the rest of the
 * app asks isOcean(). Changing it reloads the page so every part redraws in the new look.
 */
import { getPref, setPref } from './prefs.js';

export const THEMES = [
    { id: 'classic', label: 'Classic', hint: 'The original Glacier & Ocean look: compact strips under an open row, plain charts.' },
    { id: 'ocean', label: 'Ocean', hint: 'Open rows as aligned tiles on glossy ocean, lifecycles told step by step, animated charts, refined icons.' },
];
export const DEFAULT_THEME = 'classic';

/** The chosen theme's id (the default when none is saved or the saved one is unknown). */
export function currentTheme() {
    const id = getPref('look', {}).theme;
    return THEMES.some(t => t.id === id) ? id : DEFAULT_THEME;
}

/** True when the page is drawn in the Ocean theme (as applied to <html>, so a page without the theme stays classic). */
export const isOcean = () => document.documentElement.dataset.theme === 'ocean';

/** Saves the theme and reloads the page in it. */
export function setTheme(id) {
    setPref('look', { ...getPref('look', {}), theme: id });
    location.reload();
}
