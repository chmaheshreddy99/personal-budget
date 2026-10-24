/**
 * Home: what needs the user now (requests to decide or answer, payments to verify, trips today, raw material running
 * low), the day's figures they may see, quick actions for what they may record, and every screen given to them.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Bell, BrickWall, ServerCrash, ClipboardCheck, Factory, Hourglass, IndianRupee, PackageCheck, Plus, Receipt, ShoppingCart, TriangleAlert, Truck, Wallet,
} from 'lucide-react-native';
import { useApp, useLoad } from '../state';
import { useNav } from '../nav';
import { given } from '../modules';
import { colors, radius, space } from '../theme';
import { count, isoDate, money, moneyShort } from '../format';
import { Dashboard, OrderRow, Production } from '../types';
import { Avatar, Banner, Card, Grid, HeaderButton, IconBubble, Row, Screen, SectionTitle, Stat, List } from '../ui';
import { initials } from '../format';
import { BrandMark } from './common';

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function HomeScreen() {
  const app = useApp();
  const nav = useNav();
  const p = app.profile!;
  const has = app.has;
  const dash = useLoad<Dashboard>(has('DASHBOARD') ? '/bricks/dashboard' : null);
  const prod = useLoad<Production>(!has('DASHBOARD') && (has('STOCK') || has('PRODUCTION') || has('PURCHASES')) ? '/bricks/production' : null);
  const orders = useLoad<OrderRow[]>(has('ORDERS') || has('DELIVERIES') || has('PAYMENTS') ? '/bricks/orders' : null);
  const today = isoDate();

  const open = (orders.data || []).filter(o => o.status !== 'DELIVERED' && o.status !== 'CANCELLED');
  const tripsToday = open.filter(o => o.nextTrip && o.nextTrip <= today).length;
  const toVerify = (orders.data || []).filter(o => o.claimed).length;
  const stock = dash.data?.stock || prod.data?.stock || [];
  const materials = dash.data?.materials || prod.data?.materials || [];
  const low = materials.filter(m => m.low);
  const ready = stock.reduce((s, t) => s + t.ready, 0);
  const available = stock.reduce((s, t) => s + t.available, 0);
  const checker = p.permissions.includes('APPROVE');

  const reload = async () => { await Promise.all([dash.reload(), prod.reload(), orders.reload(), app.refreshProfile()]); };

  return (
    <Screen title={p.brandName || p.company || p.organization} lead={<BrandMark size={40} />} subtitle={`${greeting()}, ${p.fullName.split(' ')[0]} · ${p.roleLabel}`} dark
      refreshing={dash.refreshing || prod.refreshing || orders.refreshing} onRefresh={reload} stale={dash.stale || prod.stale || orders.stale}
      right={(
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {has('ALERTS') ? <HeaderButton Icon={Bell} badge={p.unreadNotices} onPress={() => nav.push('Alerts')} /> : null}
          <Pressable onPress={() => nav.push('Account')} hitSlop={6}><Avatar text={initials(p.fullName)} size={36} /></Pressable>
        </View>
      )}>

      {app.serverBehind ? (
        <Banner Icon={ServerCrash} tone="bad" text={'The server runs an older version than this app: orders taken here do not alert the office, and bills and slips do not open. '
          + 'Ask your admin to update and restart it (./app.sh restart --build).'} />
      ) : null}

      {/* what needs the user now */}
      {has('APPROVALS') && p.pendingApprovals > 0 ? (
        <Card onPress={() => nav.push('Approvals')} style={hs.attention}>
          <IconBubble Icon={ClipboardCheck} tone="accent" size={46} />
          <View style={{ flex: 1 }}>
            <Text style={hs.attTitle}>{checker ? `${p.pendingApprovals} request${p.pendingApprovals === 1 ? '' : 's'} wait for you`
              : `${p.pendingApprovals} request${p.pendingApprovals === 1 ? ' was' : 's were'} turned down`}</Text>
            <Text style={hs.attSub}>{checker ? 'Check the evidence, then approve or reject with a reason' : 'Answer the reason and send it again'}</Text>
          </View>
        </Card>
      ) : null}
      {has('PAYMENTS') && toVerify > 0 ? (
        <Card onPress={() => nav.push('Payments')} style={hs.attention}>
          <IconBubble Icon={IndianRupee} tone="good" size={46} />
          <View style={{ flex: 1 }}>
            <Text style={hs.attTitle}>{toVerify} payment{toVerify === 1 ? '' : 's'} to verify</Text>
            <Text style={hs.attSub}>Customers reported paying: match the UPI reference with the bank</Text>
          </View>
        </Card>
      ) : null}
      {low.length && (has('STOCK') || has('PURCHASES') || has('DASHBOARD')) ? (
        <Card onPress={() => nav.push(has('STOCK') ? 'Stock' : has('PURCHASES') ? 'Purchases' : 'Dashboard')} style={hs.attention}>
          <IconBubble Icon={TriangleAlert} tone="warn" size={46} />
          <View style={{ flex: 1 }}>
            <Text style={hs.attTitle}>Running low: {low.map(m => m.name).join(', ')}</Text>
            <Text style={hs.attSub}>{low.map(m => m.daysLeft !== null ? `${m.name} ~${m.daysLeft} day${m.daysLeft === 1 ? '' : 's'}` : null).filter(Boolean).join(' · ') || 'Below the reorder level'}</Text>
          </View>
        </Card>
      ) : null}

      {/* the day's figures */}
      {dash.data ? (
        <Grid>
          <Stat label="Made today" value={count(dash.data.kpis.producedToday)} sub={`${count(dash.data.kpis.producedMonth)} this month`} Icon={Factory} tone="warn" />
          <Stat label="Ready to sell" value={count(dash.data.kpis.available)} sub={`${count(dash.data.kpis.curing)} curing · ${count(dash.data.kpis.booked)} booked`} Icon={BrickWall} />
          <Stat label="Trips today" value={count(dash.data.kpis.tripsToday)} sub={`${count(dash.data.kpis.onTheWay)} on the way`} Icon={Truck} tone="accent" />
          <Stat label="Sales this month" value={moneyShort(dash.data.kpis.salesMonth)} sub={`Profit ${moneyShort(dash.data.kpis.profitMonth)}`} Icon={Wallet} tone="good" />
          <Stat label="To collect" value={moneyShort(dash.data.kpis.receivable)} sub={`${count(dash.data.kpis.openOrders)} open orders`} Icon={IndianRupee} tone="info" />
          <Stat label="Wages due" value={moneyShort(dash.data.kpis.wagesDue)} sub={`Advances ${moneyShort(dash.data.kpis.advancesOutstanding)}`} Icon={Hourglass} tone="violet" />
        </Grid>
      ) : stock.length || orders.data ? (
        <Grid>
          {stock.length ? <Stat label="Ready in the yard" value={count(ready)} sub={`${count(available)} free to sell`} Icon={BrickWall} /> : null}
          {orders.data ? <Stat label="Open orders" value={count(open.length)} sub={`${tripsToday} with a trip due`} Icon={Truck} tone="accent" /> : null}
        </Grid>
      ) : null}

      {/* quick actions */}
      {p.record && (has('ORDERS') || has('PRODUCTION') || has('PURCHASES')) ? (
        <>
          <SectionTitle title="Record" Icon={Plus} />
          <View style={hs.quick}>
            {has('ORDERS') ? <Quick Icon={ShoppingCart} label="New order" onPress={() => nav.push('NewOrder')} /> : null}
            {has('PRODUCTION') ? <Quick Icon={Factory} label="Batch made" onPress={() => nav.push('NewBatch')} /> : null}
            {has('PURCHASES') ? <Quick Icon={PackageCheck} label="Material in" onPress={() => nav.push('NewPurchase')} /> : null}
            {has('PURCHASES') ? <Quick Icon={Receipt} label="Expense" onPress={() => nav.push('NewExpense')} /> : null}
          </View>
        </>
      ) : null}

      {/* stock by type, for who sees the yard */}
      {stock.length && has('STOCK') ? (
        <>
          <SectionTitle title="Blocks in the yard" Icon={BrickWall} right={<Text style={hs.link} onPress={() => nav.push('Stock')}>All stock</Text>} />
          <List>
            {stock.map((t, i) => (
              <Row key={t.brickTypeId} title={t.name} sub={`${count(t.curing)} curing · ${count(t.booked)} booked`} right={count(t.available)}
                rightSub="free to sell" last={i === stock.length - 1} />
            ))}
          </List>
        </>
      ) : null}

      <SectionTitle title="Your screens" />
      <View style={hs.grid}>
        {given(p).map(m => (
          <Pressable key={m.key} onPress={() => nav.push(m.route)} style={({ pressed }) => [hs.tile, pressed && { opacity: 0.85 }]}>
            <IconBubble Icon={m.Icon} tone={m.tone} size={42} />
            <Text style={hs.tileTitle} numberOfLines={1}>{m.label}</Text>
            <Text style={hs.tileSub} numberOfLines={1}>{m.hint}</Text>
          </Pressable>
        ))}
      </View>
      {dash.data?.kpis.receivable ? <Text style={hs.foot}>Receivable from customers: {money(dash.data.kpis.receivable)}</Text> : null}
    </Screen>
  );
}

function Quick({ Icon, label, onPress }: { Icon: any; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [hs.q, pressed && { opacity: 0.85 }]}>
      <View style={hs.qIcon}><Icon color={colors.white} size={20} /></View>
      <Text style={hs.qText} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const hs = StyleSheet.create({
  attention: { flexDirection: 'row', alignItems: 'center', gap: 12, borderLeftWidth: 4, borderLeftColor: colors.orange },
  attTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  attSub: { fontSize: 12.5, color: colors.text2, marginTop: 2 },
  quick: { flexDirection: 'row', gap: 10 },
  q: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: radius.l, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line },
  qIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center' },
  qText: { fontSize: 12, fontWeight: '800', color: colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '31%', flexGrow: 1, padding: space.m, gap: 6, borderRadius: radius.l, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line },
  tileTitle: { fontSize: 13, fontWeight: '800', color: colors.text },
  tileSub: { fontSize: 11, color: colors.muted },
  link: { color: colors.orange, fontWeight: '800', fontSize: 12.5 },
  foot: { fontSize: 12, color: colors.muted, textAlign: 'center' },
});
