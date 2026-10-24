/**
 * What who sees the money has on the phone: the dashboard (the day and the month at a glance, what needs attention,
 * who owes), the business's cash and bank, and the report for
 * a period (profit and loss, cost and price a block, production, expenses by head). The team's pay is in Team.tsx.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  BrickWall, CircleAlert, Factory, IndianRupee, Landmark, Lightbulb, TrendingUp, Truck, Users, Wallet,
} from 'lucide-react-native';
import { useLoad } from '../state';
import { useNav } from '../nav';
import { colors, Tone } from '../theme';
import { count, isoDate, monthEnd, monthStart, money, moneyShort, shortDate } from '../format';
import { BookAccount, Dashboard, Insight, MonthPoint, Report } from '../types';
import { Banner, Bar, Card, Chips, Empty, Grid, List, Loading, Row, Screen, SectionTitle, Stat } from '../ui';

const insightTone = (t: string): Tone => (t === 'good' ? 'good' : t === 'bad' || t === 'critical' ? 'bad' : t === 'warn' || t === 'warning' ? 'warn' : 'info');

function Insights({ list }: { list: Insight[] }) {
  if (!list?.length) return null;
  return (
    <>
      <SectionTitle title="Worth knowing" Icon={Lightbulb} />
      <View style={{ gap: 8 }}>
        {list.slice(0, 6).map((i, k) => <Banner key={k} Icon={insightTone(i.tone) === 'good' ? TrendingUp : CircleAlert} tone={insightTone(i.tone)} text={`${i.title}${i.text ? ` · ${i.text}` : ''}`} />)}
      </View>
    </>
  );
}

/** Revenue and profit by month, as bars. */
function Months({ months }: { months: MonthPoint[] }) {
  const shown = months.slice(-6);
  const max = Math.max(1, ...shown.map(m => Math.max(m.revenue, 0)));
  return (
    <Card style={{ gap: 10 }}>
      {shown.map(m => (
        <View key={m.month} style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={fs.small}>{m.month}</Text>
            <Text style={fs.small}>{moneyShort(m.revenue)} · <Text style={{ color: m.profit >= 0 ? colors.green : colors.red, fontWeight: '800' }}>{moneyShort(m.profit)}</Text></Text>
          </View>
          <Bar value={m.revenue} max={max} color={colors.slate} />
          <Bar value={Math.max(0, m.profit)} max={max} color={colors.green} height={4} />
        </View>
      ))}
      <Text style={fs.small}>Grey: revenue · green: profit</Text>
    </Card>
  );
}

export function DashboardScreen() {
  const nav = useNav();
  const res = useLoad<Dashboard>('/bricks/dashboard');
  const d = res.data;
  const k = d?.kpis;
  return (
    <Screen title="Dashboard" subtitle="The business at a glance" onBack={nav.stack.length ? () => nav.pop() : undefined}
      refreshing={res.refreshing} onRefresh={res.reload} stale={res.stale} error={res.error}>
      {!d || !k ? <Loading /> : (
        <>
          <Grid>
            <Stat label="Sales this month" value={moneyShort(k.salesMonth)} sub={`Received ${moneyShort(k.receiptsMonth)}`} Icon={Wallet} tone="good" />
            <Stat label="Profit this month" value={moneyShort(k.profitMonth)} sub="after material, wages and expenses" Icon={TrendingUp} tone={k.profitMonth >= 0 ? 'good' : 'bad'} />
            <Stat label="To collect" value={moneyShort(k.receivable)} sub={`${k.awaitingConfirmation} payment${k.awaitingConfirmation === 1 ? '' : 's'} to verify`} Icon={IndianRupee} tone="info" />
            <Stat label="Cash & bank" value={moneyShort(k.cashInBook)} sub={`Advances held ${moneyShort(k.advancesHeld)}`} Icon={Landmark} />
            <Stat label="Made" value={count(k.producedToday)} sub={`today · ${count(k.producedWeek)} this week`} Icon={Factory} tone="warn" />
            <Stat label="Free to sell" value={count(k.available)} sub={`${count(k.ready)} ready · ${count(k.curing)} curing`} Icon={BrickWall} />
            <Stat label="Open orders" value={count(k.openOrders)} sub={`${count(k.pendingBricks)} blocks to deliver${k.overdueOrders ? ` · ${k.overdueOrders} late` : ''}`} Icon={Truck} tone="accent" />
            <Stat label="Wages due" value={moneyShort(k.wagesDue)} sub={`Advances ${moneyShort(k.advancesOutstanding)}`} Icon={Users} tone="violet" />
          </Grid>
          <Insights list={d.insights} />
          {d.months?.length ? <><SectionTitle title="By month" Icon={TrendingUp} /><Months months={d.months} /></> : null}
          {d.upcoming?.length ? (
            <>
              <SectionTitle title="Trips coming" Icon={Truck} />
              <List>
                {d.upcoming.slice(0, 8).map((t, i) => (
                  <Row key={`${t.orderId}-${t.tripNo}`} Icon={Truck} tone={t.late ? 'bad' : 'accent'} title={`${t.customer} · trip ${t.tripNo}`}
                    sub={`${t.orderNo} · ${t.scheduledOn ? shortDate(t.scheduledOn) : 'not planned'}${t.vehicle ? ` · ${t.vehicle}` : ''}${t.late ? ' · late' : ''}`}
                    right={count(t.bricks)} onPress={() => nav.push('Order', { id: t.orderId })} last={i === Math.min(8, d.upcoming.length) - 1} />
                ))}
              </List>
            </>
          ) : null}
          {d.dues?.length ? (
            <>
              <SectionTitle title="Who owes" Icon={IndianRupee} />
              <List>
                {d.dues.slice(0, 8).map((c, i) => (
                  <Row key={c.name} title={c.name} sub={[c.phone, c.lastOrder ? `last order ${shortDate(c.lastOrder)}` : null].filter(Boolean).join(' · ')}
                    right={money(c.balance)} last={i === Math.min(8, d.dues.length) - 1} />
                ))}
              </List>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

export function CashbookScreen() {
  const nav = useNav();
  const res = useLoad<BookAccount[]>('/bricks/book');
  const list = (res.data || []).filter(a => a.accountClass === 'ASSET' && (a.type === 'CASH' || a.type === 'BANK' || a.type === 'WALLET' || a.book));
  const total = list.reduce((s, a) => s + a.balance, 0);
  return (
    <Screen title="Cash & bank" subtitle={`${money(total)} in all`} onBack={nav.stack.length ? () => nav.pop() : undefined}
      refreshing={res.refreshing} onRefresh={res.reload} stale={res.stale} error={res.error}>
      {!res.data ? <Loading /> : list.length ? (
        <List>
          {list.map((a, i) => (
            <Row key={a.id} Icon={a.type === 'BANK' ? Landmark : Wallet} tone={a.type === 'BANK' ? 'info' : 'good'} title={a.name}
              sub={`${[a.institution, a.accountNumber ? `•••${a.accountNumber.slice(-4)}` : null].filter(Boolean).join(' · ') || a.type.toLowerCase()}\nThis month +${moneyShort(a.monthIn)} / −${moneyShort(a.monthOut)}`}
              right={money(a.balance)} last={i === list.length - 1} />
          ))}
        </List>
      ) : <Empty Icon={Landmark} title="No accounts" />}
    </Screen>
  );
}

type Period = 'month' | 'last' | 'fy';

export function ReportsScreen() {
  const nav = useNav();
  const [period, setPeriod] = useState<Period>('month');
  const now = new Date();
  const fyStart = `${now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1}-04-01`;
  const [from, to] = period === 'month' ? [monthStart(0), isoDate()] : period === 'last' ? [monthStart(-1), monthEnd(-1)] : [fyStart, isoDate()];
  const res = useLoad<Report>(`/bricks/report?from=${from}&to=${to}`);
  const r = res.data;
  const s = r?.summary;
  return (
    <Screen title="Reports" subtitle={`${shortDate(from)} – ${shortDate(to)}`} onBack={nav.stack.length ? () => nav.pop() : undefined}
      refreshing={res.refreshing} onRefresh={res.reload} stale={res.stale} error={res.error}>
      <Chips value={period} onChange={setPeriod} options={[{ value: 'month', label: 'This month' }, { value: 'last', label: 'Last month' }, { value: 'fy', label: 'This year (Apr–Mar)' }]} />
      {!r || !s ? <Loading /> : (
        <>
          <Card style={{ gap: 10 }}>
            <Text style={fs.small}>Profit</Text>
            <Text style={[fs.huge, { color: s.profit >= 0 ? colors.green : colors.red }]}>{money(s.profit)}</Text>
            <Text style={fs.small}>{s.margin !== null ? `${Number(s.margin).toFixed(1)}% of revenue · ` : ''}revenue {money(s.revenue)} · cost {money(s.totalCost)}</Text>
          </Card>
          <Grid>
            <Stat label="Blocks made" value={count(s.produced)} sub={`${count(s.damaged)} broken${s.damagePercent !== null ? ` (${Number(s.damagePercent).toFixed(1)}%)` : ''}`} Icon={Factory} tone="warn" />
            <Stat label="Delivered" value={count(s.delivered)} sub={`${s.orders} orders · ${s.trips} trips`} Icon={Truck} tone="accent" />
            <Stat label="Cost a block" value={s.costPerBrick !== null ? money(s.costPerBrick, 2) : '—'} sub={s.pricePerBrick !== null ? `sold at ${money(s.pricePerBrick, 2)}` : undefined} Icon={BrickWall} />
            <Stat label="Received" value={moneyShort(s.received)} sub={`${moneyShort(s.receivable)} to collect`} Icon={IndianRupee} tone="good" />
          </Grid>
          <SectionTitle title="Where the money went" />
          <Card style={{ gap: 8 }}>
            {([['Raw material', s.materials], ['Production wages', s.wages], ['Loading & unloading', s.handlingWages], ['Salaries', s.salaries], ['Expenses', s.expenses]] as [string, number][]).map(([l, v]) => (
              <View key={l} style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={fs.label}>{l}</Text><Text style={fs.value}>{money(v)}</Text></View>
                <Bar value={v} max={Math.max(1, s.totalCost)} color={colors.slate} />
              </View>
            ))}
          </Card>
          {r.types?.length ? (
            <>
              <SectionTitle title="By type" Icon={BrickWall} />
              <List>
                {r.types.map((t, i) => (
                  <Row key={t.brickTypeId} title={t.name} sub={`${count(t.produced)} made · ${count(t.delivered)} delivered${t.avgPrice ? ` · avg ${money(t.avgPrice, 2)}` : ''}`}
                    right={money(t.sales)} last={i === r.types.length - 1} />
                ))}
              </List>
            </>
          ) : null}
          {r.expenseHeads?.length ? (
            <>
              <SectionTitle title="Expenses by head" />
              <List>
                {r.expenseHeads.map((h, i) => <Row key={h.name} title={h.name} sub={`${h.count} entr${h.count === 1 ? 'y' : 'ies'}`} right={money(h.amount)} last={i === r.expenseHeads.length - 1} />)}
              </List>
            </>
          ) : null}
          <Insights list={r.insights} />
        </>
      )}
    </Screen>
  );
}

const fs = StyleSheet.create({
  small: { fontSize: 12, color: colors.text2 },
  huge: { fontSize: 30, fontWeight: '900' },
  label: { fontSize: 13.5, color: colors.text, fontWeight: '600' },
  value: { fontSize: 13.5, color: colors.text, fontWeight: '800' },
});
