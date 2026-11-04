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

export function showRoute(hash, { push = false, exact = false } = {}) {
    // a page writing its address keeps the dialog open over it (...?dialog=expense): only the dialog itself takes it away
    const dialog = readQuery().get('dialog');
    if (!exact && dialog && !/[?&]dialog=/.test(hash) && hash.split(/[/?]/)[1] === currentPath().split('/')[0]) {
        hash += `${hash.includes('?') ? '&' : '?'}dialog=${encode(dialog)}`;
    }
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

/**
 * Sets some keys of the current address's query (null, '' or false removes one) and keeps the rest, without drawing
 * the page again: for a part of a page (a report's tab, a side panel) that the page's own address does not cover.
 * {@code push}: a real move (a tab) gets its own step in the history; otherwise the address is only replaced.
 */
export function setQuery(changes, { push = false } = {}) {
    const q = Object.fromEntries(readQuery());
    Object.entries(changes).forEach(([k, v]) => {
        if (v === null || v === undefined || v === '' || v === false) delete q[k];
        else q[k] = String(v);
    });
    showRoute(routeHash(currentPath(), q), { push, exact: true });
}

/**
 * The choices of a page kept in the address (a tab, a period, a switch ...). A spec maps each query key to a choice:
 * choice(object, field, default, parse?, { move: true }?). The rule, the same on every page: an address holding any of
 * the keys shows exactly that (a key left out is its default), and a bare address (from the menu) shows what was last
 * chosen. Writing always leaves at least the first key, so Back returns to the view as it was.
 */
export function choice(object, field, def, parse = String, { move = false, format = String } = {}) {
    return { get: () => object[field], set: v => { object[field] = v; }, def, parse, format, move };
}

export const asNumber = Number;
export const asFlag = v => v === '1';
export const flagText = v => (v ? '1' : '0');
export const asList = v => (v ? v.split(',').filter(Boolean) : []);

/** Takes the choices from the address the page was reached by; a page redrawn from inside itself has none. */
export function readChoices(params, spec) {
    const q = params?.query;
    if (!q || !Object.keys(spec).some(k => q.has(k))) return;
    Object.entries(spec).forEach(([k, c]) => c.set(q.has(k) ? c.parse(q.get(k)) : c.def));
}

/** Writes the choices to the address; one marked {@code move} that changed gets its own step in the history. */
export function writeChoices(spec) {
    const q = readQuery();
    const changes = {};
    let push = false;
    Object.entries(spec).forEach(([k, c]) => {
        const text = c.format(c.get()), def = c.format(c.def);
        changes[k] = text === def ? null : text;
        if (c.move && (q.get(k) ?? def) !== text) push = true;
    });
    if (Object.values(changes).every(v => v === null)) {
        const [first, c] = Object.entries(spec)[0];
        changes[first] = c.format(c.def);
    }
    setQuery(changes, { push });
}

/** A list from the query ("1,2,3"), or [] when it is not there. */
export function queryList(query, key) {
    const v = query.get(key);
    return v ? v.split(',').filter(Boolean) : [];
}

/** Whether a page was reached by an address (a link, Back / Forward, a reload) rather than redrawn from inside itself. */
export const fromAddress = params => Boolean(params?.length || params?.query?.toString());
