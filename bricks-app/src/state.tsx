/**
 * The app's state: the session, the profile (the screens the web app gives this user, and what they may do), the
 * brick business's set-up (types, materials, teams, vehicles), toasts, and loading a screen's data with its last
 * answer shown first.
 *
 * The profile is read again when the app comes to the front and every minute while it is open, so a change on the web
 * app (Settings → Bricks app) reaches the phone quickly; the server checks every call anyway.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { ApiError, Brand, EMPTY_SESSION, login, request, Session, store } from './api';
import { Meta, ModuleKey, MoneyAccount, Profile } from './types';
import { useNav } from './nav';

export type ToastTone = 'good' | 'bad' | 'info';
export type Toast = { id: number; text: string; tone: ToastTone };

type Ctx = {
  ready: boolean;
  session: Session;
  profile: Profile | null;
  /** the session is on the default password: a new one first */
  mustChangePassword: boolean;
  meta: Meta | null;
  accounts: MoneyAccount[];
  toast: Toast | null;
  /** the server did not answer the last time it was asked */
  offline: boolean;
  /** the server is older than this app needs (null: not known yet): see SERVER_NEEDED */
  serverBehind: boolean | null;
  has: (m: ModuleKey) => boolean;
  call: <T>(path: string, opts?: { method?: string; body?: unknown; timeoutMs?: number }) => Promise<T>;
  signIn: (server: string, username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  loadMeta: (force?: boolean) => Promise<Meta | null>;
  loadAccounts: () => Promise<MoneyAccount[]>;
  say: (text: string, tone?: ToastTone) => void;
  passwordChanged: () => void;
};

const AppContext = createContext<Ctx | null>(null);

/** The server side this app needs (GET /api/meta/app → bricksApp): 2 = alerts to the web app, documents, the pay run. */
export const SERVER_NEEDED = 2;

export function useApp(): Ctx {
  const c = useContext(AppContext);
  if (!c) throw new Error('useApp outside AppProvider');
  return c;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session>(EMPTY_SESSION);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mustChangePassword, setMustChange] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [offline, setOffline] = useState(false);
  const [serverBehind, setServerBehind] = useState<boolean | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((text: string, tone: ToastTone = 'good') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, tone });
    toastTimer.current = setTimeout(() => setToast(null), tone === 'bad' ? 4500 : 2800);
  }, []);

  const signOut = useCallback(async () => {
    const s = sessionRef.current;
    if (s.token) request(s, '/auth/logout', { method: 'POST', timeoutMs: 5000 }).catch(() => undefined);
    await store.signOut(s);
    setSession({ ...EMPTY_SESSION, server: s.server, username: s.username, brand: s.brand });
    setProfile(null);
    setMeta(null);
    setAccounts([]);
    setMustChange(false);
  }, []);

  const call = useCallback(async <T,>(path: string, opts?: { method?: string; body?: unknown; timeoutMs?: number }): Promise<T> => {
    try {
      const out = await request<T>(sessionRef.current, path, opts);
      setOffline(false);
      return out;
    } catch (e) {
      if (e instanceof ApiError) {
        setOffline(e.status === 0);
        if (e.status === 401 && sessionRef.current.token) {
          await signOut();
          say('Signed out: please sign in again', 'bad');
        }
      }
      throw e;
    }
  }, [signOut, say]);

  /** The company's name and logo changed on the web app (or came with signing in): kept with the session. */
  const keepBrand = useCallback((brand: Brand) => {
    const s = sessionRef.current;
    if (s.brand?.name === brand.name && s.brand?.logo === brand.logo) return;
    const next = { ...s, brand };
    sessionRef.current = next;
    setSession(next);
    store.saveSession(next);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!sessionRef.current.token) return;
    try {
      const p = await call<Profile>('/bricks/app/profile');
      setProfile(p);
      store.saveProfile(p);
      keepBrand({ name: p.brandName || null, logo: p.brandLogo || null });
    } catch (e) {
      if (e instanceof ApiError && e.status === 403 && /password/i.test(e.message)) setMustChange(true);
    }
  }, [call, keepBrand]);

  const loadMeta = useCallback(async (force = false) => {
    if (meta && !force) return meta;
    try {
      const m = await call<Meta>('/bricks/meta');
      setMeta(m);
      store.saveCached('/bricks/meta', m);
      return m;
    } catch {
      const kept = await store.cached<Meta>('/bricks/meta');
      if (kept) setMeta(kept.data);
      return kept?.data || null;
    }
  }, [call, meta]);

  const loadAccounts = useCallback(async () => {
    if (accounts.length) return accounts;
    try {
      const list = (await call<MoneyAccount[]>('/bricks/money-accounts')).filter(a => a.active && a.accountClass === 'ASSET');
      // the brick business's own accounts first
      list.sort((a, b) => Number(b.brickBook) - Number(a.brickBook) || a.name.localeCompare(b.name));
      setAccounts(list);
      return list;
    } catch {
      return [];
    }
  }, [call, accounts]);

  const signIn = useCallback(async (server: string, username: string, password: string) => {
    const out = await login(server, username, password);
    const s: Session = { server, username, token: out.token, name: out.user?.fullName || out.user?.username || username,
      brand: { name: out.user?.brandName || null, logo: out.user?.brandLogo || null } };
    await store.saveSession(s);
    sessionRef.current = s;
    setSession(s);
    setMustChange(!!out.user?.mustChangePassword);
    if (!out.user?.mustChangePassword) await refreshProfile();
  }, [refreshProfile]);

  // opening: the session and the last profile kept, then a fresh one
  useEffect(() => {
    (async () => {
      const s = await store.session();
      sessionRef.current = s;
      setSession(s);
      if (s.token) {
        const kept = await store.profile();
        if (kept) setProfile(kept);
      }
      setReady(true);
      if (s.token) refreshProfile();
    })();
  }, [refreshProfile]);

  // back to the front, and every minute while open: what waits, and any change of the screens given
  useEffect(() => {
    const sub = AppState.addEventListener('change', st => { if (st === 'active') refreshProfile(); });
    const timer = setInterval(() => { if (AppState.currentState === 'active') refreshProfile(); }, 60000);
    return () => { sub.remove(); clearInterval(timer); };
  }, [refreshProfile]);

  // which version of the Bricks app's server side runs there (an old server: orders do not alert the office, documents do not open)
  useEffect(() => {
    if (!session.token || !session.server) return;
    request<{ bricksApp?: number }>(session, '/meta/app', { timeoutMs: 8000 })
      .then(d => setServerBehind((d?.bricksApp || 1) < SERVER_NEEDED)).catch(() => undefined);
  }, [session]);

  const has = useCallback((m: ModuleKey) => !!profile?.modules.includes(m), [profile]);
  const passwordChanged = useCallback(() => { setMustChange(false); refreshProfile(); }, [refreshProfile]);

  const value = useMemo<Ctx>(() => ({
    ready, session, profile, mustChangePassword, meta, accounts, toast, offline, serverBehind, has, call, signIn, signOut, refreshProfile, loadMeta,
    loadAccounts, say, passwordChanged,
  }), [ready, session, profile, mustChangePassword, meta, accounts, toast, offline, serverBehind, has, call, signIn, signOut, refreshProfile, loadMeta,
    loadAccounts, say, passwordChanged]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export type Loaded<T> = {
  data: T | null; error: string | null; loading: boolean; refreshing: boolean; reload: () => Promise<void>;
  /** what is shown came from an earlier answer (the server did not answer now) */
  stale: number | null;
};

/**
 * A screen's data from the server: the last answer kept on the phone shows first, then the fresh one replaces it;
 * fetched again after any change (useNav().changed()). path null: nothing to load (yet).
 */
export function useLoad<T>(path: string | null): Loaded<T> {
  const { call } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState<number | null>(null);
  const current = useRef(path);
  current.current = path;

  const fetchIt = useCallback(async (p: string) => {
    try {
      const out = await call<T>(p);
      if (current.current !== p) return;
      setData(out);
      setError(null);
      setStale(null);
      store.saveCached(p, out);
    } catch (e: any) {
      if (current.current !== p) return;
      const kept = await store.cached<T>(p);
      if (kept) {
        setData(d => d ?? kept.data);
        setStale(kept.at);
        setError(e instanceof ApiError && e.status !== 0 ? e.message : null);
      } else setError(e?.message || 'Could not load');
    }
  }, [call]);

  useEffect(() => {
    setData(null);
    setError(null);
    setStale(null);
    if (!path) { setLoading(false); return; }
    let live = true;
    setLoading(true);
    (async () => {
      const kept = await store.cached<T>(path);
      if (live && kept) setData(kept.data);
      await fetchIt(path);
      if (live) setLoading(false);
    })();
    return () => { live = false; };
  }, [path, fetchIt]);

  const reload = useCallback(async () => {
    if (!current.current) return;
    setRefreshing(true);
    await fetchIt(current.current);
    setRefreshing(false);
  }, [fetchIt]);

  // something was changed (here or on another screen): fetched again, what is shown stays meanwhile
  const { version } = useNav();
  const seen = useRef(version);
  useEffect(() => {
    if (seen.current === version) return;
    seen.current = version;
    if (current.current) fetchIt(current.current);
  }, [version, fetchIt]);

  return { data, error, loading, refreshing, reload, stale };
}
