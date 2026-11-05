/**
 * EMIs: every plan running (bought on a card EMI or a loan), how far it is paid, what is due next and what is still
 * owed. A tap opens the instalments to come; "Pay EMI" pays the next one (or a few) from the bank (a card EMI: the bank
 * pays into the card). A card EMI can be billed by itself, and its amount set as on the card's statement, before billing or
 * until it is paid. Offline too: it goes up at the next sync and the account's balance moves at once.
 */
import React, { useMemo, useState } from 'react';
import { LayoutAnimation, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AlertTriangle, CalendarClock, Check, CheckCircle2, ChevronDown, ChevronUp, Clock, CreditCard, Landmark, Pencil, Receipt, Trash2 } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state';
import { Emi, EmiInstalment, emiLeft, emiWhole, interestForTotal } from '../data';
import { date, isoDate, money, moneyShort, shortDate } from '../format';
import { AccountBubble, Button, Card, Chip, Empty, GradientPanel, IconBubble, Pill, Sheet } from '../ui';
import { colors, radius, space } from '../theme';

const FROM_TYPES = ['BANK', 'CASH', 'WALLET'];

type Figures = { principal: string; interest: string; gst: string; total: string };
const figuresOf = (i: EmiInstalment): Figures => ({ principal: String(i.principal ?? 0), interest: String(i.interest ?? 0), gst: String(i.gst ?? 0), total: String(emiWhole(i)) });
const num = (v: string) => Number(v.replace(/,/g, '')) || 0;
const sameFigures = (f: Figures, i: EmiInstalment) => num(f.principal) === (i.principal ?? 0) && num(f.interest) === (i.interest ?? 0) && num(f.gst) === (i.gst ?? 0);

export function EmisList({ header }: { header: React.ReactNode }) {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState<number | null>(null);
  const [paying, setPaying] = useState<Emi | null>(null);
  const [billing, setBilling] = useState<{ emi: Emi; instalment: EmiInstalment } | null>(null);
  const emis = app.snapshot?.emis || [];
  // EMIs paid on the phone and not yet synced, by plan
  const waiting = useMemo(() => {
    const m = new Map<number, number>();
    app.records.filter(r => r.kind === 'EMI_PAY' && r.status !== 'SYNCED' && !r.payload.billOnly).forEach(r => m.set(r.payload.planId, (m.get(r.payload.planId) || 0) + Number(r.payload.count || 1)));
    return m;
  }, [app.records]);
  // bills made on the phone and not yet synced, by instalment: what it was billed at
  const billedHere = useMemo(() => {
    const m = new Map<number, number>();
    app.records.filter(r => r.kind === 'EMI_PAY' && r.status !== 'SYNCED' && r.payload.billOnly).forEach(r => m.set(r.payload.installmentId, num(String(r.payload.principal)) + num(String(r.payload.interest)) + num(String(r.payload.gst))));
    return m;
  }, [app.records]);
  const month = isoDate().slice(0, 7);
  const thisMonth = emis.reduce((s, e) => s + e.instalments.filter(i => i.dueDate.startsWith(month) && i.status !== 'PAID').reduce((t, i) => t + emiLeft(i), 0), 0);
  const outstanding = emis.reduce((s, e) => s + e.stillToPay, 0);
  const overdue = emis.filter(e => e.overdueAmount > 0);
  const failed = app.records.filter(r => r.kind === 'EMI_PAY' && r.status === 'FAILED');
  const toggle = (id: number) => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setOpen(o => (o === id ? null : id)); };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.l, paddingTop: insets.top + space.m, paddingBottom: 120, gap: space.s }}
      refreshControl={<RefreshControl refreshing={app.syncing} onRefresh={() => app.sync()} colors={[colors.ocean]} />}>
      {header}
      <GradientPanel from={colors.navy} to={colors.navy2}>
        <Text style={st.label}>EMIS DUE THIS MONTH</Text>
        <Text style={st.big}>{money(thisMonth)}</Text>
        <View style={st.pills}>
          <Pill text={`${emis.length} running`} fg="rgba(255,255,255,0.9)" bg="rgba(255,255,255,0.14)" Icon={CalendarClock} />
          <Pill text={`Still to pay ${moneyShort(outstanding)}`} fg="rgba(255,255,255,0.9)" bg="rgba(255,255,255,0.14)" />
          {overdue.length ? <Pill text={`${overdue.length} overdue`} fg="#ffd68a" bg="rgba(255,255,255,0.14)" Icon={AlertTriangle} /> : null}
        </View>
      </GradientPanel>
      {failed.map(r => (
        <Card key={r.clientId} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <AlertTriangle color={colors.red} size={16} />
          <Text style={[st.sub, { flex: 1, color: colors.red }]}>{r.title}: {r.message || 'not accepted'}</Text>
          <Pressable onPress={() => app.removeRecord(r.clientId)} hitSlop={8}><Trash2 color={colors.red} size={16} /></Pressable>
        </Card>
      ))}
      {emis.map(e => <EmiCard key={e.id} e={e} waiting={waiting.get(e.id) || 0} billedHere={billedHere} open={open === e.id} onToggle={() => toggle(e.id)} onPay={() => setPaying(e)} onBill={i => setBilling({ emi: e, instalment: i })} />)}
      {!emis.length ? <Empty Icon={CalendarClock} title="No EMIs running" text="Bought something on EMI? Add it on the full site (Expenses, On EMI): it shows here with every instalment." /> : null}
      {paying ? <PayEmi emi={paying} waiting={waiting.get(paying.id) || 0} onClose={() => setPaying(null)} /> : null}
      {billing ? <BillEmi emi={billing.emi} instalment={billing.instalment} onClose={() => setBilling(null)} /> : null}
    </ScrollView>
  );
}

function EmiCard({ e, waiting, billedHere, open, onToggle, onPay, onBill }: { e: Emi; waiting: number; billedHere: Map<number, number>; open: boolean; onToggle: () => void; onPay: () => void;
  onBill: (i: EmiInstalment) => void }) {
  const app = useApp();
  const card = e.kind === 'CARD';
  const paid = Math.min(e.months, e.paidCount + waiting);
  const pct = e.months ? (paid / e.months) * 100 : 0;
  const upcoming = e.instalments.filter(i => i.status !== 'PAID').slice(waiting, waiting + 6);
  const next = upcoming[0];
  const canRecord = app.snapshot?.canRecord !== false;
  // can be billed or changed: needs the figures from a newer server, and not already waiting to go up
  const canBill = card && canRecord && !!next && next.id != null && !billedHere.has(next.id);
  const days = e.nextDueDate ? Math.round((new Date(`${e.nextDueDate}T00:00:00`).getTime() - new Date(`${isoDate()}T00:00:00`).getTime()) / 86400000) : null;
  return (
    <Card style={[st.card, open && { borderColor: colors.ocean2 }]} onPress={onToggle}>
      <View style={st.top}>
        <IconBubble Icon={card ? CreditCard : Landmark} fg={card ? colors.coral : colors.violet} bg={card ? colors.coralSoft : colors.violetSoft} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.title} numberOfLines={1}>{e.narration}</Text>
          <Text style={st.sub} numberOfLines={1}>{[e.lender, card ? 'Card EMI' : 'Loan EMI', `${paid}/${e.months} paid`].filter(Boolean).join(' · ')}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 3 }}>
          <Text style={st.amount}>{money(e.emiAmount)}</Text>
          <Text style={[st.due, e.overdueAmount > 0 && { color: colors.red }]}>
            {e.overdueAmount > 0 ? `${money(e.overdueAmount)} overdue` : e.nextDueDate ? (days === 0 ? 'Due today' : `Next ${shortDate(e.nextDueDate)}`) : 'All paid'}
          </Text>
        </View>
      </View>
      <View style={st.bar}><View style={[st.fill, { width: `${pct}%` }]} /></View>
      <View style={st.row}>
        <Text style={st.sub}>Still to pay {money(e.stillToPay)}{e.endDate ? ` · ends ${shortDate(e.endDate)}` : ''}</Text>
        <View style={{ flex: 1 }} />
        {waiting ? <Pill text={`${waiting} paid on the phone`} fg={colors.gold} bg={colors.goldSoft} Icon={Clock} /> : null}
        {open ? <ChevronUp color={colors.muted} size={15} /> : <ChevronDown color={colors.muted} size={15} />}
      </View>
      {open ? (
        <View style={st.more}>
          {upcoming.map(i => (
            <View key={i.seq} style={st.inst}>
              <Text style={[st.no, i.overdue && { color: colors.red }]}>{i.seq}</Text>
              <Text style={st.instDate}>{date(i.dueDate)}{i.id != null && billedHere.has(i.id) ? ' · billing' : i.status === 'BILLED' ? ' · billed' : ''}{(i.paidTowards || 0) > 0 ? ` · ${moneyShort(i.paidTowards as number)} paid` : ''}</Text>
              {i.scheduledAmount != null ? <Pencil color={colors.muted} size={11} /> : null}
              <Text style={[st.instAmt, i.overdue && { color: colors.red }]}>{money(i.id != null && billedHere.has(i.id) ? (billedHere.get(i.id) as number) : emiWhole(i))}</Text>
            </View>
          ))}
          {e.instalments.length > upcoming.length + paid ? <Text style={st.sub}>…and {e.instalments.length - upcoming.length - paid} more</Text> : null}
          {canBill && next ? (
            <Button title={next.status === 'BILLED' ? `Change EMI ${next.seq}'s amount` : `Bill EMI ${next.seq}`} Icon={next.status === 'BILLED' ? Pencil : Receipt} kind="soft" onPress={() => onBill(next)} style={{ height: 40 }} />
          ) : null}
          {e.left - waiting > 0 && canRecord ? (
            <Button title={card ? 'Pay EMI into the card' : 'Pay EMI'} Icon={CheckCircle2} kind="soft" onPress={onPay} style={{ height: 40 }} />
          ) : null}
          {e.payableBalance != null ? <Text style={st.sub}>Still on {e.payableAccountName || 'Payables'}: {money(e.payableBalance)}</Text> : null}
          <Text style={st.sub}>{e.payAccountName ? `${card ? 'Billed on' : 'Paid from'} ${e.payAccountName}` : ''}</Text>
        </View>
      ) : null}
    </Card>
  );
}

/** Pays the next EMI (or a few): from which account and on which day. */
function PayEmi({ emi, waiting, onClose }: { emi: Emi; waiting: number; onClose: () => void }) {
  const app = useApp();
  const card = emi.kind === 'CARD';
  const from = useMemo(() => app.accounts.filter(a => a.group === 'OWN' && FROM_TYPES.includes(a.type) && (!card || a.type === 'BANK')), [app.accounts, card]);
  const preferred = !card && from.some(a => a.id === emi.payAccountId) ? emi.payAccountId : from[0]?.id ?? null;
  const [account, setAccount] = useState<number | null>(preferred);
  const [count, setCount] = useState(Math.max(1, Math.min(emi.dueNow - waiting, emi.left - waiting)) || 1);
  const [day, setDay] = useState(isoDate());
  const left = emi.left - waiting;
  const acc = from.find(a => a.id === account);
  const rows = emi.instalments.filter(i => i.status !== 'PAID').slice(waiting, waiting + count);
  // one card EMI can be set as on the statement while paying it (a snapshot from an older server has no figures)
  const one = card && count === 1 && rows[0]?.id != null ? rows[0] : null;
  const [figures, setFigures] = useState<Figures | null>(null);
  const shown = one ? figures ?? figuresOf(one) : null;
  const amount = Math.round((shown && one ? num(shown.total) - (one.paidTowards || 0) : rows.reduce((s, i) => s + emiLeft(i), 0) || emi.emiAmount * count) * 100) / 100;
  const save = async () => {
    if (!acc) { app.notify('Pick the account it is paid from'); return; }
    const changed = shown && one && !sameFigures(shown, one);
    if (changed && num(shown.total) < (one.paidTowards || 0)) { app.notify(`${money(one.paidTowards as number)} is already paid towards it`); return; }
    await app.addRecord({
      kind: 'EMI_PAY', title: `EMI of ${emi.narration}`, sub: `${count} EMI${count === 1 ? '' : 's'}${card ? ' into the card' : ''}`, date: day, amount,
      accountId: acc.id, accountName: acc.name, flow: 'OUT', payload: { planId: emi.id, count, date: day, accountId: acc.id,
        ...(changed && one ? { installmentId: one.id, principal: num(shown.principal), interest: num(shown.interest), gst: num(shown.gst) } : {}) },
    });
    app.notify(`${money(amount)} paid · ${emi.narration}`);
    onClose();
  };
  return (
    <Sheet visible onClose={onClose} title={card ? 'Pay the EMI into the card' : 'Pay EMI'}
      footer={<Button title={`Pay ${money(amount)}`} Icon={Check} onPress={save} />}>
      <Text style={st.sub}>{emi.narration} · {money(emi.emiAmount)} a month · {left} left{one && (one.paidTowards || 0) > 0 ? ` · ${money(one.paidTowards as number)} paid already` : ''}</Text>
      <Text style={st.k}>How many</Text>
      <View style={st.chips}>
        {[1, 2, 3, 6].filter(n => n <= left).map(n => <Chip key={n} label={n === 1 ? 'Next one' : `${n} EMIs`} selected={count === n} onPress={() => setCount(n)} />)}
        {left > 6 ? null : left > 1 && ![1, 2, 3, 6].includes(left) ? <Chip label={`All ${left}`} selected={count === left} onPress={() => setCount(left)} /> : null}
      </View>
      {shown && one ? <FigureFields emi={emi} instalment={one} value={shown} onChange={setFigures} /> : null}
      <View style={st.chips}>
        {[0, 1].map(n => { const d = new Date(); d.setDate(d.getDate() - n); const iso = isoDate(d);
          return <Chip key={n} label={n ? 'Yesterday' : 'Today'} selected={day === iso} onPress={() => setDay(iso)} />; })}
      </View>
      <Text style={st.k}>{card ? 'Paid into the card from' : 'Paid from'}</Text>
      <View style={st.accounts}>
        {from.map(a => (
          <Pressable key={a.id} onPress={() => setAccount(a.id)} style={[st.acc, a.id === account && st.accOn]}>
            <AccountBubble type={a.type} size={26} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.accName} numberOfLines={1}>{a.name}</Text>
              <Text style={st.sub} numberOfLines={1}>{app.bal(app.balanceOf(a), a.id)}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

/** The statement's figures: the total, and what makes it up. Changing the total changes the interest. */
function FigureFields({ emi, instalment, value, onChange }: { emi: Emi; instalment: EmiInstalment; value: Figures; onChange: (f: Figures) => void }) {
  const planned = instalment.scheduledAmount ?? emiWhole(instalment);
  // an older plan's principal was charged with the purchase; the last EMI's has to clear what was financed
  const later = emi.instalments.some(i => i.status === 'DUE' && i.seq > instalment.seq);
  const lockPrincipal = !emi.payableAccountName || !later;
  const parts = (f: Figures, key: keyof Figures, text: string): Figures => {
    const next = { ...f, [key]: text };
    return { ...next, total: String(Math.round((num(next.principal) + num(next.interest) + num(next.gst)) * 100) / 100) };
  };
  const diff = Math.round((num(value.total) - planned) * 100) / 100;
  const moved = Math.round(((instalment.principal ?? 0) - num(value.principal)) * 100) / 100;
  const box = (label: string, text: string, onText: (t: string) => void, editable = true) => (
    <View style={st.fig}>
      <Text style={st.k}>{label}</Text>
      <TextInput value={text} onChangeText={onText} editable={editable} keyboardType="decimal-pad" selectTextOnFocus style={[st.figInput, !editable && { color: colors.muted }]} />
    </View>
  );
  return (
    <View style={st.figs}>
      <View style={st.figRow}>{box('Amount on the statement', value.total, t => onChange({ ...value, total: t, interest: String(interestForTotal(num(t), num(value.principal), num(value.gst))) }))}</View>
      <View style={st.figRow}>
        {box('Principal', value.principal, t => onChange(parts(value, 'principal', t)), !lockPrincipal)}
        {box('Interest', value.interest, t => onChange(parts(value, 'interest', t)))}
        {box('GST', value.gst, t => onChange(parts(value, 'gst', t)))}
      </View>
      <Text style={st.sub}>{diff ? `${money(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than the schedule's ${money(planned)}.` : 'As the schedule says.'}{moved ? ` The ${money(Math.abs(moved))} of principal ${moved > 0 ? 'moves to' : 'comes off'} the last EMI, so the plan still repays what was financed.` : ''}</Text>
    </View>
  );
}

/** Bills a card EMI, or changes one billed and not paid yet: the amount as on the card's statement. */
function BillEmi({ emi, instalment, onClose }: { emi: Emi; instalment: EmiInstalment; onClose: () => void }) {
  const app = useApp();
  const billed = instalment.status === 'BILLED';
  const [figures, setFigures] = useState<Figures>(figuresOf(instalment));
  const [day, setDay] = useState(isoDate());
  const paid = instalment.paidTowards || 0;
  const save = async () => {
    const total = num(figures.total);
    if (total <= 0) { app.notify('Enter what the statement billed'); return; }
    if (total < paid) { app.notify(`${money(paid)} is already paid towards it`); return; }
    if (billed && sameFigures(figures, instalment)) { onClose(); return; }
    // the card's balance moves by what this adds: the whole EMI, or the change to one billed
    const moves = Math.round((billed ? total - emiWhole(instalment) : total) * 100) / 100;
    await app.addRecord({
      kind: 'EMI_PAY', title: `${billed ? 'Bill changed' : 'Billed'}: EMI ${instalment.seq} of ${emi.narration}`, sub: `on ${emi.payAccountName || 'the card'}`, date: day, amount: Math.abs(moves),
      accountId: emi.payAccountId, accountName: emi.payAccountName || '', flow: moves >= 0 ? 'OUT' : 'IN',
      payload: { planId: emi.id, date: billed ? null : day, installmentId: instalment.id, principal: num(figures.principal), interest: num(figures.interest), gst: num(figures.gst), billOnly: true },
    });
    app.notify(`EMI ${instalment.seq} ${billed ? 'changed' : 'billed'} · ${money(total)}`);
    onClose();
  };
  return (
    <Sheet visible onClose={onClose} title={`${billed ? 'Change the bill of' : 'Bill'} EMI ${instalment.seq} of ${emi.months}`}
      footer={<Button title={billed ? 'Save' : `Bill ${money(num(figures.total))}`} Icon={Check} onPress={save} />}>
      <Text style={st.sub}>{emi.narration} · on {emi.payAccountName}</Text>
      <FigureFields emi={emi} instalment={instalment} value={figures} onChange={setFigures} />
      {billed ? null : (
        <View style={st.chips}>
          {[0, 1].map(n => { const d = new Date(); d.setDate(d.getDate() - n); const iso = isoDate(d);
            return <Chip key={n} label={n ? 'Yesterday' : 'Today'} selected={day === iso} onPress={() => setDay(iso)} />; })}
        </View>
      )}
    </Sheet>
  );
}

const st = StyleSheet.create({
  figs: { gap: 8 },
  figRow: { flexDirection: 'row', gap: 8 },
  fig: { flex: 1, minWidth: 0, gap: 3 },
  figInput: { height: 42, borderRadius: radius.m, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, paddingHorizontal: 10, fontSize: 14.5, fontWeight: '700', color: colors.text, textAlign: 'right' },
  label: { color: 'rgba(255,255,255,0.6)', fontSize: 10.5, fontWeight: '800', letterSpacing: 1 },
  big: { color: colors.white, fontSize: 30, fontWeight: '800', marginTop: 2 },
  pills: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  card: { paddingVertical: 10, gap: 8 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 14.5, fontWeight: '800', color: colors.text },
  sub: { fontSize: 12, color: colors.muted },
  amount: { fontSize: 15, fontWeight: '800', color: colors.text },
  due: { fontSize: 11, fontWeight: '700', color: colors.muted },
  bar: { height: 5, borderRadius: 3, backgroundColor: colors.sunken, overflow: 'hidden' },
  fill: { height: 5, borderRadius: 3, backgroundColor: colors.violet },
  more: { paddingTop: space.s, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line, gap: 6 },
  inst: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  no: { width: 26, fontSize: 12, fontWeight: '800', color: colors.muted, textAlign: 'center' },
  instDate: { flex: 1, fontSize: 13, color: colors.text2 },
  instAmt: { fontSize: 13, fontWeight: '800', color: colors.text },
  k: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.5, color: colors.muted, textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  accounts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  acc: { width: '48.5%', flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: radius.m, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  accOn: { borderColor: colors.ocean, backgroundColor: colors.oceanSoft },
  accName: { fontSize: 12.5, fontWeight: '700', color: colors.text },
});
