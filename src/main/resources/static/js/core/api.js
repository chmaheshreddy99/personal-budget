/**
 * Thin wrapper around fetch() for the REST API.
 * Adds the bearer token, parses JSON and turns error responses into Error objects
 * whose message is the server's explanation.
 */

let TOKEN_KEY = 'pb.token';

/** The mobile version stores its session under its own key, so it never replaces the desktop session. */
export function useTokenKey(key) {
    TOKEN_KEY = key;
}

function readToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export const session = {
    get token() { return readToken(); },
    set token(value) {
        try {
            if (value) localStorage.setItem(TOKEN_KEY, value);
            else localStorage.removeItem(TOKEN_KEY);
        } catch { /* storage unavailable: session lasts for this page only */ }
    },
};

/** Listeners told after every successful change (POST / PUT / DELETE), e.g. to refresh caches. */
const mutationListeners = [];
export function onMutation(listener) { mutationListeners.push(listener); }

/** Called when the server says the session is gone (set by app.js). */
let onUnauthorized = () => {};
export function setUnauthorizedHandler(handler) { onUnauthorized = handler; }

/** Called when a save was based on data someone else changed in the meantime (HTTP 409, set by app.js). */
let onConflict = () => {};
export function setConflictHandler(handler) { onConflict = handler; }

/** Time of this tab's last change (started or finished); the live-update stream skips our own echoes. */
export let lastOwnMutation = 0;
/** Changes this tab has sent and not yet seen answered: their echo can arrive before the response. */
export let mutationsInFlight = 0;

function buildUrl(path, params) {
    const url = new URL('/api' + path, window.location.origin);
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    });
    return url;
}

/**
 * A key for one save: send it with every attempt of the same form (post(path, body, { key })) and the server
 * saves once, replaying the answer for a double tap or a retry (see IdempotencyFilter).
 */
export function newRequestKey() {
    return (crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
}

async function request(method, path, { params, body, key } = {}) {
    const headers = { 'Accept': 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (key) headers['Idempotency-Key'] = key;
    if (session.token) headers['Authorization'] = 'Bearer ' + session.token;

    const mutating = method !== 'GET';
    if (mutating) { mutationsInFlight++; lastOwnMutation = Date.now(); }
    let response;
    try {
        response = await fetch(buildUrl(path, params), {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
    } finally {
        if (mutating) { mutationsInFlight--; lastOwnMutation = Date.now(); }
    }

    if (response.ok && method !== 'GET') {
        lastOwnMutation = Date.now();
        mutationListeners.forEach(listener => listener(path));
    }
    if (response.status === 204) return null;
    const data = await response.json().catch(() => null);

    if (!response.ok) {
        if (response.status === 401 && !path.startsWith('/auth/login')) onUnauthorized();
        const error = new Error(data?.message || `Request failed (${response.status})`);
        error.status = response.status;
        if (response.status === 409) onConflict(error);
        throw error;
    }
    return data;
}

/** Fetches a file (with the session) as a Blob, e.g. an attachment to show as an image. */
async function blob(path, params) {
    const headers = {};
    if (session.token) headers['Authorization'] = 'Bearer ' + session.token;
    const response = await fetch(buildUrl(path, params), { headers });
    if (!response.ok) {
        if (response.status === 401) onUnauthorized();
        const data = await response.json().catch(() => null);
        throw Object.assign(new Error(data?.message || `Could not load the file (${response.status})`), { status: response.status });
    }
    return response.blob();
}

/** Sends a multipart form (file uploads). */
async function upload(path, formData) {
    const headers = { 'Accept': 'application/json' };
    if (session.token) headers['Authorization'] = 'Bearer ' + session.token;
    mutationsInFlight++;
    lastOwnMutation = Date.now();
    let response;
    try {
        response = await fetch(buildUrl(path), { method: 'POST', headers, body: formData });
    } finally {
        mutationsInFlight--;
        lastOwnMutation = Date.now();
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
        if (response.status === 401) onUnauthorized();
        throw Object.assign(new Error(data?.message || `Upload failed (${response.status})`), { status: response.status });
    }
    lastOwnMutation = Date.now();
    mutationListeners.forEach(listener => listener(path));
    return data;
}

export const api = {
    blob,
    upload,
    get: (path, params) => request('GET', path, { params }),
    post: (path, body, { key } = {}) => request('POST', path, { body: body ?? {}, key }),
    put: (path, body, { key } = {}) => request('PUT', path, { body, key }),
    del: (path) => request('DELETE', path),
};
