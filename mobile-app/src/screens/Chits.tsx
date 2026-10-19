/**
 * Chits I am a member of: how far each has gone (paid / of months), what is overdue, the next instalment, what is
 * still to pay and its value now. A chit opens to its instalments; an unpaid one can be paid from an account, also
 * offline (it comes off the account's balance at once and goes to the server at the next sync, booked once). When the
 * chit has the organizer's UPI ID, the instalment can be paid with Google Pay or PhonePe first, then recorded.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { BackHandler, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle, ArrowLeft, CalendarClock, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock, HandCoins, Trash2, Wallet } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state';
import { Chit, Installment, liveBalance } from '../data';
import { date, isoDate, money, moneyShort, shortDate } from '../format';
import { AccountBubble, Button, Card, Empty, Field, GradientPanel, Pill, SectionTitle, Sheet } from '../ui';
import { colors, radius, space } from '../theme';
import { UpiApp, UpiButtons, payWith, upiLink, upiNote } from '../upi';

const isPaid = (i: Installment) => i.status === 'PAID';

export function ChitsScreen() {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const [openId, setOpenId] = useState<number | null>(null);
  const chits = app.snapshot?.chits || [];
  const open = chits.find(c => c.id === openId) || null;

  if (open) return <ChitDetail chit={open} onBack={() => setOpenId(null)} />;

  const overdue = chits.reduce((s, c) => s + (c.overdueAmount || 0), 0);
  const still = chits.reduce((s, c) => s + (c.stillToPay || 0), 0);
  const value = chits.reduce((s, c) => s + (c.currentValue || 0), 0);
  const next = chits.filter(c => c.nextDueDate).sort((a, b) => (a.nextDueDate || '').localeCompare(b.nextDueDate || ''))[0];

  return (
    <FlatList
      data={chits}
      keyExtractor={c => String(c.id)}
      contentContainerStyle={{ padding: space.l, paddingTop: insets.top + space.m, paddingBottom: 120, gap: space.s }}
      refreshControl={<RefreshControl refreshing={app.syncing} onRefresh={() => app.sync()} colors={[colors.ocean]} />}
      ListHeaderComponent={
        <View style={{ marginBottom: space.s }}>
          <GradientPanel from={colors.navy} to="#0f7a6e">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <HandCoins color={colors.white} size={22} />
              <Text style={st.h}>My chits</Text>
            </View>
            <View style={st.figs}>
              <View style={st.fig}><Text style={st.figLabel}>Value now</Text><Text style={st.figValue}>{moneyShort(value)}</Text></View>
              <View style={st.fig}><Text style={st.figLabel}>Still to pay</Text><Text style={st.figValue}>{moneyShort(still)}</Text></View>
              <View style={st.fig}><Text style={st.figLabel}>Overdue</Text><Text style={[st.figValue, overdue ? { color: '#ffb4a0' } : null]}>{moneyShort(overdue)}</Text></View>
            </View>
            {next ? <Text style={st.next}>Next: {next.name} · {money(next.nextDueAmount)} on {date(next.nextDueDate)}</Text> : null}
          </GradientPanel>
        </View>
      }
      ListEmptyComponent={<Empty Icon={HandCoins} title="No chits" text={app.snapshot ? 'Chits you are a member of show here (from the server\'s Chits).' : 'Sync once to bring your chits to the phone.'} />}
      renderItem={({ item: c }) => <ChitCard chit={c} onPress={() => setOpenId(c.id)} />}
    />
  );
}

function ChitCard({ chit: c, onPress }: { chit: Chit; onPress: () => void }) {
  const app = useApp();
  const waiting = app.chitQueue.filter(p => p.chitId === c.id && p.status !== 'SYNCED').length;
  const pct = Math.max(0, Math.min(100, c.progressPercent || (c.months ? (c.paidCount / c.months) * 100 : 0)));
  return (
    <Card onPress={onPress} style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={st.icon}><HandCoins color={colors.aqua} size={20} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.name} numberOfLines={1}>{c.name}</Text>
          <Text style={st.meta} numberOfLines={1}>{[c.organizer, c.ticketNo ? `Ticket ${c.ticketNo}` : null, `${money(c.monthlyInstallment)}/month`].filter(Boolean).join(' · ')}</Text>
        </View>
        <ChevronRight color={colors.muted} size={18} />
      </View>
      <View style={st.bar}><View style={[st.fill, { width: `${pct}%` }]} /></View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill text={`${c.paidCount} of ${c.months} paid`} fg={colors.aqua} bg={colors.aquaSoft} Icon={CheckCircle2} />
        {c.overdueCount ? <Pill text={`${c.overdueCount} overdue · ${moneyShort(c.overdueAmount)}`} fg={colors.red} bg={colors.redSoft} Icon={AlertTriangle} /> : null}
        {c.nextDueDate ? <Pill text={`Next ${shortDate(c.nextDueDate)} · ${moneyShort(c.nextDueAmount)}`} Icon={CalendarClock} /> : null}
        {waiting ? <Pill text={`${waiting} paid on the phone`} fg={colors.gold} bg={colors.goldSoft} Icon={Clock} /> : null}
      </View>
    </Card>
  );
}

function ChitDetail({ chit: c, onBack }: { chit: Chit; onBack: () => void }) {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const [paying, setPaying] = useState<Installment | null>(null);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => sub.remove();
  }, [onBack]);
  const local = (i: Installment) => app.chitQueue.find(p => p.installmentId === i.id && p.status !== 'SYNCED');
  const firstUnpaid = c.installments.find(i => !isPaid(i) && !local(i));

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.l, paddingTop: insets.top + space.m, paddingBottom: 120, gap: space.m }}>
        <Pressable onPress={onBack} style={st.back} hitSlop={12}><ArrowLeft color={colors.text} size={20} /><Text style={st.backText}>Chits</Text></Pressable>
        <GradientPanel from={colors.navy} to="#0f7a6e">
          <Text style={st.h}>{c.name}</Text>
          <Text style={st.sub}>{[c.organizer, c.ticketNo ? `Ticket ${c.ticketNo}` : null, `${c.months} months`, c.status].filter(Boolean).join(' · ')}</Text>
          <View style={st.figs}>
            <View style={st.fig}><Text style={st.figLabel}>Paid in</Text><Text style={st.figValue}>{moneyShort(c.paidIn)}</Text></View>
            <View style={st.fig}><Text style={st.figLabel}>Dividends</Text><Text style={st.figValue}>{moneyShort(c.dividends)}</Text></View>
            <View style={st.fig}><Text style={st.figLabel}>Still to pay</Text><Text style={st.figValue}>{moneyShort(c.stillToPay)}</Text></View>
          </View>
          {c.organizerUpi ? <Text style={st.sub}>UPI {c.organizerUpi} · pay with Google Pay or PhonePe</Text> : null}
          <Text style={st.next}>Value now {money(c.currentValue)}{c.maturityAmount ? ` · ${money(c.maturityAmount)} at maturity${c.maturityDate ? ` (${date(c.maturityDate)})` : ''}` : ''}</Text>
        </GradientPanel>
        {firstUnpaid && app.snapshot?.canPayChits ? (
          <Button title={`Pay instalment ${firstUnpaid.no} · ${money(firstUnpaid.dueAmount - (firstUnpaid.dividend || 0))}`} Icon={Wallet} onPress={() => setPaying(firstUnpaid)} />
        ) : null}
        {!app.snapshot?.canPayChits ? <Text style={st.meta}>Your role on the server does not allow paying chit instalments.</Text> : null}

        <SectionTitle title="Instalments" Icon={CalendarClock} />
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {c.installments.map(i => {
            const lp = local(i);
            const paid = isPaid(i);
            const tone = paid ? [colors.green, colors.greenSoft, 'Paid'] : lp ? [colors.gold, colors.goldSoft, lp.status === 'FAILED' ? 'Not accepted' : 'Paid on phone']
              : i.overdue ? [colors.red, colors.redSoft, 'Overdue'] : [colors.muted, colors.sunken, 'Due'];
            return (
              <Pressable key={i.id} style={st.inst} onPress={!paid && !lp && app.snapshot?.canPayChits ? () => setPaying(i) : undefined}>
                <View style={[st.no, { backgroundColor: tone[1] }]}><Text style={[st.noText, { color: tone[0] }]}>{i.no}</Text></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={st.instTitle}>{money(i.paidAmount ?? i.dueAmount)}{i.dividend ? <Text style={st.meta}>  · dividend {money(i.dividend)}</Text> : null}</Text>
                  <Text style={st.meta} numberOfLines={1}>{paid ? `Paid ${shortDate(i.paidDate)}${i.paidFrom ? ` from ${i.paidFrom}` : ''}`
                    : lp ? `${shortDate(lp.paidDate)} from ${lp.fromAccountName}${lp.message ? ` · ${lp.message}` : ''}` : `Due ${date(i.dueDate)}`}</Text>
                </View>
                <Pill text={tone[2]} fg={tone[0]} bg={tone[1]} />
                {lp && lp.status !== 'PENDING' ? <Pressable onPress={() => app.removeChitPayment(lp.clientId)} hitSlop={10}><Trash2 color={colors.muted} size={16} /></Pressable> : null}
                {!paid && !lp && app.snapshot?.canPayChits ? <ChevronRight color={colors.muted} size={16} /> : null}
              </Pressable>
            );
          })}
        </Card>
      </ScrollView>
      <PayChit chit={c} inst={paying} onClose={() => setPaying(null)} />
    </View>
  );
}

function PayChit({ chit, inst, onClose }: { chit: Chit; inst: Installment | null; onClose: () => void }) {
  const app = useApp();
  const payers = useMemo(() => app.accounts.filter(a => a.payFrom && a.type !== 'CREDIT_CARD'), [app.accounts]);
  const [from, setFrom] = useState<number | null>(null);
  const [day, setDay] = useState(isoDate());
  const [dividend, setDividend] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paidWith, setPaidWith] = useState<UpiApp | null>(null);

  useEffect(() => {
    if (!inst) return;
    const def = payers.find(p => p.id === chit.defaultPaymentAccountId) || payers[0];
    setFrom(def?.id ?? null);
    setDay(isoDate());
    setDividend(inst.dividend ? String(inst.dividend) : '');
    setError('');
    setPaidWith(null);
  }, [inst, chit, payers]);

  if (!inst) return null;
  const div = Number(dividend.replace(/[,\s]/g, '')) || 0;
  const pay = Math.max(0, inst.dueAmount - div);
  const payer = payers.find(p => p.id === from);
  const shift = (n: number) => { const d = new Date(`${day}T00:00:00`); d.setDate(d.getDate() + n); const nx = isoDate(d); if (nx <= isoDate()) setDay(nx); };

  const upi = async (a: UpiApp) => {
    if (div < 0 || div >= inst.dueAmount) { setError('The dividend must be less than the instalment'); return; }
    setError('');
    try {
      const out = await payWith(a, upiLink(chit, pay, upiNote(chit, inst)));
      if (out === 'STORE') app.notify(`${a.name} is not installed: opening the Play Store`);
      else setPaidWith(a);
    } catch {
      setError(`${a.name} could not be opened`);
    }
  };

  const save = async () => {
    if (!payer) { setError('Pick the account it is paid from'); return; }
    if (div < 0 || div >= inst.dueAmount) { setError('The dividend must be less than the instalment'); return; }
    setBusy(true);
    try {
      await app.payChit(chit, inst, { paidDate: day, fromAccountId: payer.id, dividend: div });
      app.notify(`${money(pay)} paid · ${app.settings.offline ? 'saved on the phone' : 'syncing'}`);
      onClose();
    } finally { setBusy(false); }
  };

  return (
    <Sheet visible onClose={onClose} title={`Pay instalment ${inst.no}`}
      footer={<Button title={chit.organizerUpi ? `Record ${money(pay)} as paid` : `Pay ${money(pay)}`} Icon={Check} onPress={save} busy={busy} />}>
      <Card style={{ gap: 6 }}>
        <Text style={st.name}>{chit.name}</Text>
        <Text style={st.meta}>Due {date(inst.dueDate)} · instalment {money(inst.dueAmount)}</Text>
        <Text style={[st.meta, { color: colors.text }]}>Paying <Text style={{ fontWeight: '800' }}>{money(pay)}</Text>{div ? ` (after the ${money(div)} dividend)` : ''}</Text>
      </Card>
      <Field label="Dividend this month" value={dividend} onChangeText={t => setDividend(t.replace(/[^0-9.,]/g, ''))} keyboardType="decimal-pad" placeholder="0"
        hint="What the auction left as dividend: it comes off what you pay." />
      {chit.organizerUpi ? (
        <View style={{ gap: 8 }}>
          <Text style={[st.label, { marginBottom: 0 }]}>Pay {money(pay)} with</Text>
          <UpiButtons onPay={upi} disabled={pay <= 0} />
          <Text style={st.meta}>
            {paidWith ? `Back from ${paidWith.name}? Once the payment went through, record it below.`
              : `To ${chit.organizer || chit.organizerUpi} (${chit.organizerUpi}) · note “${upiNote(chit, inst)}”`}
          </Text>
        </View>
      ) : null}
      <View>
        <Text style={st.label}>Paid on</Text>
        <View style={st.stepper}>
          <Pressable onPress={() => shift(-1)} hitSlop={8}><ChevronLeft color={colors.text2} size={18} /></Pressable>
          <Text style={st.stepText}>{date(day)}</Text>
          <Pressable onPress={() => shift(1)} hitSlop={8}><ChevronRight color={day >= isoDate() ? colors.line : colors.text2} size={18} /></Pressable>
        </View>
      </View>
      <Text style={st.label}>Paid from</Text>
      <View style={st.payers}>
        {payers.map(a => {
          const on = a.id === from;
          return (
            <Pressable key={a.id} onPress={() => setFrom(a.id)} style={[st.payer, on && st.payerOn]}>
              <AccountBubble type={a.type} size={28} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={st.payerName} numberOfLines={1}>{a.name}</Text>
                <Text style={st.meta} numberOfLines={1}>{money(liveBalance(a, app.queue, app.chitQueue).balance)}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      {error ? <Text style={{ color: colors.red, fontWeight: '600' }}>{error}</Text> : null}
    </Sheet>
  );
}


const st = StyleSheet.create({
  h: { color: colors.white, fontSize: 20, fontWeight: '800' },
  sub: { color: 'rgba(255,255,255,0.75)', fontSize: 12.5, marginTop: 4 },
  figs: { flexDirection: 'row', gap: 8, marginTop: space.l },
  fig: { flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10 },
  figLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10.5, fontWeight: '700' },
  figValue: { color: colors.white, fontSize: 16, fontWeight: '800', marginTop: 2 },
  next: { color: 'rgba(255,255,255,0.85)', fontSize: 12.5, marginTop: space.m, fontWeight: '600' },
  icon: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.aquaSoft, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 15, fontWeight: '800', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 1 },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.sunken, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.aqua, borderRadius: 3 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backText: { fontSize: 15, fontWeight: '700', color: colors.text },
  inst: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: space.m, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  no: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  noText: { fontWeight: '800', fontSize: 13 },
  instTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: colors.muted, textTransform: 'uppercase', marginBottom: 6 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start', backgroundColor: colors.card, borderRadius: 16, paddingHorizontal: 10, height: 36, borderWidth: 1, borderColor: colors.line },
  stepText: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  payers: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  payer: { width: '48.5%', flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: radius.m, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  payerOn: { borderColor: colors.ocean, backgroundColor: colors.oceanSoft },
  payerName: { fontSize: 12.5, fontWeight: '700', color: colors.text },
});
