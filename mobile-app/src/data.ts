/**
 * The app's data: what it keeps on the phone, talking to the server, and syncing.
 *
 * Kept on the phone (src/native.ts store), within the size set in Settings:
 *   settings   the server address, sign-in, offline mode, the limits
 *   snapshot   every account with its balance, the expense and income categories, the latest expenses (from the server)
 *   budgets    this month's budgets against what was spent (from the server)
 *   queue      expenses recorded on the phone, not yet on the server (never trimmed)
 *   stmt-<id>  an account's statement, for the most active accounts first, as far as the size allows
 *
 * Sync (on opening the app, coming back to it, the Sync button, and every minute while something waits): when the
 * server answers, the queued expenses go up in one batch (each with its own id, so the server books it once however
 * often it is sent), then the fresh snapshot and statements come down. In offline mode nothing is sent.
 */
import { nativeFiles, nativeStore } from './native';

// ===================================================================== types

export type Group = 'OWN' | 'CONSTRUCTION' | 'HOSTED_CHIT' | 'EMI';

export type Account = {
  id: number; name: string; type: string; typeLabel: string; accountClass: 'ASSET' | 'LIABILITY'; group: Group; groupName: string | null;
  institution: string | null; last4: string | null; balance: number; creditLimit: number | null; availableCredit: number | null;
  monthIn: number; monthOut: number; lastActivity: string | null; payFrom: boolean; system: boolean;
};

/** kind and code are missing in a snapshot kept from before the server sent income categories: those are all expense. */
export type Category = { id: number; kind?: 'EXPENSE' | 'INCOME'; code?: string; name: string; description?: string | null; system: boolean; uses: number };

export const isExpense = (c: Category) => (c.kind || 'EXPENSE') === 'EXPENSE';

export type ServerExpense = {
  entryId: number; entryNo: string; date: string; narration: string; party: string | null; reference: string | null;
  categoryId: number | null; categoryName: string; amount: number; paidFromId: number | null; paidFrom: string; status: string | null;
};

export type Installment = {
  id: number; no: number; dueDate: string; dueAmount: number; dividend: number | null; paidAmount: number | null; paidDate: string | null;
  status: string; overdue: boolean; paidFrom: string | null; entryId: number | null;
};

/** A chit I am a member of, with its instalments. */
export type Chit = {
  id: number; name: string; organizer: string | null; ticketNo: string | null; status: string; monthlyInstallment: number; months: number;
  paidCount: number; pendingCount: number; overdueCount: number; overdueAmount: number; nextDueDate: string | null; nextDueAmount: number | null;
  paidIn: number; dividends: number; stillToPay: number; currentValue: number; maturityAmount: number | null; maturityDate: string | null;
  defaultPaymentAccountId: number | null; progressPercent: number; installments: Installment[];
  /** the organizer's UPI ID: instalments can be paid with Google Pay or PhonePe; upiNote starts the payment note */
  organizerUpi?: string | null; upiNote?: string | null;
};

export type Snapshot = {
  serverTime: string; user: string; household: string; currency: string; accounts: Account[]; categories: Category[];
  expenses: ServerExpense[]; expensesFrom: string; chits?: Chit[]; canPayChits?: boolean; fetchedAt: number;
};

export type LocalStatus = 'QUEUED' | 'FAILED' | 'SYNCED' | 'PENDING';

/** An expense recorded on the phone. */
export type LocalExpense = {
  clientId: string; date: string; amount: number; categoryId: number; categoryName: string; paidFromId: number; paidFromName: string;
  narration: string; party: string; reference: string; notes: string; createdAt: number; status: LocalStatus; message?: string;
  entryNo?: string; entryId?: number; pendingId?: number; smsId?: string; syncedAt?: number;
};

/** A chit instalment paid on the phone, not yet on the server: amount = what left the account (due less dividend). */
export type LocalChitPayment = {
  clientId: string; chitId: number; chitName: string; installmentId: number; installmentNo: number; dueAmount: number; dividend: number;
  amount: number; paidDate: string; fromAccountId: number; fromAccountName: string; createdAt: number; status: LocalStatus; message?: string;
  entryNo?: string; syncedAt?: number;
};

/**
 * A photo or file to go to the server as an expense's evidence: for an expense recorded on the phone (clientId, until
 * the server has booked it) or one already on the server (entryId, or pendingId while it waits for approval).
 */
export type Upload = {
  id: string; path: string; name: string; type: string; size: number; addedAt: number; label: string;
  clientId?: string; entryId?: number; pendingId?: number; status: 'WAITING' | 'FAILED'; message?: string;
};

export type Money = number;
export type SheetAccount = { accountId: number; code: string; name: string; accountType: string; amount: Money; previous: Money | null };
export type SheetGroup = { label: string; total: Money; previous: Money | null; accounts: SheetAccount[] };
export type SheetSection = { label: string; total: Money; previous: Money | null; groups: SheetGroup[] };
export type BalanceSheet = {
  asOf: string; assets: SheetSection; liabilities: SheetSection; equity: SheetSection; netWorth: Money; previousNetWorth: Money | null;
  netWorthChange: Money | null; liquidAssets: Money | null; debtToAssetRatio: Money | null; liquidityRatio: Money | null;
  emergencyFundMonths: Money | null; averageMonthlyExpense: Money | null; shortTermLiabilities: Money | null; longTermLiabilities: Money | null;
  balanced: boolean; fetchedAt: number;
};

/** A category's budget this month (or, without one, what was spent in it): as the server's Budgets page shows it. */
export type BudgetLine = {
  budgetId: number | null; categoryId: number; categoryCode: string; categoryName: string; monthlyLimit: Money | null; alertPercent: number | null;
  spent: Money; remaining: Money | null; usedPercent: Money | null; averageLast3Months: Money; health: 'OK' | 'WARNING' | 'OVER' | 'UNBUDGETED';
  notes: string | null; committed: boolean; dueDay: number | null; dueDate: string | null;
  /** PAID, PARTLY_PAID, DUE, DUE_SOON, OVERDUE (committed budgets) */
  paymentStatus: string | null; paidOn: string | null;
  /** ON_TRACK, AHEAD_OF_PACE, HEADING_OVER, OVER, UNDER, NOT_STARTED (ordinary budgets) */
  pace: string | null; expectedByToday: Money | null; projected: Money | null; dailyAverage: Money | null; safePerDay: Money | null;
  limitReachedOn: string | null; insight: string | null;
};
export type BudgetAlert = { severity: 'critical' | 'warning' | 'info' | 'good'; categoryId: number | null; title: string; message: string; hint: string | null };
export type Budgets = {
  month: string; totalLimit: Money; totalSpent: Money; totalRemaining: Money; usedPercent: Money | null; unbudgetedSpent: Money; lines: BudgetLine[];
  daysInMonth: number; daysElapsed: number; daysLeft: number; projectedTotal: Money; committedTotal: Money; committedPaid: Money;
  committedOutstanding: Money; alerts: BudgetAlert[]; fetchedAt: number;
};

export type StatementRow = { entryId: number; entryNo: string; date: string; voucher: string; narration: string; other: string | null;
  debit: number; credit: number; balance: number };
export type Statement = { accountId: number; name: string; accountClass: string; from: string; to: string; opening: number; closing: number;
  rows: StatementRow[]; fetchedAt: number };

export type Settings = {
  serverUrl: string; username: string; token: string | null; userName: string; offline: boolean;
  /** what is kept for offline use (statements and expenses), in MB */
  storageMb: number;
  /** how far back expenses and statements are kept */
  historyDays: number;
  smsEnabled: boolean;
  /** statements kept for this many accounts (the most active first) */
  statementAccounts: number;
  /** besides my own accounts, these are shown (none by default: construction, hosted chits and EMIs stay hidden) */
  showGroups: Group[];
  /** 'chosen': only the accounts in chosenAccounts are shown (and offered to pay from) */
  accountFilter: 'all' | 'chosen';
  chosenAccounts: number[];
};

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: '', username: '', token: null, userName: '', offline: false, storageMb: 5, historyDays: 90, smsEnabled: false, statementAccounts: 12,
  showGroups: [], accountFilter: 'all', chosenAccounts: [],
};

export const GROUP_LABELS: Record<Group, string> = { OWN: 'My accounts', CONSTRUCTION: 'Construction', HOSTED_CHIT: 'Host a Chit', EMI: 'EMIs' };

/** The accounts the phone shows: my own, the groups turned on in Settings, and (when chosen) only the chosen ones. */
export function visibleAccounts(settings: Settings, accounts: Account[]): Account[] {
  const groups = settings.showGroups || [];
  return accounts.filter(a => (a.group === 'OWN' || groups.includes(a.group))
    && (settings.accountFilter !== 'chosen' || (settings.chosenAccounts || []).includes(a.id)));
}

// ===================================================================== the store

const K = { settings: 'settings', snapshot: 'snapshot', queue: 'queue', meta: 'meta', chitQueue: 'chit-queue', uploads: 'uploads', sheet: 'balance-sheet', budgets: 'budgets' };
const stmtKey = (id: number) => `stmt-${id}`;

async function read<T>(key: string, fallback: T): Promise<T> {
  try {
    const s = await nativeStore.get(key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}
const write = (key: string, value: unknown) => nativeStore.set(key, JSON.stringify(value));

export type Meta = { lastSync: number | null; lastError: string | null; lastServerOk: number | null };

export const store = {
  settings: () => read<Settings>(K.settings, DEFAULT_SETTINGS).then(s => ({ ...DEFAULT_SETTINGS, ...s })),
  saveSettings: (s: Settings) => write(K.settings, s),
  snapshot: () => read<Snapshot | null>(K.snapshot, null),
  saveSnapshot: (s: Snapshot) => write(K.snapshot, s),
  queue: () => read<LocalExpense[]>(K.queue, []),
  saveQueue: (q: LocalExpense[]) => write(K.queue, q),
  chitQueue: () => read<LocalChitPayment[]>(K.chitQueue, []),
  saveChitQueue: (q: LocalChitPayment[]) => write(K.chitQueue, q),
  uploads: () => read<Upload[]>(K.uploads, []),
  saveUploads: (u: Upload[]) => write(K.uploads, u),
  balanceSheet: () => read<BalanceSheet | null>(K.sheet, null),
  saveBalanceSheet: (b: BalanceSheet) => write(K.sheet, b),
  budgets: () => read<Budgets | null>(K.budgets, null),
  saveBudgets: (b: Budgets) => write(K.budgets, b),
  meta: () => read<Meta>(K.meta, { lastSync: null, lastError: null, lastServerOk: null }),
  saveMeta: (m: Meta) => write(K.meta, m),
  statement: (id: number) => read<Statement | null>(stmtKey(id), null),
  saveStatement: (s: Statement) => write(stmtKey(s.accountId), s),
  sizes: () => nativeStore.sizes(),
  clearCache: async () => {
    const sizes = await nativeStore.sizes();
    await Promise.all(Object.keys(sizes).filter(k => k.startsWith('stmt-') || k === K.snapshot || k === K.sheet || k === K.budgets).map(k => nativeStore.remove(k)));
  },
  removeStatement: (id: number) => nativeStore.remove(stmtKey(id)),
};

/** What the offline copy uses (bytes): all of it, and the part counted against the limit (not settings or the queue). */
export async function usage(): Promise<{ total: number; cache: number; statements: number }> {
  const sizes = await nativeStore.sizes();
  let total = 0, cache = 0, statements = 0;
  for (const [k, n] of Object.entries(sizes)) {
    total += n;
    if (k.startsWith('stmt-')) { statements += n; cache += n; }
    if (k === K.snapshot || k === K.sheet || k === K.budgets) cache += n;
  }
  return { total, cache, statements };
}

/**
 * Keeps the offline copy within the limit: drops the statements of the least active accounts first, then halves
 * the oldest statement lines, then the oldest expenses of the snapshot. What waits to be synced is never dropped.
 */
export async function enforceLimit(settings: Settings, snapshot: Snapshot | null): Promise<void> {
  const limit = settings.storageMb * 1024 * 1024;
  let { cache } = await usage();
  if (cache <= limit) return;
  const sizes = await nativeStore.sizes();
  const activity = new Map((snapshot?.accounts || []).map(a => [a.id, a.lastActivity || '']));
  const stmts = Object.keys(sizes).filter(k => k.startsWith('stmt-')).map(k => Number(k.slice(5)))
    .sort((a, b) => (activity.get(a) || '').localeCompare(activity.get(b) || ''));
  for (const id of stmts) {
    if (cache <= limit) return;
    cache -= sizes[stmtKey(id)] || 0;
    await store.removeStatement(id);
  }
  if (snapshot && cache > limit) {
    let list = [...snapshot.expenses].sort((a, b) => b.date.localeCompare(a.date));
    while (list.length > 20) {
      list = list.slice(0, Math.floor(list.length * 0.7));
      const n = await store.saveSnapshot({ ...snapshot, expenses: list });
      if (n <= limit) break;
    }
  }
}

// ===================================================================== the server

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** "abc.ngrok-free.app" → "https://abc.ngrok-free.app", no slash at the end. */
export function normalizeUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = `${/^(\d+\.|localhost)/.test(u) ? 'http' : 'https'}://${u}`;
  return u;
}

export async function request<T>(settings: Pick<Settings, 'serverUrl' | 'token'>, path: string,
                                 { method = 'GET', body, timeoutMs = 15000, key }: { method?: string; body?: unknown; timeoutMs?: number; key?: string } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(normalizeUrl(settings.serverUrl) + path, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(settings.token ? { Authorization: `Bearer ${settings.token}` } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
        // ngrok's free tunnels show a warning page to browsers unless asked not to
        'ngrok-skip-browser-warning': '1',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) throw new ApiError(res.status, data?.message || (res.status === 401 ? 'Please sign in again' : `The server answered ${res.status}`));
    if (data === null && text && !text.startsWith('{') && !text.startsWith('[')) throw new ApiError(502, 'That address does not look like the Personal Budget server');
    return data as T;
  } catch (e: any) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, e?.name === 'AbortError' ? 'The server did not answer in time' : 'The server cannot be reached');
  } finally {
    clearTimeout(timer);
  }
}

/** Is the server there? (an address anyone may call, no sign-in) */
export async function ping(serverUrl: string): Promise<boolean> {
  if (!serverUrl) return false;
  try {
    await request({ serverUrl, token: null }, '/api/meta/app', { timeoutMs: 6000 });
    return true;
  } catch {
    return false;
  }
}

export async function login(serverUrl: string, username: string, password: string): Promise<{ token: string; name: string }> {
  const out = await request<{ token: string; user: { fullName?: string; username: string; mustChangePassword?: boolean } }>(
    { serverUrl, token: null }, '/api/auth/login', { method: 'POST', body: { username, password }, timeoutMs: 15000 });
  return { token: out.token, name: out.user?.fullName || out.user?.username || username };
}

type SyncResult = { clientId: string; status: 'CREATED' | 'DUPLICATE' | 'PENDING' | 'FAILED'; entryId: number | null; entryNo: string | null;
  message: string | null; pendingId: number | null };

/** What waits on the phone to go to the server. */
export type Outbox = { queue: LocalExpense[]; chits: LocalChitPayment[]; uploads: Upload[] };

export type SyncOutcome = Outbox & { ok: boolean; offline?: boolean; sent: number; failed: number; uploaded: number; message: string;
  snapshot?: Snapshot; sheet?: BalanceSheet | null; budgets?: Budgets | null };

const waits = (s: LocalStatus) => s === 'QUEUED' || s === 'FAILED';

/**
 * One sync: send what waits (expenses and chit payments in one batch, then evidence), then bring down the latest
 * balances, expenses, chits, the balance sheet, the budgets and statements. Resolves with what happened (never throws); the
 * outbox it returns is the one to keep.
 */
export async function syncNow(settings: Settings, outbox: Outbox, onStep?: (s: string) => void): Promise<SyncOutcome> {
  const none = { sent: 0, failed: 0, uploaded: 0, ...outbox };
  if (settings.offline) return { ok: false, offline: true, message: 'Working offline', ...none };
  if (!settings.serverUrl || !settings.token) return { ok: false, message: 'Sign in to the server first', ...none };
  onStep?.('Looking for the server…');
  if (!(await ping(settings.serverUrl))) return { ok: false, message: 'Server not reachable · saved on the phone', ...none };
  let q = [...outbox.queue];
  let cq = [...outbox.chits];
  let ups = [...outbox.uploads];
  let sent = 0, failed = 0, uploaded = 0;
  try {
    const waiting = q.filter(e => waits(e.status));
    const chitsWaiting = cq.filter(c => waits(c.status));
    if (waiting.length || chitsWaiting.length) {
      const n = waiting.length + chitsWaiting.length;
      onStep?.(`Sending ${n} item${n === 1 ? '' : 's'}…`);
      const results = await request<SyncResult[]>(settings, '/api/app/expenses/sync', {
        method: 'POST', timeoutMs: 30000,
        body: {
          expenses: waiting.map(e => ({ clientId: e.clientId, date: e.date, amount: e.amount, categoryId: e.categoryId, paidFromId: e.paidFromId,
            narration: e.narration || null, party: e.party || null, reference: e.reference || null, notes: e.notes || null })),
          chitPayments: chitsWaiting.map(c => ({ clientId: c.clientId, chitId: c.chitId, installmentId: c.installmentId, paidDate: c.paidDate,
            fromAccountId: c.fromAccountId, dividend: c.dividend || null })),
        },
      });
      const byId = new Map(results.map(r => [r.clientId, r]));
      const settle = <T extends { clientId: string; status: LocalStatus }>(e: T): T => {
        const r = byId.get(e.clientId);
        if (!r) return e;
        if (r.status === 'FAILED') { failed++; return { ...e, status: 'FAILED', message: r.message || 'Not accepted' }; }
        sent++;
        return { ...e, status: r.status === 'PENDING' ? 'PENDING' : 'SYNCED', message: r.message || undefined, entryNo: r.entryNo || undefined,
          entryId: r.entryId ?? undefined, pendingId: r.pendingId ?? undefined, syncedAt: Date.now() };
      };
      q = q.map(settle);
      cq = cq.map(settle);
    }
    // evidence of expenses the server now has goes to their entries (or, waiting for approval, to the request)
    const booked = new Map(q.map(e => [e.clientId, e]));
    ups = ups.map(u => {
      if (!u.clientId || u.entryId || u.pendingId) return u;
      const e = booked.get(u.clientId);
      return e && (e.entryId || e.pendingId) ? { ...u, entryId: e.entryId, pendingId: e.entryId ? undefined : e.pendingId } : u;
    });
    const ready = ups.filter(u => u.entryId || u.pendingId);
    for (const [i, u] of ready.entries()) {
      onStep?.(`Uploading evidence ${i + 1} of ${ready.length}…`);
      try {
        await uploadEvidence(settings, u);
        uploaded++;
        ups = ups.filter(x => x.id !== u.id);
        await nativeFiles.remove(u.path);
      } catch (e: any) {
        ups = ups.map(x => (x.id === u.id ? { ...x, status: 'FAILED', message: e?.message || 'Upload failed' } : x));
      }
    }
    await store.saveUploads(ups);

    onStep?.('Getting the latest balances…');
    const snap = await request<Omit<Snapshot, 'fetchedAt'>>(settings, `/api/app/snapshot?days=${settings.historyDays}`, { timeoutMs: 30000 });
    const snapshot: Snapshot = { ...snap, fetchedAt: Date.now() };
    // synced expenses stay listed until the server's list has them (a day's grace), then they are only the server's;
    // an expense with evidence still to upload is kept until it is up
    const known = new Set(snapshot.expenses.map(x => x.entryNo));
    const evidenceFor = new Set(ups.map(u => u.clientId).filter(Boolean));
    q = q.filter(e => evidenceFor.has(e.clientId) || !(e.status === 'SYNCED' && (known.has(e.entryNo || '') || Date.now() - (e.syncedAt || 0) > 86400000)));
    // a chit payment is done once the server shows the instalment paid
    const paid = new Set((snapshot.chits || []).flatMap(c => c.installments).filter(i => i.status === 'PAID').map(i => i.id));
    cq = cq.filter(c => !(c.status === 'SYNCED' && (paid.has(c.installmentId) || Date.now() - (c.syncedAt || 0) > 86400000)));
    await store.saveSnapshot(snapshot);
    await store.saveQueue(q);
    await store.saveChitQueue(cq);
    let sheet: BalanceSheet | null = null;
    try {
      onStep?.('Getting the balance sheet…');
      sheet = await fetchBalanceSheet(settings);
    } catch {
      // not allowed for this user, or a hiccup: the kept copy stays
    }
    let budgets: Budgets | null = null;
    try {
      onStep?.('Getting the budgets…');
      budgets = await fetchBudgets(settings);
    } catch {
      // the kept copy stays
    }
    onStep?.('Saving statements for offline use…');
    await cacheStatements(settings, snapshot);
    await enforceLimit(settings, snapshot);
    const bits = [sent ? `${sent} sent` : '', uploaded ? `${uploaded} evidence uploaded` : '', failed ? `${failed} not accepted` : ''].filter(Boolean);
    return { ok: true, sent, failed, uploaded, queue: q, chits: cq, uploads: ups, snapshot, sheet, budgets, message: ['Synced', ...bits].join(' · ') };
  } catch (e: any) {
    await store.saveQueue(q);
    await store.saveChitQueue(cq);
    await store.saveUploads(ups);
    return { ok: false, sent, failed, uploaded, queue: q, chits: cq, uploads: ups,
      message: e instanceof ApiError && e.status === 401 ? 'Please sign in again' : e.message || 'Sync failed' };
  }
}

/** One photo or file as an entry's evidence (multipart, the way the web app sends it). */
async function uploadEvidence(settings: Settings, u: Upload): Promise<void> {
  const form = new FormData();
  form.append('file', { uri: `file://${u.path}`, name: u.name, type: u.type } as any);
  form.append('source', 'mobile-app');
  const target = u.entryId ? `entryId=${u.entryId}` : `pendingId=${u.pendingId}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(`${normalizeUrl(settings.serverUrl)}/api/attachments?${target}`, {
      method: 'POST', body: form, signal: controller.signal,
      headers: { Accept: 'application/json', 'ngrok-skip-browser-warning': '1', ...(settings.token ? { Authorization: `Bearer ${settings.token}` } : {}) },
    });
    if (!res.ok) {
      let msg = `The server answered ${res.status}`;
      try { msg = (await res.json())?.message || msg; } catch { /* not JSON */ }
      throw new ApiError(res.status, msg);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** The balance sheet today, kept for offline use. */
export async function fetchBalanceSheet(settings: Settings): Promise<BalanceSheet> {
  const b = await request<Omit<BalanceSheet, 'fetchedAt'>>(settings, '/api/reports/balance-sheet', { timeoutMs: 20000 });
  const sheet = { ...b, fetchedAt: Date.now() };
  await store.saveBalanceSheet(sheet);
  return sheet;
}

/** A month's budgets against what was spent (this month when none is given); this month's is kept for offline use. */
export async function fetchBudgets(settings: Settings, month?: string): Promise<Budgets> {
  const b = await request<Omit<Budgets, 'fetchedAt'>>(settings, `/api/budgets${month ? `?month=${month}` : ''}`, { timeoutMs: 20000 });
  const out = { ...b, fetchedAt: Date.now() };
  if (!month || month === thisMonth()) await store.saveBudgets(out);
  return out;
}

/** "2026-10" */
export function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** The statements of the most active accounts shown on the phone, as far as the size limit allows. */
async function cacheStatements(settings: Settings, snapshot: Snapshot) {
  const limit = settings.storageMb * 1024 * 1024;
  const accounts = visibleAccounts(settings, snapshot.accounts).filter(a => a.lastActivity)
    .sort((a, b) => (b.lastActivity || '').localeCompare(a.lastActivity || '')).slice(0, settings.statementAccounts);
  for (const a of accounts) {
    const { cache } = await usage();
    if (cache > limit * 0.95) break;
    try {
      const s = await request<Omit<Statement, 'fetchedAt'>>(settings, `/api/app/accounts/${a.id}/statement?days=${settings.historyDays}`, { timeoutMs: 20000 });
      await store.saveStatement({ ...s, fetchedAt: Date.now() });
    } catch {
      // one account's statement failing does not stop the rest
    }
  }
}

/** A statement fresh from the server (when online), kept for later. */
export async function fetchStatement(settings: Settings, id: number): Promise<Statement> {
  const s = await request<Omit<Statement, 'fetchedAt'>>(settings, `/api/app/accounts/${id}/statement?days=${settings.historyDays}`, { timeoutMs: 20000 });
  const st = { ...s, fetchedAt: Date.now() };
  await store.saveStatement(st);
  return st;
}

/**
 * The balance shown for an account: the server's, less what was spent from it on the phone and not yet synced
 * (expenses and chit instalments; a card's balance is what is owed, so it goes up).
 */
export function liveBalance(a: Account, queue: LocalExpense[], chits: LocalChitPayment[] = []): { balance: number; pending: number } {
  const pending = queue.filter(e => e.paidFromId === a.id && waits(e.status)).reduce((s, e) => s + e.amount, 0)
    + chits.filter(c => c.fromAccountId === a.id && waits(c.status)).reduce((s, c) => s + c.amount, 0);
  const balance = a.accountClass === 'LIABILITY' ? a.balance + pending : a.balance - pending;
  return { balance, pending };
}
