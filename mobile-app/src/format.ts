/** Indian money and dates, without Intl (Hermes has it, but the output differs between versions). */

function group(intPart: string): string {
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

/** ₹1,23,456.50 (decimals only when there are any, or always with decimals = 2). */
export function money(v: number | null | undefined, decimals?: number): string {
  const n = Number(v || 0);
  const neg = n < 0;
  const abs = Math.abs(n);
  const d = decimals ?? (Math.round(abs * 100) % 100 === 0 ? 0 : 2);
  const [i, f] = abs.toFixed(d).split('.');
  return `${neg ? '−' : ''}₹${group(i)}${f ? `.${f}` : ''}`;
}

/** ₹1.2L, ₹3.4Cr, ₹12.5K. */
export function moneyShort(v: number | null | undefined): string {
  const n = Number(v || 0);
  const a = Math.abs(n);
  const s = n < 0 ? '−' : '';
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(a >= 1e8 ? 0 : 2).replace(/\.?0+$/, '')}Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2).replace(/\.?0+$/, '')}L`;
  if (a >= 1e3) return `${s}₹${(a / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return `${s}₹${Math.round(a)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function isoDate(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 13 Oct 2026 */
export function date(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** 13 Oct (this year) or 13 Oct 25 */
export function shortDate(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return y === new Date().getFullYear() ? `${d} ${MONTHS[m - 1]}` : `${d} ${MONTHS[m - 1]} ${String(y).slice(2)}`;
}

/** "Today", "Yesterday", "Mon 12 Oct" … for grouping lists by day. */
export function dayLabel(iso: string): string {
  const today = isoDate();
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (iso === today) return 'Today';
  if (iso === isoDate(y)) return 'Yesterday';
  const dt = new Date(`${iso}T00:00:00`);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()]} ${shortDate(iso)}`;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function ago(ms?: number | null): string {
  if (!ms) return 'never';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** A random id for an expense recorded on the phone (the server books each id once). */
export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
