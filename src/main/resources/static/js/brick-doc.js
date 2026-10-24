/**
 * One brick business document on a page of its own, drawn by the web app's own renderer (core/brick-docs.js), for the
 * Bricks phone app: what the phone shows is the web app's bill or slip itself, not a copy made another way.
 *
 *   brick-doc.html#bill/<orderId>&t=<token>     the bill of an order (its tax invoice once paid in full)
 *   brick-doc.html#slip/<slipId>&t=<token>      a payment or advance slip
 *   brick-doc.html#draft-slip                   a slip worked out but not paid yet (the app hands it as window.__BK_DRAFT)
 *   …&print=1                                   laid out for one A4 sheet, as the web app prints it (core PRINT_CSS)
 *
 * The token is the app's own session (in the fragment: never sent to the server in the address); the server checks
 * the calls as for the app. The page tells the app when it is drawn (or why not) through window.ReactNativeWebView.
 */
import { billDocHtml, billFromView, slipDocHtml, verifyDoc, PRINT_CSS, FIT_SCRIPT } from './core/brick-docs.js';

const [what, ...opts] = location.hash.slice(1).split('&');
const opt = Object.fromEntries(opts.map(p => p.split('=').map(decodeURIComponent)));
const main = document.getElementById('bdx-main');
const tell = msg => { try { window.ReactNativeWebView?.postMessage(JSON.stringify(msg)); } catch { /* not in the app */ } };

async function get(path) {
    const res = await fetch(`/api${path}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${opt.t || ''}`, 'ngrok-skip-browser-warning': '1' } });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || `The server answered ${res.status}`);
    return data;
}

/** What to draw: the document's html, its title, and the signature to check. */
async function load() {
    const [kind, id] = what.split('/');
    if (kind === 'bill') {
        const v = await get(`/bricks/orders/${Number(id)}`);
        return { html: billDocHtml(billFromView(v)), title: v.invoice ? `Invoice ${v.invoice.invoiceNo}` : `Bill ${v.order.orderNo}`,
            check: v.invoice ? [v.invoice.payload, v.invoice.signature, v.publicKey] : null };
    }
    if (kind === 'slip') {
        const v = await get(`/bricks/payroll/slips/${Number(id)}`);
        return { html: slipDocHtml(v), title: `${v.slip.kind === 'ADVANCE' ? 'Advance' : 'Payment'} slip ${v.slip.slipNo}`,
            check: [v.slip.payload, v.slip.digitalSignature, v.publicKey] };
    }
    if (kind === 'draft-slip' && window.__BK_DRAFT) return { html: slipDocHtml(window.__BK_DRAFT), title: 'Payment slip (draft)', check: null };
    throw new Error('This document cannot be shown');
}

try {
    const d = await load();
    document.title = d.title;
    if (opt.print === '1') {
        // the printed sheet, exactly as the web app prints it
        document.head.insertAdjacentHTML('beforeend', `<style>${PRINT_CSS}</style>`);
        document.body.className = 'bd-print';
        main.className = '';
        main.innerHTML = `<div class="bd-sheet">${d.html.replace(/<span data-verify[^>]*>[^<]*<\/span>/, '')}</div>`;
        // eslint-disable-next-line no-new-func
        const fit = new Function(`${FIT_SCRIPT}; fit();`);
        await (document.fonts ? document.fonts.ready : Promise.resolve());
        fit();
        setTimeout(fit, 200);
    } else {
        main.innerHTML = `<div class="bd-wrap">${d.html}</div>`;
        if (d.check?.[1]) verifyDoc(main, ...d.check);
    }
    tell({ ready: true, title: d.title });
} catch (e) {
    main.innerHTML = `<p class="bdx-msg">${String(e.message || e).replace(/[<&]/g, c => (c === '<' ? '&lt;' : '&amp;'))}</p>`;
    tell({ error: String(e.message || e) });
}
