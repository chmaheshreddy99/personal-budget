/**
 * Bank SMS from Indian banks and card issuers, in the shapes they send: what must be read as money going out (with
 * its amount, digits, shop, reference and date), and what must not (credits, OTPs, reminders, failures, requests).
 */
import { isDebitSms, parseSms } from '../src/sms';
import type { Account } from '../src/data';

const at = new Date('2026-10-13T11:00:00').getTime();
const acc = (over: Partial<Account>): Account => ({
  id: 1, name: 'Bank', type: 'BANK', typeLabel: 'Bank Account', accountClass: 'ASSET', group: 'OWN', groupName: null, institution: null,
  last4: null, balance: 0, creditLimit: null, availableCredit: null, monthIn: 0, monthOut: 0, lastActivity: null, payFrom: true, system: false, ...over,
});
const accounts = [
  acc({ id: 1, name: 'SBI Savings', institution: 'SBI', last4: '1234' }),
  acc({ id: 2, name: 'HDFC Salary', institution: 'HDFC Bank', last4: '5678' }),
  acc({ id: 3, name: 'HDFC Regalia', type: 'CREDIT_CARD', accountClass: 'LIABILITY', institution: 'HDFC', last4: '9876' }),
  acc({ id: 4, name: 'ICICI Amazon Pay card', type: 'CREDIT_CARD', accountClass: 'LIABILITY', institution: 'ICICI' }),
];
const cats = [{ id: 10, name: 'Dining Out', system: false, uses: 1 }, { id: 11, name: 'Shopping', system: false, uses: 1 },
  { id: 12, name: 'Groceries', system: false, uses: 1 }, { id: 13, name: 'Fuel & Transport', system: false, uses: 1 }];
const read = (body: string, sender = 'VM-BANKSM') => parseSms({ id: 'x', sender, body, at }, accounts, cats);

type Case = [string, string, { amount: number; last4?: string | null; merchant?: string | null; date?: string; account?: number | null; ref?: string }];
const DEBITS: Case[] = [
  ['SBI UPI', 'Dear UPI user A/C X1234 debited by 500.0 on date 13Oct26 trf to SWIGGY Refno 628512345678. If not u? call 1800111109. -SBI',
    { amount: 500, last4: '1234', merchant: 'Swiggy', date: '2026-10-13', account: 1, ref: '628512345678' }],
  ['SBI debit card', 'Your A/C XXXXX1234 has a debit by transfer of Rs 1,250.00 on 12/10/26. Avl Bal Rs 23,456.10.-SBI', { amount: 1250, last4: '1234', date: '2026-10-12', account: 1 }],
  ['SBI ATM', 'Dear Customer, Rs.2000 withdrawn at SBI ATM S1NC000123 from A/cX1234 on 13Oct26 Transaction Number 1234. Available Balance Rs.10,000. -SBI',
    { amount: 2000, last4: '1234', account: 1 }],
  ['HDFC UPI sent', 'Sent Rs.500.00\nFrom HDFC Bank A/C *5678\nTo SWIGGY\nOn 13/10/26\nRef 628512345678\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808',
    { amount: 500, last4: '5678', merchant: 'Swiggy', date: '2026-10-13', account: 2, ref: '628512345678' }],
  ['HDFC old UPI', 'Rs.350.00 debited from a/c **5678 on 12-10-26 to VPA zomato@hdfcbank(UPI Ref No 628599999999). Not you? Call on 18002586161 to report',
    { amount: 350, last4: '5678', merchant: 'Zomato', account: 2, ref: '628599999999' }],
  ['HDFC card', 'Spent Rs.2499 On HDFC Bank Card 9876 At AMAZON On 2026-10-13:10:20:11 Bal Rs.97501 Not You? Call 18002586161/SMS BLOCK DC 9876 to 7308080808',
    { amount: 2499, last4: '9876', merchant: 'Amazon', date: '2026-10-13', account: 3 }],
  ['HDFC card txn', 'Txn Rs.1,199.00 On HDFC Bank Credit Card xx9876 At FLIPKART by UPI 628511112222 On 13-10 Not You? Call 18002586161',
    { amount: 1199, last4: '9876', merchant: 'Flipkart', account: 3 }],
  ['ICICI account', 'ICICI Bank Acct XX234 debited for Rs 500.00 on 13-Oct-26; Swiggy credited. UPI:628512345678. Call 18002662 for dispute. SMS BLOCK 234 to 9215676766',
    { amount: 500, last4: '234', merchant: 'Swiggy', date: '2026-10-13', ref: '628512345678' }],
  ['ICICI card', 'INR 2,499.00 spent using ICICI Bank Card XX9876 on 13-Oct-26 on AMAZON PAY. Avl Limit: INR 1,20,000.00. If not you, call 1800 2662/SMS BLOCK 9876 to 9215676766.',
    { amount: 2499, merchant: 'Amazon Pay', date: '2026-10-13' }],
  ['Axis UPI', 'INR 500.00 debited\nA/c no. XX1234\n13-10-26, 10:20:11\nUPI/P2M/628512345678/SWIGGY\nNot you? SMS BLOCKUPI Cust ID to 919951860002\nAxis Bank',
    { amount: 500, last4: '1234', merchant: 'Swiggy', ref: '628512345678' }],
  ['Axis card', 'Spent\nCard no. XX9876\nINR 799\n13-10-26 10:20:11\nSWIGGY\nAvl Lmt INR 50,000\nSMS BLOCK 9876 to 919951860002, if not you - Axis Bank', { amount: 799, last4: '9876' }],
  ['Kotak', 'Sent Rs.500.00 from Kotak Bank AC X1234 to swiggy@ybl on 13-10-26.UPI Ref 628512345678. Not you, https://kotak.com/KBANKT/Fraud',
    { amount: 500, last4: '1234', merchant: 'Swiggy', ref: '628512345678' }],
  ['Bank of Baroda', 'Rs.500.00 transferred from A/c ...1234 to:UPI/628512345678. Total Bal:Rs.10000.00CR. Avlbl Amt:Rs.10000.00(13-10-2026 10:20:11) - Bank of Baroda',
    { amount: 500, last4: '1234', ref: '628512345678' }],
  ['Union', 'A/c *1234 Debited for Rs:500.00 on 13-10-2026 10:20:11 by Mob Bk ref no 628512345678 Avl Bal Rs:1000.00.If not you, Call 1800222243 -Union Bank of India',
    { amount: 500, last4: '1234', date: '2026-10-13', ref: '628512345678' }],
  ['Canara', 'An amount of INR 500.00 has been DEBITED to your account XXX1234 on 13/10/2026. Total Avail.bal INR 10,000.00 - Canara Bank', { amount: 500, last4: '1234' }],
  ['PNB', 'Your A/c XX1234 debited INR 500.00 on 13-10-26 thru UPI:628512345678. A/c Bal INR 10,000.00 CR. Not you? Call 18001800/18002021 -PNB',
    { amount: 500, last4: '1234', ref: '628512345678' }],
  ['IDFC FIRST', 'Your A/C XXXXXXX1234 has been debited by INR 500.00 on 13/10/2026 10:20. New balance is INR 10,000.00. If not done by you, call 18004194332 - IDFC FIRST Bank',
    { amount: 500, last4: '1234' }],
  ['IndusInd card', 'Transaction of INR 1500.00 on your IndusInd Bank Credit Card ending 9876 at BIGBASKET on 13-10-26. Available limit INR 98,500.00', { amount: 1500, last4: '9876', merchant: 'Bigbasket' }],
  ['Federal', 'Rs 500.00 debited from your A/c XX1234 to VPA swiggy@ybl on 13-10-2026 10:20:11. Bal: Rs 10000.00 - Federal Bank', { amount: 500, last4: '1234', merchant: 'Swiggy' }],
  ['Yes', 'INR 500.00 debited from YES BANK A/c XX1234 on 13-OCT-2026 10:20. UPI/628512345678/SWIGGY. Avl Bal INR 10,000.00', { amount: 500, last4: '1234' }],
  ['Paytm Bank', 'Paid Rs.120 to Uber India from Paytm Payments Bank a/c 1234. UPI Ref: 628512345678', { amount: 120, merchant: 'Uber India', ref: '628512345678' }],
  ['SBI Card', 'Rs.3,499.00 spent on your SBI Credit Card ending 9876 at MYNTRA on 13/10/26. Trxn. not done by you? Report at https://sbicard.com/Dispute', { amount: 3499, last4: '9876', merchant: 'Myntra' }],
  ['Amex', 'Alert: You\'ve spent INR 1,500.00 on your AMEX card ** 41005 at ZOMATO on 13 October 2026 at 09:55 PM IST.', { amount: 1500, merchant: 'Zomato' }],
  ['IMPS', 'Rs 10,000.00 debited from A/c XX1234 on 13-10-26 via IMPS to Ravi Kumar. IMPS Ref No 628512345678. Avl Bal Rs 50,000.00', { amount: 10000, last4: '1234', ref: '628512345678' }],
  ['NACH', 'Your a/c XX1234 is debited with INR 2,500.00 on 05-10-26 towards NACH/ACH Debit of BAJAJ FINANCE. Avl Bal INR 10,000.00', { amount: 2500, last4: '1234' }],
];

const NOT_DEBITS: [string, string][] = [
  ['salary credit', 'Rs 50,000.00 credited to your A/c XX1234 on 01-10-26 by NEFT from ACME PVT LTD. Avl Bal Rs 60,000.00'],
  ['UPI received', 'Dear SBI UPI User, ur A/cX1234 credited by Rs500 on 13Oct26 by (Ref no 628512345678)'],
  ['OTP', 'OTP for transaction of Rs 2,499.00 at AMAZON on your HDFC Bank Card 9876 is 123456. Do not share.'],
  ['bill due', 'Your HDFC Bank Credit Card statement: Total Amt Due Rs 12,345.00, Min Amt Due Rs 617.00, due on 05-11-2026.'],
  ['will be debited', 'Rs 2,500.00 will be debited from your A/c XX1234 on 05-11-26 towards your loan EMI.'],
  ['failed', 'Your transaction of Rs 500.00 on A/c XX1234 has failed. Any amount debited will be reversed.'],
  ['collect request', 'Swiggy has requested money from you on Google Pay. On approving, Rs 500 will be debited from your account.'],
  ['refund', 'Refund of Rs 499.00 for your Amazon order has been credited to your HDFC Bank Card 9876.'],
  ['promo', 'Get 10% cashback up to Rs 500 on your next purchase with HDFC Bank Debit Card. T&C apply.'],
];

describe('money going out is read', () => {
  test.each(DEBITS)('%s', (_name, body, want) => {
    const p = read(body);
    expect(p).not.toBeNull();
    expect(p!.amount).toBe(want.amount);
    if (want.last4 !== undefined) expect(p!.last4).toBe(want.last4);
    if (want.merchant !== undefined) expect(p!.merchant).toBe(want.merchant);
    if (want.date) expect(p!.date).toBe(want.date);
    if (want.account !== undefined) expect(p!.accountId).toBe(want.account);
    if (want.ref) expect(p!.reference).toBe(want.ref);
  });
});

describe('what is not an expense is left alone', () => {
  test.each(NOT_DEBITS)('%s', (_name, body) => {
    expect(isDebitSms(body)).toBe(false);
    expect(read(body)).toBeNull();
  });
});

test('a card without digits on record is matched by its bank', () => {
  expect(read('INR 799.00 spent using ICICI Bank Card XX4444 on 13-Oct-26 on SWIGGY. Avl Limit: INR 1,20,000.00', 'JD-ICICIT-S')!.accountId).toBe(4);
});

test('a category is suggested from the shop', () => {
  expect(read('Sent Rs.500.00 From HDFC Bank A/C *5678 To SWIGGY On 13/10/26 Ref 628512345678')!.categoryId).toBe(10);
  expect(read('Txn Rs.1,199.00 On HDFC Bank Credit Card xx9876 At FLIPKART On 13-10')!.categoryId).toBe(11);
});
