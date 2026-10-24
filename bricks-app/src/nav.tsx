/**
 * Moving between screens without a navigation library: the tabs (Home, the most used screens given to the user, More)
 * and a stack of screens opened over them (an order, a request, a form). Back closes the top screen, then goes to Home.
 * Screens under the top one stay mounted, so going back keeps where you were; after a change anywhere (changed())
 * every loaded screen fetches its data again.
 */
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

export type RouteName =
  | 'Approvals' | 'Approval' | 'Orders' | 'Order' | 'NewOrder' | 'Deliveries' | 'Payments' | 'Stock' | 'Production' | 'NewBatch'
  | 'Purchases' | 'NewPurchase' | 'NewExpense' | 'Team' | 'Cashbook' | 'Reports' | 'Dashboard' | 'Alerts' | 'Account'
  | 'Password' | 'Doc' | 'PaySlip';

export type Route = { key: number; name: RouteName; params: any };

type Nav = {
  stack: Route[];
  tab: string;
  setTab: (t: string) => void;
  push: (name: RouteName, params?: any) => void;
  /** the top screen closes (with n: that many) */
  pop: (n?: number) => void;
  /** the top screen is swapped for another (a form for what it made) */
  replace: (name: RouteName, params?: any) => void;
  /** a change was made: loaded screens fetch again */
  version: number;
  changed: () => void;
};

const NavContext = createContext<Nav | null>(null);

export function useNav(): Nav {
  const n = useContext(NavContext);
  if (!n) throw new Error('useNav outside NavProvider');
  return n;
}

export function NavProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<Route[]>([]);
  const [tab, setTabState] = useState('home');
  const [version, setVersion] = useState(0);
  const next = useRef(1);

  const push = useCallback((name: RouteName, params: any = {}) => setStack(s => [...s, { key: next.current++, name, params }]), []);
  const pop = useCallback((n = 1) => setStack(s => s.slice(0, Math.max(0, s.length - n))), []);
  const replace = useCallback((name: RouteName, params: any = {}) => setStack(s => [...s.slice(0, -1), { key: next.current++, name, params }]), []);
  const setTab = useCallback((t: string) => { setStack([]); setTabState(t); }, []);
  const changed = useCallback(() => setVersion(v => v + 1), []);

  const value = useMemo(() => ({ stack, tab, setTab, push, pop, replace, version, changed }), [stack, tab, setTab, push, pop, replace, version, changed]);
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}
