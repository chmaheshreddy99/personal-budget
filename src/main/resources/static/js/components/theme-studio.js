/**
 * Settings › Appearance: the built-in themes, your own themes (core/custom-theme.js) and the theme studio that makes
 * them.
 *   list    a card per built-in theme, a card per theme of your own (its colours as swatches, Apply, Edit, Duplicate,
 *           Export, Delete), Create and Import
 *   studio  a name and the base theme, a row of ready-made presets, then every option in folding groups (colours,
 *           fonts, sizes, panels, buttons, tables, expanded rows, icons, menu & motion); a sample on the right (a panel,
 *           figures, buttons, a table with an opened row). Every change shows at once on the whole page; Cancel (or
 *           leaving the page) puts the theme in use back. Save keeps it; Save & apply switches to it (the page reloads,
 *           as for any theme, so the base theme's own parts redraw).
 */
import { esc, panel, toast, confirmDialog, openModal } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { THEMES, currentTheme, setTheme } from '../core/theme.js';
import {
    BASES, GROUPS, PRESETS, CUSTOM_PREFIX, defaultOptions, customThemes, customTheme, isCustomId, saveCustomTheme, deleteCustomTheme,
    compileTheme, applyLive,
} from '../core/custom-theme.js';

/** Puts the theme in use back on the page (after a live preview). */
function restoreCurrent() {
    const id = currentTheme();
    const custom = isCustomId(id) ? customTheme(id.slice(CUSTOM_PREFIX.length)) : null;
    applyLive(custom ? custom.base : id, custom ? compileTheme(custom) : null);
}

const swatches = t => {
    const o = { ...defaultOptions(), ...t.opts };
    return `<span class="ts-swatches" aria-hidden="true">${[o.topbar, o.header, o.primary, o.accent, o.pageBg].map(c => `<i style="background:${esc(c)}"></i>`).join('')}</span>`;
};

// ===================================================================== the list

export function renderAppearance(target) {
    const body = freshBody(target);
    restoreCurrent();
    const current = currentTheme();
    const preview = id => `<div class="tp-preview ${id}" aria-hidden="true">
            <span class="tp-bar"></span>
            <span class="tp-row"></span><span class="tp-row open"></span>
            <span class="tp-panel"><i></i><i></i></span>
            <span class="tp-row"></span>
        </div>`;
    const mine = customThemes().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const customCard = t => {
        const id = CUSTOM_PREFIX + t.id;
        const o = { ...defaultOptions(), ...t.opts };
        return `<div class="theme-card custom ${id === current ? 'current' : ''}" data-custom="${esc(t.id)}">
            <div class="ts-mini" aria-hidden="true" style="--m-top:${esc(o.topbar)};--m-head:${esc(o.header)};--m-pri:${esc(o.primary)};--m-acc:${esc(o.accent)};--m-page:${esc(o.pageBg)};--m-panel:${esc(o.panelBg)}">
                <span class="m-bar"></span><span class="m-panel"><span class="m-th"></span><span class="m-tr"></span><span class="m-tr"></span><span class="m-btn"></span></span></div>
            <div class="tc-text"><b>${esc(t.name)}</b><small>Built on ${esc(BASES.find(b => b.id === t.base)?.label || t.base)} · ${swatches(t)}</small></div>
            <div class="ts-card-acts">
                ${id === current ? `<span class="tc-state">${icon('check-circle')}In use</span>` : `<button class="btn sm primary" data-ts="apply">${icon('check')}Apply</button>`}
                <button class="btn sm" data-ts="edit">${icon('edit')}Edit</button>
                <button class="btn sm ghost icon" data-ts="copy" title="Duplicate">${icon('copy')}</button>
                <button class="btn sm ghost icon" data-ts="export" title="Export (copy as text to share or keep)">${icon('download')}</button>
                <button class="btn sm ghost icon danger" data-ts="delete" title="Delete">${icon('trash')}</button>
            </div>
        </div>`;
    };
    body.innerHTML = panel({ title: 'Appearance', iconName: 'sparkles', sub: 'Saved in this browser',
        actions: `<button class="btn sm" data-ts="import">${icon('upload')}Import</button>
            <button class="btn sm primary" data-ts="create">${icon('plus')}Create a theme</button>`,
        body: `
            <div class="section-title ts-title">${icon('layers')} Built-in themes</div>
            <div class="theme-picker">${THEMES.map(t => `
                <div class="theme-card ${t.id === current ? 'current' : ''}" data-theme-card="${t.id}">
                    ${preview(t.id)}
                    <div class="tc-text"><b>${esc(t.label)}${t.id === 'classic' ? ' <span class="tag">default</span>' : ''}</b><small>${esc(t.hint)}</small></div>
                    ${t.id === current ? `<span class="tc-state">${icon('check-circle')}In use</span>`
                        : `<button class="btn sm primary" data-theme-pick="${t.id}">${icon('check')}Use ${esc(t.label)}</button>`}
                </div>`).join('')}</div>
            <div class="section-title ts-title">${icon('droplet')} Your themes</div>
            <div class="theme-picker">
                ${mine.map(customCard).join('')}
                <button class="theme-card ts-new" data-ts="create">${icon('plus')}<b>Create a theme</b>
                    <small>Start from a preset or a built-in theme, then change colours, fonts, sizes, panels, buttons, tables, open rows and icons. You see every change as you make it.</small></button>
            </div>
            <p class="small muted tc-note">${icon('info')}Applies to this browser only; other people and devices keep their own choice. The page reloads to switch.</p>` });

    body.addEventListener('click', async e => {
        const pick = e.target.closest('[data-theme-pick]');
        if (pick) return setTheme(pick.dataset.themePick);
        const btn = e.target.closest('[data-ts]');
        if (!btn) return;
        const card = btn.closest('[data-custom]');
        const theme = card ? customTheme(card.dataset.custom) : null;
        const act = btn.dataset.ts;
        if (act === 'create') return renderStudio(body, { name: 'My theme', base: 'breeze', opts: defaultOptions() }, { fresh: true });
        if (act === 'import') return importTheme(body);
        if (!theme) return;
        if (act === 'apply') setTheme(CUSTOM_PREFIX + theme.id);
        if (act === 'edit') renderStudio(body, structuredClone(theme));
        if (act === 'copy') {
            const copy = saveCustomTheme({ ...structuredClone(theme), id: null, name: `${theme.name} copy` });
            toast(`${copy.name} made`);
            renderAppearance(body);
        }
        if (act === 'export') exportTheme(theme);
        if (act === 'delete' && await confirmDialog(`Delete the theme “${theme.name}”?${CUSTOM_PREFIX + theme.id === currentTheme() ? ' It is in use: the page goes back to Classic.' : ''}`)) {
            const inUse = CUSTOM_PREFIX + theme.id === currentTheme();
            deleteCustomTheme(theme.id);
            if (inUse) return setTheme('classic');
            toast('Theme deleted');
            renderAppearance(body);
        }
    });
}

// ===================================================================== export / import

function exportTheme(theme) {
    const text = JSON.stringify({ app: 'personal-budget-theme', name: theme.name, base: theme.base, opts: theme.opts }, null, 2);
    navigator.clipboard?.writeText(text).then(() => toast('Theme copied: paste it into Import on any browser'), () => {});
    openModal({ title: `Export · ${theme.name}`, iconName: 'download',
        body: `<p class="hint" style="margin:0 0 6px">Keep this text, or paste it into <b>Import</b> on another browser or device.</p>
            <textarea class="ts-code" readonly rows="14">${esc(text)}</textarea>`,
        actions: [{ label: 'Close', kind: 'primary' }] });
}

function importTheme(body) {
    openModal({ title: 'Import a theme', iconName: 'upload',
        body: `<p class="hint" style="margin:0 0 6px">Paste the text of an exported theme.</p><textarea class="ts-code" name="code" rows="14" placeholder='{ "name": …, "base": …, "opts": { … } }'></textarea>`,
        actions: [{ label: 'Cancel' }, { label: 'Import', kind: 'primary', iconName: 'check', onClick: m => {
            let data;
            try { data = JSON.parse(m.el.querySelector('[name=code]').value); } catch { throw new Error('That is not the text of an exported theme'); }
            if (!data || typeof data !== 'object' || typeof data.opts !== 'object') throw new Error('That is not the text of an exported theme');
            const known = Object.keys(defaultOptions());
            const opts = Object.fromEntries(Object.entries(data.opts).filter(([k]) => known.includes(k)));
            const saved = saveCustomTheme({ name: String(data.name || 'Imported theme').slice(0, 60), base: BASES.some(b => b.id === data.base) ? data.base : 'breeze', opts });
            toast(`${saved.name} imported`);
            renderAppearance(body);
        } }] });
}

// ===================================================================== the studio

function controlHtml(o, value) {
    const hint = o.hint ? `<small>${esc(o.hint)}</small>` : '';
    if (o.type === 'color') return `<div class="ts-row"><span class="ts-label">${esc(o.label)}${hint}</span>
        <span class="ts-color"><input type="color" data-opt="${o.key}" value="${esc(value)}"><input class="ts-hex" data-hex="${o.key}" value="${esc(value)}" maxlength="7" spellcheck="false" data-plain></span></div>`;
    if (o.type === 'range') return `<div class="ts-row"><span class="ts-label">${esc(o.label)}${hint}</span>
        <span class="ts-range"><input type="range" data-opt="${o.key}" min="${o.min}" max="${o.max}" step="${o.step}" value="${value}"><output data-out="${o.key}">${value}${o.unit === '×' ? '×' : o.unit}</output></span></div>`;
    if (o.type === 'toggle') return `<div class="ts-row"><span class="ts-label">${esc(o.label)}${hint}</span>
        <label class="switch"><input type="checkbox" data-opt="${o.key}" ${value ? 'checked' : ''}><span></span></label></div>`;
    return `<div class="ts-row ts-row-choice"><span class="ts-label">${esc(o.label)}${hint}</span>
        <span class="seg-chips sm ts-choice" data-choice="${o.key}">${o.options.map(([v, l]) => `<button type="button" class="seg-chip ${String(value) === String(v) ? 'active' : ''}" data-value="${esc(v)}">${esc(l)}</button>`).join('')}</span></div>`;
}

const sampleHtml = () => `
    <div class="ts-sample">
        <div class="panel ts-sample-panel">
            <div class="panel-head"><h3><span class="ico">${icon('wallet')}</span>Sample panel</h3><span class="sub">this month</span>
                <div class="actions"><button class="btn sm">${icon('download')}Export</button><button class="btn sm primary">${icon('plus')}Add</button></div></div>
            <div class="panel-body">
                <div class="metric-strip">
                    <div class="metric"><div class="row"><span class="metric-icon">${icon('wallet')}</span><span class="label">Spent</span></div><div class="value">₹42,180</div><div class="note">of ₹60,000</div><div class="progress"><span style="width:70%"></span></div></div>
                    <div class="metric"><div class="row"><span class="metric-icon">${icon('arrow-in')}</span><span class="label">Income</span></div><div class="value pos">₹1,20,000</div><div class="note">2 credits</div></div>
                    <div class="metric"><div class="row"><span class="metric-icon">${icon('piggy')}</span><span class="label">Saved</span></div><div class="value">₹77,820</div><div class="note">65% of income</div></div>
                </div>
                <div class="ts-buttons"><button class="btn primary">${icon('check')}Primary</button><button class="btn">${icon('edit')}Button</button>
                    <button class="btn ghost icon danger" title="Delete">${icon('trash')}</button>
                    <span class="seg-chips sm"><span class="seg-chip active">Month</span><span class="seg-chip">Year</span></span>
                    <span class="chip-icon sm aqua">${icon('cart')}</span><span class="chip-icon sm coral">${icon('fuel')}</span><span class="chip-icon sm violet">${icon('phone')}</span></div>
            </div>
        </div>
        <div class="panel ts-sample-panel">
            <div class="panel-head"><h3><span class="ico">${icon('list')}</span>Transactions</h3></div>
            <div class="panel-body flush">
                <table class="grid dense"><thead><tr><th>Date</th><th>Category</th><th>Paid to</th><th class="r">Amount</th></tr></thead>
                    <tbody>
                        <tr class="clickable"><td>01 Nov</td><td><span class="chip-icon xs aqua">${icon('cart')}</span> Groceries</td><td>Fresh Mart</td><td class="r neg">₹2,340</td></tr>
                        <tr class="clickable expanded"><td>31 Oct</td><td><span class="chip-icon xs coral">${icon('fuel')}</span> Fuel</td><td>City Fuels</td><td class="r neg">₹3,000</td></tr>
                        <tr class="detail-row"><td colspan="4"><div class="xp-detail2">
                            <div class="xd-top"><span class="xd-fact">${icon('journal')}<b>JV-1042</b> Expense</span><span class="xd-fact">${icon('calendar')}31 Oct · Fri</span>
                                <span class="xd-fact">${icon('user')}City Fuels</span><span class="spacer"></span>
                                <span class="xd-actions"><button class="btn xs primary">${icon('edit')}Edit</button><button class="btn xs">${icon('copy')}Again</button></span></div>
                            <div class="xd-cards">
                                <div class="xd-card xd-posting"><div class="xd-card-head">${icon('journal')}Posting</div><div class="xd-line"><span class="xd-side">Dr</span><span>Fuel</span><b class="mono">₹3,000</b></div><div class="xd-line"><span class="xd-side">Cr</span><span>HDFC Bank</span><b class="mono muted">₹3,000</b></div></div>
                                <div class="xd-card xd-category"><div class="xd-card-head">${icon('tag')}Fuel</div><div class="xd-line"><span>Budget Oct</span><b class="mono">₹5,400 / 8K</b></div><i class="xd-bar"><em style="width:68%"></em></i></div>
                                <div class="xd-card xd-payee"><div class="xd-card-head">${icon('user')}City Fuels</div><div class="xd-line small"><span class="muted">Here in this list</span><span>4× · <b class="mono">₹11K</b></span></div></div>
                            </div></div></td></tr>
                        <tr class="clickable"><td>30 Oct</td><td><span class="chip-icon xs violet">${icon('phone')}</span> Mobile</td><td>Airtel</td><td class="r neg">₹599</td></tr>
                        <tr class="clickable"><td>30 Oct</td><td><span class="chip-icon xs">${icon('arrow-in')}</span> Salary</td><td>Employer</td><td class="r pos">₹1,20,000</td></tr>
                    </tbody></table>
            </div>
        </div>
    </div>`;

/**
 * The studio for one theme (a copy: nothing is kept until Save). fresh: a new theme, which opens on the presets.
 */
function renderStudio(target, draft, { fresh = false } = {}) {
    const body = freshBody(target);
    draft.opts = { ...defaultOptions(), ...draft.opts };
    const saved = JSON.stringify(draft);
    let frame = 0;
    const live = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => applyLive(draft.base, compileTheme(draft)));
    };
    const dirty = () => JSON.stringify(draft) !== saved;
    const leave = () => { window.removeEventListener('hashchange', onLeave); restoreCurrent(); };
    const onLeave = () => leave();
    window.addEventListener('hashchange', onLeave);

    const groupsHtml = () => GROUPS.map((g, i) => `
        <details class="ts-group" ${i === 0 ? 'open' : ''} data-group="${g.id}">
            <summary><span class="chip-icon sm">${icon(g.iconName)}</span><span class="min-0"><b>${esc(g.label)}</b><small>${esc(g.hint)}</small></span>
                <button type="button" class="btn xs ghost ts-reset" data-reset="${g.id}" title="Put this group back to the defaults">${icon('undo')}Reset</button></summary>
            <div class="ts-rows">${g.options.map(o => controlHtml(o, draft.opts[o.key])).join('')}</div>
        </details>`).join('');

    const draw = () => {
        body.innerHTML = panel({ title: draft.id ? `Theme studio · ${draft.name}` : 'Theme studio · a new theme', iconName: 'sparkles', cls: 'ts-panel',
            sub: 'changes show on the whole page as you make them',
            actions: `<button class="btn sm ghost" data-st="cancel">${icon('x')}Cancel</button>
                <button class="btn sm" data-st="save">${icon('check')}Save</button>
                <button class="btn sm primary" data-st="apply">${icon('check-circle')}Save &amp; apply</button>`,
            body: `<div class="ts-grid">
                <div class="ts-controls">
                    <div class="ts-head">
                        <label class="field"><span>Name</span><input name="ts-name" value="${esc(draft.name)}" maxlength="60" data-plain></label>
                        <div class="field"><span>Built on</span><span class="seg-chips sm ts-base">${BASES.map(b => `<button type="button" class="seg-chip ${draft.base === b.id ? 'active' : ''}" data-base="${b.id}" title="${esc(b.hint)}">${esc(b.label)}</button>`).join('')}</span></div>
                    </div>
                    <div class="ts-presets ${fresh ? 'fresh' : ''}">
                        <span class="ts-label">${fresh ? 'Start from a preset' : 'Presets'}<small>${fresh ? 'then change anything below' : 'replaces the options below'}</small></span>
                        <div class="ts-preset-list">${PRESETS.map(p => `<button type="button" class="ts-preset" data-preset="${p.id}">${swatches(p)}<b>${esc(p.name)}</b><small>on ${esc(BASES.find(b => b.id === p.base)?.label)}</small></button>`).join('')}</div>
                    </div>
                    ${groupsHtml()}
                </div>
                <div class="ts-preview">
                    <div class="ts-preview-head">${icon('eye')}<b>Preview</b><span class="muted small">the rest of the page follows too</span></div>
                    ${sampleHtml()}
                    <p class="small muted ts-note">${icon('info')}Built on <b data-base-name>${esc(BASES.find(b => b.id === draft.base)?.label)}</b>: its own parts (how open rows are laid out, the live motion) show fully after Save &amp; apply.</p>
                </div>
            </div>` });
        live();
    };
    draw();

    const setOpt = (key, value) => {
        draft.opts[key] = value;
        const out = body.querySelector(`[data-out="${key}"]`);
        const o = GROUPS.flatMap(g => g.options).find(x => x.key === key);
        if (out) out.textContent = `${value}${o?.unit === '×' ? '×' : o?.unit || ''}`;
        live();
    };

    body.addEventListener('input', e => {
        const t = e.target;
        if (t.name === 'ts-name') { draft.name = t.value; return; }
        if (t.dataset.hex) {
            if (/^#[0-9a-f]{6}$/i.test(t.value)) {
                body.querySelector(`[data-opt="${t.dataset.hex}"]`).value = t.value;
                setOpt(t.dataset.hex, t.value.toLowerCase());
            }
            return;
        }
        const key = t.dataset.opt;
        if (!key) return;
        if (t.type === 'color') { body.querySelector(`[data-hex="${key}"]`).value = t.value; setOpt(key, t.value); }
        if (t.type === 'range') setOpt(key, Number(t.value));
        if (t.type === 'checkbox') setOpt(key, t.checked);
    });

    body.addEventListener('click', async e => {
        const choice = e.target.closest('[data-choice] [data-value]');
        if (choice) {
            const key = choice.closest('[data-choice]').dataset.choice;
            choice.parentElement.querySelectorAll('.seg-chip').forEach(c => c.classList.toggle('active', c === choice));
            const o = GROUPS.flatMap(g => g.options).find(x => x.key === key);
            setOpt(key, typeof o.default === 'number' ? Number(choice.dataset.value) : choice.dataset.value);
            return;
        }
        const base = e.target.closest('[data-base]');
        if (base) {
            draft.base = base.dataset.base;
            base.parentElement.querySelectorAll('.seg-chip').forEach(c => c.classList.toggle('active', c === base));
            body.querySelector('[data-base-name]').textContent = BASES.find(b => b.id === draft.base)?.label;
            live();
            return;
        }
        const preset = e.target.closest('[data-preset]');
        if (preset) {
            const p = PRESETS.find(x => x.id === preset.dataset.preset);
            if (!fresh && dirty() && !await confirmDialog(`Use the preset “${p.name}”? It replaces the options you have set.`, { confirmLabel: 'Use preset', danger: false })) return;
            draft.base = p.base;
            draft.opts = { ...defaultOptions(), ...p.opts };
            if (fresh && (draft.name === 'My theme' || PRESETS.some(x => x.name === draft.name))) draft.name = p.name;
            fresh = false;
            draw();
            toast(`${p.name} loaded: change anything you like`);
            return;
        }
        const reset = e.target.closest('[data-reset]');
        if (reset) {
            e.preventDefault();   // the button sits in the summary: do not fold the group
            const g = GROUPS.find(x => x.id === reset.dataset.reset);
            g.options.forEach(o => { draft.opts[o.key] = o.default; });
            const details = reset.closest('details');
            details.querySelector('.ts-rows').innerHTML = g.options.map(o => controlHtml(o, draft.opts[o.key])).join('');
            details.open = true;
            live();
            return;
        }
        const act = e.target.closest('[data-st]')?.dataset.st;
        if (!act) return;
        if (act === 'cancel') {
            if (dirty() && !await confirmDialog('Leave the studio without saving? The changes are lost.', { confirmLabel: 'Leave', danger: false })) return;
            leave();
            renderAppearance(body);
            return;
        }
        draft.name = (draft.name || '').trim() || 'My theme';
        const theme = saveCustomTheme(draft);
        if (act === 'apply') { leave(); setTheme(CUSTOM_PREFIX + theme.id); return; }
        toast(`${theme.name} saved`);
        leave();
        renderAppearance(body);
    });
}

/** The same element afresh, without the listeners of what was drawn in it before. */
function freshBody(body) {
    const clone = body.cloneNode(false);
    body.replaceWith(clone);
    return clone;
}
