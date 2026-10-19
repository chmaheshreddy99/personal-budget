/**
 * Settings: the server and sign-in, which accounts the phone shows (construction, hosted chits and EMIs are hidden
 * until turned on; the list can be limited to chosen accounts), working offline, how much the phone keeps for
 * offline use (size, days, statements), bank SMS detection, and what the offline copy takes now.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import {
  ArrowLeft, CalendarClock, CheckSquare, Database, Eye, HandCoins, HardDrive, HardHat, History, LogOut, MessageSquareText, RefreshCw, Search, Server,
  Square, Trash2, WifiOff,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state';
import { ago, bytes } from '../format';
import { smsSupported } from '../native';
import { Account, GROUP_LABELS, Group } from '../data';
import { AccountBubble, Button, Card, Chip, IconBubble, SectionTitle, Sheet } from '../ui';
import { colors, space } from '../theme';

function Row({ Icon, fg, bg, title, sub, right }: { Icon: any; fg: string; bg: string; title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <View style={st.row}>
      <IconBubble Icon={Icon} fg={fg} bg={bg} size={36} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.title}>{title}</Text>
        {sub ? <Text style={st.sub}>{sub}</Text> : null}
      </View>
      {right}
    </View>
  );
}

const GROUPS: [Group, any, string, string, string][] = [
  ['CONSTRUCTION', HardHat, colors.gold, colors.goldSoft, 'The construction business’s accounts, by project'],
  ['HOSTED_CHIT', HandCoins, colors.aqua, colors.aquaSoft, 'The accounts of the chits you host'],
  ['EMI', CalendarClock, colors.violet, colors.violetSoft, 'Card and loan EMI accounts'],
];

export function SettingsScreen({ onBack }: { onBack?: () => void }) {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const s = app.settings;
  const [choosing, setChoosing] = useState(false);
  useEffect(() => {
    if (!onBack) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => sub.remove();
  }, [onBack]);
  const all = app.snapshot?.accounts || [];
  const count = (g: Group) => all.filter(a => a.group === g).length;
  const toggleGroup = (g: Group, on: boolean) => app.saveSettings({ showGroups: on ? [...(s.showGroups || []), g] : (s.showGroups || []).filter(x => x !== g) });
  const limit = s.storageMb * 1024 * 1024;
  const pct = Math.min(100, (app.used.cache / limit) * 100);

  return (
    <ScrollView contentContainerStyle={{ padding: space.l, paddingTop: insets.top + space.m, paddingBottom: 120 }}>
      {onBack ? <Pressable onPress={onBack} style={st.back} hitSlop={12}><ArrowLeft color={colors.text} size={20} /><Text style={st.backText}>More</Text></Pressable> : null}
      <Text style={st.h1}>Settings</Text>

      <SectionTitle title="Server" Icon={Server} />
      <Card style={{ gap: space.m }}>
        <Row Icon={Server} fg={colors.ocean} bg={colors.oceanSoft} title={s.serverUrl || 'Not set'} sub={`Signed in as ${s.userName || s.username}${app.snapshot ? ` · ${app.snapshot.household}` : ''}`} />
        <Row Icon={RefreshCw} fg={colors.aqua} bg={colors.aquaSoft} title={`Last sync ${ago(app.meta.lastSync)}`} sub={app.meta.lastError || 'Up to date'}
          right={<Button title="Sync" kind="soft" onPress={() => app.sync()} busy={app.syncing} style={{ height: 38 }} />} />
        <Button title="Sign out" kind="ghost" Icon={LogOut} onPress={() => Alert.alert('Sign out?', app.queue.some(e => e.status === 'QUEUED')
          ? 'Expenses waiting to sync stay on the phone and go up after you sign in again.' : 'You can sign in again any time.',
          [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => app.signOut() }])} />
      </Card>

      <SectionTitle title="Accounts shown" Icon={Eye} />
      <Card style={{ gap: space.m }}>
        <Text style={st.sub}>Your own accounts are always available. These are hidden unless turned on:</Text>
        {GROUPS.map(([g, Icon, fg, bg, sub]) => (
          <Row key={g} Icon={Icon} fg={fg} bg={bg} title={`${GROUP_LABELS[g]}${count(g) ? ` · ${count(g)}` : ''}`} sub={sub}
            right={<Switch value={(s.showGroups || []).includes(g)} onValueChange={v => toggleGroup(g, v)} trackColor={{ true: fg, false: colors.line }} />} />
        ))}
        <View>
          <Text style={st.label}>Show</Text>
          <View style={st.chips}>
            <Chip label="All of them" selected={s.accountFilter !== 'chosen'} onPress={() => app.saveSettings({ accountFilter: 'all' })} />
            <Chip label={`Only chosen${s.accountFilter === 'chosen' ? ` · ${s.chosenAccounts.length}` : ''}`} Icon={CheckSquare} selected={s.accountFilter === 'chosen'}
              onPress={() => { if (!s.chosenAccounts.length) setChoosing(true); else app.saveSettings({ accountFilter: 'chosen' }); }} />
          </View>
          <Text style={st.sub}>Only the accounts shown are listed, offered to pay from and kept offline.</Text>
        </View>
        {s.accountFilter === 'chosen' || s.chosenAccounts.length ? <Button title="Choose accounts" kind="soft" Icon={CheckSquare} onPress={() => setChoosing(true)} /> : null}
      </Card>

      <SectionTitle title="Working offline" Icon={WifiOff} />
      <Card>
        <Row Icon={WifiOff} fg={colors.gold} bg={colors.goldSoft} title="Work offline"
          sub="Nothing is sent or fetched: expenses are kept on the phone (and taken off the balances) until you turn this off."
          right={<Switch value={s.offline} onValueChange={v => app.saveSettings({ offline: v })} trackColor={{ true: colors.gold, false: colors.line }} />} />
      </Card>

      <SectionTitle title="Kept on the phone" Icon={HardDrive} />
      <Card style={{ gap: space.m }}>
        <View>
          <Text style={st.label}>Space for offline use</Text>
          <View style={st.chips}>{[2, 5, 10, 20, 50].map(n => <Chip key={n} label={`${n} MB`} selected={s.storageMb === n} onPress={() => app.saveSettings({ storageMb: n })} />)}</View>
          <View style={st.bar}><View style={[st.fill, { width: `${pct}%`, backgroundColor: pct > 90 ? colors.coral : colors.aqua }]} /></View>
          <Text style={st.sub}>{bytes(app.used.cache)} of {s.storageMb} MB used · statements {bytes(app.used.statements)}. The least active accounts' statements go first when it is full; expenses waiting to sync are always kept.</Text>
          {app.used.evidence ? <Text style={st.sub}>Evidence waiting to upload: {bytes(app.used.evidence)} ({app.uploads.length} file{app.uploads.length === 1 ? '' : 's'}), removed from the phone once uploaded.</Text> : null}
        </View>
        <View>
          <Text style={st.label}>History kept</Text>
          <View style={st.chips}>{[30, 60, 90, 180, 365].map(n => <Chip key={n} label={n < 365 ? `${n} days` : '1 year'} Icon={History} selected={s.historyDays === n} onPress={() => app.saveSettings({ historyDays: n })} />)}</View>
        </View>
        <View>
          <Text style={st.label}>Statements kept for</Text>
          <View style={st.chips}>{[5, 12, 25, 50].map(n => <Chip key={n} label={`${n} accounts`} selected={s.statementAccounts === n} onPress={() => app.saveSettings({ statementAccounts: n })} />)}</View>
          <Text style={st.sub}>The most active accounts first; any account's statement is fetched when opened online.</Text>
        </View>
        <Button title="Clear the offline copy" kind="ghost" Icon={Trash2} onPress={() => Alert.alert('Clear the offline copy?', 'Balances and statements are fetched again at the next sync. Expenses waiting to sync are kept.',
          [{ text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive', onPress: () => app.clearCache() }])} />
      </Card>

      <SectionTitle title="Bank SMS" Icon={MessageSquareText} />
      <Card>
        <Row Icon={MessageSquareText} fg={colors.violet} bg={colors.violetSoft} title="Detect bank SMS"
          sub={smsSupported ? 'Be asked to record an expense when your bank sends a debit SMS (amount, account, shop and reference filled in).' : 'Android only.'}
          right={<Switch value={s.smsEnabled} disabled={!smsSupported} onValueChange={v => { app.enableSms(v); }} trackColor={{ true: colors.violet, false: colors.line }} />} />
      </Card>

      <SectionTitle title="About" Icon={Database} />
      <Card><Text style={st.sub}>Personal Budget for Android · keeps your accounts, statements, chits and expenses on the phone and syncs them with your Personal Budget server.</Text></Card>
      <ChooseAccounts visible={choosing} onClose={() => setChoosing(false)} accounts={all.filter(a => a.group === 'OWN' || (s.showGroups || []).includes(a.group))} />
    </ScrollView>
  );
}

/** Tick the accounts to show; saving turns "only chosen" on. */
function ChooseAccounts({ visible, onClose, accounts }: { visible: boolean; onClose: () => void; accounts: Account[] }) {
  const app = useApp();
  const [picked, setPicked] = useState<number[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (visible) { setPicked(app.settings.chosenAccounts.length ? app.settings.chosenAccounts : accounts.map(a => a.id)); setQ(''); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return accounts.filter(a => !t || [a.name, a.typeLabel, a.institution, a.groupName, a.last4].some(v => v && v.toLowerCase().includes(t)));
  }, [accounts, q]);
  const flip = (id: number) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
  const save = async () => {
    if (!picked.length) { app.notify('Choose at least one account'); return; }
    await app.saveSettings({ accountFilter: 'chosen', chosenAccounts: picked });
    onClose();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Choose the accounts to show"
      footer={<View style={{ flexDirection: 'row', gap: space.s }}>
        <Button title="Show all" kind="ghost" onPress={async () => { await app.saveSettings({ accountFilter: 'all' }); onClose(); }} />
        <Button title={`Show ${picked.length} chosen`} Icon={CheckSquare} onPress={save} style={{ flex: 1 }} />
      </View>}>
      <View style={st.search}>
        <Search color={colors.muted} size={16} />
        <TextInput value={q} onChangeText={setQ} placeholder="Search accounts" placeholderTextColor={colors.muted} style={st.searchInput} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Chip label="Tick all" onPress={() => setPicked(p => [...new Set([...p, ...list.map(a => a.id)])])} />
        <Chip label="Untick all" onPress={() => setPicked(p => p.filter(id => !list.some(a => a.id === id)))} />
      </View>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {list.map(a => {
          const on = picked.includes(a.id);
          return (
            <Pressable key={a.id} onPress={() => flip(a.id)} style={st.pick}>
              <AccountBubble type={a.type} group={a.group} size={32} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={st.title} numberOfLines={1}>{a.name}</Text>
                <Text style={st.sub} numberOfLines={1}>{[a.groupName || GROUP_LABELS[a.group], a.typeLabel, a.last4 ? `•• ${a.last4}` : null].filter(Boolean).join(' · ')}</Text>
              </View>
              {on ? <CheckSquare color={colors.ocean} size={22} /> : <Square color={colors.muted} size={22} />}
            </Pressable>
          );
        })}
      </Card>
    </Sheet>
  );
}

const st = StyleSheet.create({
  h1: { fontSize: 28, fontWeight: '800', color: colors.text },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: space.s },
  backText: { fontSize: 15, fontWeight: '700', color: colors.text },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 42, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 14.5, color: colors.text, paddingVertical: 0 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: space.m, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  sub: { fontSize: 12, color: colors.muted, lineHeight: 17, marginTop: 2 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: colors.muted, textTransform: 'uppercase', marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.sunken, overflow: 'hidden', marginTop: 10 },
  fill: { height: '100%', borderRadius: 4 },
});
