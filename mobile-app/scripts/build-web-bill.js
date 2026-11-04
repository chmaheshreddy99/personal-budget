/**
 * The mobile web version scans bills with the same reader as the app: its copy of src/receipt.ts (and what it needs) is
 * generated from here, so a change to how bills are read reaches both. After changing receipt.ts:
 *     npm run web:bill
 * With --check it only says whether the copy is up to date (a test runs that).
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const SRC = path.join(__dirname, '..', 'src');
const OUT = path.join(__dirname, '..', '..', 'src', 'main', 'resources', 'static', 'js', 'mobile', 'bill');
const BANNER = '// GENERATED from mobile-app/src by mobile-app/scripts/build-web-bill.js: do not edit (npm run web:bill).\n';

const js = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.ESNext, removeComments: false } }).outputText;
const localImports = code => code.replace(/from '\.\/(\w+)'/g, "from './$1.js'");
const read = file => fs.readFileSync(path.join(SRC, file), 'utf8');

/** data.ts is the app's whole model: of it the reader only needs this. */
function dataShim() {
  const line = read('data.ts').split(/\r?\n/).find(l => l.startsWith('export const isExpense'));
  if (!line) throw new Error('isExpense is no longer in data.ts');
  return js(line.replace(/\(c: Category\)/, '(c)'));
}

function outputs() {
  return {
    'receipt.js': BANNER + localImports(js(read('receipt.ts'))),
    'sms.js': BANNER + localImports(js(read('sms.ts'))),
    'format.js': BANNER + js(read('format.ts')),
    'data.js': BANNER + dataShim(),
  };
}

function stale() {
  return Object.entries(outputs()).filter(([name, text]) => {
    const file = path.join(OUT, name);
    return !fs.existsSync(file) || fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== text.replace(/\r\n/g, '\n');
  }).map(([name]) => name);
}

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const old = stale();
    console.log(old.length ? `Out of date: ${old.join(', ')} (npm run web:bill)` : 'Up to date');
    process.exit(old.length ? 1 : 0);
  }
  fs.mkdirSync(OUT, { recursive: true });
  Object.entries(outputs()).forEach(([name, text]) => fs.writeFileSync(path.join(OUT, name), text));
  console.log(`Wrote ${Object.keys(outputs()).length} files to ${OUT}`);
}

module.exports = { stale };
