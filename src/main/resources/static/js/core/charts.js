/**
 * Lightweight SVG charts (no library): grouped bars, lines/areas and donuts.
 *
 * Design rules (kept on purpose):
 *  - colors come from the validated categorical palette, assigned in fixed order (--series-1..8)
 *  - one y-axis per chart, recessive grid, thin marks, 4px rounded bar ends, 2px gaps between fills
 *  - every chart has a hover tooltip; legends are HTML so text stays in text colors
 *  - charts re-render when their container resizes, so they always fit the panel without scrolling
 */
import { esc } from './ui.js';

export const SERIES = ['--series-1', '--series-2', '--series-3', '--series-4',
                       '--series-5', '--series-6', '--series-7', '--series-8'];

/** CSS color for the n-th categorical slot (fixed order, never cycled past 8). */
export function seriesColor(index) {
    return `var(${SERIES[Math.min(index, SERIES.length - 1)]})`;
}

// ===================================================================== tooltip

const tooltip = () => document.getElementById('tooltip');

function showTooltip(html, clientX, clientY) {
    const tip = tooltip();
    tip.innerHTML = html;
    tip.hidden = false;
    const { width, height } = tip.getBoundingClientRect();
    let x = clientX + 14;
    let y = clientY - height - 10;
    if (x + width > window.innerWidth - 8) x = clientX - width - 14;
    if (y < 8) y = clientY + 16;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
}

function hideTooltip() {
    tooltip().hidden = true;
}

function tooltipHtml(title, rows) {
    return `<div class="tt-title">${esc(title)}</div>` + rows.map(r =>
        `<div class="tt-row"><span>${r.color ? `<i class="legend-swatch" style="background:${r.color}"></i>` : ''}${esc(r.label)}</span>
         <b>${esc(r.value)}</b></div>`).join('');
}

// ===================================================================== mounting

/**
 * Renders draw(width, height) into el now and whenever el is resized.
 * draw returns { svg: string, bind?: (svgElement) => void }.
 */
function mount(el, draw) {
    el.classList.add('chart');
    el._chartObserver?.disconnect();
    let lastSize = '';
    const render = () => {
        const width = Math.floor(el.clientWidth);
        const height = Math.floor(el.clientHeight);
        if (width < 20 || height < 20) return;
        const size = width + 'x' + height;
        if (size === lastSize) return;
        lastSize = size;
        const { svg, bind } = draw(width, height);
        el.innerHTML = svg;
        bind?.(el.querySelector('svg'));
    };
    const observer = new ResizeObserver(() => render());
    observer.observe(el);
    el._chartObserver = observer;
    render();
}

// ===================================================================== scales

/** "Nice" axis ticks covering [min, max]. */
function niceTicks(min, max, count = 4) {
    if (min === max) { max = min + 1; }
    const span = max - min;
    const rough = span / count;
    const power = Math.pow(10, Math.floor(Math.log10(rough)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * power).find(s => span / s <= count) || power * 10;
    const start = Math.floor(min / step) * step;
    const end = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = start; v <= end + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
    return ticks;
}

function extent(values, includeZero = true) {
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (includeZero) { min = Math.min(0, min); max = Math.max(0, max); }
    if (!isFinite(min)) { min = 0; max = 1; }
    return [min, max];
}

/** Picks every n-th x label so they never collide. */
function labelStep(count, plotWidth, labelWidth = 44) {
    return Math.max(1, Math.ceil(count * labelWidth / Math.max(plotWidth, 1)));
}

function axisLayer(ticks, y, left, right, format) {
    return ticks.map(t => `
        <line class="${t === 0 ? 'axis-line' : 'grid-line'}" x1="${left}" x2="${right}" y1="${y(t)}" y2="${y(t)}"/>
        <text x="${left - 6}" y="${y(t) + 3.5}" text-anchor="end">${esc(format(t))}</text>`).join('');
}

/** Bar with 4px rounded data end, anchored flat on the baseline. */
function barPath(x, width, y0, y1) {
    const h = Math.abs(y1 - y0);
    if (h < 0.5) return '';
    const r = Math.min(4, width / 2, h);
    if (y1 < y0) { // positive: rounded top
        return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + width - r} Q${x + width},${y1} ${x + width},${y1 + r} V${y0} Z`;
    }
    return `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + width - r} Q${x + width},${y1} ${x + width},${y1 - r} V${y0} Z`;
}

// ===================================================================== bar chart

/**
 * Grouped vertical bars.
 * config: { labels: string[], series: [{ name, values, color? }], format: v => string, labelFormat? }
 */
export function barChart(el, { labels, series, format, labelFormat = l => l }) {
    mount(el, (W, H) => {
        const pad = { top: 10, right: 6, bottom: 22, left: 54 };
        const all = series.flatMap(s => s.values.map(Number));
        const [min, max] = extent(all);
        const ticks = niceTicks(min, max);
        const lo = ticks[0], hi = ticks[ticks.length - 1];
        const plotW = W - pad.left - pad.right;
        const plotH = H - pad.top - pad.bottom;
        const y = v => pad.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
        const band = plotW / labels.length;
        const groupW = Math.min(band * 0.72, series.length * 26);
        const gap = 2;
        const barW = Math.max(2, (groupW - gap * (series.length - 1)) / series.length);
        const step = labelStep(labels.length, plotW);

        let marks = '';
        labels.forEach((label, i) => {
            const gx = pad.left + band * i + (band - groupW) / 2;
            series.forEach((s, k) => {
                const v = Number(s.values[i] || 0);
                const color = s.color || seriesColor(k);
                marks += `<path class="mark" data-i="${i}" d="${barPath(gx + k * (barW + gap), barW, y(0), y(v))}" style="fill:${color}"/>`;
            });
        });
        const xLabels = labels.map((label, i) => i % step === 0
            ? `<text x="${pad.left + band * i + band / 2}" y="${H - 6}" text-anchor="middle">${esc(labelFormat(label))}</text>` : '').join('');
        const hits = labels.map((_, i) =>
            `<rect class="hit" data-i="${i}" x="${pad.left + band * i}" y="${pad.top}" width="${band}" height="${plotH}"/>`).join('');

        const svg = `<svg viewBox="0 0 ${W} ${H}">${axisLayer(ticks, y, pad.left, W - pad.right, format)}
            <line class="axis-line" x1="${pad.left}" x2="${W - pad.right}" y1="${y(0)}" y2="${y(0)}"/>
            ${marks}${xLabels}${hits}</svg>`;

        return {
            svg,
            bind(svgEl) {
                svgEl.addEventListener('mousemove', e => {
                    const hit = e.target.closest('.hit');
                    if (!hit) { hideTooltip(); return; }
                    const i = Number(hit.dataset.i);
                    el.classList.add('dim');
                    svgEl.querySelectorAll('.mark').forEach(m => m.classList.toggle('hover', Number(m.dataset.i) === i));
                    showTooltip(tooltipHtml(labelFormat(labels[i]), series.map((s, k) => ({
                        label: s.name, value: format(s.values[i] || 0), color: s.color || seriesColor(k),
                    }))), e.clientX, e.clientY);
                });
                svgEl.addEventListener('mouseleave', () => { el.classList.remove('dim'); hideTooltip(); });
            },
        };
    });
}

// ===================================================================== line / area chart

/**
 * Lines (optionally filled as areas) sharing one y-axis.
 * config: { labels, series: [{ name, values, color?, dashed? }], format, labelFormat?, area?, includeZero? }
 */
export function lineChart(el, { labels, series, format, labelFormat = l => l, area = false, includeZero = false }) {
    mount(el, (W, H) => {
        const pad = { top: 12, right: 10, bottom: 22, left: 56 };
        const all = series.flatMap(s => s.values.filter(v => v !== null).map(Number));
        let [min, max] = extent(all, includeZero);
        if (!includeZero) { const span = (max - min) || Math.abs(max) || 1; min -= span * 0.08; max += span * 0.08; }
        const ticks = niceTicks(min, max);
        const lo = ticks[0], hi = ticks[ticks.length - 1];
        const plotW = W - pad.left - pad.right;
        const plotH = H - pad.top - pad.bottom;
        const n = labels.length;
        const x = i => pad.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
        const y = v => pad.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
        const step = labelStep(n, plotW);
        const uid = 'g' + Math.random().toString(36).slice(2, 8);

        let defs = '';
        let marks = '';
        series.forEach((s, k) => {
            const color = s.color || seriesColor(k);
            const points = s.values.map((v, i) => v === null ? null : [x(i), y(Number(v))]).filter(Boolean);
            if (!points.length) return;
            const d = points.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
            if (area) {
                defs += `<linearGradient id="${uid}${k}" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" style="stop-color:${color};stop-opacity:0.26"/>
                    <stop offset="1" style="stop-color:${color};stop-opacity:0.02"/></linearGradient>`;
                const base = y(Math.max(lo, Math.min(0, hi)));
                marks += `<path d="${d} L${points[points.length - 1][0]},${base} L${points[0][0]},${base} Z" fill="url(#${uid}${k})"/>`;
            }
            marks += `<path d="${d}" fill="none" style="stroke:${color}" stroke-width="2" stroke-linejoin="round"
                        stroke-linecap="round" ${s.dashed ? 'stroke-dasharray="5 4"' : ''}/>`;
            const last = points[points.length - 1];
            marks += `<circle cx="${last[0]}" cy="${last[1]}" r="4" style="fill:${color}" stroke="#fff" stroke-width="2"/>`;
        });
        const xLabels = labels.map((label, i) => i % step === 0
            ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(labelFormat(label))}</text>` : '').join('');

        const svg = `<svg viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>
            ${axisLayer(ticks, y, pad.left, W - pad.right, format)}${marks}${xLabels}
            <line class="crosshair" x1="0" x2="0" y1="${pad.top}" y2="${pad.top + plotH}" visibility="hidden"/>
            <g class="hover-dots"></g>
            <rect class="hit" x="${pad.left}" y="${pad.top}" width="${plotW}" height="${plotH}"/></svg>`;

        return {
            svg,
            bind(svgEl) {
                const cross = svgEl.querySelector('.crosshair');
                const dots = svgEl.querySelector('.hover-dots');
                svgEl.querySelector('.hit').addEventListener('mousemove', e => {
                    const box = svgEl.getBoundingClientRect();
                    const px = (e.clientX - box.left) * (W / box.width);
                    const i = Math.max(0, Math.min(n - 1, Math.round(((px - pad.left) / plotW) * (n - 1))));
                    cross.setAttribute('x1', x(i));
                    cross.setAttribute('x2', x(i));
                    cross.setAttribute('visibility', 'visible');
                    dots.innerHTML = series.map((s, k) => s.values[i] === null ? '' :
                        `<circle cx="${x(i)}" cy="${y(Number(s.values[i]))}" r="4.5" style="fill:${s.color || seriesColor(k)}" stroke="#fff" stroke-width="2"/>`).join('');
                    showTooltip(tooltipHtml(labelFormat(labels[i]), series.map((s, k) => ({
                        label: s.name, value: s.values[i] === null ? '—' : format(s.values[i]), color: s.color || seriesColor(k),
                    }))), e.clientX, e.clientY);
                });
                svgEl.querySelector('.hit').addEventListener('mouseleave', () => {
                    cross.setAttribute('visibility', 'hidden');
                    dots.innerHTML = '';
                    hideTooltip();
                });
            },
        };
    });
}

// ===================================================================== donut

/**
 * Donut with a center headline.
 * config: { items: [{ label, value }], format, centerValue, centerLabel }
 * Items are expected sorted and already folded to at most 8 (largest first, "Others" last).
 */
export function donutChart(el, { items, format, centerValue = '', centerLabel = '' }) {
    mount(el, (W, H) => {
        const size = Math.min(W, H);
        const cx = W / 2, cy = H / 2;
        const outer = size / 2 - 4;
        const inner = outer * 0.64;
        const total = items.reduce((sum, it) => sum + Number(it.value), 0) || 1;
        let angle = -Math.PI / 2;
        const arcs = items.map((it, k) => {
            const sweep = (Number(it.value) / total) * Math.PI * 2;
            const a0 = angle, a1 = angle + sweep;
            angle = a1;
            const large = sweep > Math.PI ? 1 : 0;
            const p = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
            const d = sweep >= Math.PI * 2 - 0.001
                ? `M${p(outer, 0)} A${outer},${outer} 0 1 1 ${p(outer, Math.PI)} A${outer},${outer} 0 1 1 ${p(outer, 0)}
                   M${p(inner, 0)} A${inner},${inner} 0 1 0 ${p(inner, Math.PI)} A${inner},${inner} 0 1 0 ${p(inner, 0)} Z`
                : `M${p(outer, a0)} A${outer},${outer} 0 ${large} 1 ${p(outer, a1)} L${p(inner, a1)} A${inner},${inner} 0 ${large} 0 ${p(inner, a0)} Z`;
            return `<path class="mark" data-k="${k}" d="${d}" style="fill:${it.color || seriesColor(k)}"
                     stroke="#fff" stroke-width="2" stroke-linejoin="round"/>`;
        }).join('');
        const svg = `<svg viewBox="0 0 ${W} ${H}">${arcs}
            <text class="center-value" x="${cx}" y="${cy + 2}" text-anchor="middle">${esc(centerValue)}</text>
            <text class="center-label" x="${cx}" y="${cy + 18}" text-anchor="middle">${esc(centerLabel)}</text></svg>`;
        return {
            svg,
            bind(svgEl) {
                svgEl.addEventListener('mousemove', e => {
                    const mark = e.target.closest('.mark');
                    if (!mark) { el.classList.remove('dim'); hideTooltip(); return; }
                    const k = Number(mark.dataset.k);
                    el.classList.add('dim');
                    svgEl.querySelectorAll('.mark').forEach(m => m.classList.toggle('hover', m === mark));
                    const it = items[k];
                    showTooltip(tooltipHtml(it.label, [
                        { label: 'Amount', value: format(it.value), color: it.color || seriesColor(k) },
                        { label: 'Share', value: ((Number(it.value) / total) * 100).toFixed(1) + '%' },
                    ]), e.clientX, e.clientY);
                });
                svgEl.addEventListener('mouseleave', () => { el.classList.remove('dim'); hideTooltip(); });
            },
        };
    });
}

// ===================================================================== legend

/** HTML legend. items: [{ label, color?, value? }], kind: 'box' | 'line' */
export function legend(items, kind = 'box') {
    return `<div class="legend">${items.map((it, k) => `
        <span class="legend-item"><i class="legend-swatch ${kind === 'line' ? 'line' : ''}"
            style="background:${it.color || seriesColor(k)}"></i>${esc(it.label)}${it.value !== undefined
            ? ` <b class="secondary">${esc(it.value)}</b>` : ''}</span>`).join('')}</div>`;
}

/** Folds a sorted list to at most `max` items, summing the tail into "Others". */
export function foldOthers(items, max = 8) {
    if (items.length <= max) return items;
    const head = items.slice(0, max - 1);
    const rest = items.slice(max - 1).reduce((s, it) => s + Number(it.value), 0);
    return [...head, { label: 'Others', value: rest }];
}

// ===================================================================== sparkline

/**
 * Tiny inline trend line (no axes) as an SVG string, e.g. for list rows and cards.
 * values: numbers oldest first. color: any CSS color.
 */
export function sparkline(values, { width = 64, height = 20, color = 'var(--series-1)', fill = true } = {}) {
    const nums = values.map(Number);
    if (nums.length < 2) return '';
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const span = max - min || 1;
    const points = nums.map((v, i) => [(i / (nums.length - 1)) * (width - 4) + 2, height - 2 - ((v - min) / span) * (height - 4)]);
    const d = points.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    const last = points[points.length - 1];
    return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">
        ${fill ? `<path d="${d} L${last[0]},${height} L${points[0][0]},${height} Z" style="fill:${color};opacity:0.12"/>` : ''}
        <path d="${d}" fill="none" style="stroke:${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${last[0]}" cy="${last[1]}" r="2.2" style="fill:${color}"/></svg>`;
}
