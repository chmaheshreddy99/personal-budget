/**
 * The app's state and what can be done with it, shared by every screen (useApp()).
 * Syncs when the app opens, when it comes back to the front, with the Sync button, and every minute while something
 * waits to go up (never in offline mode). Bank SMS caught by Android (also while the app was closed) are read here
 * and offered as expenses to record.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, Platform, ToastAndroid } from 'react-native';
import {
  Account, BalanceSheet, Budgets, Chit, DEFAULT_SETTINGS, Installment, LocalChitPayment, LocalExpense, LocalRecord, Meta, Settings, Snapshot, Statement, Upload,
  enforceLimit, fetchBalanceSheet, fetchBudgets, fetchStatement, liveBalance, login, normalizeUrl, store, syncNow, thisMonth, usage, visibleAccounts,
  ApiError, QuickKey, disableQuick, enableQuick, quickLogin,
} from './data';
import { money, moneyShort, uuid } from './format';
import { sha256 } from './sha256';
import { PickedFile, RawSms, SmsPermissions, nativeFiles, nativeSettings, nativeSms, smsSupported } from './native';
import { ParsedSms, parseSms } from './sms';

type NewExpense = Omit<LocalExpense, 'clientId' | 'createdAt' | 'status'>;
/** Paid for someone, lent, money back, income, a gift or EMIs paid, as recorded on the phone. */
export type NewRecord = Omit<LocalRecord, 'clientId' | 'createdAt' | 'status'>;
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
  /** paid for, lent, money back, income, gifts and EMIs recorded on the phone */
  records: LocalRecord[];
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
  addRecord(r: NewRecord, evidence?: PickedFile[]): Promise<LocalRecord>;
  removeRecord(clientId: string): Promise<void>;
  /** an account's balance with what waits on the phone */
  balanceOf(a: Account): number;
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
  // ---- quick unlock (pattern / PIN) and the app lock
  /** the app waits for the pattern / PIN (on opening, after a while in the background, or when the session ended) */
  locked: boolean;
  /** just signed in with the password and no quick unlock yet: offer to set one up */
  offerQuick: boolean;
  unlock(code: string): Promise<void>;
  setupQuick(kind: 'PIN' | 'PATTERN', code: string): Promise<void>;
  turnOffQuick(): Promise<void>;
  skipQuick(): void;
  /** forget the saved server address (sign in again from scratch) */
  changeServer(): Promise<void>;
  // ---- balances hidden on the phone
  /** the admin's rule for the user's role */
  balanceMask: 'NONE' | 'TAP' | 'ALWAYS';
  masked: boolean;
  toggleMask(): void;
  /** a balance as shown: ₹ ••••• while masked */
  bal(v: number | null | undefined, opts?: { short?: boolean; decimals?: number }): string;
};

/** After this long in the background the app locks again (when quick unlock is on). */
const RELOCK_MS = 2 * 60 * 1000;
const MAX_LOCAL_TRIES = 5;
const randomSalt = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
const deviceName = () => {
  const c: any = (Platform as any).constants || {};
  return [c.Brand, c.Model].filter(Boolean).join(' ') || `${Platform.OS} phone`;
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
  const [records, setRecords] = useState<LocalRecord[]>([]);
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
  const [locked, setLocked] = useState(false);
  const [offerQuick, setOfferQuick] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const backgroundAt = useRef<number | null>(null);
  // the latest values for callbacks that outlive a render (timers, events)
  const ref = useRef({ settings, queue, chitQueue, uploads, syncing, snapshot, records });
  ref.current = { settings, queue, chitQueue, uploads, syncing, snapshot, records };

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
  const persistRecords = async (r: LocalRecord[]) => { setRecords(r); ref.current.records = r; await store.saveRecords(r); };

  const sync = useCallback(async (quiet = false) => {
    const { settings: s, queue: q, chitQueue: cq, uploads: ups, records: rs, syncing: busy } = ref.current;
    if (busy) return;
    if (s.offline) { if (!quiet) notify('Working offline: turn it off in Settings to sync'); return; }
    setSyncing(true);
    ref.current.syncing = true;
    try {
      const out = await syncNow(s, { queue: q, chits: cq, uploads: ups, records: rs }, setStep);
      // what was added on the phone while the sync ran is kept too
      const addedQ = ref.current.queue.filter(e => !q.some(x => x.clientId === e.clientId));
      const addedC = ref.current.chitQueue.filter(e => !cq.some(x => x.clientId === e.clientId));
      const addedU = ref.current.uploads.filter(e => !ups.some(x => x.id === e.id));
      const addedR = ref.current.records.filter(e => !rs.some(x => x.clientId === e.clientId));
      await persistQueue([...addedQ, ...out.queue]);
      await persistChits([...addedC, ...out.chits]);
      await persistUploads([...addedU, ...out.uploads]);
      await persistRecords([...addedR, ...out.records]);
      if (out.snapshot) setSnapshot(out.snapshot);
      if (out.sheet) setSheet(out.sheet);
      if (out.budgets) setBudgets(out.budgets);
      setOnline(out.ok || out.message.startsWith('Please sign in'));
      const m: Meta = { lastSync: out.ok ? Date.now() : meta.lastSync, lastError: out.ok ? null : out.message, lastServerOk: out.ok ? Date.now() : meta.lastServerOk };
      setMeta(m);
      await store.saveMeta(m);
      if (!quiet || out.sent || out.failed || out.uploaded || (!out.ok && out.message.startsWith('Please sign in'))) notify(out.message);
      if (out.message.startsWith('Please sign in')) {
        const next = { ...ref.current.settings, token: null };
        setSettings(next);
        ref.current.settings = next;
        await store.saveSettings(next);
        if (next.quick) setLocked(true);   // the pattern / PIN signs in again
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
      const [s, snap, q, cq, ups, bs, bg, m, rs] = await Promise.all([store.settings(), store.snapshot(), store.queue(), store.chitQueue(), store.uploads(),
        store.balanceSheet(), store.budgets(), store.meta(), store.records()]);
      setSettings(s); setSnapshot(snap); setQueue(q); setChitQueue(cq); setUploads(ups); setSheet(bs); setBudgets(bg); setMeta(m); setRecords(rs);
      ref.current = { settings: s, queue: q, chitQueue: cq, uploads: ups, syncing: false, snapshot: snap, records: rs };
      // with quick unlock on, the app opens locked
      if (s.quick && s.serverUrl) setLocked(true);
      setReady(true);
      // the receiver's own switch follows the app's setting (it is what decides whether an SMS is caught)
      if (smsSupported && s.smsEnabled) nativeSms.setEnabled(true).catch(() => undefined);
      await loadSms();
      checkPerms();
      refreshUsage();
      if (s.token && !s.offline && !(s.quick && s.serverUrl)) sync(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- back to the front: sync and pick up SMS caught meanwhile; every minute while something waits
  useEffect(() => {
    const sub = AppState.addEventListener('change', st => {
      if (st === 'background') { backgroundAt.current = Date.now(); setRevealed(false); return; }
      if (st !== 'active') return;
      // back after a while: locked again
      if (ref.current.settings.quick && backgroundAt.current && Date.now() - backgroundAt.current > RELOCK_MS) {
        backgroundAt.current = null;
        setLocked(true);
        return;
      }
      backgroundAt.current = null;
      loadSms();
      checkPerms();
      if (ref.current.settings.token && !ref.current.settings.offline) sync(true);
    });
    const timer = setInterval(() => {
      const { settings: s, queue: q, chitQueue: cq, uploads: ups, records: rs } = ref.current;
      if (s.token && !s.offline && (q.some(e => e.status === 'QUEUED') || cq.some(c => c.status === 'QUEUED') || rs.some(r => r.status === 'QUEUED')
        || ups.some(u => u.status === 'WAITING'))) sync(true);
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
    setLocked(false);
    if (!ref.current.settings.quick) setOfferQuick(true);
    await sync(true);
  }, [saveSettings, sync]);

  const signOut = useCallback(async () => {
    await saveSettings({ token: null });
    if (ref.current.settings.quick) setLocked(true);
  }, [saveSettings]);

  /**
   * The pattern / PIN: checked on the phone first (so the app opens offline too), then, when the server answers, it
   * signs in with the phone's key for a fresh session. Five wrong tries in a row on the phone, or a key the server
   * switched off (a new password, too many wrong tries), turn quick unlock off: the password is needed.
   */
  const unlock = useCallback(async (code: string) => {
    const s = ref.current.settings;
    const q = s.quick;
    if (!q) { setLocked(false); return; }
    if (sha256(`${q.salt}|${code}`) !== q.verifier) {
      const failed = (q.failed || 0) + 1;
      if (failed >= MAX_LOCAL_TRIES) {
        await saveSettings({ quick: null, token: null });
        setLocked(false);
        throw new Error('Too many wrong tries: sign in with your password');
      }
      await saveSettings({ quick: { ...q, failed } });
      throw new Error(`Wrong ${q.kind === 'PIN' ? 'PIN' : 'pattern'} · ${MAX_LOCAL_TRIES - failed} ${MAX_LOCAL_TRIES - failed === 1 ? 'try' : 'tries'} left`);
    }
    if (!s.offline) {
      try {
        const out = await quickLogin(s.serverUrl, q, code);
        await saveSettings({ token: out.token, userName: out.name || s.userName, username: out.username || s.username, quick: { ...q, failed: 0 } });
        setOnline(true);
      } catch (e: any) {
        if (e instanceof ApiError && e.status === 401) {
          // the server switched this key off: the password is needed again
          await saveSettings({ quick: null, token: null });
          setLocked(false);
          throw new Error(e.message);
        }
        // the server is out of reach: open with what is on the phone
        if (!s.token) throw new Error(`${e.message}. Connect to the internet to sign in.`);
        if (q.failed) await saveSettings({ quick: { ...q, failed: 0 } });
      }
    } else if (q.failed) {
      await saveSettings({ quick: { ...q, failed: 0 } });
    }
    setLocked(false);
    setTimeout(() => sync(true), 200);
  }, [saveSettings, sync]);

  const setupQuick = useCallback(async (kind: 'PIN' | 'PATTERN', code: string) => {
    const s = ref.current.settings;
    if (s.quick) await disableQuick(s, s.quick.deviceId).catch(() => undefined);
    const key = await enableQuick(s, kind, code, deviceName());
    const salt = randomSalt();
    const quick: QuickKey = { deviceId: key.deviceId, secret: key.secret, kind, length: code.length, salt, verifier: sha256(`${salt}|${code}`), failed: 0 };
    await saveSettings({ quick });
    setOfferQuick(false);
  }, [saveSettings]);

  const turnOffQuick = useCallback(async () => {
    const s = ref.current.settings;
    if (s.quick && s.token) await disableQuick(s, s.quick.deviceId).catch(() => undefined);
    await saveSettings({ quick: null });
  }, [saveSettings]);

  const skipQuick = useCallback(() => setOfferQuick(false), []);

  const changeServer = useCallback(async () => {
    const s = ref.current.settings;
    if (s.quick && s.token) await disableQuick(s, s.quick.deviceId).catch(() => undefined);
    await saveSettings({ serverUrl: '', token: null, quick: null });
    setLocked(false);
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

  const addRecord = useCallback(async (r: NewRecord, evidence: PickedFile[] = []) => {
    const item: LocalRecord = { ...r, clientId: uuid(), createdAt: Date.now(), status: 'QUEUED' };
    await persistRecords([item, ...ref.current.records]);
    if (evidence.length) await addEvidence({ clientId: item.clientId, label: r.title }, evidence);
    soon();
    return item;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addEvidence]);

  const removeRecord = useCallback(async (clientId: string) => {
    const mine = ref.current.uploads.filter(u => u.clientId === clientId && !u.entryId && !u.pendingId);
    await Promise.all(mine.map(u => nativeFiles.remove(u.path)));
    await persistUploads(ref.current.uploads.filter(u => !mine.includes(u)));
    await persistRecords(ref.current.records.filter(x => x.clientId !== clientId));
    refreshUsage();
  }, [refreshUsage]);

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
  const balanceOf = useCallback((a: Account) => liveBalance(a, queue, chitQueue, records).balance, [queue, chitQueue, records]);

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

  // ---- balances: the admin's rule for the role, then the phone's own choice; tapping shows them for this visit
  const balanceMask = snapshot?.balanceMask || 'NONE';
  const masked = balanceMask === 'ALWAYS' || ((balanceMask === 'TAP' || settings.hideBalances) && !revealed);
  const toggleMask = useCallback(() => {
    if (balanceMask === 'ALWAYS') { notify('Your admin keeps balances hidden on the phone'); return; }
    setRevealed(r => !r);
  }, [balanceMask]);
  const bal = useCallback((v: number | null | undefined, opts: { short?: boolean; decimals?: number } = {}) =>
    masked ? '₹ •••••' : opts.short ? moneyShort(v) : money(v, opts.decimals), [masked]);

  const value: AppContext = {
    ready, settings, snapshot, accounts, queue, chitQueue, records, uploads, sheet, budgets, meta, syncing, step, online, detected, used, perms,
    saveSettings, signIn, signOut, sync, addExpense, updateExpense, removeExpense, addEvidence, removeEvidence, payChit, removeChitPayment,
    addRecord, removeRecord, balanceOf, loadSheet, loadBudgets,
    statement, dismissSms, scanInbox, enableSms, checkPerms, readSms, clearCache, notify,
    locked, offerQuick, unlock, setupQuick, turnOffQuick, skipQuick, changeServer, balanceMask, masked, toggleMask, bal,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
