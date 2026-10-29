/**
 * Recording money on the phone, in one sheet with four modes:
 *   Expense    the amount, the day, the category, the account it was paid from, what it was and the shop
 *   Paid for   a bill paid for someone (owed back to me): who, what, the account it left, when it is due back
 *   Lent       money lent (owed back to me): to whom, the account it left, when it is due, interest a year
 *   Income     money that came in: the income category, the account it came into, from whom
 * It is kept on the phone at once and the account's balance moves; it goes to the server at the next sync. From a
 * bank SMS everything is filled in (a debit can also be money paid for someone or lent). Categories can be searched
 * by typing; a bill can be photographed (or a file attached) as evidence, uploaded with it. An expense that waits to be
 * synced can be changed here too.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowDownLeft, Check, ChevronLeft, ChevronRight, HandCoins, HandHeart, MessageSquareText, Receipt, Search, Trash2, X } from 'lucide-react-native';
import { useApp } from '../state';
import { Account, LocalExpense, hasFeature, isExpense } from '../data';
import { date, isoDate, money } from '../format';
import { AccountBubble, Button, Field, IconBubble, Sheet, categoryLook } from '../ui';
import { colors, radius, space } from '../theme';
import { EvidenceStrip } from '../evidence';
import { PickedFile, nativeFiles } from '../native';

export type RecordMode = 'EXPENSE' | 'PAID_FOR' | 'LENT' | 'INCOME';

export type Prefill = Partial<Pick<LocalExpense, 'amount' | 'date' | 'narration' | 'party' | 'reference' | 'categoryId' | 'paidFromId' | 'smsId' | 'notes'>>
  & { smsText?: string; mode?: RecordMode };

const TYPE_ORDER = ['BANK', 'CREDIT_CARD', 'CASH', 'WALLET', 'PAYABLE'];
const INTO_TYPES = ['BANK', 'CASH', 'WALLET'];

const MODES: { key: RecordMode; label: string; Icon: any; feature: string }[] = [
  { key: 'EXPENSE', label: 'Expense', Icon: Receipt, feature: 'EXPENSES' },
  { key: 'PAID_FOR', label: 'Paid for', Icon: HandHeart, feature: 'EXPENSES' },
  { key: 'LENT', label: 'Lent', Icon: HandCoins, feature: 'EXPENSES' },
  { key: 'INCOME', label: 'Income', Icon: ArrowDownLeft, feature: 'INCOME' },
];

const TITLES: Record<RecordMode, string> = { EXPENSE: 'Add an expense', PAID_FOR: 'Paid for someone', LENT: 'Money lent', INCOME: 'Add income' };
const SAVE: Record<RecordMode, string> = { EXPENSE: 'Save expense', PAID_FOR: 'Save · to collect', LENT: 'Save · to collect', INCOME: 'Save income' };
const DUE: [number | null, string][] = [[null, 'No date'], [7, 'In a week'], [30, 'In a month'], [90, '3 months'], [365, 'A year']];

/** "Dining Out" starts a word with "out" and with "din". */
const startsWord = (name: string, q: string) => name.toLowerCase().split(/[\s&/,-]+/).some(w => w.startsWith(q)) || name.toLowerCase().startsWith(q);

export function AddExpense({ visible, onClose, prefill, editing }: { visible: boolean; onClose: () => void; prefill?: Prefill; editing?: LocalExpense }) {
  const app = useApp();
  const [mode, setMode] = useState<RecordMode>('EXPENSE');
  const income = mode === 'INCOME';
  const owed = mode === 'PAID_FOR' || mode === 'LENT';
  const cats = useMemo(() => (app.snapshot?.categories || []).filter(c => (income ? !isExpense(c) : isExpense(c))), [app.snapshot, income]);
  const wanted = editing?.paidFromId ?? prefill?.paidFromId;
  // the accounts shown on the phone (and the one an SMS or an edit names, even if hidden): paid from, or (income) into
  const accounts = useMemo(() => (app.snapshot?.accounts || [])
    .filter(a => (income ? a.group === 'OWN' && INTO_TYPES.includes(a.type) : a.payFrom && (mode === 'EXPENSE' || a.type !== 'PAYABLE'))
      && (app.accounts.includes(a) || a.id === wanted))
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || (b.lastActivity || '').localeCompare(a.lastActivity || '')),
  [app.snapshot, app.accounts, wanted, income, mode]);
  const lastPayer = app.queue[0]?.paidFromId;
  const modes = MODES.filter(m => hasFeature(app.snapshot, m.feature));
  // the people money was paid for or lent to before, most recent first
  const people = useMemo(() => {
    const seen = new Set<string>();
    return [...app.records.filter(r => r.kind === 'CLAIM').map(r => String(r.payload.party || '')), ...(app.snapshot?.claims || []).map(c => c.party)]
      .filter(p => p && !seen.has(p.toLowerCase()) && !!seen.add(p.toLowerCase())).slice(0, 8);
  }, [app.records, app.snapshot]);

  const [amount, setAmount] = useState('');
  const [day, setDay] = useState(isoDate());
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [account, setAccount] = useState<number | null>(null);
  const [narration, setNarration] = useState('');
  const [party, setParty] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [dueDays, setDueDays] = useState<number | null>(null);
  const [rate, setRate] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [catQuery, setCatQuery] = useState('');
  const [draft, setDraft] = useState<PickedFile[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const src = editing || prefill || {};
    setMode(editing ? 'EXPENSE' : prefill?.mode || 'EXPENSE');
    setAmount(src.amount ? String(src.amount) : '');
    setDay(src.date || isoDate());
    setCategoryId(src.categoryId ?? null);
    setAccount(src.paidFromId ?? null);
    setNarration(src.narration || '');
    setParty(src.party || '');
    setReference(src.reference || '');
    setNotes(src.notes || '');
    setDueDays(null);
    setRate('');
    setError('');
    setShowAll(false);
    setCatQuery('');
    setDraft([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // the account follows the mode: the one picked when it fits, else the last used, else the first
  useEffect(() => {
    if (!visible) return;
    setAccount(cur => (accounts.some(a => a.id === cur) ? cur : accounts.some(a => a.id === lastPayer) ? lastPayer! : accounts[0]?.id ?? null));
    setCategoryId(cur => (cats.some(c => c.id === cur) ? cur : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, mode, accounts.length]);

  const value = Number(amount.replace(/[,₹\s]/g, '')) || 0;
  const byUse = useMemo(() => [...cats].sort((a, b) => (b.uses || 0) - (a.uses || 0) || a.name.localeCompare(b.name)), [cats]);
  const q = catQuery.trim().toLowerCase();
  // typed: every category whose name (or a word of it) starts with what was typed first, then those that contain it
  const shown = q ? byUse.filter(c => c.name.toLowerCase().includes(q))
      .sort((a, b) => Number(!startsWord(a.name, q)) - Number(!startsWord(b.name, q)))
    : showAll ? byUse : byUse.filter(c => !c.system).slice(0, 8);
  const selectedCat = cats.find(c => c.id === categoryId);
  const acc = accounts.find(p => p.id === account);
  const shift = (n: number) => {
    const d = new Date(`${day}T00:00:00`); d.setDate(d.getDate() + n);
    const next = isoDate(d);
    if (next <= isoDate()) setDay(next);
  };
  const dueDate = dueDays ? (() => { const d = new Date(`${day}T00:00:00`); d.setDate(d.getDate() + dueDays); return isoDate(d); })() : null;

  const save = async () => {
    if (!(value > 0)) { setError('Enter the amount'); return; }
    if (!owed && (!categoryId || !selectedCat)) { setError(income ? 'Pick where the money came from (the income source)' : 'Pick a category'); return; }
    if (owed && !party.trim()) { setError(mode === 'LENT' ? 'Who did you lend it to?' : 'Who did you pay for?'); return; }
    if (!acc) { setError(income ? 'Pick the account the money came into' : 'Pick the account it was paid from'); return; }
    setBusy(true);
    try {
      const amt = Math.round(value * 100) / 100;
      const who = party.trim();
      if (mode === 'EXPENSE') {
        const data = { amount: amt, date: day, categoryId: categoryId!, categoryName: selectedCat!.name, paidFromId: acc.id, paidFromName: acc.name,
          narration: narration.trim(), party: who, reference: reference.trim(), notes: notes.trim(), smsId: prefill?.smsId };
        if (editing) {
          await app.updateExpense(editing.clientId, data);
          await app.addEvidence({ clientId: editing.clientId, label: data.narration || data.categoryName }, draft);
          app.notify('Saved on the phone');
        } else {
          await app.addExpense(data, draft);
          app.notify(app.settings.offline ? `${money(amt)} saved on the phone` : `${money(amt)} saved · syncing`);
        }
      } else if (owed) {
        const r = Number(rate.replace(',', '.')) || 0;
        await app.addRecord({
          kind: 'CLAIM', title: narration.trim() || (mode === 'LENT' ? `Lent to ${who}` : `Paid for ${who}`),
          sub: `${mode === 'LENT' ? 'Lent to' : 'Paid for'} ${who}`, date: day, amount: amt, accountId: acc.id, accountName: acc.name, flow: 'OUT',
          payload: { kind: mode, party: who, narration: narration.trim() || null, amount: amt, date: day, dueDate, paidFromId: acc.id,
            interestRate: mode === 'LENT' && r > 0 ? r : null, reference: reference.trim() || null, notes: notes.trim() || null },
        }, draft);
        if (prefill?.smsId) await app.dismissSms([prefill.smsId]);
        app.notify(`${money(amt)} ${mode === 'LENT' ? 'lent to' : 'paid for'} ${who} · to collect`);
      } else {
        await app.addRecord({
          kind: 'INCOME', title: narration.trim() || selectedCat!.name, sub: [selectedCat!.name, who].filter(Boolean).join(' · '), date: day,
          amount: amt, accountId: acc.id, accountName: acc.name, flow: 'IN',
          payload: { date: day, amount: amt, categoryId, intoId: acc.id, narration: narration.trim() || null, party: who || null,
            reference: reference.trim() || null },
        }, draft);
        app.notify(`${money(amt)} received into ${acc.name}`);
      }
      setDraft([]);
      onClose();
    } finally { setBusy(false); }
  };
  // closing without saving drops the photos taken for it
  const cancel = () => { draft.forEach(f => nativeFiles.remove(f.path)); setDraft([]); onClose(); };
  const kept = editing ? app.uploads.filter(u => u.clientId === editing.clientId) : [];
  const remove = async () => { if (editing) { await app.removeExpense(editing.clientId); app.notify('Deleted from the phone'); onClose(); } };

  const sign = acc ? (acc.accountClass === 'LIABILITY' ? 1 : -1) * (income ? -1 : 1) : 0;
  const after = acc ? app.balanceOf(acc) + sign * (value - (editing && editing.paidFromId === acc.id ? editing.amount : 0)) : 0;
  const title = editing ? 'Change the expense' : prefill?.smsId && mode === 'EXPENSE' ? 'Record from the SMS' : TITLES[mode];

  return (
    <Sheet visible={visible} onClose={cancel} title={title}
      footer={<View style={{ flexDirection: 'row', gap: space.s }}>
        {editing ? <Button title="Delete" kind="danger" Icon={Trash2} onPress={remove} /> : null}
        <Button title={editing ? 'Save' : SAVE[mode]} Icon={Check} onPress={save} busy={busy} style={{ flex: 1 }} />
      </View>}>
      {!editing && modes.length > 1 ? (
        <View style={st.modes}>
          {modes.map(m => {
            const on = m.key === mode;
            return (
              <Pressable key={m.key} onPress={() => { setMode(m.key); setError(''); }} style={[st.mode, on && st.modeOn]}>
                <m.Icon color={on ? colors.white : colors.text2} size={16} />
                <Text style={[st.modeText, on && { color: colors.white }]} numberOfLines={1}>{m.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {prefill?.smsText ? (
        <View style={st.sms}>
          <MessageSquareText color={colors.ocean} size={16} />
          <Text style={st.smsText} numberOfLines={4}>{prefill.smsText}</Text>
        </View>
      ) : null}
      {editing?.status === 'FAILED' && editing.message ? <Text style={st.error}>The server said: {editing.message}</Text> : null}

      <View style={[st.amountBox, income && { borderColor: colors.green }]}>
        <Text style={[st.rupee, income && { color: colors.green }]}>₹</Text>
        <TextInput value={amount} onChangeText={t => setAmount(t.replace(/[^0-9.,]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.muted}
          style={st.amount} autoFocus={!prefill?.amount && !editing} />
      </View>

      {owed ? (
        <View style={{ gap: 6 }}>
          <Field label={mode === 'LENT' ? 'Lent to' : 'Paid for whom'} value={party} onChangeText={setParty} placeholder="Name" maxLength={100} />
          {people.length ? (
            <View style={st.chips}>
              {people.map(p => {
                const on = party.trim().toLowerCase() === p.toLowerCase();
                return (
                  <Pressable key={p} onPress={() => setParty(p)} style={[st.chip, on && st.chipOn]}>
                    <Text style={[st.chipText, on && { color: colors.white }]} numberOfLines={1}>{p}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={st.dates}>
        {[0, 1, 2].map(n => { const d = new Date(); d.setDate(d.getDate() - n); const iso = isoDate(d);
          return <Pressable key={n} onPress={() => setDay(iso)} style={[st.dateChip, day === iso && st.dateOn]}>
            <Text style={[st.dateText, day === iso && { color: colors.white }]}>{['Today', 'Yesterday', '2 days ago'][n]}</Text></Pressable>; })}
        <View style={st.stepper}>
          <Pressable onPress={() => shift(-1)} hitSlop={8}><ChevronLeft color={colors.text2} size={18} /></Pressable>
          <Text style={st.stepText}>{date(day)}</Text>
          <Pressable onPress={() => shift(1)} hitSlop={8}><ChevronRight color={day >= isoDate() ? colors.line : colors.text2} size={18} /></Pressable>
        </View>
      </View>

      {!owed ? (
        <>
          <View style={st.head}><Text style={st.label}>{income ? 'Source' : 'Category'}{selectedCat ? ` · ${selectedCat.name}` : ''}</Text><View style={{ flex: 1 }} />
            {!q ? <Pressable onPress={() => setShowAll(v => !v)} hitSlop={8}><Text style={st.link}>{showAll ? 'Fewer' : `All ${cats.length}`}</Text></Pressable> : null}</View>
          <View style={st.search}>
            <Search color={colors.muted} size={16} />
            <TextInput value={catQuery} onChangeText={setCatQuery} placeholder={income ? 'Type to search sources' : 'Type to search categories'} placeholderTextColor={colors.muted}
              style={st.searchInput} autoCorrect={false} returnKeyType="done" onSubmitEditing={() => { if (shown[0]) { setCategoryId(shown[0].id); setCatQuery(''); } }} />
            {catQuery ? <Pressable onPress={() => setCatQuery('')} hitSlop={8}><X color={colors.muted} size={16} /></Pressable> : null}
          </View>
          {q && !shown.length ? <Text style={st.after}>No {income ? 'source' : 'category'} matches “{catQuery.trim()}”.</Text> : null}
          <View style={st.grid}>
            {(selectedCat && !q && !shown.includes(selectedCat) ? [selectedCat, ...shown.slice(0, 7)] : shown).map(c => {
              const look = categoryLook(c.name);
              const on = c.id === categoryId;
              return (
                <Pressable key={c.id} onPress={() => { setCategoryId(c.id); if (q) setCatQuery(''); }} style={[st.tile, on && st.tileOn]}>
                  <IconBubble Icon={look.Icon} fg={on ? colors.white : look.fg} bg={on ? 'rgba(255,255,255,0.18)' : look.bg} size={30} />
                  <Text style={[st.tileText, on && { color: colors.white }]} numberOfLines={1}>{c.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      <Text style={st.label}>{income ? 'Came into' : 'Paid from'}</Text>
      <View style={st.payers}>
        {accounts.map((a: Account) => {
          const on = a.id === account;
          return (
            <Pressable key={a.id} onPress={() => setAccount(a.id)} style={[st.payer, on && st.payerOn]}>
              <AccountBubble type={a.type} size={28} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={st.payerName} numberOfLines={1}>{a.name}</Text>
                <Text style={st.payerSub} numberOfLines={1}>{a.last4 ? `•• ${a.last4} · ` : ''}{app.bal(app.balanceOf(a), a.id)}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      {acc && value > 0 ? <Text style={st.after}>{acc.accountClass === 'LIABILITY' ? 'Owed on' : income ? 'In' : 'Left in'} {acc.name} after this: <Text style={{ fontWeight: '800' }}>{app.bal(after, acc?.id)}</Text></Text> : null}

      {owed ? (
        <View style={{ gap: 6 }}>
          <Text style={st.label}>Due back{dueDate ? ` · ${date(dueDate)}` : ''}</Text>
          <View style={st.chips}>
            {DUE.map(([d, l]) => (
              <Pressable key={String(d)} onPress={() => setDueDays(d)} style={[st.chip, dueDays === d && st.chipOn]}>
                <Text style={[st.chipText, dueDays === d && { color: colors.white }]}>{l}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      {mode === 'LENT' ? (
        <Field label="Interest % a year (optional)" value={rate} onChangeText={t => setRate(t.replace(/[^0-9.,]/g, ''))} keyboardType="decimal-pad"
          placeholder="0 for none" maxLength={5} hint={Number(rate) > 0 && value > 0 ? `About ${money(Math.round(value * Number(rate) / 1200))} a month` : undefined} />
      ) : null}

      <Field label={income ? 'What was it' : owed ? 'What for' : 'What was it for'} value={narration} onChangeText={setNarration}
        placeholder={income ? selectedCat?.name || 'e.g. October salary' : owed ? 'e.g. Hospital bill, movie tickets' : selectedCat ? selectedCat.name : 'e.g. Weekly groceries'} maxLength={255} />
      <View style={{ flexDirection: 'row', gap: space.s }}>
        {!owed ? <Field label={income ? 'From' : 'Paid to'} value={party} onChangeText={setParty} placeholder={income ? 'Employer / person' : 'Shop / person'} style={{ flex: 1 }} maxLength={100} /> : null}
        <Field label="Ref / UPI" value={reference} onChangeText={setReference} placeholder="Optional" style={{ flex: 1 }} maxLength={60} />
      </View>
      {!income ? <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="Optional" maxLength={255} /> : null}
      <Text style={st.label}>Evidence · {income ? 'payslip or receipt' : 'bill or receipt'}</Text>
      <EvidenceStrip
        items={[...kept.map(u => ({ ...u })), ...draft]}
        onAdd={f => setDraft(d => [...d, f])}
        onRemove={it => { if ((it as any).id) app.removeEvidence((it as any).id); else { nativeFiles.remove(it.path); setDraft(d => d.filter(x => x.path !== it.path)); } }}
        note={kept.length || draft.length ? undefined : 'Optional: photograph it or attach a PDF; it is uploaded with it at the next sync.'} />
      {error ? <Text style={st.error}>{error}</Text> : null}
    </Sheet>
  );
}

const st = StyleSheet.create({
  modes: { flexDirection: 'row', gap: 4, backgroundColor: colors.card, borderRadius: radius.m, padding: 4, borderWidth: 1, borderColor: colors.line },
  mode: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, height: 36, borderRadius: 9 },
  modeOn: { backgroundColor: colors.navy },
  modeText: { fontSize: 12.5, fontWeight: '800', color: colors.text2 },
  sms: { flexDirection: 'row', gap: 8, padding: space.m, borderRadius: radius.m, backgroundColor: colors.oceanSoft },
  smsText: { flex: 1, fontSize: 12.5, color: colors.text2, lineHeight: 18 },
  amountBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.l, paddingHorizontal: space.l, borderWidth: 1, borderColor: colors.line },
  rupee: { fontSize: 30, fontWeight: '700', color: colors.ocean, marginRight: 4 },
  amount: { flex: 1, fontSize: 36, fontWeight: '800', color: colors.text, paddingVertical: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, height: 30, borderRadius: 15, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, justifyContent: 'center', maxWidth: 160 },
  chipOn: { backgroundColor: colors.violet, borderColor: colors.violet },
  chipText: { fontSize: 12.5, fontWeight: '700', color: colors.text2 },
  dates: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  dateChip: { paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, justifyContent: 'center' },
  dateOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  dateText: { fontSize: 12.5, fontWeight: '700', color: colors.text2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto', backgroundColor: colors.card, borderRadius: 16, paddingHorizontal: 8, height: 32, borderWidth: 1, borderColor: colors.line },
  stepText: { fontSize: 12.5, fontWeight: '700', color: colors.text },
  head: { flexDirection: 'row', alignItems: 'center' },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: colors.muted, textTransform: 'uppercase' },
  link: { color: colors.ocean, fontWeight: '700', fontSize: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '23%', alignItems: 'center', gap: 4, paddingVertical: 8, borderRadius: radius.m, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  tileOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  tileText: { fontSize: 10.5, fontWeight: '700', color: colors.text, paddingHorizontal: 2 },
  payers: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  payer: { width: '48.5%', flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: radius.m, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  payerOn: { borderColor: colors.ocean, backgroundColor: colors.oceanSoft },
  payerName: { fontSize: 12.5, fontWeight: '700', color: colors.text },
  payerSub: { fontSize: 11, color: colors.muted },
  after: { fontSize: 12.5, color: colors.text2 },
  error: { color: colors.red, fontWeight: '600', fontSize: 13 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 42, borderRadius: radius.m, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.card, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 14.5, color: colors.text, paddingVertical: 0 },
});
