/**
 * Signing in. The server's address is asked once (an ngrok URL, or the home network's) and kept: from then on only the username and password
 * are asked, with the saved address shown small and a "Change" link for the day the server moves. After the first sign-in the app opens with
 * the phone's own lock (pattern, PIN, password or fingerprint), so the password is typed only when the sign-in has expired.
 */
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArrowRight, CheckCircle2, LogIn, Lock, Server, ServerCrash, ShieldCheck, Wifi } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state';
import { normalizeUrl, ping } from '../data';
import { Button, Field, GradientPanel } from '../ui';
import { colors, radius, space } from '../theme';

const host = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/+$/, '');

export function SetupScreen() {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const saved = app.settings.serverUrl;
  const [url, setUrl] = useState(saved);
  const [changing, setChanging] = useState(false);
  const [connected, setConnected] = useState(false);   // the address was reached in this visit: on to the sign-in
  const [user, setUser] = useState(app.settings.username || '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [reach, setReach] = useState<boolean | null>(null);
  const [error, setError] = useState('');

  // the address is asked only when there is none (the first time) or when the person chose to change it
  const askUrl = (!saved || changing) && !connected;

  const connect = async () => {
    if (!url.trim()) { setError('Enter the server address'); return; }
    setTesting(true); setError('');
    const ok = await ping(url);
    setReach(ok);
    setTesting(false);
    if (ok) setConnected(true); else setError('That address did not answer. Check it, and that the server is running.');
  };
  const go = async () => {
    if (!user.trim() || !password) { setError('Enter your username and password'); return; }
    setBusy(true); setError('');
    try { await app.signIn(connected || changing ? url : saved, user, password); } catch (e: any) { setError(e.message || 'Could not sign in'); } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <GradientPanel from={colors.navy} to={colors.ocean} style={[st.hero, { paddingTop: insets.top + space.xl }]}>
          <View style={st.logo}><Text style={st.logoText}>₹</Text></View>
          <Text style={st.title}>Personal Budget</Text>
          <Text style={st.sub}>{askUrl ? 'Connect to your server to begin.' : saved ? 'Welcome back' : 'Sign in'}</Text>
        </GradientPanel>

        <View style={[st.card, { marginBottom: insets.bottom + space.l }]}>
          {askUrl ? (
            <>
              <Text style={st.h}>Your server</Text>
              <Text style={st.p}>Asked only once: the app remembers it. It is the address you open Personal Budget at.</Text>
              <Field label="Server address" value={url} onChangeText={t => { setUrl(t); setReach(null); setError(''); }} autoCapitalize="none" autoCorrect={false}
                keyboardType="url" placeholder="https://your-name.ngrok-free.app" hint="The ngrok URL, or http://192.168.x.x:8080 on the same Wi-Fi" onSubmitEditing={connect} />
              {reach === false ? <View style={st.bad}><ServerCrash color={colors.red} size={16} /><Text style={st.badText}>Not reachable</Text></View> : null}
              {error ? <Text style={st.error}>{error}</Text> : null}
              <Button title="Connect" Icon={Wifi} onPress={connect} busy={testing} />
              {saved ? <Pressable onPress={() => { setChanging(false); setUrl(saved); setError(''); }} hitSlop={8}><Text style={st.link}>Keep {host(saved)}</Text></Pressable> : null}
            </>
          ) : (
            <>
              <Pressable style={st.server} onPress={() => { setChanging(true); setConnected(false); setUrl(saved || url); setReach(null); setError(''); }}>
                <View style={st.serverIcon}>{connected ? <CheckCircle2 color={colors.green} size={16} /> : <Server color={colors.ocean} size={16} />}</View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={st.serverLabel}>{connected ? 'Connected to' : 'Server'}</Text>
                  <Text style={st.serverHost} numberOfLines={1}>{host(connected || changing ? normalizeUrl(url) : saved)}</Text>
                </View>
                <Text style={st.change}>Change</Text>
              </Pressable>
              <Text style={st.h}>Sign in</Text>
              <Field label="Username" value={user} onChangeText={setUser} autoCapitalize="none" autoCorrect={false} placeholder="admin" returnKeyType="next" />
              <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••" onSubmitEditing={go} />
              {error ? <Text style={st.error}>{error}</Text> : null}
              <Button title="Sign in" Icon={LogIn} onPress={go} busy={busy} />
              <View style={st.note}>
                <ShieldCheck color={colors.green} size={16} />
                <Text style={st.noteText}>After this, the app opens with your phone's own lock (pattern, PIN, password or fingerprint). Your password is never kept on the phone.</Text>
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  hero: { borderRadius: 0, borderBottomLeftRadius: 36, borderBottomRightRadius: 36, paddingBottom: 64, alignItems: 'center' },
  logo: { width: 68, height: 68, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center', marginBottom: space.m,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  logoText: { color: colors.white, fontSize: 36, fontWeight: '800' },
  title: { color: colors.white, fontSize: 28, fontWeight: '800', letterSpacing: 0.2 },
  sub: { color: 'rgba(255,255,255,0.85)', fontSize: 15, marginTop: 4 },
  card: { marginHorizontal: space.l, marginTop: -44, backgroundColor: colors.card, borderRadius: radius.xl, padding: space.l + 2, gap: space.m,
    shadowColor: '#0b2038', shadowOpacity: 0.14, shadowRadius: 22, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  h: { fontSize: 20, fontWeight: '800', color: colors.text },
  p: { fontSize: 13.5, color: colors.text2, lineHeight: 19, marginTop: -6 },
  server: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.m, backgroundColor: colors.sunken },
  serverIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  serverLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.6, color: colors.muted, textTransform: 'uppercase' },
  serverHost: { fontSize: 14, fontWeight: '700', color: colors.text },
  change: { fontSize: 13, fontWeight: '700', color: colors.ocean, paddingHorizontal: 6 },
  bad: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badText: { color: colors.red, fontWeight: '700', fontSize: 13 },
  error: { color: colors.red, fontSize: 13, fontWeight: '600' },
  link: { color: colors.ocean, fontWeight: '700', fontSize: 13.5, textAlign: 'center' },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 10, borderRadius: radius.m, backgroundColor: colors.greenSoft },
  noteText: { color: colors.text2, fontSize: 12, flex: 1, lineHeight: 17 },
});
