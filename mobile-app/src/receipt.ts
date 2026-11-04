/**
 * Reading a bill's rows (as the phone read them, top to bottom: native BillOcr) into what the review screen offers:
 * the shop, the date, the reference, the bill total, and the lines: items (name, quantity × rate, amount) and the
 * adjustments printed under them (tax, discount, delivery or service charges, round off).
 *
 * Bills differ a lot (supermarket rolls, restaurant bills, pharmacy invoices, fuel slips), so it reads them the way a
 * person would: a row that ends in an amount and has a name is an item, unless its words say it is a total, a tax, a
 * discount, a charge or a payment line; a name on one row with its numbers on the next is joined. Then it checks the
 * sum: when the items already add up to the total, the tax printed under them is the tax inside the prices (Indian GST
 * bills print it that way) and is left out; otherwise the adjustments that make the sum come right are taken in.
 *
 * Item names carry no numbers but their units ("Amul Milk 500 ml", never a price, a code or a serial number), and a
 * row whose name is not words (a phone number, a GSTIN, a time, a column heading) is not an item. Each item gets a
 * score of how surely it is one (quantity × rate = amount is sure; a short code-like name is not).
 *
 * Before any amount is taken, the rows are understood as a table. A number in front of the words is a serial number or a
 * quantity, never an amount, and a code (0401) is not one either. Serial numbers running 1, 2, 3 mark where each item
 * starts, so an item's name and numbers on separate rows ("1 Amul Milk" / "2  28.00  56.00") are put together, and the
 * last serial says how many items the bill has. Rows where quantity × rate = amount prove which column holds the
 * amounts, and the rest of the bill is read the same way. On a bill that prints paise, a small whole number at the end
 * of a row is a quantity whose amount is elsewhere.
 *
 * The bill is read in up to READ_WAYS ways, each checked, and the one that matches with the fewest changes is kept.
 * The same photo may also be read several times, cleaned up differently (parseReads): one read may have an item right that
 * another has wrong, so each read's rows are matched by name to the others', and the amounts they give (most often, what
 * most of them agree on; or row by row, in the combinations that come to the total) are tried like any other reading.
 *
 * The read is then checked: against what the person said before scanning (what the bill comes to, how many items it
 * has), else against what the bill prints (its total, "Total items: 4"). When it does not match, fitBill looks for the
 * reading that does, in a fixed number of tries (MAX_TRIES, at most MAX_CHANGES changes), the smallest change first:
 *   - another column of numbers as the amounts (MRP, rate, amount and tax are all on the row), or every amount missing
 *     its decimal point;
 *   - a row misread: the decimal point missed or moved, a comma for the point, "125 50" for 125.50, another number on
 *     the row, quantity × rate where the row has them, one digit misread (8 for 3) when only one row can be it;
 *   - a row too many (read twice from overlapping parts, or not an item): set aside, shown, to put back with a tap;
 *   - a row too few (an item whose words looked like a heading, "Table Salt"): taken in.
 * A bill whose items add up to its own printed total is read right: the total entered is what differs, and no item is
 * changed for it. Each correction shows on its item with what was read, to undo.
 *
 * Categories are suggested per item: what the person chose before for the same item or shop (learned on each post,
 * kept on the phone), then the item's words (milk → Milk & Dairy, tomato → Vegetables ...), then the shop's.
 */
import { Category, isExpense } from './data';
import { matchCategory } from './sms';
import { isoDate } from './format';

export type LineKind = 'ITEM' | 'TAX' | 'DISCOUNT' | 'CHARGE';
export type BillLine = {
  id: string; kind: LineKind; name: string; qty: number | null; rate: number | null; amount: number;
  categoryId: number | null; /** an adjustment counted in the bill's sum (tax inside the prices is not) */ counted: boolean;
  /** how surely an item read is one, 0 to 1 */ score?: number;
  /** set aside: left out of the sum and the posting, shown to put back */ held?: boolean; note?: string;
  /** corrected to fit the bill: what the phone read, and why it was changed */ readAs?: number; fix?: string;
};
/** What the person said before scanning: the bill's total and how many items it has (either may be left out). */
export type Expect = { total?: number | null; count?: number | null; /** these were read off the bill, not said by the person */ from?: 'PRINTED' };
/** What sort of shop the bill is from: it decides the category before an item's own words do (paneer at a restaurant is a meal). */
export type BillKind = 'RESTAURANT' | 'PHARMACY' | 'FUEL' | 'SHOP';
export type ParsedBill = {
  merchant: string; date: string | null; reference: string | null; payment: string | null; total: number | null;
  lines: BillLine[]; rows: string[]; kind: BillKind;
  /** the total printed on the bill, when the person gave their own */ printedTotal?: number | null;
  /** how many items the bill says it has (printed, or its last serial) */ printedCount?: number | null;
  /** how the read was checked against the total and the count */ fit?: BillFit;
};
/** The check of a read: what it was checked against, whether it matched, how many readings were tried, what was changed. */
export type BillFit = {
  against: 'ENTERED' | 'PRINTED'; matched: boolean; totalOk: boolean | null; countOk: boolean | null; tries: number; steps: string[];
  /** what the items still lack when an item is missing: about what the missing one comes to */ missing: number | null;
  /** it matches only because a digit was guessed: not proof, so other reads are still tried and the person is told */ guessed?: boolean;
};
export type BillMemory = { items: Record<string, number>; shops: Record<string, { categoryId?: number; accountId?: number }> };

let seq = 0;
export const lineId = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

// ---------------------------------------------------------------------------------------------- numbers

/** OCR reads 0 as O and 5 as S inside numbers: put them back where a token is otherwise a number. */
function fixDigits(s: string): string {
  return s.replace(/\b[0-9OoSIl,.]*[0-9][0-9OoSIl,.]*\b/g, t => t.replace(/[Oo]/g, '0').replace(/S/g, '5').replace(/[Il]/g, '1'))
    // only in what is shaped like money ("5B.00"): a B or a Z elsewhere is part of a name ("Vit B12")
    .replace(/\b\d*[BZ]\d*[.,]\d{2}\b/g, t => t.replace(/B/g, '8').replace(/Z/g, '2'));
}

/** A decimal point read apart from its number, at the end of a row: "35 00", "35. 00", "35 .00" are 35.00. */
const closeDecimals = (s: string) => s.replace(/(\d)\s*[.,]\s+(\d{2})\s*$/, '$1.$2').replace(/(\d)\s+[.,](\d{2})\s*$/, '$1.$2').replace(/(\d)\s+00\s*$/, '$1.00');

const NUM = /(?:^|[\s:=x@*(₹]|rs\.?)(-?\d{1,3}(?:,\d{2,3})+(?:\.\d{1,3})?|-?\d+(?:\.\d{1,3})?)(?=$|[\s)%/]|\b)/gi;

type Num = { value: number; text: string; index: number; decimals: number; percent: boolean };

function numbers(row: string): Num[] {
  const out: Num[] = [];
  let m: RegExpExecArray | null;
  NUM.lastIndex = 0;
  while ((m = NUM.exec(row))) {
    const text = m[1];
    const index = m.index + m[0].indexOf(text);
    const after = row.slice(index + text.length, index + text.length + 2);
    out.push({ value: Number(text.replace(/,/g, '')), text, index, decimals: (text.split('.')[1] || '').length, percent: after.trim().startsWith('%') });
  }
  return out;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------------------------------------- what a row is

const TOTAL = /\b(grand\s*total|net\s*(amount|amt|total|payable|bill)|total\s*(amount|amt|payable|due|rs|inr|bill)?|amount\s*(payable|due|to\s*pay)|bill\s*(amount|amt|total)|to\s*pay|payable|total\s*value)\b/i;
const SUBTOTAL = /\b(sub\s*-?\s*total|total\s*before|taxable(\s*(value|amount|amt))?|gross\s*(amount|amt|total)?|basic\s*amount|total\s*qty|total\s*items|items?\s*total)\b/i;
const TAX = /\b(c\s?gst|s\s?gst|i\s?gst|u\s?gst|gst\b|vat\b|cess\b|service\s*tax|tax\b|taxes)/i;
const DISCOUNT = /\b(discount|disc\b|savings|you\s*saved|saved|coupon|offer|promo|less\b|cashback|loyalty|redeem(ed)?)/i;
const CHARGE = /\b(delivery|packing|packaging|pack(ing)?\s*charge|service\s*charge|convenience|handling|platform\s*fee|carry\s*bag|bag\s*charge|tips?\b|round(ed)?\s*off|rounding|r\/o\b)/i;
const PAYMENT = /\b(cash|card|upi|gpay|google\s*pay|phonepe|paytm|visa|master\s*card|rupay|debit|credit|wallet|tender(ed)?|change|paid|received|balance\s*(due|amt)?|refund)\b/i;
const META = /\b(gstin|gst\s*no|fssai|cin\b|pan\b|invoice|inv\b|inv\.|bill\s*(no|#|number)|vehicle|nozzle|pump\b|density|preset|receipt|order\s*(no|id|#)|token|kot|table|cover|cashier|server|steward|counter|terminal|pos\b|batch|tid\b|mid\b|auth|approval|rrn|stan\b|phone|ph\.?\b|mob(ile)?\b|tel\b|contact|email|www\.|\.com|thank|visit|again|welcome|time\b|date\b|hsn|sac\b|e\.?\s*&\s*o\.?\s*e|subject\s*to|jurisdiction|customer|cust\b|name\s*:|address|place\s*of\s*supply|state\s*code)\b/i;
/** "Rate: 102.86", "Volume(L): 9.72": the details of a slip (fuel, parking), not items. */
const SLIP = /\b(rate|qty|quantity|volume|vol|density|product|amount|amt|nozzle|vehicle|preset|litres?|ltrs?)\s*(\([^)]*\))?\s*[:=]/i;
/** A shop's address: a PIN code, or the words addresses are made of. */
const ADDRESS = /\b\d{6}\b|\b(road|rd\.?|street|st\.|nagar|main|cross|layout|colony|sector|phase|block|floor|near|opp\.?|behind|beside|plot|shop\s*no|dist\.?|taluk|mandal)\b/i;
const HEADER = /^(s\.?\s*no\.?\s+)?(item|items|particulars|description|product|qty|quantity|rate|price|mrp|amount|amt|total|value|unit|uom|hsn)(\s+|$)/i;
const COLUMN_HEADS = /\b(qty|quantity)\b.*\b(rate|price|amt|amount)\b|\b(item|particulars|description)\b.*\b(amt|amount|price)\b/i;

const letters = (s: string) => (s.match(/[a-z]/gi) || []).length;

/** "Tctal", "Totai", "Tota1": OCR's reading of the word total, one letter off. */
const looksLikeTotal = (row: string) => (row.match(/[a-z0-9]{5}/gi) || []).some(w => w.length === 5 && [...'total'].filter((c, i) => w[i].toLowerCase() === c).length >= 4)
  && !/\b[a-z0-9]{6,}\b.*\d/i.test(row.replace(/\b(grand|amount|payable|rupees)\b/gi, ''));

// ---------------------------------------------------------------------------------------------- item names

const UNIT = '(?:kgs?|g|gms?|grams?|mg|mcg|ml|l|lt|ltrs?|litres?|liters?|pcs?|pieces?|nos|pack|packs|pkts?|pouch|tabs?|tablets?|caps?|capsules?|s|dozen|dz'
  + '|sheets?|rolls?|sachets?|bottles?|btl|cm|mm|m|inch|in|ft|w|watts?|v|mah|gb|tb|oz|lbs?|units?|strips?)';
/** "500ml", "1.5kg", "15s", "2x500g": a number that is a size, not a price. */
const WITH_UNIT = new RegExp(`^\\d+(?:[.,]\\d+)?${UNIT}$|^\\d+x\\d+(?:[.,]\\d+)?${UNIT}?$`, 'i');
const UNIT_WORD = new RegExp(`^${UNIT}$`, 'i');
/** The whole number a row starts with, when words (not a unit, not "2 x") follow: a serial number, a quantity or a code. */
const LEAD = new RegExp(`^\\s*(\\d{1,4})[.)\\]:-]?\\s+(?!${UNIT}\\b|x\\b|[@*×])(?=[^\\d\\s.,])`, 'i');
const leadOf = (row: string) => { const m = row.match(LEAD); return m ? Number(m[1]) : null; };

/** The numbers of a row that can be its quantity, rate or amount: not what stands in front of its words, not a code with a leading zero. */
function rowNumbers(row: string): Num[] {
  const nums = numbers(row).filter(n => !/^0\d+$/.test(n.text));
  return leadOf(row) != null ? nums.filter(n => n.index > row.search(/\d/)) : nums;
}

/** Words that are a column, a unit or a currency on their own, never an item. */
const NOT_A_NAME = /^(qty|quantity|rate|price|mrp|amt|amount|total|item|items|nos?|pcs?|kgs?|gms?|ltrs?|rs|inr|each|ea|unit|uom|hsn|sac|disc|net|value|sl|sr|sno|description|particulars)$/i;

/**
 * An item's name as it should read: no numbers but its units ("Amul Taaza Milk 500 ml"), no codes, serial numbers,
 * prices or percentages, no unit word left over from the quantity column ("Tomato kg" → "Tomato").
 */
export function cleanItemName(raw: string): string {
  const tokens = raw.replace(/[|_~*#=[\]{}<>]+/g, ' ')
    .replace(/(\d)\s+(?=(?:kgs?|g|gms?|mg|ml|l|ltrs?|pcs?|nos|pack|pkts?)\b)/gi, '$1')   // "500 ml" is one size
    .split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const raw of tokens) {
    const t = raw.replace(/^[(:;,.-]+|[):;,.-]+$/g, '');
    if (!t) continue;
    if (/\d/.test(t)) {
      if (WITH_UNIT.test(t)) out.push(t.replace(/^(\d+(?:[.,]\d+)?)([a-z].*)$/i, '$1 $2'));
      continue;   // a price, a code, a serial number, a percentage, a date
    }
    if (/^[@x×&+/%₹.-]+$/i.test(t)) continue;
    out.push(t);
  }
  const loose = (w: string) => UNIT_WORD.test(w) || NOT_A_NAME.test(w);
  while (out.length > 1 && loose(out[out.length - 1]) && !/\d/.test(out[out.length - 2] || '')) out.pop();
  while (out.length > 1 && NOT_A_NAME.test(out[0])) out.shift();
  return titleCase(out.join(' '))
    .replace(/(\d) ([a-z]+)\b/gi, (m, d, u) => (!UNIT_WORD.test(u) ? m : u.toLowerCase() === 's' ? `${d}s` : `${d} ${u.toLowerCase()}`))   // "1 kg", "15s"
    .replace(/\s{2,}/g, ' ').trim().slice(0, 120);
}

/** Whether a name has a stray number in it (a price or a code; sizes are fine): for the review screen. */
export const hasStrayNumber = (name: string) => {
  const words = name.trim().split(/\s+/);
  return words.some((t, i) => /\d/.test(t) && !WITH_UNIT.test(t) && !(i + 1 < words.length && UNIT_WORD.test(words[i + 1])));
};

/** Whether a cleaned name can be an item: words, not an e-mail, a web address or a column heading. */
function isItemName(name: string): boolean {
  if (!/[a-z]{2,}/i.test(name)) return false;
  if (/@|www\.|\.com\b|https?:/i.test(name)) return false;
  return !name.split(/\s+/).every(w => NOT_A_NAME.test(w) || UNIT_WORD.test(w) || w.length < 2);
}

/**
 * How surely a row is an item, 0 to 1: quantity × rate making the amount is sure; paise printed, a name of real words
 * help; a short or code-like name, or a row more digits than letters, do not.
 */
function itemScore(row: string, name: string, amount: Num, qty: number | null): number {
  let s = 0.5;
  if (qty != null) s += 0.3;
  if (amount.decimals === 2) s += 0.1;
  const words = name.split(/\s+/).filter(w => /[a-z]{3,}/i.test(w));
  if (words.length >= 2) s += 0.1;
  if (letters(name) <= 3) s -= 0.25;
  if (/^[A-Z]{2,4}$/.test(name.replace(/\s/g, ''))) s -= 0.15;   // an abbreviation or a code
  if ((row.match(/\d/g) || []).length > letters(row) * 2) s -= 0.15;
  if (amount.decimals === 0 && amount.value >= 1000) s -= 0.1;
  return Math.max(0, Math.min(1, round2(s)));
}

/**
 * An item row split into its name and the numbers after it. When the row shows its columns (two spaces apart, as the
 * phone reads them), the name is the whole first column with words ("Dolo 650 Tab 15s") and only the later columns
 * count as numbers; otherwise the name is what comes before the first number.
 */
function split(row: string): { name: string; nums: Num[] } {
  const cells = row.split(/\s{2,}/);
  const first = cells.findIndex(c => letters(c) >= 2);
  if (cells.length > 1 && first >= 0 && first < cells.length - 1) {
    const rest = cells.slice(first + 1).join('  ');
    const nums = rowNumbers(rest);
    if (nums.length) return { name: tidyName(cells.slice(0, first + 1).join(' ')), nums };
  }
  const nums = rowNumbers(row);
  return { name: nameOf(row, nums), nums };
}

const tidyName = (name: string) => name
  .replace(/^\s*\d{1,3}[.)\]]?\s+/, '')
  .replace(/\b\d{6,}\b/g, ' ')
  .replace(/[|_~*#=]+/g, ' ')
  .replace(/\s{2,}/g, ' ')
  .replace(/[\s:.-]+$/, '')
  .trim();

/** The name part of an item row: the text before its numbers, without a serial number, unit or code in front. */
function nameOf(row: string, nums: Num[]): string {
  const cut = nums.length ? nums[0].index : row.length;
  let name = row.slice(0, cut);
  // the numbers may come first ("2 x Milk 56.00"): then take the words between the numbers
  if (letters(name) < 2) name = row.replace(NUM, ' ').replace(/[x@*]\s/gi, ' ');
  return name
    .replace(/^\s*\d{1,3}[.)\]]?\s+/, '')        // serial number
    .replace(/\b\d{6,}\b/g, ' ')                  // barcodes / HSN
    .replace(/[|_~*#=]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s:.-]+$/, '')
    .trim();
}

/** Quantity and rate from an item's numbers (the last is the amount): 2 × 45.00 = 90.00. */
function qtyRate(nums: Num[], amount: number): { qty: number | null; rate: number | null } {
  const rest = nums.slice(0, -1).filter(n => !n.percent && !(n.decimals === 0 && n.value >= 1000));
  for (let i = 0; i < rest.length; i++) {
    for (let j = 0; j < rest.length; j++) {
      if (i !== j && rest[i].value > 0 && rest[i].value <= 999 && near(rest[i].value * rest[j].value, amount, Math.max(1, amount * 0.01))) {
        return { qty: rest[i].value, rate: rest[j].value };
      }
    }
  }
  if (rest.length === 1) {
    const a = rest[0].value;
    if (near(a, amount, 0.01)) return { qty: 1, rate: amount };
    if (a > 0 && a <= 50 && a % 1 === 0 && amount / a >= 1) return { qty: a, rate: round2(amount / a) };
  }
  return { qty: null, rate: null };
}

// ---------------------------------------------------------------------------------------------- the bill

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function dateOf(rows: string[]): string | null {
  const today = new Date();
  const ok = (y: number, m: number, d: number) => {
    if (y < 100) y += 2000;
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    if (dt.getTime() > today.getTime() + 86400000 || y < today.getFullYear() - 3) return null;
    return isoDate(dt);
  };
  for (const raw of rows) {
    const r = fixDigits(raw);
    let m = r.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
    if (m) { const v = ok(+m[1], +m[2], +m[3]); if (v) return v; }
    m = r.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
    if (m) { const v = ok(+m[3], +m[2], +m[1]); if (v) return v; }
    m = r.match(/\b(\d{1,2})[\s-/.]*([a-z]{3})[a-z]*[\s-/.,]*(\d{2,4})\b/i);
    if (m && MONTHS.includes(m[2].toLowerCase())) { const v = ok(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]); if (v) return v; }
    m = r.match(/\b([a-z]{3})[a-z]*[\s-/.]*(\d{1,2})[\s,]+(\d{4})\b/i);
    if (m && MONTHS.includes(m[1].toLowerCase())) { const v = ok(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]); if (v) return v; }
  }
  return null;
}

const titleCase = (s: string) => (s === s.toUpperCase() && /[A-Z]{3}/.test(s) ? s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()) : s);

function merchantOf(rows: string[]): string {
  for (const r of rows.slice(0, 6)) {
    const t = r.replace(/\s{2,}/g, ' ').trim();
    if (letters(t) < 3 || META.test(t) || /^(tax\s*)?invoice|^cash\s*memo|^bill\b|^receipt|^estimate|^duplicate|^original/i.test(t)) continue;
    if ((t.match(/\d/g) || []).length > letters(t)) continue;   // an address or a phone number
    return titleCase(t.replace(/[^\w&'.\- ]/g, '').trim()).slice(0, 100);
  }
  return '';
}

function referenceOf(rows: string[]): string | null {
  for (const r of rows) {
    const m = r.match(/\b(?:bill|invoice|inv|receipt|order|txn|transaction)\s*(?:no|num(?:ber)?|#|id)?\s*[:.#-]?\s*([A-Z0-9][A-Z0-9/\-]{2,24})\b/i);
    if (m && /\d/.test(m[1])) return m[1];
  }
  return null;
}

function kindOf(rows: string[], merchant: string): BillKind {
  const head = `${merchant} ${rows.slice(0, 8).join(' ')}`;
  const all = rows.join(' ');
  if (/\b(petrol|diesel|fuel|filling|indian\s*oil|iocl|bharat\s*petroleum|bpcl|hpcl|hp\s*pay|shell|nayara|cng)\b/i.test(head)) return 'FUEL';
  if (/\b(pharmac|chemist|medical|druggist|apollo\s*pharmacy|medplus|1mg|netmeds|pharmeasy|wellness)/i.test(head)) return 'PHARMACY';
  if (/\b(restaurant|cafe|caf\u00e9|hotel|dhaba|bistro|kitchen|biryani|grill|bar\b|eatery|food\s*court|bakery\s*&\s*cafe)\b/i.test(head)
    || /\b(table\s*(no)?\s*[:#]?\s*\d|covers?\b|kot\b|steward|waiter|service\s*charge|dine\s*in|takeaway)/i.test(all)) return 'RESTAURANT';
  return 'SHOP';
}

function paymentOf(rows: string[]): string | null {
  const text = rows.join(' ').toLowerCase();
  if (/\bupi\b|gpay|google pay|phonepe|paytm|bhim/.test(text)) return 'UPI';
  if (/\b(card|visa|master|rupay|credit|debit)\b/.test(text)) return 'CARD';
  if (/\bcash\b/.test(text)) return 'CASH';
  return null;
}

/** Reads a bill's rows and checks the read against what the person expects, else against what the bill prints. */
export function parseBill(rawRows: string[], expect: Expect = {}, others: OtherItem[][] = [], tries = MAX_TRIES): ParsedBill {
  let best: ParsedBill | null = null;
  const seen = new Set<string>();
  for (const way of READ_WAYS) {
    const { bill, clues } = readBill(rawRows, way);
    clues.others = others;
    // what another read found that this one has no row for
    others.forEach(read => read.forEach(o => {
      if (!bill.lines.some(l => l.kind === 'ITEM' && sameItem(l.name, o.name)) && !clues.skipped.some(r => sameItem(r.name, o.name))) {
        clues.skipped.push({ ...o, cost: 0.8, why: 'another read of the bill found it' });
      }
    }));
    // a way of reading that gives the same items has nothing new to check
    const key = bill.lines.map(l => `${l.kind}${l.name}${l.amount}`).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const fitted = fitBill(bill, clues, expect, tries / READ_WAYS.length);
    best = best ? betterFit(best, fitted) : fitted;
    if (best.fit?.matched && !best.fit.steps.length) break;
  }
  return best!;
}

/**
 * The ways a bill is read. table: serial numbers mark the items, whatever rows they spread over. paise: on a bill that
 * prints paise, a small whole number ending a row is not its amount. Each is an assumption a bill may break, so the
 * check against the total and the count decides.
 */
type ReadWay = { table: boolean; paise: boolean };
const READ_WAYS: ReadWay[] = [{ table: true, paise: true }, { table: true, paise: false }, { table: false, paise: false }];

type Serials = { at: number[]; last: number };

/**
 * The serial column: rows starting 1, 2, 3 (one number may be missed by the phone), in the table part of the bill. None
 * when other rows also start with a number that does not fit: those numbers are quantities.
 */
function serialsOf(rows: string[]): Serials | null {
  const head = rows.findIndex(r => COLUMN_HEADS.test(r) || HEADER.test(r));
  const lead = (r: string) => leadOf(r) ?? (/^\d{1,3}[.)]?$/.test(r.trim()) ? parseInt(r, 10) : null);
  const at: number[] = [];
  let next = 1, others = 0;
  for (let i = head + 1; i < rows.length; i++) {
    if (TOTAL.test(rows[i]) && !at.length && head < 0) continue;
    if (TOTAL.test(rows[i]) || SUBTOTAL.test(rows[i])) break;
    const n = lead(rows[i]);
    if (n == null) continue;
    if (n === next || (at.length && n === next + 1)) { at.push(i); next = n + 1; } else if (at.length || head >= 0) others++;
  }
  return at.length >= 2 && others === 0 ? { at, last: next - 1 } : null;
}

/** A row that closes the items above it. */
const closesItems = (r: string) => TOTAL.test(r) || SUBTOTAL.test(r) || ((TAX.test(r) || DISCOUNT.test(r) || CHARGE.test(r)) && rowNumbers(r).length > 0);

/**
 * Each serial with what belongs to it, on one row: the name may wrap, the numbers may be on the row below (or, on a bill
 * slanting up to the right, the amount just above). A row with a name and an amount of its own is its own item.
 */
function joinBySerial(rows: string[], serials: Serials): string[] {
  const parts = (r: string) => {
    const p = split(r.replace(LEAD, '').replace(/^\s*\d{1,3}[.)]?\s*$/, ''));
    return { name: letters(p.name) >= 2 ? p.name : '', nums: p.nums };
  };
  const bare = (r: string) => letters(r) === 0 && rowNumbers(r).length === 1 && rowNumbers(r)[0].decimals > 0;
  const written = (nums: Num[]) => nums.map(n => `${n.text}${n.percent ? '%' : ''}`).join('  ');
  const starts = new Set(serials.at);
  // the amount just above its serial: every serial row without a number has a lone amount over it
  const empty = serials.at.filter(i => !parts(rows[i]).nums.length);
  const above = empty.length >= 2 && empty.filter(i => i > 0 && bare(rows[i - 1])).length === empty.length && !bare(rows[empty[empty.length - 1] + 1] || '');
  const out: string[] = [];
  const used = new Set<number>();
  rows.forEach((row, i) => {
    if (used.has(i)) return;
    if (above && i + 1 < rows.length && starts.has(i + 1) && bare(row) && !parts(rows[i + 1]).nums.length) return;
    if (!starts.has(i)) { out.push(row); return; }
    const lead = leadOf(row) ?? parseInt(row, 10);
    const first = parts(row);
    const names = first.name ? [first.name] : [];
    let nums = first.nums;
    if (above && !nums.length && bare(rows[i - 1] || '')) nums = rowNumbers(rows[i - 1]);
    for (let j = i + 1; j < rows.length && j <= i + 4 && !starts.has(j) && !closesItems(rows[j]); j++) {
      if (META.test(rows[j])) { used.add(j); continue; }
      const p = parts(rows[j]);
      if (nums.length && p.nums.length) break;   // its own item, without a serial
      if (above && bare(rows[j])) break;
      if (nums.length && !p.name) break;
      if (p.name) names.push(p.name);
      if (p.nums.length) nums = p.nums;
      used.add(j);
    }
    // no amount anywhere: the serial is all there is to take, and it is not an amount
    if (nums.length) out.push(`${lead} ${names.join(' ')}  ${written(nums)}`);
  });
  return out;
}

/** Whether the bill prints paise: most of its rows with words end in an amount with two decimals. */
function printsPaise(rows: string[]): boolean {
  const ends = rows.filter(r => letters(r) >= 2 && !META.test(r)).map(r => rowNumbers(r).filter(n => !n.percent).pop()).filter(Boolean) as Num[];
  return ends.filter(n => n.decimals === 2).length >= 3 && ends.filter(n => n.decimals === 2).length / ends.length >= 0.6;
}

/**
 * Which column holds the amounts, from the rows that prove it: where quantity × rate = a number on the row, that number
 * is the amount. Counted from the right, for rows with a tax or a discount after it. 0 when the last column it is.
 */
function amountColumn(rows: Num[][]): number {
  const votes = new Map<number, number>();
  for (const cols of rows) {
    for (let k = cols.length - 1; k >= 2; k--) {
      const a = cols[k].value;
      let proved = false;
      for (let i = 0; i < k && !proved; i++) for (let j = i + 1; j < k && !proved; j++) proved = cols[i].value <= 999 && a >= 1 && near(cols[i].value * cols[j].value, a, Math.max(0.05, a * 0.005));
      if (proved) { const from = cols.length - 1 - k; votes.set(from, (votes.get(from) || 0) + 1); break; }
    }
  }
  const [best, n] = [...votes.entries()].sort((x, y) => y[1] - x[1])[0] || [0, 0];
  return n >= 2 ? best : 0;
}

/** What the read keeps for the check: each item's numbers, the rows that did not look like items, what the bill prints. */
type Skipped = { name: string; amount: number; qty: number | null; rate: number | null; cost?: number; why?: string };
/** An item as another read of the same bill has it. */
type OtherItem = { name: string; amount: number; qty: number | null; rate: number | null };
type Clues = { cols: Map<string, Num[]>; skipped: Skipped[]; totals: Num[]; printedCount: number | null; notes: string[]; others: OtherItem[][] };

const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
/** Whether two reads of a row name the same item: OCR changes a letter or two, or loses a word off the end. */
function sameItem(a: string, b: string): boolean {
  const x = nameKey(a), y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x))) return true;
  return Math.min(x.length, y.length) >= 3 && 1 - editDistance(x, y) / Math.max(x.length, y.length) >= 0.6;
}

/** "Total items: 4", "No. of items 4", "Total qty: 5": how many the bill says it has. */
const PRINTED_COUNT = /\b(?:total\s*(?:items?|qty|quantity)|no\.?\s*of\s*items?|items?\s*count)\s*[:=-]?\s*(\d{1,3})\b(?![.,]\d)/i;

function readBill(rawRows: string[], way: ReadWay): { bill: ParsedBill; clues: Clues } {
  const rows = rawRows.map(r => closeDecimals(fixDigits(r).replace(/\t/g, '  ').trim())).filter(Boolean);
  const serials = serialsOf(rows);
  const table = way.table && serials ? joinBySerial(rows, serials) : rows;
  const paise = way.paise && printsPaise(table);
  const lines: BillLine[] = [];
  const totals: { value: number; strong: boolean; at: number; num: Num }[] = [];
  const clues: Clues = { cols: new Map(), skipped: [], totals: [], printedCount: null, notes: [], others: [] };
  let pendingName = '';
  let pastTotal = false;
  // a row among the items that its words say is not one: kept, in case the bill is an item short
  const skip = (row: string, nums: Num[], amount: number) => {
    if (pastTotal || !lines.some(l => l.kind === 'ITEM') || nums.length < 2) return;
    const name = cleanItemName(split(row).name);
    if (isItemName(name)) clues.skipped.push({ name, amount: round2(amount), ...qtyRate(nums, amount) });
  };

  table.forEach((row, at) => {
    let nums = rowNumbers(row).filter(n => !(n.decimals === 0 && n.value >= 100000));   // phone numbers, barcodes
    const words = letters(row);
    // whole numbers all in front of the words ("2 x Milk"): the amount is not on this row
    const firstLetter = row.search(/[a-z]/i);
    if (firstLetter >= 0 && nums.every(n => n.index < firstLetter && n.decimals === 0)) nums = [];
    if (clues.printedCount === null) { const c = row.match(PRINTED_COUNT); if (c) clues.printedCount = Number(c[1]); }
    if (HEADER.test(row) || COLUMN_HEADS.test(row)) { pendingName = ''; return; }
    // the shop's address and phone at the top are not items
    if (!lines.length && !totals.length && at < 8 && ADDRESS.test(row) && !nums.some(n => n.decimals > 0)) { pendingName = ''; return; }
    if (!nums.length) {
      // a name whose numbers are on the next row
      pendingName = words >= 3 && !META.test(row) && !SLIP.test(row) && !TOTAL.test(row) && !pastTotal ? row.replace(/\s{2,}/g, ' ').trim() : '';
      return;
    }
    // the amount: the last number that is not a percentage (the GST rate may come after it)
    const last = [...nums].reverse().find(n => !n.percent) || nums[nums.length - 1];
    const amount = Math.abs(last.value);
    if (!amount || last.percent) { pendingName = ''; return; }

    if (SUBTOTAL.test(row)) { pendingName = ''; return; }
    if ((TOTAL.test(row) || looksLikeTotal(row)) && !TAX.test(row.replace(/total/i, ''))) {
      totals.push({ value: amount, strong: /grand|net|payable|to\s*pay|bill\s*amount/i.test(row), at, num: last });
      pastTotal = true; pendingName = '';
      return;
    }
    if (PAYMENT.test(row) && (pastTotal || words < 14)) { skip(row, nums, amount); pendingName = ''; return; }
    if (SLIP.test(row)) { pendingName = ''; return; }
    if (META.test(row) && !TAX.test(row)) { skip(row, nums, amount); pendingName = ''; return; }
    if (TAX.test(row) && !/gstin/i.test(row)) {
      lines.push({ id: lineId(), kind: 'TAX', name: row.replace(NUM, ' ').replace(/[%@:]+/g, ' ').replace(/\s{2,}/g, ' ').trim() || 'Tax', qty: null, rate: null,
        amount, categoryId: null, counted: false });
      pendingName = '';
      return;
    }
    if (DISCOUNT.test(row)) {
      lines.push({ id: lineId(), kind: 'DISCOUNT', name: nameOf(row, nums) || 'Discount', qty: null, rate: null, amount, categoryId: null, counted: false });
      pendingName = '';
      return;
    }
    if (CHARGE.test(row)) {
      const roundOff = /round|r\/o/i.test(row);
      lines.push({ id: lineId(), kind: roundOff && last.value < 0 ? 'DISCOUNT' : 'CHARGE', name: nameOf(row, nums) || (roundOff ? 'Round off' : 'Charges'),
        qty: null, rate: null, amount, categoryId: null, counted: false });
      pendingName = '';
      return;
    }
    if (pastTotal) return;   // below the total: payment details, tax summaries, messages
    // a bill that prints paise: a small whole number ending the row is its quantity, the amount is on the next row or lost
    if (paise && last.decimals === 0 && last.value < 100 && words >= 2) {
      const next = table[at + 1] || '';
      const named = split(row).name;
      pendingName = letters(next) < 2 && rowNumbers(next).length ? named : '';
      if (!pendingName) skip(row, [last, last], amount);
      return;
    }
    const parts = split(row);
    let name = parts.name;
    if (letters(name) < 2 && pendingName) name = pendingName;
    else if (pendingName && letters(name) >= 2 && words < 6) name = `${pendingName} ${name}`;
    pendingName = '';
    name = cleanItemName(name);
    if (!isItemName(name)) return;   // a phone number, a time, a heading: no words to be an item
    const cols = (parts.nums.length ? parts.nums : nums).filter(n => !n.percent && n.value > 0);
    let { qty, rate } = qtyRate(cols.length ? cols : nums, amount);
    // a number in front of the words, where the bill has no serial column, is how many
    const lead = leadOf(row);
    if (qty == null && !serials && lead != null && lead >= 1 && lead <= 50 && amount / lead >= 1) { qty = lead; rate = round2(amount / lead); }
    const line: BillLine = { id: lineId(), kind: 'ITEM', name, qty, rate, amount: round2(amount), categoryId: null, counted: true, score: itemScore(row, name, last, qty) };
    // close to quantity × rate but not it, by a digit: 1274.08 for 2 × 637.00. The row's own numbers settle it
    if (qty != null && rate != null && qty !== 1 && cols.length >= 3) {
      const made = round2(qty * rate);
      if (!near(made, line.amount, 0.01) && digitCost(last.text, made) != null) { line.readAs = line.amount; line.fix = 'quantity × rate'; line.amount = made; }
    }
    // the row checks itself: quantity × rate is what the amount should be, when the amount is a misreading of it
    if (qty == null && cols.length >= 3) {
      const [q, r, a] = cols.slice(-3);
      const made = round2(q.value * r.value);
      if (q.value <= 999 && made > 0 && (numberVariants(a, r).some(v => near(v.value, made, 0.01)) || digitCost(a.text, made) != null)) {
        line.readAs = line.amount; line.fix = 'quantity × rate';
        line.amount = made; line.qty = q.value; line.rate = r.value; line.score = Math.max(line.score || 0, 0.7);
      }
    }
    clues.cols.set(line.id, cols);
    lines.push(line);
  });

  // rows that prove where the amount is: the whole bill is read from that column
  const items = lines.filter(l => l.kind === 'ITEM');
  const column = amountColumn(items.map(l => clues.cols.get(l.id) || []));
  if (column > 0) {
    clues.notes.push(`Amounts read from the column quantity × rate comes to, ${column + 1} from the right`);
    items.forEach(l => {
      const cols = clues.cols.get(l.id) || [];
      const n = cols[cols.length - 1 - column];
      if (!n) return;
      l.amount = round2(n.value);
      Object.assign(l, qtyRate(cols.slice(0, cols.length - column), n.value));
    });
  }
  // the last serial is how many items the bill has, when the serials mark most of what was read
  if (clues.printedCount === null && serials && serials.at.length >= items.length * 0.7) clues.printedCount = serials.last;

  // no total found, and the last "item" comes to what the others do: it is the total, its word misread
  const lastItem = items[items.length - 1];
  if (!totals.length && items.length >= 3 && near(lastItem.amount, items.slice(0, -1).reduce((t, l) => t + l.amount, 0), Math.max(1, lastItem.amount * 0.01))) {
    lines.splice(lines.indexOf(lastItem), 1);
    const cols = clues.cols.get(lastItem.id) || [];
    const n = cols[cols.length - 1];
    if (n) totals.push({ value: lastItem.amount, strong: false, at: rows.length, num: n });
  }

  // the total: a grand / net total if printed, else the last total; failing that, the sum
  const strong = totals.filter(t => t.strong);
  const total = (strong.length ? Math.max(...strong.map(t => t.value)) : totals.length ? totals[totals.length - 1].value : null);
  const merchant = merchantOf(rows);
  // a slip with no item rows (a fuel slip, a parking ticket): one line for the whole bill, named after what was bought
  if (!lines.some(l => l.kind === 'ITEM') && total) {
    const product = rows.map(r => r.match(/\b(?:product|item|fuel|description)\s*[:-]\s*([a-z][a-z .-]{1,40})/i)?.[1]).find(Boolean);
    lines.unshift({ id: lineId(), kind: 'ITEM', name: cleanItemName(product || merchant || 'Bill') || 'Bill', qty: null, rate: null, amount: total, categoryId: null, counted: true, score: 0.4 });
  }
  clues.totals = totals.map(t => t.num);
  const bill: ParsedBill = { merchant, date: dateOf(rows), reference: referenceOf(rows), payment: paymentOf(rows), total, lines, rows, kind: kindOf(rows, merchant) };
  return { bill: reconcile(bill), clues };
}

/**
 * Which adjustments count in the sum: when the items alone make the total, the tax printed is inside the prices and
 * nothing else counts; otherwise each set of adjustments (charges, discounts, then tax) is taken in when it brings the
 * sum to the total. With no total printed, the total is what the items and adjustments add up to.
 */
export function reconcile(bill: ParsedBill): ParsedBill {
  const items = bill.lines.filter(l => l.kind === 'ITEM' && !l.held);
  const sum = (ls: BillLine[]) => ls.reduce((s, l) => s + (l.kind === 'DISCOUNT' ? -l.amount : l.amount), 0);
  const itemSum = sum(items);
  const adj = bill.lines.filter(l => l.kind !== 'ITEM');
  const tol = (t: number) => Math.max(1, t * 0.005);
  let counted = new Set<string>();
  if (bill.total != null && !near(itemSum, bill.total, tol(bill.total))) {
    const groups = [adj.filter(l => l.kind === 'CHARGE' || l.kind === 'DISCOUNT'), adj.filter(l => l.kind === 'TAX'), adj];
    for (const g of groups) {
      if (near(itemSum + sum(g), bill.total, tol(bill.total))) { counted = new Set(g.map(l => l.id)); break; }
    }
  }
  const lines = bill.lines.map(l => (l.kind === 'ITEM' ? l : { ...l, counted: counted.has(l.id) }));
  const total = bill.total ?? round2(itemSum + sum(adj.filter(l => l.kind !== 'TAX')));
  return { ...bill, lines, total: total > 0 ? total : null };
}

/** What the items and the counted adjustments add up to (items set aside left out). */
export function billSum(lines: BillLine[]): number {
  return round2(lines.filter(l => (l.kind === 'ITEM' && !l.held) || (l.kind !== 'ITEM' && l.counted)).reduce((s, l) => s + (l.kind === 'DISCOUNT' ? -l.amount : l.amount), 0));
}

// ---------------------------------------------------------------------------------------------- fitting the read to the bill

/** The most readings tried on one bill, and the most changes in one reading: a bill always comes back quickly. */
export const MAX_TRIES = 60000;
export const MAX_CHANGES = 3;
/** What "matches" allows: a bill's round off, when its total is in whole rupees (one with paise is not rounded). */
const MATCH_TOLERANCE = 1;
const toleranceFor = (total: number) => (total % 1 === 0 ? MATCH_TOLERANCE : 0.05);
/** Digits OCR takes for one another on thermal paper. */
const LOOK_ALIKE = new Set(['0-8', '0-6', '0-9', '1-7', '3-8', '5-6', '5-8', '6-8', '8-9', '2-7', '4-9', '1-4']);

type Variant = { value: number; cost: number; why: string };

/** What a number read may have been: the decimal point missed or moved, a comma for the point, split in two. */
function numberVariants(n: Num, before?: Num): Variant[] {
  const out: Variant[] = [];
  const digits = n.text.replace(/\D/g, '').length;
  const add = (value: number, cost: number, why: string) => { if (value > 0 && !near(value, n.value, 0.001)) out.push({ value: round2(value), cost, why }); };
  if (before && before.decimals === 0 && /^\d{2}$/.test(n.text)) add(Number(`${before.value}.${n.text}`), 0.5, `${before.text} ${n.text} is ${before.text}.${n.text}`);
  if (/^\d{1,3},\d{2}$/.test(n.text)) add(Number(n.text.replace(',', '.')), 0.5, 'a comma read for the decimal point');
  if (n.decimals === 0 && digits >= 3) add(n.value / 100, 0.6, 'the decimal point was missed');
  if (n.decimals === 3) add(n.value * 1000, 0.6, 'a point read for a thousands comma');
  if (n.decimals === 0 && digits >= 3 && n.value % 10 === 0) add(n.value / 10, 1.2, 'the decimal point was moved');
  if (n.decimals > 0) {
    add(n.value * 10, 1.2, 'the decimal point was moved');
    add(n.value / 10, 1.2, 'the decimal point was moved');
    add(n.value * 100, 1.4, 'a stray decimal point');
  }
  return out;
}

/** How like the digits of a number read another value is: one digit misread, dropped or added, or two swapped; null when not. */
function digitCost(text: string, value: number): number | null {
  const a = Number(text.replace(/,/g, '')).toFixed(2).replace('.', '');
  const b = value.toFixed(2).replace('.', '');
  if (a === b) return null;
  if (a.length === b.length) {
    const at: number[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) at.push(i);
    if (at.length === 1) {
      const [x, y] = [a[at[0]], b[at[0]]].sort();
      return LOOK_ALIKE.has(`${x}-${y}`) ? 1.5 : 2.5;
    }
    return at.length === 2 && at[1] === at[0] + 1 && a[at[0]] === b[at[1]] && a[at[1]] === b[at[0]] ? 2.5 : null;
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  if (long.length !== short.length + 1) return null;
  for (let i = 0; i < long.length; i++) if (long.slice(0, i) + long.slice(i + 1) === short) return 2.5;
  return null;
}

type Move = { kind: 'FIX' | 'HOLD' | 'ADD'; line?: BillLine; skipped?: Skipped; delta: number; items: number; cost: number; value?: number; why?: string; guess?: boolean };
/** The amounts of a reading: as read, or a column of numbers taken for them. */
type Reading = { label: string | null; amounts: Map<string, number>; sum: number; cost: number; agreed?: boolean };
/** What the items must come to, with these adjustments counted. */
type Target = { items: number; adjustments: Set<string>; cost: number };
type Solution = { reading: Reading; target: Target; moves: Move[]; cost: number };

const signed = (l: BillLine) => (l.kind === 'DISCOUNT' ? -l.amount : l.amount);
const pieces = (qty: number | null | undefined) => (qty && qty % 1 === 0 ? qty : 1);

/** The sums the items may have to make: the adjustments as reconcile takes them (main), then any of them (all). */
function targetsFor(adj: BillLine[], total: number): { main: Target[]; all: Target[] } {
  const seen = new Map<number, Target>();
  const add = (set: BillLine[], cost: number) => {
    const items = round2(total - set.reduce((s, l) => s + signed(l), 0));
    if (items > 0 && !seen.has(items)) seen.set(items, { items, adjustments: new Set(set.map(l => l.id)), cost });
  };
  add([], 0);
  add(adj.filter(l => l.kind === 'CHARGE' || l.kind === 'DISCOUNT'), 0.1);
  add(adj.filter(l => l.kind === 'TAX'), 0.1);
  add(adj, 0.1);
  const main = [...seen.values()];
  if (adj.length <= 6) for (let mask = 1; mask < 1 << adj.length; mask++) add(adj.filter((_, i) => mask & (1 << i)), 0.4);
  return { main, all: [...seen.values()] };
}

/** A row that proves its own amount: quantity × rate comes to it. */
const proved = (l: BillLine, amount: number) => !!l.qty && !!l.rate && l.qty !== 1 && near(l.qty * l.rate, amount, Math.max(0.05, amount * 0.005));

/** The readings to try: as read, then each column of numbers (from the right, from the left), then with the decimals put back; the nearest the total first. */
function readingsOf(items: BillLine[], clues: Clues, total: number): Reading[] {
  const asRead: Reading = { label: null, amounts: new Map(items.map(l => [l.id, l.amount] as [string, number])), sum: round2(items.reduce((s, l) => s + l.amount, 0)), cost: 0 };
  const rest: Reading[] = [];
  const agreed = agreedReading(items, clues);
  const start = agreed && agreed.sum !== asRead.sum ? [asRead, agreed] : [asRead];
  if (items.length < 2) return start;
  // rows that prove their amounts settle which column the amounts are in
  if (items.some(l => proved(l, l.amount)) || items.filter(l => (clues.cols.get(l.id) || []).length >= 3 && l.qty != null).length >= Math.max(2, items.length / 2)) return start;
  const seen = new Set([asRead.sum]);
  const column = (label: string, pick: (cols: Num[]) => Num | undefined, scale: number, cost: number) => {
    let found = 0;
    const amounts = new Map<string, number>();
    items.forEach(l => {
      const n = pick(clues.cols.get(l.id) || []);
      if (n) found++;
      amounts.set(l.id, n ? round2(n.value * scale) : l.amount);
    });
    const sum = round2([...amounts.values()].reduce((s, v) => s + v, 0));
    if (found / items.length < 0.6 || seen.has(sum)) return;
    // quantities or serials are not amounts, even when they happen to add up
    const picked = items.map(l => pick(clues.cols.get(l.id) || [])).filter(Boolean) as Num[];
    if (scale === 1 && picked.every(n => n.decimals === 0 && n.value < 100) && items.some(l => (clues.cols.get(l.id) || []).some(n => n.decimals > 0))) return;
    seen.add(sum);
    rest.push({ label, amounts, sum, cost });
  };
  [1, 2, 3].forEach(j => column(`the column ${j + 1} from the right`, c => c[c.length - 1 - j], 1, 0.3 + j * 0.1));
  [0, 1, 2].forEach(j => column(`the column ${j + 1} from the left`, c => c[j], 1, 0.5 + j * 0.1));
  const whole = (c: Num[]) => { const n = c[c.length - 1]; return n && n.decimals === 0 ? n : undefined; };
  column('the amounts, their decimal points put back', whole, 0.01, 0.4);
  column('the amounts, their decimal points put back', whole, 0.1, 0.8);
  rest.sort((a, b) => Math.abs(a.sum - total) - Math.abs(b.sum - total) || a.cost - b.cost);
  return [...start, ...rest];
}

/** Each row's amount in the other reads of the bill. */
const otherAmounts = (l: BillLine, clues: Clues) => clues.others.map(read => read.find(o => sameItem(o.name, l.name))).filter(Boolean) as OtherItem[];
const provesItself = (o: OtherItem) => !!o.qty && !!o.rate && o.qty !== 1 && near(o.qty * o.rate, o.amount, Math.max(0.05, o.amount * 0.005));

/** What the reads agree on, row by row: a read whose row proves its amount first, else what most of them say. */
function agreedReading(items: BillLine[], clues: Clues): Reading | null {
  if (!clues.others.length) return null;
  const amounts = new Map<string, number>();
  items.forEach(l => {
    const seen = otherAmounts(l, clues);
    const sure = seen.find(provesItself);
    if (proved(l, l.amount) || !seen.length) { amounts.set(l.id, l.amount); return; }
    if (sure) { amounts.set(l.id, sure.amount); return; }
    const votes = new Map<number, number>([[l.amount, 1]]);
    seen.forEach(o => votes.set(o.amount, (votes.get(o.amount) || 0) + 1));
    const [top, n] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    amounts.set(l.id, n > (votes.get(l.amount) || 0) ? top : l.amount);
  });
  return { label: 'what most reads of the bill agree on', amounts, sum: round2([...amounts.values()].reduce((s, v) => s + v, 0)), cost: 0.2, agreed: true };
}

/** The changes a reading can take, the cheapest first: a number on a row read differently, a row set aside, a skipped row taken in. */
function movesOf(reading: Reading, items: BillLine[], clues: Clues, total: number): Move[] {
  const moves: Move[] = [];
  const twin = (l: BillLine) => items.some(o => o !== l && o.name.toLowerCase() === l.name.toLowerCase() && near(o.amount, l.amount, 0.01));
  for (const l of items) {
    const now = reading.amounts.get(l.id)!;
    const cols = clues.cols.get(l.id) || [];
    const at = cols.findIndex(n => near(n.value, now, 0.001));
    if (proved(l, now)) {   // its numbers agree: it may be a row too many, but it is not misread
      if (items.length > 1) moves.push({ kind: 'HOLD', line: l, delta: -now, items: -1, cost: twin(l) ? 0.4 : 1.5 });
      continue;
    }
    const options: Variant[] = at >= 0 ? numberVariants(cols[at], at > 0 ? cols[at - 1] : undefined) : [];
    otherAmounts(l, clues).forEach(o => options.push({ value: o.amount, cost: provesItself(o) ? 0.1 : 0.3, why: 'another read of the bill' }));
    const paised = cols.some(c => c.decimals > 0);
    cols.forEach((c, i) => { if (i !== at && c.value >= 1 && !(paised && c.decimals === 0 && c.value < 100)) options.push({ value: c.value, cost: 0.8, why: 'another number on the row' }); });
    if (cols.length >= 3) {
      cols.forEach((q, i) => cols.forEach((r, j) => {
        if (i < j && q.value <= 999 && i !== at && j !== at) options.push({ value: round2(q.value * r.value), cost: 0.3, why: 'quantity × rate' });
      }));
    }
    const seen = new Set<number>([now]);
    for (const v of options.sort((x, y) => x.cost - y.cost)) {
      if (v.value <= 0 || seen.has(v.value) || v.value > total * 1.2) continue;
      seen.add(v.value);
      moves.push({ kind: 'FIX', line: l, delta: round2(v.value - now), items: 0, cost: v.cost, value: v.value, why: v.why });
    }
    if (items.length > 1) moves.push({ kind: 'HOLD', line: l, delta: -now, items: -1, cost: twin(l) ? 0.4 : 0.5 + (l.score ?? 0.5) * 1.5 });
  }
  for (const r of clues.skipped) moves.push({ kind: 'ADD', skipped: r, delta: r.amount, items: 1, cost: r.cost ?? 1.5 });
  return moves.sort((a, b) => a.cost - b.cost);
}

/** Lines, or pieces across the lines (2 of one item are two): either way of counting a bill's items. */
export function countMatches(lines: BillLine[], count: number): boolean {
  const items = lines.filter(l => l.kind === 'ITEM' && !l.held && l.amount > 0);
  return items.length === count || items.reduce((s, l) => s + pieces(l.qty), 0) === count;
}

/** How many of the cheapest changes are combined at each depth: what keeps three changes within the tries. */
const MOVE_LIMIT = [0, Infinity, 120, 40];

type Search = { items: BillLine[]; clues: Clues; count: number | null; guesses: boolean; tolerance: number; tries: { n: number; limit: number } };

/** Every way `depth` changes make the reading come to a target (and the count fit), until the tries run out. */
function solutionsAt(reading: Reading, depth: number, moves: Move[], targets: Target[], { items, clues, count, guesses, tolerance, tries }: Search): Solution[] {
  const out: Solution[] = [];
  const list = moves.slice(0, MOVE_LIMIT[depth]);
  const countFits = (m: Move[]) => {
    if (count == null || items.length + m.reduce((s, x) => s + x.items, 0) === count) return true;
    const gone = new Set(m.filter(x => x.kind === 'HOLD').map(x => x.line!.id));
    return items.filter(l => !gone.has(l.id)).reduce((s, l) => s + pieces(l.qty), 0) + m.reduce((s, x) => s + (x.skipped ? pieces(x.skipped.qty) : 0), 0) === count;
  };
  const leaf = (m: Move[], delta: number, cost: number) => {
    for (const t of targets) {
      tries.n++;
      if (Math.abs(reading.sum + delta - t.items) <= tolerance && countFits(m)) out.push({ reading, target: t, moves: m, cost: cost + t.cost + reading.cost });
    }
  };
  // the one change may be a digit misread: what it must become is known, so only that is looked at (never with other changes: any sum can be made that way)
  const guessLast = (m: Move[], delta: number, cost: number) => {
    if (!countFits(m)) return;
    for (const t of targets) {
      const gap = round2(t.items - reading.sum - delta);
      for (const l of items) {
        if (m.some(x => x.line === l)) continue;
        // a row with its quantity and rate has them to check it: a digit is not guessed there
        if ((clues.cols.get(l.id) || []).length >= 3) continue;
        const now = reading.amounts.get(l.id)!;
        const n = (clues.cols.get(l.id) || []).find(c => near(c.value, now, 0.001));
        for (const v of [round2(now + gap), Math.round(now + gap)]) {
          tries.n++;
          const c = v > 0 ? digitCost(n ? n.text : String(now), v) : null;
          if (c != null) {
            out.push({ reading, target: t, cost: cost + c + t.cost + reading.cost, moves: [...m, { kind: 'FIX', line: l, delta: round2(v - now), items: 0, cost: c, value: v, why: 'a digit was misread', guess: true }] });
            break;
          }
        }
      }
    }
  };
  const walk = (from: number, m: Move[], delta: number, cost: number) => {
    if (tries.n > tries.limit) return;
    if (m.length === depth) { leaf(m, delta, cost); return; }
    if (guesses && depth === 1) guessLast(m, delta, cost);
    for (let i = from; i < list.length && tries.n <= tries.limit; i++) {
      const x = list[i];
      if ((x.line && m.some(o => o.line === x.line)) || (x.skipped && m.some(o => o.skipped === x.skipped))) continue;
      walk(i + 1, [...m, x], delta + x.delta, cost + x.cost);
    }
  };
  walk(0, [], 0, 0);
  return out;
}

const movesKey = (s: Solution) => s.moves.map(m => `${m.line?.id}:${m.value}`).join();

/** Beyond this many changes, a reading that comes to the total is more likely luck than the bill. */
const MAX_COST = 4;

/** The cheapest reading; a guessed digit only when no other row could just as well be the one misread. */
function bestOf(found: Solution[]): Solution | null {
  const sorted = found.filter(s => s.cost <= MAX_COST).sort((a, b) => a.cost - b.cost || (a.moves[0]?.line?.score ?? 0.5) - (b.moves[0]?.line?.score ?? 0.5));
  for (const s of sorted) {
    if (!s.moves.some(m => m.guess)) return s;
    if (!sorted.some(o => Math.abs(o.cost - s.cost) < 0.01 && movesKey(o) !== movesKey(s))) return s;
  }
  return null;
}

/** Looks for the reading that comes to the total (and the count): the fewest changes first, within the tries given. */
function searchReadings(total: number, adj: BillLine[], maxDepth: number, s: Search, limit: number): Solution | null {
  s.tries.limit = s.tries.n + limit;
  const targets = targetsFor(adj, total);
  const readings = readingsOf(s.items, s.clues, total);
  for (let depth = 0; depth <= maxDepth; depth++) {
    const found: Solution[] = [];
    // a change of column is one change already: at most one more with it, and only for a total the person gave
    for (const r of depth === 0 ? readings : depth === 1 && s.guesses ? readings.slice(0, 4) : readings.filter(x => !x.label || x.agreed)) {
      let moves = depth ? movesOf(r, s.items, s.clues, total) : [];
      // several rows left out can make almost any sum: with no count to hold them to, only the unsure ones
      if (depth > 1 && s.count == null) moves = moves.filter(m => m.kind === 'FIX' || (m.kind === 'HOLD' && (m.line!.score ?? 0.5) < 0.6));
      found.push(...solutionsAt(r, depth, moves, depth ? targets.main : targets.all, depth ? s : { ...s, guesses: false }));
    }
    const best = bestOf(found);
    if (best) return best;
    if (s.tries.n > s.tries.limit) break;
  }
  return null;
}

/** Only a count to go by: rows too many and unsure are set aside; a bill too short takes in the rows that looked like headings. */
function fitCountOnly(items: BillLine[], clues: Clues, count: number): Solution | null {
  const reading: Reading = { label: null, amounts: new Map(items.map(l => [l.id, l.amount] as [string, number])), sum: 0, cost: 0 };
  const target: Target = { items: 0, adjustments: new Set(), cost: 0 };
  const extra = items.length - count;
  const moves: Move[] = extra > 0
    ? items.filter(l => (l.score ?? 0.5) < 0.5).sort((a, b) => (a.score ?? 0.5) - (b.score ?? 0.5)).slice(0, extra).map(l => ({ kind: 'HOLD', line: l, delta: -l.amount, items: -1, cost: 0 }))
    : clues.skipped.slice(0, -extra).map(r => ({ kind: 'ADD', skipped: r, delta: r.amount, items: 1, cost: 0 }));
  return moves.length ? { reading, target, moves, cost: 0 } : null;
}

/**
 * Checks a read against what the person said, else what the bill prints, and takes the reading that matches: the
 * total and the count together first, then the total alone, and the count alone when no reading comes to the total.
 * An entered total is the truth, so a misread digit may be looked for; a printed one may itself be what was misread.
 */
function fitBill(bill: ParsedBill, clues: Clues, expect: Expect, maxTries: number): ParsedBill {
  const entered = expect.total && expect.total > 0 ? round2(expect.total) : null;
  const printed = clues.totals.length ? bill.total : null;
  const enteredCount = expect.count && expect.count > 0 ? Math.round(expect.count) : null;
  const count = enteredCount ?? clues.printedCount;
  if (entered == null && printed == null && count == null) return bill;
  const said = expect.from !== 'PRINTED';
  const against: BillFit['against'] = said && (entered != null || enteredCount != null) ? 'ENTERED' : 'PRINTED';
  const items = bill.lines.filter(l => l.kind === 'ITEM');
  const adj = bill.lines.filter(l => l.kind !== 'ITEM');
  const tries = { n: 0, limit: 0 };
  const steps: string[] = [...clues.notes];
  let total = entered ?? printed;

  const finish = (s: Solution | null): ParsedBill => {
    let lines: BillLine[] = bill.lines;
    if (s?.target.items) {
      lines = lines.map(l => (l.kind === 'ITEM' ? l : { ...l, counted: s.target.adjustments.has(l.id) }));
    }
    if (s?.reading.label) {
      steps.push(`Amounts taken from ${s.reading.label}`);
      lines = lines.map(l => {
        const v = s.reading.amounts.get(l.id);
        if (v == null || near(v, l.amount, 0.001)) return l;
        const cols = clues.cols.get(l.id) || [];
        const at = cols.findIndex(n => near(n.value, v, 0.001));
        return { ...l, amount: v, readAs: l.readAs ?? l.amount, fix: `from ${s.reading.label}`, ...(at >= 1 ? qtyRate(cols.slice(0, at + 1), v) : { qty: null, rate: null }) };
      });
    }
    for (const m of s?.moves || []) {
      if (m.kind === 'FIX') {
        const was = s!.reading.amounts.get(m.line!.id)!;
        steps.push(`${m.line!.name}: read as ${money(was)}, taken as ${money(m.value!)} (${m.why})`);
        lines = lines.map(l => {
          if (l.id !== m.line!.id) return l;
          const keeps = l.qty && l.rate && near(l.qty * l.rate, m.value!, 0.01);
          return { ...l, amount: m.value!, readAs: l.readAs ?? was, fix: m.why, score: Math.min(l.score ?? 0.5, 0.6), qty: keeps ? l.qty : null, rate: keeps ? l.rate : null };
        });
      } else if (m.kind === 'HOLD') {
        const name = m.line!.name.toLowerCase();
        const twice = items.some(o => o !== m.line && o.name.toLowerCase() === name && near(o.amount, m.line!.amount, 0.01));
        const why = total != null && s!.target.items ? `without it the items come to ${money(total)}` : `more items read than the ${count} expected, and this one is the least sure`;
        steps.push(`${m.line!.name} set aside (${money(m.line!.amount)})`);
        lines = lines.map(l => (l.id === m.line!.id ? { ...l, held: true, note: `Set aside: ${twice ? 'it may be one row read twice; ' : ''}${why}` } : l));
      } else {
        const r = m.skipped!;
        const why = r.why ?? 'its words looked like a heading';
        steps.push(`${r.name} taken in as an item (${money(r.amount)}): ${why}`);
        const line: BillLine = { id: lineId(), kind: 'ITEM', name: r.name, qty: r.qty, rate: r.rate, amount: r.amount, categoryId: null, counted: true, score: 0.4, fix: why };
        const at = lines.findIndex(l => l.kind !== 'ITEM');
        lines = at < 0 ? [...lines, line] : [...lines.slice(0, at), line, ...lines.slice(at)];
      }
    }
    const sum = billSum(lines);
    const totalOk = total != null ? Math.abs(sum - total) <= MATCH_TOLERANCE : null;
    const countOk = count != null ? countMatches(lines, count) : null;
    const read = lines.filter(l => l.kind === 'ITEM' && !l.held && l.amount > 0).length;
    const missing = count != null && total != null && read < count && total - sum > MATCH_TOLERANCE ? round2(total - sum) : null;
    // a count the bill prints may be misread too: only a count the person gave has to match
    const matched = total != null ? totalOk === true && (countOk !== false || enteredCount == null) : enteredCount != null && countOk === true;
    return { ...bill, lines, total: total ?? bill.total, printedTotal: printed, printedCount: clues.printedCount, fit: { against, matched, totalOk, countOk, tries: tries.n, steps, missing, guessed: !!s?.moves.some(m => m.guess) } };
  };

  // the bill agrees with itself: its items make its own total, so it is the total entered that differs
  if (entered != null && printed != null && Math.abs(entered - printed) > MATCH_TOLERANCE) {
    tries.n++;
    const own = reconcile({ ...bill, total: printed });
    if (Math.abs(billSum(own.lines) - printed) <= MATCH_TOLERANCE) {
      steps.push(`The items add up to the ${money(printed)} printed on the bill, not the ${money(entered)} entered: no item was changed`);
      bill = own;
      return finish(null);
    }
  }

  // nothing entered: the printed total may be what was misread (another total row, or its decimal point)
  if (entered == null && printed != null) {
    const sum = round2(items.reduce((t, l) => t + l.amount, 0));
    const fits = (v: number) => targetsFor(adj, v).main.find(t => Math.abs(sum - t.items) <= MATCH_TOLERANCE);
    if (!fits(printed)) {
      for (const c of clues.totals.flatMap(n => [{ value: n.value, why: 'another total on the bill' }, ...numberVariants(n)])) {
        tries.n++;
        if (fits(c.value)) {
          steps.push(`The total was read as ${money(printed)}, taken as ${money(c.value)} (${c.why}): the items come to it`);
          total = c.value;
          break;
        }
      }
    }
  }

  if (total != null) {
    const guesses = entered != null && said;
    // a total read off the bill may itself be misread: it may only settle a small doubt
    const depth = entered != null && said ? MAX_CHANGES : 1;
    const tolerance = toleranceFor(total);
    const both = searchReadings(total, adj, depth, { items, clues, count, guesses, tolerance, tries }, maxTries / 2);
    if (both) return finish(both);
    if (count != null) {
      const alone = searchReadings(total, adj, Math.min(depth, 2), { items, clues, count: null, guesses, tolerance, tries }, maxTries / 2);
      if (alone) return finish(alone);
    }
    steps.push(`No reading comes to ${money(total)} (${tries.n.toLocaleString('en-IN')} tried): check the amounts`);
  }
  return finish(enteredCount != null ? fitCountOnly(items, clues, enteredCount) : null);
}

/**
 * Several reads of one bill (the same photo, cleaned up in different ways): one may have caught the total, another the
 * items. What any of them read as the total and the count (the most often read) then checks them all, and the best is kept.
 */
export function parseReads(reads: string[][], expect: Expect = {}): ParsedBill {
  // each read alone, then together: the tries are shared, so more reads do not mean a longer wait
  const tries = MAX_TRIES / Math.max(1, reads.length) / 2;
  const bills = reads.map(r => parseBill(r, expect, [], tries));
  const best = bills.reduce((a, b) => betterFit(a, b));
  if ((best.fit?.matched && !best.fit.guessed && !best.fit.steps.length) || reads.length < 2) return best;
  const mostRead = (values: (number | null | undefined)[]) => {
    const seen = new Map<number, number>();
    values.forEach(v => { if (v) seen.set(v, (seen.get(v) || 0) + 1); });
    return [...seen.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? null;
  };
  const total = expect.total || mostRead(bills.map(b => b.printedTotal));
  const count = expect.count || mostRead(bills.map(b => b.printedCount));
  if (!total && !count) return best;
  const items = reads.map(r => readBill(r, READ_WAYS[0]).bill.lines.filter(l => l.kind === 'ITEM').map(({ name, amount, qty, rate }) => ({ name, amount, qty, rate })));
  const together: Expect = { total, count, from: expect.total || expect.count ? undefined : 'PRINTED' };
  return reads.map((r, i) => parseBill(r, together, items.filter((_, j) => j !== i), tries)).reduce((a, b) => betterFit(a, b), best);
}

/** The better of two reads of one bill: the one that matches, else the nearer its total and count; then the one changed least. */
export function betterFit(a: ParsedBill, b: ParsedBill): ParsedBill {
  const rank = (x: ParsedBill) => (x.fit?.matched && !x.fit.guessed ? 8 : x.fit?.matched ? 4 : 0) + (x.fit?.totalOk ? 2 : 0) + (x.fit?.countOk ? 1 : 0);
  const off = (x: ParsedBill) => (x.total != null ? Math.abs(x.total - billSum(x.lines)) : Infinity);
  if (rank(a) !== rank(b)) return rank(b) > rank(a) ? b : a;
  if (off(a) !== off(b)) return off(b) < off(a) ? b : a;
  return (b.fit?.steps.length ?? 0) < (a.fit?.steps.length ?? 0) ? b : a;
}

const money = (v: number) => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// ---------------------------------------------------------------------------------------------- categories

/** Item words → words of a category name, the most specific first. */
const ITEM_HINTS: [RegExp, RegExp][] = [
  [/\b(milk|curd|dahi|paneer|butter|ghee|cheese|yogh?urt|lassi|buttermilk|cream)\b/i, /milk|dairy/i],
  [/\beggs?\b/i, /egg/i],
  [/\b(chicken|mutton|fish|prawns?|meat|keema|lamb|pork|seafood)\b/i, /meat|fish|non.?veg/i],
  [/\b(tomato|onion|potato|aloo|carrot|beans|cabbage|cauliflower|brinjal|capsicum|chill?i|ginger|garlic|coriander|dhaniya|methi|palak|spinach|cucumber|ladies\s*finger|okra|bhindi|gourd|lauki|beetroot|radish|mushroom|peas|lemon|curry\s*leaves|pudina|mint)\b/i, /vegetable/i],
  [/\b(apple|banana|mango|orange|grapes?|papaya|pomegranate|guava|watermelon|melon|pineapple|kiwi|pear|chikoo|sapota|berries|strawberr)/i, /fruit/i],
  [/\b(almond|badam|cashew|kaju|pista|walnut|raisin|kishmish|dates|anjeer|dry\s*fruit)/i, /dry fruit|nut/i],
  [/\b(petrol|diesel|fuel|cng|speed|power\s*97|xp95)\b/i, /fuel|petrol/i],
  [/\b(tab(let)?s?|cap(sule)?s?|syrup|\d+\s*mg|ointment|cream\s*\d|drops|injection|strip|paracetamol|dolo|crocin|antibiotic|insulin|bandage)\b/i, /pharma|medicine|medic|health/i],
  [/\b(chips|biscuits?|cookies|chocolate|namkeen|snacks?|kurkure|lays|bhujia|wafers|cake|pastry|ice\s*cream|kulfi|sweets?|mithai|samosa|puff)\b/i, /snack|beverage|bakery/i],
  [/\b(tea|coffee|juice|cola|pepsi|coke|sprite|soda|soft\s*drink|water\s*bottle|mineral\s*water|frooti|maaza|red\s*bull)\b/i, /beverage|snack|coffee|tea/i],
  [/\b(bread|bun|pav|rusk)\b/i, /bakery|snack|grocer/i],
  [/\b(soap|shampoo|conditioner|toothpaste|tooth\s*brush|face\s*wash|deo|deodorant|perfume|lotion|razor|shaving|sanitary|pads|diaper|tissue|cosmetic|lipstick|kajal|hair\s*oil)\b/i, /personal care|toiletr|beauty|cosmetic/i],
  [/\b(detergent|surf|ariel|tide|rin|vim|harpic|lizol|phenyl|dishwash|cleaner|mop|broom|garbage\s*bag|scrubber|colin|odonil|mosquito|good\s*knight|all\s*out)\b/i, /household|clean|home/i],
  [/\b(rice|atta|wheat|flour|maida|sooji|rava|dal|toor|moong|urad|chana|rajma|sugar|salt|jaggery|oil|masala|turmeric|haldi|jeera|mustard|spices?|poha|oats|noodles|pasta|maggi|ketchup|sauce|pickle|vinegar|besan|millet|ragi|jowar|bajra|cereal|cornflakes|honey|jam)\b/i, /grocer/i],
  [/\b(shirt|t-?shirt|jeans|trouser|kurta|saree|dress|top|leggings|shorts|innerwear|socks|jacket|shoes?|sandals?|slippers?|chappal)\b/i, /cloth|apparel|shopping/i],
  [/\b(biryani|curry|naan|roti|paratha|dosa|idli|vada|thali|meals|pizza|burger|sandwich|noodles\s*veg|fried\s*rice|manchurian|tikka|kebab|starter|soup|dessert)\b/i, /dining|restaurant|food|eat/i],
  [/\b(pen|pencil|notebook|book|stationery|eraser|marker|paper|file|stapler|glue|crayons)\b/i, /book|stationery|educat/i],
  [/\b(bulb|led|battery|batteries|charger|cable|extension|switch|plug|adapter)\b/i, /electric|household|home|gadget/i],
];

const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\b(\d+(\.\d+)?\s*(g|gm|gms|kg|ml|l|ltr|pc|pcs|nos|pack|pkt))\b/g, ' ').replace(/\s+/g, ' ').trim();
export const shopKey = (s: string) => normKey(s).replace(/\b(pvt|ltd|private|limited|llp|store|stores|mart|supermarket|enterprises?|traders?)\b/g, '').replace(/\s+/g, ' ').trim();

const KIND_CATEGORY: Record<BillKind, RegExp | null> = { RESTAURANT: /dining|restaurant|eat|food/i, PHARMACY: /pharma|medicine|medic|health/i, FUEL: /fuel|petrol/i, SHOP: null };

/** A category for an item: learned, then the kind of shop (a restaurant's dishes are dining), its words, then the shop's; null when nothing fits. */
export function suggestCategory(name: string, merchant: string, categories: Category[], memory: BillMemory, kind: BillKind = 'SHOP'): number | null {
  const exp = categories.filter(c => isExpense(c));
  const has = (id?: number | null) => (id != null && exp.some(c => c.id === id) ? id : null);
  const key = normKey(name);
  const learned = has(memory.items[key]);
  if (learned) return learned;
  // a learned item that this one starts with ("amul taaza milk 500ml" ~ "amul taaza milk")
  const close = Object.keys(memory.items).find(k => k.length >= 5 && (key.startsWith(k) || k.startsWith(key)));
  if (close && has(memory.items[close])) return memory.items[close];
  const byKind = KIND_CATEGORY[kind];
  const kindCat = byKind ? exp.find(x => !x.system && byKind.test(x.name)) || exp.find(x => byKind.test(x.name)) : null;
  if (kindCat) return kindCat.id;
  for (const [words, cat] of ITEM_HINTS) {
    if (!words.test(name)) continue;
    const c = exp.find(x => !x.system && cat.test(x.name)) || exp.find(x => cat.test(x.name));
    if (c) return c.id;
  }
  const shop = has(memory.shops[shopKey(merchant)]?.categoryId);
  if (shop) return shop;
  return merchant ? matchCategory(categories, merchant) : null;
}

/** Remembers what was chosen on a posted bill, for the next one (kept on the phone, at most 600 items). */
export function learn(memory: BillMemory, merchant: string, lines: { name: string; categoryId: number; amount: number }[], accountId: number | null): BillMemory {
  const items = { ...memory.items };
  for (const l of lines) { const k = normKey(l.name); if (k.length >= 3) items[k] = l.categoryId; }
  const keys = Object.keys(items);
  if (keys.length > 600) keys.slice(0, keys.length - 600).forEach(k => delete items[k]);
  const shops = { ...memory.shops };
  // the shop's usual category: the one most of this bill went to
  const byCat = new Map<number, number>();
  lines.forEach(l => byCat.set(l.categoryId, (byCat.get(l.categoryId) || 0) + l.amount));
  const main = [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([categoryId]) => ({ categoryId }))[0];
  if (merchant && shopKey(merchant)) shops[shopKey(merchant)] = { categoryId: main?.categoryId, accountId: accountId ?? undefined };
  return { items, shops };
}

// ---------------------------------------------------------------------------------------------- posting

/**
 * The bill as items to post, adding up exactly to the total: the counted adjustments (and any difference left) are
 * spread over the items in proportion to their amounts, so each item's category carries its share of tax and
 * discount. With combine, items of one category become one line ("Vegetables · 6 items"). At most 60 lines (the
 * server's limit): beyond that, items are combined by category.
 */
export function itemsToPost(lines: BillLine[], total: number, categoryName: (id: number) => string, combine: boolean):
  { categoryId: number; categoryName: string; name: string; amount: number }[] {
  const items = lines.filter(l => l.kind === 'ITEM' && !l.held && l.amount > 0 && l.categoryId != null);
  const base = items.reduce((s, l) => s + l.amount, 0);
  if (!items.length || base <= 0) return [];
  const factor = total / base;
  let out = items.map(l => ({ categoryId: l.categoryId!, categoryName: categoryName(l.categoryId!), name: l.name, amount: round2(l.amount * factor) }));
  if (combine || out.length > 60) {
    const by = new Map<number, { categoryId: number; categoryName: string; names: string[]; amount: number }>();
    out.forEach(i => {
      const g = by.get(i.categoryId) || { categoryId: i.categoryId, categoryName: i.categoryName, names: [], amount: 0 };
      g.names.push(i.name); g.amount = round2(g.amount + i.amount); by.set(i.categoryId, g);
    });
    out = [...by.values()].map(g => ({ categoryId: g.categoryId, categoryName: g.categoryName, amount: g.amount,
      name: (g.names.length === 1 ? g.names[0] : `${g.names.slice(0, 3).join(', ')}${g.names.length > 3 ? ` +${g.names.length - 3} more` : ''}`).slice(0, 120) }));
  }
  // the pennies lost to rounding go on the largest line
  const diff = round2(total - out.reduce((s, i) => s + i.amount, 0));
  if (diff !== 0) { const big = out.reduce((a, b) => (b.amount > a.amount ? b : a)); big.amount = round2(big.amount + diff); }
  return out.filter(i => i.amount > 0);
}
