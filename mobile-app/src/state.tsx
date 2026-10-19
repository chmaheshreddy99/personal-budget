/**
 * The app's state and what can be done with it, shared by every screen (useApp()).
 * Syncs when the app opens, when it comes back to the front, with the Sync button, and every minute while something
 * waits to go up (never in offline mode). Bank SMS caught by Android (also while the app was closed) are read here
 * and offered as expenses to record.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, Platform, ToastAndroid } from 'react-native';
import {
  Account, BalanceSheet, Budgets, Chit, DEFAULT_SETTINGS, Installment, LocalChitPayment, LocalExpense, Meta, Settings, Snapshot, Statement, Upload,
  enforceLimit, fetchBalanceSheet, fetchBudgets, fetchStatement, login, normalizeUrl, store, syncNow, thisMonth, usage, visibleAccounts,
} from './data';
import { uuid } from './format';
import { PickedFile, RawSms, SmsPermissions, nativeFiles, nativeSettings, nativeSms, smsSupported } from './native';
import { ParsedSms, parseSms } from './sms';

type NewExpense = Omit<LocalExpense, 'clientId' | 'createdAt' | 'status'>;
/** What a piece of evidence belongs to: an expense on the phone, or one on the server. */
export type EvidenceTarget = { clientId?: string; entryId?: number; pendingId?: number; label: string };
type Used = { total: number; cache: number; statements: number; evidence: number };

type AppContext = {
  ready: boolean;
  settings: Settings;
  snapshot: Snapshot | null;
  /** the accounts shown (my own, the groups turned on, only the chosen ones when so set) */
  accounts: Account[];
  queue: LocalExpense[];
  chitQueue: LocalChitPayment[];
  uploads: Upload[];
  sheet: BalanceSheet | null;
  /** this month's budgets (kept for offline use) */
  budgets: Budgets | null;
  meta: Meta;
  syncing: boolean;
  step: string;
  online: boolean | null;
  detected: ParsedSms[];
  used: Used;
  perms: SmsPermissions | null;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  signIn(serverUrl: string, username: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  sync(quiet?: boolean): Promise<void>;
  addExpense(e: NewExpense, evidence?: PickedFile[]): Promise<LocalExpense>;
  updateExpense(clientId: string, patch: Partial<LocalExpense>): Promise<void>;
  removeExpense(clientId: string): Promise<void>;
  addEvidence(target: EvidenceTarget, files: PickedFile[]): Promise<void>;
  removeEvidence(id: string): Promise<void>;
  payChit(chit: Chit, inst: Installment, p: { paidDate: string; fromAccountId: number; dividend: number }): Promise<void>;
  removeChitPayment(clientId: string): Promise<void>;
  loadSheet(): Promise<BalanceSheet | null>;
  /** a month's budgets from the server (this month when none is given; offline: the kept copy of this month) */
  loadBudgets(month?: string): Promise<Budgets | null>;
  statement(id: number): Promise<Statement | null>;
  dismissSms(ids: string[]): Promise<void>;
  scanInbox(days: number): Promise<number>;
  enableSms(on: boolean): Promise<boolean>;
  checkPerms(): Promise<SmsPermissions | null>;
  readSms(body: string, sender?: string): ParsedSms | null;
  clearCache(): Promise<void>;
  notify(msg: string): void;
};

const Ctx = createContext<AppContext | null>(null);
export const useApp = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside AppProvider');
  return c;
};

const notify = (msg: string) => { if (Platform.OS === 'android') ToastAndroid.show(msg, ToastAndroid.SHORT); };
const waits = (s: string) => s === 'QUEUED' || s === 'FAILED';

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [queue, setQueue] = useState<LocalExpense[]>([]);
  const [chitQueue, setChitQueue] = useState<LocalChitPayment[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [sheet, setSheet] = useState<BalanceSheet | null>(null);
  const [budgets, setBudgets] = useState<Budgets | null>(null);
  const [meta, setMeta] = useState<Meta>({ lastSync: null, lastError: null, lastServerOk: null });
  const [syncing, setSyncing] = useState(false);
  const [step, setStep] = useState('');
  const [online, setOnline] = useState<boolean | null>(null);
  const [raw, setRaw] = useState<RawSms[]>([]);
  const [used, setUsed] = useState<Used>({ total: 0, cache: 0, statements: 0, evidence: 0 });
  const [perms, setPerms] = useState<SmsPermissions | null>(null);
  // the latest values for callbacks that outlive a render (timers, events)
  const ref = useRef({ settings, queue, chitQueue, uploads, syncing, snapshot });
  ref.current = { settings, queue, chitQueue, uploads, syncing, snapshot };

  const refreshUsage = useCallback(async () => {
    const [u, evidence] = await Promise.all([usage(), nativeFiles.size().catch(() => 0)]);
    setUsed({ ...u, evidence });
  }, []);

  const loadSms = useCallback(async () => {
    if (!smsSupported) return;
    try { setRaw(await nativeSms.pending()); } catch { /* none */ }
  }, []);

  const checkPerms = useCallback(async () => {
    if (!smsSupported) return null;
    try { const p = await nativeSettings.smsPermissions(); setPerms(p); return p; } catch { return null; }
  }, []);

  const persistQueue = async (q: LocalExpense[]) => { setQueue(q); ref.current.queue = q; await store.saveQueue(q); };
  const persistChits = async (q: LocalChitPayment[]) => { setChitQueue(q); ref.current.chitQueue = q; await store.saveChitQueue(q); };
  const persistUploads = async (u: Upload[]) => { setUploads(u); ref.current.uploads = u; await store.saveUploads(u); };

  const sync = useCallback(async (quiet = false) => {
    const { settings: s, queue: q, chitQueue: cq, uploads: ups, syncing: busy } = ref.current;
    if (busy) return;
    if (s.offline) { if (!quiet) notify('Working offline: turn it off in Settings to sync'); return; }
    setSyncing(true);
    ref.current.syncing = true;
    try {
      const out = await syncNow(s, { queue: q, chits: cq, uploads: ups }, setStep);
      // what was added on the phone while the sync ran is kept too
      const addedQ = ref.current.queue.filter(e => !q.some(x => x.clientId === e.clientId));
      const addedC = ref.current.chitQueue.filter(e => !cq.some(x => x.clientId === e.clientId));
      const addedU = ref.current.uploads.filter(e => !ups.some(x => x.id === e.id));
      await persistQueue([...addedQ, ...out.queue]);
      await persistChits([...addedC, ...out.chits]);
      await persistUploads([...addedU, ...out.uploads]);
      if (out.snapshot) setSnapshot(out.snapshot);
      if (out.sheet) setSheet(out.sheet);
      if (out.budgets) setBudgets(out.budgets);
      setOnline(out.ok || out.message.startsWith('Please sign in'));
      const m: Meta = { lastSync: out.ok ? Date.now() : meta.lastSync, lastError: out.ok ? null : out.message, lastServerOk: out.ok ? Date.now() : meta.lastServerOk };
      setMeta(m);
      await store.saveMeta(m);
      if (!quiet || out.sent || out.failed || out.uploaded || (!out.ok && out.message.startsWith('Please sign in'))) notify(out.message);
      if (out.message.startsWith('Please sign in')) {
        const next = { ...s, token: null };
        setSettings(next);
        await store.saveSettings(next);
      }
    } finally {
      setSyncing(false);
      ref.current.syncing = false;
      setStep('');
      refreshUsage();
    }
  }, [meta.lastSync, meta.lastServerOk, refreshUsage]);

  // ---- load what is on the phone, then sync
  useEffect(() => {
    (async () => {
      const [s, snap, q, cq, ups, bs, bg, m] = await Promise.all([store.settings(), store.snapshot(), store.queue(), store.chitQueue(), store.uploads(),
        store.balanceSheet(), store.budgets(), store.meta()]);
      setSettings(s); setSnapshot(snap); setQueue(q); setChitQueue(cq); setUploads(ups); setSheet(bs); setBudgets(bg); setMeta(m);
      ref.current = { settings: s, queue: q, chitQueue: cq, uploads: ups, syncing: false, snapshot: snap };
      setReady(true);
      // the receiver's own switch follows the app's setting (it is what decides whether an SMS is caught)
      if (smsSupported && s.smsEnabled) nativeSms.setEnabled(true).catch(() => undefined);
      await loadSms();
      checkPerms();
      refreshUsage();
      if (s.token && !s.offline) sync(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- back to the front: sync and pick up SMS caught meanwhile; every minute while something waits
  useEffect(() => {
    const sub = AppState.addEventListener('change', st => {
      if (st !== 'active') return;
      loadSms();
      checkPerms();
      if (ref.current.settings.token && !ref.current.settings.offline) sync(true);
    });
    const timer = setInterval(() => {
      const { settings: s, queue: q, chitQueue: cq, uploads: ups } = ref.current;
      if (s.token && !s.offline && (q.some(e => e.status === 'QUEUED') || cq.some(c => c.status === 'QUEUED') || ups.some(u => u.status === 'WAITING'))) sync(true);
    }, 60000);
    const off = nativeSms.onSms(sms => setRaw(list => (list.some(x => x.id === sms.id) ? list : [...list, sms])));
    return () => { sub.remove(); clearInterval(timer); off(); };
  }, [loadSms, sync, checkPerms]);

  const soon = () => { if (ref.current.settings.token && !ref.current.settings.offline) setTimeout(() => sync(true), 300); };

  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = { ...ref.current.settings, ...patch };
    setSettings(next);
    ref.current.settings = next;
    await store.saveSettings(next);
    if ('storageMb' in patch) { await enforceLimit(next, ref.current.snapshot); refreshUsage(); }
    if (patch.offline === false && next.token) sync(true);
  }, [refreshUsage, sync]);

  const signIn = useCallback(async (serverUrl: string, username: string, password: string) => {
    const url = normalizeUrl(serverUrl);
    const out = await login(url, username.trim(), password);
    await saveSettings({ serverUrl: url, username: username.trim(), token: out.token, userName: out.name });
    setOnline(true);
    await sync(true);
  }, [saveSettings, sync]);

  const signOut = useCallback(async () => {
    await saveSettings({ token: null });
  }, [saveSettings]);

  const addEvidence = useCallback(async (target: EvidenceTarget, files: PickedFile[]) => {
    if (!files.length) return;
    const items: Upload[] = files.map(f => ({ id: uuid(), path: f.path, name: f.name, type: f.type, size: f.size, addedAt: Date.now(), label: target.label,
      clientId: target.clientId, entryId: target.entryId, pendingId: target.pendingId, status: 'WAITING' }));
    await persistUploads([...ref.current.uploads, ...items]);
    refreshUsage();
    soon();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshUsage]);

  const removeEvidence = useCallback(async (id: string) => {
    const u = ref.current.uploads.find(x => x.id === id);
    if (u) await nativeFiles.remove(u.path);
    await persistUploads(ref.current.uploads.filter(x => x.id !== id));
    refreshUsage();
  }, [refreshUsage]);

  const addExpense = useCallback(async (e: NewExpense, evidence: PickedFile[] = []) => {
    const item: LocalExpense = { ...e, clientId: uuid(), createdAt: Date.now(), status: 'QUEUED' };
    await persistQueue([item, ...ref.current.queue]);
    if (evidence.length) await addEvidence({ clientId: item.clientId, label: e.narration || e.categoryName }, evidence);
    if (e.smsId) await nativeSms.done([e.smsId]);
    setRaw(list => list.filter(x => x.id !== e.smsId));
    soon();
    return item;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addEvidence]);

  const updateExpense = useCallback(async (clientId: string, patch: Partial<LocalExpense>) => {
    await persistQueue(ref.current.queue.map(x => (x.clientId === clientId ? { ...x, ...patch, status: 'QUEUED', message: undefined } : x)));
  }, []);

  const removeExpense = useCallback(async (clientId: string) => {
    const mine = ref.current.uploads.filter(u => u.clientId === clientId && !u.entryId && !u.pendingId);
    await Promise.all(mine.map(u => nativeFiles.remove(u.path)));
    await persistUploads(ref.current.uploads.filter(u => !mine.includes(u)));
    await persistQueue(ref.current.queue.filter(x => x.clientId !== clientId));
    refreshUsage();
  }, [refreshUsage]);

  const payChit = useCallback(async (chit: Chit, inst: Installment, p: { paidDate: string; fromAccountId: number; dividend: number }) => {
    const from = ref.current.snapshot?.accounts.find(a => a.id === p.fromAccountId);
    const item: LocalChitPayment = { clientId: uuid(), chitId: chit.id, chitName: chit.name, installmentId: inst.id, installmentNo: inst.no,
      dueAmount: inst.dueAmount, dividend: p.dividend, amount: Math.max(0, inst.dueAmount - p.dividend), paidDate: p.paidDate,
      fromAccountId: p.fromAccountId, fromAccountName: from?.name || '', createdAt: Date.now(), status: 'QUEUED' };
    await persistChits([item, ...ref.current.chitQueue.filter(c => !(c.installmentId === inst.id && waits(c.status)))]);
    soon();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeChitPayment = useCallback(async (clientId: string) => {
    await persistChits(ref.current.chitQueue.filter(c => c.clientId !== clientId));
  }, []);

  const loadSheet = useCallback(async () => {
    const s = ref.current.settings;
    if (s.token && !s.offline) {
      try { const b = await fetchBalanceSheet(s); setSheet(b); refreshUsage(); return b; } catch { /* the kept copy */ }
    }
    const kept = await store.balanceSheet();
    if (kept) setSheet(kept);
    return kept;
  }, [refreshUsage]);

  const loadBudgets = useCallback(async (month?: string) => {
    const s = ref.current.settings;
    const current = !month || month === thisMonth();
    if (s.token && !s.offline) {
      try {
        const b = await fetchBudgets(s, month);
        if (current) { setBudgets(b); refreshUsage(); }
        return b;
      } catch { /* the kept copy (this month only) */ }
    }
    if (!current) return null;
    const kept = await store.budgets();
    if (kept) setBudgets(kept);
    return kept;
  }, [refreshUsage]);

  const statement = useCallback(async (id: number) => {
    const s = ref.current.settings;
    if (s.token && !s.offline) {
      try { const st = await fetchStatement(s, id); refreshUsage(); return st; } catch { /* the kept copy, if any */ }
    }
    return store.statement(id);
  }, [refreshUsage]);

  const dismissSms = useCallback(async (ids: string[]) => {
    await nativeSms.done(ids);
    setRaw(list => list.filter(x => !ids.includes(x.id)));
  }, []);

  const scanInbox = useCallback(async (days: number) => {
    const p = await checkPerms();
    if (p && !p.read) throw new Error('Allow the app to read SMS first (see the steps above)');
    const found = await nativeSms.recent(days, 120);
    const recorded = new Set(ref.current.queue.map(e => e.smsId).filter(Boolean));
    const accounts = ref.current.snapshot?.accounts || [];
    const cats = ref.current.snapshot?.categories || [];
    let added = 0;
    setRaw(list => {
      const ids = new Set(list.map(x => x.id));
      const fresh = found.filter(x => !ids.has(x.id) && !recorded.has(x.id) && parseSms(x, accounts, cats));
      added = fresh.length;
      return [...list, ...fresh];
    });
    return added;
  }, [checkPerms]);

  const enableSms = useCallback(async (on: boolean) => {
    if (on && Platform.OS === 'android') {
      const wanted = [PermissionsAndroid.PERMISSIONS.RECEIVE_SMS, PermissionsAndroid.PERMISSIONS.READ_SMS,
        ...(Number(Platform.Version) >= 33 ? [PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS] : [])];
      const res = await PermissionsAndroid.requestMultiple(wanted);
      if (res[PermissionsAndroid.PERMISSIONS.RECEIVE_SMS] !== PermissionsAndroid.RESULTS.GRANTED) {
        await checkPerms();
        notify('SMS permission was not given: see the steps on the Bank SMS page');
        return false;
      }
    }
    await nativeSms.setEnabled(on);
    await saveSettings({ smsEnabled: on });
    await checkPerms();
    return on;
  }, [saveSettings, checkPerms]);

  const clearCache = useCallback(async () => {
    await store.clearCache();
    setSnapshot(null);
    setSheet(null);
    setBudgets(null);
    refreshUsage();
    if (ref.current.settings.token && !ref.current.settings.offline) sync(true);
  }, [refreshUsage, sync]);

  const accounts = useMemo(() => visibleAccounts(settings, snapshot?.accounts || []), [settings, snapshot]);

  // an SMS is matched to the accounts shown first, then to any of my own
  const readSms = useCallback((body: string, sender = 'SMS') => {
    const all = snapshot?.accounts || [];
    const cats = snapshot?.categories || [];
    const sms = { id: `paste-${body.length}-${body.slice(0, 12)}`, sender, body, at: Date.now() };
    const p = parseSms(sms, accounts, cats);
    if (p && p.accountId == null) {
      const wider = parseSms(sms, all.filter(a => a.group === 'OWN'), cats);
      if (wider?.accountId != null) return wider;
    }
    return p;
  }, [snapshot, accounts]);

  // the SMS read as expenses (those the app can understand), newest first
  const detected = useMemo(() => {
    const all = snapshot?.accounts || [];
    const cats = snapshot?.categories || [];
    const recorded = new Set(queue.map(e => e.smsId).filter(Boolean));
    return raw.filter(x => !recorded.has(x.id)).map(x => {
      const p = parseSms(x, accounts, cats);
      if (p && p.accountId == null) {
        const wider = parseSms(x, all.filter(a => a.group === 'OWN'), cats);
        if (wider?.accountId != null) return wider;
      }
      return p;
    }).filter((x): x is ParsedSms => !!x).sort((a, b) => b.sms.at - a.sms.at);
  }, [raw, snapshot, queue, accounts]);

  const value: AppContext = {
    ready, settings, snapshot, accounts, queue, chitQueue, uploads, sheet, budgets, meta, syncing, step, online, detected, used, perms,
    saveSettings, signIn, signOut, sync, addExpense, updateExpense, removeExpense, addEvidence, removeEvidence, payChit, removeChitPayment, loadSheet, loadBudgets,
    statement, dismissSms, scanInbox, enableSms, checkPerms, readSms, clearCache, notify,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
