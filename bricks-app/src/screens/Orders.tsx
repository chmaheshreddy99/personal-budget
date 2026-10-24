/**
 * Orders: every order with what is delivered and paid; an order with its blocks, trips and payments; a new order.
 * A trip moves loading → dispatched → on the way → delivered (with the count that arrived); a payment is recorded, or
 * one the customer reported is verified. What touches the money and needs a checker (a price below the lowest, a
 * cancellation, free delivery) goes to Approvals instead.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  Ban, Banknote, Check, CircleCheck, FileText, MapPin, Phone, Plus, Search, Send, Share2, ShoppingCart, Tag, Truck, Undo2, X,
} from 'lucide-react-native';
import { normalizeUrl } from '../api';
import { useApp, useLoad } from '../state';
import { useNav } from '../nav';
import { colors, radius, space, statusTone } from '../theme';
import { count, isoDate, money, shortDate, dateTime } from '../format';
import { Customer, OrderRow, OrderView, PaymentView, PlaceOutcome, TripView } from '../types';
import { Badge, Banner, Bar, Button, Card, Chips, Empty, Facts, Field, List, Loading, ReasonSheet, Row, Screen, SectionTitle, Select, Sheet, st } from '../ui';
import { DateField, num, Toggle, TypeDot, useAct } from './common';

type Filter = 'open' | 'today' | 'unpaid' | 'done' | 'all';

const isOpen = (o: { status: string }) => o.status !== 'DELIVERED' && o.status !== 'CANCELLED';

export function OrdersScreen() {
  const app = useApp();
  const nav = useNav();
  const list = useLoad<OrderRow[]>('/bricks/orders');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('open');
  const today = isoDate();
  const all = list.data || [];
  const words = q.trim().toLowerCase();
  const shown = all.filter(o => (filter === 'all' || (filter === 'open' ? isOpen(o) : filter === 'today' ? isOpen(o) && !!o.nextTrip && o.nextTrip <= today
    : filter === 'unpaid' ? o.balance > 0 && o.status !== 'CANCELLED' : o.status === 'DELIVERED'))
    && (!words || `${o.customerName} ${o.customerPhone || ''} ${o.orderNo} ${o.address || ''}`.toLowerCase().includes(words)));
  const canAdd = app.profile?.record && app.has('ORDERS');

  return (
    <Screen title="Orders" subtitle={`${all.filter(isOpen).length} open`} onBack={nav.stack.length ? () => nav.pop() : undefined}
      refreshing={list.refreshing} onRefresh={list.reload} stale={list.stale} error={list.error}
      footer={canAdd ? <Button title="New order" Icon={Plus} onPress={() => nav.push('NewOrder')} /> : undefined}>
      <View style={[st.input, os.search]}>
        <Search color={colors.muted} size={18} />
        <TextInput value={q} onChangeText={setQ} placeholder="Customer, phone or order no." placeholderTextColor={colors.muted} style={{ flex: 1, fontSize: 15, color: colors.text }} />
      </View>
      <Chips value={filter} onChange={setFilter} options={[{ value: 'open', label: 'Open' }, { value: 'today', label: 'Trip due' },
        { value: 'unpaid', label: 'To collect' }, { value: 'done', label: 'Delivered' }, { value: 'all', label: 'All' }]} />
      {list.loading && !list.data ? <Loading /> : shown.length ? (
        <View style={{ gap: 10 }}>{shown.map(o => <OrderCard key={o.id} o={o} onPress={() => nav.push('Order', { id: o.id })} />)}</View>
      ) : <Empty Icon={ShoppingCart} title="No orders here" text={words ? 'Nothing matches the search.' : undefined} />}
    </Screen>
  );
}

export function OrderCard({ o, onPress }: { o: OrderRow; onPress: () => void }) {
  return (
    <Card onPress={onPress} style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={os.cust} numberOfLines={1}>{o.customerName}</Text>
        <Badge text={o.statusLabel} tone={statusTone(o.status)} />
      </View>
      <Text style={os.sub}>{o.orderNo} · {shortDate(o.orderDate)}{o.requiredBy ? ` · needed ${shortDate(o.requiredBy)}` : ''}{o.address ? ` · ${o.address}` : ''}</Text>
      <Bar value={o.delivered} max={o.quantity} color={o.status === 'DELIVERED' ? colors.green : colors.orange} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={os.sub}>{count(o.delivered)} of {count(o.quantity)} delivered · {o.tripsDone}/{o.trips} trips{o.nextTrip && isOpen(o) ? ` · next ${shortDate(o.nextTrip)}` : ''}</Text>
        <Text style={[os.amt, o.balance > 0 && { color: colors.orange }]}>{o.balance > 0 ? `${money(o.balance)} due` : money(o.total)}</Text>
      </View>
      {o.claimed ? <Badge text="Payment reported: verify" tone="good" Icon={Banknote} /> : null}
    </Card>
  );
}

const STEPS = ['PLANNED', 'LOADING', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED'];
const STEP_LABEL: Record<string, string> = { PLANNED: 'Planned', LOADING: 'Loading', DISPATCHED: 'Dispatched', IN_TRANSIT: 'On the way', DELIVERED: 'Delivered', CANCELLED: 'Cancelled' };
const NEXT_ACTION: Record<string, string> = { PLANNED: 'Start loading', LOADING: 'Dispatch', DISPATCHED: 'On the way', IN_TRANSIT: 'Delivered' };

export function OrderScreen({ id }: { id: number }) {
  const app = useApp();
  const nav = useNav();
  const res = useLoad<OrderView>(`/bricks/orders/${id}`);
  const { busy, run } = useAct();
  const [sheet, setSheet] = useState<'cancel' | 'waive' | 'pay' | null>(null);
  const [delivering, setDelivering] = useState<TripView | null>(null);
  const [confirming, setConfirming] = useState<PaymentView | null>(null);
  const v = res.data;
  useEffect(() => {
    if (app.has('ALERTS')) app.call('/bricks/notices/seen', { method: 'POST', body: { link: `bricks/sales/${id}` } }).catch(() => undefined);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!v) return <Screen title="Order" onBack={() => nav.pop()} error={res.error}>{res.loading ? <Loading /> : null}</Screen>;
  const o = v.order;
  const record = !!app.profile?.record;
  const open = isOpen(o);
  const runsTrips = record && (app.has('DELIVERIES') || app.has('ORDERS'));
  const takesPay = record && (app.has('PAYMENTS') || app.has('ORDERS'));
  const changes = record && app.has('ORDERS');

  const step = (t: TripView, status: string, delivered?: { brickTypeId: number; quantity: number }[]) =>
    run(`trip-${t.trip.id}`, () => app.call(`/bricks/orders/${o.id}/trips/${t.trip.id}/step`, { method: 'POST', body: { status, delivered } }),
      `Trip ${t.trip.tripNo}: ${STEP_LABEL[status].toLowerCase()}`);

  const shareLink = async () => {
    const out = await run('link', () => app.call<{ token: string }>(`/bricks/orders/${o.id}/links`, { method: 'POST', body: { hours: 72 } }));
    if (!out || !('token' in out)) return;
    const url = `${normalizeUrl(app.session.server)}/brick-order.html#${out.token}`;
    Share.share({ message: `${app.profile?.company || 'Your order'} · ${o.orderNo}: ${count(v.totals.quantity)} blocks${v.totals.balance > 0 ? `, balance ${money(v.totals.balance)}` : ''}.\nTrack the delivery, sign for it and pay by UPI: ${url}` });
  };
  // the bill (the tax invoice once paid in full) exactly as the web app shows it
  const openBill = () => nav.push('Doc', { kind: 'bill', id: o.id, title: `Bill ${o.orderNo}` });

  return (
    <Screen title={o.orderNo} subtitle={`${o.customerName} · ${v.statusLabel}`} onBack={() => nav.pop()} refreshing={res.refreshing} onRefresh={res.reload}
      stale={res.stale} error={res.error}>
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[os.cust, { fontSize: 18 }]} numberOfLines={1}>{o.customerName}</Text>
          <Badge text={v.statusLabel} tone={statusTone(o.status)} />
        </View>
        <Facts items={[['Ordered', shortDate(o.orderDate)], ['Needed by', o.requiredBy ? shortDate(o.requiredBy) : null], ['Deliver to', [o.address, o.landmark].filter(Boolean).join(', ')],
          ['Vehicle', o.hired ? `Hired${o.hiredVehicle ? ` · ${o.hiredVehicle}` : ''}` : v.vehicle], ['Driver', v.driver], ['Taken by', o.createdBy], ['Note', o.note]]} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {o.customerPhone ? <Button title="Call" Icon={Phone} kind="soft" small style={{ flexGrow: 1 }} onPress={() => Linking.openURL(`tel:${o.customerPhone}`)} /> : null}
          {o.address || o.deliveryLocation ? <Button title="Map" Icon={MapPin} kind="soft" small style={{ flexGrow: 1 }} onPress={() => Linking.openURL(o.deliveryLocation
            ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.deliveryLocation.split(',').slice(0, 2).join(','))}`
            : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([o.address, o.landmark].filter(Boolean).join(', '))}`)} /> : null}
          <Button title={v.totals.balance <= 0 && o.status === 'DELIVERED' ? 'Invoice' : 'Bill'} Icon={FileText} kind="soft" small style={{ flexGrow: 1 }} onPress={openBill} />
          {changes ? <Button title="Link" Icon={Share2} kind="soft" small style={{ flexGrow: 1 }} busy={busy === 'link'} onPress={shareLink} /> : null}
        </View>
      </Card>

      <Card style={{ gap: 10 }}>
        <View style={os.money}>
          <MoneyCell label="Total" value={money(v.totals.total)} />
          <MoneyCell label="Paid" value={money(v.totals.paid)} tone={colors.green} />
          <MoneyCell label="Balance" value={money(v.totals.balance)} tone={v.totals.balance > 0 ? colors.orange : colors.text} />
        </View>
        <Bar value={v.totals.delivered} max={v.totals.quantity} color={colors.green} />
        <Text style={os.sub}>{count(v.totals.delivered)} of {count(v.totals.quantity)} delivered · {v.totals.trips} trip{v.totals.trips === 1 ? '' : 's'}
          {v.totals.delivery ? ` · delivery ${money(v.totals.delivery)}` : o.deliveryWaived ? ' · free delivery' : ''}{v.totals.claimed ? ` · ${money(v.totals.claimed)} reported, to verify` : ''}</Text>
      </Card>

      <SectionTitle title="Blocks" />
      <List>
        {v.items.map((i, k) => (
          <View key={i.brickTypeId} style={[os.item, k < v.items.length - 1 && st.rowLine]}>
            <TypeDot color={i.color} />
            <View style={{ flex: 1 }}>
              <Text style={os.itemName}>{i.name}</Text>
              <Text style={os.sub}>{count(i.quantity)} × {money(i.price, 2)}{i.mrp && i.mrp > i.price ? ` (MRP ${money(i.mrp, 2)})` : ''} · {count(i.delivered)} delivered{i.pending ? ` · ${count(i.pending)} to go` : ''}</Text>
            </View>
            <Text style={os.amt}>{money(i.amount)}</Text>
          </View>
        ))}
      </List>

      <SectionTitle title="Trips" Icon={Truck} right={runsTrips && open ? <Text style={os.link} onPress={() => run('add-trip', () => app.call(`/bricks/orders/${o.id}/trips`, { method: 'POST' }), 'A trip was added')}>+ Add a trip</Text> : null} />
      {v.trips.length ? v.trips.map(t => (
        <TripCard key={t.trip.id} t={t} busy={busy === `trip-${t.trip.id}`} canRun={runsTrips && o.status !== 'CANCELLED'}
          onNext={() => {
            const at = STEPS.indexOf(t.trip.status);
            const next = STEPS[at + 1];
            if (next === 'DELIVERED') setDelivering(t); else if (next) step(t, next);
          }}
          onBack={() => { const at = STEPS.indexOf(t.trip.status); if (at > 0) step(t, STEPS[at - 1]); }} />
      )) : <Text style={os.sub}>No trips planned yet.</Text>}

      <SectionTitle title="Payments" Icon={Banknote} right={takesPay && o.status !== 'CANCELLED' && v.totals.balance > 0 ? <Text style={os.link} onPress={() => setSheet('pay')}>+ Record a payment</Text> : null} />
      {v.payments.length ? (
        <List>
          {v.payments.map((p, k) => (
            <Pressable key={p.payment.id} onPress={p.payment.status === 'CLAIMED' ? undefined : openBill}
              style={[os.item, k < v.payments.length - 1 && st.rowLine, { flexWrap: 'wrap' }]}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <Text style={os.itemName}>{money(p.payment.amount)}</Text>
                  <Badge text={p.payment.status === 'CLAIMED' ? 'Reported by the customer' : `Receipt ${p.payment.receiptNo || ''}`} tone={p.payment.status === 'CLAIMED' ? 'warn' : 'good'} />
                </View>
                <Text style={os.sub}>{shortDate(p.payment.receivedOn)} · {p.payment.mode || 'Cash'}{p.payment.reference ? ` · Ref ${p.payment.reference}` : ''}{p.account ? ` · ${p.account}` : ''}</Text>
                {p.payment.note ? <Text style={os.sub}>{p.payment.note}</Text> : null}
              </View>
              {p.payment.status === 'CLAIMED' && takesPay ? (
                <View style={{ flexDirection: 'row', gap: 6, width: '100%', marginTop: 8 }}>
                  <Button title="Not received" kind="danger" Icon={X} small style={{ flexGrow: 1 }} busy={busy === `del-${p.payment.id}`}
                    onPress={() => run(`del-${p.payment.id}`, () => app.call(`/bricks/orders/${o.id}/payments/${p.payment.id}`, { method: 'DELETE' }), 'Payment turned down')} />
                  <Button title="Verified, received" kind="good" Icon={Check} small style={{ flexGrow: 1 }} onPress={() => setConfirming(p)} />
                </View>
              ) : null}
            </Pressable>
          ))}
        </List>
      ) : <Text style={os.sub}>Nothing paid yet.</Text>}

      {changes && open ? (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
          <Button title={o.deliveryWaived ? 'Charge delivery' : 'Free delivery'} Icon={Tag} kind="ghost" small style={{ flexGrow: 1 }}
            onPress={() => o.deliveryWaived ? run('waive', () => app.call(`/bricks/orders/${o.id}/waive`, { method: 'POST', body: { waive: false } }), 'Delivery charged again')
              : setSheet('waive')} />
          <Button title="Cancel order" Icon={Ban} kind="danger" small style={{ flexGrow: 1 }} onPress={() => setSheet('cancel')} />
        </View>
      ) : null}

      <ReasonSheet visible={sheet === 'cancel'} onClose={() => setSheet(null)} title={`Cancel ${o.orderNo}`} label="Why" required actionTitle="Cancel the order"
        actionKind="danger" ActionIcon={Ban} intro="When a checker has to agree, it goes to Approvals first."
        onSubmit={async t => { const out = await run('cancel', () => app.call(`/bricks/orders/${o.id}/cancel`, { method: 'POST', body: { note: t } }), heldOr('Order cancelled')); if (out) setSheet(null); }} />
      <ReasonSheet visible={sheet === 'waive'} onClose={() => setSheet(null)} title="Free delivery" label="Why the delivery is free" required actionTitle="Give free delivery"
        ActionIcon={Tag} intro={v.freeDeliveryQualifies ? 'This order is large enough for free delivery.' : 'When a checker has to agree, it goes to Approvals first.'}
        onSubmit={async t => { const out = await run('waive', () => app.call(`/bricks/orders/${o.id}/waive`, { method: 'POST', body: { waive: true, reason: t } }), heldOr('Delivery is free')); if (out) setSheet(null); }} />
      <PaySheet visible={sheet === 'pay'} onClose={() => setSheet(null)} orderId={o.id} balance={v.totals.balance} />
      <ConfirmSheet payment={confirming} orderId={o.id} onClose={() => setConfirming(null)} />
      <DeliverSheet trip={delivering} onClose={() => setDelivering(null)} onDeliver={async items => { await step(delivering!, 'DELIVERED', items); setDelivering(null); }} />
    </Screen>
  );
}

/** "Order cancelled", unless the answer is a request that waits for a checker. */
function heldOr(text: string) {
  return (out: any) => (out?.pending ? `${out.pending.approvalNo}: sent for approval` : text);
}

function MoneyCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={st.factLabel}>{label}</Text>
      <Text style={[os.big, tone ? { color: tone } : null]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

function TripCard({ t, canRun, busy, onNext, onBack }: { t: TripView; canRun: boolean; busy: boolean; onNext: () => void; onBack: () => void }) {
  const at = STEPS.indexOf(t.trip.status);
  const when = t.trip.deliveredAt || t.trip.inTransitAt || t.trip.dispatchedAt || t.trip.loadingAt;
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={os.itemName}>Trip {t.trip.tripNo}</Text>
        <Badge text={STEP_LABEL[t.trip.status] || t.trip.status} tone={statusTone(t.trip.status)} />
        <View style={{ flex: 1 }} />
        <Text style={os.amt}>{count(t.delivered ?? t.quantity)}</Text>
      </View>
      <View style={os.steps}>
        {STEPS.map((s, i) => (
          <View key={s} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
            <View style={[os.dot, i <= at && { backgroundColor: i === STEPS.length - 1 ? colors.green : colors.orange }]}>
              {i <= at ? <Check color={colors.white} size={10} strokeWidth={3} /> : null}
            </View>
            <Text style={[os.stepText, i === at && { color: colors.text, fontWeight: '800' }]} numberOfLines={1}>{STEP_LABEL[s]}</Text>
          </View>
        ))}
      </View>
      <Text style={os.sub}>{t.items.map(i => `${count(i.delivered ?? i.quantity)} ${i.name}`).join(' · ')}
        {t.trip.scheduledOn ? ` · for ${shortDate(t.trip.scheduledOn)}` : ''}{t.vehicle ? ` · ${t.vehicle}` : ''}{t.driver ? ` · ${t.driver}` : ''}{when ? ` · ${dateTime(when)}` : ''}</Text>
      {t.acknowledged ? <Badge text={`Signed by ${t.trip.ackName || 'the customer'}`} tone="good" Icon={CircleCheck} /> : null}
      {canRun && at >= 0 && at < STEPS.length - 1 ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {at > 0 ? <Button title="Back" kind="ghost" Icon={Undo2} small onPress={onBack} /> : null}
          <Button title={NEXT_ACTION[t.trip.status]} Icon={at === STEPS.length - 2 ? CircleCheck : Truck} kind={at === STEPS.length - 2 ? 'good' : 'dark'} busy={busy} onPress={onNext} />
        </View>
      ) : null}
    </Card>
  );
}

/** Delivered: how many of each type arrived (fewer when some broke on the way). */
function DeliverSheet({ trip, onClose, onDeliver }: { trip: TripView | null; onClose: () => void; onDeliver: (items: { brickTypeId: number; quantity: number }[]) => Promise<void> }) {
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (trip) setCounts(Object.fromEntries(trip.items.map(i => [i.brickTypeId, String(i.quantity)]))); }, [trip]);
  if (!trip) return null;
  return (
    <Sheet visible onClose={onClose} title={`Trip ${trip.trip.tripNo} delivered`}
      footer={<Button title="Mark delivered" kind="good" Icon={CircleCheck} busy={busy} onPress={async () => {
        setBusy(true);
        try { await onDeliver(trip.items.map(i => ({ brickTypeId: i.brickTypeId, quantity: Math.min(i.quantity, Math.round(num(counts[i.brickTypeId] ?? '0'))) }))); } finally { setBusy(false); }
      }} />}>
      <Text style={os.sub}>The bill counts what arrived. Lower a count when some blocks broke on the way.</Text>
      {trip.items.map(i => (
        <Field key={i.brickTypeId} label={`${i.name} · loaded ${count(i.quantity)}`} keyboardType="number-pad" value={counts[i.brickTypeId] ?? ''}
          onChangeText={x => setCounts(c => ({ ...c, [i.brickTypeId]: x }))} />
      ))}
    </Sheet>
  );
}

const MODES = ['Cash', 'UPI', 'Bank', 'Cheque', 'Card'];

function PaySheet({ visible, onClose, orderId, balance }: { visible: boolean; onClose: () => void; orderId: number; balance: number }) {
  const app = useApp();
  const { busy, run } = useAct();
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('Cash');
  const [reference, setReference] = useState('');
  const [day, setDay] = useState(isoDate());
  const [accountId, setAccountId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!visible) return;
    setAmount(String(balance || '')); setMode('Cash'); setReference(''); setDay(isoDate()); setNote('');
    app.loadAccounts().then(a => setAccountId(app.meta?.settings.receiptAccountId ?? a[0]?.id ?? null));
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    const out = await run('pay', () => app.call(`/bricks/orders/${orderId}/payments`, { method: 'POST',
      body: { amount: num(amount), receivedOn: day, mode, reference: reference.trim() || null, accountId, note: note.trim() || null } }), `${money(num(amount))} received`);
    if (out) onClose();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Record a payment"
      footer={<Button title="Save payment" Icon={Check} busy={busy === 'pay'} disabled={num(amount) <= 0} onPress={save} />}>
      <Field label="Amount (₹)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} hint={`Balance ${money(balance)}`} />
      <Chips value={mode} onChange={setMode} options={MODES.map(m => ({ value: m, label: m }))} />
      {mode !== 'Cash' ? <Field label={mode === 'Cheque' ? 'Cheque no.' : 'UPI / bank reference'} value={reference} onChangeText={setReference} autoCapitalize="characters" /> : null}
      <DateField label="Received on" value={day} onChange={setDay} />
      <Select label="Into" value={accountId} onChange={setAccountId} options={app.accounts.map(a => ({ value: a.id, label: a.name, sub: a.brickBook ? 'Brick business' : undefined }))} />
      <Field label="Note (optional)" value={note} onChangeText={setNote} />
    </Sheet>
  );
}

/** A payment the customer reported: checked against the bank (the reference), then put in the books. */
function ConfirmSheet({ payment, orderId, onClose }: { payment: PaymentView | null; orderId: number; onClose: () => void }) {
  const app = useApp();
  const { busy, run } = useAct();
  const [accountId, setAccountId] = useState<number | null>(null);
  const [day, setDay] = useState(isoDate());
  useEffect(() => {
    if (!payment) return;
    setDay(payment.payment.receivedOn || isoDate());
    app.loadAccounts().then(a => setAccountId(app.meta?.settings.receiptAccountId ?? a.find(x => x.accountType === 'BANK')?.id ?? a[0]?.id ?? null));
  }, [payment]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!payment) return null;
  const p = payment.payment;
  return (
    <Sheet visible onClose={onClose} title="Verify the payment"
      footer={<Button title="Received: put in the books" kind="good" Icon={Check} busy={busy === 'confirm'} onPress={async () => {
        const out = await run('confirm', () => app.call(`/bricks/orders/${orderId}/payments/${p.id}/confirm`, { method: 'POST', body: { accountId, receivedOn: day } }), `${money(p.amount)} confirmed`);
        if (out) onClose();
      }} />}>
      <Banner Icon={Banknote} tone="warn" text={`${money(p.amount)} by ${p.mode || 'UPI'}${p.reference ? `, reference ${p.reference}` : ''}. Find this reference in the bank's or the UPI app's history before you confirm.`} />
      <Facts items={[['Reported', dateTime(p.createdAt)], ['Reference', p.reference], ['Note', p.note]]} />
      <Select label="Received into" value={accountId} onChange={setAccountId} options={app.accounts.map(a => ({ value: a.id, label: a.name }))} />
      <DateField label="Received on" value={day} onChange={setDay} />
    </Sheet>
  );
}

// ===================================================================== a new order

type Line = { qty: string; price: string };

export function NewOrderScreen() {
  const app = useApp();
  const nav = useNav();
  const { busy, run } = useAct();
  const customers = useLoad<Customer[]>('/bricks/customers');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [landmark, setLandmark] = useState('');
  const [needed, setNeeded] = useState('');
  const [lines, setLines] = useState<Record<number, Line>>({});
  const [free, setFree] = useState(false);
  const [freeWhy, setFreeWhy] = useState('');
  const [note, setNote] = useState('');
  const [checkerNote, setCheckerNote] = useState('');
  const [picking, setPicking] = useState(false);
  useEffect(() => { app.loadMeta(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const types = (app.meta?.types || []).filter(t => t.active !== false);
  const matches = useMemo(() => {
    const w = name.trim().toLowerCase();
    if (!w || !picking) return [];
    return (customers.data || []).filter(c => `${c.name} ${c.phone || ''}`.toLowerCase().includes(w)).slice(0, 5);
  }, [name, picking, customers.data]);
  const items = types.map(t => ({ t, qty: Math.round(num(lines[t.id]?.qty || '')), price: num(lines[t.id]?.price ?? String(t.mrp ?? '')) })).filter(x => x.qty > 0);
  const total = items.reduce((s, x) => s + x.qty * x.price, 0);
  const below = items.filter(x => x.t.minPrice !== null && x.price < (x.t.minPrice || 0));
  const checker = !!app.profile?.permissions.includes('APPROVE');
  const ok = name.trim().length > 0 && items.length > 0 && items.every(x => x.price > 0);

  const save = async () => {
    const order = { orderDate: isoDate(), requiredBy: needed || null, customerName: name.trim(), customerPhone: phone.trim() || null, address: address.trim() || null,
      landmark: landmark.trim() || null, items: items.map(x => ({ brickTypeId: x.t.id, quantity: x.qty, price: x.price })), note: note.trim() || null,
      waiveDelivery: free || null, waiveReason: free ? freeWhy.trim() || null : null };
    const out = await run('save', () => app.call<PlaceOutcome>('/bricks/orders', { method: 'POST', body: { order, note: checkerNote.trim() || null } }),
      o => o.pending ? `${o.pending.approvalNo}: sent for approval` : `Order ${o.order?.order.orderNo} taken`);
    if (out && 'order' in out) {
      if (out.pending) nav.replace('Approval', { id: out.pending.id });
      else if (out.order) nav.replace('Order', { id: out.order.order.id });
    }
  };

  return (
    <Screen title="New order" subtitle="Grey blocks for a customer" onBack={() => nav.pop()}
      footer={<Button title={below.length && !checker ? 'Send for approval' : `Take the order · ${money(total)}`} Icon={below.length && !checker ? Send : Check}
        busy={busy === 'save'} disabled={!ok} onPress={save} />}>
      <SectionTitle title="Customer" />
      <Card style={{ gap: 12 }}>
        <View>
          <Field label="Name" value={name} onChangeText={x => { setName(x); setPicking(true); }} placeholder="Customer or firm" />
          {matches.length ? (
            <View style={os.suggest}>
              {matches.map(c => (
                <Row key={c.name + c.phone} title={c.name} sub={[c.phone, c.address].filter(Boolean).join(' · ')}
                  right={c.balance > 0 ? `${money(c.balance)} due` : `${c.orders} order${c.orders === 1 ? '' : 's'}`}
                  onPress={() => { setName(c.name); setPhone(c.phone || ''); setAddress(c.address || ''); setLandmark(c.landmark || ''); setPicking(false); }} />
              ))}
            </View>
          ) : null}
        </View>
        <Field label="Mobile" value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={20} />
        <Field label="Deliver to" value={address} onChangeText={setAddress} placeholder="Site address" multiline />
        <Field label="Landmark" value={landmark} onChangeText={setLandmark} />
        <DateField label="Needed by" value={needed} onChange={setNeeded} future />
      </Card>

      <SectionTitle title="Blocks" />
      {!types.length ? <Loading text="Loading the brick types…" /> : (
        <Card style={{ gap: 14 }}>
          {types.map(t => {
            const l = lines[t.id] || { qty: '', price: t.mrp ? String(t.mrp) : '' };
            const low = t.minPrice !== null && num(l.qty) > 0 && num(l.price) < (t.minPrice || 0);
            return (
              <View key={t.id} style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <TypeDot color={t.color} />
                  <Text style={os.itemName}>{t.name}</Text>
                  <Text style={os.sub}>{t.mrp ? `MRP ${money(t.mrp, 2)}` : ''}{t.minPrice ? ` · lowest ${money(t.minPrice, 2)}` : ''}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Field label="Quantity" style={{ flex: 1 }} keyboardType="number-pad" value={l.qty} placeholder="0"
                    onChangeText={x => setLines(s => ({ ...s, [t.id]: { ...l, qty: x } }))} />
                  <Field label="Price a block (₹)" style={{ flex: 1 }} keyboardType="decimal-pad" value={l.price}
                    onChangeText={x => setLines(s => ({ ...s, [t.id]: { ...l, price: x } }))} error={low ? `Below the lowest ${money(t.minPrice, 2)}` : undefined} />
                </View>
              </View>
            );
          })}
        </Card>
      )}
      {below.length && !checker ? (
        <Card style={{ gap: 10 }}>
          <Banner Icon={Send} tone="warn" text="A price below the lowest goes to a checker: the order is made when they approve it." />
          <Field label="A word for the checker" value={checkerNote} onChangeText={setCheckerNote} multiline placeholder="Why this price (a regular customer, a big order …)" />
        </Card>
      ) : null}

      <SectionTitle title="Delivery" />
      <Card style={{ gap: 10 }}>
        <Toggle label="Free delivery" sub="No delivery charge on this order" value={free} onChange={setFree} />
        {free ? <Field label="Why it is free" value={freeWhy} onChangeText={setFreeWhy} /> : null}
        <Field label="Note (optional)" value={note} onChangeText={setNote} multiline />
      </Card>
      {items.length ? (
        <Card style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={os.sub}>{count(items.reduce((s, x) => s + x.qty, 0))} blocks</Text>
          <Text style={os.big}>{money(total)}</Text>
        </Card>
      ) : null}
    </Screen>
  );
}

const os = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cust: { flex: 1, fontSize: 16, fontWeight: '800', color: colors.text },
  sub: { fontSize: 12.5, color: colors.text2, lineHeight: 18 },
  amt: { fontSize: 15, fontWeight: '800', color: colors.text },
  big: { fontSize: 19, fontWeight: '900', color: colors.text },
  money: { flexDirection: 'row', gap: 10 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: space.m, backgroundColor: colors.card },
  itemName: { fontSize: 14.5, fontWeight: '800', color: colors.text },
  link: { color: colors.orange, fontWeight: '800', fontSize: 12.5 },
  steps: { flexDirection: 'row', paddingVertical: 2 },
  dot: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.concreteSoft, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 10, color: colors.muted, fontWeight: '600' },
  suggest: { marginTop: 6, borderRadius: radius.m, overflow: 'hidden', borderWidth: 1, borderColor: colors.line },
});
