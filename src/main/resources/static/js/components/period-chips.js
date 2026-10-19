/**
 * One-click date ranges: 30 days, this month, 3 / 6 months, this and last financial year (April to
 * March), 12 months and everything, plus "Custom" for exact dates. Replaces a pair of date boxes.
 *   periodChips(from, to)          markup
 *   bindPeriodChips(host, onChange) host holds the chips; onChange(from, to) whenever a range is picked
 */
import { esc } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { isoDate, date } from '../core/format.js';

function presets() {
    const t = new Date(isoDate() + 'T00:00:00');
    const fyStart = new Date(t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1, 3, 1);
    const iso = d => isoDate(d);
    return [
        { key: '30d', label: '30D', title: 'Last 30 days', from: iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 29)), to: iso(t) },
        { key: 'mtd', label: 'Month', title: 'This month', from: iso(new Date(t.getFullYear(), t.getMonth(), 1)), to: iso(t) },
        { key: '3m', label: '3M', title: 'Last 3 months', from: iso(new Date(t.getFullYear(), t.getMonth() - 2, 1)), to: iso(t) },
        { key: '6m', label: '6M', title: 'Last 6 months', from: iso(new Date(t.getFullYear(), t.getMonth() - 5, 1)), to: iso(t) },
        { key: 'fy', label: 'FY', title: `This financial year (from ${date(iso(fyStart))})`, from: iso(fyStart), to: iso(t) },
        { key: 'lfy', label: 'Last FY', title: 'Last financial year', from: iso(new Date(fyStart.getFullYear() - 1, 3, 1)), to: iso(new Date(fyStart.getFullYear(), 2, 31)) },
        { key: '1y', label: '1Y', title: 'Last 12 months', from: iso(new Date(t.getFullYear() - 1, t.getMonth(), t.getDate() + 1)), to: iso(t) },
        { key: 'all', label: 'All', title: 'Everything', from: '2000-01-01', to: iso(t) },
    ];
}

export function periodChips(from, to, { custom = false } = {}) {
    const list = presets();
    const active = list.find(p => p.from === from && p.to === to);
    const showCustom = custom || !active;
    return `<span class="period-chips" data-period-chips>
        <span class="seg-chips sm">${list.map(p => `<button type="button" class="seg-chip ${active?.key === p.key ? 'active' : ''}" data-range="${p.key}" title="${esc(p.title)}">${p.label}</button>`).join('')}
            <button type="button" class="seg-chip ${showCustom ? 'active' : ''}" data-range="custom" title="Pick exact dates">${icon('calendar')}</button></span>
        ${showCustom ? `<span class="pc-custom"><input type="date" data-from value="${from}"><span>–</span><input type="date" data-to value="${to}"></span>`
                     : `<span class="pc-label" title="${date(from)} – ${date(to)}">${date(from)} – ${date(to)}</span>`}
    </span>`;
}

export function bindPeriodChips(el, onChange) {
    const root = el.querySelector('[data-period-chips]');   // el: the element holding the chips
    if (!root) return;
    root.addEventListener('click', e => {
        const b = e.target.closest('[data-range]');
        if (!b) return;
        if (b.dataset.range === 'custom') {
            const from = root.querySelector('[data-from]')?.value || presets()[2].from;
            const to = root.querySelector('[data-to]')?.value || isoDate();
            root.outerHTML = periodChips(from, to, { custom: true });
            bindPeriodChips(el, onChange);
            return;
        }
        const p = presets().find(x => x.key === b.dataset.range);
        onChange(p.from, p.to);
    });
    root.addEventListener('change', e => {
        if (!e.target.matches('[data-from], [data-to]')) return;
        const from = root.querySelector('[data-from]').value;
        const to = root.querySelector('[data-to]').value;
        if (from && to && from <= to) onChange(from, to);
    });
}
