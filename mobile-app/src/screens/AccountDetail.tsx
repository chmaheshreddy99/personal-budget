/**
 * One account: its balance (the server's, less what was spent on the phone and not yet synced) and its statement,
 * fresh from the server when it answers, otherwise the copy kept on the phone. A statement line opens on a tap to its
 * full description, the other account, the amounts and the balance after it, and evidence to add to it.
 */
import React, { useEffect, useState } from 'react';
import { LayoutAnimation } from 'react-native';
import { ActivityIndicator, BackHandler, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, ChevronDown, ChevronUp, Clock, CloudOff, Plus } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state';
import { Account, Statement, liveBalance } from '../data';
import { ago, date, money, shortDate } from '../format';
import { EvidenceStrip } from '../evidence';
import { AccountBubble, Button, Card, Empty, GradientPanel, Pill } from '../ui';
import { colors, space } from '../theme';

export function AccountDetail({ account, onBack, onAdd }: { account: Account; onBack: () => void; onAdd: (a: Account) => void }) {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const [stmt, setStmt] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const { balance, pending } = liveBalance(account, app.queue, app.chitQueue);
  const debitIn = account.accountClass === 'ASSET';
  const local = [
    ...app.queue.filter(e => e.paidFromId === account.id && e.status !== 'SYNCED').map(e => ({ id: e.clientId, date: e.date, text: e.narration || e.categoryName, amount: e.amount, failed: e.status === 'FAILED' })),
    ...app.chitQueue.filter(c => c.fromAccountId === account.id && c.status !== 'SYNCED').map(c => ({ id: c.clientId, date: c.paidDate, text: `${c.chitName} · instalment ${c.installmentNo}`, amount: c.amount, failed: c.status === 'FAILED' })),
  ];
  const toggle = (k: string) => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setOpen(o => (o === k ? null : k)); };

  useEffect(() => {
    let live = true;
    setLoading(true);
    app.statement(account.id).then(s => { if (live) { setStmt(s); setLoading(false); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => sub.remove();
  }, [onBack]);

  const rows = stmt ? [...stmt.rows].reverse() : [];
  const card = account.type === 'CREDIT_CARD';
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={rows}
        keyExtractor={(r, i) => `${r.entryId}-${i}`}
        contentContainerStyle={{ padding: space.l, paddingTop: insets.top + space.m, paddingBottom: 120 }}
        ListHeaderComponent={
          <View style={{ gap: space.m, marginBottom: space.m }}>
            <Pressable onPress={onBack} style={st.back} hitSlop={12}><ArrowLeft color={colors.text} size={20} /><Text style={st.backText}>Accounts</Text></Pressable>
            <GradientPanel>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <AccountBubble type={account.type} group={account.group} size={44} />
                <View style={{ flex: 1 }}>
                  <Text style={st.name} numberOfLines={2}>{account.name}</Text>
                  <Text style={st.meta}>{[account.typeLabel, account.groupName, account.institution, account.last4 ? `•• ${account.last4}` : null].filter(Boolean).join(' · ')}</Text>
                </View>
              </View>
              <Text style={st.label}>{card ? 'OUTSTANDING' : account.accountClass === 'LIABILITY' ? 'OWED' : 'BALANCE'}</Text>
              <Text style={st.big}>{money(balance, card ? 2 : undefined)}</Text>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {card && account.creditLimit ? <Pill text={`Available ${money(account.creditLimit - balance, 2)}`} fg={colors.white} bg="rgba(255,255,255,0.16)" /> : null}
                {pending ? <Pill text={`${money(pending)} spent on the phone, waiting to sync`} fg="#ffd68a" bg="rgba(255,255,255,0.12)" Icon={Clock} /> : null}
                <Pill text={`This month +${money(account.monthIn)} −${money(account.monthOut)}`} fg="rgba(255,255,255,0.85)" bg="rgba(255,255,255,0.12)" />
              </View>
            </GradientPanel>
            {account.payFrom ? <Button title="Record an expense from it" Icon={Plus} kind="soft" onPress={() => onAdd(account)} /> : null}
            {local.length ? (
              <Card style={{ gap: 8 }}>
                <Text style={st.sub}>On the phone · not on the server yet</Text>
                {local.map(e => (
                  <View key={e.id} style={st.line}>
                    <View style={[st.dot, { backgroundColor: e.failed ? colors.red : colors.gold }]} />
                    <Text style={st.lineText} numberOfLines={1}>{shortDate(e.date)} · {e.text}</Text>
                    <Text style={[st.amount, { color: colors.red }]}>−{money(e.amount)}</Text>
                  </View>
                ))}
              </Card>
            ) : null}
            <View style={st.stmtHead}>
              <Text style={st.sub}>Statement</Text>
              <View style={{ flex: 1 }} />
              {stmt ? <Text style={st.fetched}>{stmt.from ? `from ${shortDate(stmt.from)} · ` : ''}updated {ago(stmt.fetchedAt)}</Text> : null}
            </View>
            {loading ? <ActivityIndicator color={colors.ocean} /> : null}
          </View>
        }
        ListEmptyComponent={!loading ? <Empty Icon={CloudOff} title={stmt ? 'Nothing in this period' : 'No statement on the phone'}
          text={stmt ? undefined : 'Sync while the server is reachable to keep this account\'s statement for offline use.'} /> : null}
        renderItem={({ item: r, index }) => {
          const inflow = debitIn ? r.debit > 0 : r.credit > 0;
          const amount = r.debit > 0 ? r.debit : r.credit;
          const k = `${r.entryId}-${index}`;
          const isOpen = open === k;
          const evidence = app.uploads.filter(u => u.entryId === r.entryId);
          return (
            <Card style={[st.stRow, isOpen && { borderColor: colors.ocean2 }]} onPress={() => toggle(k)}>
              <View style={st.stTop}>
                <View style={[st.arrow, { backgroundColor: inflow ? colors.greenSoft : colors.redSoft }]}>
                  {inflow ? <ArrowDownLeft color={colors.green} size={16} /> : <ArrowUpRight color={colors.red} size={16} />}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={st.lineTitle} numberOfLines={isOpen ? 4 : 1}>{r.narration}</Text>
                  <Text style={st.lineMeta} numberOfLines={1}>{shortDate(r.date)}{r.other ? ` · ${r.other}` : ''}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[st.amount, { color: inflow ? colors.green : colors.red }]}>{inflow ? '+' : '−'}{money(amount)}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                    <Text style={st.lineMeta}>{money(r.balance)}</Text>
                    {isOpen ? <ChevronUp color={colors.muted} size={14} /> : <ChevronDown color={colors.muted} size={14} />}
                  </View>
                </View>
              </View>
              {isOpen ? (
                <View style={st.more}>
                  <View style={st.grid}>
                    {[['Date', date(r.date)], ['Entry', r.entryNo], ['Voucher', r.voucher], ['Other account', r.other],
                      [inflow ? 'In' : 'Out', money(amount, 2)], ['Balance after', money(r.balance, 2)]].map(([kk, v]) => v ? (
                      <View key={kk} style={st.kv}><Text style={st.k}>{kk}</Text><Text style={st.v} selectable>{v}</Text></View>) : null)}
                  </View>
                  <Text style={st.k}>Evidence</Text>
                  <EvidenceStrip compact items={evidence} onAdd={f => app.addEvidence({ entryId: r.entryId, label: r.narration }, [f])}
                    onRemove={it => it.id && app.removeEvidence(it.id)}
                    note={evidence.length ? `${evidence.length} waiting to upload` : 'Add a bill photo or a PDF to this entry: uploaded at the next sync.'} />
                </View>
              ) : null}
            </Card>
          );
        }}
      />
    </View>
  );
}

const st = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backText: { fontSize: 15, fontWeight: '700', color: colors.text },
  name: { color: colors.white, fontSize: 18, fontWeight: '800' },
  meta: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 },
  label: { color: 'rgba(255,255,255,0.6)', fontSize: 10.5, fontWeight: '800', letterSpacing: 1, marginTop: space.l },
  big: { color: colors.white, fontSize: 30, fontWeight: '800' },
  sub: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, color: colors.text2, textTransform: 'uppercase' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  lineText: { flex: 1, color: colors.text, fontSize: 13.5 },
  stmtHead: { flexDirection: 'row', alignItems: 'center', marginTop: space.s },
  fetched: { fontSize: 11.5, color: colors.muted },
  stRow: { marginBottom: 6, paddingVertical: 10 },
  stTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  more: { marginTop: space.m, paddingTop: space.m, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line, gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 },
  kv: { width: '50%', paddingRight: 8 },
  k: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.5, color: colors.muted, textTransform: 'uppercase' },
  v: { fontSize: 13.5, color: colors.text, fontWeight: '600', marginTop: 1 },
  arrow: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  lineTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  lineMeta: { fontSize: 11.5, color: colors.muted, marginTop: 1 },
  amount: { fontSize: 14.5, fontWeight: '800' },
});
