/**
 * The household's categories from the server, expense and income, each with how often it was used and (for expenses)
 * this month's budget against what was spent. System categories (Chit Payments, Chit Commission Income, Interest ...)
 * are the ones the server books to by itself. Categories are added and changed on the server.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { BackHandler, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Search, Tags, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state';
import { Category, isExpense } from '../data';
import { money } from '../format';
import { Card, Chip, Empty, IconBubble, Pill, categoryLook } from '../ui';
import { colors, space } from '../theme';

type Kind = 'EXPENSE' | 'INCOME';

export function CategoriesScreen({ onBack }: { onBack: () => void }) {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const [kind, setKind] = useState<Kind>('EXPENSE');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => sub.remove();
  }, [onBack]);

  const all = useMemo(() => app.snapshot?.categories || [], [app.snapshot]);
  const counts = { EXPENSE: all.filter(isExpense).length, INCOME: all.filter(c => !isExpense(c)).length };
  const budgetOf = useMemo(() => new Map((app.budgets?.lines || []).map(l => [l.categoryId, l])), [app.budgets]);
  const q = query.trim().toLowerCase();
  const list = all.filter(c => (kind === 'EXPENSE') === isExpense(c))
    .filter(c => !q || c.name.toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q))
    .sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name));

  return (
    <FlatList
      data={list}
      keyExtractor={c => String(c.id)}
      contentContainerStyle={{ padding: space.l, paddingTop: insets.top + space.m, paddingBottom: 120, gap: space.s }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ gap: space.s, marginBottom: space.s }}>
          <Pressable onPress={onBack} style={st.back} hitSlop={12}><ArrowLeft color={colors.text} size={20} /><Text style={st.backText}>More</Text></Pressable>
          <Text style={st.h1}>Categories</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Chip label={`Expense · ${counts.EXPENSE}`} selected={kind === 'EXPENSE'} onPress={() => setKind('EXPENSE')} />
            <Chip label={`Income · ${counts.INCOME}`} selected={kind === 'INCOME'} onPress={() => setKind('INCOME')} />
          </View>
          <View style={st.search}>
            <Search color={colors.muted} size={16} />
            <TextInput value={query} onChangeText={setQuery} placeholder="Search categories" placeholderTextColor={colors.muted} style={st.searchInput} autoCorrect={false} />
            {query ? <Pressable onPress={() => setQuery('')} hitSlop={10}><X color={colors.muted} size={16} /></Pressable> : null}
          </View>
          {counts.INCOME === 0 && all.length ? <Text style={st.note}>Sync once with the updated server to bring the income categories to the phone.</Text> : null}
        </View>
      }
      ListEmptyComponent={<Empty Icon={Tags} title={q ? 'No category matches' : 'No categories yet'} text={app.snapshot ? undefined : 'Sync once to bring the categories to the phone.'} />}
      renderItem={({ item }) => <CategoryRow c={item} budget={budgetOf.get(item.id)} />}
    />
  );
}

function CategoryRow({ c, budget }: { c: Category; budget?: { monthlyLimit: number | null; spent: number; budgetId: number | null } }) {
  const look = categoryLook(c.name);
  const limit = budget?.budgetId != null ? budget.monthlyLimit || 0 : 0;
  const pct = limit ? Math.max(0, Math.min(100, (budget!.spent / limit) * 100)) : 0;
  return (
    <Card style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <IconBubble Icon={look.Icon} fg={look.fg} bg={look.bg} size={38} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.name} numberOfLines={1}>{c.name}</Text>
          <Text style={st.meta} numberOfLines={2}>{c.description || (c.uses ? `Used ${c.uses} time${c.uses === 1 ? '' : 's'}` : 'Not used yet')}</Text>
        </View>
        {c.system ? <Pill text="System" fg={colors.violet} bg={colors.violetSoft} /> : null}
      </View>
      {limit ? (
        <View style={{ gap: 4 }}>
          <View style={st.bar}><View style={[st.fill, { width: `${pct}%`, backgroundColor: pct >= 100 ? colors.red : pct >= 85 ? colors.gold : colors.green }]} /></View>
          <Text style={st.meta}>This month {money(budget!.spent)} of {money(limit)} budget</Text>
        </View>
      ) : budget && budget.spent ? <Text style={st.meta}>This month {money(budget.spent)} · no budget</Text> : null}
    </Card>
  );
}

const st = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backText: { fontSize: 15, fontWeight: '700', color: colors.text },
  h1: { fontSize: 28, fontWeight: '800', color: colors.text },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: 12, height: 44 },
  searchInput: { flex: 1, fontSize: 14.5, color: colors.text, paddingVertical: 0 },
  note: { fontSize: 12, color: colors.muted },
  name: { fontSize: 14.5, fontWeight: '800', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 1 },
  bar: { height: 5, borderRadius: 3, backgroundColor: colors.sunken, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
});
