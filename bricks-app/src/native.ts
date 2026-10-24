/**
 * The app's own Android module (android/.../bridge/BricksBridgeModule.kt): a small file store, evidence from the camera
 * or the phone's files, evidence from the server saved and opened in the phone's viewer, and printing a bill or slip
 * (Android's print service, which also saves a PDF). Without it (tests, iOS
 * later) the store keeps to memory and evidence cannot be added.
 */
import { NativeModules } from 'react-native';

/** A photo or a file kept in the app's own files until it is uploaded. */
export type PickedFile = { path: string; name: string; type: string; size: number };

type Bridge = {
  storeGet(key: string): Promise<string | null>;
  storeSet(key: string, value: string): Promise<boolean>;
  storeRemove(key: string): Promise<void>;
  storeClear(): Promise<void>;
  pickEvidence(source: 'camera' | 'files'): Promise<PickedFile | null>;
  fileDelete(path: string): Promise<boolean>;
  download(url: string, headers: Record<string, string>, name: string): Promise<string>;
  openFile(path: string, type: string): Promise<boolean>;
  printPage(url: string, title: string, userAgent: string): Promise<boolean>;
};

const native: Bridge | undefined = NativeModules.BricksBridge;
const memory = new Map<string, string>();

export const hasNative = !!native;

export const nativeStore = {
  async get(key: string): Promise<string | null> {
    return native ? native.storeGet(key) : memory.get(key) ?? null;
  },
  async set(key: string, value: string): Promise<void> {
    if (native) await native.storeSet(key, value); else memory.set(key, value);
  },
  async remove(key: string): Promise<void> {
    if (native) await native.storeRemove(key); else memory.delete(key);
  },
  async clear(): Promise<void> {
    if (native) await native.storeClear(); else memory.clear();
  },
};

export const nativeFiles = {
  /** A photo taken now ("camera") or an image / PDF on the phone ("files"); null when cancelled. */
  async pick(source: 'camera' | 'files'): Promise<PickedFile | null> {
    if (!native) throw new Error('Adding evidence needs the Android app');
    return native.pickEvidence(source);
  },
  async remove(path: string) {
    if (native && path) {
      try { await native.fileDelete(path); } catch { /* gone already */ }
    }
  },
  /** Saves a file of the server in the cache (once per name) and gives its path. */
  async download(url: string, headers: Record<string, string>, name: string): Promise<string> {
    if (!native) throw new Error('Opening files needs the Android app');
    return native.download(url, headers, name);
  },
  async open(path: string, type: string) {
    if (native) await native.openFile(path, type);
  },
};

export const nativePrint = {
  /** Prints a page (a bill or slip in its print layout) with Android's print service: a printer, or Save as PDF. */
  async page(url: string, title: string, userAgent: string) {
    if (!native) throw new Error('Printing needs the Android app');
    await native.printPage(url, title, userAgent);
  },
};
