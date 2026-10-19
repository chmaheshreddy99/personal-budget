/**
 * Number, money and date formatting. The currency comes from the signed-in tenant.
 */

let currency = 'INR';
let locale = 'en-IN';

export function setCurrency(code) {
    currency = code || 'INR';
    locale = currency === 'INR' ? 'en-IN' : undefined;
}

export function currencySymbol() {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 })
        .formatToParts(0).find(p => p.type === 'currency')?.value || currency;
}

/** 125000 -> "₹1,25,000" ; decimals only when needed. */
export function money(value, { decimals } = {}) {
    if (value === null || value === undefined || value === '') return '—';
    const n = Number(value);
    const digits = decimals ?? (Number.isInteger(n) ? 0 : 2);
    return new Intl.NumberFormat(locale, {
        style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits,
    }).format(n);
}

/** Short form for axes and tiles: ₹1.2L, ₹3.4Cr (INR) or ₹1.2K / ₹3.4M. */
export function moneyShort(value) {
    if (value === null || value === undefined) return '—';
    const n = Number(value);
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    const sym = currencySymbol();
    const fmt = (v, s) => sign + sym + (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)).replace(/\.0+$/, '') + s;
    if (currency === 'INR') {
        if (abs >= 1e7) return fmt(abs / 1e7, 'Cr');
        if (abs >= 1e5) return fmt(abs / 1e5, 'L');
        if (abs >= 1e3) return fmt(abs / 1e3, 'K');
    } else {
        if (abs >= 1e9) return fmt(abs / 1e9, 'B');
        if (abs >= 1e6) return fmt(abs / 1e6, 'M');
        if (abs >= 1e3) return fmt(abs / 1e3, 'K');
    }
    return sign + sym + abs.toFixed(0);
}

export function number(value, digits = 2) {
    if (value === null || value === undefined) return '—';
    return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(Number(value));
}

export function percent(value, digits = 1) {
    if (value === null || value === undefined) return '—';
    return Number(value).toFixed(digits).replace(/\.0$/, '') + '%';
}

/** "2026-10-06" -> "06 Oct 2026" */
export function date(iso) {
    if (!iso) return '—';
    const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** "2026-10-06T14:05:00" -> "06 Oct 2026, 14:05" (when it was recorded) */
export function dateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

/** "2026-10-06" -> "06 Oct 26" (short, with the year) */
export function shortDateYear(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
}

/** "2026-10-06" -> "06 Oct" */
export function shortDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/** "2026-10" -> "Oct 26" */
export function monthLabel(ym) {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short' }) + ' ' + String(y).slice(2);
}

/** Local ISO date (yyyy-mm-dd) for an optional Date. */
export function isoDate(d = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function firstOfMonth(offsetMonths = 0) {
    const d = new Date();
    return isoDate(new Date(d.getFullYear(), d.getMonth() + offsetMonths, 1));
}

export function daysFromToday(iso) {
    const today = new Date(isoDate() + 'T00:00:00');
    return Math.round((new Date(iso + 'T00:00:00') - today) / 86400000);
}

/** Signed amount with + / − and a color class. */
export function signedMoney(value) {
    const n = Number(value || 0);
    const cls = n > 0 ? 'pos' : n < 0 ? 'neg' : 'muted';
    return `<span class="${cls}">${n > 0 ? '+' : ''}${money(n)}</span>`;
}
