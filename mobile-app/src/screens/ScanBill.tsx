/**
 * Scan a bill: the phone reads it and suggests the expense, the person checks it and posts it.
 *   start    optionally, what the bill comes to and how many items it has (the read is fitted and checked against them, or
 *            against what the bill prints; a read that does not match is tried again on the cleaned-up photo, twice at most);
 *            then how to read it: Scan bill (the document scanner: pages, edges found, straightened, or pictures from the
 *            gallery), Long bill (read like a video while the camera moves down it), From a photo, or Type the items
 *   review   the shop, the day, the account it was paid from and the reference; the bill total, with whether the items
 *            add up to it (and the tax, charges and discounts that count); a check against the total and the number of
 *            items given before scanning, what was corrected to match, with the items set aside to put back; the items,
 *            each with its name, quantity × rate, amount (with what was read, to undo a correction) and a suggested
 *            category (all can be changed, removed or added to); what the phone read, to
 *            add a row it missed. Post as one transaction with a line per item (or per category), or as one expense.
 * The bill's photos stay as the expense's evidence. Categories chosen are remembered for the next bill (receipt.ts).
 * An itemized expense still waiting on the phone opens here to be changed.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronUp, FileImage, Keyboard, Layers, Minus, Plus, RotateCcw, ScanLine, Search, Sparkles, Trash2, X } from 'lucide-react-native';
import { useApp } from '../state';
import { Account, Category, LocalExpense, isExpense } from '../data';
import { isoDate, money } from '../format';
import { AccountBubble, Button, Field, IconBubble, categoryLook } from '../ui';
import { colors, radius, space } from '../theme';
import { EvidenceStrip } from '../evidence';
import { PickedFile, nativeFiles, nativeScan, nativeStore } from '../native';
import { BillLine, BillMemory, ParsedBill, betterFit, billSum, cleanItemName, countMatches, hasStrayNumber, itemsToPost, learn, lineId, parseBill, shopKey, suggestCategory } from '../receipt';

type Stage = 'start' | 'reading' | 'review';
type How = 'document' | 'live' | 'photo' | 'manual';
const TYPE_ORDER = ['BANK', 'CREDIT_CARD', 'CASH', 'WALLET', 'PAYABLE'];
const MEMORY_KEY = 'billMemory';
const num = (t: string) => Number(String(t).replace(/[,₹\s]/g, '')) || 0;
const round2 = (v: number) => Math.round(v * 100) / 100;
/** The photo is read again, cleaned up, at most this many ways when a read does not match. */
const READ_AGAIN: ('contrast' | 'large')[] = ['contrast', 'large'];
const READING = 'Finding the items, the total and the tax.';

export function ScanBill({ visible, onClose, editing }: { visible: boolean; onClose: () => void; editing?: LocalExpense }) {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const cats = useMemo(() => (app.snapshot?.categories || []).filter(isExpense).sort((a, b) => (b.uses || 0) - (a.uses || 0) || a.name.localeCompare(b.name)), [app.snapshot]);
  const accounts = useMemo(() => (app.snapshot?.accounts || [])
    .filter(a => a.payFrom && (app.accounts.includes(a) || a.id === editing?.paidFromId))
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || (b.lastActivity || '').localeCompare(a.lastActivity || '')), [app.snapshot, app.accounts, editing]);
  const catName = (id: number | null) => cats.find(c => c.id === id)?.name || '';

  const [stage, setStage] = useState<Stage>('start');
  const [bill, setBill] = useState<ParsedBill | null>(null);
  const [lines, setLines] = useState<BillLine[]>([]);
  const [merchant, setMerchant] = useState('');
  const [day, setDay] = useState(isoDate());
  const [reference, setReference] = useState('');
  const [totalText, setTotalText] = useState('');
  const [account, setAccount] = useState<number | null>(null);
  const [images, setImages] = useState<PickedFile[]>([]);
  const [asItems, setAsItems] = useState(true);
  const [oneCategory, setOneCategory] = useState<number | null>(null);
  const [combine, setCombine] = useState(false);
  const [showRows, setShowRows] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);   // a line's id, 'ONE' or 'ALL'
  const [memory, setMemory] = useState<BillMemory>({ items: {}, shops: {} });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // what the person says before scanning: the bill's total and how many items it has (both optional)
  const [expectTotal, setExpectTotal] = useState('');
  const [expectCount, setExpectCount] = useState(0);
  const [readingNote, setReadingNote] = useState(READING);

  useEffect(() => {
    if (!visible) return;
    setError(''); setBusy(false); setShowRows(false); setPicking(null); setCombine(false);
    nativeStore.get(MEMORY_KEY).then(t => { if (t) { try { setMemory(JSON.parse(t)); } catch { /* start afresh */ } } }).catch(() => undefined);
    if (editing) {
      const items: BillLine[] = (editing.items || []).map(i => ({ id: lineId(), kind: 'ITEM', name: i.name, qty: null, rate: null, amount: i.amount, categoryId: i.categoryId, counted: true }));
      setBill(null); setLines(items); setMerchant(editing.party || ''); setDay(editing.date); setReference(editing.reference || '');
      setTotalText(String(editing.amount)); setAccount(editing.paidFromId); setImages([]); setAsItems(items.length > 1);
      setOneCategory(editing.categoryId); setStage('review');
    } else {
      setStage('start'); setBill(null); setLines([]); setMerchant(''); setDay(isoDate()); setReference(''); setTotalText(''); setImages([]);
      setAccount(null); setAsItems(true); setOneCategory(null); setExpectTotal(''); setExpectCount(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  /** The account a bill was paid from: what this shop was paid from before, else by how it was paid, else the last used. */
  const guessAccount = (b: ParsedBill): number | null => {
    const remembered = memory.shops[shopKey(b.merchant)]?.accountId;
    if (remembered && accounts.some(a => a.id === remembered)) return remembered;
    const want = b.payment === 'CASH' ? ['CASH', 'WALLET'] : b.payment === 'CARD' ? ['CREDIT_CARD', 'BANK'] : b.payment === 'UPI' ? ['BANK'] : [];
    const byType = want.map(t => accounts.find(a => a.type === t)).find(Boolean);
    if (byType) return byType.id;
    const last = app.queue[0]?.paidFromId;
    return accounts.some(a => a.id === last) ? last! : accounts[0]?.id ?? null;
  };

  const apply = (b: ParsedBill, imgs: PickedFile[], manual = false) => {
    const withCats = b.lines.map(l => (l.kind === 'ITEM' ? { ...l, categoryId: suggestCategory(l.name, b.merchant, cats, memory, b.kind) } : l));
    // typed by hand with a count given: that many rows to fill in
    const blanks = manual ? Math.max(1, expectCount) : withCats.some(l => l.kind === 'ITEM') ? 0 : 1;
    for (let i = 0; i < blanks; i++) withCats.push({ id: lineId(), kind: 'ITEM', name: '', qty: null, rate: null, amount: 0, categoryId: null, counted: true });
    const items = withCats.filter(l => l.kind === 'ITEM');
    const counts = new Map<number, number>();
    items.forEach(l => { if (l.categoryId) counts.set(l.categoryId, (counts.get(l.categoryId) || 0) + l.amount); });
    setBill(b);
    setLines(withCats);
    setMerchant(b.merchant);
    setDay(b.date || isoDate());
    setReference(b.reference || '');
    setTotalText(num(expectTotal) ? String(num(expectTotal)) : b.total ? String(b.total) : '');
    setAccount(guessAccount(b));
    setImages(imgs);
    setAsItems(manual || items.length > 1);
    setOneCategory([...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null);
    setStage('review');
  };

  const start = async (h: How) => {
    setError('');
    if (h === 'manual') { apply({ merchant: '', date: null, reference: null, payment: null, total: null, lines: [], rows: [], kind: 'SHOP' }, [], true); return; }
    try {
      let rows: string[] = [];
      let imgs: PickedFile[] = [];
      if (h === 'photo') {
        const f = await nativeFiles.pick('files');
        if (!f) return;
        if (f.type === 'application/pdf') { nativeFiles.remove(f.path); throw new Error('Pick a photo of the bill: a PDF cannot be read here'); }
        setStage('reading');
        rows = await nativeScan.read([f.path]);
        imgs = [f];
      } else {
        const r = await nativeScan.scan(h === 'live' ? 'live' : 'document');
        if (!r) return;
        setStage('reading');
        rows = r.rows;
        imgs = r.images;
      }
      const expect = { total: num(expectTotal) || null, count: expectCount || null };
      let b = parseBill(rows, expect);
      // it does not match: another look at the same photo, cleaned up, before asking the person to fix it
      if (b.fit && !b.fit.matched && imgs.length) {
        for (const pass of READ_AGAIN) {
          setReadingNote(pass === 'contrast' ? 'It does not add up yet: reading it again with more contrast.' : 'Still not adding up: reading it once more, larger.');
          const again = await nativeScan.readEnhanced(imgs.map(f => f.path), pass).catch(() => [] as string[]);
          if (again.length) b = betterFit(b, parseBill(again, expect));
          if (b.fit?.matched) break;
        }
        setReadingNote(READING);
      }
      apply(b, imgs);
      if (!rows.length) setError('Nothing could be read from it. Try again in better light with the bill flat, or type the items below.');
    } catch (e: any) {
      setStage('start');
      setError(e?.message || 'The bill could not be read');
    }
  };

  // ------------------------------------------------------------------------------------------- the sums
  const items = lines.filter(l => l.kind === 'ITEM' && !l.held);
  const held = lines.filter(l => l.kind === 'ITEM' && l.held);
  const adjustments = lines.filter(l => l.kind !== 'ITEM');
  const itemSum = round2(items.reduce((s, l) => s + (l.amount || 0), 0));
  const sum = billSum(lines);
  const total = num(totalText) || sum;
  const diff = round2(total - sum);
  const missing = items.filter(l => l.amount > 0 && !l.categoryId).length;
  const payer = accounts.find(a => a.id === account);
  // the check against what was said before scanning
  const filled = items.filter(l => l.amount > 0).length;
  const wantTotal = num(expectTotal);
  const strays = items.filter(l => l.name && hasStrayNumber(l.name)).length;
  const blanksLeft = items.filter(l => !l.name.trim() || !(l.amount > 0)).length;
  const checking = !!wantTotal || !!expectCount;
  const countOk = !!expectCount && countMatches(lines, expectCount);
  const fit = bill?.fit;
  // the total only came from the items: nothing has checked them
  const noTotalRead = !!bill?.rows.length && !wantTotal && !fit?.totalOk;

  const setLine = (id: string, patch: Partial<BillLine>) => setLines(ls => ls.map(l => (l.id === id ? { ...l, ...patch } : l)));
  const removeLine = (id: string) => setLines(ls => ls.filter(l => l.id !== id));
  const addItem = (name = '', amount = 0) => setLines(ls => [...ls.filter(l => l.kind === 'ITEM'), { id: lineId(), kind: 'ITEM', name, qty: null, rate: null, amount,
    categoryId: name ? suggestCategory(name, merchant, cats, memory, bill?.kind) : null, counted: true }, ...ls.filter(l => l.kind !== 'ITEM')]);
  const addRow = (row: string) => {
    const m = row.match(/(\d[\d,]*(?:\.\d{1,2})?)\s*$/);
    addItem(cleanItemName(row.replace(/(\d[\d,]*(?:\.\d{1,2})?)\s*$/, '')), m ? num(m[1]) : 0);
  };
  const choose = (id: number) => {
    if (picking === 'ONE') setOneCategory(id);
    else if (picking === 'ALL') setLines(ls => ls.map(l => (l.kind === 'ITEM' && !l.categoryId ? { ...l, categoryId: id } : l)));
    else if (picking) setLine(picking, { categoryId: id });
    setPicking(null);
  };

  // ------------------------------------------------------------------------------------------- posting
  const post = async () => {
    setError('');
    if (!payer) { setError('Choose the account it was paid from'); return; }
    if (!(total > 0)) { setError('Enter the bill total'); return; }
    let expense: Omit<LocalExpense, 'clientId' | 'createdAt' | 'status'>;
    const base = { date: day, amount: round2(total), paidFromId: payer.id, paidFromName: payer.name, party: merchant.trim(),
      narration: merchant.trim() ? `${merchant.trim()} bill` : 'Bill', reference: reference.trim(), notes: '', items: undefined as any };
    if (asItems) {
      if (missing) { setError(`Choose a category for ${missing === 1 ? 'the item' : `the ${missing} items`} without one (or post it as one expense)`); return; }
      const posted = itemsToPost(lines, total, id => catName(id), combine);
      if (!posted.length) { setError('Add the items, each with its amount'); return; }
      const top = [...posted].sort((a, b) => b.amount - a.amount)[0];
      expense = posted.length > 1
        ? { ...base, categoryId: top.categoryId, categoryName: `${top.categoryName} +${posted.length - 1}`, items: posted }
        : { ...base, categoryId: posted[0].categoryId, categoryName: posted[0].categoryName };
    } else {
      if (!oneCategory) { setError('Choose the category'); return; }
      expense = { ...base, categoryId: oneCategory, categoryName: catName(oneCategory) };
    }
    setBusy(true);
    try {
      if (editing) await app.updateExpense(editing.clientId, expense);
      else await app.addExpense(expense, images);
      const learned = learn(memory, merchant, items.filter(l => l.categoryId && l.name).map(l => ({ name: l.name, categoryId: l.categoryId!, amount: l.amount })), payer.id);
      nativeStore.set(MEMORY_KEY, JSON.stringify(learned)).catch(() => undefined);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not save it');
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    // photos taken for a bill that is not posted are not kept
    if (!editing && stage === 'review' && !busy) images.forEach(f => nativeFiles.remove(f.path));
    onClose();
  };

  // ------------------------------------------------------------------------------------------- drawing
  const option = (h: How, Icon: any, title: string, text: string, tone: { fg: string; bg: string }, hint?: string) => (
    <Pressable key={h} onPress={() => start(h)} style={({ pressed }) => [st.option, pressed && { opacity: 0.85 }]}>
      <IconBubble Icon={Icon} fg={tone.fg} bg={tone.bg} size={46} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={st.optionTitle}>{title}</Text>
        <Text style={st.optionText}>{text}</Text>
        {hint ? <Text style={st.optionHint}>{hint}</Text> : null}
      </View>
    </Pressable>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={[st.page, { paddingTop: insets.top }]}>
        <View style={st.head}>
          <Pressable onPress={stage === 'review' && !editing ? () => setStage('start') : close} hitSlop={10} style={st.headBtn}>
            {stage === 'review' && !editing ? <ChevronLeft color={colors.text} size={24} /> : <X color={colors.text} size={22} />}
          </Pressable>
          <Text style={st.title}>{editing ? 'Change the bill' : stage === 'review' ? 'Check and post' : 'Scan a bill'}</Text>
          {stage === 'review' ? <Pressable onPress={close} hitSlop={10} style={st.headBtn}><X color={colors.muted} size={20} /></Pressable> : <View style={st.headBtn} />}
        </View>

        {stage === 'start' ? (
          <ScrollView contentContainerStyle={st.body}>
            <View style={st.hero}>
              <Sparkles color={colors.white} size={20} />
              <Text style={st.heroText}>The phone reads the bill, suggests the items with their categories and the total, and you check them before posting. Nothing leaves the phone to read it.</Text>
            </View>
            {/* optional: what the bill comes to and how many items, to check the read against */}
            <View style={st.expect}>
              <Text style={st.label}>Before you scan · optional</Text>
              <View style={st.expectRow}>
                <View style={st.expectBox}>
                  <Text style={st.expectLabel}>Bill total</Text>
                  <View style={st.totalRow}>
                    <Text style={st.expectRupee}>₹</Text>
                    <TextInput value={expectTotal} onChangeText={t => setExpectTotal(t.replace(/[^0-9.,]/g, ''))} placeholder="0" placeholderTextColor={colors.muted}
                      keyboardType="decimal-pad" style={st.expectInput} maxLength={12} />
                  </View>
                </View>
                <View style={st.expectBox}>
                  <Text style={st.expectLabel}>Items on it</Text>
                  <View style={st.stepper}>
                    <Pressable onPress={() => setExpectCount(c => Math.max(0, c - 1))} hitSlop={8} style={st.stepBtn}><Minus color={colors.text2} size={16} /></Pressable>
                    <TextInput value={expectCount ? String(expectCount) : ''} onChangeText={t => setExpectCount(Math.min(99, Number(t.replace(/\D/g, '')) || 0))}
                      placeholder="–" placeholderTextColor={colors.muted} keyboardType="number-pad" style={st.stepInput} maxLength={2} />
                    <Pressable onPress={() => setExpectCount(c => Math.min(99, c + 1))} hitSlop={8} style={st.stepBtn}><Plus color={colors.text2} size={16} /></Pressable>
                  </View>
                </View>
              </View>
              <Text style={st.hint}>The read is matched to these: another column of numbers, a decimal point missed, a digit misread or a row read twice are tried until it comes right, and each change is shown to undo. Typing the items? This many rows are ready to fill in.</Text>
            </View>
            {nativeScan.available ? option('document', ScanLine, 'Scan bill', 'Finds the edges and straightens it. Several pages, or pictures from the gallery.', { fg: colors.ocean, bg: colors.oceanSoft }, 'Best for most bills') : null}
            {nativeScan.available ? option('live', Layers, 'Long bill', 'Reads it like a video: start at the top and move the phone slowly down to the total.', { fg: colors.violet, bg: colors.violetSoft }, 'For supermarket rolls longer than the screen') : null}
            {nativeScan.available ? option('photo', FileImage, 'From a photo', 'A photo of the bill already on the phone.', { fg: colors.aqua, bg: colors.aquaSoft }) : null}
            {option('manual', Keyboard, 'Type the items', 'One bill, several things bought: enter each with its category, posted as one transaction.', { fg: colors.coral, bg: colors.coralSoft })}
            <View style={st.tips}>
              <Text style={st.tipsTitle}>For a good read</Text>
              <Text style={st.tip}>• Lay the bill flat on a dark surface, in good light, without shadows.</Text>
              <Text style={st.tip}>• A long bill: scan it as a long bill, or photograph it in parts that overlap a little; they are joined.</Text>
              <Text style={st.tip}>• Faded thermal paper reads best with the light on (the Light button in the long-bill scan).</Text>
            </View>
            {error ? <Text style={st.error}>{error}</Text> : null}
          </ScrollView>
        ) : stage === 'reading' ? (
          <View style={st.reading}>
            <ActivityIndicator size="large" color={colors.ocean} />
            <Text style={st.readingTitle}>Reading the bill…</Text>
            <Text style={[st.optionText, { textAlign: 'center' }]}>{readingNote}</Text>
          </View>
        ) : (
          <>
            <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
              {/* the total and whether it adds up */}
              <View style={st.totalCard}>
                <View style={{ flex: 1 }}>
                  <Text style={st.totalLabel}>Bill total</Text>
                  <View style={st.totalRow}>
                    <Text style={st.rupee}>₹</Text>
                    <TextInput value={totalText} onChangeText={t => setTotalText(t.replace(/[^0-9.,]/g, ''))} placeholder={sum ? String(sum) : '0'}
                      placeholderTextColor="rgba(255,255,255,0.5)" keyboardType="decimal-pad" style={st.totalInput} />
                  </View>
                </View>
                <View style={st.sumBox}>
                  <Text style={st.sumLine}>Items {money(itemSum, 2)}</Text>
                  {adjustments.filter(l => l.counted).length ? <Text style={st.sumLine}>Tax & charges {money(round2(sum - itemSum), 2)}</Text> : null}
                  <View style={[st.badge, { backgroundColor: Math.abs(diff) <= 1 ? 'rgba(56,211,140,0.25)' : 'rgba(255,196,77,0.28)' }]}>
                    <Text style={st.badgeText}>{Math.abs(diff) <= 1 ? (noTotalRead ? 'No total read to check' : fit?.guessed ? 'Adds up with a digit guessed: check it' : 'Adds up') : `${diff > 0 ? '+' : '−'}${money(Math.abs(diff), 2)} not in the items`}</Text>
                  </View>
                </View>
              </View>
              {checking ? (
                <View style={st.check}>
                  <Text style={st.label}>Check against what you entered</Text>
                  {wantTotal ? (
                    <CheckLine ok={Math.abs(wantTotal - sum) <= 1} text={Math.abs(wantTotal - sum) <= 1 ? `The items come to the ${money(wantTotal, 2)} you entered`
                      : `The items come to ${money(sum, 2)}: ${money(Math.abs(wantTotal - sum), 2)} ${wantTotal > sum ? 'short of' : 'over'} the ${money(wantTotal, 2)} you entered`} />
                  ) : null}
                  {expectCount ? (
                    <CheckLine ok={countOk} text={countOk ? (filled === expectCount ? `${filled} items, as you said` : `${expectCount} pieces across ${filled} items, as you said`)
                      : filled < expectCount ? `${filled} of the ${expectCount} items: ${expectCount - filled} missing${fit?.missing ? `, about ${money(fit.missing, 2)} in all` : ''} (add ${expectCount - filled === 1 ? 'it' : 'them'}, or tap a row the phone read below)`
                        : `${filled} items: ${filled - expectCount} more than the ${expectCount} you said`} />
                  ) : null}
                  {bill?.printedTotal && wantTotal && Math.abs(bill.printedTotal - wantTotal) > 1 ? (
                    <Pressable onPress={() => setTotalText(String(bill.printedTotal))}>
                      <Text style={st.hint}>The bill reads {money(bill.printedTotal, 2)} as its total. <Text style={st.link}>Use it</Text></Text>
                    </Pressable>
                  ) : null}
                  {strays || blanksLeft ? (
                    <CheckLine ok={false} text={[strays ? `${strays} name${strays === 1 ? ' has' : 's have'} a number that is not a size` : '',
                      blanksLeft ? `${blanksLeft} item${blanksLeft === 1 ? '' : 's'} without a name or an amount` : ''].filter(Boolean).join(' · ')} />
                  ) : null}
                  <View style={st.expectRow}>
                    <Text style={[st.hint, { flex: 1 }]}>Items expected</Text>
                    <View style={st.stepper}>
                      <Pressable onPress={() => setExpectCount(c => Math.max(0, c - 1))} hitSlop={8} style={st.stepBtn}><Minus color={colors.text2} size={14} /></Pressable>
                      <Text style={st.stepValue}>{expectCount || '–'}</Text>
                      <Pressable onPress={() => setExpectCount(c => Math.min(99, c + 1))} hitSlop={8} style={st.stepBtn}><Plus color={colors.text2} size={14} /></Pressable>
                    </View>
                  </View>
                </View>
              ) : null}
              {fit?.steps.length ? (
                <View style={st.check}>
                  <Text style={st.label}>{fit.matched ? 'Corrected to match' : 'What was tried'} · {fit.against === 'ENTERED' ? 'what you entered' : 'the bill\'s total'}</Text>
                  {fit.steps.map((text, i) => <Text key={i} style={st.checkText}>• {text}</Text>)}
                  <Text style={st.hint}>Checked in {fit.tries.toLocaleString('en-IN')} {fit.tries === 1 ? 'try' : 'tries'}. Check the changed amounts against the bill.</Text>
                </View>
              ) : null}
              {held.length ? (
                <View style={st.heldCard}>
                  <Text style={st.label}>Set aside · {held.length}</Text>
                  {held.map(l => (
                    <View key={l.id} style={st.heldRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={st.adjName} numberOfLines={1}>{l.name || 'Unnamed'} · {money(l.amount, 2)}</Text>
                        {l.note ? <Text style={st.hint}>{l.note}</Text> : null}
                      </View>
                      <Pressable onPress={() => setLine(l.id, { held: false, note: undefined })} hitSlop={8} style={st.restore}>
                        <RotateCcw color={colors.ocean} size={14} /><Text style={st.link}>Put back</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}
              {Math.abs(diff) > 1 && items.length ? (
                <View style={st.note}>
                  <Text style={st.noteText}>The items come to {money(sum, 2)}. When posting, the difference is spread over the items in proportion, or add it as its own line.</Text>
                  <Button title={diff > 0 ? `Add ${money(diff, 2)} as a line` : `Add ${money(-diff, 2)} discount`} kind="soft" Icon={Plus}
                    onPress={() => (diff > 0 ? addItem('Other charges', diff)
                      : setLines(ls => [...ls, { id: lineId(), kind: 'DISCOUNT', name: 'Discount', qty: null, rate: null, amount: -diff, categoryId: null, counted: true }]))} />
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', gap: space.s }}>
                <Field label="Shop / paid to" value={merchant} onChangeText={setMerchant} placeholder="Shop" style={{ flex: 1.4 }} maxLength={100} />
                <Field label="Date" value={day} onChangeText={setDay} placeholder="YYYY-MM-DD" style={{ flex: 1 }} maxLength={10} />
              </View>
              <Text style={st.label}>Paid from</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {accounts.map((a: Account) => (
                  <Pressable key={a.id} onPress={() => setAccount(a.id)} style={[st.payer, a.id === account && st.payerOn]}>
                    <AccountBubble type={a.type} size={26} />
                    <View style={{ maxWidth: 130 }}>
                      <Text style={st.payerName} numberOfLines={1}>{a.name}</Text>
                      <Text style={st.payerSub} numberOfLines={1}>{a.last4 ? `•• ${a.last4} · ` : ''}{app.bal(app.balanceOf(a), a.id)}</Text>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>

              {/* one transaction with items, or one expense */}
              <View style={st.seg}>
                <Pressable onPress={() => setAsItems(true)} style={[st.segBtn, asItems && st.segOn]}>
                  <Text style={[st.segText, asItems && { color: colors.white }]}>Itemized · {items.filter(l => l.amount > 0).length} items</Text>
                </Pressable>
                <Pressable onPress={() => setAsItems(false)} style={[st.segBtn, !asItems && st.segOn]}>
                  <Text style={[st.segText, !asItems && { color: colors.white }]}>One expense</Text>
                </Pressable>
              </View>
              {asItems ? (
                <Text style={st.hint}>One transaction, a line for each item in its own category: the budget sees groceries, household and snacks separately.</Text>
              ) : (
                <Pressable onPress={() => setPicking('ONE')} style={st.oneCat}>
                  {oneCategory ? <CategoryDot name={catName(oneCategory)} /> : <Search color={colors.muted} size={16} />}
                  <Text style={[st.oneCatText, !oneCategory && { color: colors.muted }]}>{oneCategory ? catName(oneCategory) : 'Choose the category'}</Text>
                  <ChevronDown color={colors.muted} size={16} />
                </Pressable>
              )}

              {/* the items */}
              <View style={st.sectionHead}>
                <Text style={st.label}>Items</Text>
                <View style={{ flex: 1 }} />
                {asItems && missing ? <Pressable onPress={() => setPicking('ALL')}><Text style={st.link}>Category for {missing} without</Text></Pressable> : null}
              </View>
              {items.map(l => (
                <View key={l.id} style={st.item}>
                  <View style={{ flex: 1, gap: 6 }}>
                    <TextInput value={l.name} onChangeText={t => setLine(l.id, { name: t })} placeholder="What was it" placeholderTextColor={colors.muted} style={st.itemName} maxLength={120} />
                    <View style={st.itemMeta}>
                      {asItems ? (
                        <Pressable onPress={() => setPicking(l.id)} style={[st.catChip, !l.categoryId && st.catChipMissing]}>
                          {l.categoryId ? <CategoryDot name={catName(l.categoryId)} small /> : null}
                          <Text style={[st.catChipText, !l.categoryId && { color: colors.coral }]} numberOfLines={1}>{l.categoryId ? catName(l.categoryId) : 'Category?'}</Text>
                        </Pressable>
                      ) : null}
                      {l.qty && l.rate ? <Text style={st.qty}>{l.qty} × {money(l.rate, 2)}</Text> : null}
                      {l.readAs != null ? (
                        <Pressable onPress={() => setLine(l.id, { amount: l.readAs!, readAs: undefined, fix: undefined })} hitSlop={6} style={st.fixed}>
                          <RotateCcw color={colors.ocean} size={11} /><Text style={st.fixedText}>Read as {money(l.readAs, 2)}{l.fix ? `: ${l.fix}` : ''} · undo</Text>
                        </Pressable>
                      ) : l.fix ? <Text style={st.qty}>Added: {l.fix}</Text> : null}
                      {l.name && hasStrayNumber(l.name) ? (
                        <Pressable onPress={() => setLine(l.id, { name: cleanItemName(l.name) })} hitSlop={6} style={st.stray}>
                          <AlertTriangle color={colors.coral} size={12} /><Text style={st.strayText}>Number in the name · tap to keep only sizes</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                  <TextInput value={l.amount ? String(l.amount) : ''} onChangeText={t => setLine(l.id, { amount: num(t), readAs: undefined, fix: undefined })} placeholder="0" placeholderTextColor={colors.muted}
                    keyboardType="decimal-pad" style={st.itemAmount} />
                  <Pressable onPress={() => removeLine(l.id)} hitSlop={8}><Trash2 color={colors.muted} size={17} /></Pressable>
                </View>
              ))}
              <Button title="Add an item" kind="ghost" Icon={Plus} onPress={() => addItem()} />
              {asItems && items.length > 3 ? (
                <View style={st.switchRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.switchTitle}>One line per category</Text>
                    <Text style={st.hint}>Items of the same category posted together (their names kept in the line).</Text>
                  </View>
                  <Switch value={combine} onValueChange={setCombine} trackColor={{ true: colors.ocean, false: colors.line }} />
                </View>
              ) : null}

              {/* tax, charges and discounts */}
              {adjustments.length ? (
                <>
                  <Text style={st.label}>Tax, charges & discounts</Text>
                  {adjustments.map(l => (
                    <View key={l.id} style={st.adj}>
                      <View style={{ flex: 1 }}>
                        <Text style={st.adjName} numberOfLines={1}>{l.name}</Text>
                        <Text style={st.hint}>{l.counted ? 'Counted in the bill' : l.kind === 'TAX' ? 'Inside the prices (not added)' : 'Not counted'}</Text>
                      </View>
                      <Text style={[st.adjAmount, l.kind === 'DISCOUNT' && { color: colors.green }]}>{l.kind === 'DISCOUNT' ? '−' : ''}{money(l.amount, 2)}</Text>
                      <Switch value={l.counted} onValueChange={v => setLine(l.id, { counted: v })} trackColor={{ true: colors.ocean, false: colors.line }} />
                    </View>
                  ))}
                  <Text style={st.hint}>What counts is spread over the items when posting, so each category carries its share of tax and discount.</Text>
                </>
              ) : null}

              <Field label="Bill / reference no." value={reference} onChangeText={setReference} placeholder="Optional" maxLength={60} />

              <Text style={st.label}>Photos of the bill · evidence</Text>
              <EvidenceStrip items={images} compact={images.length > 3}
                onAdd={editing ? undefined : f => setImages(i => [...i, f])}
                onRemove={editing ? undefined : it => { nativeFiles.remove(it.path); setImages(i => i.filter(x => x.path !== it.path)); }}
                note={images.length ? undefined : editing ? 'Its photos stay with it.' : 'Optional: kept with the expense and uploaded at the next sync.'} />

              {bill?.rows.length ? (
                <View style={st.rowsCard}>
                  <Pressable onPress={() => setShowRows(v => !v)} style={st.rowsHead}>
                    <Text style={st.switchTitle}>What the phone read · {bill.rows.length} rows</Text>
                    {showRows ? <ChevronUp color={colors.muted} size={18} /> : <ChevronDown color={colors.muted} size={18} />}
                  </Pressable>
                  {showRows ? (
                    <>
                      <View style={st.expectRow}>
                        <Text style={[st.hint, { flex: 1 }]}>Tap a row to add it as an item.</Text>
                        <Pressable onPress={() => Share.share({ message: bill.rows.join('\n') }).catch(() => undefined)} hitSlop={8}><Text style={st.link}>Share rows</Text></Pressable>
                      </View>
                      {bill.rows.map((r, i) => (
                        <Pressable key={i} onPress={() => addRow(r)} style={st.rawRow}><Text style={st.rawText}>{r}</Text></Pressable>
                      ))}
                    </>
                  ) : null}
                </View>
              ) : null}
              {error ? <Text style={st.error}>{error}</Text> : null}
            </ScrollView>
            <View style={[st.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
              <Button title={busy ? 'Saving…' : `${editing ? 'Save' : 'Post'} ${money(total, 2)}${asItems && items.length > 1 ? ` · ${combine ? 'by category' : `${items.filter(l => l.amount > 0).length} items`}` : ''}`}
                Icon={Check} busy={busy} onPress={post} />
            </View>
          </>
        )}
      </View>
      <CategoryPicker visible={!!picking} categories={cats} onClose={() => setPicking(null)} onPick={choose}
        title={picking === 'ALL' ? 'For every item without a category' : picking === 'ONE' ? 'Category of the bill' : 'Category of the item'} />
    </Modal>
  );
}

function CheckLine({ ok, text }: { ok: boolean; text: string }) {
  return (
    <View style={st.checkLine}>
      {ok ? <CheckCircle2 color={colors.green} size={16} /> : <AlertTriangle color={colors.gold} size={16} />}
      <Text style={st.checkText}>{text}</Text>
    </View>
  );
}

function CategoryDot({ name, small }: { name: string; small?: boolean }) {
  const look = categoryLook(name);
  return <IconBubble Icon={look.Icon} fg={look.fg} bg={look.bg} size={small ? 20 : 26} />;
}

/** Choose an expense category: the most used first, or type to search. */
function CategoryPicker({ visible, categories, onClose, onPick, title }: { visible: boolean; categories: Category[]; onClose: () => void; onPick: (id: number) => void; title: string }) {
  const [q, setQ] = useState('');
  useEffect(() => { if (visible) setQ(''); }, [visible]);
  const t = q.trim().toLowerCase();
  const shown = t ? categories.filter(c => c.name.toLowerCase().includes(t)) : categories;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={st.pickWrap} onPress={onClose}>
        <Pressable style={st.pick} onPress={() => undefined}>
          <Text style={st.pickTitle}>{title}</Text>
          <View style={st.search}>
            <Search color={colors.muted} size={16} />
            <TextInput value={q} onChangeText={setQ} placeholder="Search categories" placeholderTextColor={colors.muted} style={st.searchInput} autoFocus={false} />
          </View>
          <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
            {shown.map(c => (
              <Pressable key={c.id} onPress={() => onPick(c.id)} style={({ pressed }) => [st.pickRow, pressed && { backgroundColor: colors.sunken }]}>
                <CategoryDot name={c.name} />
                <Text style={st.pickName} numberOfLines={1}>{c.name}</Text>
              </Pressable>
            ))}
            {!shown.length ? <Text style={[st.hint, { padding: 12 }]}>No category matches “{q.trim()}”.</Text> : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const st = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.m, paddingVertical: space.s, gap: space.s },
  headBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 18, fontWeight: '800', color: colors.text, textAlign: 'center' },
  body: { padding: space.l, gap: space.m, paddingBottom: 40 },
  hero: { flexDirection: 'row', gap: 10, padding: space.m, borderRadius: radius.l, backgroundColor: colors.navy, alignItems: 'flex-start' },
  heroText: { flex: 1, color: '#d7e6f5', fontSize: 13, lineHeight: 19 },
  option: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: space.m, borderRadius: radius.l, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  optionTitle: { fontSize: 15.5, fontWeight: '800', color: colors.text },
  optionText: { fontSize: 12.5, color: colors.text2, lineHeight: 17 },
  optionHint: { fontSize: 11, fontWeight: '700', color: colors.ocean, marginTop: 2 },
  tips: { padding: space.m, borderRadius: radius.m, backgroundColor: colors.sunken, gap: 4 },
  tipsTitle: { fontSize: 12, fontWeight: '800', color: colors.text2, textTransform: 'uppercase', letterSpacing: 0.5 },
  tip: { fontSize: 12.5, color: colors.text2, lineHeight: 18 },
  reading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: space.xl },
  readingTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  totalCard: { flexDirection: 'row', gap: 10, padding: space.m, borderRadius: radius.l, backgroundColor: colors.navy, alignItems: 'center' },
  totalLabel: { color: '#a9c6de', fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  totalRow: { flexDirection: 'row', alignItems: 'center' },
  rupee: { color: '#f0d49a', fontSize: 26, fontWeight: '700', marginRight: 2 },
  totalInput: { flex: 1, color: colors.white, fontSize: 30, fontWeight: '800', paddingVertical: 2 },
  sumBox: { alignItems: 'flex-end', gap: 3 },
  sumLine: { color: '#cfe3f3', fontSize: 12 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, marginTop: 2 },
  badgeText: { color: colors.white, fontSize: 11.5, fontWeight: '800' },
  note: { padding: space.m, borderRadius: radius.m, backgroundColor: colors.goldSoft, gap: 8 },
  noteText: { fontSize: 12.5, color: '#6b5310', lineHeight: 18 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: colors.muted, textTransform: 'uppercase' },
  hint: { fontSize: 11.5, color: colors.muted, lineHeight: 16 },
  link: { color: colors.ocean, fontWeight: '700', fontSize: 12.5 },
  payer: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: radius.m, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  payerOn: { borderColor: colors.ocean, backgroundColor: colors.oceanSoft },
  payerName: { fontSize: 12.5, fontWeight: '700', color: colors.text },
  payerSub: { fontSize: 11, color: colors.muted },
  seg: { flexDirection: 'row', gap: 4, backgroundColor: colors.card, borderRadius: radius.m, padding: 4, borderWidth: 1, borderColor: colors.line },
  segBtn: { flex: 1, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.navy },
  segText: { fontSize: 12.5, fontWeight: '800', color: colors.text2 },
  oneCat: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.m, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  oneCatText: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text },
  sectionHead: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.m, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  itemName: { fontSize: 14, fontWeight: '700', color: colors.text, paddingVertical: 0 },
  itemMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  catChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 3, paddingRight: 9, height: 26, borderRadius: 13, backgroundColor: colors.sunken, maxWidth: 190 },
  catChipMissing: { backgroundColor: colors.coralSoft, paddingLeft: 9 },
  catChipText: { fontSize: 12, fontWeight: '700', color: colors.text2 },
  qty: { fontSize: 11.5, color: colors.muted },
  itemAmount: { width: 92, textAlign: 'right', fontSize: 15, fontWeight: '800', color: colors.text, borderBottomWidth: 1, borderColor: colors.line, paddingVertical: 4 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.m, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  switchTitle: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  adj: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: radius.m, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  adjName: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  adjAmount: { fontSize: 14, fontWeight: '800', color: colors.text },
  rowsCard: { padding: 10, borderRadius: radius.m, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, gap: 6 },
  rowsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rawRow: { paddingVertical: 5, paddingHorizontal: 6, borderRadius: 6, backgroundColor: colors.sunken },
  rawText: { fontFamily: 'monospace', fontSize: 11.5, color: colors.text2 },
  footer: { paddingHorizontal: space.l, paddingTop: 10, backgroundColor: colors.card, borderTopWidth: 1, borderColor: colors.line },
  error: { color: colors.red, fontWeight: '600', fontSize: 13 },
  pickWrap: { flex: 1, backgroundColor: 'rgba(11,32,56,0.5)', justifyContent: 'center', padding: space.l },
  pick: { backgroundColor: colors.card, borderRadius: 20, padding: space.m, gap: 10 },
  pickTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 42, borderRadius: radius.m, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 14.5, color: colors.text, paddingVertical: 0 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 10 },
  pickName: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  expect: { padding: space.m, borderRadius: radius.l, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, gap: 8 },
  expectRow: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  expectBox: { flex: 1, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.m, backgroundColor: colors.sunken, gap: 2 },
  expectLabel: { fontSize: 11, fontWeight: '700', color: colors.text2 },
  expectRupee: { fontSize: 18, fontWeight: '700', color: colors.muted, marginRight: 2 },
  expectInput: { flex: 1, fontSize: 20, fontWeight: '800', color: colors.text, paddingVertical: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  stepInput: { minWidth: 34, textAlign: 'center', fontSize: 20, fontWeight: '800', color: colors.text, paddingVertical: 2 },
  stepValue: { minWidth: 24, textAlign: 'center', fontSize: 14, fontWeight: '800', color: colors.text },
  check: { padding: space.m, borderRadius: radius.m, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, gap: 7 },
  checkLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  checkText: { flex: 1, fontSize: 12.5, color: colors.text, lineHeight: 18 },
  heldCard: { padding: space.m, borderRadius: radius.m, backgroundColor: colors.goldSoft, gap: 8 },
  heldRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  restore: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stray: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, height: 22, borderRadius: 11, backgroundColor: colors.coralSoft },
  strayText: { fontSize: 11, fontWeight: '700', color: colors.coral },
  fixed: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, minHeight: 22, borderRadius: 11, backgroundColor: colors.oceanSoft, flexShrink: 1 },
  fixedText: { fontSize: 11, fontWeight: '700', color: colors.ocean, flexShrink: 1 },
});
