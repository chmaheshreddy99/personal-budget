import { MAX_TRIES, billSum, betterFit, cleanItemName, countMatches, hasStrayNumber, parseBill, parseReads } from '../src/receipt';

const SHOP = [
  'FRESH MART SUPERMARKET',
  '12 MG Road, Bengaluru 560001',
  'Ph: 9876543210',
  'GSTIN 29ABCDE1234F1Z5',
  'Bill No: FM-20931   Date: 02/11/2026',
  'Item  Qty  Rate  Amount',
  '1 Amul Taaza Milk 500 ml  2  28.00  56.00',
  '2 Tomato kg  1  40.00  40.00',
  '8901234567890 Good Day Biscuit  1  30.00  30.00',
  'Onion  1  35.00  35.00',
  'Total Items: 4',
  'Grand Total  161.00',
  'UPI  161.00',
];
const HEAD = SHOP.slice(0, 6);
const items = (b: ReturnType<typeof parseBill>) => b.lines.filter(l => l.kind === 'ITEM' && !l.held);
const amounts = (b: ReturnType<typeof parseBill>) => items(b).map(l => l.amount);

describe('item names', () => {
  it('keep sizes and drop prices, codes and serial numbers', () => {
    expect(cleanItemName('1 Amul Taaza Milk 500 ml 2 28.00')).toBe('Amul Taaza Milk 500 ml');
    expect(cleanItemName('8901234567890 Good Day Biscuit')).toBe('Good Day Biscuit');
    expect(cleanItemName('Tomato kg')).toBe('Tomato');
    expect(cleanItemName('SURF EXCEL 1KG')).toBe('Surf Excel 1 kg');
    expect(cleanItemName('Dolo 15s')).toBe('Dolo 15s');
  });
  it('flags a stray number but not a size', () => {
    expect(hasStrayNumber('Milk 500 ml')).toBe(false);
    expect(hasStrayNumber('Milk 28.00')).toBe(true);
  });
});

describe('parseBill', () => {
  it('reads the items without the address, phone, GSTIN or totals', () => {
    const b = parseBill(SHOP);
    const read = b.lines.filter(l => l.kind === 'ITEM');
    expect(read.map(l => l.name)).toEqual(['Amul Taaza Milk 500 ml', 'Tomato', 'Good Day Biscuit', 'Onion']);
    expect(b.total).toBe(161);
    expect(billSum(b.lines)).toBe(161);
    expect(b.fit).toMatchObject({ matched: true, against: 'PRINTED', steps: [] });
  });

  it('sets aside the item that keeps the sum from the total entered', () => {
    // a misread row: a coupon code read as an item
    const rows = [...SHOP.slice(0, 9), 'XQ  1  20', ...SHOP.slice(9)];
    const b = parseBill(rows, { total: 161, count: 4 });
    expect(items(b).map(l => l.name)).not.toContain('XQ');
    expect(billSum(b.lines)).toBe(161);
  });

  it('takes the total entered over the printed one, keeping the printed one to show', () => {
    const b = parseBill(SHOP, { total: 165 });
    expect(b.total).toBe(165);
    expect(b.printedTotal).toBe(161);
  });
});

describe('fitting the read to the total and the count', () => {
  const bill = (...rows: string[]) => [...HEAD, ...rows];

  it('leaves the items alone when they add up to the bill’s own total and the entered one differs', () => {
    const b = parseBill(SHOP, { total: 165, count: 4 });
    expect(amounts(b)).toEqual([56, 40, 30, 35]);
    expect(b.fit?.matched).toBe(false);
    expect(b.fit?.steps[0]).toContain('printed on the bill');
  });

  it('takes the right column when the last number on each row is not the amount', () => {
    // the tax amount comes after the amount on every row
    const rows = bill('Milk  2  28.00  56.00  2.80', 'Tomato  1  40.00  40.00  2.00', 'Onion  1  35.00  35.00  1.75');
    const b = parseBill(rows, { total: 131, count: 3 });
    expect(amounts(b)).toEqual([56, 40, 35]);
    expect(b.fit).toMatchObject({ matched: true });
    expect(b.fit?.steps[0]).toContain('2 from the right');
  });

  it('takes the MRP column when that is what the bill comes to', () => {
    const rows = bill('Soap  50.00  45.00', 'Shampoo  120.00  110.00', 'Oil  200.00  180.00');
    const b = parseBill(rows, { total: 370 });
    expect(amounts(b)).toEqual([50, 120, 200]);
    expect(b.fit?.matched).toBe(true);
  });

  it('puts back a decimal point missed on one row', () => {
    const rows = bill('Milk  56.00', 'Tomato  4000', 'Onion  35.00');
    const b = parseBill(rows, { total: 131, count: 3 });
    expect(amounts(b)).toEqual([56, 40, 35]);
    expect(items(b)[1]).toMatchObject({ readAs: 4000, fix: 'the decimal point was missed' });
  });

  it('puts back the decimal point missed on every row', () => {
    const rows = bill('Milk  5600', 'Tomato  4000', 'Onion  3500');
    const b = parseBill(rows, { total: 131, count: 3 });
    expect(amounts(b)).toEqual([56, 40, 35]);
    expect(b.fit?.matched).toBe(true);
  });

  it('reads a comma for the decimal point', () => {
    const rows = bill('Milk  56.00', 'Tomato  40,50', 'Onion  35.00');
    const b = parseBill(rows, { total: 131.5 });
    expect(amounts(b)).toEqual([56, 40.5, 35]);
  });

  it('joins a number split in two: 35 50 is 35.50', () => {
    const rows = bill('Milk  56.00', 'Tomato  40.00', 'Onion  135 50');
    const b = parseBill(rows, { total: 231.5, count: 3 });
    expect(amounts(b)).toEqual([56, 40, 135.5]);
    // and 35 00 is plainly 35.00: it needs no total to tell
    expect(amounts(parseBill(bill('Milk  56.00', 'Onion  35 00')))).toEqual([56, 35]);
  });

  it('corrects one misread digit when only one row can be it', () => {
    const rows = bill('Milk  86.00', 'Tomato  62.00', 'Onion  27.00');
    const b = parseBill(rows, { total: 145, count: 3 });
    expect(amounts(b)).toEqual([56, 62, 27]);
    expect(items(b)[0]).toMatchObject({ readAs: 86, fix: 'a digit was misread' });
  });

  it('does not guess a digit when several rows could be it', () => {
    const rows = bill('Milk  86.00', 'Tomato  88.00', 'Onion  27.00');
    const b = parseBill(rows, { total: 171 });
    expect(amounts(b)).toEqual([86, 88, 27]);
    expect(b.fit?.matched).toBe(false);
  });

  it('corrects two rows together', () => {
    const rows = bill('Milk  5600', 'Tomato  4000', 'Onion  35.00', 'Curd  20.00');
    const b = parseBill(rows, { total: 151, count: 4 });
    expect(amounts(b)).toEqual([56, 40, 35, 20]);
    expect(b.fit?.matched).toBe(true);
  });

  it('fixes an amount from quantity × rate on the row, with nothing entered', () => {
    const b = parseBill(bill('Milk  2  28.00  86.00', 'Onion  1  35.00  35.00'));
    expect(amounts(b)).toEqual([56, 35]);
    expect(items(b)[0]).toMatchObject({ qty: 2, rate: 28, readAs: 86 });
  });

  it('keeps the amount when a row has a GST rate after it', () => {
    const b = parseBill(bill('Milk  2  28.00  56.00  5%', 'Grand Total  56.00'));
    expect(amounts(b)).toEqual([56]);
  });

  it('checks against the printed total with nothing entered, and corrects a row', () => {
    const b = parseBill(bill('Milk  5600', 'Onion  35.00', 'Grand Total  91.00'));
    expect(amounts(b)).toEqual([56, 35]);
    expect(b.fit).toMatchObject({ matched: true, against: 'PRINTED' });
  });

  it('corrects a printed total that was misread, when the items agree', () => {
    const b = parseBill(bill('Milk  56.00', 'Onion  35.00', 'Grand Total  9100'));
    expect(b.total).toBe(91);
    expect(b.fit?.matched).toBe(true);
    expect(amounts(b)).toEqual([56, 35]);
  });

  it('sets aside a row read twice when the count says so', () => {
    const rows = bill('Milk  56.00', 'Tomato  40.00', 'Tomato  40.00', 'Onion  35.00');
    const b = parseBill(rows, { total: 131, count: 3 });
    expect(b.lines.filter(l => l.held).map(l => l.name)).toEqual(['Tomato']);
    expect(b.lines.find(l => l.held)?.note).toContain('read twice');
  });

  it('takes in a row its words made look like a heading when the bill is an item short', () => {
    const rows = bill('Milk  56.00', 'Table Salt  1  20.00', 'Onion  35.00');
    expect(amounts(parseBill(rows))).toEqual([56, 35]);
    const b = parseBill(rows, { total: 111, count: 3 });
    expect(items(b).map(l => l.name)).toEqual(['Milk', 'Onion', 'Table Salt']);
    expect(b.fit?.matched).toBe(true);
  });

  it('counts the tax in when that is what the total needs', () => {
    const rows = bill('Milk  100.00', 'Onion  100.00', 'CGST 2.5%  5.00', 'SGST 2.5%  5.00', 'Grand Total  210.00');
    const b = parseBill(rows, { total: 210, count: 2 });
    expect(billSum(b.lines)).toBe(210);
    expect(b.fit?.matched).toBe(true);
  });

  it('takes pieces as the count: 2 of one item and 1 of another are 3', () => {
    const b = parseBill(bill('Milk  2  28.00  56.00', 'Onion  1  35.00  35.00'), { total: 91, count: 3 });
    expect(b.fit?.matched).toBe(true);
    expect(countMatches(b.lines, 3)).toBe(true);
    expect(countMatches(b.lines, 2)).toBe(true);
  });

  it('says how much the missing item comes to when the bill is an item short', () => {
    const b = parseBill(bill('Milk  56.00', 'Onion  35.00'), { total: 131, count: 3 });
    expect(b.fit).toMatchObject({ matched: false, totalOk: false, countOk: false, missing: 40 });
    expect(amounts(b)).toEqual([56, 35]);
  });

  it('with only a count, sets aside the unsure rows too many', () => {
    const b = parseBill(bill('Milk  56.00', 'Onion  35.00', 'XQ  1  20'), { count: 2 });
    expect(b.lines.filter(l => l.held).map(l => l.name)).toEqual(['XQ']);
  });

  it('gives up within its tries on a bill nothing can match, leaving the read as it was', () => {
    const many = Array.from({ length: 58 }, (_, i) => `Item Number ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(97 + (i % 7))}  ${100 + i * 37}.${10 + i}`);
    const started = Date.now();
    const b = parseBill(bill(...many), { total: 98765.43, count: 3 });
    expect(b.fit?.matched).toBe(false);
    expect(b.fit?.tries).toBeLessThanOrEqual(MAX_TRIES + 2000);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(b.lines.filter(l => l.readAs != null).length).toBe(0);
  });

  it('prefers the read that matches, of two reads of one bill', () => {
    const poor = parseBill(bill('Milk  xx', 'Onion  35.00'), { total: 91 });
    const good = parseBill(bill('Milk  56.00', 'Onion  35.00'), { total: 91 });
    expect(betterFit(poor, good)).toBe(good);
    expect(betterFit(good, poor)).toBe(good);
  });
});

describe('serial numbers are never amounts', () => {
  const bill = (...rows: string[]) => [...HEAD, ...rows];

  it('on the same row as the item, in one run of words', () => {
    const b = parseBill(bill('1 Milk 2 28.00 56.00', '2 Tomato 1 40.00 40.00', '3 Onion 1 35.00 35.00', 'Grand Total 131.00'), { total: 131, count: 3 });
    expect(amounts(b)).toEqual([56, 40, 35]);
    expect(items(b).map(l => l.name)).toEqual(['Milk', 'Tomato', 'Onion']);
    expect(b.fit).toMatchObject({ matched: true, steps: [] });
  });

  it('when the numbers are on the row below the name', () => {
    const b = parseBill(bill('1 Amul Milk', '2  28.00  56.00', '2 Tomato', '1  40.00  40.00', '3 Onion', '1  35.00  35.00', 'Grand Total  131.00'));
    expect(items(b).map(l => [l.name, l.amount, l.qty])).toEqual([['Amul Milk', 56, 2], ['Tomato', 40, 1], ['Onion', 35, 1]]);
    expect(b.fit?.matched).toBe(true);
  });

  it('when the amount sits alone on the next row', () => {
    const b = parseBill(bill('1 Milk', '56.00', '2 Tomato', '40.00', '3 Onion', '35.00'), { total: 131, count: 3 });
    expect(amounts(b)).toEqual([56, 40, 35]);
  });

  it('when the amount sits just above its serial (a slanted photo)', () => {
    const b = parseBill(bill('56.00', '1 Milk', '40.00', '2 Tomato', '35.00', '3 Onion', 'Grand Total  131.00'));
    expect(items(b).map(l => [l.name, l.amount])).toEqual([['Milk', 56], ['Tomato', 40], ['Onion', 35]]);
  });

  it('when the serial stands alone on its row', () => {
    const b = parseBill(bill('1', 'Milk  56.00', '2', 'Tomato  40.00', '3', 'Onion  35.00'), { total: 131 });
    expect(items(b).map(l => [l.name, l.amount])).toEqual([['Milk', 56], ['Tomato', 40], ['Onion', 35]]);
  });

  it('with a name wrapped over two rows', () => {
    const b = parseBill(bill('1 Amul Taaza Homogenised', 'Toned Milk 500 ml  2  28.00  56.00', '2 Onion  1  35.00  35.00'), { total: 91, count: 2 });
    expect(items(b)[0]).toMatchObject({ name: 'Amul Taaza Homogenised Toned Milk 500 ml', amount: 56 });
    expect(amounts(b)).toEqual([56, 35]);
  });

  it('never makes an item out of a serial with no amount', () => {
    const b = parseBill(bill('1 Milk', '2 Tomato', '3 Onion  1  35.00  35.00'), { total: 131, count: 3 });
    expect(amounts(b)).not.toContain(1);
    expect(amounts(b)).not.toContain(2);
  });

  it('does not take serials for the amounts even when they add up to the total', () => {
    const b = parseBill(bill('1 Milk 56.00', '2 Tomato 40.00', '3 Onion 35.00'), { total: 6 });
    expect(amounts(b)).toEqual([56, 40, 35]);
    expect(b.fit?.matched).toBe(false);
  });

  it('takes the item count from the last serial, and finds one set aside by it', () => {
    const b = parseBill(bill('1 Milk  56.00', '2 Tomato  40.00', '3 Onion  35.00', 'Grand Total  131.00'));
    expect(b.fit).toMatchObject({ matched: true, countOk: true });
  });

  it('leaves a code in the row out of the amounts', () => {
    const b = parseBill(bill('1 Milk 0401 2 28.00 56.00', '2 Curd 0403 1 40.00 40.00'), { total: 96, count: 2 });
    expect(amounts(b)).toEqual([56, 40]);
    expect(items(b)[0]).toMatchObject({ qty: 2, rate: 28 });
  });

  it('reads whole-rupee bills too', () => {
    const b = parseBill(bill('1 Milk 2 28 56', '2 Tomato 1 40 40', '3 Onion 1 35 35', 'Total 131'), { total: 131, count: 3 });
    expect(amounts(b)).toEqual([56, 40, 35]);
  });

  it('finds the amount column from the rows that prove it, with nothing entered', () => {
    const b = parseBill(bill('1 Milk  2  28.00  56.00  2.80', '2 Curd  3  20.00  60.00  3.00', '3 Onion  1  35.00  35.00  1.75'));
    expect(amounts(b)).toEqual([56, 60, 35]);
  });

  it('on a bill with paise, a small whole number ending a row is not its amount', () => {
    const b = parseBill(bill('Milk  56.00', 'Tomato  40.00', 'Onion  2', '35.00', 'Curd  20.00', 'Grand Total  151.00'));
    expect(items(b).map(l => [l.name, l.amount])).toEqual([['Milk', 56], ['Tomato', 40], ['Onion', 35], ['Curd', 20]]);
  });

  it('still takes a number in front of the words as how many, without a serial column', () => {
    const b = parseBill(bill('2 Milk  56.00', '1 Tomato  40.00', '2 Onion  70.00'));
    expect(items(b).map(l => [l.qty, l.amount])).toEqual([[2, 56], [1, 40], [2, 70]]);
  });

  it('reads a supermarket roll: HSN and name on one row, the numbers on the next, tax summary below', () => {
    const b = parseBill(['RATNA SUPERMARKET', 'Hyderabad 500032', 'GSTIN 36ABCDE1234F1Z5', 'Bill No: 8841  Dt: 02/11/2026', 'SNo Particulars Qty Rate Amount',
      '1 TATA SALT 1KG', '25010020  2  28.00  56.00', '2 SURF EXCEL 500G', '34022010  1  110.50  110.50', '3 GOOD DAY BISCUIT', '19053100  3  10.00  30.00',
      'Total Qty: 6', 'CGST 2.5%  4.91', 'SGST 2.5%  4.91', 'Grand Total  196.50', 'UPI  196.50'], { total: 196.5, count: 3 });
    expect(items(b).map(l => [l.name, l.qty, l.amount])).toEqual([['Tata Salt 1 kg', 2, 56], ['Surf Excel 500 g', 1, 110.5], ['Good Day Biscuit', 3, 30]]);
    expect(b.fit?.matched).toBe(true);
    expect(billSum(b.lines)).toBe(196.5);
  });

  it('knows the word total when OCR gets a letter wrong', () => {
    for (const word of ['Grand Tctal', 'Totai', 'Tota1']) {
      const b = parseBill(bill('Milk  56.00', 'Onion  35.00', `${word}  91.00`));
      expect(items(b).map(l => l.name)).toEqual(['Milk', 'Onion']);
      expect(b.total).toBe(91);
    }
  });

  it('does not mistake a real item for the total', () => {
    const b = parseBill(bill('Milk  56.00', 'Hotel Soap  35.00', 'Total  91.00'));
    expect(items(b).map(l => l.name)).toEqual(['Milk', 'Hotel Soap']);
  });

  it('takes a last row that comes to the sum of the others as the total, whatever its words', () => {
    const b = parseBill(bill('Milk  56.00', 'Onion  35.00', 'Curd  20.00', 'Xqzzy Blorp  111.00'));
    expect(items(b).map(l => l.name)).toEqual(['Milk', 'Onion', 'Curd']);
    expect(b.total).toBe(111);
    expect(b.fit?.matched).toBe(true);
  });

  it('does not call a read matched when there was nothing to check it against', () => {
    const b = parseBill(bill('Milk  56.00', 'Onion  35.00', 'Curd  20.00', 'Total Items: 3'));
    expect(b.fit?.matched).toBe(false);
  });
});

describe('no false matches', () => {
  const bill = (...rows: string[]) => [...HEAD, ...rows];
  const proven = ['1 Atta  1  285.00  285.00', '2 Dal  2  168.50  337.00', '3 Oil  1  142.00  142.00', '4 Maggi  6  14.00  84.00', '5 Soap  4  38.50  154.00'];

  it('never takes the quantity column for the amounts, whatever the total', () => {
    const b = parseBill(bill(...proven), { total: 14 });
    expect(amounts(b)).toEqual([285, 337, 142, 84, 154]);
    expect(b.fit?.matched).toBe(false);
  });

  it('leaves rows alone that prove their amounts, against a misread printed total', () => {
    const b = parseBill(bill(...proven, 'Grand Total  1389.22'));
    expect(amounts(b)).toEqual([285, 337, 142, 84, 154]);
    expect(b.fit?.matched).toBe(false);
  });

  it('does not change a proved row to make an entered total come right', () => {
    const b = parseBill(bill(...proven), { total: 1032.5 });
    expect(amounts(b).slice(1)).toEqual([337, 142, 84, 154]);
    expect(b.lines.filter(l => l.readAs != null)).toEqual([]);
  });

  it('says so when a bad read cannot come right, rather than forcing it', () => {
    const b = parseBill(bill('FKondapur  500', 'Atta Skg  288.2', 'Toor Dal  337.02', 'S:cap  38.5', 'Barana  456', 'Grand Total  1359.00'));
    expect(b.fit?.matched).toBe(false);
    expect(b.lines.filter(l => l.readAs != null)).toEqual([]);
  });
});

describe('several reads of one bill', () => {
  const bill = (...rows: string[]) => [...HEAD, ...rows];

  it('checks each read with the total another read caught', () => {
    const lostItem = bill('1 Milk  56.00', '2 Onion  35.00', 'Total Items: 3', 'Grand Total  111.00');
    const lostTotal = bill('1 Milk  56.00', '2 Onion  35.00', '3 Curd  20.00', 'Payment  xx');
    const b = parseReads([lostItem, lostTotal]);
    expect(amounts(b)).toEqual([56, 35, 20]);
    expect(b.total).toBe(111);
    expect(b.fit).toMatchObject({ matched: true, against: 'PRINTED' });
  });

  it('keeps what the person entered as the truth', () => {
    const b = parseReads([bill('Milk  56.00', 'Onion  35.00', 'Grand Total  99.00'), bill('Milk  56.00', 'Onion  35.00', 'Grand Total  91.00')], { total: 91 });
    expect(b.total).toBe(91);
    expect(b.fit?.against).toBe('ENTERED');
  });
});
