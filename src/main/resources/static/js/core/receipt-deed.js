/**
 * An organizer's acknowledgement of chit installments (or of the payout received in full), laid out as a deed for
 * bond.js (print view / PDF). The same record (data of the payer's list or of the organizer's page) is shown on both
 * sides, so the copy they print is the one the payer prints. No app state.
 *
 * opts (what the person printing chose): place, stampDuty, stampSerial, witness / witness2 ({ name, address, phone }),
 * thumbBoxes, revenueStamp, plain (plain paper for a stamp to be stuck on), real (real stamp paper), evidence (false: leave
 * the online evidence annexure out).
 */
import { bondMoney, bondWhen, signatureRows } from './bond.js';

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
    return {
        kind: 'RECEIPT', title: payout ? 'Receipt of payout and final settlement' : 'Acknowledgement of receipt', number: r.ackNo,
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
            : [...lines.map(l => row(l, 'Installment')), ['Total received', `${bondMoney(r.totalAmount)} (${r.amountInWords || ''})`], ...(r.paymentNote ? [['Payment details', r.paymentNote]] : [])],
        terms: r.terms, fingerprint: r.contentHash,
        footnote: r.status === 'CANCELLED' ? `WITHDRAWN on ${short(r.cancelledAt)}: ${r.cancelReason || ''}` : '',
        annexures: online && r.acknowledgementSeal && opts.evidence !== false ? [{ title: 'Evidence of the online acknowledgement', rows: [['Acknowledged by', escape(r.acknowledgedName)],
            ['Acknowledged at', escape(bondWhen(r.acknowledgedAt))], ['Acknowledgement seal (SHA-256)', `<code>${escape(r.acknowledgementSeal)}</code>`],
            ...signatureRows(r)] }] : [],
    };
}
