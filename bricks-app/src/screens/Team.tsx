/**
 * The team's pay, as the web app's Payments: for a week (or a month of salaries) everyone with pay due, what they earned
 * (batches made, loading, trips, their wage), the advance to take back and what to pay; each person or team paid on a
 * slip of their own. The pay screen picks the work, the wage, a bonus and the advances taken back, shows the slip before
 * it is made (the web app's slip, marked DRAFT), then records the payment and shows the slip made. Also the advances
 * still owed (and giving one) and the slips paid lately, each opening as the web app shows it.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  CalendarDays, Check, ChevronLeft, ChevronRight, Eye, Gift, HandCoins, Plus, Receipt, Trash2, TrendingUp, Undo2, Users,
} from 'lucide-react-native';
import { useApp, useLoad } from '../state';
import { useNav } from '../nav';
import { colors, radius, space } from '../theme';
import { count, date, initials, isoDate, money, moneyShort, shortDate } from '../format';
import { Advance, Earning, PayPreview, Payroll, Resource, SlipView } from '../types';
import { Avatar, Badge, Banner, Bar, Button, Card, Chips, Empty, Field, Grid, List, Loading, Row, Screen, SectionTitle, Select, Sheet, Stat } from '../ui';
import { DateField, num, useAct } from './common';

type Cycle = 'WEEKLY' | 'MONTHLY';
const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MODES = ['Cash', 'UPI', 'Bank', 'Cheque'];
const KIND_LABEL: Record<string, string> = { PRODUCTION: 'batches', LOADING: 'loading', UNLOADING: 'unloading', TRIP: 'trips' };

const iso = (d: Date) => isoDate(d);

/** The week (Monday to Sunday) holding today, weeks back; or the month, months back (as the web app counts them). */
function periodOf(cycle: Cycle, back: number): { from: string; to: string; label: string } {
  const now = new Date();
  if (cycle === 'WEEKLY') {
    const day = (now.getDay() + 6) % 7;
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day - back * 7);
    const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6);
    return { from: iso(from), to: iso(to), label: `${shortDate(iso(from))} – ${shortDate(iso(to))}` };
  }
  const from = new Date(now.getFullYear(), now.getMonth() - back, 1);
  const to = new Date(now.getFullYear(), now.getMonth() - back + 1, 0);
  return { from: iso(from), to: iso(to), label: date(iso(from)).replace(/^\d+ /, '') };
}

/** "3 batches · 2 trips · wage ₹3.5K": what someone's pay is for. */
function summarise(p: PayPreview): string {
  const by = new Map<string, number>();
  p.earnings.forEach(e => by.set(e.kind, (by.get(e.kind) || 0) + 1));
  const parts = [...by.entries()].map(([k, n]) => `${n} ${KIND_LABEL[k] || k.toLowerCase()}`);
  if (p.wage) parts.push(`${p.resource.resource.salaryType === 'MONTHLY' ? 'salary' : 'wage'} ${moneyShort(p.wage)}`);
  return parts.join(' · ') || 'nothing';
}

const backOf = (p: PayPreview) => p.advances.reduce((s, a) => s + num(String(a.suggested)), 0);

export function TeamScreen() {
  const app = useApp();
  const nav = useNav();
  const [cycle, setCycle] = useState<Cycle>('WEEKLY');
  const [back, setBack] = useState(0);
  const [advanceFor, setAdvanceFor] = useState<Resource | null>(null);
  const [picking, setPicking] = useState(false);
  const period = periodOf(cycle, back);
  const run = useLoad<PayPreview[]>(`/bricks/payroll/run?cycle=${cycle}&from=${period.from}&to=${period.to}`);
  const pay = useLoad<Payroll>('/bricks/payroll');
  useEffect(() => { app.loadMeta(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const list = run.data || [];
  const due = list.reduce((s, x) => s + x.gross, 0);
  const taken = list.reduce((s, x) => s + backOf(x), 0);
  const owed = pay.data?.advances || [];
  const slips = pay.data?.slips || [];
  const record = !!app.profile?.record;
  const payDay = app.meta?.settings.payDay || 6;
  const until = (payDay - (((new Date().getDay() + 6) % 7) + 1) + 7) % 7;
  const people = (pay.data?.resources || []).filter(r => r.resource.active !== false);

  return (
    <Screen title="Team & pay" subtitle={cycle === 'WEEKLY' ? 'Weekly pay' : 'Monthly salaries'} onBack={nav.stack.length ? () => nav.pop() : undefined}
      refreshing={run.refreshing || pay.refreshing} onRefresh={() => { run.reload(); pay.reload(); }} stale={run.stale || pay.stale} error={run.error || pay.error}>
      <Chips value={cycle} onChange={c => { setCycle(c); setBack(0); }} options={[{ value: 'WEEKLY', label: 'Weekly' }, { value: 'MONTHLY', label: 'Monthly salaries' }]} />
      <View style={ts.period}>
        <Pressable onPress={() => setBack(back + 1)} hitSlop={10} style={ts.arrow}><ChevronLeft color={colors.text} size={22} /></Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={ts.periodText}>{period.label}</Text>
          {cycle === 'WEEKLY' && back === 0 ? <Text style={[ts.payday, until === 0 && { color: colors.orange }]}>{until === 0 ? 'Payday today' : `Payday ${DAYS[payDay]} · in ${until} day${until === 1 ? '' : 's'}`}</Text> : null}
        </View>
        <Pressable onPress={() => back > 0 && setBack(back - 1)} hitSlop={10} style={[ts.arrow, back === 0 && { opacity: 0.3 }]}><ChevronRight color={colors.text} size={22} /></Pressable>
      </View>

      <Grid>
        <Stat label={cycle === 'WEEKLY' ? 'Earned this week' : 'Salaries'} value={moneyShort(due)} sub={`${list.length} to pay`} Icon={TrendingUp} tone="info" />
        <Stat label="To pay out" value={moneyShort(due - taken)} sub={taken ? `after ${moneyShort(taken)} advances back` : 'after advances'} Icon={HandCoins} tone={due ? 'accent' : 'neutral'} />
      </Grid>

      <SectionTitle title={`To pay · ${money(due - taken)}`} Icon={HandCoins} />
      {run.loading && !run.data ? <Loading /> : list.length ? list.map(x => {
        const r = x.resource.resource;
        const b = backOf(x);
        return (
          <Card key={r.id} style={{ gap: 10 }} onPress={() => nav.push('PaySlip', { resourceId: r.id, cycle, from: period.from, to: period.to })}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Avatar text={initials(r.name)} size={40} tone={r.kind === 'TEAM' ? 'info' : 'accent'} />
              <View style={{ flex: 1 }}>
                <Text style={ts.name}>{r.name}</Text>
                <Text style={ts.sub}>{r.role.replace(/_/g, ' ').toLowerCase()}{r.kind === 'TEAM' && r.memberCount ? ` · team of ${r.memberCount}` : ''}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={ts.toPay}>{money(x.gross - b)}</Text>
                <Text style={ts.sub}>to pay</Text>
              </View>
            </View>
            <Text style={ts.sub}>{summarise(x)}</Text>
            <View style={ts.figs}>
              <Fig label="Earned" value={money(x.gross)} />
              <Fig label="Advance back" value={b ? `− ${money(b)}` : '—'} tone={b ? colors.red : undefined} />
              <Fig label="Last paid" value={x.resource.lastPaidOn ? shortDate(x.resource.lastPaidOn) : 'never'} />
            </View>
            {record ? <Button title="Pay & make the slip" Icon={HandCoins} small kind="dark" style={{ alignSelf: 'stretch' }}
              onPress={() => nav.push('PaySlip', { resourceId: r.id, cycle, from: period.from, to: period.to })} /> : null}
          </Card>
        );
      }) : <Empty Icon={Users} title={`Nothing due for ${period.label}`} text="Work recorded (batches, loading, trips) and wages show up here to be paid." />}

      <SectionTitle title={`Advances owed · ${money(pay.data?.advancesOutstanding || 0)}`} Icon={Undo2}
        right={record && people.length ? <Text style={ts.link} onPress={() => setPicking(true)}>+ Give an advance</Text> : null} />
      {owed.length ? (
        <List>
          {owed.map((a, i) => (
            <View key={a.advance.advanceId}>
              <Row title={a.resourceName} sub={`${a.advance.slipNo} · ${shortDate(a.advance.givenOn)} · “${a.advance.narrative || ''}”`}
                right={money(a.advance.outstanding)} rightSub={`of ${money(a.advance.amount)}`}
                onPress={() => nav.push('Doc', { kind: 'slip', id: a.advance.advanceId, title: `Advance slip ${a.advance.slipNo}` })} last={i === owed.length - 1} />
              <View style={{ paddingHorizontal: space.m, paddingBottom: 10, marginTop: -6, backgroundColor: colors.card }}>
                <Bar value={a.advance.recovered} max={a.advance.amount} color={colors.violet} height={4} />
              </View>
            </View>
          ))}
        </List>
      ) : <Text style={ts.sub}>Nobody owes an advance.</Text>}

      <SectionTitle title="Payment slips" Icon={Receipt} />
      {slips.length ? (
        <List>
          {slips.slice(0, 25).map((s, i) => (
            <Row key={s.id} Icon={s.kind === 'ADVANCE' ? Undo2 : Receipt} tone={s.status === 'CANCELLED' ? 'neutral' : s.kind === 'ADVANCE' ? 'violet' : 'good'}
              title={`${s.slipNo} · ${s.resourceName}`}
              sub={`${shortDate(s.paidOn)} · ${s.kind === 'ADVANCE' ? 'advance' : s.periodFrom ? `${shortDate(s.periodFrom)} – ${shortDate(s.periodTo)}` : s.kind.toLowerCase()}${s.status === 'CANCELLED' ? ' · cancelled' : ''}`}
              right={money(s.net)} rightSub={s.deductions ? `− ${moneyShort(s.deductions)} adv.` : null}
              onPress={() => nav.push('Doc', { kind: 'slip', id: s.id, title: `${s.kind === 'ADVANCE' ? 'Advance' : 'Payment'} slip ${s.slipNo}` })}
              last={i === Math.min(25, slips.length) - 1} />
          ))}
        </List>
      ) : <Text style={ts.sub}>No slips yet.</Text>}

      <Sheet visible={picking} onClose={() => setPicking(false)} title="Give an advance to">
        <List>
          {people.map((r, i) => (
            <Row key={r.resource.id} title={r.resource.name} sub={r.advanceOutstanding ? `owes ${money(r.advanceOutstanding)}` : r.resource.role.replace(/_/g, ' ').toLowerCase()}
              onPress={() => { setPicking(false); setAdvanceFor(r.resource); }} last={i === people.length - 1} />
          ))}
        </List>
      </Sheet>
      <AdvanceSheet r={advanceFor} onClose={() => setAdvanceFor(null)} />
    </Screen>
  );
}

function Fig({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={ts.figLabel}>{label}</Text>
      <Text style={[ts.figValue, tone ? { color: tone } : null]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

// ===================================================================== paying one person or team

type Bonus = { label: string; amount: string };

export function PaySlipScreen({ resourceId, cycle, from, to }: { resourceId: number; cycle: Cycle; from: string; to: string }) {
  const app = useApp();
  const nav = useNav();
  const { busy, run } = useAct();
  const res = useLoad<PayPreview>(`/bricks/payroll/preview?resourceId=${resourceId}&cycle=${cycle}&from=${from}&to=${to}`);
  const p = res.data;
  const [off, setOff] = useState<Set<number>>(new Set());
  const [wage, setWage] = useState<string | null>(null);
  const [bonuses, setBonuses] = useState<Bonus[]>([]);
  const [deduct, setDeduct] = useState<Record<number, string>>({});
  const [paidOn, setPaidOn] = useState(isoDate());
  const [mode, setMode] = useState('Cash');
  const [accountId, setAccountId] = useState<number | null>(null);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    app.loadMeta().then(m => app.loadAccounts().then(a => setAccountId(id => id ?? m?.settings.payAccountId ?? a.find(x => x.accountType === 'CASH')?.id ?? a[0]?.id ?? null)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // what the server suggests, once it is known
  useEffect(() => {
    if (!p) return;
    setWage(w => w ?? String(p.wageNote ? 0 : p.wage || 0));
    setDeduct(d => (Object.keys(d).length ? d : Object.fromEntries(p.advances.map(a => [a.advanceId, String(a.suggested || 0)]))));
  }, [p]);

  const r = p?.resource.resource;
  const picked = (p?.earnings || []).filter(e => e.id !== null && !off.has(e.id));
  const wageAmt = r && r.salaryType !== 'PIECE' ? num(wage || '0') : 0;
  const bonusList = bonuses.filter(b => b.label.trim() && num(b.amount) > 0);
  const gross = picked.reduce((s, e) => s + e.amount, 0) + wageAmt + bonusList.reduce((s, b) => s + num(b.amount), 0);
  const dedLines = (p?.advances || []).map(a => ({ a, amount: Math.min(a.outstanding, num(deduct[a.advanceId] || '0')) })).filter(x => x.amount > 0);
  const ded = dedLines.reduce((s, x) => s + x.amount, 0);
  const net = gross - ded;
  const account = app.accounts.find(a => a.id === accountId)?.name || null;
  const valid = gross > 0 && net >= 0;

  /** The slip as it will be made: the web app's slip, marked DRAFT, from what is picked here. */
  const draft = useMemo(() => {
    if (!p || !r) return null;
    const s = app.meta?.settings;
    const lines: Earning[] = [...picked];
    if (wageAmt > 0) lines.push({ id: null, kind: r.salaryType === 'MONTHLY' ? 'SALARY' : 'WAGE', label: r.salaryType === 'MONTHLY' ? 'Salary' : 'Weekly wage',
      earnedOn: to, quantity: null, rate: null, amount: wageAmt, narrative: p.wageLabel });
    bonusList.forEach(b => lines.push({ id: null, kind: 'BONUS', label: 'Bonus / incentive', earnedOn: paidOn, quantity: null, rate: null, amount: num(b.amount), narrative: b.label.trim() }));
    return {
      slip: { slipNo: 'DRAFT', kind: cycle, status: 'DRAFT', periodFrom: from, periodTo: to, paidOn, gross, deductions: ded || null, net, mode, reference: reference.trim() || null,
        narrative: note.trim() || null, createdBy: app.profile?.fullName, createdAt: new Date().toISOString() },
      resource: r, lines,
      deductions: dedLines.map(({ a, amount }) => ({ advanceId: a.advanceId, advanceNo: a.slipNo, givenOn: a.givenOn, narrative: a.narrative, advanceAmount: a.amount,
        outstandingBefore: a.outstanding, amount, balanceAfter: a.outstanding - amount })),
      account: net > 0 ? account : null, inWords: null, entryNo: null, keyFingerprint: null, recoveredOn: [],
      company: { name: app.profile?.company || app.profile?.organization, address: s?.address, phone: s?.phone, upiId: s?.upiId, ownerName: s?.ownerName,
        ownerSignature: s?.ownerSignature, accountantName: s?.accountantName, accountantSignature: s?.accountantSignature },
    };
  }, [p, r, picked, wageAmt, bonusList, paidOn, gross, ded, net, mode, reference, note, dedLines, account, app.meta, app.profile, cycle, from, to]);

  const save = async () => {
    const body = {
      resourceId, cycle, periodFrom: from, periodTo: to, earningIds: picked.map(e => e.id), wage: r && r.salaryType !== 'PIECE' ? wageAmt : null,
      bonuses: bonusList.map(b => ({ label: b.label.trim(), amount: num(b.amount) })),
      deductions: dedLines.map(({ a, amount }) => ({ advanceId: a.advanceId, amount })),
      paidOn, mode, accountId, reference: reference.trim() || null, note: note.trim() || null,
    };
    const out = await run('pay', () => app.call<SlipView>('/bricks/payroll/slips', { method: 'POST', body }), v => `Slip ${v.slip.slipNo} made · ${money(v.slip.net)} paid`);
    if (out && 'slip' in out) nav.replace('Doc', { kind: 'slip', id: out.slip.id, title: `Payment slip ${out.slip.slipNo}` });
  };

  if (!p || !r) return <Screen title="Pay" onBack={() => nav.pop()} error={res.error}>{res.loading ? <Loading text="Working out the pay…" /> : null}</Screen>;

  return (
    <Screen title={`Pay ${r.name}`} subtitle={`${cycle === 'MONTHLY' ? 'Monthly' : 'Weekly'} · ${shortDate(from)} – ${shortDate(to)}`} onBack={() => nav.pop()}
      stale={res.stale} error={res.error}
      footer={app.profile?.record ? (
        <>
          <Button title="See the slip" Icon={Eye} kind="ghost" disabled={!valid} onPress={() => nav.push('Doc', { kind: 'draft-slip', title: `Slip for ${r.name}`, draft })} />
          <Button title={`Pay ${money(net)}`} Icon={Check} busy={busy === 'pay'} disabled={!valid} onPress={save} />
        </>
      ) : undefined}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar text={initials(r.name)} size={46} tone={r.kind === 'TEAM' ? 'info' : 'accent'} />
        <View style={{ flex: 1 }}>
          <Text style={ts.name}>{r.name}</Text>
          <Text style={ts.sub}>{r.role.replace(/_/g, ' ').toLowerCase()}{r.members ? ` · ${r.members}` : ''}</Text>
          <Text style={ts.sub}>Last paid {p.resource.lastPaidOn ? date(p.resource.lastPaidOn) : 'never'}{r.upiId ? ` · UPI ${r.upiId}` : ''}</Text>
        </View>
      </Card>

      <SectionTitle title="Work to pay" Icon={Check} right={<Text style={ts.sub}>not paid on any slip yet</Text>} />
      {p.earnings.length ? (
        <List>
          {p.earnings.map((e, i) => {
            const on = e.id !== null && !off.has(e.id);
            return (
              <Pressable key={e.id ?? i} onPress={() => e.id !== null && setOff(s => { const n = new Set(s); if (n.has(e.id!)) n.delete(e.id!); else n.add(e.id!); return n; })}
                style={[ts.earn, i < p.earnings.length - 1 && ts.line]}>
                <View style={[ts.check, on && ts.checkOn]}>{on ? <Check color={colors.white} size={14} strokeWidth={3} /> : null}</View>
                <View style={{ flex: 1 }}>
                  <Text style={[ts.earnTitle, !on && { color: colors.muted }]}>{e.label}{e.quantity ? ` · ${count(e.quantity)}` : ''}</Text>
                  <Text style={ts.sub} numberOfLines={2}>{shortDate(e.earnedOn)}{e.earnedOn < from ? ' · earlier' : ''}{e.narrative ? ` · ${e.narrative}` : ''}</Text>
                </View>
                <Text style={[ts.amt, !on && { color: colors.muted, textDecorationLine: 'line-through' }]}>{money(e.amount)}</Text>
              </Pressable>
            );
          })}
        </List>
      ) : <Text style={ts.sub}>No work waiting to be paid.</Text>}

      {r.salaryType !== 'PIECE' ? (
        <Card>
          <Field label={p.wageLabel || 'Wage'} keyboardType="decimal-pad" value={wage ?? ''} onChangeText={setWage} hint={p.wageNote || undefined} />
        </Card>
      ) : null}

      <SectionTitle title="Bonus or incentive" Icon={Gift} right={<Text style={ts.link} onPress={() => setBonuses([...bonuses, { label: '', amount: '' }])}>+ Add a bonus</Text>} />
      {bonuses.map((b, i) => (
        <Card key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          <Field label="What for" style={{ flex: 2 }} value={b.label} placeholder="e.g. Diwali bonus" onChangeText={x => setBonuses(bonuses.map((y, k) => (k === i ? { ...y, label: x } : y)))} />
          <Field label="₹" style={{ flex: 1 }} keyboardType="decimal-pad" value={b.amount} onChangeText={x => setBonuses(bonuses.map((y, k) => (k === i ? { ...y, amount: x } : y)))} />
          <Pressable onPress={() => setBonuses(bonuses.filter((_, k) => k !== i))} style={ts.remove} hitSlop={8}><Trash2 color={colors.red} size={18} /></Pressable>
        </Card>
      ))}

      {p.advances.length ? (
        <>
          <SectionTitle title="Advances to take back" Icon={Undo2} />
          {p.advances.map((a: Advance) => (
            <Card key={a.advanceId} style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={ts.earnTitle}>{a.slipNo} · {shortDate(a.givenOn)} · {money(a.amount)}</Text>
                <Badge text={`${money(a.outstanding)} owed`} tone="violet" />
              </View>
              <Text style={ts.sub}>“{a.narrative}”{a.recoverPerCycle ? ` · ${money(a.recoverPerCycle)} a ${cycle === 'MONTHLY' ? 'month' : 'week'} agreed` : ''}</Text>
              <Field label="Take back now (₹)" keyboardType="decimal-pad" value={deduct[a.advanceId] ?? ''}
                onChangeText={x => setDeduct({ ...deduct, [a.advanceId]: x })}
                error={num(deduct[a.advanceId] || '0') > a.outstanding ? `Only ${money(a.outstanding)} is owed` : undefined} />
            </Card>
          ))}
        </>
      ) : null}

      <SectionTitle title="Payment" Icon={CalendarDays} />
      <Card style={{ gap: 12 }}>
        <DateField label="Paid on" value={paidOn} onChange={setPaidOn} />
        <Chips value={mode} onChange={setMode} options={MODES.map(m => ({ value: m, label: m }))} />
        <Select label="From" value={accountId} onChange={setAccountId} options={app.accounts.map(a => ({ value: a.id, label: a.name, sub: a.brickBook ? 'Brick business' : undefined }))} />
        {mode !== 'Cash' ? <Field label="Reference" value={reference} onChangeText={setReference} autoCapitalize="characters" /> : null}
        <Field label="Note on the slip" value={note} onChangeText={setNote} />
      </Card>

      <Card style={ts.net}>
        <View style={ts.netRow}><Text style={ts.netLabel}>Earned</Text><Text style={ts.netValue}>{money(gross)}</Text></View>
        {ded ? <View style={ts.netRow}><Text style={ts.netLabel}>Advance taken back</Text><Text style={[ts.netValue, { color: colors.red }]}>− {money(ded)}</Text></View> : null}
        <View style={[ts.netRow, ts.netTotal]}><Text style={ts.netBig}>To pay</Text><Text style={[ts.netBig, net < 0 && { color: colors.red }]}>{money(net)}</Text></View>
        {net < 0 ? <Banner Icon={Undo2} tone="bad" text="The advances taken back are more than the pay" /> : null}
        {!gross ? <Text style={ts.sub}>Pick the work done, a wage or a bonus.</Text> : null}
      </Card>
    </Screen>
  );
}

// ===================================================================== an advance

function AdvanceSheet({ r, onClose }: { r: Resource | null; onClose: () => void }) {
  const app = useApp();
  const nav = useNav();
  const { busy, run } = useAct();
  const [amount, setAmount] = useState('');
  const [narrative, setNarrative] = useState('');
  const [recover, setRecover] = useState('');
  const [day, setDay] = useState(isoDate());
  const [mode, setMode] = useState('Cash');
  const [reference, setReference] = useState('');
  const [accountId, setAccountId] = useState<number | null>(null);
  useEffect(() => {
    if (!r) return;
    setAmount(''); setNarrative(''); setRecover(''); setDay(isoDate()); setMode('Cash'); setReference('');
    app.loadAccounts().then(a => setAccountId(app.meta?.settings.payAccountId ?? a.find(x => x.accountType === 'CASH')?.id ?? a[0]?.id ?? null));
  }, [r]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!r) return null;
  return (
    <Sheet visible onClose={onClose} title={`Advance to ${r.name}`}
      footer={<Button title="Give the advance" Icon={Plus} busy={busy === 'adv'} disabled={num(amount) <= 0 || !narrative.trim()} onPress={async () => {
        const out = await run('adv', () => app.call<SlipView>('/bricks/payroll/advances', { method: 'POST', body: { resourceId: r.id, amount: num(amount), givenOn: day,
          accountId, mode, reference: reference.trim() || null, narrative: narrative.trim(), recoverPerCycle: recover ? num(recover) : null } }), v => `Advance ${v.slip.slipNo} given`);
        if (out && 'slip' in out) {
          onClose();
          nav.push('Doc', { kind: 'slip', id: out.slip.id, title: `Advance slip ${out.slip.slipNo}` });
        }
      }} />}>
      <Field label="Amount (₹)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
      <Field label="Why (shows on every slip it is taken back on)" value={narrative} onChangeText={setNarrative} placeholder="For a family function" />
      <Field label={`Take back each ${r.salaryType === 'MONTHLY' ? 'month' : 'week'} (₹)`} keyboardType="decimal-pad" value={recover} onChangeText={setRecover}
        hint="Empty: all of it from the next payment" />
      <DateField label="Given on" value={day} onChange={setDay} />
      <Chips value={mode} onChange={setMode} options={MODES.map(m => ({ value: m, label: m }))} />
      <Select label="From" value={accountId} onChange={setAccountId} options={app.accounts.map(a => ({ value: a.id, label: a.name }))} />
      {mode !== 'Cash' ? <Field label="Reference" value={reference} onChangeText={setReference} /> : null}
    </Sheet>
  );
}

const ts = StyleSheet.create({
  period: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.l, paddingVertical: 8, paddingHorizontal: 6,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  arrow: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  periodText: { fontSize: 15.5, fontWeight: '800', color: colors.text },
  payday: { fontSize: 11.5, color: colors.muted, fontWeight: '700', marginTop: 2 },
  name: { fontSize: 16, fontWeight: '800', color: colors.text },
  sub: { fontSize: 12.5, color: colors.text2, lineHeight: 18 },
  toPay: { fontSize: 19, fontWeight: '900', color: colors.text },
  figs: { flexDirection: 'row', gap: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  figLabel: { fontSize: 10.5, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4 },
  figValue: { fontSize: 13.5, fontWeight: '800', color: colors.text },
  link: { color: colors.orange, fontWeight: '800', fontSize: 12.5 },
  earn: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: space.m, backgroundColor: colors.card },
  line: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  check: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: colors.concrete, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.green, borderColor: colors.green },
  earnTitle: { fontSize: 14.5, fontWeight: '800', color: colors.text },
  amt: { fontSize: 14.5, fontWeight: '800', color: colors.text },
  remove: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  net: { gap: 8, borderWidth: 1, borderColor: colors.orange },
  netRow: { flexDirection: 'row', justifyContent: 'space-between' },
  netLabel: { fontSize: 14, color: colors.text2, fontWeight: '600' },
  netValue: { fontSize: 14, color: colors.text, fontWeight: '800' },
  netTotal: { paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  netBig: { fontSize: 20, fontWeight: '900', color: colors.text },
});
