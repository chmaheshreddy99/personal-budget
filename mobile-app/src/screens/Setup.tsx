/** First run (or signed out): the server's address (an ngrok URL, or the home network's), and signing in. */
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { CheckCircle2, Globe, LogIn, ServerCrash, Wifi } from 'lucide-react-native';
import { useApp } from '../state';
import { ping } from '../data';
import { Button, Card, Field, GradientPanel, IconBubble } from '../ui';
import { colors, space } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function SetupScreen() {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState(app.settings.serverUrl);
  const [user, setUser] = useState(app.settings.username || '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [reach, setReach] = useState<boolean | null>(null);
  const [error, setError] = useState('');

  const test = async () => {
    setTesting(true); setError('');
    const ok = await ping(url);
    setReach(ok);
    setTesting(false);
  };
  const go = async () => {
    if (!url.trim() || !user.trim() || !password) { setError('Enter the server address, your username and password'); return; }
    setBusy(true); setError('');
    try { await app.signIn(url, user, password); } catch (e: any) { setError(e.message || 'Could not sign in'); } finally { setBusy(false); }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.l, paddingTop: insets.top + space.l, gap: space.l }} keyboardShouldPersistTaps="handled">
      <GradientPanel style={{ paddingVertical: space.xl }}>
        <View style={st.logo}><Text style={st.logoText}>₹</Text></View>
        <Text style={st.title}>Personal Budget</Text>
        <Text style={st.sub}>Your accounts and expenses in your pocket, even offline. Connect to your Personal Budget server to begin.</Text>
      </GradientPanel>
      <Card style={{ gap: space.m }}>
        <Field label="Server address" value={url} onChangeText={t => { setUrl(t); setReach(null); }} autoCapitalize="none" autoCorrect={false}
          keyboardType="url" placeholder="https://your-name.ngrok-free.app" hint="The ngrok URL, or http://192.168.x.x:8080 on the same Wi-Fi" />
        <View style={st.testRow}>
          <Button title="Test connection" kind="soft" Icon={Wifi} onPress={test} busy={testing} style={{ flex: 1 }} />
          {reach !== null ? (
            <View style={st.reach}>
              <IconBubble Icon={reach ? CheckCircle2 : ServerCrash} fg={reach ? colors.green : colors.red} bg={reach ? colors.greenSoft : colors.redSoft} size={34} />
              <Text style={[st.reachText, { color: reach ? colors.green : colors.red }]}>{reach ? 'Reachable' : 'Not reachable'}</Text>
            </View>
          ) : null}
        </View>
        <Field label="Username" value={user} onChangeText={setUser} autoCapitalize="none" autoCorrect={false} placeholder="admin" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••" onSubmitEditing={go} />
        {error ? <Text style={st.error}>{error}</Text> : null}
        <Button title="Sign in" Icon={LogIn} onPress={go} busy={busy} />
      </Card>
      <View style={st.note}>
        <Globe color={colors.muted} size={14} />
        <Text style={st.noteText}>Only the address and a sign-in token are kept on this phone, never your password.</Text>
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  logo: { width: 56, height: 56, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center', marginBottom: space.m },
  logoText: { color: colors.white, fontSize: 30, fontWeight: '800' },
  title: { color: colors.white, fontSize: 26, fontWeight: '800' },
  sub: { color: 'rgba(255,255,255,0.85)', fontSize: 14, lineHeight: 20, marginTop: 6 },
  testRow: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  reach: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reachText: { fontWeight: '700', fontSize: 13 },
  error: { color: colors.red, fontSize: 13, fontWeight: '600' },
  note: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingHorizontal: space.s },
  noteText: { color: colors.muted, fontSize: 12, flex: 1 },
});
