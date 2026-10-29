/**
 * Signing in. The server's address is asked once (ServerStep) and kept; after that only the username and password
 * are asked (LoginScreen), with the address tucked under "Change server". With quick unlock set up, the lock screen
 * comes first and the password is the fallback.
 */
import React, { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowRight, CheckCircle2, Eye, EyeOff, Grid3x3, Lock, Server, ServerCrash, ShieldCheck, User, Wifi } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state';
import { normalizeUrl, ping } from '../data';
import { BrandMark, Button, GradientPanel } from '../ui';
import { colors, radius, space } from '../theme';

/** The first run: where the server is (an ngrok URL, or the home network's). */
export function ServerStep({ onSaved }: { onSaved: (url: string) => void }) {
  const app = useApp();
  const [url, setUrl] = useState(app.settings.serverUrl || '');
  const [busy, setBusy] = useState(false);
  const [reach, setReach] = useState<boolean | null>(null);
  const go = async () => {
    if (!url.trim()) { setReach(false); return; }
    setBusy(true);
    const ok = await ping(url);
    setReach(ok);
    setBusy(false);
    if (ok) { await app.saveSettings({ serverUrl: normalizeUrl(url) }); onSaved(normalizeUrl(url)); }
  };
  return (
    <AuthFrame title="Connect your server" sub="Once only: the app remembers it. Your accounts stay on your own Personal Budget server.">
      <InputRow Icon={Server} value={url} onChangeText={t => { setUrl(t); setReach(null); }} placeholder="https://your-name.ngrok-free.app"
        keyboardType="url" autoCapitalize="none" autoCorrect={false} onSubmitEditing={go} returnKeyType="go" />
      <Text style={st.hint}>The ngrok address, or http://192.168.x.x:8080 on the same Wi-Fi</Text>
      {reach !== null ? (
        <View style={[st.reach, { backgroundColor: reach ? colors.greenSoft : colors.redSoft }]}>
          {reach ? <CheckCircle2 color={colors.green} size={16} /> : <ServerCrash color={colors.red} size={16} />}
          <Text style={[st.reachText, { color: reach ? colors.green : colors.red }]}>{reach ? 'Connected' : 'The server cannot be reached at that address'}</Text>
        </View>
      ) : null}
      <Button title="Continue" Icon={busy ? undefined : ArrowRight} onPress={go} busy={busy} />
    </AuthFrame>
  );
}

/** Username and password; the address only on request. */
export function LoginScreen({ onChangeServer, onQuick }: { onChangeServer: () => void; onQuick?: () => void }) {
  const app = useApp();
  const [user, setUser] = useState(app.settings.username || '');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    if (!user.trim() || !password) { setError('Enter your username and password'); return; }
    setBusy(true); setError('');
    try { await app.signIn(app.settings.serverUrl, user, password); } catch (e: any) { setError(e.message || 'Could not sign in'); } finally { setBusy(false); }
  };
  const host = app.settings.serverUrl.replace(/^https?:\/\//, '');
  const returning = !!app.settings.username;
  return (
    <AuthFrame title={returning ? `Welcome back${app.settings.userName ? `, ${app.settings.userName.split(' ')[0]}` : ''}` : 'Sign in'}
      sub={returning ? 'Enter your password to continue.' : 'Use the username and password of your Personal Budget account.'}>
      <InputRow Icon={User} value={user} onChangeText={setUser} placeholder="Username" autoCapitalize="none" autoCorrect={false} returnKeyType="next" />
      <InputRow Icon={Lock} value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry={!show} onSubmitEditing={go} returnKeyType="go"
        autoFocus={returning} right={<Pressable onPress={() => setShow(v => !v)} hitSlop={10}>{show ? <EyeOff color={colors.muted} size={18} /> : <Eye color={colors.muted} size={18} />}</Pressable>} />
      {error ? <Text style={st.error}>{error}</Text> : null}
      <Button title="Sign in" Icon={ArrowRight} onPress={go} busy={busy} />
      {onQuick ? (
        <Pressable onPress={onQuick} style={st.alt} hitSlop={8}>
          <Grid3x3 color={colors.ocean} size={16} />
          <Text style={st.altText}>Use {app.settings.quick?.kind === 'PIN' ? 'PIN' : 'pattern'} instead</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={onChangeServer} style={st.server} hitSlop={8}>
        <Wifi color={colors.muted} size={13} />
        <Text style={st.serverText} numberOfLines={1}>{host}</Text>
        <Text style={st.change}>Change server</Text>
      </Pressable>
    </AuthFrame>
  );
}

/** The sign-in frame: the brand on a deep gradient, a white sheet with the form. */
function AuthFrame({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.navy }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" bounces={false}>
        <GradientPanel square style={[st.top, { paddingTop: insets.top + space.xl }]}>
          <BrandMark size={60} />
          <Text style={st.brand}>Personal Budget</Text>
          <Text style={st.tag}>Your money, in your pocket · works offline</Text>
        </GradientPanel>
        <View style={[st.sheet, { paddingBottom: insets.bottom + space.xl }]}>
          <Text style={st.title}>{title}</Text>
          <Text style={st.sub}>{sub}</Text>
          <View style={{ gap: space.m, marginTop: space.l }}>{children}</View>
          <View style={{ flex: 1 }} />
          <View style={st.note}>
            <ShieldCheck color={colors.muted} size={14} />
            <Text style={st.noteText}>Your password is never kept on this phone, only a sign-in token.</Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function InputRow({ Icon, right, ...props }: React.ComponentProps<typeof TextInput> & { Icon: any; right?: React.ReactNode }) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={[st.input, focus && st.inputFocus]}>
      <Icon color={focus ? colors.ocean : colors.muted} size={18} />
      <TextInput placeholderTextColor={colors.muted} style={st.inputText} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} {...props} />
      {right}
    </View>
  );
}

const st = StyleSheet.create({
  top: { alignItems: 'center', paddingBottom: 56, gap: 6 },
  brand: { color: colors.white, fontSize: 26, fontWeight: '800', marginTop: space.m, letterSpacing: 0.2 },
  tag: { color: 'rgba(255,255,255,0.72)', fontSize: 13.5 },
  sheet: { flex: 1, backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, marginTop: -28, padding: space.xl },
  title: { fontSize: 23, fontWeight: '800', color: colors.text },
  sub: { fontSize: 14, color: colors.text2, marginTop: 4, lineHeight: 20 },
  input: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 54, borderRadius: radius.l, borderWidth: 1.5, borderColor: colors.line,
    backgroundColor: colors.card, paddingHorizontal: 14 },
  inputFocus: { borderColor: colors.ocean, shadowColor: colors.ocean, shadowOpacity: 0.15, shadowRadius: 8, elevation: 2 },
  inputText: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 0 },
  hint: { fontSize: 12, color: colors.muted, marginTop: -4, marginLeft: 4 },
  reach: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: radius.m },
  reachText: { fontSize: 13, fontWeight: '700', flex: 1 },
  error: { color: colors.red, fontSize: 13.5, fontWeight: '600' },
  alt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 6 },
  altText: { color: colors.ocean, fontWeight: '800', fontSize: 14.5 },
  server: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: space.s },
  serverText: { color: colors.muted, fontSize: 12.5, maxWidth: 190 },
  change: { color: colors.ocean, fontSize: 12.5, fontWeight: '800' },
  note: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', marginTop: space.xl },
  noteText: { color: colors.muted, fontSize: 12 },
});
