/**
 * The balance sheet from the server, today: net worth, what I own (assets), what I owe (liabilities) and equity,
 * each by group with its accounts (a group opens on a tap), and the ratios that matter (liquid money, debt to
 * assets, months of expenses covered). Kept on the phone, so it is there offline too.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft, ChevronDown, ChevronRight, CloudOff, Scale, TrendingDown, TrendingUp } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state';
import { SheetSection } from '../data';
import { ago, date, money, moneyShort } from '../format';
import { Card, Empty, GradientPanel, SectionTitle } from '../ui';
import { colors, space } from '../theme';

export function BalanceSheetScreen({ onBack }: { onBack: () => void }) {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const b = app.sheet;

  const load = async () => { setLoading(true); try { await app.loadSheet(); } finally { setLoading(false); } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => sub.remove();
  }, [onBack]);

  const section = (s: SheetSection | null | undefined, tone: string, soft: string) => {
    if (!s) return null;
    return (
      <View key={s.label}>
        <SectionTitle title={s.label} right={<Text style={[st.secTotal, { color: tone }]}>{money(s.total)}</Text>} />
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {s.groups.filter(g => g.accounts.length || g.total).map(g => {
            const k = `${s.label}:${g.label}`;
            return (
              <View key={k}>
                <Pressable style={st.group} onPress={() => setOpen(o => ({ ...o, [k]: !o[k] }))}>
                  <View style={[st.dot, { backgroundColor: soft, borderColor: tone }]} />
                  <Text style={st.groupName} numberOfLines={1}>{g.label}</Text>
                  <Text style={st.count}>{g.accounts.length}</Text>
                  <View style={{ flex: 1 }} />
                  <Text style={st.groupTotal}>{money(g.total)}</Text>
                  {open[k] ? <ChevronDown color={colors.muted} size={16} /> : <ChevronRight color={colors.muted} size={16} />}
                </Pressable>
                {open[k] ? g.accounts.map(a => (
                  <View key={a.accountId} style={st.acc}>
                    <Text style={st.accName} numberOfLines={1}>{a.name}</Text>
                    <Text style={st.accAmount}>{money(a.amount)}</Text>
                  </View>
                )) : null}
              </View>
            );
          })}
        </Card>
      </View>
    );
  };

  const ratio = (label: string, v: number | null | undefined, fmt: (n: number) => string) =>
    v == null ? null : <View key={label} style={st.ratio}><Text style={st.ratioLabel}>{label}</Text><Text style={st.ratioValue}>{fmt(Number(v))}</Text></View>;
  const pct = (n: number) => `${n.toFixed(1)}%`;

  return (
    <ScrollView contentContainerStyle={{ padding: space.l, paddingTop: insets.top + space.m, paddingBottom: 120, gap: space.s }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} colors={[colors.ocean]} />}>
      <Pressable onPress={onBack} style={st.back} hitSlop={12}><ArrowLeft color={colors.text} size={20} /><Text style={st.backText}>More</Text></Pressable>
      {!b ? (loading ? <ActivityIndicator color={colors.ocean} style={{ marginTop: 40 }} />
        : <Empty Icon={CloudOff} title="No balance sheet on the phone" text={app.settings.offline ? 'Turn off offline mode to fetch it from the server.' : 'It is fetched from the server when it is reachable (and your role allows reports).'} />) : (
        <>
          <GradientPanel>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Scale color={colors.white} size={20} />
              <Text style={st.h}>Balance sheet</Text>
            </View>
            <Text style={st.label}>NET WORTH · {date(b.asOf).toUpperCase()}</Text>
            <Text style={st.big}>{money(b.netWorth)}</Text>
            {b.netWorthChange != null && b.netWorthChange !== 0 && b.previousNetWorth ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                {b.netWorthChange > 0 ? <TrendingUp color="#a8e3c2" size={14} /> : <TrendingDown color="#ffb4a0" size={14} />}
                <Text style={{ color: b.netWorthChange > 0 ? '#a8e3c2' : '#ffb4a0', fontWeight: '700', fontSize: 12.5 }}>{money(b.netWorthChange)} since the last comparison</Text>
              </View>
            ) : null}
            <View style={st.figs}>
              <View style={st.fig}><Text style={st.figLabel}>Assets</Text><Text style={st.figValue}>{moneyShort(b.assets?.total)}</Text></View>
              <View style={st.fig}><Text style={st.figLabel}>Liabilities</Text><Text style={st.figValue}>{moneyShort(b.liabilities?.total)}</Text></View>
              <View style={st.fig}><Text style={st.figLabel}>Liquid</Text><Text style={st.figValue}>{moneyShort(b.liquidAssets)}</Text></View>
            </View>
            <Text style={st.fetched}>Updated {ago(b.fetchedAt)}{b.balanced ? ' · balanced' : ''}</Text>
          </GradientPanel>
          <View style={st.ratios}>
            {ratio('Debt to assets', b.debtToAssetRatio, pct)}
            {ratio('Liquidity', b.liquidityRatio, n => `${n.toFixed(2)}×`)}
            {ratio('Emergency fund', b.emergencyFundMonths, n => `${n.toFixed(1)} months`)}
            {ratio('Monthly spend', b.averageMonthlyExpense, n => moneyShort(n))}
          </View>
          {section(b.assets, colors.green, colors.greenSoft)}
          {section(b.liabilities, colors.red, colors.redSoft)}
          {section(b.equity, colors.violet, colors.violetSoft)}
        </>
      )}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: space.s },
  backText: { fontSize: 15, fontWeight: '700', color: colors.text },
  h: { color: colors.white, fontSize: 18, fontWeight: '800' },
  label: { color: 'rgba(255,255,255,0.6)', fontSize: 10.5, fontWeight: '800', letterSpacing: 1, marginTop: space.l },
  big: { color: colors.white, fontSize: 30, fontWeight: '800', marginTop: 2 },
  figs: { flexDirection: 'row', gap: 8, marginTop: space.l },
  fig: { flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10 },
  figLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10.5, fontWeight: '700' },
  figValue: { color: colors.white, fontSize: 16, fontWeight: '800', marginTop: 2 },
  fetched: { color: 'rgba(255,255,255,0.6)', fontSize: 11.5, marginTop: space.m },
  ratios: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: space.s },
  ratio: { width: '48.5%', backgroundColor: colors.card, borderRadius: 14, padding: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  ratioLabel: { fontSize: 11, fontWeight: '700', color: colors.muted },
  ratioValue: { fontSize: 16, fontWeight: '800', color: colors.text, marginTop: 2 },
  secTotal: { fontSize: 14, fontWeight: '800' },
  group: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space.m, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  groupName: { fontSize: 14, fontWeight: '700', color: colors.text, flexShrink: 1 },
  count: { fontSize: 11, fontWeight: '700', color: colors.muted, backgroundColor: colors.sunken, paddingHorizontal: 7, borderRadius: 9, overflow: 'hidden' },
  groupTotal: { fontSize: 14, fontWeight: '800', color: colors.text2 },
  acc: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.m + 18, paddingRight: space.m + 20, paddingVertical: 8, backgroundColor: colors.sunken },
  accName: { flex: 1, fontSize: 13, color: colors.text2 },
  accAmount: { fontSize: 13, fontWeight: '700', color: colors.text },
});
