/** More: the budget, categories, gifts, the balance sheet, bank SMS (with how many wait to be recorded) and settings. */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChartPie, ChevronRight, Gift, MessageSquareText, Scale, Settings as Cog, Tags } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state';
import { hasFeature, isExpense } from '../data';
import { ago, money } from '../format';
import { Card, IconBubble } from '../ui';
import { colors, space } from '../theme';

export type MorePage = 'budget' | 'categories' | 'gifts' | 'sheet' | 'sms' | 'settings';

export function MoreScreen({ onOpen }: { onOpen: (p: MorePage) => void }) {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const cats = app.snapshot?.categories || [];
  const expense = cats.filter(isExpense).length;
  const b = app.budgets;
  const items: [MorePage, any, string, string, string, string, number][] = [
    ['budget', ChartPie, colors.coral, colors.coralSoft, 'Budget',
      b && b.totalLimit ? `${money(b.totalSpent)} of ${money(b.totalLimit)} spent · ${money(b.totalRemaining)} left` : 'This month’s budgets and what is spent', 0],
    ['categories', Tags, colors.aqua, colors.aquaSoft, 'Categories',
      cats.length ? `${expense} expense · ${cats.length - expense} income` : 'Expense and income categories', 0],
    ...(hasFeature(app.snapshot, 'GIFTS') ? [['gifts', Gift, colors.coral, colors.coralSoft, 'Gifts', giftLine(app), 0] as [MorePage, any, string, string, string, string, number]] : []),
    ['sheet', Scale, colors.green, colors.greenSoft, 'Balance sheet',
      app.sheet ? `Net worth ${money(app.sheet.netWorth)} · updated ${ago(app.sheet.fetchedAt)}` : 'What you own and owe, by group', 0],
    ['sms', MessageSquareText, colors.violet, colors.violetSoft, 'Bank SMS',
      app.settings.smsEnabled ? (app.detected.length ? `${app.detected.length} to record` : 'Detection on · nothing to record') : 'Detection off', app.detected.length],
    ['settings', Cog, colors.ocean, colors.oceanSoft, 'Settings', 'Server, accounts shown, offline, storage, SMS', 0],
  ];
  return (
    <ScrollView contentContainerStyle={{ padding: space.l, paddingTop: insets.top + space.m, paddingBottom: 120, gap: space.s }}>
      <Text style={st.h1}>More</Text>
      <Text style={st.who}>{app.settings.userName || app.settings.username}{app.snapshot ? ` · ${app.snapshot.household}` : ''}</Text>
      {items.map(([key, Icon, fg, bg, title, sub, badge]) => (
        <Card key={key} onPress={() => onOpen(key)} style={st.row}>
          <IconBubble Icon={Icon} fg={fg} bg={bg} size={42} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.title}>{title}</Text>
            <Text style={st.sub} numberOfLines={1}>{sub}</Text>
          </View>
          {badge ? <View style={st.badge}><Text style={st.badgeText}>{badge > 99 ? '99+' : badge}</Text></View> : null}
          <ChevronRight color={colors.muted} size={18} />
        </Card>
      ))}
    </ScrollView>
  );
}

/** "3 given · 2 received this year", counting those waiting on the phone. */
function giftLine(app: ReturnType<typeof useApp>): string {
  const year = String(new Date().getFullYear());
  const list = [...(app.snapshot?.gifts || []).map(g => ({ d: g.direction, date: g.date })),
    ...app.records.filter(r => r.kind === 'GIFT').map(r => ({ d: r.payload.direction, date: r.date }))].filter(g => g.date.startsWith(year));
  if (!list.length) return 'Given and received, person by person';
  return `${list.filter(g => g.d === 'GIVEN').length} given · ${list.filter(g => g.d === 'RECEIVED').length} received this year`;
}

const st = StyleSheet.create({
  h1: { fontSize: 28, fontWeight: '800', color: colors.text },
  who: { fontSize: 13, color: colors.muted, marginBottom: space.m },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 15.5, fontWeight: '800', color: colors.text },
  sub: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: colors.white, fontSize: 11, fontWeight: '800' },
});
