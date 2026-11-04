/**
 * How well the reader comes through OCR's mistakes: bills spoilt the way OCR spoils them (digits taken for one another, a
 * decimal point lost, a row lost, a word misread), differently in each read. Seeded, so the figures do not move by chance.
 * Above all it must not call a wrong read matched: a false "adds up" is worse than none.
 */
import { parseBill, parseReads } from '../src/receipt';

const LOOK = { 0: '8', 1: '7', 2: '7', 3: '8', 4: '9', 5: '6', 6: '8', 7: '1', 8: '3', 9: '4' } as Record<string, string>;
function random(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const GOODS = ['Tata Salt', 'Surf Excel', 'Good Day Biscuit', 'Amul Butter', 'Toor Dal', 'Sunflower Oil', 'Maggi Noodles', 'Bru Coffee', 'Vim Bar', 'Dettol Soap', 'Colgate Paste', 'Parle Rusk', 'Lizol Cleaner', 'Fortune Atta', 'Red Label Tea'];

type Bill = { rows: string[]; amounts: number[]; total: number; count: number };
function makeBill(rnd: () => number): Bill {
  const count = 3 + Math.floor(rnd() * 8);
  const rows: string[] = [];
  const amounts: number[] = [];
  const names = [...GOODS].sort(() => rnd() - 0.5).slice(0, count);
  names.forEach((name, i) => {
    const qty = 1 + Math.floor(rnd() * 4);
    const rate = (10 + Math.floor(rnd() * 400)) + (rnd() < 0.5 ? 0.5 : 0);
    const amount = Math.round(qty * rate * 100) / 100;
    amounts.push(amount);
    rows.push(`${i + 1} ${name}  ${qty}  ${rate.toFixed(2)}  ${amount.toFixed(2)}`);
  });
  const total = Math.round(amounts.reduce((s, v) => s + v, 0) * 100) / 100;
  return { rows: ['ACME STORES', 'Hyderabad 500081', 'SNo Item  Qty  Rate  Amount', ...rows, `Grand Total  ${total.toFixed(2)}`], amounts, total, count };
}

/** One read of the bill: each number or row spoilt by chance. */
function spoil(rows: string[], rnd: () => number, rate: number): string[] {
  const out: string[] = [];
  rows.forEach((row, at) => {
    if (at > 2 && rnd() < rate / 3) return;   // a row lost
    let r = row.replace(/\d+\.\d{2}/g, t => {
      const roll = rnd();
      if (roll > rate) return t;
      if (roll < rate * 0.6) { const i = Math.floor(rnd() * t.length); return t[i] === '.' ? t : t.slice(0, i) + LOOK[t[i]] + t.slice(i + 1); }   // a digit
      return roll < rate * 0.85 ? t.replace('.', '') : t.replace('.', ' ');   // the point lost, or read as a gap
    });
    if (rnd() < rate) r = r.replace(/[a-z]/, 'x');   // a letter
    out.push(r);
  });
  return out;
}

// the amounts, in whatever order: an item another read found is added at the end
const sorted = (v: number[]) => JSON.stringify([...v].sort((x, y) => x - y));
const right = (b: ReturnType<typeof parseBill>, bill: Bill) => sorted(b.lines.filter(l => l.kind === 'ITEM' && !l.held).map(l => l.amount)) === sorted(bill.amounts);

function run(rate: number, reads: number, n = 150) {
  let solved = 0, solvedOne = 0, falseMatch = 0, unsure = 0;
  for (let i = 0; i < n; i++) {
    const rnd = random(i * 7919 + Math.round(rate * 1000));
    const bill = makeBill(rnd);
    const shots = Array.from({ length: reads }, () => spoil(bill.rows, rnd, rate));
    const expect = { total: bill.total, count: bill.count };
    if (right(parseBill(shots[0], expect), bill)) solvedOne++;
    const b = parseReads(shots, expect);
    if (right(b, bill)) solved++;
    else if (b.fit?.matched) falseMatch++;
    else unsure++;
  }
  return { rate, reads, n, solved, solvedOne, falseMatch, unsure };
}

describe('how often the reader comes right through OCR mistakes', () => {
  it('mixing several reads solves bills one read cannot, and does not invent matches', () => {
    const light = run(0.08, 3);
    const heavy = run(0.2, 5);
    console.log(JSON.stringify({ light, heavy }));
    expect(light.solved).toBeGreaterThan(light.solvedOne);
    expect(heavy.solved).toBeGreaterThan(heavy.solvedOne);
    expect(light.solved / light.n).toBeGreaterThan(0.9);
    expect(light.falseMatch / light.n).toBeLessThan(0.02);
    expect(heavy.falseMatch / heavy.n).toBeLessThan(0.05);
  });

  it('stays within its tries however many reads there are', () => {
    const rnd = random(99);
    const bill = makeBill(rnd);
    const shots = Array.from({ length: 7 }, () => spoil(bill.rows, rnd, 0.5));
    const started = Date.now();
    parseReads(shots, { total: 98765.43, count: bill.count });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
