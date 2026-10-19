/**
 * Recording an expense (or changing one that waits to be synced): the amount, the day, the category, the account
 * it was paid from (and what it leaves there), what it was and the shop. It is kept on the phone at once and the
 * account's balance goes down; it goes to the server at the next sync. From a bank SMS everything is filled in.
 * Categories can be searched by typing; a bill can be photographed (or a file attached) as evidence, uploaded with it.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check, ChevronLeft, ChevronRight, MessageSquareText, Search, Trash2, X } from 'lucide-react-native';
import { useApp } from '../state';
import { Account, LocalExpense, isExpense, liveBalance } from '../data';
import { date, isoDate, money } from '../format';
import { AccountBubble, Button, Field, IconBubble, Sheet, categoryLook } from '../ui';
import { colors, radius, space } from '../theme';
import { EvidenceStrip } from '../evidence';
import { PickedFile, nativeFiles } from '../native';

export type Prefill = Partial<Pick<LocalExpense, 'amount' | 'date' | 'narration' | 'party' | 'reference' | 'categoryId' | 'paidFromId' | 'smsId' | 'notes'>> & { smsText?: string };

const TYPE_ORDER = ['BANK', 'CREDIT_CARD', 'CASH', 'WALLET', 'PAYABLE'];

/** "Dining Out" starts a word with "out" and with "din". */
const startsWord = (name: string, q: string) => name.toLowerCase().split(/[\s&/,-]+/).some(w => w.startsWith(q)) || name.toLowerCase().startsWith(q);

export function AddExpense({ visible, onClose, prefill, editing }: { visible: boolean; onClose: () => void; prefill?: Prefill; editing?: LocalExpense }) {
  const app = useApp();
  const cats = useMemo(() => (app.snapshot?.categories || []).filter(isExpense), [app.snapshot]);
  const wanted = editing?.paidFromId ?? prefill?.paidFromId;
  // the accounts shown on the phone (and the one an SMS or an edit names, even if hidden)
  const payers = useMemo(() => (app.snapshot?.accounts || []).filter(a => a.payFrom && (app.accounts.includes(a) || a.id === wanted))
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || (b.lastActivity || '').localeCompare(a.lastActivity || '')), [app.snapshot, app.accounts, wanted]);
  const lastPayer = app.queue[0]?.paidFromId;

  const [amount, setAmount] = useState('');
  const [day, setDay] = useState(isoDate());
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [payFrom, setPayFrom] = useState<number | null>(null);
  const [narration, setNarration] = useState('');
  const [party, setParty] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [allCats, setAllCats] = useState(false);
  const [catQuery, setCatQuery] = useState('');
  const [draft, setDraft] = useState<PickedFile[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const src = editing || prefill || {};
    setAmount(src.amount ? String(src.amount) : '');
    setDay(src.date || isoDate());
    setCategoryId(src.categoryId ?? null);
    setPayFrom(src.paidFromId ?? (payers.some(p => p.id === lastPayer) ? lastPayer! : payers[0]?.id ?? null));
    setNarration(src.narration || '');
    setParty(src.party || '');
    setReference(src.reference || '');
    setNotes(src.notes || '');
    setError('');
    setAllCats(false);
    setCatQuery('');
    setDraft([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const value = Number(amount.replace(/[,₹\s]/g, '')) || 0;
  const byUse = useMemo(() => [...cats].sort((a, b) => (b.uses || 0) - (a.uses || 0) || a.name.localeCompare(b.name)), [cats]);
  const q = catQuery.trim().toLowerCase();
  // typed: every category whose name (or a word of it) starts with what was typed first, then those that contain it
  const shown = q ? byUse.filter(c => c.name.toLowerCase().includes(q))
      .sort((a, b) => Number(!startsWord(a.name, q)) - Number(!startsWord(b.name, q)))
    : allCats ? byUse : byUse.filter(c => !c.system).slice(0, 8);
  const selectedCat = cats.find(c => c.id === categoryId);
  const payer = payers.find(p => p.id === payFrom);
  const shift = (n: number) => {
    const d = new Date(`${day}T00:00:00`); d.setDate(d.getDate() + n);
    const next = isoDate(d);
    if (next <= isoDate()) setDay(next);
  };

  const save = async () => {
    if (!(value > 0)) { setError('Enter the amount'); return; }
    if (!categoryId || !selectedCat) { setError('Pick a category'); return; }
    if (!payer) { setError('Pick the account you paid from'); return; }
    setBusy(true);
    try {
      const data = { amount: Math.round(value * 100) / 100, date: day, categoryId, categoryName: selectedCat.name, paidFromId: payer.id, paidFromName: payer.name,
        narration: narration.trim(), party: party.trim(), reference: reference.trim(), notes: notes.trim(), smsId: prefill?.smsId };
      if (editing) {
        await app.updateExpense(editing.clientId, data);
        await app.addEvidence({ clientId: editing.clientId, label: data.narration || data.categoryName }, draft);
        app.notify('Saved on the phone');
      } else {
        await app.addExpense(data, draft);
        app.notify(app.settings.offline ? `${money(data.amount)} saved on the phone` : `${money(data.amount)} saved · syncing`);
      }
      setDraft([]);
      onClose();
    } finally { setBusy(false); }
  };
  // closing without saving drops the photos taken for it
  const cancel = () => { draft.forEach(f => nativeFiles.remove(f.path)); setDraft([]); onClose(); };
  const kept = editing ? app.uploads.filter(u => u.clientId === editing.clientId) : [];
  const remove = async () => { if (editing) { await app.removeExpense(editing.clientId); app.notify('Deleted from the phone'); onClose(); } };

  const after = payer ? liveBalance(payer, app.queue, app.chitQueue).balance + (payer.accountClass === 'LIABILITY' ? 1 : -1) * (value - (editing && editing.paidFromId === payer.id ? editing.amount : 0)) : 0;

  return (
    <Sheet visible={visible} onClose={cancel} title={editing ? 'Change the expense' : prefill?.smsId ? 'Record from the SMS' : 'Add an expense'}
      footer={<View style={{ flexDirection: 'row', gap: space.s }}>
        {editing ? <Button title="Delete" kind="danger" Icon={Trash2} onPress={remove} /> : null}
        <Button title={editing ? 'Save' : 'Save expense'} Icon={Check} onPress={save} busy={busy} style={{ flex: 1 }} />
      </View>}>
      {prefill?.smsText ? (
        <View style={st.sms}>
          <MessageSquareText color={colors.ocean} size={16} />
          <Text style={st.smsText} numberOfLines={4}>{prefill.smsText}</Text>
        </View>
      ) : null}
      {editing?.status === 'FAILED' && editing.message ? <Text style={st.error}>The server said: {editing.message}</Text> : null}

      <View style={st.amountBox}>
        <Text style={st.rupee}>₹</Text>
        <TextInput value={amount} onChangeText={t => setAmount(t.replace(/[^0-9.,]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.muted}
          style={st.amount} autoFocus={!prefill?.amount && !editing} />
      </View>

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

      <View style={st.head}><Text style={st.label}>Category{selectedCat ? ` · ${selectedCat.name}` : ''}</Text><View style={{ flex: 1 }} />
        {!q ? <Pressable onPress={() => setAllCats(v => !v)} hitSlop={8}><Text style={st.link}>{allCats ? 'Fewer' : `All ${cats.length}`}</Text></Pressable> : null}</View>
      <View style={st.search}>
        <Search color={colors.muted} size={16} />
        <TextInput value={catQuery} onChangeText={setCatQuery} placeholder="Type to search categories" placeholderTextColor={colors.muted} style={st.searchInput}
          autoCorrect={false} returnKeyType="done" onSubmitEditing={() => { if (shown[0]) { setCategoryId(shown[0].id); setCatQuery(''); } }} />
        {catQuery ? <Pressable onPress={() => setCatQuery('')} hitSlop={8}><X color={colors.muted} size={16} /></Pressable> : null}
      </View>
      {q && !shown.length ? <Text style={st.after}>No category matches “{catQuery.trim()}”.</Text> : null}
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

      <Text style={st.label}>Paid from</Text>
      <View style={st.payers}>
        {payers.map((a: Account) => {
          const on = a.id === payFrom;
          return (
            <Pressable key={a.id} onPress={() => setPayFrom(a.id)} style={[st.payer, on && st.payerOn]}>
              <AccountBubble type={a.type} size={28} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={st.payerName} numberOfLines={1}>{a.name}</Text>
                <Text style={st.payerSub} numberOfLines={1}>{a.last4 ? `•• ${a.last4} · ` : ''}{money(liveBalance(a, app.queue, app.chitQueue).balance)}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      {payer && value > 0 ? <Text style={st.after}>{payer.accountClass === 'LIABILITY' ? 'Owed on' : 'Left in'} {payer.name} after this: <Text style={{ fontWeight: '800' }}>{money(after)}</Text></Text> : null}

      <Field label="What was it for" value={narration} onChangeText={setNarration} placeholder={selectedCat ? selectedCat.name : 'e.g. Weekly groceries'} maxLength={255} />
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Field label="Paid to" value={party} onChangeText={setParty} placeholder="Shop / person" style={{ flex: 1 }} maxLength={100} />
        <Field label="Ref / UPI" value={reference} onChangeText={setReference} placeholder="Optional" style={{ flex: 1 }} maxLength={60} />
      </View>
      <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="Optional" maxLength={255} />
      <Text style={st.label}>Evidence · bill or receipt</Text>
      <EvidenceStrip
        items={[...kept.map(u => ({ ...u })), ...draft]}
        onAdd={f => setDraft(d => [...d, f])}
        onRemove={it => { if ((it as any).id) app.removeEvidence((it as any).id); else { nativeFiles.remove(it.path); setDraft(d => d.filter(x => x.path !== it.path)); } }}
        note={kept.length || draft.length ? undefined : 'Optional: photograph the bill or attach a PDF; it is uploaded to the expense at the next sync.'} />
      {error ? <Text style={st.error}>{error}</Text> : null}
    </Sheet>
  );
}

const st = StyleSheet.create({
  sms: { flexDirection: 'row', gap: 8, padding: space.m, borderRadius: radius.m, backgroundColor: colors.oceanSoft },
  smsText: { flex: 1, fontSize: 12.5, color: colors.text2, lineHeight: 18 },
  amountBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.l, paddingHorizontal: space.l, borderWidth: 1, borderColor: colors.line },
  rupee: { fontSize: 30, fontWeight: '700', color: colors.ocean, marginRight: 4 },
  amount: { flex: 1, fontSize: 36, fontWeight: '800', color: colors.text, paddingVertical: 10 },
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
