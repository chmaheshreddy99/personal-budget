/**
 * Addresses of pages: #/<page>/<segments...>?<query>. Every page writes what it shows into the address bar (the chit
 * or account selected, the tab, the period and filters, the item opened), so the address can be bookmarked, shared,
 * reloaded or reached with Back / Forward and gives the same view.
 *
 *   readQuery()          the ?query of the current address, as URLSearchParams
 *   routeHash(path, q)   builds "#/path?k=v&list=1,2" (empty values left out, lists comma separated)
 *   showRoute(hash, o)   puts the address in the bar without drawing the page again: { push: true } adds a step to
 *                        the browser history (a real move: another chit, tab or period), otherwise it replaces the
 *                        current one (a filter, a row opened)
 *
 * Writing the address never triggers the router (history.pushState / replaceState fire no hashchange); Back and Forward
 * do, and the page then draws itself from the address it is given.
 */

export function readQuery() {
    const hash = location.hash;
    const at = hash.indexOf('?');
    return new URLSearchParams(at >= 0 ? hash.slice(at + 1) : '');
}

/** The path part of the current address, without "#/" and the query. */
export function currentPath() {
    return location.hash.replace(/^#\/?/, '').split('?')[0];
}

const encode = v => encodeURIComponent(v).replace(/%2C/g, ',').replace(/%3A/g, ':');

export function routeHash(path, query = {}) {
    const parts = Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false && !(Array.isArray(v) && !v.length))
        .map(([k, v]) => `${k}=${encode(Array.isArray(v) ? v.join(',') : v === true ? '1' : String(v))}`);
    return `#/${path}${parts.length ? `?${parts.join('&')}` : ''}`;
}

export function showRoute(hash, { push = false } = {}) {
    if (location.hash === hash) return;
    history[push ? 'pushState' : 'replaceState'](history.state, '', hash);
    window.dispatchEvent(new CustomEvent('routeshown', { detail: hash }));
}

/** Per page, the "move" last written: what, when it changes, deserves its own step in the history. */
const lastMove = new Map();

/**
 * Writes a page's address after it drew itself. {@code move} names what makes a real move on that page (e.g. the
 * period and the tab): when it changed since the last time, the address is pushed (Back returns to the previous one);
 * a filter or an opened row only replaces it. A page drawn from the address ({@code routed}: a link, a reload,
 * Back / Forward) never pushes, so the history stays as the browser has it.
 */
export function showPageRoute(page, hash, move, { routed = false } = {}) {
    const before = lastMove.get(page);
    lastMove.set(page, move);
    showRoute(hash, { push: !routed && before !== undefined && before !== move });
}

/** A list from the query ("1,2,3"), or [] when it is not there. */
export function queryList(query, key) {
    const v = query.get(key);
    return v ? v.split(',').filter(Boolean) : [];
}

/** Whether a page was reached by an address (a link, Back / Forward, a reload) rather than redrawn from inside itself. */
export const fromAddress = params => Boolean(params?.length || params?.query?.toString());
