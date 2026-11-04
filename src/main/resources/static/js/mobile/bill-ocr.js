/**
 * Reading a photo of a bill in the browser, on the phone: the photo never leaves it. Tesseract (vendor/tesseract, loaded
 * only when a bill is scanned; about 10 MB the first time, then from the browser's cache) finds the words, and they are
 * put into rows the way the app does it (BillOcr.kt): grouped by height with the slant taken out, joined left to
 * right, two spaces at a gap between columns ("Milk 1L  2  56.00  112.00"). The rows then go to the same reader as the
 * app (bill/receipt.js).
 *
 * A camera photo needs more help than the app's scanner gives it, so a read that does not match is tried again, each way
 * cleaning the photo up differently and looking at the page differently (one way may get right what another gets wrong;
 * parseReads combines them). See READ_WAYS.
 */
const VENDOR = '/vendor/tesseract';
/**
 * The ways, the likeliest first. look: stretch (grey, contrast stretched), sharpen (the same, edges crisper), threshold
 * (black on white, each part against its own surroundings: a shadow stays readable), faint (the same, keeping faint print).
 * layout: Tesseract's page segmentation (6 one block of rows, 4 one column of rows, 11 scattered text). digits: read again
 * for digits alone, and those are put in place of the numbers of the way before: words get in the way of misread digits.
 */
export const READ_WAYS = [
    { key: 'clean', look: 'stretch', side: 2400, layout: '6', note: 'Finding the items, the total and the tax…' },
    { key: 'sharp', look: 'threshold', side: 2400, layout: '6', note: 'It does not add up yet: reading it again, sharper…' },
    { key: 'digits', look: 'threshold', side: 2400, layout: '6', digits: true, note: 'Reading just the numbers…' },
    { key: 'large', look: 'threshold', side: 3400, short: 2200, layout: '6', note: 'Reading it larger, for small print…' },
    { key: 'crisp', look: 'sharpen', side: 3000, short: 1800, layout: '4', note: 'Reading it with crisper edges, row by row…' },
    { key: 'faint', look: 'faint', side: 2800, short: 1800, layout: '6', note: 'Reading the faint print…' },
    { key: 'sparse', look: 'stretch', side: 2400, layout: '11', note: 'Last try: reading it as scattered text…' },
];
const SHORT_SIDE_MIN = 1500;
/** Words Tesseract is this unsure of are specks and paper grain. */
const MIN_CONFIDENCE = 25;

let loading = null;

function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    loading ||= new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = `${VENDOR}/tesseract.min.js`;
        s.onload = () => resolve(window.Tesseract);
        s.onerror = () => { loading = null; reject(new Error('The bill reader could not be loaded. Check the connection and try again.')); };
        document.head.appendChild(s);
    });
    return loading;
}

/** A reader for one scan: read(file, way) gives the rows; end() frees its memory, which a phone wants back. */
export async function openReader(onProgress = () => {}) {
    if (typeof WebAssembly !== 'object') throw new Error('This browser cannot read bills here: type the items, or update the browser.');
    const Tesseract = await loadTesseract();
    const worker = await Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, {
        workerPath: `${VENDOR}/worker.min.js`, corePath: `${VENDOR}/tesseract-core-simd-lstm.wasm.js`, langPath: VENDOR, gzip: true,
        workerBlobURL: false,
        logger: m => { if (m.status === 'recognizing text') onProgress(m.progress); },
    });
    await worker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300' });
    // the last words read of each page, for the numbers of the digits read to go into
    const lastWords = new Map();
    const recognize = async (canvas, layout, whitelist) => {
        await worker.setParameters({ tessedit_pageseg_mode: layout, tessedit_char_whitelist: whitelist });
        const { data } = await worker.recognize(canvas, { rotateAuto: true }, { blocks: true, text: false });
        return wordsOf(data);
    };
    return {
        async read(file, way) {
            const canvas = await cleaned(file, way);
            if (way.digits) {
                const base = lastWords.get(file) || await recognize(canvas, way.layout, '');
                return rowsFromWords(withDigits(base, await recognize(canvas, way.layout, '0123456789.,')));
            }
            const read = await recognize(canvas, way.layout, '');
            lastWords.set(file, read);
            return rowsFromWords(read);
        },
        end: () => worker.terminate().catch(() => undefined),
    };
}

// ===================================================================== cleaning the photo

async function cleaned(file, way) {
    const bitmap = await createImageBitmap(file);   // upright, by the photo's EXIF
    const long = Math.max(bitmap.width, bitmap.height), short = Math.min(bitmap.width, bitmap.height);
    // down to what is worth reading; a small picture up, so that its small print has pixels to read
    const scale = Math.min(way.side / long, Math.max(1, (way.short || SHORT_SIDE_MIN) / short));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const grey = greyOf(image);
    if (way.look === 'stretch') stretch(grey);
    else if (way.look === 'sharpen') sharpen(stretch(grey), canvas.width, canvas.height);
    else localThreshold(grey, canvas.width, canvas.height, way.look === 'faint' ? 0.05 : 0.13);
    for (let i = 0, p = 0; i < grey.length; i++, p += 4) {
        image.data[p] = image.data[p + 1] = image.data[p + 2] = grey[i];
        image.data[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
}

function greyOf(image) {
    const d = image.data;
    const grey = new Uint8ClampedArray(d.length / 4);
    for (let i = 0, p = 0; i < grey.length; i++, p += 4) grey[i] = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
    return grey;
}

/** Darkest and lightest (bar the odd speck) become black and white. */
export function stretch(grey) {
    const counts = new Uint32Array(256);
    grey.forEach(v => { counts[v]++; });
    const cut = grey.length * 0.01;
    let low = 0, high = 255, seen = 0;
    while (low < 255 && (seen += counts[low]) < cut) low++;
    seen = 0;
    while (high > 0 && (seen += counts[high]) < cut) high--;
    if (high <= low) return grey;
    const k = 255 / (high - low);
    for (let i = 0; i < grey.length; i++) grey[i] = (grey[i] - low) * k;
    return grey;
}

/** Unsharp mask: each pixel pushed away from the mean of its neighbours, which brings up the point in 12.50. */
export function sharpen(grey, w, h, amount = 1.2) {
    const out = new Uint8ClampedArray(grey);
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            const near = (grey[i - 1] + grey[i + 1] + grey[i - w] + grey[i + w]) / 4;
            out[i] = grey[i] + (grey[i] - near) * amount;
        }
    }
    grey.set(out);
    return grey;
}

/** Each pixel against the mean of the square around it (Bradley's method): a shadow moves the mean with it. */
export function localThreshold(grey, w, h, darker = 0.13) {
    const r = Math.max(8, Math.round(Math.min(w, h) / 40));
    const sums = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
        let row = 0;
        for (let x = 0; x < w; x++) {
            row += grey[y * w + x];
            sums[(y + 1) * (w + 1) + x + 1] = sums[y * (w + 1) + x + 1] + row;
        }
    }
    const out = new Uint8ClampedArray(grey.length);
    for (let y = 0; y < h; y++) {
        const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
        for (let x = 0; x < w; x++) {
            const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
            const area = (x1 - x0) * (y1 - y0);
            const sum = sums[y1 * (w + 1) + x1] - sums[y0 * (w + 1) + x1] - sums[y1 * (w + 1) + x0] + sums[y0 * (w + 1) + x0];
            out[y * w + x] = grey[y * w + x] * area < sum * (1 - darker) ? 0 : 255;
        }
    }
    grey.set(out);
    return grey;
}

// ===================================================================== words into rows (as BillOcr.kt)

function wordsOf(data) {
    const words = [];
    const slopes = [];
    for (const block of data.blocks || []) {
        for (const para of block.paragraphs || []) {
            for (const line of para.lines || []) {
                const b = line.baseline;
                if (b && b.x1 - b.x0 >= 60) slopes.push((b.y1 - b.y0) / (b.x1 - b.x0));
                for (const w of line.words || []) {
                    const text = (w.text || '').trim();
                    if (text && w.confidence >= MIN_CONFIDENCE) words.push({ text, left: w.bbox.x0, right: w.bbox.x1, top: w.bbox.y0, bottom: w.bbox.y1 });
                }
            }
        }
    }
    slopes.sort((a, b) => a - b);
    return { words, slope: slopes.length < 3 ? 0 : Math.max(-0.25, Math.min(0.25, slopes[Math.floor(slopes.length / 2)])) };
}

/** The words of a read, its numbers replaced by what the digits read has in the same place. */
export function withDigits(base, digits) {
    const overlap = (a, b) => {
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        return w > 0 && h > 0 ? (w * h) / ((a.right - a.left) * (a.bottom - a.top) || 1) : 0;
    };
    const words = base.words.map(w => {
        if (!/\d/.test(w.text) || (w.text.match(/[a-z]/gi) || []).length > 1) return w;
        const hit = digits.words.filter(d => overlap(w, d) > 0.5).sort((a, b) => overlap(w, b) - overlap(w, a))[0];
        return hit && /\d/.test(hit.text) ? { ...w, text: hit.text } : w;
    });
    return { words, slope: base.slope };
}

/** The rows of one page, top to bottom. `slope`: how much the rows rise per pixel to the right. */
export function rowsFromWords({ words, slope = 0 }) {
    if (!words.length) return [];
    const pieces = words.map(w => ({ ...w, y: (w.top + w.bottom) / 2 - slope * ((w.left + w.right) / 2) }));
    const heights = pieces.map(p => p.bottom - p.top).sort((a, b) => a - b);
    const h = Math.max(8, heights[Math.floor(heights.length / 2)]);
    const rows = [];
    for (const p of pieces.sort((a, b) => a.y - b.y)) {
        const row = rows[rows.length - 1];
        if (row && Math.abs(p.y - row.reduce((s, x) => s + x.y, 0) / row.length) < h * 0.55) row.push(p);
        else rows.push([p]);
    }
    // a word gap is a space; a column gap is wider. Measured in letters, not in the text's height: on a bill's monospaced
    // print a single space is as wide as a letter, and that is nearly as wide as the text is tall
    const widths = pieces.filter(p => p.text.length >= 3).map(p => (p.right - p.left) / p.text.length).sort((a, b) => a - b);
    const letter = widths.length ? widths[Math.floor(widths.length / 2)] : h * 0.6;
    return rows.map(r => {
        const cells = r.sort((a, b) => a.left - b.left);
        return cells.reduce((text, c, i) => text + (i ? (c.left - cells[i - 1].right > letter * 1.7 ? '  ' : ' ') : '') + c.text, '');
    }).filter(r => r.trim());
}

// ===================================================================== pages of one bill (as RowMerger in BillOcr.kt)

const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function levenshtein(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
    }
    return prev[b.length];
}

/** How alike two readings of a row are, 0 to 1. */
export function similarity(a, b) {
    const x = norm(a), y = norm(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    if (Math.min(x.length, y.length) < 4) return 0;
    return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

/** Pages added to the rows so far; a page that starts with the last rows of the one before is joined where they meet. */
export function addPage(rows, page) {
    const p = page.filter(r => norm(r).length >= 2);
    if (!rows.length) return p;
    const tail = rows.slice(-3);
    let skip = 0;
    for (let t = 0; t < Math.min(15, p.length); t++) if (tail.some(r => similarity(p[t], r) >= 0.8)) skip = t + 1;
    return [...rows, ...p.slice(skip)];
}
