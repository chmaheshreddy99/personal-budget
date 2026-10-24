/**
 * Deliveries: the open orders by when their next trip is due (late or today first), to run each trip on the order;
 * Payments: what customers reported paying (to verify against the bank) and what is still to collect.
 */
import React from 'react';
import { Text, View } from 'react-native';
import { Banknote, CalendarClock, CircleAlert, Truck } from 'lucide-react-native';
import { useLoad } from '../state';
import { useNav } from '../nav';
import { colors } from '../theme';
import { count, isoDate, money } from '../format';
import { OrderRow } from '../types';
import { Card, Empty, Grid, Loading, Screen, SectionTitle, Stat } from '../ui';
import { OrderCard } from './Orders';

const isOpen = (o: OrderRow) => o.status !== 'DELIVERED' && o.status !== 'CANCELLED';

export function DeliveriesScreen() {
  const nav = useNav();
  const list = useLoad<OrderRow[]>('/bricks/orders');
  const today = isoDate();
  const open = (list.data || []).filter(isOpen).sort((a, b) => (a.nextTrip || '9999').localeCompare(b.nextTrip || '9999'));
  const due = open.filter(o => o.nextTrip && o.nextTrip <= today);
  const later = open.filter(o => o.nextTrip && o.nextTrip > today);
  const none = open.filter(o => !o.nextTrip);
  const blocks = open.reduce((s, o) => s + o.quantity - o.delivered, 0);

  return (
    <Screen title="Deliveries" subtitle={`${due.length} due today or late`} onBack={nav.stack.length ? () => nav.pop() : undefined}
      refreshing={list.refreshing} onRefresh={list.reload} stale={list.stale} error={list.error}>
      {list.loading && !list.data ? <Loading /> : (
        <>
          <Grid>
            <Stat label="Due now" value={count(due.length)} sub="orders with a trip today or late" Icon={CircleAlert} tone={due.length ? 'accent' : 'neutral'} />
            <Stat label="Still to deliver" value={count(blocks)} sub={`blocks on ${open.length} orders`} Icon={Truck} />
          </Grid>
          {due.length ? <Group title="Today and late" list={due} onOpen={id => nav.push('Order', { id })} /> : null}
          {later.length ? <Group title="Coming up" list={later} onOpen={id => nav.push('Order', { id })} /> : null}
          {none.length ? <Group title="No trip planned" list={none} onOpen={id => nav.push('Order', { id })} /> : null}
          {!open.length ? <Empty Icon={Truck} title="Nothing to deliver" text="Every order is delivered." /> : null}
        </>
      )}
    </Screen>
  );
}

function Group({ title, list, onOpen }: { title: string; list: OrderRow[]; onOpen: (id: number) => void }) {
  return (
    <>
      <SectionTitle title={`${title} · ${list.length}`} Icon={CalendarClock} />
      <View style={{ gap: 10 }}>{list.map(o => <OrderCard key={o.id} o={o} onPress={() => onOpen(o.id)} />)}</View>
    </>
  );
}

export function PaymentsScreen() {
  const nav = useNav();
  const list = useLoad<OrderRow[]>('/bricks/orders');
  const all = (list.data || []).filter(o => o.status !== 'CANCELLED');
  const reported = all.filter(o => o.claimed);
  const owing = all.filter(o => o.balance > 0 && !o.claimed).sort((a, b) => b.balance - a.balance);
  const toCollect = all.reduce((s, o) => s + Math.max(0, o.balance), 0);

  return (
    <Screen title="Payments" subtitle={`${money(toCollect)} to collect`} onBack={nav.stack.length ? () => nav.pop() : undefined}
      refreshing={list.refreshing} onRefresh={list.reload} stale={list.stale} error={list.error}>
      {list.loading && !list.data ? <Loading /> : (
        <>
          <Grid>
            <Stat label="To verify" value={count(reported.length)} sub="reported by customers" Icon={Banknote} tone={reported.length ? 'warn' : 'neutral'} />
            <Stat label="To collect" value={money(toCollect)} sub={`on ${owing.length + reported.length} orders`} Icon={Banknote} tone="good" />
          </Grid>
          {reported.length ? (
            <>
              <SectionTitle title="Reported paid · verify" Icon={CircleAlert} />
              <Card style={{ backgroundColor: colors.amberSoft }}>
                <Text style={{ color: colors.amber, fontWeight: '700', fontSize: 12.5 }}>
                  Open the order, match the UPI reference with the bank, then confirm it or turn it down.
                </Text>
              </Card>
              <View style={{ gap: 10 }}>{reported.map(o => <OrderCard key={o.id} o={o} onPress={() => nav.push('Order', { id: o.id })} />)}</View>
            </>
          ) : null}
          <SectionTitle title={`To collect · ${owing.length}`} Icon={Banknote} />
          {owing.length ? <View style={{ gap: 10 }}>{owing.map(o => <OrderCard key={o.id} o={o} onPress={() => nav.push('Order', { id: o.id })} />)}</View>
            : <Empty Icon={Banknote} title="Nothing to collect" text="Every order is paid." />}
        </>
      )}
    </Screen>
  );
}
