/**
 * Expenses: those recorded on the phone (waiting, not accepted, waiting for approval, synced) with the server's,
 * by day. Each row is short; a tap opens it to every detail, its evidence (add a photo or a file) and, while it
 * waits to be synced, to change or delete it. Search finds an expense by what it was, the shop, category or account.
 */
import React, { useMemo, useState } from 'react';
import { LayoutAnimation, Platform, Pressable, RefreshControl, SectionList, StyleSheet, Text, TextInput, UIManager, View } from 'react-native';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Clock, Hourglass, Paperclip, Pencil, Receipt, Search, Smartphone, Trash2, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EvidenceTarget, useApp } from '../state';
import { LocalExpense } from '../data';
import { date, dayLabel, isoDate, money, moneyShort } from '../format';
import { Button, Card, Chip, Empty, GradientPanel, IconBubble, Pill, categoryLook } from '../ui';
import { EvidenceStrip } from '../evidence';
import { colors, radius, space } from '../theme';

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

export function ExpensesScreen({ onEdit }: { onEdit: (e: LocalExpense) => void }) {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<'all' | 'phone' | 'month'>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const month = isoDate().slice(0, 7);

  const rows = useMemo<Row[]>(() => {
    const local: Row[] = app.queue.map(e => ({ key: e.clientId, date: e.date, title: e.narration || e.categoryName, party: e.party || null, paidFrom: e.paidFromName,
      category: e.categoryName, amount: e.amount, reference: e.reference || null, notes: e.notes, entryNo: e.entryNo, entryId: e.entryId, local: e, status: e.status }));
    const synced = new Set(app.queue.map(e => e.entryNo).filter(Boolean));
    const server: Row[] = (app.snapshot?.expenses || []).filter(x => !synced.has(x.entryNo) && x.status !== 'REVERSED').map(x => ({
      key: `s${x.entryId}-${x.categoryId}`, date: x.date, title: x.narration, party: x.party, paidFrom: x.paidFrom, category: x.categoryName, amount: x.amount,
      reference: x.reference, entryNo: x.entryNo, entryId: x.entryId }));
    let all = [...local, ...server];
    if (filter === 'phone') all = local;
    if (filter === 'month') all = all.filter(r => r.date.startsWith(month));
    const q = query.trim().toLowerCase();
    if (q) all = all.filter(r => [r.title, r.party, r.paidFrom, r.category, r.reference, r.entryNo, String(r.amount)].some(v => v && v.toLowerCase().includes(q)));
    return all.sort((a, b) => b.date.localeCompare(a.date) || (b.local?.createdAt || 0) - (a.local?.createdAt || 0));
  }, [app.queue, app.snapshot, filter, month, query]);

  const sections = useMemo(() => {
    const m = new Map<string, Row[]>();
    rows.forEach(r => m.set(r.date, [...(m.get(r.date) || []), r]));
    return [...m.entries()].map(([d, data]) => ({ title: d, total: data.reduce((s, r) => s + r.amount, 0), data }));
  }, [rows]);

  const monthTotal = [...app.queue.filter(e => e.status !== 'SYNCED'), ...(app.snapshot?.expenses || [])]
    .filter(x => x.date.startsWith(month)).reduce((s, x) => s + x.amount, 0);
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
          <GradientPanel from={colors.navy} to={colors.navy2}>
            <Text style={st.label}>SPENT THIS MONTH</Text>
            <Text style={st.big}>{money(monthTotal)}</Text>
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
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Chip label="All" selected={filter === 'all'} onPress={() => setFilter('all')} />
            <Chip label="This month" selected={filter === 'month'} onPress={() => setFilter('month')} />
            <Chip label="On the phone" Icon={Smartphone} selected={filter === 'phone'} onPress={() => setFilter('phone')} />
          </View>
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
