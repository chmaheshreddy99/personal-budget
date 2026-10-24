import { given, tabsFor } from '../src/modules';
import { count, qty, money } from '../src/format';
import { normalizeUrl } from '../src/api';
import { isHeld, Profile } from '../src/types';

const profile = (over: Partial<Profile>): Profile => ({
  userId: 1, fullName: 'Ravi Kumar', username: 'ravi', organization: 'Home', company: 'Sri Blocks', companyPhone: null, currency: 'INR',
  role: 'MANAGER', roleLabel: 'Manager', permissions: ['STOCK', 'PRODUCTION', 'PURCHASES', 'SALES', 'FINANCE', 'APPROVE', 'SETUP'],
  modules: [], decide: true, record: true, evidence: true, pendingApprovals: 0, unreadNotices: 0, locked: null, serverTime: '2026-10-23T10:00:00',
  ...over,
});

describe('the screens given by the web app', () => {
  it('shows only what is given, in a steady order', () => {
    const p = profile({ modules: ['STOCK', 'ORDERS', 'ALERTS'] });
    expect(given(p).map(m => m.key)).toEqual(['ORDERS', 'STOCK', 'ALERTS']);
    expect(given(null)).toEqual([]);
  });

  it('puts approvals first in the bar for a checker, and later for a maker', () => {
    const all: Profile['modules'] = ['APPROVALS', 'ORDERS', 'DELIVERIES', 'PRODUCTION', 'STOCK'];
    expect(tabsFor(profile({ modules: all }))).toEqual(['APPROVALS', 'ORDERS', 'DELIVERIES']);
    expect(tabsFor(profile({ modules: all, permissions: ['STOCK', 'SALES'] }))).toEqual(['ORDERS', 'DELIVERIES', 'PRODUCTION']);
  });

  it('never puts alerts in the bar (they are the bell on Home)', () => {
    expect(tabsFor(profile({ modules: ['ALERTS', 'STOCK'] }))).toEqual(['STOCK']);
  });
});

describe('money, counts and addresses', () => {
  it('formats the Indian way', () => {
    expect(money(1234567)).toBe('₹12,34,567');
    expect(money(32.5, 2)).toBe('₹32.50');
    expect(count(12500)).toBe('12,500');
    expect(qty(2.5)).toBe('2.5');
    expect(qty(3)).toBe('3');
  });

  it('completes a server address', () => {
    expect(normalizeUrl('abc.ngrok-free.app/')).toBe('https://abc.ngrok-free.app');
    expect(normalizeUrl('192.168.1.5:8080')).toBe('http://192.168.1.5:8080');
  });

  it('knows a change held for a checker', () => {
    expect(isHeld({ pendingApproval: true, message: 'AP-0004: sent for approval', pending: { id: 4 } })).toBe(true);
    expect(isHeld({ order: {} })).toBe(false);
  });
});
