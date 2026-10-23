/**
 * To collect: money paid for someone and money lent (owed to me), and what I borrowed or owe, from the server, with
 * those recorded on the phone that wait to sync. Each shows what is still owed, how much came back and when it is
 * due; a tap opens it to every detail and the money received so far. "Received back" records money that came back
 * (offline too: it goes up at the next sync) and "Remind" sends a WhatsApp message.
 */
import React, { useMemo, useState } from 'react';
import { LayoutAnimation, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AlertTriangle, ArrowUpRight, Check, ChevronDown, ChevronUp, Clock, HandCoins, HandHeart, MessageCircle, Plus, Search, Trash2, Undo2, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state';
import { Claim, LocalRecord, owedToMe } from '../data';
import { date, isoDate, money, moneyShort, shortDate } from '../format';
import { AccountBubble, Button, Card, Chip, Empty, Field, GradientPanel, IconBubble, Pill, Sheet } from '../ui';
import { colors, radius, space } from '../theme';
import type { RecordMode } from './AddExpense';

type Filter = 'open' | 'PAID_FOR' | 'LENT' | 'OWE' | 'settled';

const LOOK: Record<string, [any, string, string]> = {
  PAID_FOR: [HandHeart, colors.violet, colors.violetSoft],
  LENT: [HandCoins, colors.aqua, colors.aquaSoft],
  BORROWED: [ArrowUpRight, colors.red, colors.redSoft],
  BILL_DUE: [ArrowUpRight, colors.coral, colors.coralSoft],
};
const INTO_TYPES = ['BANK', 'CASH', 'WALLET'];

export function ClaimsList({ header, onRecord }: { header: React.ReactNode; onRecord: (m: RecordMode) => void }) {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>('open');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [receiving, setReceiving] = useState<Claim | null>(null);

  const claims = app.snapshot?.claims || [];
  const local = app.records.filter(r => r.kind === 'CLAIM');
  // money back recorded on the phone and not yet synced, by claim
  const back = useMemo(() => {
    const m = new Map<number, number>();
    app.records.filter(r => r.kind === 'REPAYMENT' && r.status !== 'SYNCED').forEach(r => m.set(r.payload.claimId, (m.get(r.payload.claimId) || 0) + Number(r.payload.principal || 0)));
    return m;
  }, [app.records]);
  const left = (c: Claim) => Math.max(0, c.outstanding - (back.get(c.id) || 0));

  const toCollect = claims.filter(owedToMe).reduce((s, c) => s + left(c), 0) + local.filter(r => r.status !== 'SYNCED').reduce((s, r) => s + r.amount, 0);
  const iOwe = claims.filter(c => !owedToMe(c)).reduce((s, c) => s + left(c), 0);
  const overdue = claims.filter(c => c.overdue && left(c) > 0);
  const sum = (k: string) => claims.filter(c => c.kind === k).reduce((s, c) => s + left(c), 0);

  const q = query.trim().toLowerCase();
  const shown = claims.filter(c => {
    const settled = left(c) <= 0 || c.status === 'SETTLED' || c.status === 'WRITTEN_OFF';
    if (filter === 'settled' ? !settled : settled) return false;
    if (filter === 'PAID_FOR' || filter === 'LENT') { if (c.kind !== filter) return false; }
    if (filter === 'OWE' && owedToMe(c)) return false;
    return !q || [c.party, c.narration, c.reference, c.notes].some(v => v && v.toLowerCase().includes(q));
  }).sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.date.localeCompare(a.date));
  const waiting = local.filter(r => (filter === 'open' || filter === r.payload.kind) && (!q || r.title.toLowerCase().includes(q) || String(r.payload.party).toLowerCase().includes(q)));
  const toggle = (k: string) => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setOpen(o => (o === k ? null : k)); };

  return (
    <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: space.l, paddingTop: insets.top + space.m, paddingBottom: 120, gap: space.s }}
      refreshControl={<RefreshControl refreshing={app.syncing} onRefresh={() => app.sync()} colors={[colors.ocean]} />}>
      {header}
      <GradientPanel from={colors.navy} to={colors.violet}>
        <Text style={st.label}>TO COLLECT</Text>
        <Text style={st.big}>{money(toCollect)}</Text>
        <View style={st.pills}>
          <Pill text={`Paid for ${moneyShort(sum('PAID_FOR'))}`} fg="rgba(255,255,255,0.9)" bg="rgba(255,255,255,0.14)" Icon={HandHeart} />
          <Pill text={`Lent ${moneyShort(sum('LENT'))}`} fg="rgba(255,255,255,0.9)" bg="rgba(255,255,255,0.14)" Icon={HandCoins} />
          {overdue.length ? <Pill text={`${overdue.length} overdue`} fg="#ffd68a" bg="rgba(255,255,255,0.14)" Icon={AlertTriangle} /> : null}
          {iOwe ? <Pill text={`I owe ${moneyShort(iOwe)}`} fg="#ffc4c4" bg="rgba(255,255,255,0.14)" Icon={ArrowUpRight} /> : null}
        </View>
      </GradientPanel>
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Button title="Paid for someone" kind="soft" Icon={HandHeart} onPress={() => onRecord('PAID_FOR')} style={{ flex: 1, height: 42 }} />
        <Button title="Lent money" kind="soft" Icon={HandCoins} onPress={() => onRecord('LENT')} style={{ flex: 1, height: 42 }} />
      </View>
      <View style={st.search}>
        <Search color={colors.muted} size={16} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search a person or what it was for" placeholderTextColor={colors.muted} style={st.searchInput} autoCorrect={false} />
        {query ? <Pressable onPress={() => setQuery('')} hitSlop={8}><X color={colors.muted} size={16} /></Pressable> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        <Chip label="Open" selected={filter === 'open'} onPress={() => setFilter('open')} />
        <Chip label="Paid for" selected={filter === 'PAID_FOR'} onPress={() => setFilter('PAID_FOR')} />
        <Chip label="Lent" selected={filter === 'LENT'} onPress={() => setFilter('LENT')} />
        {claims.some(c => !owedToMe(c)) ? <Chip label="I owe" selected={filter === 'OWE'} onPress={() => setFilter('OWE')} /> : null}
        <Chip label="Settled" selected={filter === 'settled'} onPress={() => setFilter('settled')} />
      </ScrollView>

      {filter !== 'settled' && filter !== 'OWE' ? waiting.map(r => <LocalClaim key={r.clientId} r={r} />) : null}
      {shown.map(c => (
        <ClaimCard key={c.id} c={c} left={left(c)} pendingBack={back.get(c.id) || 0} open={open === String(c.id)} onToggle={() => toggle(String(c.id))}
          onReceive={() => setReceiving(c)} />
      ))}
      {!shown.length && !(filter !== 'settled' && waiting.length) ? (
        <Empty Icon={HandCoins} title={q ? 'Nothing matches' : filter === 'settled' ? 'Nothing settled yet' : 'Nothing to collect'}
          text={q ? undefined : 'Paid a bill for someone or lent money? Record it here and see it come back.'} />
      ) : null}
      {receiving ? <ReceiveSheet claim={receiving} left={left(receiving)} onClose={() => setReceiving(null)} /> : null}
    </ScrollView>
  );
}

/** One recorded on the phone, waiting to sync. */
function LocalClaim({ r }: { r: LocalRecord }) {
  const app = useApp();
  const [Icon, fg, bg] = LOOK[r.payload.kind] || LOOK.PAID_FOR;
  const failed = r.status === 'FAILED';
  return (
    <Card style={st.card}>
      <View style={st.top}>
        <IconBubble Icon={Icon} fg={fg} bg={bg} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.title} numberOfLines={1}>{r.payload.party}</Text>
          <Text style={st.sub} numberOfLines={1}>{r.title} · {shortDate(r.date)} · from {r.accountName}</Text>
        </View>
        <Text style={st.amount}>{money(r.amount)}</Text>
      </View>
      <View style={st.row}>
        <Pill text={failed ? `Not accepted: ${r.message || ''}` : r.status === 'SYNCED' ? 'Synced' : 'Waiting to sync'} fg={failed ? colors.red : colors.gold}
          bg={failed ? colors.redSoft : colors.goldSoft} Icon={failed ? AlertTriangle : Clock} />
        <View style={{ flex: 1 }} />
        {r.status !== 'SYNCED' ? <Pressable onPress={() => app.removeRecord(r.clientId)} hitSlop={8}><Trash2 color={colors.red} size={17} /></Pressable> : null}
      </View>
    </Card>
  );
}

function ClaimCard({ c, left, pendingBack, open, onToggle, onReceive }:
  { c: Claim; left: number; pendingBack: number; open: boolean; onToggle: () => void; onReceive: () => void }) {
  const app = useApp();
  const [Icon, fg, bg] = LOOK[c.kind] || LOOK.PAID_FOR;
  const mine = owedToMe(c);
  const done = left <= 0;
  const pct = c.amount > 0 ? Math.min(100, ((c.amount - left) / c.amount) * 100) : 0;
  const days = c.dueDate ? Math.round((new Date(`${c.dueDate}T00:00:00`).getTime() - new Date(`${isoDate()}T00:00:00`).getTime()) / 86400000) : null;
  const detail = (k: string, v?: string | null) => (v ? <View style={st.kv} key={k}><Text style={st.k}>{k}</Text><Text style={st.v} selectable>{v}</Text></View> : null);
  const remind = () => {
    const text = `Hi ${c.party}, a gentle reminder about ${money(left)}${c.narration ? ` for ${c.narration}` : ''} from ${date(c.date)}.`
      + `${c.dueDate ? ` It was due on ${date(c.dueDate)}.` : ''} Thank you!`;
    Linking.openURL(`whatsapp://send?text=${encodeURIComponent(text)}`).catch(() => app.notify('WhatsApp is not installed'));
  };
  return (
    <Card style={[st.card, open && { borderColor: colors.ocean2 }]} onPress={onToggle}>
      <View style={st.top}>
        <IconBubble Icon={Icon} fg={fg} bg={bg} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.title} numberOfLines={1}>{c.party}</Text>
          <Text style={st.sub} numberOfLines={open ? 3 : 1}>{[c.kind === 'PAID_FOR' ? 'Paid for' : c.kindLabel, c.narration, shortDate(c.date)].filter(Boolean).join(' · ')}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 3 }}>
          <Text style={[st.amount, { color: done ? colors.green : mine ? colors.text : colors.red }]}>{money(done ? c.amount : left)}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={[st.due, c.overdue && !done && { color: colors.red }]}>
              {done ? 'Settled' : c.overdue ? `Overdue ${-(days || 0)}d` : days !== null ? (days === 0 ? 'Due today' : `Due in ${days}d`) : `of ${moneyShort(c.amount)}`}
            </Text>
            {open ? <ChevronUp color={colors.muted} size={15} /> : <ChevronDown color={colors.muted} size={15} />}
          </View>
        </View>
      </View>
      {!done ? <View style={st.bar}><View style={[st.fill, { width: `${pct}%`, backgroundColor: fg }]} /></View> : null}
      {pendingBack ? <Text style={[st.sub, { color: colors.gold }]}>{money(pendingBack)} received on the phone, waiting to sync</Text> : null}
      {open ? (
        <View style={st.more}>
          <View style={st.grid}>
            {detail('Amount', money(c.amount))}
            {detail(mine ? 'Received back' : 'Paid back', c.repaid ? money(c.repaid) : null)}
            {detail('Still owed', money(left))}
            {detail('On', date(c.date))}
            {detail('Due', c.dueDate ? date(c.dueDate) : 'No date')}
            {detail(mine ? 'Paid from' : 'Came into', c.accountName)}
            {detail('Interest', c.interestRate ? `${c.interestRate}% a year` : null)}
            {detail('Interest due', c.interestDue ? money(c.interestDue) : null)}
            {detail('Reference', c.reference)}
            {detail('Entry', c.entryNo)}
            {detail('Notes', c.notes)}
          </View>
          {c.repayments.length ? (
            <View style={{ gap: 4 }}>
              <Text style={st.k}>{mine ? 'Received' : 'Paid'}</Text>
              {c.repayments.map((r, i) => (
                <View key={i} style={st.pay}>
                  <Undo2 color={r.writeOff ? colors.muted : colors.green} size={14} />
                  <Text style={st.payText}>{shortDate(r.date)}{r.accountName ? ` · ${r.accountName}` : ''}{r.writeOff ? ' · written off' : ''}</Text>
                  <Text style={st.payAmt}>{money(r.principal + (r.interest || 0))}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {mine && !done ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="Remind" kind="ghost" Icon={MessageCircle} onPress={remind} style={{ height: 40 }} />
              {app.snapshot?.canRecord !== false ? <Button title="Received back" kind="soft" Icon={Plus} onPress={onReceive} style={{ flex: 1, height: 40 }} /> : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

/** Money that came back on a claim: how much (all of it by default), any interest, the account it came into, the day. */
function ReceiveSheet({ claim, left, onClose }: { claim: Claim; left: number; onClose: () => void }) {
  const app = useApp();
  const into = useMemo(() => app.accounts.filter(a => a.group === 'OWN' && INTO_TYPES.includes(a.type)), [app.accounts]);
  const [amount, setAmount] = useState(String(left));
  const [interest, setInterest] = useState(claim.interestDue ? String(Math.round(claim.interestDue)) : '');
  const [account, setAccount] = useState<number | null>(into[0]?.id ?? null);
  const [day, setDay] = useState(isoDate());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const value = Number(amount.replace(/[,₹\s]/g, '')) || 0;
  const extra = Number(interest.replace(/[,₹\s]/g, '')) || 0;
  const acc = into.find(a => a.id === account);
  const save = async () => {
    if (!(value > 0) && !(extra > 0)) { setError('Enter what came back'); return; }
    if (value > left + 0.005) { setError(`Only ${money(left)} is still owed`); return; }
    if (!acc) { setError('Pick the account it came into'); return; }
    await app.addRecord({
      kind: 'REPAYMENT', title: `From ${claim.party}`, sub: claim.narration || claim.kindLabel, date: day, amount: value + extra, accountId: acc.id,
      accountName: acc.name, flow: 'IN',
      payload: { claimId: claim.id, date: day, principal: value, interest: extra || null, accountId: acc.id, notes: notes.trim() || null },
    });
    app.notify(value >= left ? `${claim.party} has paid it all back` : `${money(value)} received · ${money(left - value)} still owed`);
    onClose();
  };
  return (
    <Sheet visible onClose={onClose} title={`Received from ${claim.party}`}
      footer={<Button title="Save" Icon={Check} onPress={save} />}>
      <Text style={st.sub}>{claim.narration || claim.kindLabel} · {money(left)} still owed</Text>
      <View style={st.chips}>
        {[left, Math.round(left / 2)].filter((v, i, a) => v > 0 && a.indexOf(v) === i).map(v => (
          <Chip key={v} label={v === left ? `All · ${money(v)}` : `Half · ${money(v)}`} selected={value === v} onPress={() => setAmount(String(v))} />
        ))}
      </View>
      <Field label="Amount back" value={amount} onChangeText={t => setAmount(t.replace(/[^0-9.,]/g, ''))} keyboardType="decimal-pad" />
      {claim.kind === 'LENT' && claim.interestRate ? (
        <Field label="Interest received" value={interest} onChangeText={t => setInterest(t.replace(/[^0-9.,]/g, ''))} keyboardType="decimal-pad" placeholder="0" />
      ) : null}
      <View style={st.chips}>
        {[0, 1].map(n => { const d = new Date(); d.setDate(d.getDate() - n); const iso = isoDate(d);
          return <Chip key={n} label={n ? 'Yesterday' : 'Today'} selected={day === iso} onPress={() => setDay(iso)} />; })}
      </View>
      <Text style={st.k}>Came into</Text>
      <View style={st.accounts}>
        {into.map(a => (
          <Pressable key={a.id} onPress={() => setAccount(a.id)} style={[st.acc, a.id === account && st.accOn]}>
            <AccountBubble type={a.type} size={26} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.accName} numberOfLines={1}>{a.name}</Text>
              <Text style={st.sub} numberOfLines={1}>{money(app.balanceOf(a))}</Text>
            </View>
          </Pressable>
        ))}
      </View>
      <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="Optional" maxLength={255} />
      {error ? <Text style={{ color: colors.red, fontWeight: '600' }}>{error}</Text> : null}
    </Sheet>
  );
}

const st = StyleSheet.create({
  label: { color: 'rgba(255,255,255,0.6)', fontSize: 10.5, fontWeight: '800', letterSpacing: 1 },
  big: { color: colors.white, fontSize: 30, fontWeight: '800', marginTop: 2 },
  pills: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, borderRadius: radius.m, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.card, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 14.5, color: colors.text, paddingVertical: 0 },
  card: { paddingVertical: 10, gap: 8 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 14.5, fontWeight: '800', color: colors.text },
  sub: { fontSize: 12, color: colors.muted, marginTop: 1 },
  amount: { fontSize: 15, fontWeight: '800', color: colors.text },
  due: { fontSize: 11, fontWeight: '700', color: colors.muted },
  bar: { height: 5, borderRadius: 3, backgroundColor: colors.sunken, overflow: 'hidden' },
  fill: { height: 5, borderRadius: 3 },
  more: { paddingTop: space.s, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line, gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 },
  kv: { width: '50%', paddingRight: 8 },
  k: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.5, color: colors.muted, textTransform: 'uppercase' },
  v: { fontSize: 13.5, color: colors.text, fontWeight: '600', marginTop: 1 },
  pay: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  payText: { flex: 1, fontSize: 12.5, color: colors.text2 },
  payAmt: { fontSize: 13, fontWeight: '800', color: colors.green },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  accounts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  acc: { width: '48.5%', flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: radius.m, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  accOn: { borderColor: colors.ocean, backgroundColor: colors.oceanSoft },
  accName: { fontSize: 12.5, fontWeight: '700', color: colors.text },
});
