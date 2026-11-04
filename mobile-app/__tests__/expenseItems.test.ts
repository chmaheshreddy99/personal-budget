/** A bill of several items is one expense in the Expenses tab; the phone follows the order arranged on the web. */
import { arranged, itemsByCategory, joinExpenseLines, ServerExpense } from '../src/data';

const line = (entryId: number, lineId: number, categoryName: string, amount: number, memo?: string | null): ServerExpense => ({
  entryId, entryNo: `JV-${entryId}`, date: '2026-11-01', narration: 'Fresh Mart', party: 'Fresh Mart', reference: null, categoryId: lineId, categoryName, amount,
  paidFromId: 1, paidFrom: 'HDFC', status: null, lineId, memo, itemized: true,
});

describe('joining the lines of an expense', () => {
  it('makes one expense of a bill, with its total and items', () => {
    const [bill, ...rest] = joinExpenseLines([line(7, 1, 'Groceries', 100, 'Rice'), line(7, 2, 'Household', 40.5, 'Soap'), line(7, 3, 'Groceries', 60, 'Dal')]);
    expect(rest).toEqual([]);
    expect(bill.amount).toBeCloseTo(200.5);
    expect(bill.items?.map(i => i.name)).toEqual(['Rice', 'Soap', 'Dal']);
  });

  it('keeps expenses apart, an ordinary one without items, in the order they came', () => {
    const joined = joinExpenseLines([line(9, 1, 'Fuel', 500), line(7, 2, 'Groceries', 100), line(7, 3, 'Household', 40)]);
    expect(joined.map(j => j.first.entryId)).toEqual([9, 7]);
    expect(joined[0].items).toBeUndefined();
    expect(joined[0].amount).toBe(500);
    expect(joined[1].items).toHaveLength(2);
  });

  it('leaves the name empty when none was recorded, never repeating the category', () => {
    const [bill] = joinExpenseLines([line(7, 1, 'Groceries', 100, null), line(7, 2, 'Household', 40, '  '), line(7, 3, 'Fruits', 30, 'fruits ')]);
    expect(bill.items?.map(i => i.name)).toEqual(['', '', '']);
    expect(bill.items?.map(i => i.category)).toEqual(['Groceries', 'Household', 'Fruits']);
  });

  it('gives two items of one category their own keys', () => {
    const [bill] = joinExpenseLines([line(7, 1, 'Groceries', 100, 'Rice'), line(7, 2, 'Groceries', 60, 'Dal')]);
    expect(new Set(bill.items?.map(i => i.key)).size).toBe(2);
  });
});

describe('a bill by category', () => {
  it('adds up each category, largest first, with its share', () => {
    const [bill] = joinExpenseLines([line(7, 1, 'Household', 25, 'Soap'), line(7, 2, 'Groceries', 50, 'Rice'), line(7, 3, 'Groceries', 25, 'Dal')]);
    const groups = itemsByCategory(bill.items!);
    expect(groups.map(g => [g.category, g.amount, g.share])).toEqual([['Groceries', 75, 0.75], ['Household', 25, 0.25]]);
    expect(groups[0].items.map(i => i.name)).toEqual(['Rice', 'Dal']);
  });
});

describe('the order arranged on the web', () => {
  const id = (x: number) => x;
  it('leaves a list never arranged as it came', () => expect(arranged(undefined, [3, 1, 2], id)).toEqual([3, 1, 2]));
  it('puts the saved ones first, what is new after them as it came', () => expect(arranged([2, 3], [9, 3, 1, 2], id)).toEqual([2, 3, 9, 1]));
});
