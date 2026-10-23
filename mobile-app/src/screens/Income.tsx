/**
 * Income: what came in (from the server, and recorded on the phone waiting to sync), this month or every month kept
 * on the phone, by day, with the sources it came from (tap one to see only it). "Add income" records money received.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle, ArrowDownLeft, CheckCircle2, Clock, Plus, Trash2, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state';
import { dayLabel, isoDate, money, moneyShort } from '../format';
import { Button, Card, Chip, Empty, GradientPanel, IconBubble, Pill, categoryLook } from '../ui';
import { colors, space } from '../theme';
import type { RecordMode } from './AddExpense';

type Row = { key: string; date: string; title: string; source: string; into: string | null; amount: number; party: string | null;
  entryNo?: string | null; status?: string; message?: string; clientId?: string };

export function IncomeList({ header, onRecord }: { header: React.ReactNode; onRecord: (m: RecordMode) => void }) {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const [period, setPeriod] = useState<'month' | 'last' | 'all'>('month');
  const [source, setSource] = useState<string | null>(null);
  const month = isoDate().slice(0, 7);
  const last = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return isoDate(d).slice(0, 7); })();

  const all = useMemo<Row[]>(() => {
    const local: Row[] = app.records.filter(r => r.kind === 'INCOME').map(r => ({ key: r.clientId, date: r.date, title: r.title,
      source: String(r.sub.split(' · ')[0] || 'Income'), into: r.accountName, amount: r.amount, party: r.payload.party, status: r.status,
      message: r.message, clientId: r.clientId }));
    const server: Row[] = (app.snapshot?.incomes || []).map(i => ({ key: `s${i.entryId}`, date: i.date, title: i.narration, source: i.categoryName,
      into: i.into, amount: i.amount, party: i.party, entryNo: i.entryNo }));
    return [...local, ...server].sort((a, b) => b.date.localeCompare(a.date));
  }, [app.records, app.snapshot]);

  const inPeriod = all.filter(r => (period === 'month' ? r.date.startsWith(month) : period === 'last' ? r.date.startsWith(last) : true));
  const bySource = useMemo(() => {
    const m = new Map<string, number>();
    inPeriod.forEach(r => m.set(r.source, (m.get(r.source) || 0) + r.amount));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [inPeriod]);
  const rows = source ? inPeriod.filter(r => r.source === source) : inPeriod;
  const total = inPeriod.reduce((s, r) => s + r.amount, 0);
  const sections = useMemo(() => {
    const m = new Map<string, Row[]>();
    rows.forEach(r => m.set(r.date, [...(m.get(r.date) || []), r]));
    return [...m.entries()].map(([d, data]) => ({ title: d, total: data.reduce((s, r) => s + r.amount, 0), data }));
  }, [rows]);

  return (
    <SectionList
      style={{ flex: 1 }}
      sections={sections}
      keyExtractor={r => r.key}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={{ padding: space.l, paddingTop: insets.top + space.m, paddingBottom: 120 }}
      refreshControl={<RefreshControl refreshing={app.syncing} onRefresh={() => app.sync()} colors={[colors.ocean]} />}
      ListHeaderComponent={
        <View style={{ gap: space.s, marginBottom: space.s }}>
          {header}
          <GradientPanel from={colors.navy} to={colors.green}>
            <Text style={st.label}>{period === 'month' ? 'RECEIVED THIS MONTH' : period === 'last' ? 'RECEIVED LAST MONTH' : 'RECEIVED (KEPT ON THE PHONE)'}</Text>
            <Text style={st.big}>{money(total)}</Text>
            <View style={st.pills}>
              <Pill text={`${inPeriod.length} receipt${inPeriod.length === 1 ? '' : 's'}`} fg="rgba(255,255,255,0.9)" bg="rgba(255,255,255,0.14)" Icon={ArrowDownLeft} />
              {bySource[0] ? <Pill text={`Most from ${bySource[0][0]}`} fg="rgba(255,255,255,0.9)" bg="rgba(255,255,255,0.14)" /> : null}
            </View>
          </GradientPanel>
          {app.snapshot?.canRecord !== false ? <Button title="Add income" kind="soft" Icon={Plus} onPress={() => onRecord('INCOME')} style={{ height: 42 }} /> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Chip label="This month" selected={period === 'month'} onPress={() => { setPeriod('month'); setSource(null); }} />
            <Chip label="Last month" selected={period === 'last'} onPress={() => { setPeriod('last'); setSource(null); }} />
            <Chip label="All" selected={period === 'all'} onPress={() => { setPeriod('all'); setSource(null); }} />
          </View>
          {bySource.length > 1 ? (
            <Card style={{ gap: 8 }}>
              {bySource.slice(0, 5).map(([name, v]) => {
                const look = categoryLook(name);
                const on = source === name;
                return (
                  <Pressable key={name} onPress={() => setSource(on ? null : name)} style={st.src}>
                    <IconBubble Icon={look.Icon} fg={look.fg} bg={look.bg} size={26} />
                    <View style={{ flex: 1, gap: 3 }}>
                      <View style={st.row}><Text style={[st.srcName, on && { color: colors.ocean }]} numberOfLines={1}>{name}</Text><Text style={st.srcAmt}>{moneyShort(v)}</Text></View>
                      <View style={st.bar}><View style={[st.fill, { width: `${(v / (bySource[0][1] || 1)) * 100}%` }]} /></View>
                    </View>
                    {on ? <X color={colors.ocean} size={15} /> : null}
                  </Pressable>
                );
              })}
            </Card>
          ) : null}
        </View>
      }
      renderSectionHeader={({ section }) => (
        <View style={st.day}><Text style={st.dayText}>{dayLabel(section.title)}</Text><Text style={st.dayTotal}>+{moneyShort(section.total)}</Text></View>
      )}
      ListEmptyComponent={<Empty Icon={ArrowDownLeft} title="No income here" text="Salary, interest, rent received… press Add income to record it." />}
      renderItem={({ item: r }) => {
        const look = categoryLook(r.source);
        const failed = r.status === 'FAILED';
        return (
          <Card style={st.item}>
            <IconBubble Icon={look.Icon} fg={look.fg} bg={look.bg} size={38} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.title} numberOfLines={1}>{r.title}</Text>
              <Text style={st.sub} numberOfLines={1}>{[r.source, r.party, r.into ? `into ${r.into}` : null].filter(Boolean).join(' · ')}</Text>
              {r.status && r.status !== 'SYNCED' ? (
                <View style={{ marginTop: 4 }}>
                  <Pill text={failed ? `Not accepted: ${r.message || ''}` : 'Waiting to sync'} fg={failed ? colors.red : colors.gold} bg={failed ? colors.redSoft : colors.goldSoft}
                    Icon={failed ? AlertTriangle : Clock} />
                </View>
              ) : r.status === 'SYNCED' ? <View style={{ marginTop: 4 }}><Pill text="Synced" fg={colors.green} bg={colors.greenSoft} Icon={CheckCircle2} /></View> : null}
            </View>
            <View style={{ alignItems: 'flex-end', gap: 6 }}>
              <Text style={st.amount}>+{money(r.amount)}</Text>
              {r.clientId && r.status !== 'SYNCED' ? <Pressable onPress={() => app.removeRecord(r.clientId!)} hitSlop={8}><Trash2 color={colors.red} size={16} /></Pressable> : null}
            </View>
          </Card>
        );
      }}
    />
  );
}

const st = StyleSheet.create({
  label: { color: 'rgba(255,255,255,0.65)', fontSize: 10.5, fontWeight: '800', letterSpacing: 1 },
  big: { color: colors.white, fontSize: 30, fontWeight: '800', marginTop: 2 },
  pills: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  src: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  srcName: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.text },
  srcAmt: { fontSize: 12.5, fontWeight: '800', color: colors.green },
  bar: { height: 4, borderRadius: 2, backgroundColor: colors.sunken, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.green },
  day: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: space.m, marginBottom: 6 },
  dayText: { fontSize: 12.5, fontWeight: '800', color: colors.text2 },
  dayTotal: { fontSize: 12.5, fontWeight: '800', color: colors.green },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6, paddingVertical: 10 },
  title: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  sub: { fontSize: 12, color: colors.muted, marginTop: 1 },
  amount: { fontSize: 15, fontWeight: '800', color: colors.green },
});
