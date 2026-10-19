/**
 * Minimal QR code encoder (byte mode, error correction level M) rendered as SVG.
 * Follows ISO/IEC 18004: data codewords, Reed-Solomon blocks, function patterns,
 * and the mask with the lowest penalty. Enough for UPI payment links.
 */

// Error correction codewords per block and number of blocks for level M, by version (index 0 unused)
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const ECC_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29,
    31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
const FORMAT_BITS_M = 0;

const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
    (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
    (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
];

function rawDataModules(ver) {
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
        const numAlign = Math.floor(ver / 7) + 2;
        result -= (25 * numAlign - 10) * numAlign - 55;
        if (ver >= 7) result -= 36;
    }
    return result;
}

const dataCodewords = ver => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ver] * ECC_BLOCKS[ver];

function gfMultiply(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
        z = (z << 1) ^ ((z >>> 7) * 0x11d);
        z ^= ((y >>> i) & 1) * x;
    }
    return z;
}

function rsDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
        for (let j = 0; j < degree; j++) {
            result[j] = gfMultiply(result[j], root);
            if (j + 1 < degree) result[j] ^= result[j + 1];
        }
        root = gfMultiply(root, 0x02);
    }
    return result;
}

function rsRemainder(data, divisor) {
    const result = divisor.map(() => 0);
    for (const b of data) {
        const factor = b ^ result.shift();
        result.push(0);
        divisor.forEach((coef, i) => { result[i] ^= gfMultiply(coef, factor); });
    }
    return result;
}

function alignmentPositions(ver) {
    if (ver === 1) return [];
    const numAlign = Math.floor(ver / 7) + 2;
    const step = Math.floor((ver * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
    const result = [6];
    for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
}

/** Codewords (data + error correction), interleaved, for the text in the smallest version that fits. */
function encodeCodewords(bytes) {
    let ver = 1;
    while (ver <= 40 && 4 + (ver < 10 ? 8 : 16) + bytes.length * 8 > dataCodewords(ver) * 8) ver++;
    if (ver > 40) throw new Error('Text is too long for a QR code');

    const bits = [];
    const push = (value, length) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
    push(4, 4);                                       // byte mode
    push(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(b => push(b, 8));
    const capacity = dataCodewords(ver) * 8;
    push(0, Math.min(4, capacity - bits.length));     // terminator
    push(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);

    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((b, bit) => (b << 1) | bit, 0));

    const numBlocks = ECC_BLOCKS[ver];
    const eccLen = ECC_PER_BLOCK[ver];
    const raw = Math.floor(rawDataModules(ver) / 8);
    const numShort = numBlocks - (raw % numBlocks);
    const shortLen = Math.floor(raw / numBlocks);
    const divisor = rsDivisor(eccLen);
    const blocks = [];
    for (let i = 0, k = 0; i < numBlocks; i++) {
        const block = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
        k += block.length;
        const ecc = rsRemainder(block, divisor);
        if (i < numShort) block.push(0);
        blocks.push(block.concat(ecc));
    }
    const result = [];
    for (let i = 0; i < blocks[0].length; i++) {
        blocks.forEach((block, j) => { if (i !== shortLen - eccLen || j >= numShort) result.push(block[i]); });
    }
    return { ver, codewords: result };
}

/** Penalty score used to pick the mask (rules 1, 2 and 4 of the standard). */
function penalty(modules) {
    const size = modules.length;
    let score = 0;
    const runs = line => {
        let run = 1;
        for (let i = 1; i <= line.length; i++) {
            if (i < line.length && line[i] === line[i - 1]) run++;
            else { if (run >= 5) score += run - 2; run = 1; }
        }
    };
    for (let y = 0; y < size; y++) runs(modules[y]);
    for (let x = 0; x < size; x++) runs(modules.map(row => row[x]));
    let dark = 0;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (modules[y][x]) dark++;
            if (x < size - 1 && y < size - 1) {
                const c = modules[y][x];
                if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
            }
        }
    }
    const total = size * size;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
}

/** Boolean matrix (true = dark) for the text. */
export function qrMatrix(text) {
    const { ver, codewords } = encodeCodewords(new TextEncoder().encode(text));
    const size = ver * 4 + 17;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => { modules[y][x] = dark; isFunction[y][x] = true; };

    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
        for (let dy = -4; dy <= 4; dy++) {
            for (let dx = -4; dx <= 4; dx++) {
                const x = cx + dx, y = cy + dy;
                const d = Math.max(Math.abs(dx), Math.abs(dy));
                if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
            }
        }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

    const align = alignmentPositions(ver);
    const n = align.length;
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) set(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
            }
        }
    }

    const drawFormat = mask => {
        const data = (FORMAT_BITS_M << 3) | mask;
        let rem = data;
        for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        const bits = ((data << 10) | rem) ^ 0x5412;
        const bit = i => ((bits >>> i) & 1) === 1;
        for (let i = 0; i <= 5; i++) set(8, i, bit(i));
        set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
        for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
        for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
        for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
        set(8, size - 8, true);
    };
    drawFormat(0);   // reserves the format areas

    if (ver >= 7) {
        let rem = ver;
        for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
        const bits = (ver << 12) | rem;
        for (let i = 0; i < 18; i++) {
            const dark = ((bits >>> i) & 1) === 1;
            const a = size - 11 + (i % 3), b = Math.floor(i / 3);
            set(a, b, dark); set(b, a, dark);
        }
    }

    let bitIndex = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let vert = 0; vert < size; vert++) {
            for (let j = 0; j < 2; j++) {
                const x = right - j;
                const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
                if (!isFunction[y][x] && bitIndex < codewords.length * 8) {
                    modules[y][x] = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) === 1;
                    bitIndex++;
                }
            }
        }
    }

    const applyMask = mask => {
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) if (!isFunction[y][x] && MASKS[mask](x, y)) modules[y][x] = !modules[y][x];
        }
    };
    let best = 0, bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
        applyMask(mask);
        drawFormat(mask);
        const score = penalty(modules);
        if (score < bestScore) { best = mask; bestScore = score; }
        applyMask(mask);   // XOR again to undo
    }
    applyMask(best);
    drawFormat(best);
    return modules;
}

/** QR code as an inline SVG string with a 4-module quiet zone. */
export function qrSvg(text, { size = 180, dark = '#0a2e4f', light = '#ffffff' } = {}) {
    const modules = qrMatrix(text);
    const n = modules.length + 8;
    let path = '';
    modules.forEach((row, y) => row.forEach((on, x) => { if (on) path += `M${x + 4} ${y + 4}h1v1h-1z`; }));
    return `<svg class="qr" viewBox="0 0 ${n} ${n}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="QR code">
        <rect width="${n}" height="${n}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}
