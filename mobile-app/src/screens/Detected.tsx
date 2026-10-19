/**
 * Bank SMS that read like money going out, caught as they arrived (also while the app was closed) or found in the
 * inbox: each with what was understood (amount, account, shop, reference, date) to record as an expense in one tap,
 * or to dismiss. The top shows whether Android lets the app read SMS (an app installed from an APK must first be
 * allowed "restricted settings"), and an SMS can be pasted to see what the app reads from it.
 */
import React, { useEffect, useState } from 'react';
import { BackHandler, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AlertTriangle, ArrowLeft, BellRing, Check, CheckCircle2, ClipboardPaste, Inbox, MessageSquareText, ScanSearch, Settings2, X, XCircle } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state';
import { ParsedSms } from '../sms';
import { date, money } from '../format';
import { nativeSettings, smsSupported } from '../native';
import { AccountBubble, Button, Card, Empty, GradientPanel, Pill } from '../ui';
import { colors, radius, space } from '../theme';

export function DetectedScreen({ onRecord, onBack }: { onRecord: (p: ParsedSms) => void; onBack?: () => void }) {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const [scanning, setScanning] = useState<number | null>(null);
  const [paste, setPaste] = useState('');
  const [tester, setTester] = useState(false);
  const accounts = app.snapshot?.accounts || [];
  const cats = app.snapshot?.categories || [];
  const p = app.perms;
  const blocked = smsSupported && app.settings.smsEnabled && p && (!p.receive || !p.read);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { app.checkPerms(); }, []);
  useEffect(() => {
    if (!onBack) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => sub.remove();
  }, [onBack]);

  const scan = async (days: number) => {
    setScanning(days);
    try {
      const n = await app.scanInbox(days);
      app.notify(n ? `${n} bank SMS found` : `No new debit SMS in the last ${days} days`);
    } catch (e: any) {
      app.notify(e.message || 'Could not read the SMS');
    } finally { setScanning(null); }
  };

  const tried = paste.trim() ? app.readSms(paste.trim()) : null;

  return (
    <FlatList
      data={app.detected}
      keyExtractor={x => x.sms.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: space.l, paddingTop: insets.top + space.m, paddingBottom: 120, gap: space.s }}
      ListHeaderComponent={
        <View style={{ gap: space.m, marginBottom: space.s }}>
          {onBack ? <Pressable onPress={onBack} style={st.back} hitSlop={12}><ArrowLeft color={colors.text} size={20} /><Text style={st.backText}>More</Text></Pressable> : null}
          <GradientPanel from={colors.navy} to="#1b6a8f">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <MessageSquareText color={colors.white} size={22} />
              <Text style={st.title}>Bank SMS</Text>
            </View>
            <Text style={st.sub}>{app.settings.smsEnabled
              ? 'Debit SMS from Indian banks and cards (UPI, card, ATM, IMPS/NEFT, auto-debit) are caught, even when the app is closed, and offered here to record with the details filled in.'
              : 'Turn on detection to be asked to record an expense whenever your bank sends a debit SMS.'}</Text>
            {smsSupported && p ? (
              <View style={st.perms}>
                <Perm ok={p.receive} text="Receive SMS" />
                <Perm ok={p.read} text="Read inbox" />
                <Perm ok={p.notify} text="Notifications" />
              </View>
            ) : null}
          </GradientPanel>

          {blocked ? (
            <Card style={st.warn}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <AlertTriangle color={colors.coral} size={18} />
                <Text style={st.warnTitle}>Android has not let the app read SMS</Text>
              </View>
              <Text style={st.warnText}>Apps installed from an APK file need one extra step on Android 13 and later:</Text>
              <Text style={st.step}>1. Press <Text style={st.b}>Open app settings</Text> below.</Text>
              <Text style={st.step}>2. Tap the <Text style={st.b}>⋮</Text> menu (top right) → <Text style={st.b}>Allow restricted settings</Text> and confirm.</Text>
              <Text style={st.step}>3. Open <Text style={st.b}>Permissions → SMS</Text> and choose <Text style={st.b}>Allow</Text>; allow <Text style={st.b}>Notifications</Text> too.</Text>
              <Text style={st.step}>4. Come back here and press <Text style={st.b}>Ask again</Text>.</Text>
              <Text style={st.warnText}>On some phones (Xiaomi, Realme, Oppo, Vivo) also allow <Text style={st.b}>Autostart</Text> and set battery to <Text style={st.b}>No restrictions</Text> so SMS are caught while the app is closed.</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button title="Open app settings" Icon={Settings2} onPress={() => nativeSettings.openApp()} style={{ flex: 1.3 }} />
                <Button title="Ask again" kind="soft" onPress={() => app.enableSms(true)} style={{ flex: 1 }} />
              </View>
            </Card>
          ) : null}

          {!smsSupported ? <Card><Text style={st.muted}>Reading SMS works on Android only.</Text></Card>
            : !app.settings.smsEnabled ? <Button title="Turn on SMS detection" Icon={BellRing} onPress={() => app.enableSms(true)} />
            : (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button title="Scan 7 days" Icon={ScanSearch} kind="soft" onPress={() => scan(7)} busy={scanning === 7} style={{ flex: 1 }} />
                <Button title="Scan 30 days" Icon={ScanSearch} kind="soft" onPress={() => scan(30)} busy={scanning === 30} style={{ flex: 1 }} />
              </View>
            )}

          <Pressable onPress={() => setTester(t => !t)} style={st.testerHead}>
            <ClipboardPaste color={colors.ocean} size={16} />
            <Text style={st.testerTitle}>Test an SMS</Text>
            <Text style={st.muted}>· paste a bank SMS to see what is read</Text>
          </Pressable>
          {tester ? (
            <Card style={{ gap: 10 }}>
              <TextInput value={paste} onChangeText={setPaste} multiline placeholder="Paste the SMS text here" placeholderTextColor={colors.muted} style={st.paste} />
              {paste.trim() ? (tried ? (
                <View style={{ gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <CheckCircle2 color={colors.green} size={16} />
                    <Text style={[st.testerTitle, { color: colors.green }]}>Read as {money(tried.amount)} going out</Text>
                  </View>
                  <Facts p={tried} />
                  <Button title="Record this expense" Icon={Check} onPress={() => { onRecord(tried); setPaste(''); }} />
                </View>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <XCircle color={colors.muted} size={16} />
                  <Text style={st.muted}>Not read as money going out (credits, OTPs, reminders, failed and declined payments are left alone).</Text>
                </View>
              )) : null}
            </Card>
          ) : null}
        </View>
      }
      ListEmptyComponent={<Empty Icon={Inbox} title="Nothing to record" text={app.settings.smsEnabled ? 'New debit SMS from your bank will show up here. Scan the inbox to find earlier ones.' : undefined} />}
      renderItem={({ item: x }) => {
        const acc = accounts.find(a => a.id === x.accountId);
        return (
          <Card style={{ gap: 10 }}>
            <View style={st.top}>
              <Text style={st.amount}>{money(x.amount)}</Text>
              <View style={{ flex: 1 }} />
              <Pill text={date(x.date)} />
            </View>
            <Facts p={x} />
            {acc ? (
              <View style={st.acc}><AccountBubble type={acc.type} size={26} /><Text style={st.accText}>{acc.name}</Text></View>
            ) : <Text style={st.muted}>The account could not be matched: pick it when recording.</Text>}
            <Text style={st.body} numberOfLines={3}>{x.sms.sender} · {x.sms.body}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="Dismiss" kind="ghost" Icon={X} onPress={() => app.dismissSms([x.sms.id])} />
              <Button title="Record expense" Icon={Check} onPress={() => onRecord(x)} style={{ flex: 1 }} />
            </View>
          </Card>
        );
      }}
    />
  );

  function Facts({ p: f }: { p: ParsedSms }) {
    const cat = cats.find(c => c.id === f.categoryId);
    return (
      <View style={st.facts}>
        {f.merchant ? <Pill text={f.merchant} fg={colors.ocean} bg={colors.oceanSoft} /> : null}
        {f.bank || f.last4 ? <Pill text={`${f.bank || 'Account'}${f.card ? ' card' : ''}${f.last4 ? ` •• ${f.last4}` : ''}`} /> : null}
        {f.mode ? <Pill text={f.mode} fg={colors.aqua} bg={colors.aquaSoft} /> : null}
        {f.reference ? <Pill text={`Ref ${f.reference}`} /> : null}
        {cat ? <Pill text={cat.name} fg={colors.violet} bg={colors.violetSoft} /> : null}
      </View>
    );
  }
}

function Perm({ ok, text }: { ok: boolean; text: string }) {
  return (
    <View style={st.perm}>
      {ok ? <CheckCircle2 color="#a8e3c2" size={13} /> : <XCircle color="#ffb4a0" size={13} />}
      <Text style={[st.permText, { color: ok ? '#a8e3c2' : '#ffb4a0' }]}>{text}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backText: { fontSize: 15, fontWeight: '700', color: colors.text },
  title: { color: colors.white, fontSize: 20, fontWeight: '800' },
  sub: { color: 'rgba(255,255,255,0.82)', fontSize: 13, lineHeight: 19, marginTop: 8 },
  perms: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: space.m },
  perm: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  permText: { fontSize: 12, fontWeight: '700' },
  warn: { gap: 6, borderColor: colors.coralSoft, backgroundColor: '#fff9f5' },
  warnTitle: { fontSize: 14.5, fontWeight: '800', color: colors.coral, flexShrink: 1 },
  warnText: { fontSize: 12.5, color: colors.text2, lineHeight: 18 },
  step: { fontSize: 13, color: colors.text, lineHeight: 19, paddingLeft: 4 },
  b: { fontWeight: '800' },
  muted: { color: colors.muted, fontSize: 12.5, flexShrink: 1 },
  testerHead: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  testerTitle: { fontSize: 13.5, fontWeight: '800', color: colors.ocean },
  paste: { minHeight: 90, borderRadius: radius.m, borderWidth: 1, borderColor: colors.line, padding: 10, fontSize: 13, color: colors.text, textAlignVertical: 'top', backgroundColor: colors.sunken },
  top: { flexDirection: 'row', alignItems: 'center' },
  amount: { fontSize: 24, fontWeight: '800', color: colors.red },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  acc: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  accText: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  body: { fontSize: 12, color: colors.text2, lineHeight: 17, backgroundColor: colors.sunken, padding: 8, borderRadius: 8 },
});
