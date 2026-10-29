/**
 * The Expenses tab, in four parts (those shared with the user): Expenses, To collect (paid for someone and lent),
 * EMIs and Income.
 * Expenses: those recorded on the phone (waiting, not accepted, waiting for approval, synced) with the server's,
 * by day, this month, last month or all kept on the phone, with where the money went by category (tap one to see
 * only it). Each row is short; a tap opens it to every detail, its evidence (add a photo or a file) and, while it
 * waits to be synced, to change or delete it. Search finds an expense by what it was, the shop, category or account.
 */
import React, { useMemo, useState } from 'react';
import { LayoutAnimation, Platform, Pressable, RefreshControl, SectionList, StyleSheet, Text, TextInput, UIManager, View } from 'react-native';
import { AlertTriangle, ArrowDownLeft, CalendarClock, CheckCircle2, ChevronDown, ChevronUp, Clock, HandCoins, Hourglass, Paperclip, Pencil, Receipt, Search, Smartphone, Trash2, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EvidenceTarget, useApp } from '../state';
import { LocalExpense, hasFeature, mobileOn } from '../data';
import { date, dayLabel, isoDate, money, moneyShort } from '../format';
import { Button, Card, Chip, Empty, GradientPanel, IconBubble, Pill, categoryLook } from '../ui';
import { EvidenceStrip } from '../evidence';
import { colors, radius, space } from '../theme';
import { ClaimsList } from './Claims';
import { EmisList } from './Emis';
import { IncomeList } from './Income';
import type { RecordMode } from './AddExpense';

type Part = 'expenses' | 'collect' | 'emis' | 'income';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) UIManager.setLayoutAnimationEnabledExperimental(true);

type Row = {
  key: string; date: string; title: string; party: string | null; paidFrom: string; category: string; amount: number; reference: string | null;
  notes?: string; entryNo?: string; entryId?: number; local?: LocalExpense; status?: string;
};

const STATUS: Record<string, [string, string, string, any]> = {
  QUEUED: ['Waiting to sync', colors.gold, colors.goldSoft, Clock],
  FAILED: ['Not accepted', colors.red, colors.redSoft, AlertTriangle],
  PENDING: ['Waiting for approval', colors.violet, colors.violetSoft, Hourglass],
  SYNCED: ['Synced', colors.green, colors.greenSoft, CheckCircle2],
};

export function ExpensesScreen({ onEdit, onRecord }: { onEdit: (e: LocalExpense) => void; onRecord: (m: RecordMode) => void }) {
  const app = useApp();
  const [part, setPart] = useState<Part>('expenses');
  const expenses = hasFeature(app.snapshot, 'EXPENSES');
  const collect = (app.snapshot?.claims || []).filter(c => c.status !== 'SETTLED' && c.status !== 'WRITTEN_OFF').length
    + app.records.filter(r => r.kind === 'CLAIM' && r.status !== 'SYNCED').length;
  const parts: [Part, string, any, number][] = [
    ...(expenses ? [['expenses', 'Expenses', Receipt, 0], ...(mobileOn(app.snapshot, 'CLAIMS') ? [['collect', 'To collect', HandCoins, collect]] : []), ...(mobileOn(app.snapshot, 'EMIS') ? [['emis', 'EMIs', CalendarClock, (app.snapshot?.emis || []).length]] : [])] as [Part, string, any, number][] : []),
    ...(hasFeature(app.snapshot, 'INCOME') ? [['income', 'Income', ArrowDownLeft, 0]] as [Part, string, any, number][] : []),
  ];
  const current = parts.some(x => x[0] === part) ? part : parts[0]?.[0] || 'expenses';
  const header = parts.length > 1 ? (
    <View style={st.parts}>
      {parts.map(([key, label, Icon, n]) => {
        const on = key === current;
        return (
          <Pressable key={key} onPress={() => setPart(key)} style={[st.part, on && st.partOn]}>
            <Icon color={on ? colors.white : colors.text2} size={15} />
            <Text style={[st.partText, on && { color: colors.white }]} numberOfLines={1}>{label}</Text>
            {n && !on ? <View style={st.partBadge}><Text style={st.partBadgeText}>{n > 9 ? '9+' : n}</Text></View> : null}
          </Pressable>
        );
      })}
    </View>
  ) : null;
  if (current === 'collect') return <ClaimsList header={header} onRecord={onRecord} />;
  if (current === 'emis') return <EmisList header={header} />;
  if (current === 'income') return <IncomeList header={header} onRecord={onRecord} />;
  return <ExpenseList header={header} onEdit={onEdit} />;
}

function ExpenseList({ header, onEdit }: { header: React.ReactNode; onEdit: (e: LocalExpense) => void }) {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<'all' | 'phone' | 'month' | 'last'>('month');
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const month = isoDate().slice(0, 7);
  const lastMonth = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return isoDate(d).slice(0, 7); })();

  const base = useMemo<Row[]>(() => {
    const local: Row[] = app.queue.map(e => ({ key: e.clientId, date: e.date, title: e.narration || e.categoryName, party: e.party || null, paidFrom: e.paidFromName,
      category: e.categoryName, amount: e.amount, reference: e.reference || null, notes: e.notes, entryNo: e.entryNo, entryId: e.entryId, local: e, status: e.status }));
    const synced = new Set(app.queue.map(e => e.entryNo).filter(Boolean));
    const server: Row[] = (app.snapshot?.expenses || []).filter(x => !synced.has(x.entryNo) && x.status !== 'REVERSED').map(x => ({
      key: `s${x.entryId}-${x.categoryId}`, date: x.date, title: x.narration, party: x.party, paidFrom: x.paidFrom, category: x.categoryName, amount: x.amount,
      reference: x.reference, entryNo: x.entryNo, entryId: x.entryId }));
    let all = [...local, ...server];
    if (filter === 'phone') all = local;
    if (filter === 'month') all = all.filter(r => r.date.startsWith(month));
    if (filter === 'last') all = all.filter(r => r.date.startsWith(lastMonth));
    return all;
  }, [app.queue, app.snapshot, filter, month, lastMonth]);

  // where the money went in what is shown, by category (before a category is picked)
  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    base.forEach(r => m.set(r.category, (m.get(r.category) || 0) + r.amount));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [base]);

  const rows = useMemo<Row[]>(() => {
    let all = category ? base.filter(r => r.category === category) : base;
    const q = query.trim().toLowerCase();
    if (q) all = all.filter(r => [r.title, r.party, r.paidFrom, r.category, r.reference, r.entryNo, String(r.amount)].some(v => v && v.toLowerCase().includes(q)));
    return [...all].sort((a, b) => b.date.localeCompare(a.date) || (b.local?.createdAt || 0) - (a.local?.createdAt || 0));
  }, [base, category, query]);

  const sections = useMemo(() => {
    const m = new Map<string, Row[]>();
    rows.forEach(r => m.set(r.date, [...(m.get(r.date) || []), r]));
    return [...m.entries()].map(([d, data]) => ({ title: d, total: data.reduce((s, r) => s + r.amount, 0), data }));
  }, [rows]);

  const spentIn = (m: string) => [...app.queue.filter(e => e.status !== 'SYNCED'), ...(app.snapshot?.expenses || []).filter(x => x.status !== 'REVERSED')]
    .filter(x => x.date.startsWith(m)).reduce((s, x) => s + x.amount, 0);
  const monthTotal = spentIn(month);
  const lastTotal = spentIn(lastMonth);
  // this month against the same days of last month
  const dayNo = new Date().getDate();
  const lastSoFar = [...(app.snapshot?.expenses || [])].filter(x => x.status !== 'REVERSED' && x.date.startsWith(lastMonth) && Number(x.date.slice(8, 10)) <= dayNo)
    .reduce((s, x) => s + x.amount, 0);
  const shownTotal = byCategory.reduce((s, [, v]) => s + v, 0);
  const waiting = app.queue.filter(e => e.status === 'QUEUED' || e.status === 'FAILED');
  const toggle = (k: string) => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setOpen(o => (o === k ? null : k)); };

  return (
    <SectionList
      style={{ flex: 1 }}
      sections={sections}
      keyExtractor={r => r.key}
      stickySectionHeadersEnabled={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: space.l, paddingTop: insets.top + space.m, paddingBottom: 120 }}
      refreshControl={<RefreshControl refreshing={app.syncing} onRefresh={() => app.sync()} colors={[colors.ocean]} />}
      ListHeaderComponent={
        <View style={{ gap: space.m, marginBottom: space.s }}>
          {header}
          <GradientPanel from={colors.navy} to={colors.navy2}>
            <Text style={st.label}>SPENT THIS MONTH</Text>
            <Text style={st.big}>{money(monthTotal)}</Text>
            {lastTotal ? <Text style={st.vs}>{lastSoFar ? `${monthTotal <= lastSoFar ? '▼' : '▲'} ${money(Math.abs(monthTotal - lastSoFar))} ${monthTotal <= lastSoFar ? 'less' : 'more'} than by this day last month · ` : ''}last month {moneyShort(lastTotal)}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <Pill text={`${waiting.length} waiting to sync`} fg={waiting.length ? '#ffd68a' : 'rgba(255,255,255,0.8)'} bg="rgba(255,255,255,0.12)" Icon={Clock} />
              <Pill text={`${app.queue.filter(e => e.status === 'PENDING').length} for approval`} fg="rgba(255,255,255,0.8)" bg="rgba(255,255,255,0.12)" Icon={Hourglass} />
              {app.uploads.length ? <Pill text={`${app.uploads.length} evidence to upload`} fg="#ffd68a" bg="rgba(255,255,255,0.12)" Icon={Paperclip} /> : null}
            </View>
          </GradientPanel>
          <View style={st.search}>
            <Search color={colors.muted} size={16} />
            <TextInput value={query} onChangeText={setQuery} placeholder="Search shop, category, account, ref…" placeholderTextColor={colors.muted}
              style={st.searchInput} autoCorrect={false} returnKeyType="search" />
            {query ? <Pressable onPress={() => setQuery('')} hitSlop={8}><X color={colors.muted} size={16} /></Pressable> : null}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Chip label="This month" selected={filter === 'month'} onPress={() => { setFilter('month'); setCategory(null); }} />
            <Chip label="Last month" selected={filter === 'last'} onPress={() => { setFilter('last'); setCategory(null); }} />
            <Chip label="All" selected={filter === 'all'} onPress={() => { setFilter('all'); setCategory(null); }} />
            <Chip label="On the phone" Icon={Smartphone} selected={filter === 'phone'} onPress={() => { setFilter('phone'); setCategory(null); }} />
          </View>
          {byCategory.length > 1 ? (
            <Card style={{ gap: 8 }}>
              <View style={st.catHead}><Text style={st.k}>Where it went</Text>{category ? <Pressable onPress={() => setCategory(null)} hitSlop={8}><Text style={st.link}>Show all</Text></Pressable> : null}</View>
              {byCategory.slice(0, 5).map(([name, v]) => {
                const look = categoryLook(name);
                const on = category === name;
                return (
                  <Pressable key={name} onPress={() => setCategory(on ? null : name)} style={st.cat}>
                    <IconBubble Icon={look.Icon} fg={look.fg} bg={look.bg} size={26} />
                    <View style={{ flex: 1, gap: 3 }}>
                      <View style={st.catRow}>
                        <Text style={[st.catName, on && { color: colors.ocean }]} numberOfLines={1}>{name}</Text>
                        <Text style={st.catPct}>{Math.round((v / (shownTotal || 1)) * 100)}%</Text>
                        <Text style={st.catAmt}>{moneyShort(v)}</Text>
                      </View>
                      <View style={st.catBar}><View style={[st.catFill, { width: `${(v / (byCategory[0][1] || 1)) * 100}%`, backgroundColor: look.fg }]} /></View>
                    </View>
                    {on ? <X color={colors.ocean} size={15} /> : null}
                  </Pressable>
                );
              })}
              {byCategory.length > 5 ? <Text style={st.sub}>…and {byCategory.length - 5} more categories</Text> : null}
            </Card>
          ) : null}
        </View>
      }
      renderSectionHeader={({ section }) => (
        <View style={st.day}><Text style={st.dayText}>{dayLabel(section.title)}</Text><Text style={st.dayTotal}>{moneyShort(section.total)}</Text></View>
      )}
      ListEmptyComponent={<Empty Icon={Receipt} title={query ? 'Nothing matches' : 'No expenses here'}
        text={query ? undefined : 'Press + to record one. It is kept on the phone and synced when the server is reachable.'} />}
      renderItem={({ item: r }) => <ExpenseRow r={r} open={open === r.key} onToggle={() => toggle(r.key)} onEdit={onEdit} />}
    />
  );
}

function ExpenseRow({ r, open, onToggle, onEdit }: { r: Row; open: boolean; onToggle: () => void; onEdit: (e: LocalExpense) => void }) {
  const app = useApp();
  const look = categoryLook(r.category);
  const stt = r.status ? STATUS[r.status] : null;
  const editable = !!r.local && (r.status === 'QUEUED' || r.status === 'FAILED');
  const target: EvidenceTarget = r.local && !r.local.entryId && !r.local.pendingId ? { clientId: r.local.clientId, label: r.title }
    : r.entryId ? { entryId: r.entryId, label: r.title } : { pendingId: r.local?.pendingId, label: r.title };
  const evidence = app.uploads.filter(u => (r.local && u.clientId === r.local.clientId) || (r.entryId && u.entryId === r.entryId));
  const detail = (k: string, v?: string | null) => (v ? <View style={st.kv} key={k}><Text style={st.k}>{k}</Text><Text style={st.v} selectable>{v}</Text></View> : null);

  return (
    <Card style={[st.row, open && st.rowOpen]} onPress={onToggle}>
      <View style={st.rowTop}>
        <IconBubble Icon={look.Icon} fg={look.fg} bg={look.bg} size={38} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.title} numberOfLines={open ? 3 : 1}>{r.title}</Text>
          <Text style={st.sub} numberOfLines={1}>{[r.category, r.party].filter(Boolean).join(' · ')}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 3 }}>
          <Text style={st.amount}>−{money(r.amount)}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {stt ? <View style={[st.dot, { backgroundColor: stt[1] }]} /> : null}
            {evidence.length ? <Paperclip color={colors.muted} size={12} /> : null}
            {open ? <ChevronUp color={colors.muted} size={16} /> : <ChevronDown color={colors.muted} size={16} />}
          </View>
        </View>
      </View>
      {open ? (
        <View style={st.more}>
          {stt ? <Pill text={r.status === 'FAILED' && r.local?.message ? `Not accepted: ${r.local.message}` : stt[0]} fg={stt[1]} bg={stt[2]} Icon={stt[3]} /> : null}
          <View style={st.grid}>
            {detail('Date', date(r.date))}
            {detail('Category', r.category)}
            {detail('Paid from', r.paidFrom)}
            {detail('Paid to', r.party)}
            {detail('Reference', r.reference)}
            {detail('Entry', r.entryNo)}
            {detail('Notes', r.notes)}
          </View>
          <Text style={st.k}>Evidence</Text>
          {target.clientId || target.entryId || target.pendingId ? (
            <EvidenceStrip compact items={evidence} onAdd={f => app.addEvidence(target, [f])} onRemove={it => it.id && app.removeEvidence(it.id)}
              note={evidence.length ? `${evidence.length} waiting to upload${evidence.some(u => u.status === 'FAILED') ? ` · ${evidence.find(u => u.message)?.message || 'upload failed'}` : ''}`
                : 'Add a bill photo or a PDF: it goes up to this expense at the next sync.'} />
          ) : <Text style={st.sub}>Evidence can be added once the server has this expense.</Text>}
          {editable ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="Delete" kind="danger" Icon={Trash2} onPress={() => app.removeExpense(r.local!.clientId)} style={{ height: 40 }} />
              <Button title="Change" kind="soft" Icon={Pencil} onPress={() => onEdit(r.local!)} style={{ flex: 1, height: 40 }} />
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const st = StyleSheet.create({
  parts: { flexDirection: 'row', gap: 4, backgroundColor: colors.card, borderRadius: radius.m, padding: 4, borderWidth: 1, borderColor: colors.line },
  part: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, height: 36, borderRadius: 9, paddingHorizontal: 2 },
  partOn: { backgroundColor: colors.navy },
  partText: { fontSize: 12, fontWeight: '800', color: colors.text2, flexShrink: 1 },
  partBadge: { minWidth: 16, height: 16, borderRadius: 8, backgroundColor: colors.violet, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  partBadgeText: { color: colors.white, fontSize: 9.5, fontWeight: '800' },
  vs: { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 4 },
  catHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  link: { color: colors.ocean, fontWeight: '700', fontSize: 12.5 },
  cat: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  catName: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.text },
  catPct: { fontSize: 11.5, fontWeight: '700', color: colors.muted },
  catAmt: { fontSize: 12.5, fontWeight: '800', color: colors.text, minWidth: 54, textAlign: 'right' },
  catBar: { height: 4, borderRadius: 2, backgroundColor: colors.sunken, overflow: 'hidden' },
  catFill: { height: 4, borderRadius: 2 },
  label: { color: 'rgba(255,255,255,0.6)', fontSize: 10.5, fontWeight: '800', letterSpacing: 1 },
  big: { color: colors.white, fontSize: 30, fontWeight: '800', marginTop: 2 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, borderRadius: radius.m, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.card, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 14.5, color: colors.text, paddingVertical: 0 },
  day: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: space.m, marginBottom: 6 },
  dayText: { fontSize: 12.5, fontWeight: '800', color: colors.text2 },
  dayTotal: { fontSize: 12.5, fontWeight: '800', color: colors.muted },
  row: { marginBottom: 6, paddingVertical: 10 },
  rowOpen: { borderColor: colors.ocean2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  sub: { fontSize: 12, color: colors.muted, marginTop: 1 },
  amount: { fontSize: 15, fontWeight: '800', color: colors.red },
  dot: { width: 7, height: 7, borderRadius: 4 },
  more: { marginTop: space.m, paddingTop: space.m, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line, gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 },
  kv: { width: '50%', paddingRight: 8 },
  k: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.5, color: colors.muted, textTransform: 'uppercase' },
  v: { fontSize: 13.5, color: colors.text, fontWeight: '600', marginTop: 1 },
});
