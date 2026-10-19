/**
 * The parts of the app that decide money: reading bank SMS, Indian money formatting, and the balances shown before
 * a sync (the server's less what was spent on the phone).
 */
import { parseSms } from '../src/sms';
import { money, moneyShort } from '../src/format';
import { Account, DEFAULT_SETTINGS, LocalChitPayment, LocalExpense, liveBalance, normalizeUrl, visibleAccounts } from '../src/data';

const acc = (over: Partial<Account>): Account => ({
  id: 1, name: 'HDFC Savings', type: 'BANK', typeLabel: 'Bank Account', accountClass: 'ASSET', group: 'OWN', groupName: null, institution: 'HDFC',
  last4: '4321', balance: 50000, creditLimit: null, availableCredit: null, monthIn: 0, monthOut: 0, lastActivity: '2026-10-01', payFrom: true, system: false, ...over,
});
const accounts = [acc({}), acc({ id: 2, name: 'ICICI Amazon Card', type: 'CREDIT_CARD', accountClass: 'LIABILITY', institution: 'ICICI', last4: '9876', balance: 12000, creditLimit: 100000 })];
const categories = [{ id: 10, name: 'Dining Out', system: false, uses: 5 }, { id: 11, name: 'Shopping & Clothing', system: false, uses: 3 },
  { id: 12, name: 'Groceries', system: false, uses: 9 }];
const sms = (body: string, sender = 'AX-HDFCBK') => ({ id: 'x', sender, body, at: new Date('2026-10-13T10:00:00').getTime() });

test('a UPI debit from a bank account', () => {
  const p = parseSms(sms('Rs.1,250.00 debited from A/c XX4321 on 12-10-26 to VPA swiggy@ybl UPI Ref 628512345678 -HDFC Bank'), accounts, categories)!;
  expect(p.amount).toBe(1250);
  expect(p.last4).toBe('4321');
  expect(p.accountId).toBe(1);
  expect(p.merchant).toBe('Swiggy');
  expect(p.reference).toBe('628512345678');
  expect(p.date).toBe('2026-10-12');
  expect(p.categoryId).toBe(10);
});

test('a card purchase', () => {
  const p = parseSms(sms('INR 2,499.00 spent on ICICI Bank Card XX9876 on 13-Oct-26 at AMAZON PAY. Avl Lmt: INR 1,20,000', 'VM-ICICIB'), accounts, categories)!;
  expect(p.amount).toBe(2499);
  expect(p.card).toBe(true);
  expect(p.accountId).toBe(2);
  expect(p.merchant).toBe('Amazon Pay');
  expect(p.categoryId).toBe(11);
});

test('money coming in, and OTPs, are not expenses', () => {
  expect(parseSms(sms('Rs 5,000.00 credited to A/c XX4321 on 12-10-26 by NEFT'), accounts, categories)).toBeNull();
  expect(parseSms(sms('Your account has been credited with Rs 500; Rs 20 debited as charges'), accounts, categories)).toBeNull();
});

test('Indian money', () => {
  expect(money(1234567.5)).toBe('₹12,34,567.50');
  expect(money(140390.9, 2)).toBe('₹1,40,390.90');
  expect(money(-500)).toBe('−₹500');
  expect(moneyShort(150000)).toBe('₹1.5L');
  expect(moneyShort(25000000)).toBe('₹2.5Cr');
});

test('what was spent on the phone comes off the balance until synced', () => {
  const q = [{ paidFromId: 1, amount: 1000, status: 'QUEUED' }, { paidFromId: 2, amount: 500, status: 'FAILED' }, { paidFromId: 1, amount: 99, status: 'SYNCED' }] as LocalExpense[];
  expect(liveBalance(accounts[0], q)).toEqual({ balance: 49000, pending: 1000 });
  // a card's balance is what is owed: it goes up
  expect(liveBalance(accounts[1], q)).toEqual({ balance: 12500, pending: 500 });
});

test('server addresses', () => {
  expect(normalizeUrl('abc.ngrok-free.app/')).toBe('https://abc.ngrok-free.app');
  expect(normalizeUrl('192.168.1.5:8080')).toBe('http://192.168.1.5:8080');
});

test('construction, hosted chit and EMI accounts are hidden until turned on; chosen accounts limit the list', () => {
  const all = [acc({}), acc({ id: 5, group: 'CONSTRUCTION' }), acc({ id: 6, group: 'HOSTED_CHIT' }), acc({ id: 7, group: 'EMI' }), acc({ id: 8 })];
  expect(visibleAccounts(DEFAULT_SETTINGS, all).map(a => a.id)).toEqual([1, 8]);
  expect(visibleAccounts({ ...DEFAULT_SETTINGS, showGroups: ['CONSTRUCTION'] }, all).map(a => a.id)).toEqual([1, 5, 8]);
  expect(visibleAccounts({ ...DEFAULT_SETTINGS, accountFilter: 'chosen', chosenAccounts: [8, 5] }, all).map(a => a.id)).toEqual([8]);
});

test('a chit instalment paid on the phone comes off the account until synced', () => {
  const chits = [{ fromAccountId: 1, amount: 4500, status: 'QUEUED' }, { fromAccountId: 1, amount: 4500, status: 'SYNCED' }] as LocalChitPayment[];
  expect(liveBalance(accounts[0], [], chits)).toEqual({ balance: 45500, pending: 4500 });
});
