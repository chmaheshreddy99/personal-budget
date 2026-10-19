/**
 * Excel and PDF export for every section.
 *
 *   exportButton()                      the "Export" button with its Excel / PDF / CSV menu
 *   bindExport(host, getReport)         wires the button found in host; getReport() returns the report:
 *       { title, subtitle?, filename, sheets: [{ name, columns: [{ label, type? }], rows: [[...]], totals?: [...] }],
 *         summary?: [[label, value], ...] }
 *     column type: 'money' | 'number' | 'date' (yyyy-mm-dd) | 'percent' | text (default)
 *   exportReport(report, format)        the same without a button ('xlsx' | 'pdf' | 'csv')
 *
 * Excel: a real .xlsx (Office Open XML) written here, no library: one worksheet per sheet, a title,
 * a frozen bold header with filters, money as numbers with thousands separators, dates as Excel dates.
 * PDF: a clean A4 document opened in the browser's print dialog; choose "Save as PDF" there.
 */
import { icon } from './icons.js';
import { esc, toast, downloadCsv } from './ui.js';
import { money, date, dateTime } from './format.js';
import { state } from './store.js';

// ===================================================================== button

export function exportButton({ label = 'Export', cls = 'sm' } = {}) {
    return `<span class="export-menu" data-export>
        <button type="button" class="btn ${cls}" data-export-toggle title="Download as Excel or PDF">${icon('download')}${label ? `<span class="export-label">${label}</span>` : ''}</button>
        <span class="export-pop" hidden>
            <button type="button" data-export-as="xlsx">${icon('report')}<span><b>Excel</b><small>.xlsx workbook</small></span></button>
            <button type="button" data-export-as="pdf">${icon('printer')}<span><b>PDF / Print</b><small>A4, Save as PDF</small></span></button>
            <button type="button" data-export-as="csv">${icon('file-text')}<span><b>CSV</b><small>plain text</small></span></button>
        </span></span>`;
}

export function bindExport(host, getReport) {
    host.querySelectorAll('[data-export]').forEach(menu => {
        const pop = menu.querySelector('.export-pop');
        const toggle = menu.querySelector('[data-export-toggle]');
        toggle.addEventListener('click', e => {
            e.stopPropagation();
            // floats on the page so no panel or glass toolbar clips or covers it
            document.querySelectorAll('body > .export-pop').forEach(p => { if (p !== pop) p.remove(); });
            if (pop.parentElement !== document.body) document.body.appendChild(pop);
            pop.hidden = !pop.hidden;
            if (pop.hidden) return;
            const box = toggle.getBoundingClientRect();
            pop.style.top = `${Math.min(box.bottom + 4, window.innerHeight - pop.offsetHeight - 8)}px`;
            pop.style.left = `${Math.max(8, Math.min(box.right - pop.offsetWidth, window.innerWidth - pop.offsetWidth - 8))}px`;
        });
        pop.addEventListener('click', async e => {
            const b = e.target.closest('[data-export-as]');
            if (!b) return;
            pop.hidden = true;
            try {
                const report = await getReport();
                if (!report) return;
                exportReport(report, b.dataset.exportAs);
            } catch (error) { toast(error.message, 'error'); }
        });
    });
}
document.addEventListener('click', e => {
    if (!e.target.closest('[data-export], .export-pop')) document.querySelectorAll('.export-pop').forEach(p => { p.hidden = true; });
});
window.addEventListener('hashchange', () => document.querySelectorAll('body > .export-pop').forEach(p => p.remove()));

export function exportReport(report, format) {
    const sheets = report.sheets.filter(s => s.rows.length || s.always);
    if (!sheets.length) { toast('Nothing to export for this selection', 'info'); return; }
    const r = { ...report, sheets };
    if (format === 'xlsx') downloadXlsx(r);
    else if (format === 'pdf') printPdf(r);
    else {
        const s = sheets[0];
        downloadCsv(`${r.filename}.csv`, [s.columns.map(c => c.label), ...s.rows, ...(s.totals ? [s.totals] : [])]);
    }
}

// ===================================================================== Excel (.xlsx)

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const xml = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

/** Style ids in styles.xml below. */
const STYLE = { text: 0, header: 1, money: 2, date: 3, totalMoney: 4, title: 5, sub: 6, number: 7, percent: 8, totalText: 9 };

function colName(i) {
    let s = '';
    for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
}

function excelDate(iso) {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
}

function cell(ref, value, type, total = false) {
    if (value === null || value === undefined || value === '') return '';
    const num = Number(value);
    if ((type === 'money' || type === 'number' || type === 'percent') && value !== '' && Number.isFinite(num)) {
        const style = type === 'money' ? (total ? STYLE.totalMoney : STYLE.money) : type === 'percent' ? STYLE.percent : STYLE.number;
        return `<c r="${ref}" s="${style}"><v>${type === 'percent' ? num / 100 : num}</v></c>`;
    }
    if (type === 'date' && /^\d{4}-\d{2}-\d{2}/.test(String(value))) return `<c r="${ref}" s="${STYLE.date}"><v>${excelDate(String(value))}</v></c>`;
    return `<c r="${ref}" t="inlineStr" s="${total ? STYLE.totalText : STYLE.text}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function sheetXml(sheet, report) {
    const cols = sheet.columns;
    const rows = [];
    const textRow = (n, text, style) => `<row r="${n}"><c r="A${n}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(text)}</t></is></c></row>`;
    rows.push(textRow(1, report.title, STYLE.title));
    rows.push(textRow(2, [report.subtitle, `Generated ${dateTime(new Date().toISOString())}`].filter(Boolean).join(' · '), STYLE.sub));
    let n = 3;
    (report.summary && sheet === report.sheets[0] ? report.summary : []).forEach(([label, value, type]) => {
        n++;
        rows.push(`<row r="${n}">${cell(`A${n}`, label, 'text')}${cell(`B${n}`, value, type || (typeof value === 'number' ? 'money' : 'text'))}</row>`);
    });
    if (n > 3) n++;
    const headerRow = ++n;
    rows.push(`<row r="${headerRow}">${cols.map((c, i) => `<c r="${colName(i)}${headerRow}" t="inlineStr" s="${STYLE.header}"><is><t>${xml(c.label)}</t></is></c>`).join('')}</row>`);
    sheet.rows.forEach(r => {
        n++;
        rows.push(`<row r="${n}">${cols.map((c, i) => cell(`${colName(i)}${n}`, r[i], c.type)).join('')}</row>`);
    });
    const lastData = n;
    if (sheet.totals) {
        n++;
        rows.push(`<row r="${n}">${cols.map((c, i) => cell(`${colName(i)}${n}`, sheet.totals[i], c.type, true)).join('')}</row>`);
    }
    // width from the longest value in each column (capped)
    const widths = cols.map((c, i) => {
        const longest = Math.max(c.label.length, ...sheet.rows.slice(0, 500).map(r => {
            const v = r[i];
            if (c.type === 'money') return money(v).length + 1;
            if (c.type === 'date') return 11;
            return String(v ?? '').length;
        }));
        return Math.min(60, Math.max(8, longest + 2));
    });
    const lastCol = colName(cols.length - 1);
    return XML_HEAD + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rows.join('')}</sheetData>
${sheet.rows.length ? `<autoFilter ref="A${headerRow}:${lastCol}${lastData}"/>` : ''}
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup orientation="${cols.length > 6 ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

const STYLES_XML = XML_HEAD + `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00;[Red]-#,##0.00"/><numFmt numFmtId="165" formatCode="dd-mmm-yyyy"/><numFmt numFmtId="166" formatCode="0.0%"/></numFmts>
<fonts count="5"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF16405F"/><name val="Calibri"/></font><font><i/><sz val="9"/><color rgb="FF5B7083"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1D5C87"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7EFF6"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border/><border><top style="thin"><color rgb="FF8FA9BF"/></top></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetName(name, used) {
    let base = String(name || 'Sheet').replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31).trim() || 'Sheet';
    let candidate = base, i = 2;
    while (used.has(candidate.toLowerCase())) candidate = `${base.slice(0, 28)} ${i++}`;
    used.add(candidate.toLowerCase());
    return candidate;
}

function downloadXlsx(report) {
    const used = new Set();
    const names = report.sheets.map(s => sheetName(s.name, used));
    const files = [
        ['[Content_Types].xml', XML_HEAD + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
        ['_rels/.rels', XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`],
        ['docProps/core.xml', XML_HEAD + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${xml(report.title)}</dc:title><dc:creator>${xml(state.user?.fullName || 'Personal Budget')}</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`],
        ['xl/workbook.xml', XML_HEAD + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
        ['xl/_rels/workbook.xml.rels', XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
        ['xl/styles.xml', STYLES_XML],
        ...report.sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s, report)]),
    ];
    const blob = new Blob([zip(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${report.filename}.xlsx`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1500);
}

// ---- a minimal zip writer (stored, no compression): all an .xlsx needs

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function zip(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const [name, text] of files) {
        const nameBytes = enc.encode(name), data = enc.encode(text), crc = crc32(data);
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
        local.setUint16(8, 0, true); local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true);
        local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
        local.setUint16(26, nameBytes.length, true); local.setUint16(28, 0, true);
        parts.push(new Uint8Array(local.buffer), nameBytes, data);
        const dir = new DataView(new ArrayBuffer(46));
        dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true); dir.setUint16(8, 0x0800, true);
        dir.setUint16(10, 0, true); dir.setUint16(12, dosTime, true); dir.setUint16(14, dosDate, true);
        dir.setUint32(16, crc, true); dir.setUint32(20, data.length, true); dir.setUint32(24, data.length, true);
        dir.setUint16(28, nameBytes.length, true); dir.setUint32(42, offset, true);
        central.push(new Uint8Array(dir.buffer), nameBytes);
        offset += 30 + nameBytes.length + data.length;
    }
    const centralSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)]);
}

// ===================================================================== PDF (print)

function pdfValue(v, type) {
    if (v === null || v === undefined || v === '') return '';
    if (type === 'money') return money(v);
    if (type === 'date') return date(String(v));
    if (type === 'percent') return `${Number(v).toFixed(1).replace(/\.0$/, '')}%`;
    return esc(v);
}

function printPdf(report) {
    const win = window.open('', '_blank');
    if (!win) { toast('Allow pop-ups to export a PDF', 'error'); return; }
    const right = t => t === 'money' || t === 'number' || t === 'percent';
    const sheetHtml = s => `
        ${report.sheets.length > 1 ? `<h2>${esc(s.name)}</h2>` : ''}
        ${s.intro ? `<p class="intro">${esc(s.intro)}</p>` : ''}
        <table><thead><tr>${s.columns.map(c => `<th class="${right(c.type) ? 'r' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
        <tbody>${s.rows.map(r => `<tr>${s.columns.map((c, i) => `<td class="${right(c.type) ? 'r' : ''}">${pdfValue(r[i], c.type)}</td>`).join('')}</tr>`).join('')}</tbody>
        ${s.totals ? `<tfoot><tr>${s.columns.map((c, i) => `<td class="${right(c.type) ? 'r' : ''}">${pdfValue(s.totals[i], c.type)}</td>`).join('')}</tr></tfoot>` : ''}
        </table>`;
    const wide = report.sheets.some(s => s.columns.length > 6);
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(report.filename)}</title>
    <style>
        @page { size: A4 ${wide ? 'landscape' : 'portrait'}; margin: 14mm 12mm; }
        * { box-sizing: border-box; }
        body { font: 10.5px/1.45 "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif; color: #12283a; margin: 0; padding: 18px; }
        header { display: flex; align-items: flex-end; justify-content: space-between; border-bottom: 2px solid #1d5c87; padding-bottom: 8px; margin-bottom: 12px; }
        h1 { font-size: 18px; margin: 0; color: #16405f; }
        h2 { font-size: 13px; margin: 18px 0 6px; color: #16405f; page-break-after: avoid; }
        .sub { color: #5b7083; font-size: 10px; margin-top: 2px; }
        .brand { text-align: right; color: #5b7083; font-size: 9.5px; }
        .brand b { color: #1d5c87; font-size: 11px; display: block; }
        .summary { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; margin: 0 0 12px; }
        .summary div { border: 1px solid #d5e1eb; border-radius: 6px; padding: 6px 8px; background: #f4f8fb; }
        .summary span { display: block; color: #5b7083; font-size: 9px; text-transform: uppercase; letter-spacing: .03em; }
        .summary b { font-size: 12px; }
        .intro { color: #3d556a; margin: 0 0 6px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
        thead { display: table-header-group; }
        th { background: #1d5c87; color: #fff; text-align: left; font-weight: 600; padding: 5px 6px; font-size: 9.5px; }
        td { padding: 4px 6px; border-bottom: 1px solid #e3ebf2; vertical-align: top; }
        tbody tr:nth-child(even) td { background: #f7fafc; }
        tr { page-break-inside: avoid; }
        tfoot td { font-weight: 700; background: #e7eff6; border-top: 1.5px solid #8fa9bf; }
        .r { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
        footer { margin-top: 14px; color: #8296a8; font-size: 9px; text-align: center; }
        .hint { background: #fff8e1; border: 1px solid #f1d98a; padding: 8px 10px; border-radius: 6px; margin-bottom: 12px; font-size: 11px; }
        @media print { .hint { display: none; } body { padding: 0; } }
    </style></head><body>
    <div class="hint">Choose <b>Save as PDF</b> as the printer to keep a PDF copy.</div>
    <header><div><h1>${esc(report.title)}</h1><div class="sub">${esc(report.subtitle || '')}</div></div>
        <div class="brand"><b>Personal Budget</b>${esc(state.user?.fullName || '')}<br>Generated ${esc(dateTime(new Date().toISOString()))}</div></header>
    ${report.summary?.length ? `<div class="summary">${report.summary.map(([l, v, t]) =>
        `<div><span>${esc(l)}</span><b>${typeof v === 'number' || t === 'money' ? (t === 'number' ? esc(v) : t === 'percent' ? pdfValue(v, 'percent') : money(v)) : esc(v)}</b></div>`).join('')}</div>` : ''}
    ${report.html || ''}
    ${report.sheets.map(sheetHtml).join('')}
    <footer>${esc(report.title)} · ${report.sheets.reduce((s, x) => s + x.rows.length, 0)} rows</footer>
    </body></html>`);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 350);
}
