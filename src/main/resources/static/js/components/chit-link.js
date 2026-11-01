/**
 * Share a chit by a link that expires (see ChitShareService): whoever opens it, on any phone and without an account,
 * sees the chit as it stands then: the organizer, what is paid and what is left, the next installment, what it pays out
 * and when (or what was received), and, if chosen, every installment and the returns (effective rates, growth). Account names, notes and the organizer's phone and
 * UPI stay out. The dialog makes a link (shown once, with a QR, copy, WhatsApp) and lists the links made, to revoke one.
 *
 *   openChitShareDialog(chit, onChanged)   chit: the ChitView of the chit page
 */
import { api } from '../core/api.js';
import { openModal, esc, toast } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, date, dateTime } from '../core/format.js';
import { qrSvg } from '../core/qr.js';

const DURATIONS = [[24, '1 day'], [72, '3 days'], [168, '1 week'], [720, '1 month'], [2160, '3 months']];

export async function openChitShareDialog(chit, onChanged) {
    let changed = false;
    const listHtml = shares => !shares.length ? '' : `
        <div class="section-title">${icon('link')} Links made</div>
        <div class="cs-list">${shares.map(s => {
            const tone = s.status === 'ACTIVE' ? ['good', `until ${dateTime(s.expiresAt)}`] : s.status === 'EXPIRED' ? ['gray', 'expired'] : ['critical', 'revoked'];
            return `<div class="cs-row ${s.status.toLowerCase()}">
                <span class="badge ${tone[0]}">${tone[1]}</span>
                <span class="grow min-0"><b>${esc(s.sharedWith || 'Anyone with the link')}</b>
                    <small class="muted">made ${dateTime(s.createdAt)} · opened ${s.views}×${s.lastViewedAt ? `, last ${dateTime(s.lastViewedAt)}` : ''}${s.showInstallments ? ' · with every installment' : ' · totals only'}${s.showReturns ? ' · with the returns' : ''}</small></span>
                ${s.status === 'ACTIVE' ? `<button type="button" class="btn sm ghost" data-revoke-share="${s.id}" title="Stop this link now">${icon('lock')}Revoke</button>` : ''}
            </div>`; }).join('')}</div>`;
    const shares = await api.get(`/chits/${chit.id}/shares`);
    const paidOut = chit.payoutAmount !== null;
    const modal = openModal({
        title: `Share chit · ${chit.name}`, iconName: 'link', size: 'lg',
        body: `<div class="cs-dialog">
            <p class="hint" style="margin:0">Whoever opens the link sees, on any phone and without signing in: <b>${esc(chit.organizer || 'the organizer')}</b>,
                ${chit.installmentsPaid} of ${chit.numberOfInstallments} installments paid, what is still to pay and the next due date,
                and ${paidOut ? `the payout of ${money(chit.payoutAmount)}` : `the ${money(chit.maturityAmount)} it pays out on ${date(chit.maturityDate)}`}.
                It is always up to date and stops working when it expires or you revoke it. Your accounts, notes and the organizer's phone and UPI are not shown.</p>
            <form class="form-grid two" data-share-form onsubmit="return false">
                <label class="field"><span>For <small class="muted">optional</small></span><input name="sharedWith" maxlength="80" placeholder="e.g. Amma, my nominee" data-plain></label>
                <div class="field"><span>Valid for</span><div class="ln-chips" data-share-hours>${DURATIONS.map(([h, l]) =>
                    `<button type="button" class="date-chip ${h === 168 ? 'selected' : ''}" data-value="${h}">${l}</button>`).join('')}</div></div>
                <label class="field span-2"><span>Message on top <small class="muted">optional</small></span>
                    <input name="message" maxlength="300" placeholder="e.g. The chit I told you about; the payout comes in June" data-plain></label>
                <label class="check-line span-2"><input type="checkbox" name="showInstallments" checked> Show every installment (due date, paid on, dividend); otherwise only the totals and the next one</label>
                <label class="check-line span-2"><input type="checkbox" name="showReturns"> Show the returns: the effective interest rate (compound and simple), the interest so far and at the end,
                    how the money grows day by day and month by month, and how it compares with a bank deposit</label>
            </form>
            <div data-share-result></div>
            <div data-share-list>${listHtml(shares)}</div>
        </div>`,
        onOpen: m => {
            m.el.querySelector('[data-share-hours]').addEventListener('click', e => {
                const chip = e.target.closest('[data-value]');
                if (chip) m.el.querySelectorAll('[data-share-hours] [data-value]').forEach(c => c.classList.toggle('selected', c === chip));
            });
            m.el.querySelector('[data-share-list]').addEventListener('click', async e => {
                const b = e.target.closest('[data-revoke-share]');
                if (!b) return;
                try {
                    await api.post(`/chits/${chit.id}/shares/${b.dataset.revokeShare}/revoke`);
                    toast('Link stopped');
                    changed = true;
                    m.el.querySelector('[data-share-list]').innerHTML = listHtml(await api.get(`/chits/${chit.id}/shares`));
                } catch (error) { toast(error.message, 'error'); }
            });
        },
        actions: [
            { label: 'Close', onClick: () => { if (changed) onChanged?.(); } },
            { label: 'Make link', kind: 'primary', iconName: 'link', onClick: async m => {
                const form = m.el.querySelector('[data-share-form]');
                const hours = Number(m.el.querySelector('[data-share-hours] .selected')?.dataset.value || 168);
                const created = await api.post(`/chits/${chit.id}/shares`, {
                    sharedWith: form.sharedWith.value, hours, message: form.message.value, showInstallments: form.showInstallments.checked,
                    showReturns: form.showReturns.checked,
                });
                changed = true;
                const url = `${location.origin}/chit-statement.html#${created.token}`;
                const who = form.sharedWith.value.trim();
                const text = `${who ? `Hi ${who}, h` : 'H'}ere is my chit "${chit.name}" with ${chit.organizer || 'the organizer'}: what is paid, what is left and ${paidOut ? 'the payout' : 'what it pays out and when'}. Up to date whenever you open it (until ${date(created.share.expiresAt.slice(0, 10))}). ${url}`;
                const result = m.el.querySelector('[data-share-result]');
                result.innerHTML = `<div class="ln-made cs-made">
                    <div class="ln-qr">${qrSvg(url, { size: 150 })}</div>
                    <div class="ln-made-main">
                        <p class="small muted" style="margin:0">Copy or send it now: the link is shown only once. It works until <b>${dateTime(created.share.expiresAt)}</b>.</p>
                        <div class="ln-url"><input value="${esc(url)}" readonly data-plain><button type="button" class="btn sm primary" data-copy>${icon('copy')}Copy</button></div>
                        <div class="row"><a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">${icon('phone')}Send on WhatsApp</a>
                            <a class="btn sm" target="_blank" rel="noopener" href="${esc(url)}">${icon('eye')}Preview</a>
                            ${navigator.share ? `<button type="button" class="btn sm" data-native-share>${icon('link')}Share…</button>` : ''}</div>
                        ${/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname)
                            ? `<p class="small warn-text" style="margin:0">${icon('alert')}This link points to ${esc(location.host)}, which only works on your own network. To send it to someone elsewhere, open the app at its shared (public) address and make the link there.</p>` : ''}
                    </div></div>`;
                result.querySelector('[data-copy]').addEventListener('click', async () => {
                    try { await navigator.clipboard.writeText(url); toast('Link copied', 'info'); } catch { result.querySelector('input').select(); }
                });
                result.querySelector('[data-native-share]')?.addEventListener('click', () => navigator.share({ title: chit.name, text, url }).catch(() => {}));
                m.el.querySelector('[data-share-list]').innerHTML = listHtml(await api.get(`/chits/${chit.id}/shares`));
                return true;   // stay open to copy / send
            } },
        ],
    });
    modal.el.querySelector('[data-close]')?.addEventListener('click', () => { if (changed) onChanged?.(); });
}
