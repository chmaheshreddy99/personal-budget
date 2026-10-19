/**
 * Bank and institution marks for the account lists: the institution's own icon (img/banks, saved from its
 * website so nothing is fetched from elsewhere at run time) or, where only a tiny favicon exists, its mark
 * drawn here in the brand colours. Matched on the account's institution and name; accounts with no known
 * institution keep their account-type icon.
 *
 *   bankLogo(account)          -> '<span class="bank-logo">…</span>' or '' when nothing matches
 *   accountIcon(account, sm)   -> the bank logo, else the account-type chip
 */
import { accountChip, esc } from './ui.js';

const FONT = `font-family="'Segoe UI', Roboto, Arial, sans-serif" font-weight="800" text-anchor="middle"`;
/** A brand tile: colour, initials and their colour. */
const tile = (bg, text, fg = '#fff', size = 20) => `<svg viewBox="0 0 48 48"><rect width="48" height="48" rx="11" fill="${bg}"/>
    <text x="24" y="${24 + size * 0.36}" ${FONT} font-size="${size}" fill="${fg}">${text}</text></svg>`;

/** Marks drawn here: the institutions whose sites offer no icon bigger than 16px. */
const DRAWN = {
    // the SBI keyhole
    sbi: `<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#22409a"/><circle cx="24" cy="21" r="5.2" fill="#fff"/><rect x="21.6" y="22" width="4.8" height="24" fill="#fff"/></svg>`,
    axis: `<svg viewBox="0 0 48 48"><rect width="48" height="48" rx="11" fill="#97144d"/><path d="M24 9 39 39H30.5L24 25.5 17.5 39H9z" fill="#fff"/><path d="M24 25.5 30.5 39h-13z" fill="#97144d"/></svg>`,
    pnb: tile('#a20a3a', 'pnb', '#fbbc09', 19),
    yes: tile('#00518f', 'YES', '#fff', 16),
    boi: tile('#f37021', 'BOI', '#fff', 16),
    bandhan: tile('#d71920', 'b', '#fff', 28),
    southindian: tile('#bc1f2d', 'SIB', '#fff', 16),
    ippb: tile('#e31e24', 'IPPB', '#ffd200', 13),
    mobikwik: tile('#0b5bd3', 'MK', '#fff', 17),
    muthoot: tile('#c8102e', 'M', '#ffd700', 24),
    saraswat: tile('#1c3f94', 'SB', '#fff', 18),
};

/**
 * Institution key, its matcher and its file (png in img/banks, or a DRAWN mark). The more specific names come
 * first: HDFC Life before HDFC, Indian Overseas before Indian Bank, Central Bank of India before Bank of India.
 */
const MATCHERS = [
    ['hdfclife', /hdfc\s*life/i], ['sbilife', /sbi\s*life/i], ['icicipru', /icici\s*pru/i], ['icicidirect', /icici\s*direct|icici\s*sec/i],
    ['paytmmoney', /paytm\s*money/i], ['zerodha', /zerodha|\bkite\b/i], ['kuvera', /kuvera/i], ['groww', /\bgroww\b/i], ['upstox', /upstox/i],
    ['angel', /angel\s*(one|broking)/i], ['indmoney', /\bind\s*money\b|indmoney/i], ['dhan', /\bdhan\b(?!\s*lax)/i], ['navi', /\bnavi\b/i],
    ['iob', /indian\s*overseas|\biob\b/i], ['central', /central\s*bank/i], ['union', /(?<!city\s*)union\s*bank|\bubi\b/i], ['bob', /bank\s*of\s*baroda|\bbob\b/i],
    ['bom', /bank\s*of\s*maharashtra|maha\s*bank|\bbom\b/i], ['sbi', /state\s*bank|\bsbi\b|yono/i], ['boi', /bank\s*of\s*india|\bboi\b/i],
    ['indian', /indian\s*bank/i], ['psb', /punjab\s*(&|and)?\s*sind|\bpsb\b/i], ['pnb', /punjab\s*national|\bpnb\b/i],
    ['hdfc', /hdfc/i], ['icici', /icici/i], ['axis', /\baxis\b/i], ['kotak', /kotak|\b811\b/i], ['canara', /canara/i],
    ['uco', /\buco\b/i], ['idfc', /idfc/i], ['indusind', /indus\s*ind/i], ['yes', /\byes\s*bank\b/i],
    ['federal', /federal/i], ['idbi', /\bidbi\b/i], ['rbl', /\brbl\b|ratnakar/i], ['bandhan', /bandhan/i], ['au', /\bau\s*(small|sfb|bank)/i],
    ['karnataka', /karnataka\s*bank/i], ['kvb', /karur|\bkvb\b/i], ['southindian', /south\s*indian|\bsib\b/i], ['cub', /city\s*union|\bcub\b/i],
    ['tmb', /tamilnad|\btmb\b/i], ['dhanlaxmi', /dhan\s*lax/i], ['jkbank', /j\s*&\s*k\s*bank|jammu/i], ['saraswat', /saraswat/i],
    ['equitas', /equitas/i], ['ujjivan', /ujjivan/i], ['tgb', /telangana\s*grameen|\btgb\b/i],
    ['dbs', /\bdbs\b|digibank/i], ['sc', /standard\s*chartered|\bscb\b/i], ['hsbc', /hsbc/i], ['citi', /\bciti/i], ['amex', /amex|american\s*express/i],
    ['ippb', /india\s*post\s*payments|\bippb\b/i], ['post', /post\s*office|india\s*post|\bpost\b/i], ['jio', /\bjio\b/i], ['airtel', /airtel/i],
    ['paytm', /paytm/i], ['phonepe', /phone\s*pe/i], ['gpay', /google\s*pay|\bgpay\b/i], ['amazonpay', /amazon/i], ['mobikwik', /mobikwik/i],
    ['jupiter', /jupiter/i], ['fi', /\bfi\s*money\b/i], ['onecard', /one\s*card/i], ['slice', /\bslice\b/i], ['uni', /\buni\s*(card|pay)/i],
    ['scapia', /scapia/i], ['cred', /\bcred\b/i], ['bajaj', /bajaj/i], ['muthoot', /muthoot/i],
    ['lic', /\blic\b|life\s*insurance\s*corp/i], ['nps', /\bnps\b|national\s*pension/i], ['epfo', /\bepf|provident\s*fund/i],
];

const NAMES = {
    sbi: 'State Bank of India', hdfc: 'HDFC Bank', icici: 'ICICI Bank', axis: 'Axis Bank', kotak: 'Kotak Mahindra Bank', pnb: 'Punjab National Bank',
    bob: 'Bank of Baroda', boi: 'Bank of India', union: 'Union Bank of India', canara: 'Canara Bank', idfc: 'IDFC FIRST Bank', yes: 'YES Bank',
};

/** The institution key of an account, or null. */
export function institutionOf(a) {
    const text = `${a.institution || ''} ${a.name || ''}`;
    return MATCHERS.find(([, re]) => re.test(text))?.[0] || null;
}

/** The institution's mark, or '' when it is not one we know. */
export function bankLogo(a, cls = '') {
    const key = institutionOf(a);
    if (!key) return '';
    const title = esc(a.institution || NAMES[key] || '');
    return DRAWN[key]
        ? `<span class="bank-logo drawn ${cls}" title="${title}">${DRAWN[key]}</span>`
        : `<span class="bank-logo ${cls}" title="${title}"><img src="img/banks/${key}.png" alt="" loading="lazy" decoding="async"></span>`;
}

/** The bank logo for an account, else its account-type chip. */
export function accountIcon(a, small = true) {
    return bankLogo(a, small ? 'sm' : '') || accountChip(a.accountType, small);
}
