/**
 * An organizer's acknowledgement of chit installments (or of the payout received in full), laid out as a deed for
 * bond.js (print view / PDF). The same record (data of the payer's list or of the organizer's page) is shown on both
 * sides, so the copy they print is the one the payer prints. No app state.
 *
 * opts (what the person printing chose): place, stampDuty, stampSerial, witness / witness2 ({ name, address, phone }),
 * thumbBoxes, revenueStamp, plain (plain paper for a stamp to be stuck on), real (real stamp paper), evidence (false: leave
 * the online evidence annexure out), selfie ({ src, hash }: the live photo, as a data URL), technical (false: leave the digital
 * signature's text and key out of the annexure), copy (a label printed above the title: "Original", "Organizer's copy" ...),
 * payFrom (false: no payment reference column).
 */
import { bondMoney, bondWhen, signatureRows, evidenceRows } from './bond.js';

const short = iso => iso ? new Date(String(iso).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function receiptDeed(r, opts = {}) {
    const payout = r.kind === 'PAYOUT';
    const online = r.status === 'ACKNOWLEDGED';
    const paper = r.status === 'SIGNED';
    const done = online || paper;
    const lines = r.lines || [];
    const installLines = r.installLines || [];
    const witnesses = [opts.witness, opts.witness2].filter(w => w?.name);
    const when = paper ? `signed on paper ${short(r.acknowledgedAt)}` : online ? `acknowledged online ${bondWhen(r.acknowledgedAt)}` : '';
    const row = (l, label) => [`${label} ${l.no}`,
        `${bondMoney(l.cash)} on ${short(l.paidDate)}${payout ? '' : ` (installment ${bondMoney(l.dueAmount)} due ${short(l.dueDate)}${Number(l.dividend) ? `, dividend ${bondMoney(l.dividend)} adjusted` : ''})`}`];
    const instRows = installLines.map(l => row(l, 'Installment'));
    // how it was paid ("UPI · ref 4411 · from HDFC Savings · note"): each line's own account and reference first, else the request's
    const parts = String(r.paymentNote || '').split(' · ').map(x => x.trim()).filter(Boolean);
    const noteRef = parts.find(x => /^ref /i.test(x))?.slice(4) || '';
    const noteMode = parts.find(x => ['UPI', 'Bank transfer', 'Cash', 'Cheque', 'Card'].includes(x)) || '';
    // a payment's own reference (UTR, cheque no.), given with it or with the request; the reference column only when there is one
    const refOf = (l, ls) => l.reference || (ls.length === 1 ? noteRef : '');
    const table = (ls, title, received) => {
        const total = ls.reduce((s, l) => s + Number(l.cash), 0);
        const withRef = opts.payFrom !== false && ls.some(l => refOf(l, ls));
        const simple = payout && ls === lines;
        const head = simple ? ['No.', 'Received on', 'Amount'] : ['No.', 'Due date', 'Paid on', 'Installment', 'Dividend', received];
        const right = simple ? [2] : [3, 4, 5];
        const widths = simple ? [10, 40, 30] : [7, 15, 15, 16, 13, 17];
        if (withRef) { head.push('Payment reference'); widths.push(simple ? 30 : 22); }
        const rows = ls.map(l => {
            const base = simple ? [String(l.no), short(l.paidDate), `<b>${bondMoney(l.cash)}</b>`]
                : [String(l.no), short(l.dueDate), short(l.paidDate), bondMoney(l.dueAmount), Number(l.dividend) ? bondMoney(l.dividend) : '—', `<b>${bondMoney(l.cash)}</b>`];
            if (withRef) base.push(escape(refOf(l, ls) || '—'));
            return base;
        });
        const foot = simple ? ['', 'Total', `<b>${bondMoney(total)}</b>`] : ['', 'Total', '', bondMoney(ls.reduce((s, l) => s + Number(l.dueAmount || 0), 0)),
            bondMoney(ls.reduce((s, l) => s + Number(l.dividend || 0), 0)), `<b>${bondMoney(total)}</b>`];
        if (withRef) foot.push('');
        return { title, head, rows, foot, right, widths: widths.map(w => w * 100 / widths.reduce((a, b) => a + b, 0)) };
    };
    const payTable = payout ? null : table(lines, `Payments received (${lines.length})`, 'Received');
    if (payTable && (noteMode || noteRef || parts.some(x => !/^from /i.test(x)))) {
        const rest = parts.filter(x => x !== noteMode && !/^ref /i.test(x) && !/^from /i.test(x));
        payTable.note = `Paid by ${escape(noteMode || 'the means stated')}${noteRef && lines.length > 1 ? `, reference ${escape(noteRef)}` : ''}${rest.length ? `; ${escape(rest.join('; '))}` : ''}, as stated by the Subscriber.`;
    }
    // the evidence: the photo, every detail recorded, and (unless left out) the digital signature to check it with
    let device = {};
    try { device = JSON.parse(r.acknowledgedDevice || '{}'); } catch { device = {}; }
    const evidence = online && opts.evidence !== false ? [{
        title: 'Evidence of the online acknowledgement',
        note: `Recorded when ${r.acknowledgedName || 'the Organizer'} signed on their phone through the link sent to the number on record. The record below is sealed (SHA-256) and digitally signed: any change to it shows.`,
        images: opts.selfie?.src ? [{ src: opts.selfie.src, caption: `Live selfie taken while signing · ${bondWhen(r.acknowledgedAt)}`, hash: opts.selfie.hash, mark: r.ackNo, photo: true }] : [],
        rows: [
            ...evidenceRows({ name: r.acknowledgedName, at: r.acknowledgedAt, phone: r.acknowledgedPhone, phoneMatches: true, ip: r.acknowledgedIp,
                device: r.acknowledgedDevice, userAgent: r.acknowledgedUserAgent, location: r.acknowledgedLocation, deviceHash: r.deviceHash, seal: r.acknowledgementSeal,
                digitalSignature: opts.technical === false ? null : r.digitalSignature, keyFingerprint: r.keyFingerprint, publicKey: opts.technical === false ? null : r.publicKey,
                evidencePayload: opts.technical === false ? null : r.evidencePayload }),
            ...(r.views ? [['Link opened', `${r.views} time${r.views === 1 ? '' : 's'}${r.lastViewedAt ? `, last ${escape(bondWhen(r.lastViewedAt))}` : ''}`]] : []),
            ...(device.model || device.platform ? [['Phone', escape([device.model, device.platform].filter(Boolean).join(' · '))]] : []),
            ['Request made', `${escape(bondWhen(r.createdAt))} by ${escape(r.createdBy || r.payerName)}`],
            ['Record fingerprint (SHA-256)', `<code>${escape(r.contentHash || '')}</code>`],
        ],
    }] : [];
    return {
        kind: 'RECEIPT', title: payout ? 'Receipt of payout and final settlement' : 'Acknowledgement of receipt', number: r.ackNo, copyLabel: opts.copy || '',
        payments: payTable,
        date: done ? r.acknowledgedAt : r.createdAt, place: opts.place || '',
        stampDuty: opts.stampDuty, stampSerial: opts.stampSerial, realStampPaper: !!opts.real, plainPaper: !!opts.plain,
        revenueStamp: opts.revenueStamp ?? !!opts.plain, thumbBoxes: !!opts.thumbBoxes,
        firstParty: { role: 'Subscriber', term: 'Subscriber', name: r.payerName, signature: r.payerSignature || null },
        secondParty: { role: 'Organizer', term: 'Organizer', name: done ? r.acknowledgedName : r.organizerName,
            relation: `organizer / foreman of the chit “${r.chitName}”`, signature: online ? r.signature : null, accepted: when },
        witness: witnesses[0] || { name: '' }, witness2: witnesses[1] || null, twoWitnesses: opts.twoWitnesses || witnesses.length > 1,
        recitals: payout
            ? [`the Subscriber is a member of the chit “${r.chitName}”${r.ticketNo ? ` (ticket / group no. ${r.ticketNo})` : ''} conducted by the Organizer`,
                `the Organizer has paid the payout of the chit, ${bondMoney(r.totalAmount)}${r.amountInWords ? ` (${r.amountInWords})` : ''}, to the Subscriber, who has received it in full, and the parties wish to record the receipt and settle the payout as set out hereinafter`]
            : [`the Subscriber is a member of the chit “${r.chitName}”${r.ticketNo ? ` (ticket / group no. ${r.ticketNo})` : ''} conducted by the Organizer`,
                `the Subscriber has paid the installments listed below, ${bondMoney(r.totalAmount)}${r.amountInWords ? ` (${r.amountInWords})` : ''} in all, and the Organizer acknowledges their receipt as set out hereinafter`],
        particulars: payout
            ? [...lines.map(l => row(l, 'Payout part')), ['Payout received in full', `${bondMoney(r.totalAmount)} (${r.amountInWords || ''})`],
                ...(instRows.length ? [['Installments restated', `${installLines.length} paid, ${bondMoney(installLines.reduce((s, l) => s + Number(l.cash), 0))} in all`], ...instRows] : []),
                ...((r.supersedes || []).length ? [['Earlier acknowledgements cancelled', r.supersedes.join(', ')]] : []),
                ...(r.paymentNote ? [['Payout details', r.paymentNote]] : [])]
            : [['Chit', `${r.chitName}${r.ticketNo ? ` (ticket / group no. ${r.ticketNo})` : ''}`], ['Installments', lines.map(l => `no. ${l.no}`).join(', ')],
                ['Total received', `${bondMoney(r.totalAmount)} (${r.amountInWords || ''})`]],
        terms: r.terms, fingerprint: r.contentHash,
        footnote: r.status === 'CANCELLED' ? `WITHDRAWN on ${short(r.cancelledAt)}: ${r.cancelReason || ''}` : '',
        annexures: evidence,
    };
}
