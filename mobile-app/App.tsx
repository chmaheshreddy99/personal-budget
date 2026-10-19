/**
 * Personal Budget for Android: the accounts with their balances, expenses (recorded offline and synced when the
 * server answers, with evidence), chits (paid offline too, or with Google Pay / PhonePe when the chit has a UPI ID),
 * and under More the budget, categories, the balance sheet, bank SMS offered as expenses, and settings. Signs in to the Personal Budget server first.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Modal, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { HandCoins, Landmark, LayoutGrid, MessageSquareText, Plus, Receipt, X, Check } from 'lucide-react-native';
import { AppProvider, useApp } from './src/state';
import { Account, LocalExpense } from './src/data';
import { money } from './src/format';
import { ParsedSms } from './src/sms';
import { colors, space } from './src/theme';
import { Button, Pill } from './src/ui';
import { SetupScreen } from './src/screens/Setup';
import { AccountsScreen } from './src/screens/Accounts';
import { AccountDetail } from './src/screens/AccountDetail';
import { ExpensesScreen } from './src/screens/Expenses';
import { AddExpense, Prefill } from './src/screens/AddExpense';
import { DetectedScreen } from './src/screens/Detected';
import { SettingsScreen } from './src/screens/Settings';
import { ChitsScreen } from './src/screens/Chits';
import { BalanceSheetScreen } from './src/screens/BalanceSheet';
import { BudgetScreen } from './src/screens/Budget';
import { CategoriesScreen } from './src/screens/Categories';
import { MorePage, MoreScreen } from './src/screens/More';

type Tab = 'accounts' | 'expenses' | 'chits' | 'more';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
      <AppProvider>
        <Shell />
      </AppProvider>
    </SafeAreaProvider>
  );
}

function Shell() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>('accounts');
  const [account, setAccount] = useState<Account | null>(null);
  const [page, setPage] = useState<MorePage | null>(null);
  const [adding, setAdding] = useState<{ prefill?: Prefill; editing?: LocalExpense } | null>(null);
  const [prompt, setPrompt] = useState<ParsedSms | null>(null);
  const prompted = useRef(new Set<string>());
  const insets = useSafeAreaInsets();

  // Back: from another tab to Accounts first, then out of the app (an open account or sheet closes itself)
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!account && !adding && !page && tab !== 'accounts') { setTab('accounts'); return true; }
      return false;
    });
    return () => sub.remove();
  }, [tab, account, adding, page]);

  // a new bank SMS: ask whether to record it (once per SMS)
  useEffect(() => {
    if (!app.settings.smsEnabled || adding || prompt) return;
    const fresh = app.detected.find(p => !prompted.current.has(p.sms.id));
    if (fresh) { prompted.current.add(fresh.sms.id); setPrompt(fresh); }
  }, [app.detected, app.settings.smsEnabled, adding, prompt]);

  if (!app.ready) return <View style={st.splash}><ActivityIndicator color={colors.ocean} size="large" /></View>;
  if (!app.settings.token) return <View style={{ flex: 1, backgroundColor: colors.bg }}><SetupScreen /></View>;

  const record = (p: ParsedSms) => {
    setPrompt(null);
    setAdding({ prefill: { amount: p.amount, date: p.date, narration: p.narration, party: p.merchant || '', reference: p.reference || '',
      categoryId: p.categoryId ?? undefined, paidFromId: p.accountId ?? undefined, smsId: p.sms.id, smsText: `${p.sms.sender}: ${p.sms.body}` } });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1 }}>
        {account ? <AccountDetail account={account} onBack={() => setAccount(null)} onAdd={a => setAdding({ prefill: { paidFromId: a.id } })} />
          : tab === 'accounts' ? <AccountsScreen onOpen={setAccount} onSettings={() => { setTab('more'); setPage('settings'); }} />
          : tab === 'expenses' ? <ExpensesScreen onEdit={e => setAdding({ editing: e })} />
          : tab === 'chits' ? <ChitsScreen />
          : page === 'budget' ? <BudgetScreen onBack={() => setPage(null)} />
          : page === 'categories' ? <CategoriesScreen onBack={() => setPage(null)} />
          : page === 'sheet' ? <BalanceSheetScreen onBack={() => setPage(null)} />
          : page === 'sms' ? <DetectedScreen onRecord={record} onBack={() => setPage(null)} />
          : page === 'settings' ? <SettingsScreen onBack={() => setPage(null)} />
          : <MoreScreen onOpen={setPage} />}
      </View>
      {/* the status bar keeps a solid background while the page scrolls under it */}
      <View pointerEvents="none" style={[st.statusStrip, { height: insets.top }]} />
      <TabBar tab={tab} onTab={t => { setAccount(null); if (t === tab && t === 'more') setPage(null); setTab(t); }} onAdd={() => setAdding({})} smsCount={app.detected.length} />
      <AddExpense visible={!!adding} onClose={() => setAdding(null)} prefill={adding?.prefill} editing={adding?.editing} />
      <SmsPrompt p={prompt} onLater={() => setPrompt(null)} onRecord={record} onDismiss={id => { app.dismissSms([id]); setPrompt(null); }} />
    </View>
  );
}

function TabBar({ tab, onTab, onAdd, smsCount }: { tab: Tab; onTab: (t: Tab) => void; onAdd: () => void; smsCount: number }) {
  const insets = useSafeAreaInsets();
  const item = (key: Tab, label: string, Icon: any, badge = 0) => {
    const on = tab === key;
    return (
      <Pressable key={key} onPress={() => onTab(key)} style={st.tab} hitSlop={6}>
        <View>
          <Icon color={on ? colors.ocean : colors.muted} size={22} strokeWidth={on ? 2.4 : 2} />
          {badge ? <View style={st.badge}><Text style={st.badgeText}>{badge > 9 ? '9+' : badge}</Text></View> : null}
        </View>
        <Text style={[st.tabText, on && { color: colors.ocean }]}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View style={[st.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {item('accounts', 'Accounts', Landmark)}
      {item('expenses', 'Expenses', Receipt)}
      <Pressable onPress={onAdd} style={({ pressed }) => [st.fab, pressed && { transform: [{ scale: 0.95 }] }]}>
        <Plus color={colors.white} size={28} strokeWidth={2.6} />
      </Pressable>
      {item('chits', 'Chits', HandCoins)}
      {item('more', 'More', LayoutGrid, smsCount)}
    </View>
  );
}

/** "₹1,250 went out of HDFC •• 4321 at Swiggy · record it?" */
function SmsPrompt({ p, onLater, onRecord, onDismiss }: { p: ParsedSms | null; onLater: () => void; onRecord: (p: ParsedSms) => void; onDismiss: (id: string) => void }) {
  const app = useApp();
  if (!p) return null;
  const acc = app.snapshot?.accounts.find(a => a.id === p.accountId);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onLater} statusBarTranslucent>
      <View style={st.promptWrap}>
        <View style={st.prompt}>
          <View style={st.promptIcon}><MessageSquareText color={colors.white} size={22} /></View>
          <Text style={st.promptTitle}>{money(p.amount)} spent</Text>
          <Text style={st.promptSub}>{[p.merchant ? `at ${p.merchant}` : null, acc ? `from ${acc.name}` : p.bank ? `· ${p.bank}${p.last4 ? ` •• ${p.last4}` : ''}` : null].filter(Boolean).join(' ')}</Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
            {p.reference ? <Pill text={`Ref ${p.reference}`} /> : null}
          </View>
          <Text style={st.promptBody} numberOfLines={4}>{p.sms.body}</Text>
          <Text style={st.promptAsk}>Record it as an expense?</Text>
          <Button title="Record" Icon={Check} onPress={() => onRecord(p)} />
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <Button title="Later" kind="ghost" onPress={onLater} style={{ flex: 1 }} />
            <Button title="Not an expense" kind="ghost" Icon={X} onPress={() => onDismiss(p.sms.id)} style={{ flex: 1.4 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  statusStrip: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.bg },
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line, paddingTop: 8, elevation: 12, shadowColor: '#0b2038', shadowOpacity: 0.1, shadowRadius: 12 },
  tab: { flex: 1, alignItems: 'center', gap: 3 },
  tabText: { fontSize: 11, fontWeight: '700', color: colors.muted },
  fab: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.ocean, alignItems: 'center', justifyContent: 'center', marginTop: -26,
    elevation: 8, shadowColor: colors.ocean, shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, borderWidth: 4, borderColor: colors.bg },
  badge: { position: 'absolute', top: -5, right: -10, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: colors.white, fontSize: 10, fontWeight: '800' },
  promptWrap: { flex: 1, backgroundColor: 'rgba(11,32,56,0.55)', justifyContent: 'center', padding: space.l },
  prompt: { backgroundColor: colors.card, borderRadius: 24, padding: space.l, gap: space.s, alignItems: 'stretch' },
  promptIcon: { alignSelf: 'center', width: 52, height: 52, borderRadius: 18, backgroundColor: colors.ocean, alignItems: 'center', justifyContent: 'center' },
  promptTitle: { fontSize: 26, fontWeight: '800', color: colors.text, textAlign: 'center' },
  promptSub: { fontSize: 14, color: colors.text2, textAlign: 'center' },
  promptBody: { fontSize: 12, color: colors.muted, backgroundColor: colors.sunken, padding: 10, borderRadius: 10, lineHeight: 17 },
  promptAsk: { fontSize: 14.5, fontWeight: '700', color: colors.text, textAlign: 'center', marginTop: 4 },
});
