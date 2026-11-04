/**
 * The app's own Android module (android/.../bridge): a small file store, bank SMS, photos / files as evidence, and opening
 * a UPI payment in a chosen app. On iOS (later) the store falls back to memory and SMS is not available (iOS does not
 * let apps read SMS).
 */
import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

export type RawSms = { id: string; sender: string; body: string; at: number };

type Bridge = {
  storeGet(key: string): Promise<string | null>;
  storeSet(key: string, value: string): Promise<number>;
  storeRemove(key: string): Promise<void>;
  storeSizes(): Promise<string>;
  storeClear(): Promise<void>;
  deviceAuth?(title: string, message: string): Promise<string>;
  smsSetEnabled(enabled: boolean): Promise<boolean>;
  smsPending(): Promise<string>;
  smsDone(idsJson: string): Promise<void>;
  smsRecent(days: number, limit: number): Promise<string>;
  pickEvidence(source: 'camera' | 'files'): Promise<PickedFile | null>;
  fileDelete(path: string): Promise<boolean>;
  evidenceSize(): Promise<number>;
  smsPermissions(): Promise<SmsPermissions>;
  openAppSettings(): Promise<boolean>;
  openUpi(link: string, pkg: string): Promise<'APP' | 'STORE'>;
  scanBill?(mode: 'document' | 'live'): Promise<{ rows: string; images?: PickedFile[] } | null>;
  ocrImages?(pathsJson: string): Promise<{ rows: string }>;
  ocrImagesEnhanced?(pathsJson: string, pass: string): Promise<{ rows: string }>;
  /** false in the standard edition (no SMS permission in it) */
  SMS_BUILD?: boolean;
};

/** A photo or a file kept in the app's own files until it is uploaded. */
export type PickedFile = { path: string; name: string; type: string; size: number };
export type SmsPermissions = { receive: boolean; read: boolean; notify: boolean; enabled: boolean };

const native: Bridge | undefined = NativeModules.BudgetBridge;
const memory = new Map<string, string>();

/** Bank SMS: Android, and only the "sms" edition of the app (the standard one asks for no SMS permission). */
export const smsSupported = Platform.OS === 'android' && !!native && native.SMS_BUILD !== false;
/** Which edition this is, for Settings: "sms" or "standard". */
export const edition: 'sms' | 'standard' = native?.SMS_BUILD === false ? 'standard' : 'sms';

export const nativeStore = {
  async get(key: string): Promise<string | null> {
    return native ? native.storeGet(key) : memory.get(key) ?? null;
  },
  async set(key: string, value: string): Promise<number> {
    if (native) return native.storeSet(key, value);
    memory.set(key, value);
    return value.length;
  },
  async remove(key: string): Promise<void> {
    if (native) await native.storeRemove(key); else memory.delete(key);
  },
  async sizes(): Promise<Record<string, number>> {
    if (native) return JSON.parse(await native.storeSizes());
    const out: Record<string, number> = {};
    memory.forEach((v, k) => { out[k] = v.length; });
    return out;
  },
  async clear(): Promise<void> {
    if (native) await native.storeClear(); else memory.clear();
  },
};

export const nativeSms = {
  async setEnabled(on: boolean) { if (native) await native.smsSetEnabled(on); },
  async pending(): Promise<RawSms[]> { return native ? JSON.parse(await native.smsPending()) : []; },
  async done(ids: string[]) { if (native && ids.length) await native.smsDone(JSON.stringify(ids)); },
  async recent(days: number, limit = 40): Promise<RawSms[]> { return native ? JSON.parse(await native.smsRecent(days, limit)) : []; },
  /** A bank SMS that arrives while the app is running. */
  onSms(fn: (sms: RawSms) => void) {
    const sub = DeviceEventEmitter.addListener('BudgetSms', (json: string) => {
      try { fn(JSON.parse(json)); } catch { /* not ours */ }
    });
    return () => sub.remove();
  },
};

export const nativeFiles = {
  /** A photo taken now ("camera") or an image / PDF on the phone ("files"); null when cancelled. */
  async pick(source: 'camera' | 'files'): Promise<PickedFile | null> { return native ? native.pickEvidence(source) : null; },
  async remove(path: string) { if (native && path) { try { await native.fileDelete(path); } catch { /* gone already */ } } },
  async size(): Promise<number> { return native ? native.evidenceSize() : 0; },
};

export const nativeLock = {
  /** The phone's own lock (pattern, PIN, password, fingerprint): 'ok', 'denied' (cancelled) or 'none' (the phone has no screen lock). */
  async ask(title: string, message: string): Promise<'ok' | 'denied' | 'none'> {
    if (!native || !native.deviceAuth) return 'none';
    try { return (await native.deviceAuth(title, message)) as 'ok' | 'denied' | 'none'; } catch { return 'denied'; }
  },
};

export const nativeSettings = {
  async smsPermissions(): Promise<SmsPermissions> {
    return native ? native.smsPermissions() : { receive: false, read: false, notify: false, enabled: false };
  },
  async openApp() { if (native) await native.openAppSettings(); },
};

/** A bill read on the phone: its rows top to bottom, and its photos (kept as the expense's evidence). */
export type ScannedBill = { rows: string[]; images: PickedFile[] };

export const nativeScan = {
  available: Platform.OS === 'android' && !!native?.scanBill,
  /** "document": the document scanner (pages, edges found); "live": a long bill read like a video. null when cancelled. */
  async scan(mode: 'document' | 'live'): Promise<ScannedBill | null> {
    if (!native?.scanBill) throw new Error('Scanning bills needs the Android app');
    const r = await native.scanBill(mode);
    return r ? { rows: JSON.parse(r.rows || '[]'), images: r.images || [] } : null;
  },
  /** Photos already kept by the app (paths), read as the pages of one bill. */
  async read(paths: string[]): Promise<string[]> {
    if (!native?.ocrImages) throw new Error('Reading bills needs the Android app');
    return JSON.parse((await native.ocrImages(JSON.stringify(paths))).rows || '[]');
  },
  /** The same photos read again, cleaned up: for a read that does not match the bill. Empty when the phone cannot. */
  async readEnhanced(paths: string[], pass: 'contrast' | 'large'): Promise<string[]> {
    if (!native?.ocrImagesEnhanced) return [];
    return JSON.parse((await native.ocrImagesEnhanced(JSON.stringify(paths), pass)).rows || '[]');
  },
};

export const nativeUpi = {
  /** Opens a upi://pay link in the app with this package (its Play Store page when it is not installed). */
  async open(link: string, pkg: string): Promise<'APP' | 'STORE' | null> { return native ? native.openUpi(link, pkg) : null; },
};
