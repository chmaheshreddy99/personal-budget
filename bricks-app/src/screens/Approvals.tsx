/**
 * Approvals (maker-checker): what waits for a checker, and what was decided.
 *  - A checker opens a request, reads why it needs one (a price below the lowest, a change to an order, a cancellation,
 *    free delivery, a change to a batch, a purchase or a payment), checks the evidence attached, and approves it (it is
 *    carried out then, as asked) or rejects it with a reason.
 *  - The maker answers a rejection (a comment, more evidence) and sends it again, or withdraws it.
 * Each step stays in the request's history.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Ban, Check, CircleAlert, CircleCheck, CircleX, ClipboardCheck, Clock, History, MessageSquare, Paperclip, Pencil, RefreshCw, Send,
  ShoppingCart, Tag, Undo2, X,
} from 'lucide-react-native';
import { useApp, useLoad } from '../state';
import { useNav } from '../nav';
import { colors, radius, space, Tone } from '../theme';
import { count, dateTime, money, shortDate } from '../format';
import { Approval, ApprovalStatus } from '../types';
import { Badge, Banner, Button, Card, Chips, Empty, Facts, IconBubble, List, Loading, ReasonSheet, Row, Screen, SectionTitle } from '../ui';
import { EvidenceGallery } from '../evidence';
import { useAct } from './common';

const STATUS: Record<ApprovalStatus, [string, Tone, any]> = {
  PENDING: ['Waiting', 'warn', Clock], APPROVED: ['Approved', 'good', CircleCheck], REJECTED: ['Rejected', 'bad', CircleX], WITHDRAWN: ['Withdrawn', 'neutral', Undo2],
};
const KIND_ICON: Record<string, any> = { BRICK_ORDER_NEW: ShoppingCart, BRICK_ORDER_CHANGE: Pencil, BRICK_ORDER_CANCEL: Ban, BRICK_ORDER_WAIVE: Tag, CHANGE: Pencil };
const STEP: Record<string, [string, Tone, any]> = {
  SUBMITTED: ['Asked', 'info', Send], RESUBMITTED: ['Answered and sent again', 'warn', RefreshCw], EDITED: ['Added to', 'info', Pencil],
  REJECTED: ['Rejected', 'bad', X], APPROVED: ['Approved', 'good', Check], WITHDRAWN: ['Withdrawn', 'neutral', Undo2],
};
/** Reasons a checker often gives, to tap instead of typing. */
const QUICK_REASONS = ['Price is below the lowest agreed', 'Evidence is missing or not clear', 'Customer details are incomplete',
  'Not agreed with the owner', 'Delivery charge cannot be waived for this quantity'];

type Filter = 'open' | 'back' | 'done' | 'all';

export function StatusBadge({ status }: { status: ApprovalStatus }) {
  const [label, tone, Icon] = STATUS[status] || [status, 'neutral', CircleAlert];
  return <Badge text={label} tone={tone} Icon={Icon} />;
}

export function ApprovalsScreen() {
  const app = useApp();
  const nav = useNav();
  const list = useLoad<Approval[]>('/bricks/approvals');
  const checker = !!app.profile?.permissions.includes('APPROVE');
  const all = list.data || [];
  const waiting = all.filter(a => a.status === 'PENDING');
  const rejected = all.filter(a => a.status === 'REJECTED');
  const [filter, setFilter] = useState<Filter>('open');
  // a maker with something rejected and nothing waiting: what to answer first
  useEffect(() => {
    if (!checker && list.data && !waiting.length && rejected.length) setFilter('back');
  }, [list.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = all.filter(a => filter === 'all' || (filter === 'open' ? a.status === 'PENDING' : filter === 'back' ? a.status === 'REJECTED'
    : a.status === 'APPROVED' || a.status === 'WITHDRAWN'));

  return (
    <Screen title="Approvals" subtitle={checker ? `${waiting.length} waiting for you` : 'Your requests to a checker'} onBack={nav.stack.length ? () => nav.pop() : undefined}
      refreshing={list.refreshing} onRefresh={list.reload} stale={list.stale} error={list.error}>
      <Chips value={filter} onChange={setFilter} options={[
        { value: 'open', label: `Waiting · ${waiting.length}` }, { value: 'back', label: `Rejected · ${rejected.length}` },
        { value: 'done', label: 'Decided' }, { value: 'all', label: 'All' }]} />
      {list.loading && !list.data ? <Loading /> : shown.length ? (
        <List>
          {shown.map((a, i) => (
            <Row key={a.id} Icon={KIND_ICON[a.kind] || ClipboardCheck} tone={a.status === 'PENDING' ? 'accent' : a.status === 'APPROVED' ? 'good' : 'neutral'}
              title={a.customerName || a.summary} sub={`${a.approvalNo} · ${a.kindLabel}\n${a.requestedBy || ''} · ${shortDate(a.requestedAt)}${a.attachmentCount ? ` · ${a.attachmentCount} attached` : ''}`}
              right={a.amount ? money(a.amount) : <View />} rightSub={null} badge={<StatusBadge status={a.status} />}
              onPress={() => nav.push('Approval', { id: a.id })} last={i === shown.length - 1} />
          ))}
        </List>
      ) : (
        <Empty Icon={ClipboardCheck} title={filter === 'open' ? (checker ? 'Nothing waits for you' : 'Nothing of yours waits') : 'Nothing here'}
          text={checker ? 'An order below the lowest price, and changes, cancellations or free delivery asked by a maker, wait here for you.'
            : 'What you record that needs a checker waits here, with their answer.'} />
      )}
    </Screen>
  );
}

export function ApprovalScreen({ id }: { id: number }) {
  const app = useApp();
  const nav = useNav();
  const res = useLoad<Approval>(`/bricks/approvals/${id}`);
  const { busy, run } = useAct();
  const [sheet, setSheet] = useState<'approve' | 'reject' | 'resubmit' | 'withdraw' | null>(null);
  const [evidence, setEvidence] = useState<number | null>(null);
  const a = res.data;

  useEffect(() => {
    app.loadMeta();
    if (app.has('ALERTS')) app.call('/bricks/notices/seen', { method: 'POST', body: { link: `bricks/approvals/${id}` } }).catch(() => undefined);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!a) return <Screen title="Request" onBack={() => nav.pop()} error={res.error}>{res.loading ? <Loading /> : null}</Screen>;

  const decideHere = a.canDecide && app.profile?.decide;
  const decided = a.status !== 'PENDING';
  const [, tone] = STATUS[a.status] || ['', 'neutral'];
  // the sheet shows the server's answer when it refuses (already decided, no longer possible …)
  const send = async (what: 'approve' | 'reject' | 'resubmit', note: string) => {
    await app.call<Approval>(`/bricks/approvals/${a.id}/${what}`, { method: 'POST', body: { note } });
    app.say(what === 'approve' ? `${a.approvalNo} approved${a.kind === 'BRICK_ORDER_NEW' ? ' · the order is made' : ''}`
      : what === 'reject' ? `${a.approvalNo} rejected` : `${a.approvalNo} sent again`);
    setSheet(null);
    nav.changed();
    app.refreshProfile();
  };

  const footer = decided && !a.canResubmit && !a.canWithdraw ? undefined : (
    <>
      {decideHere ? <Button title="Reject" kind="danger" Icon={X} onPress={() => setSheet('reject')} /> : null}
      {decideHere ? <Button title={a.kind === 'BRICK_ORDER_NEW' ? 'Approve & make' : 'Approve'} kind="good" Icon={Check} onPress={() => setSheet('approve')} /> : null}
      {a.canResubmit ? <Button title={a.status === 'REJECTED' ? 'Answer & send again' : 'Add a comment'} Icon={a.status === 'REJECTED' ? RefreshCw : MessageSquare}
        kind={a.status === 'REJECTED' ? 'primary' : 'ghost'} onPress={() => setSheet('resubmit')} /> : null}
      {a.canWithdraw ? <Button title="Withdraw" kind="ghost" Icon={Undo2} small busy={busy === 'withdraw'}
        onPress={() => run('withdraw', () => app.call(`/bricks/approvals/${a.id}/withdraw`, { method: 'POST' }), `${a.approvalNo} withdrawn`)} /> : null}
    </>
  );

  return (
    <Screen title={a.approvalNo} subtitle={a.kindLabel} onBack={() => nav.pop()} refreshing={res.refreshing} onRefresh={res.reload} stale={res.stale}
      error={res.error} footer={footer}>
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <IconBubble Icon={KIND_ICON[a.kind] || ClipboardCheck} tone={tone} size={46} />
          <View style={{ flex: 1 }}>
            <Text style={as.title}>{a.customerName || a.kindLabel}</Text>
            <Text style={as.sub}>{a.summary}</Text>
          </View>
          <StatusBadge status={a.status} />
        </View>
        <Facts items={[
          ['Asked by', `${a.requestedBy || '—'}\n${dateTime(a.requestedAt)}`],
          ['Amount', a.amount ? money(a.amount) : null],
          ['Order', a.kind === 'CHANGE' ? null : a.orderNo || (a.orderId ? 'Open the order' : 'Made when approved')],
          ['Sent again', a.resubmits ? `${a.resubmits} time${a.resubmits === 1 ? '' : 's'}` : null],
        ]} />
        {a.orderId && app.has('ORDERS') ? <Button title="Open the order" kind="ghost" small Icon={ShoppingCart} onPress={() => nav.push('Order', { id: a.orderId })} /> : null}
      </Card>

      {a.canDecide && !app.profile?.decide ? <Banner Icon={CircleAlert} tone="warn" text="Approving on the phone is switched off: decide on the web app." /> : null}

      <SectionTitle title={a.kind === 'CHANGE' ? 'What they ask to change' : 'Why it needs a checker'} Icon={CircleAlert} />
      <Card style={{ gap: 8 }}>
        {a.reasons.length ? a.reasons.map((r, i) => (
          <View key={i} style={as.reason}><View style={as.bullet} /><Text style={as.reasonText}>{r}</Text></View>
        )) : <Text style={as.sub}>—</Text>}
        {a.note ? <View style={as.quote}><Text style={as.quoteText}>“{a.note}”</Text><Text style={as.quoteBy}>— {a.requestedBy}</Text></View> : null}
      </Card>

      {a.request?.items?.length ? <OrderAsked a={a} /> : null}

      <SectionTitle title={`Evidence${evidence !== null ? ` · ${evidence}` : a.attachmentCount ? ` · ${a.attachmentCount}` : ''}`} Icon={Paperclip} />
      <Card>
        <EvidenceGallery pendingId={a.id} canAdd={a.canAttach} onCount={setEvidence} />
      </Card>

      {a.history?.length ? (
        <>
          <SectionTitle title="What happened" Icon={History} />
          <Card style={{ gap: 0 }}>
            {a.history.map((s, i) => {
              const [label, t, Icon] = STEP[s.action] || [s.action, 'neutral', CircleAlert];
              return (
                <View key={i} style={as.step}>
                  <View style={{ alignItems: 'center' }}>
                    <IconBubble Icon={Icon} tone={t} size={30} />
                    {i < a.history.length - 1 ? <View style={as.stepLine} /> : null}
                  </View>
                  <View style={{ flex: 1, paddingBottom: 14 }}>
                    <Text style={as.stepTitle}>{label}</Text>
                    <Text style={as.stepSub}>{[s.by, dateTime(s.at)].filter(Boolean).join(' · ')}</Text>
                    {s.note ? <Text style={as.stepNote}>{s.note}</Text> : null}
                  </View>
                </View>
              );
            })}
          </Card>
        </>
      ) : null}

      {decided ? (
        <Banner Icon={STATUS[a.status][2]} tone={tone} text={`${STATUS[a.status][0]}${a.decidedBy ? ` by ${a.decidedBy}` : ''}${a.decidedAt ? ` · ${dateTime(a.decidedAt)}` : ''}${a.decisionNote ? `\n“${a.decisionNote}”` : ''}`} />
      ) : !a.canDecide && !a.canResubmit ? <Text style={as.sub}>A checker decides; you are told as soon as they do.</Text> : null}

      <ReasonSheet visible={sheet === 'approve'} onClose={() => setSheet(null)} title={`Approve ${a.approvalNo}`} label="A word to the maker (optional)"
        placeholder="Fine this once" actionTitle="Approve" actionKind="good" ActionIcon={Check} onSubmit={t => send('approve', t)}
        intro={(a.kind === 'BRICK_ORDER_NEW' ? 'The order is made now, as it was asked, and is theirs.' : a.kind === 'CHANGE'
          ? 'The change is made now, exactly as asked; if it can no longer be made you are told and nothing changes.' : 'It is carried out now, as it was asked.')
          + ((evidence ?? a.attachmentCount) ? '' : '\n\nNo evidence is attached to this request.')} />
      <ReasonSheet visible={sheet === 'reject'} onClose={() => setSheet(null)} title={`Reject ${a.approvalNo}`} label="Why it is rejected" required
        placeholder="The price stays at the list price" actionTitle="Reject" actionKind="danger" ActionIcon={X} onSubmit={t => send('reject', t)}
        intro="Nothing is changed. The maker sees your reason, and can answer it and send it again." suggestions={QUICK_REASONS} />
      <ReasonSheet visible={sheet === 'resubmit'} onClose={() => setSheet(null)} title={a.status === 'REJECTED' ? 'Answer and send again' : `Add to ${a.approvalNo}`}
        label={a.status === 'REJECTED' ? 'Your answer' : 'What you add'} required actionTitle={a.status === 'REJECTED' ? 'Send again' : 'Add'} ActionIcon={Send}
        placeholder="The customer buys 5,000 a month; the owner agreed the price on the phone" onSubmit={t => send('resubmit', t)}
        intro={a.status === 'REJECTED' ? `Rejected by ${a.decidedBy || 'the checker'}: “${a.decisionNote || ''}”` : undefined}>
        <Text style={as.label}>Evidence (a photo, a scan or a PDF)</Text>
        <EvidenceGallery pendingId={a.id} canAdd onCount={setEvidence} />
      </ReasonSheet>
    </Screen>
  );
}

/** The order as it was asked (or as it would be after the change): each type's price against its lowest and MRP. */
function OrderAsked({ a }: { a: Approval }) {
  const { meta } = useApp();
  const r = a.request!;
  const types = useMemo(() => new Map((meta?.types || []).map(t => [t.id, t])), [meta]);
  const total = r.items.reduce((s, i) => s + i.price * i.quantity, 0);
  const bricks = r.items.reduce((s, i) => s + i.quantity, 0);
  return (
    <>
      <SectionTitle title={a.kind === 'BRICK_ORDER_NEW' ? 'The order as asked' : 'The order as it would be'} Icon={ShoppingCart} />
      <Card style={{ gap: 10 }}>
        {r.items.map((i, k) => {
          const t = types.get(i.brickTypeId);
          const low = t?.minPrice !== null && t?.minPrice !== undefined && i.price < t.minPrice;
          return (
            <View key={k} style={[as.item, low && as.itemLow]}>
              <View style={{ flex: 1 }}>
                <Text style={as.itemName}>{t?.name || 'Blocks'}</Text>
                <Text style={as.sub}>{count(i.quantity)} × <Text style={[as.price, low && { color: colors.red }]}>{money(i.price, 2)}</Text>
                  {t?.minPrice ? `  · lowest ${money(t.minPrice, 2)}` : ''}{t?.mrp ? `  · MRP ${money(t.mrp, 2)}` : ''}</Text>
              </View>
              <Text style={as.itemAmt}>{money(i.price * i.quantity)}</Text>
            </View>
          );
        })}
        <View style={as.totalRow}><Text style={as.totalLabel}>{count(bricks)} blocks</Text><Text style={as.total}>{money(total)}</Text></View>
        <Facts items={[
          ['Customer', [r.customerName, r.customerPhone].filter(Boolean).join(' · ')],
          ['Deliver to', [r.address, r.landmark].filter(Boolean).join(', ')],
          ['Needed by', r.requiredBy ? shortDate(r.requiredBy) : null],
          ['Delivery a trip', r.deliveryChargePerTrip !== null && r.deliveryChargePerTrip !== undefined ? money(r.deliveryChargePerTrip) : null],
          ['Free delivery', r.waiveDelivery ? `Yes${r.waiveReason ? ` · ${r.waiveReason}` : ''}` : null],
          ['Vehicle', r.hired ? `Hired${r.hiredVehicle ? ` · ${r.hiredVehicle}` : ''}` : null],
          ['Note', r.note],
        ]} />
      </Card>
    </>
  );
}

const as = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  sub: { fontSize: 13, color: colors.text2, lineHeight: 19 },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: colors.muted, textTransform: 'uppercase' },
  reason: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  bullet: { width: 7, height: 7, borderRadius: 2, backgroundColor: colors.orange, marginTop: 7 },
  reasonText: { flex: 1, fontSize: 14.5, color: colors.text, lineHeight: 21, fontWeight: '600' },
  quote: { marginTop: 4, padding: space.m, borderRadius: radius.m, backgroundColor: colors.sunken, borderLeftWidth: 3, borderLeftColor: colors.concrete },
  quoteText: { fontSize: 14, color: colors.text, fontStyle: 'italic', lineHeight: 20 },
  quoteBy: { fontSize: 12, color: colors.muted, marginTop: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: radius.m, backgroundColor: colors.sunken },
  itemLow: { backgroundColor: colors.redSoft },
  itemName: { fontSize: 14.5, fontWeight: '800', color: colors.text },
  price: { fontWeight: '800', color: colors.text },
  itemAmt: { fontSize: 14.5, fontWeight: '800', color: colors.text },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 10, paddingTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  totalLabel: { fontSize: 13, color: colors.text2, fontWeight: '700' },
  total: { fontSize: 17, fontWeight: '900', color: colors.text },
  step: { flexDirection: 'row', gap: 12 },
  stepLine: { width: 2, flex: 1, backgroundColor: colors.line, marginVertical: 2 },
  stepTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  stepSub: { fontSize: 12, color: colors.muted },
  stepNote: { fontSize: 13.5, color: colors.text, marginTop: 4, lineHeight: 19 },
});
