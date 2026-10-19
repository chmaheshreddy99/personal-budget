/**
 * Categories on the phone: a bank SMS goes to the most specific expense category the household has (falling back to a
 * broader one), never to an income or system category; and every category, expense or income, gets its own icon.
 */
import { matchCategory } from '../src/sms';
import { categoryLook } from '../src/ui';
import type { Category } from '../src/data';

// icons as their names (jest.mock is hoisted above the imports)
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_t, name) => name }));
jest.mock('react-native-svg', () => ({}));

const cat = (id: number, name: string, over: Partial<Category> = {}): Category => ({ id, name, kind: 'EXPENSE', system: false, uses: 0, ...over });

const full = [
  cat(1, 'Dining Out'), cat(2, 'Food Delivery'), cat(3, 'Groceries'), cat(4, 'Milk & Dairy'), cat(5, 'Fuel & Transport'), cat(6, 'Cab & Auto'),
  cat(7, 'Parking & Tolls'), cat(8, 'Gas Cylinder (LPG)'), cat(9, 'Subscriptions'), cat(10, 'Pharmacy & Medicines'), cat(11, 'Medical & Health'),
  cat(12, 'Chit Payments', { system: true }), cat(13, 'Commission & Brokerage', { kind: 'INCOME' }), cat(14, 'Shopping'),
];
const older = [cat(1, 'Dining Out'), cat(5, 'Fuel & Transport'), cat(11, 'Medical & Health')];

describe('a bank SMS finds its category', () => {
  it.each([
    ['Sent Rs.500 To SWIGGY', 2, 1],
    ['debited for UBER INDIA', 6, 5],
    ['paid to FASTAG toll plaza', 7, 5],
    ['paid to INDANE GAS', 8, null],
    ['spent at NETFLIX.COM', 9, null],
    ['paid to MEDPLUS pharmacy', 10, 11],
    ['paid to HERITAGE FOODS milk', 4, 1],
  ])('%s', (text, best, fallback) => {
    expect(matchCategory(full, text)).toBe(best);
    expect(matchCategory(older, text)).toBe(fallback);
  });

  it('never picks an income or a system category', () => {
    expect(matchCategory([cat(12, 'Chit Payments', { system: true }), cat(13, 'Shopping', { kind: 'INCOME' })], 'spent at AMAZON')).toBeNull();
  });

  it('does not take "auto debit" or "last 4 digits" for a cab or an insurer', () => {
    expect(matchCategory(full, 'Auto debit of Rs 500 from a/c XX1234, last 4 digits')).toBeNull();
  });
});

describe('every category has its own icon', () => {
  it.each([
    ['Chit Payments', 'HandCoins'], ['Chit Commission Income', 'HandCoins'], ['Chit Commission & Discount', 'Percent'],
    ['Salary', 'Briefcase'], ['Interest', 'Percent'], ['Loan Interest', 'Building2'], ['Rental Income', 'Home'], ['Rent', 'Home'],
    ['Water Cans', 'Droplets'], ['Utilities', 'Zap'], ['Vehicle Maintenance', 'Car'], ['Home Maintenance', 'Wrench'],
    ['Cab & Auto', 'CarTaxiFront'], ['Pets', 'PawPrint'], ['Taxes', 'Receipt'], ['Food Delivery', 'Truck'], ['Commission & Brokerage', 'Handshake'],
  ])('%s', (name, icon) => {
    expect(categoryLook(name).Icon).toBe(icon);
  });
});
