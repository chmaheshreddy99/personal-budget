/**
 * Talking to the server, and what the app keeps on the phone.
 *
 * Kept (src/native.ts store): the session (server address, username, token: never the password), the last profile,
 * and the last answer of each screen ("cache:<path>"), so the app opens at once and still shows the yard's figures when
 * the signal drops; a screen says when what it shows is from earlier.
 *
 * The server answers a maker's change that needs a checker with 202 and the request it made (Held): callers show
 * "sent for approval" instead of "saved".
 */
import { nativeStore, PickedFile } from './native';
import { Held, Profile } from './types';

/** The organization's company name and logo (the logo: an address on the server), as the web app shows them. */
export type Brand = { name: string | null; logo: string | null };

/** The brand stays after signing out, so the sign-in screen shows it next time. */
export type Session = { server: string; username: string; token: string | null; name: string; brand?: Brand | null };

export const EMPTY_SESSION: Session = { server: '', username: '', token: null, name: '' };

/** The logo's full address on the server, or null without one. */
export function logoUrl(session: Pick<Session, 'server' | 'brand'>): string | null {
  const logo = session.brand?.logo;
  return logo && session.server ? `${normalizeUrl(session.server)}${logo}` : null;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** "abc.ngrok-free.app" → "https://abc.ngrok-free.app", "192.168.1.5:8080" → "http://…", no slash at the end. */
export function normalizeUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = `${/^(\d+\.|localhost)/.test(u) ? 'http' : 'https'}://${u}`;
  return u;
}

export function headers(token: string | null, json = false): Record<string, string> {
  return {
    Accept: 'application/json',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    // ngrok's free tunnels show a warning page unless asked not to
    'ngrok-skip-browser-warning': '1',
  };
}

type Options = { method?: string; body?: unknown; timeoutMs?: number };

/** One call to /api…: the answer, or an ApiError with the server's own message. A held change resolves with the Held. */
export async function request<T>(session: Pick<Session, 'server' | 'token'>, path: string, { method = 'GET', body, timeoutMs = 20000 }: Options = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(normalizeUrl(session.server) + '/api' + path, {
      method, signal: controller.signal, headers: headers(session.token, body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) {
      throw new ApiError(res.status, data?.message || (res.status === 401 ? 'Please sign in again' : `The server answered ${res.status}`));
    }
    if (data === null && text && !/^[[{]/.test(text.trim())) throw new ApiError(502, 'That address does not look like the Bricks server');
    return data as T;
  } catch (e: any) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, e?.name === 'AbortError' ? 'The server did not answer in time' : 'The server cannot be reached. Check the signal or the address.');
  } finally {
    clearTimeout(timer);
  }
}

/** Is the server there? (an address anyone may call, no sign-in) */
export async function ping(server: string): Promise<boolean> {
  try {
    await request({ server, token: null }, '/meta/app', { timeoutMs: 8000 });
    return true;
  } catch {
    return false;
  }
}

export type LoginResult = { token: string; user: { fullName?: string; username: string; mustChangePassword?: boolean;
  brandName?: string | null; brandLogo?: string | null } };

/** Signs in as the Bricks app: the server opens a session limited to the screens given to this user. */
export async function login(server: string, username: string, password: string): Promise<LoginResult> {
  return request<LoginResult>({ server, token: null }, '/auth/login', { method: 'POST', body: { username, password, client: 'bricks' } });
}

/** Where a piece of evidence is on the server (with the token in the headers: see headers()). */
export function fileUrl(session: Pick<Session, 'server'>, id: number, thumb = false): string {
  return `${normalizeUrl(session.server)}/api/attachments/${id}/file${thumb ? '?thumb=true' : ''}`;
}

/** Sends a photo or a file as evidence: of a request waiting for approval (pendingId) or of an entry in the books (entryId). */
export async function upload(session: Session, file: PickedFile, target: { pendingId?: number; entryId?: number }, caption?: string): Promise<void> {
  const form = new FormData();
  form.append('file', { uri: `file://${file.path}`, name: file.name, type: file.type } as any);
  form.append('source', 'bricks-app');
  if (caption) form.append('caption', caption);
  const q = target.pendingId ? `pendingId=${target.pendingId}` : `entryId=${target.entryId}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const res = await fetch(`${normalizeUrl(session.server)}/api/attachments?${q}`, {
      method: 'POST', body: form, signal: controller.signal, headers: headers(session.token),
    });
    if (!res.ok) {
      let message = `The server answered ${res.status}`;
      try { message = (await res.json())?.message || message; } catch { /* not JSON */ }
      throw new ApiError(res.status, message);
    }
  } catch (e: any) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, e?.name === 'AbortError' ? 'The upload took too long' : 'The server cannot be reached');
  } finally {
    clearTimeout(timer);
  }
}

// ===================================================================== kept on the phone

const SESSION = 'session';
const PROFILE = 'profile';

async function read<T>(key: string): Promise<T | null> {
  try {
    const s = await nativeStore.get(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

export const store = {
  session: async (): Promise<Session> => ({ ...EMPTY_SESSION, ...(await read<Session>(SESSION)) }),
  saveSession: (s: Session) => nativeStore.set(SESSION, JSON.stringify(s)),
  profile: () => read<Profile>(PROFILE),
  saveProfile: (p: Profile) => nativeStore.set(PROFILE, JSON.stringify(p)),
  /** A screen's last answer, with when it came. */
  cached: <T>(path: string) => read<{ at: number; data: T }>(`cache:${path}`),
  saveCached: (path: string, data: unknown) => nativeStore.set(`cache:${path}`, JSON.stringify({ at: Date.now(), data })).catch(() => undefined),
  /** Signing out: everything kept goes, but the server address, username and the company's brand stay for next time. */
  signOut: async (s: Session) => {
    await nativeStore.clear();
    await nativeStore.set(SESSION, JSON.stringify({ ...EMPTY_SESSION, server: s.server, username: s.username, brand: s.brand }));
  },
};

export type { Held };
