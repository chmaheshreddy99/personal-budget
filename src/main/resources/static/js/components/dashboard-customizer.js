/**
 * Dashboard layout editor: show / hide each panel, change its width and move it up or down.
 * Used in the dashboard's "Customize" dialog and in Settings. Changes are saved as they are made.
 */
import { esc, openModal } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { DASHBOARD_WIDGETS, DASHBOARD_BANDS, dashboardLayout, saveDashboardLayout, setPref } from '../core/prefs.js';

const SIZES = [[3, 'S'], [4, 'M'], [6, 'L'], [8, 'XL'], [12, 'Full']];

export function customizerHtml() {
    const layout = dashboardLayout();
    const byId = Object.fromEntries(DASHBOARD_WIDGETS.map(w => [w.id, w]));
    return `
    <div class="dash-custom">
        <div class="dc-bands">${DASHBOARD_BANDS.map(b => `
            <label class="switch"><input type="checkbox" data-band="${b.id}" ${layout.bands[b.id] ? 'checked' : ''}><span></span>${esc(b.label)}</label>`).join('')}</div>
        <div class="dc-list">${layout.order.map((id, i) => `
            <div class="dc-row ${layout.hidden.includes(id) ? 'off' : ''}" data-widget="${id}">
                <label class="switch"><input type="checkbox" data-show="${id}" ${layout.hidden.includes(id) ? '' : 'checked'}><span></span></label>
                <b class="grow">${esc(byId[id].label)}</b>
                <div class="seg-chips sm">${SIZES.map(([n, l]) => `<button type="button" class="seg-chip ${layout.spans[id] === n ? 'active' : ''}" data-size="${n}" data-for="${id}">${l}</button>`).join('')}</div>
                <button type="button" class="btn sm ghost icon" data-move="-1" data-for="${id}" title="Move up" ${i === 0 ? 'disabled' : ''}>${icon('arrow-up')}</button>
                <button type="button" class="btn sm ghost icon" data-move="1" data-for="${id}" title="Move down" ${i === layout.order.length - 1 ? 'disabled' : ''}>${icon('arrow-down')}</button>
            </div>`).join('')}</div>
        <p class="hint">Panels fill the screen row by row in this order; 12 columns make a row (S = 3, M = 4, L = 6, XL = 8).</p>
    </div>`;
}

/** Wires the editor inside host; redraw() re-renders it after every change. */
export function bindCustomizer(host, redraw) {
    host.addEventListener('click', e => {
        const layout = dashboardLayout();
        const size = e.target.closest('[data-size]');
        const move = e.target.closest('[data-move]');
        if (size) layout.spans[size.dataset.for] = Number(size.dataset.size);
        else if (move) {
            const i = layout.order.indexOf(move.dataset.for);
            const j = i + Number(move.dataset.move);
            if (j < 0 || j >= layout.order.length) return;
            [layout.order[i], layout.order[j]] = [layout.order[j], layout.order[i]];
        } else return;
        saveDashboardLayout(layout);
        redraw();
    });
    host.addEventListener('change', e => {
        const layout = dashboardLayout();
        if (e.target.dataset.show) {
            const id = e.target.dataset.show;
            layout.hidden = e.target.checked ? layout.hidden.filter(x => x !== id) : [...layout.hidden, id];
        } else if (e.target.dataset.band) {
            layout.bands[e.target.dataset.band] = e.target.checked;
        } else return;
        saveDashboardLayout(layout);
        redraw();
    });
}

export function openCustomizer(onDone) {
    openModal({
        title: 'Customize dashboard', iconName: 'settings', size: 'lg',
        body: '<div data-custom></div>',
        onOpen: m => {
            const host = m.el.querySelector('[data-custom]');
            const draw = () => { host.innerHTML = customizerHtml(); };
            bindCustomizer(host, draw);
            draw();
        },
        actions: [
            { label: 'Reset to default', left: true, iconName: 'refresh', onClick: () => { setPref('dashboard', {}); onDone?.(); } },
            { label: 'Done', kind: 'primary', iconName: 'check', onClick: () => { onDone?.(); } },
        ],
    });
}
