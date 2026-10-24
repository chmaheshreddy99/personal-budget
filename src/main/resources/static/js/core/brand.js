/**
 * The organization's company name and logo (Settings → Organization), shown in place of "Personal Budget": the top bar,
 * the footer, the sign-in page and the browser tab. Elements marked data-brand-logo, data-brand-name,
 * data-brand-tagline, data-brand-title and data-brand-icon follow it.
 *
 * The sign-in page does not know the organization yet, so the brand seen last on this browser is kept and shown there.
 */
const KEY = 'pb.brand';
const APP_NAME = 'Personal Budget';
const APP_LOGO = '/img/logo.svg';

let current = { name: null, logo: null };

/** The name to show: the company's, or the app's own. */
export function brandName() {
    return current.name || APP_NAME;
}

/** Shows a brand ({ name, logo }: either may be null, for the app's own) and keeps it for the next sign-in page. */
export function applyBrand(brand) {
    current = { name: brand?.name || null, logo: brand?.logo || null };
    try {
        if (current.name || current.logo) localStorage.setItem(KEY, JSON.stringify(current));
        else localStorage.removeItem(KEY);
    } catch { /* not kept */ }
    paint();
}

/** The brand seen last on this browser (before signing in). */
export function applyRememberedBrand() {
    try { current = JSON.parse(localStorage.getItem(KEY) || 'null') || current; } catch { /* the app's own */ }
    paint();
}

function paint() {
    const { name, logo } = current;
    document.querySelectorAll('img[data-brand-logo]').forEach(img => {
        img.src = logo || APP_LOGO;
        img.classList.toggle('brand-custom', !!logo);
    });
    document.querySelectorAll('[data-brand-name]').forEach(el => {
        if (el.dataset.appName === undefined) el.dataset.appName = el.innerHTML;
        if (name) el.textContent = name; else el.innerHTML = el.dataset.appName;
    });
    document.querySelectorAll('[data-brand-tagline]').forEach(el => { el.hidden = !!name; });
    document.querySelectorAll('[data-brand-title]').forEach(el => { el.title = brandName(); el.classList.toggle('branded', !!name); });
    // the open page's title ("Settings · Personal Budget") follows at once
    const shown = document.title.lastIndexOf(' · ');
    if (shown > 0) document.title = `${document.title.slice(0, shown)} · ${brandName()}`;
    document.querySelectorAll('link[data-brand-icon]').forEach(link => {
        link.href = logo || APP_LOGO;
        if (logo) link.removeAttribute('type'); else link.type = 'image/svg+xml';
    });
}
