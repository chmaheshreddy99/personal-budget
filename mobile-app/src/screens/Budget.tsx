/**
 * The month's budgets from the server: how much of the total is spent and what is left, the alerts (most urgent first),
 * committed payments (rent, fees, EMIs, chit payments) as paid / due / overdue, every other budget with its pace, and
 * what was spent without a budget. Other months can be looked at while online; this month's is kept for offline use.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle, ArrowLeft, CalendarCheck, ChevronLeft, ChevronRight, CircleCheck, CloudOff, Info, ChartPie, Target } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state';
import { BudgetAlert, BudgetLine, Budgets, thisMonth } from '../data';
import { ago, money, moneyShort, shortDate } from '../format';
import { Card, Empty, GradientPanel, IconBubble, Pill, SectionTitle, categoryLook } from '../ui';
import { colors, space } from '../theme';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** The tone of a budget: over, warning (near the limit or heading over), or fine. */
function tone(l: BudgetLine): [string, string] {
  if (l.health === 'OVER' || l.paymentStatus === 'OVERDUE') return [colors.red, colors.redSoft];
  if (l.health === 'WARNING' || l.pace === 'HEADING_OVER' || l.paymentStatus === 'DUE_SOON') return [colors.gold, colors.goldSoft];
  if (l.paymentStatus === 'PAID' || l.pace === 'UNDER') return [colors.green, colors.greenSoft];
  return [colors.ocean, colors.oceanSoft];
}

const PAYMENT: Record<string, string> = { PAID: 'Paid', PARTLY_PAID: 'Partly paid', DUE: 'Due', DUE_SOON: 'Due soon', OVERDUE: 'Overdue' };
const PACE: Record<string, string> = { ON_TRACK: 'On track', AHEAD_OF_PACE: 'Ahead of pace', HEADING_OVER: 'Heading over', OVER: 'Over',
  UNDER: 'Within limit', NOT_STARTED: 'Not started' };
const ALERT: Record<BudgetAlert['severity'], [any, string, string]> = {
  critical: [AlertTriangle, colors.red, colors.redSoft], warning: [AlertTriangle, colors.gold, colors.goldSoft],
  info: [Info, colors.ocean, colors.oceanSoft], good: [CircleCheck, colors.green, colors.greenSoft],
};

export function BudgetScreen({ onBack }: { onBack: () => void }) {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const [month, setMonth] = useState(thisMonth());
  const [other, setOther] = useState<Budgets | null>(null);
  const [loading, setLoading] = useState(false);
  const current = month === thisMonth();
  const b = current ? app.budgets : other;

  const load = async (m = month) => {
    setLoading(true);
    try {
      const out = await app.loadBudgets(m);
      if (m !== thisMonth()) setOther(out);
    } finally { setLoading(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(month); }, [month]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => sub.remove();
  }, [onBack]);

  const lines = b?.lines || [];
  const committed = lines.filter(l => l.budgetId != null && l.committed);
  const ordinary = lines.filter(l => l.budgetId != null && !l.committed);
  const unbudgeted = lines.filter(l => l.budgetId == null).sort((x, y) => y.spent - x.spent);
  const used = Math.max(0, Math.min(100, Number(b?.usedPercent ?? (b && b.totalLimit ? (b.totalSpent / b.totalLimit) * 100 : 0))));

  return (
    <ScrollView contentContainerStyle={{ padding: space.l, paddingTop: insets.top + space.m, paddingBottom: 120, gap: space.s }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load()} colors={[colors.ocean]} />}>
      <Pressable onPress={onBack} style={st.back} hitSlop={12}><ArrowLeft color={colors.text} size={20} /><Text style={st.backText}>More</Text></Pressable>
      <View style={st.stepper}>
        <Pressable onPress={() => setMonth(shiftMonth(month, -1))} hitSlop={10}><ChevronLeft color={colors.text2} size={20} /></Pressable>
        <Text style={st.stepText}>{monthName(month)}</Text>
        <Pressable onPress={() => setMonth(shiftMonth(month, 1))} hitSlop={10}><ChevronRight color={colors.text2} size={20} /></Pressable>
      </View>
      {!b ? (loading ? <ActivityIndicator color={colors.ocean} style={{ marginTop: 40 }} />
        : <Empty Icon={CloudOff} title={current ? 'No budgets on the phone' : `No budgets for ${monthName(month)}`}
            text={app.settings.offline ? 'Turn off offline mode to fetch them from the server.' : current ? 'They are fetched from the server when it is reachable.' : 'Other months are fetched from the server when it is reachable.'} />) : (
        <>
          <GradientPanel from={colors.navy} to="#2a6f97">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ChartPie color={colors.white} size={20} />
              <Text style={st.h}>Budget · {monthName(b.month)}</Text>
            </View>
            <Text style={st.label}>SPENT OF {money(b.totalLimit).toUpperCase()}</Text>
            <Text style={st.big}>{money(b.totalSpent)}</Text>
            <View style={st.barDark}><View style={[st.fillDark, { width: `${used}%`, backgroundColor: used >= 100 ? '#ff8a73' : used >= 85 ? '#ffd27a' : '#a8e3c2' }]} /></View>
            <View style={st.figs}>
              <View style={st.fig}><Text style={st.figLabel}>Left</Text><Text style={[st.figValue, b.totalRemaining < 0 && { color: '#ffb4a0' }]}>{moneyShort(b.totalRemaining)}</Text></View>
              <View style={st.fig}><Text style={st.figLabel}>Projected</Text><Text style={st.figValue}>{moneyShort(b.projectedTotal)}</Text></View>
              <View style={st.fig}><Text style={st.figLabel}>No budget</Text><Text style={st.figValue}>{moneyShort(b.unbudgetedSpent)}</Text></View>
            </View>
            <Text style={st.fetched}>
              {current ? `${b.daysLeft} day${b.daysLeft === 1 ? '' : 's'} left · ` : ''}
              {b.committedTotal ? `${moneyShort(b.committedOutstanding)} committed still to pay · ` : ''}updated {ago(b.fetchedAt)}
            </Text>
          </GradientPanel>

          {(b.alerts || []).length ? (
            <View style={{ gap: 6, marginTop: space.s }}>
              {b.alerts.slice(0, 5).map((a, i) => {
                const [Icon, fg, bg] = ALERT[a.severity] || ALERT.info;
                return (
                  <View key={i} style={[st.alert, { backgroundColor: bg }]}>
                    <Icon color={fg} size={16} style={{ marginTop: 2 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={[st.alertTitle, { color: fg }]}>{a.title}</Text>
                      <Text style={st.alertText}>{a.message}{a.hint ? ` ${a.hint}` : ''}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          {committed.length ? <SectionTitle title="Committed payments" Icon={CalendarCheck}
            right={<Text style={st.secTotal}>{money(b.committedPaid)} of {money(b.committedTotal)}</Text>} /> : null}
          {committed.map(l => <BudgetRow key={l.categoryId} l={l} />)}

          {ordinary.length ? <SectionTitle title="Budgets" Icon={Target} /> : null}
          {ordinary.map(l => <BudgetRow key={l.categoryId} l={l} />)}
          {!committed.length && !ordinary.length ? <Text style={st.note}>No budgets set for this month. They are set on the server's Budgets page.</Text> : null}

          {unbudgeted.length ? <SectionTitle title="Spent without a budget" right={<Text style={st.secTotal}>{money(b.unbudgetedSpent)}</Text>} /> : null}
          {unbudgeted.length ? (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {unbudgeted.map(l => {
                const look = categoryLook(l.categoryName);
                return (
                  <View key={l.categoryId} style={st.unb}>
                    <IconBubble Icon={look.Icon} fg={look.fg} bg={look.bg} size={30} />
                    <Text style={st.unbName} numberOfLines={1}>{l.categoryName}</Text>
                    <Text style={st.unbAmount}>{money(l.spent)}</Text>
                  </View>
                );
              })}
            </Card>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

function BudgetRow({ l }: { l: BudgetLine }) {
  const look = categoryLook(l.categoryName);
  const [fg, bg] = tone(l);
  const limit = l.monthlyLimit || 0;
  const pct = Math.max(0, Math.min(100, limit ? (l.spent / limit) * 100 : 0));
  const status = l.committed ? (l.paymentStatus ? PAYMENT[l.paymentStatus] || l.paymentStatus : null) : (l.pace ? PACE[l.pace] || l.pace : null);
  return (
    <Card style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <IconBubble Icon={look.Icon} fg={look.fg} bg={look.bg} size={36} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.name} numberOfLines={1}>{l.categoryName}</Text>
          <Text style={st.meta} numberOfLines={1}>
            {money(l.spent)} of {money(limit)}
            {l.committed && l.dueDate ? ` · due ${shortDate(l.dueDate)}` : ''}
            {l.committed && l.paidOn ? ` · paid ${shortDate(l.paidOn)}` : ''}
          </Text>
        </View>
        {status ? <Pill text={status} fg={fg} bg={bg} /> : null}
      </View>
      <View style={st.bar}><View style={[st.fill, { width: `${pct}%`, backgroundColor: fg }]} /></View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={[st.meta, (l.remaining ?? 0) < 0 && { color: colors.red, fontWeight: '700' }]}>
          {(l.remaining ?? 0) < 0 ? `${money(-(l.remaining ?? 0))} over` : `${money(l.remaining)} left`}
        </Text>
        {!l.committed && l.safePerDay != null && (l.remaining ?? 0) > 0 ? <Text style={st.meta}>{money(l.safePerDay)}/day to stay within</Text> : null}
      </View>
      {l.insight ? <Text style={st.insight}>{l.insight}</Text> : null}
    </Card>
  );
}

const st = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: space.s },
  backText: { fontSize: 15, fontWeight: '700', color: colors.text },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: 16, paddingHorizontal: 12,
    height: 40, borderWidth: 1, borderColor: colors.line, marginBottom: space.s },
  stepText: { fontSize: 14.5, fontWeight: '800', color: colors.text },
  h: { color: colors.white, fontSize: 18, fontWeight: '800' },
  label: { color: 'rgba(255,255,255,0.6)', fontSize: 10.5, fontWeight: '800', letterSpacing: 1, marginTop: space.l },
  big: { color: colors.white, fontSize: 30, fontWeight: '800', marginTop: 2 },
  barDark: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden', marginTop: space.s },
  fillDark: { height: '100%', borderRadius: 4 },
  figs: { flexDirection: 'row', gap: 8, marginTop: space.l },
  fig: { flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10 },
  figLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10.5, fontWeight: '700' },
  figValue: { color: colors.white, fontSize: 16, fontWeight: '800', marginTop: 2 },
  fetched: { color: 'rgba(255,255,255,0.6)', fontSize: 11.5, marginTop: space.m },
  alert: { flexDirection: 'row', gap: 8, padding: 10, borderRadius: 12 },
  alertTitle: { fontSize: 13, fontWeight: '800' },
  alertText: { fontSize: 12, color: colors.text2, marginTop: 2, lineHeight: 17 },
  secTotal: { fontSize: 12.5, fontWeight: '800', color: colors.text2 },
  name: { fontSize: 14.5, fontWeight: '800', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 1 },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.sunken, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
  insight: { fontSize: 12, color: colors.text2, lineHeight: 17 },
  note: { fontSize: 13, color: colors.muted, textAlign: 'center', marginVertical: space.l },
  unb: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: space.m, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  unbName: { flex: 1, fontSize: 13.5, fontWeight: '600', color: colors.text },
  unbAmount: { fontSize: 13.5, fontWeight: '800', color: colors.text },
});
