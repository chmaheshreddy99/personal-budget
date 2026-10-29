/**
 * Transfer: move money between two of my accounts (bank to cash, a card bill paid from the bank ...). It is kept on the
 * phone at once, both balances move, and it goes to the server at the next sync (booked once, however often it is sent).
 * Balances show here only when the person has chosen to view them (see Settings > Mobile app on the web).
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowDown, Check } from 'lucide-react-native';
import { useApp } from '../state';
import { Account } from '../data';
import { isoDate, money } from '../format';
import { AccountBubble, Button, Field, Sheet } from '../ui';
import { colors, radius, space } from '../theme';

const TYPES = ['BANK', 'CASH', 'WALLET', 'CREDIT_CARD'];

export function TransferSheet({ visible, onClose, from: start }: { visible: boolean; onClose: () => void; from?: number }) {
  const app = useApp();
  const accounts = useMemo(() => app.accounts.filter(a => a.group === 'OWN' && (TYPES.includes(a.type) || a.accountClass === 'LIABILITY')), [app.accounts]);
  const [from, setFrom] = useState<number | null>(start ?? null);
  const [to, setTo] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [day, setDay] = useState(isoDate());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const value = Number(amount.replace(/,/g, '')) || 0;
  const a = accounts.find(x => x.id === from), b = accounts.find(x => x.id === to);

  const reset = () => { setFrom(start ?? null); setTo(null); setAmount(''); setNote(''); setDay(isoDate()); setError(''); };
  const close = () => { reset(); onClose(); };

  const save = async () => {
    if (!a || !b) { setError('Pick the account the money leaves and the one it goes to'); return; }
    if (a.id === b.id) { setError('Pick two different accounts'); return; }
    if (!(value > 0)) { setError('Enter the amount'); return; }
    setBusy(true);
    try {
      await app.addRecord({
        kind: 'TRANSFER', title: note.trim() || `${a.name} to ${b.name}`, sub: `${a.name} → ${b.name}`, date: day, amount: value, accountId: a.id, accountName: a.name,
        flow: 'OUT', payload: { date: day, amount: value, fromId: a.id, toId: b.id, narration: note.trim() || null, reference: null },
      });
      app.notify(`${money(value)} moved from ${a.name} to ${b.name}`);
      close();
    } catch (e: any) { setError(e?.message || 'Could not save'); } finally { setBusy(false); }
  };

  const pick = (label: string, current: number | null, set: (id: number) => void, skip: number | null) => (
    <>
      <Text style={st.label}>{label}</Text>
      <View style={st.grid}>
        {accounts.filter(x => x.id !== skip).map((x: Account) => {
          const on = x.id === current;
          return (
            <Pressable key={x.id} onPress={() => { set(x.id); setError(''); }} style={[st.card, on && st.cardOn]}>
              <AccountBubble type={x.type} size={28} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={st.name} numberOfLines={1}>{x.name}</Text>
                <Text style={st.sub} numberOfLines={1}>{x.last4 ? `•• ${x.last4} · ` : ''}{app.bal(app.balanceOf(x), x.id)}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </>
  );

  return (
    <Sheet visible={visible} onClose={close} title="Transfer between accounts"
      footer={<Button title="Move the money" Icon={Check} onPress={save} busy={busy} />}>
      {pick('From', from, setFrom, to)}
      <View style={st.arrow}><ArrowDown color={colors.muted} size={18} /></View>
      {pick('To', to, setTo, from)}
      <Field label="Amount" value={amount} onChangeText={t => setAmount(t.replace(/[^0-9.,]/g, ''))} keyboardType="decimal-pad" placeholder="0" />
      <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. ATM withdrawal, card bill" maxLength={200} />
      <View style={st.dates}>
        {[['Today', 0], ['Yesterday', -1]].map(([l, d]) => {
          const iso = (() => { const t = new Date(); t.setDate(t.getDate() + (d as number)); return isoDate(t); })();
          return <Pressable key={l as string} onPress={() => setDay(iso)} style={[st.chip, day === iso && st.chipOn]}><Text style={[st.chipText, day === iso && { color: colors.white }]}>{l}</Text></Pressable>;
        })}
      </View>
      {a && b && value > 0 && app.balancesVisible ? (
        <Text style={st.after}>{a.name} will have <Text style={{ fontWeight: '800' }}>{money(app.balanceOf(a) + (a.accountClass === 'LIABILITY' ? 1 : -1) * value)}</Text>, {b.name} <Text style={{ fontWeight: '800' }}>{money(app.balanceOf(b) + (b.accountClass === 'LIABILITY' ? -1 : 1) * value)}</Text></Text>
      ) : null}
      {error ? <Text style={st.error}>{error}</Text> : null}
    </Sheet>
  );
}

const st = StyleSheet.create({
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: colors.muted, textTransform: 'uppercase' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { width: '48.5%', flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: radius.m, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  cardOn: { borderColor: colors.ocean, backgroundColor: colors.oceanSoft },
  name: { fontSize: 12.5, fontWeight: '700', color: colors.text },
  sub: { fontSize: 11, color: colors.muted },
  arrow: { alignItems: 'center' },
  dates: { flexDirection: 'row', gap: 6 },
  chip: { paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { fontSize: 12.5, fontWeight: '700', color: colors.text2 },
  after: { fontSize: 12.5, color: colors.text2 },
  error: { color: colors.red, fontWeight: '600', fontSize: 13 },
});
