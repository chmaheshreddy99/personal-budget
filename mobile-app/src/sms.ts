/**
 * Reading an Indian bank or card SMS: how much went out, from which account or card (the last digits, or the bank),
 * to whom, the reference and the date, and so which of the user's accounts paid and which category it probably is.
 *
 * Written for the formats the banks send (each line a real shape):
 *   SBI     "Dear UPI user A/C X1234 debited by 500.0 on date 13Oct26 trf to SWIGGY Refno 628512345678"
 *   HDFC    "Sent Rs.500.00 From HDFC Bank A/C *1234 To SWIGGY On 13/10/26 Ref 628512345678"
 *           "Spent Rs.2499 On HDFC Bank Card 9876 At AMAZON On 2026-10-13:10:20:11"
 *   ICICI   "ICICI Bank Acct XX234 debited for Rs 500.00 on 13-Oct-26; Swiggy credited. UPI:628512345678"
 *           "INR 2,499.00 spent using ICICI Bank Card XX9876 on 13-Oct-26 on AMAZON PAY. Avl Limit: INR 1,20,000"
 *   Axis    "INR 500.00 debited A/c no. XX1234 13-10-26 10:20:11 UPI/P2M/628512345678/SWIGGY"
 *   Kotak   "Sent Rs.500.00 from Kotak Bank AC X1234 to swiggy@ybl on 13-10-26.UPI Ref 628512345678"
 *   BoB     "Rs.500.00 transferred from A/c ...1234 to:UPI/628512345678. Total Bal:Rs.10000.00CR"
 *   Union   "A/c *1234 Debited for Rs:500.00 on 13-10-2026 by Mob Bk ref no 628512345678 Avl Bal Rs:1000.00"
 * and more (Canara, PNB, IDFC FIRST, IndusInd, Yes, Federal, AU, Paytm, Airtel, SBI Card, Amex, OneCard …).
 */
import { Account, Category, isExpense } from './data';
import { isoDate } from './format';
import type { RawSms } from './native';

export type ParsedSms = {
  sms: RawSms; amount: number; date: string; last4: string | null; bank: string | null; card: boolean; mode: string | null;
  merchant: string | null; reference: string | null; accountId: number | null; categoryId: number | null; narration: string;
};

/** Sender ids (VM-HDFCBK, JD-ICICIT-S …) and names in the text → the bank. */
const BANKS: [RegExp, string][] = [
  [/HDFC/i, 'HDFC'], [/ICICI/i, 'ICICI'], [/\bSBI|SBIN|SBIUPI|SBICRD|SBMSMS|ATMSBI|CBSSBI|State Bank/i, 'SBI'], [/AXIS|UTIB/i, 'Axis'],
  [/KOTAK|KMBL/i, 'Kotak'], [/YESB|YES ?BANK/i, 'Yes'], [/IDFC/i, 'IDFC FIRST'], [/INDUS|INDUSB/i, 'IndusInd'],
  [/PNB|PUNJAB NAT|PUNBNK/i, 'PNB'], [/\bBOI\b|BOIIND|BKID|Bank of India/i, 'Bank of India'], [/CANARA|CANBNK|CNRB/i, 'Canara'],
  [/UNION|UBOI|UBINB/i, 'Union'], [/BARODA|BOBTXN|BOBSMS|\bBOB\b/i, 'Bank of Baroda'], [/PAYTM|PYTM/i, 'Paytm'],
  [/AMEX|AMERICAN EXP/i, 'Amex'], [/FEDERAL|FEDBNK|FEDFIB/i, 'Federal'], [/AU ?BANK|AUBANK|AUSFB/i, 'AU'], [/\bRBL/i, 'RBL'],
  [/IDBI/i, 'IDBI'], [/INDIAN ?BANK|INDBNK|IDIB/i, 'Indian Bank'], [/IOB|OVERSEAS/i, 'Indian Overseas'], [/CENTRAL ?BANK|CBOI|CENTBK/i, 'Central Bank'],
  [/CITI/i, 'Citi'], [/HSBC/i, 'HSBC'], [/SCBANK|STANC|STANDARD CHART/i, 'Standard Chartered'], [/AIRTEL|AIRBNK/i, 'Airtel Payments'],
  [/JUPITER/i, 'Jupiter'], [/ONECARD|ONECRD/i, 'OneCard'], [/SLICE/i, 'Slice'], [/BANDHAN|BDNSMS/i, 'Bandhan'], [/UCO/i, 'UCO'],
  [/MAHARASHTRA|MAHABK|MAHB/i, 'Bank of Maharashtra'], [/KARNATAKA|KBLBNK|KARB/i, 'Karnataka Bank'], [/KVB|KARUR/i, 'KVB'],
  [/CUB|CITY UNION/i, 'City Union'], [/SOUTH ?INDIAN|SIBSMS/i, 'South Indian'], [/TMB|TAMILNAD/i, 'TMB'], [/DBS|DIGIBANK/i, 'DBS'],
  [/EQUITAS/i, 'Equitas'], [/UJJIVAN/i, 'Ujjivan'], [/DCB/i, 'DCB'], [/FINO/i, 'Fino'], [/JIO ?PAY|JIOPBK/i, 'Jio Payments'],
  [/PSB|PUNJAB ?&? ?SIND/i, 'Punjab & Sind'], [/J&K|JKBANK/i, 'J&K Bank'], [/APGVB|APGB|TGB|GRAMEEN/i, 'Grameena Bank'],
];

/**
 * Merchant words → words of a category name, the most specific first: when the household has no such category (say no
 * "Food Delivery"), the next line that matches the merchant is tried (say "Dining Out").
 */
const CATEGORY_HINTS: [RegExp, RegExp][] = [
  [/swiggy|zomato|eatsure|magicpin/i, /food deliver|takeaway/i],
  [/milk|dairy|heritage|nandini|amul|aavin|vijaya|jersey|country delight|akshayakalpa|milkbasket/i, /milk|dairy/i],
  [/vegetable|fruits?\b|sabzi|kisan|farm fresh|otipy|fraazo|pluckk/i, /vegetable|fruit/i],
  [/starbucks|\bchai\b|\btea\b|coffee|ccd|cafe coffee|bakery|bakers|juice|haldiram/i, /snack|beverage|coffee|tea/i],
  [/swiggy|zomato|restaurant|cafe|hotel|dominos|pizza|kfc|mcdonald|starbucks|burger|biryani|bakery|eatsure|food/i, /dining|food|eat|restaurant/i],
  [/bigbasket|blinkit|zepto|dmart|d-mart|grocer|supermarket|kirana|fresh|instamart|ratnadeep|more retail|jiomart|vegetable|reliance retail|spencer/i, /grocer/i],
  [/uber|ola\b|olacabs|rapido|namma yatri|blusmart|meru|auto ?rickshaw/i, /cab|auto/i],
  [/fastag|toll|parking|netc/i, /parking|toll/i],
  [/petrol|fuel|hpcl|bpcl|iocl|indian oil|shell|filling|bharat petro|hp pay/i, /fuel|transport|petrol/i],
  [/uber|ola\b|olacabs|rapido|metro|irctc|redbus|railway|fastag|toll|parking|namma yatri|bmtc|ksrtc|tsrtc|apsrtc/i, /transport|travel|cab|commute/i],
  [/makemytrip|goibibo|cleartrip|yatra|indigo|air india|vistara|akasa|spicejet|oyo|airbnb|booking\.com|agoda/i, /travel|vacation|trip/i],
  [/service cent|car wash|tyre|tire|bosch car|gomechanic|motors|automobiles|bike service/i, /vehicle|mainten/i],
  [/croma|reliance digital|vijay sales|apple|samsung|oneplus|xiaomi|mi store|bajaj electronics|sangeetha/i, /gadget|electronic/i],
  [/ikea|pepperfry|urban ladder|home centre|wakefit|sleepyhead|durian/i, /furniture|decor/i],
  [/amazon|flipkart|myntra|ajio|meesho|nykaa|croma|reliance digital|shopping|tata cliq|lenskart|decathlon/i, /shopping|clothing/i],
  [/indane|bharatgas|bharat gas|hp gas|hpgas|lpg|cylinder/i, /gas|lpg|cylinder/i],
  [/tata play|tatasky|tata sky|dish tv|d2h|airtel dth|sun direct|cable/i, /dth|cable/i],
  [/bisleri|water can|kinley|aquaguard|ro service|kent ro/i, /water/i],
  [/electricity|bescom|tsspdcl|apspdcl|tneb|msedcl|kseb|tata power|adani elec|water|gas|indane|bharatgas|billdesk|bbps|cred club/i, /utilit|bill/i],
  [/jio|airtel|vodafone|\bvi\b|bsnl|broadband|act fibernet|hathway|recharge|tata play|dish tv/i, /mobile|internet|phone|recharge/i],
  [/pharma|medplus|1mg|netmeds|pharmeasy|chemist|medical store|apollo pharmacy|wellness forever/i, /pharma|medicine/i],
  [/apollo|pharma|medplus|hospital|clinic|1mg|netmeds|diagnostic|lab\b|healthcare|pharmeasy/i, /medic|health/i],
  [/cult\.?fit|cultfit|gym|fitness|yoga|gold's|anytime fitness|decathlon/i, /gym|fitness/i],
  [/netflix|hotstar|prime video|spotify|youtube premium|zee5|sonyliv|jiocinema|apple\.com|google play|icloud|google one|audible/i, /subscription/i],
  [/netflix|hotstar|prime video|spotify|bookmyshow|pvr|inox|youtube|zee5|sonyliv|jiocinema|district/i, /entertain|subscription|movie/i],
  [/salon|parlour|parlor|\bspa\b|urban company|naturals|lakme|barber/i, /personal care|beauty|salon/i],
  [/laundry|dry ?clean|ironing|uclean|washmart/i, /laundry|ironing/i],
  [/temple|devasthanam|pooja|puja|tirumala|ttd|isha|iskcon/i, /festival|pooja/i],
  [/petsmart|heads up for tails|supertails|\bvet\b|veterinary|\bpets?\b/i, /pet/i],
  [/rent|landlord|nobroker/i, /rent|hous/i],
  [/maintenance|plumber|electrician|carpenter|painter|urban company/i, /home mainten|repair/i],
  [/\bmaid\b|\bcook\b|driver salary|watchman|househelp|house help|broomees/i, /maid|household help/i],
  [/school|college|tuition|fees|udemy|coursera|byju|vedantu|unacademy/i, /educat/i],
  [/sapna|crossword|stationery|stationary|bookstore|book store|xerox/i, /book|stationery/i],
  [/insurance|lic\b|policy|premium|policybazaar|acko|go digit/i, /insur/i],
  [/income ?tax|gst payment|gstn|\btds\b|property tax|municipal|ghmc|bbmp|challan|tin-?nsdl|incometax/i, /tax/i],
];

const MONEY = String.raw`(?:rs\.?|inr|₹)\s*:?\s*([0-9][0-9,]*(?:\.\d{1,2})?)`;
/** "Avl Bal Rs 1,000", "Avl Limit: INR 1,20,000": not the transaction's amount. */
const BALANCE_BEFORE = /(?:bal(?:ance)?|limit|lmt|avl|avail(?:able)?|o\/s|outstanding|due|cr\.?\s*lim)[^0-9]{0,14}$/i;
const DEBIT = /\b(debited|debit|spent|withdrawn|withdrawal|paid|payment|purchase[ds]?|sent|deducted|charged|transferred|trf|txn|transaction|used|dr|billed|withdraw)\b/i;
const STRONG_DEBIT = /\b(debited|spent|withdrawn|sent|paid|deducted|purchase[ds]?|transferred|charged|used)\b/i;
const CREDIT = /\b(credited|received|deposited)\b/i;
const NOT_A_DEBIT = /(\botp\b|one[- ]?time password|verification code|\bwill be (debited|deducted|charged)|to be debited|\bis due\b|\bdue (on|date|by)\b|min(imum)?\.? (amt|amount) due|total (amt|amount) due|collect request|has requested|requested (money|rs|inr)|payment request|\bdeclined\b|\bfailed\b|unsuccessful|\breversed\b|\brefund(ed)?\b|e-?mandate .*(registered|created|set up)|bill (is )?generated|statement (is )?generated|cashback|\boffer\b|t&c|pre-?approved|\beligible\b|apply now|\bwin\b|\bvoucher\b)/i;

/** The transaction's amount: the currency amount nearest the debit word (balances and limits left out). */
function amountOf(body: string): number | null {
  const re = new RegExp(MONEY, 'gi');
  const debitAt = body.search(DEBIT);
  let best: { v: number; d: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (BALANCE_BEFORE.test(body.slice(Math.max(0, m.index - 22), m.index))) continue;
    const v = Number(m[1].replace(/,/g, ''));
    if (!(v > 0)) continue;
    const d = Math.abs(m.index - (debitAt < 0 ? 0 : debitAt));
    if (!best || d < best.d) best = { v, d };
  }
  if (best) return best.v;
  // SBI: "debited by 500.0", "debited for 1,250.00"
  const bare = body.match(/\b(?:debited|spent|deducted|withdrawn|paid|sent|transferred)\s+(?:by|for|with|of)?\s*([0-9][0-9,]*\.\d{1,2})\b/i)
    || body.match(/\b(?:by|for|with|of)\s+([0-9][0-9,]*\.\d{1,2})\b/i);
  return bare ? Number(bare[1].replace(/,/g, '')) || null : null;
}

/** The account's or card's last digits: "A/C X1234", "XXXXXX1234", "...1234", "*1234", "ending 1234", "Card 9876". */
function lastDigits(body: string): string | null {
  const m = body.match(/(?:a\/c|acct|account|a\/c\.|ac|card|cc|debit card|credit card)\s*(?:no\.?|number|num)?\s*(?:ending(?:\s+(?:with|in))?)?\s*[:#-]?\s*(?:[xX*#.\s-]*)(\d{3,6})\b/i)
    || body.match(/(?:[xX*]{1,}|\.{2,})(\d{3,6})\b/)
    || body.match(/\bending(?:\s+(?:with|in))?\s*(\d{3,6})\b/i);
  return m ? m[1].slice(-4) : null;
}

const tidy = (raw: string) => {
  const s = raw.replace(/[*_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.,;:\-]+$/, '');
  const flat = s === s.toUpperCase() || s === s.toLowerCase() ? s.toLowerCase() : s;
  return flat.replace(/\b\w/g, c => c.toUpperCase()).slice(0, 40);
};

/** Words that are never a shop: the bank, the account, amounts, the person's own name … */
const NOT_A_SHOP = /^(your|you|a\/c|ac|acct|account|card|rs|inr|bank|upi|imps|neft|rtgs|mob|mobile|net ?banking|self|the|on|date|ref)\b|\b(card|a\/c|account|bank)\b|^\d/i;

const SHOP_END = String.raw`(?=\s+(?:on|ref(?:\s*no)?|refno|upi|avl|avbl|via|txn|using|from|dated|thru|through|by|if|not|call|for|bal|to\s+(?:a\/c|ac))\b|\s+\d{1,2}[-/ ]|[.,;(]|$)`;
const SHOP_CUES = [String.raw`\bat`, String.raw`\btowards`, String.raw`\bto`, String.raw`info[:\s]+`, String.raw`\btrf to`, String.raw`\bfor`]
  .map(cue => new RegExp(cue + String.raw`\s*:?\s*([A-Za-z][A-Za-z0-9&'.\- *]{2,40}?)` + SHOP_END, 'i'));

function merchantOf(body: string): string | null {
  // a UPI id: swiggy@ybl, paytmqr281005050101abcd@paytm, q123456789@ybl → the name part when it reads like one
  const vpa = body.match(/(?:vpa|upi id|to|at)?\s*([a-z][a-z0-9.\-_]{2,})@[a-z]{2,}/i);
  if (vpa && !/^(paytmqr|q\d|bharatpe|mab\.|gpay-|upiswiggy)/i.test(vpa[1]) && !/^\d+$/.test(vpa[1])) return tidy(vpa[1].replace(/[._\-]/g, ' ').replace(/\d{4,}/g, ''));
  // "UPI/P2M/628512345678/SWIGGY", "UPI/DR/628512345678/RAVI KUMAR/SBIN"
  const upiPath = body.match(/UPI\/(?:P2[MA]|DR|CR)?\/?\d{6,}\/([A-Za-z][A-Za-z0-9 &.\-]{2,30})/i);
  if (upiPath) return tidy(upiPath[1].replace(/\s+(not|avl|avbl|bal|on|ref|if|call|sms)\b.*$/i, ''));
  // "Swiggy credited." (ICICI)
  const credited = body.match(/;\s*([A-Za-z][A-Za-z0-9 &.\-]{2,30}?)\s+credited/i);
  if (credited) return tidy(credited[1]);
  for (const cue of SHOP_CUES) {
    const m = body.match(cue);
    if (!m) continue;
    const v = tidy(m[1]);
    if (v.length >= 3 && !NOT_A_SHOP.test(v)) return v;
  }
  // card SMS: "on 13-Oct-26 on AMAZON PAY"
  const onShop = body.match(/\bon\s+\d{1,2}[-/ ]?[A-Za-z0-9]{2,3}[-/ ]?\d{2,4}\s+(?:at|on)\s+([A-Za-z][A-Za-z0-9 &.\-*]{2,30}?)(?=[.,;]|\s+avl|\s+avbl|$)/i);
  return onShop ? tidy(onShop[1]) : null;
}

function modeOf(body: string, card: boolean): string | null {
  if (/\bupi\b|vpa|@[a-z]{2,}/i.test(body)) return 'UPI';
  if (/\bimps\b/i.test(body)) return 'IMPS';
  if (/\bneft\b/i.test(body)) return 'NEFT';
  if (/\brtgs\b/i.test(body)) return 'RTGS';
  if (/\batm\b|withdrawn|withdrawal/i.test(body)) return 'ATM';
  if (/\bpos\b/i.test(body)) return 'POS';
  if (/\bnach\b|auto[- ]?debit|e-?mandate|\bsi\b|standing instruction/i.test(body)) return 'Auto debit';
  return card ? 'Card' : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** 13-10-26, 13/10/2026, 2026-10-13, 13-Oct-26, 13Oct26, 13 Oct 2026, Oct 13, 2026 … else the SMS's own time. */
function dateOf(body: string, at: number): string {
  const y4 = (y: string) => Number(y.length === 2 ? `20${y}` : y);
  let d: Date | null = null;
  let m: RegExpMatchArray | null;
  if ((m = body.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/))) d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  else if ((m = body.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/))) d = new Date(y4(m[3]), Number(m[2]) - 1, Number(m[1]));
  else if ((m = body.match(/\b(\d{1,2})[-\s]?([A-Za-z]{3})[a-z]*[-\s,]?\s?(\d{2,4})\b/)) && MONTHS.includes(m[2].toLowerCase())) {
    d = new Date(y4(m[3]), MONTHS.indexOf(m[2].toLowerCase()), Number(m[1]));
  } else if ((m = body.match(/\b([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/)) && MONTHS.includes(m[1].toLowerCase())) {
    d = new Date(Number(m[3]), MONTHS.indexOf(m[1].toLowerCase()), Number(m[2]));
  }
  const sms = new Date(at);
  // a date that is not plausible (the future, or long before the SMS) is not trusted
  if (!d || isNaN(d.getTime()) || d.getTime() > sms.getTime() + 86400000 || sms.getTime() - d.getTime() > 40 * 86400000) d = sms;
  return isoDate(d);
}

/** Does the SMS read like money going out? (the native receiver uses the same test before it notifies) */
export function isDebitSms(body: string): boolean {
  const b = body.replace(/\s+/g, ' ');
  if (NOT_A_DEBIT.test(b)) return false;
  const debitAt = b.search(DEBIT);
  if (debitAt < 0) return false;
  const creditAt = b.search(CREDIT);
  if (creditAt >= 0 && creditAt < debitAt && !STRONG_DEBIT.test(b)) return false;
  // "Rs 5,000 credited to your A/c … by A/c linked to debit card": money in
  if (creditAt >= 0 && creditAt < debitAt && /(your|ur) (a\/c|ac|account)( \S+)? (has been |is )?credited|credited (to|in) (your|ur) (a\/c|ac|account)/i.test(b)) return false;
  return amountOf(b) !== null;
}

/** null when the SMS is not money going out. */
export function parseSms(sms: RawSms, accounts: Account[], categories: Category[]): ParsedSms | null {
  const body = sms.body.replace(/\s+/g, ' ').trim();
  if (!isDebitSms(body)) return null;
  const amount = amountOf(body);
  if (!amount) return null;
  const card = /\b(card|credit card|cc)\b/i.test(body) && !/\bdebit card\b/i.test(body) || /\bspent\b.*\bcard\b/i.test(body);
  const last4 = lastDigits(body);
  const bank = BANKS.find(([re]) => re.test(sms.sender))?.[1] || BANKS.find(([re]) => re.test(body))?.[1] || null;
  const merchant = merchantOf(body);
  const refM = body.match(/(?:upi\s*ref(?:\.|erence)?(?:\s*(?:no|num|number)\.?)?|ref(?:erence)?\s*(?:no|num|number|id)?\.?|refno|rrn|txn\s*(?:id|no\.?)|utr(?:\s*no\.?)?|upi[:/])\s*[:#\-]?\s*([A-Za-z0-9]{6,22})/i)
    || body.match(/UPI\/(?:P2[MA]|DR|CR)?\/?(\d{9,14})/i);
  const mode = modeOf(body, card);
  const accountId = matchAccount(accounts, { last4, bank, card });
  const categoryId = matchCategory(categories, `${merchant || ''} ${body}`);
  return {
    sms, amount, date: dateOf(body, sms.at), last4, bank, card, mode, merchant, reference: refM ? refM[1] : null, accountId, categoryId,
    narration: merchant || (mode === 'ATM' ? 'ATM withdrawal' : `${bank ? `${bank} ` : ''}${card ? 'card' : mode || 'bank'} payment`),
  };
}

/** The account that paid: the same last digits, else the bank's only account of that kind (card or bank). */
export function matchAccount(accounts: Account[], { last4, bank, card }: { last4: string | null; bank: string | null; card: boolean }): number | null {
  const payers = accounts.filter(a => a.payFrom);
  if (last4) {
    const hit = payers.find(a => a.last4 && (a.last4.endsWith(last4) || last4.endsWith(a.last4.slice(-3))));
    if (hit) return hit.id;
    const named = payers.find(a => a.name.replace(/\s/g, '').includes(last4));
    if (named) return named.id;
  }
  if (bank) {
    const word = bank.split(' ')[0].replace(/[^A-Za-z]/g, '');
    const re = new RegExp(word, 'i');
    const ofBank = payers.filter(a => re.test(`${a.institution || ''} ${a.name}`));
    const kind = ofBank.filter(a => (a.type === 'CREDIT_CARD') === card);
    if (kind.length === 1) return kind[0].id;
    if (ofBank.length === 1) return ofBank[0].id;
  }
  // only one account of that kind at all
  const kindOnly = payers.filter(a => (card ? a.type === 'CREDIT_CARD' : a.type === 'BANK'));
  return kindOnly.length === 1 && !last4 ? kindOnly[0].id : null;
}

export function matchCategory(categories: Category[], text: string): number | null {
  for (const [merchant, name] of CATEGORY_HINTS) {
    if (!merchant.test(text)) continue;
    const c = categories.find(x => !x.system && isExpense(x) && name.test(x.name));
    if (c) return c.id;
  }
  return null;
}
