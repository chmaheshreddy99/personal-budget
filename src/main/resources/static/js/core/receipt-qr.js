/**
 * QR codes that let anyone holding a chit receipt (on paper or on screen) check it with a phone camera:
 *
 *   check  /verify.html#r=<number>&c=<code>: the number and the code of its signed text (SHA-256, from the server).
 *          Small and easy to scan. The page asks this installation for the record with exactly that code (nobody can
 *          look records up by number alone) and shows whether it still stands, was withdrawn or replaced by a payout
 *          receipt, then checks the digital signature in the phone's browser.
 *   proof  /verify.html#e=<the exact text that was signed, its signature and the public key, deflated, Base64url>.
 *          The page checks the signature with nothing else: no lookup, nothing sent anywhere (the part after # never
 *          leaves the phone). It proves the text is unchanged, but not whether the receipt was withdrawn since. Drawn only
 *          when it fits a code phones read reliably on paper (PROOF_MAX characters); a long record has the check code
 *          and the evidence file instead.
 *
 *   const codes = await receiptCodes(r);   // r: an AckView / PublicAck with verifyCode, evidencePayload, signature, key
 *   codesHtml(codes)                        // the two codes with what each does (for the deed and the screen)
 */
import { qrSvg } from './qr.js';

/** The longest proof link drawn as a QR (about version 29 at level M: 133 modules, still read at 5 cm on paper). */
export const PROOF_MAX = 1300;

const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Whether this address can be reached from another phone (not this computer or the home network only). */
export const reachable = (host = location.hostname) => !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/.test(host);

export function checkUrl(r, origin = location.origin) {
    return r?.verifyCode && r.ackNo ? `${origin}/verify.html#r=${encodeURIComponent(r.ackNo)}&c=${r.verifyCode}` : null;
}

/** The proof link, or null when the record is not signed or the browser cannot compress. */
export async function proofUrl(r, origin = location.origin) {
    if (!r?.evidencePayload || !r.digitalSignature || !r.publicKey || typeof CompressionStream === 'undefined') return null;
    const json = JSON.stringify({ n: r.ackNo, t: r.evidencePayload, s: r.digitalSignature, k: r.publicKey });
    const packed = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
    return `${origin}/verify.html#e=${b64url(packed)}`;
}

/** Both codes of a signed record: { check, proof (null when too long), proofLength, reachable }; null when not signed. */
export async function receiptCodes(r) {
    const check = checkUrl(r);
    if (!check) return null;
    const proof = await proofUrl(r).catch(() => null);
    return { check, proof: proof && proof.length <= PROOF_MAX ? proof : null, proofLength: proof?.length || 0, reachable: reachable() };
}

/** The codes with what each does. print: sized for paper; otherwise for the screen. */
export function codesHtml(codes, { print = false } = {}) {
    if (!codes) return '';
    const size = print ? 132 : 150;
    return `<div class="rq-codes ${print ? 'print' : ''}">
        <figure class="rq-code"><div class="rq-img">${qrSvg(codes.check, { size })}</div>
            <figcaption><b>Check this receipt</b><span>Scan with a phone camera: it shows whether this receipt is genuine and still valid (not withdrawn or replaced), and checks its digital signature.</span></figcaption></figure>
        ${codes.proof ? `<figure class="rq-code"><div class="rq-img">${qrSvg(codes.proof, { size: Math.round(size * 1.15) })}</div>
            <figcaption><b>Exact text that was signed</b><span>Holds the signed text, its signature and the key. The phone checks it by itself, with no lookup: proof the text is unchanged, even without this application.</span></figcaption></figure>`
            : `<p class="rq-note">The exact text that was signed is too long for a QR code phones read reliably (${codes.proofLength} characters); it is printed in the annexure and can be downloaded as the evidence file.</p>`}
    </div>`;
}
