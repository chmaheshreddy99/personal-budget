/**
 * The accounts with their balances: my own (banks, cards, cash and wallets, loans and the rest) and, when turned on in
 * Settings, the construction business's (by project), the chits I host (by chit) and EMIs; Settings can also limit
 * the list to chosen accounts. Balances are the server's at the last sync, less what
 * was spent on the phone since (shown as "−₹… waiting"). The top shows net worth, what waits to be synced and the
 * Sync button.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronDown, ChevronRight, CloudOff, HandCoins, HardHat, RefreshCw, User, WifiOff, CalendarClock, AlertTriangle, EyeOff, Eye, ArrowLeftRight, Lock, Receipt, ArrowDownLeft, BookOpen } from 'lucide-react-native';
import type { RecordMode } from './AddExpense';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state';
import { Account, hasFeature, liveBalance } from '../data';
import { ago, money, moneyShort } from '../format';
import { AccountBubble, Card, Empty, GradientPanel, Pill, SectionTitle } from '../ui';
import { colors, space } from '../theme';

const OWN_ORDER: [string, (a: Account) => boolean][] = [
  ['Banks', a => a.type === 'BANK'],
  ['Cards', a => a.type === 'CREDIT_CARD'],
  ['Cash, wallets & meal cards', a => a.type === 'CASH' || a.type === 'WALLET' || a.type === 'MEAL_CARD'],
  ['Savings & investments', a => a.accountClass === 'ASSET' && !['BANK', 'CASH', 'WALLET', 'MEAL_CARD'].includes(a.type)],
  ['Loans & dues', a => a.accountClass === 'LIABILITY' && a.type !== 'CREDIT_CARD'],
];

export function AccountsScreen({ onOpen, onSettings, onTransfer, onRecord, onChits }: { onOpen: (a: Account) => void; onSettings?: () => void; onTransfer?: () => void;
  onRecord?: (mode: RecordMode) => void; onChits?: () => void }) {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const accounts = app.accounts;
  const hidden = (app.snapshot?.accounts.length || 0) - accounts.length;
  const chosen = app.settings.accountFilter === 'chosen';
  const [showWaiting, setShowWaiting] = useState(false);
  const waitingItems = waitingList(app);
  const waiting = waitingItems;
  const failed = waitingItems.filter(w => w.failed).length;

  const own = accounts.filter(a => a.group === 'OWN');
  const signed = (a: Account) => (a.accountClass === 'ASSET' ? 1 : -1) * liveBalance(a, app.queue, app.chitQueue, app.records).balance;
  const netWorth = own.reduce((s, a) => s + signed(a), 0);
  const cash = own.filter(a => ['BANK', 'CASH', 'WALLET', 'MEAL_CARD'].includes(a.type)).reduce((s, a) => s + liveBalance(a, app.queue, app.chitQueue, app.records).balance, 0);
  const cards = own.filter(a => a.type === 'CREDIT_CARD').reduce((s, a) => s + liveBalance(a, app.queue, app.chitQueue, app.records).balance, 0);

  const sealed = (list: Account[]) => list.some(a => app.isPrivate(a.id));
  const sum = (list: Account[], text: string) => (sealed(list) ? '••••' : text);
  const actions = [
    onRecord && hasFeature(app.snapshot, 'EXPENSES') ? { key: 'exp', label: 'Expense', Icon: Receipt, fg: colors.coral, onPress: () => onRecord('EXPENSE') } : null,
    onRecord && hasFeature(app.snapshot, 'INCOME') ? { key: 'inc', label: 'Income', Icon: ArrowDownLeft, fg: colors.green, onPress: () => onRecord('INCOME') } : null,
    onTransfer ? { key: 'tr', label: 'Transfer', Icon: ArrowLeftRight, fg: colors.ocean, onPress: onTransfer } : null,
    onChits ? { key: 'chit', label: 'Pay chit', Icon: BookOpen, fg: colors.gold, onPress: onChits } : null,
  ].filter(Boolean) as { key: string; label: string; Icon: typeof Receipt; fg: string; onPress: () => void }[];

  const byName = (list: Account[]) => {
    const m = new Map<string, Account[]>();
    list.forEach(a => { const k = a.groupName || ''; m.set(k, [...(m.get(k) || []), a]); });
    return [...m.entries()];
  };
  const toggle = (k: string) => setClosed(c => ({ ...c, [k]: !c[k] }));

  const status = app.settings.offline ? { Icon: WifiOff, text: 'Working offline', fg: colors.gold }
    : app.syncing ? { Icon: RefreshCw, text: app.step || 'Syncing…', fg: colors.ocean2 }
    : app.meta.lastError ? { Icon: CloudOff, text: app.meta.lastError, fg: '#ffb4a0' }
    : { Icon: RefreshCw, text: `Synced ${ago(app.meta.lastSync)}`, fg: '#a8e3c2' };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.l, paddingTop: insets.top + space.m, paddingBottom: 110 }}
      refreshControl={<RefreshControl refreshing={app.syncing} onRefresh={() => app.sync()} colors={[colors.ocean]} />}>
      <GradientPanel>
        <View style={st.headRow}>
          <View style={{ flex: 1 }}>
            <Text style={st.hello}>{app.snapshot?.household || 'Personal Budget'}</Text>
            <Text style={st.label}>{chosen ? 'NET WORTH · CHOSEN ACCOUNTS' : 'NET WORTH · MY ACCOUNTS'}</Text>
            <Text style={st.big}>{sealed(own) && !app.snapshot?.mobile?.maskNetWorth ? '••••••' : app.net(netWorth)}</Text>
          </View>
          <Pressable onPress={() => app.sync()} style={({ pressed }) => [st.syncBtn, pressed && { opacity: 0.8 }]} disabled={app.syncing}>
            {app.syncing ? <ActivityIndicator color={colors.white} /> : <RefreshCw color={colors.white} size={20} />}
            <Text style={st.syncText}>Sync</Text>
          </Pressable>
        </View>
        <View style={st.privacyRow}>
          <Pressable onPress={() => (app.balancesVisible ? app.hideBalances() : app.showBalances())} style={({ pressed }) => [st.privacyBtn, pressed && { opacity: 0.8 }]}>
            {app.balancesVisible ? <EyeOff color={colors.white} size={15} /> : <Eye color={colors.white} size={15} />}
            <Text style={st.privacyText}>{app.balancesVisible ? 'Hide balances' : 'View balances'}</Text>
          </Pressable>
        </View>
        <View style={st.figs}>
          <View style={st.fig}><Text style={st.figLabel}>Cash & bank</Text><Text style={st.figValue}>{sum(own.filter(a => ['BANK', 'CASH', 'WALLET', 'MEAL_CARD'].includes(a.type)), app.balShort(cash))}</Text></View>
          <View style={st.fig}><Text style={st.figLabel}>Card dues</Text><Text style={st.figValue}>{sum(own.filter(a => a.type === 'CREDIT_CARD'), app.balShort(cards))}</Text></View>
          <Pressable style={st.fig} onPress={() => waiting.length && setShowWaiting(true)}><Text style={st.figLabel}>To sync</Text><Text style={[st.figValue, waiting.length ? { color: '#ffd68a' } : null]}>{waiting.length}</Text></Pressable>
        </View>
        <View style={st.statusRow}>
          <status.Icon color={status.fg} size={13} />
          <Text style={[st.statusText, { color: status.fg }]} numberOfLines={1}>{status.text}</Text>
          {app.snapshot ? <Text style={st.statusMuted}>· balances of {ago(app.snapshot.fetchedAt)}</Text> : null}
        </View>
      </GradientPanel>

      {actions.length ? (
        <View style={st.actions}>
          {actions.map(x => (
            <Pressable key={x.key} onPress={x.onPress} style={({ pressed }) => [st.action, pressed && { transform: [{ scale: 0.96 }] }]}>
              <View style={[st.actionIco, { backgroundColor: x.fg + '1f' }]}><x.Icon color={x.fg} size={20} /></View>
              <Text style={st.actionText}>{x.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {failed ? (
        <Card style={[st.banner, { borderColor: colors.redSoft }]} onPress={() => setShowWaiting(true)}>
          <AlertTriangle color={colors.red} size={18} />
          <Text style={[st.bannerText, { color: colors.red }]}>{failed} {failed === 1 ? 'entry was' : 'entries were'} not accepted by the server. Tap to see why and remove {failed === 1 ? 'it' : 'them'}.</Text>
        </Card>
      ) : null}
      <WaitingSheet visible={showWaiting} onClose={() => setShowWaiting(false)} />

      {hidden > 0 && accounts.length ? (
        <Pressable onPress={onSettings} style={st.hidden}>
          <EyeOff color={colors.muted} size={14} />
          <Text style={st.hiddenText}>{hidden} account{hidden === 1 ? '' : 's'} hidden{chosen ? ' (only chosen ones are shown)' : ' (construction, chits, EMIs)'} · <Text style={{ color: colors.ocean, fontWeight: '700' }}>Settings</Text></Text>
        </Pressable>
      ) : null}

      {!accounts.length && app.snapshot?.accounts.length ? (
        <Empty Icon={EyeOff} title="No accounts shown" text="Every account is hidden by the choices in Settings." />
      ) : null}
      {!app.snapshot?.accounts.length ? (
        <Empty Icon={CloudOff} title="No accounts yet" text={app.settings.offline ? 'Turn off offline mode and sync once to bring your accounts to the phone.' : 'Pull down or press Sync to bring your accounts from the server.'} />
      ) : null}

      {own.length ? <SectionTitle title="My accounts" Icon={User} /> : null}
      {OWN_ORDER.map(([label, test]) => {
        const list = own.filter(test);
        if (!list.length) return null;
        const total = list.reduce((s, a) => s + liveBalance(a, app.queue, app.chitQueue, app.records).balance, 0);
        return (
          <Card key={label} style={st.groupCard}>
            <Pressable style={st.groupHead} onPress={() => toggle(label)}>
              <Text style={st.groupTitle}>{label}</Text>
              <Text style={st.groupCount}>{list.length}</Text>
              <View style={{ flex: 1 }} />
              <Text style={st.groupTotal}>{sealed(list) ? '••••••' : app.bal(total)}</Text>
              {closed[label] ? <ChevronRight color={colors.muted} size={18} /> : <ChevronDown color={colors.muted} size={18} />}
            </Pressable>
            {!closed[label] ? list.map(a => <AccountRow key={a.id} a={a} onPress={() => onOpen(a)} />) : null}
          </Card>
        );
      })}

      {[['CONSTRUCTION', 'Construction', HardHat], ['HOSTED_CHIT', 'Host a Chit', HandCoins], ['EMI', 'EMIs', CalendarClock]].map(([group, title, Icon]) => {
        const list = accounts.filter(a => a.group === group);
        if (!list.length) return null;
        return (
          <View key={group as string}>
            <SectionTitle title={title as string} Icon={Icon as any} />
            {(group === 'EMI' ? [['', list] as [string, Account[]]] : byName(list)).map(([name, items]) => (
              <Card key={name} style={st.groupCard}>
                {name ? (
                  <Pressable style={st.groupHead} onPress={() => toggle(`${group}:${name}`)}>
                    <Text style={st.groupTitle} numberOfLines={1}>{name}</Text>
                    <Text style={st.groupCount}>{items.length}</Text>
                    <View style={{ flex: 1 }} />
                    {closed[`${group}:${name}`] ? <ChevronRight color={colors.muted} size={18} /> : <ChevronDown color={colors.muted} size={18} />}
                  </Pressable>
                ) : null}
                {!closed[`${group}:${name}`] ? items.map(a => <AccountRow key={a.id} a={a} onPress={() => onOpen(a)} />) : null}
              </Card>
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}

function AccountRow({ a, onPress }: { a: Account; onPress: () => void }) {
  const app = useApp();
  const { balance, pending } = liveBalance(a, app.queue, app.chitQueue, app.records);
  const card = a.type === 'CREDIT_CARD';
  const available = card && a.creditLimit ? a.creditLimit - balance : null;
  return (
    <Pressable onPress={onPress} onLongPress={() => privacyMenu(app, a)} style={({ pressed }) => [st.row, pressed && { backgroundColor: colors.sunken }]} android_ripple={{ color: '#00000008' }}>
      <AccountBubble type={a.type} group={a.group} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={st.nameRow}><Text style={st.name} numberOfLines={1}>{a.name}</Text>{app.isPrivate(a.id) ? <Lock color={colors.muted} size={12} /> : null}</View>
        <Text style={st.meta} numberOfLines={1}>{[a.typeLabel, a.institution, a.last4 ? `•• ${a.last4}` : null].filter(Boolean).join(' · ')}</Text>
        {available !== null ? <Text style={st.avail}>Available {app.bal(available, a.id, 2)}</Text> : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 3 }}>
        <Text style={[st.balance, balance < 0 && a.accountClass === 'ASSET' ? { color: colors.red } : card && balance > 0 ? { color: colors.coral } : null]}>{app.bal(balance, a.id, card ? 2 : undefined)}</Text>
        {pending ? <Pill text={`${a.accountClass === 'LIABILITY' ? '+' : '−'}${moneyShort(pending)} waiting`} fg={colors.gold} bg={colors.goldSoft} /> : null}
      </View>
    </Pressable>
  );
}

type WaitingItem = { id: string; kind: string; title: string; sub: string; amount: number; date: string; failed: boolean; message?: string; remove: () => Promise<void> };

/** Everything recorded on the phone that the server does not have yet (expenses, chit payments, income, transfers ...), and why if it refused. */
function waitingList(app: ReturnType<typeof useApp>): WaitingItem[] {
  const waits = (s: string) => s === 'QUEUED' || s === 'FAILED';
  return [
    ...app.queue.filter(e => waits(e.status)).map(e => ({ id: e.clientId, kind: 'Expense', title: e.narration || e.categoryName, sub: `${e.categoryName} · ${e.paidFromName}`,
      amount: e.amount, date: e.date, failed: e.status === 'FAILED', message: e.message, remove: () => app.removeExpense(e.clientId) })),
    ...app.chitQueue.filter(c => waits(c.status)).map(c => ({ id: c.clientId, kind: 'Chit payment', title: `${c.chitName} · installment ${c.installmentNo}`, sub: c.fromAccountName,
      amount: c.amount, date: c.paidDate, failed: c.status === 'FAILED', message: c.message, remove: () => app.removeChitPayment(c.clientId) })),
    ...app.records.filter(r => waits(r.status)).map(r => ({ id: r.clientId, kind: ({ CLAIM: 'Money owed', REPAYMENT: 'Repayment', INCOME: 'Income', GIFT: 'Gift', EMI_PAY: 'EMI', TRANSFER: 'Transfer' } as Record<string, string>)[r.kind] || r.kind,
      title: r.title, sub: r.sub, amount: r.amount, date: r.date, failed: r.status === 'FAILED', message: r.message, remove: () => app.removeRecord(r.clientId) })),
  ].sort((a, b) => Number(b.failed) - Number(a.failed) || b.date.localeCompare(a.date));
}

/** The list behind "To sync": each item, what the server said, and a way to remove one it will not take. */
function WaitingSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const app = useApp();
  const items = waitingList(app);
  const ask = (w: WaitingItem) => Alert.alert(`Remove this ${w.kind.toLowerCase()}?`, `${w.title}, ${money(w.amount)}. It is only on this phone: removing it cannot be undone.`, [
    { text: 'Keep', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { w.remove(); } }]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={st.sheetBack} onPress={onClose} />
      <View style={st.sheet}>
        <View style={st.sheetHandle} />
        <Text style={st.sheetTitle}>Waiting on this phone</Text>
        <Text style={st.sheetSub}>{items.length ? 'Sent with the next sync. Those the server refused say why; remove them, or fix them in their own section.' : 'Everything is on the server.'}</Text>
        <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
          {items.map(w => (
            <View key={w.id} style={[st.wItem, w.failed && { borderColor: colors.redSoft, backgroundColor: '#fff8f7' }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={st.wKind}>{w.kind} · {w.date}</Text>
                <Text style={st.wTitle} numberOfLines={1}>{w.title}</Text>
                {w.sub ? <Text style={st.wSub} numberOfLines={1}>{w.sub}</Text> : null}
                {w.failed ? <Text style={st.wErr}>Not accepted: {w.message || 'refused by the server'}</Text> : <Text style={st.wWait}>Waiting to sync</Text>}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Text style={st.wAmt}>{money(w.amount)}</Text>
                <Pressable onPress={() => ask(w)} style={st.wRemove} hitSlop={8}><Text style={st.wRemoveText}>Remove</Text></Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
        <Pressable onPress={() => { onClose(); app.sync(); }} style={st.wSync}><RefreshCw color={colors.white} size={16} /><Text style={st.wSyncText}>Sync now</Text></Pressable>
      </View>
    </Modal>
  );
}

/** Long press on an account: show its balance this once, or keep it private on this phone (the household's own choice cannot be undone here). */
function privacyMenu(app: ReturnType<typeof useApp>, a: Account) {
  const mine = (app.settings.privateAccounts || []).includes(a.id);
  const house = app.privateByHousehold(a.id);
  Alert.alert(a.name, house ? 'The household keeps this balance private on phones.' : mine ? 'Kept private on this phone.' : 'Balance privacy for this account', [
    { text: 'Show balance once', onPress: () => app.reveal(a.id) },
    ...(house ? [] : [{ text: mine ? 'Stop keeping it private' : 'Keep private on this phone', onPress: () => { app.togglePrivate(a.id); } }]),
    { text: 'Cancel', style: 'cancel' as const },
  ]);
}

const st = StyleSheet.create({
  sheetBack: { flex: 1, backgroundColor: 'rgba(11,32,56,0.35)' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: space.l, paddingBottom: 28, gap: 6 },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: 6 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  sheetSub: { fontSize: 12.5, color: colors.muted, marginBottom: 6 },
  wItem: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  wKind: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.3 },
  wTitle: { fontSize: 14.5, fontWeight: '700', color: colors.text, marginTop: 1 },
  wSub: { fontSize: 12, color: colors.muted },
  wErr: { fontSize: 12, color: colors.red, fontWeight: '600', marginTop: 4 },
  wWait: { fontSize: 12, color: colors.gold, fontWeight: '600', marginTop: 4 },
  wAmt: { fontSize: 15, fontWeight: '800', color: colors.text },
  wRemove: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: colors.redSoft },
  wRemoveText: { color: colors.red, fontSize: 12, fontWeight: '800' },
  wSync: { marginTop: 8, height: 46, borderRadius: 14, backgroundColor: colors.ocean, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  wSyncText: { color: colors.white, fontWeight: '800', fontSize: 14.5 },
  actions: { flexDirection: 'row', gap: 8, marginTop: space.m },
  action: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 10, borderRadius: 16, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  actionIco: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 12, fontWeight: '700', color: colors.text2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  headRow: { flexDirection: 'row', alignItems: 'flex-start' },
  hello: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '600', marginBottom: 10 },
  label: { color: 'rgba(255,255,255,0.6)', fontSize: 10.5, fontWeight: '800', letterSpacing: 1 },
  big: { color: colors.white, fontSize: 30, fontWeight: '800', marginTop: 2 },
  syncBtn: { alignItems: 'center', justifyContent: 'center', gap: 2, width: 64, height: 64, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.16)' },
  syncText: { color: colors.white, fontSize: 11, fontWeight: '700' },
  figs: { flexDirection: 'row', gap: 8, marginTop: space.l },
  fig: { flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10 },
  figLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10.5, fontWeight: '700' },
  figValue: { color: colors.white, fontSize: 16, fontWeight: '800', marginTop: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.m },
  statusText: { fontSize: 12, fontWeight: '700', flexShrink: 1 },
  statusMuted: { fontSize: 12, color: 'rgba(255,255,255,0.6)' },
  hidden: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.m, paddingHorizontal: 4 },
  hiddenText: { fontSize: 12, color: colors.muted, flexShrink: 1 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: space.m },
  bannerText: { flex: 1, fontSize: 13, fontWeight: '600' },
  privacyRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  privacyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.16)' },
  privacyText: { color: colors.white, fontSize: 12.5, fontWeight: '700' },
  groupCard: { padding: 0, marginBottom: space.s, overflow: 'hidden' },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space.m, paddingVertical: 10, backgroundColor: colors.sunken },
  groupTitle: { fontSize: 13.5, fontWeight: '800', color: colors.text, flexShrink: 1 },
  groupCount: { fontSize: 11, fontWeight: '700', color: colors.muted, backgroundColor: colors.card, paddingHorizontal: 7, borderRadius: 9, overflow: 'hidden' },
  groupTotal: { fontSize: 13.5, fontWeight: '800', color: colors.text2, marginRight: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: space.m, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  name: { fontSize: 15, fontWeight: '700', color: colors.text, flexShrink: 1 },
  meta: { fontSize: 12, color: colors.muted, marginTop: 1 },
  avail: { fontSize: 11.5, color: colors.aqua, fontWeight: '700', marginTop: 2 },
  balance: { fontSize: 15.5, fontWeight: '800', color: colors.text },
});
