/**
 * Signing in: the server's address (an ngrok address, or http://192.168.x.x:8080 on the yard's Wi-Fi) and the usual
 * username and password. The server opens a Bricks app session: only the screens the web app gives this user.
 */
import React, { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CircleAlert, Eye, EyeOff, LogIn, Server, Wifi } from 'lucide-react-native';
import { normalizeUrl, ping } from '../api';
import { useApp } from '../state';
import { colors, radius, space } from '../theme';
import { Banner, Button, Field } from '../ui';
import { BrandMark, useBrandName } from './common';

export function LoginScreen() {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const brand = useBrandName('Bricks');
  const [server, setServer] = useState(app.session.server);
  const [username, setUsername] = useState(app.session.username);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<'test' | 'login' | null>(null);
  const [msg, setMsg] = useState<{ text: string; good?: boolean } | null>(null);

  const test = async () => {
    if (!server.trim()) { setMsg({ text: 'Enter the server address first' }); return; }
    setBusy('test'); setMsg(null);
    const ok = await ping(normalizeUrl(server));
    setBusy(null);
    setMsg(ok ? { text: 'The server answers', good: true } : { text: 'No answer from that address. Check it, and that the phone has internet or is on the yard’s Wi-Fi.' });
  };

  const signIn = async () => {
    if (!server.trim() || !username.trim() || !password) { setMsg({ text: 'Enter the server address, your username and password' }); return; }
    setBusy('login'); setMsg(null);
    try {
      await app.signIn(normalizeUrl(server), username.trim(), password);
    } catch (e: any) {
      setMsg({ text: e?.message || 'Could not sign in' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.ink }}>
      <StatusBar barStyle="light-content" backgroundColor={colors.ink} />
      <ScrollView contentContainerStyle={[ls.wrap, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <View style={ls.brand}>
          <BrandMark size={104} />
          <Text style={ls.name} numberOfLines={2}>{brand}</Text>
          <Text style={ls.tag}>Grey blocks · production, orders and deliveries</Text>
        </View>
        <View style={ls.card}>
          <Text style={ls.cardTitle}>Sign in</Text>
          <Field label="Server address" value={server} onChangeText={setServer} placeholder="https://yourname.ngrok-free.app" autoCapitalize="none"
            autoCorrect={false} keyboardType="url" hint="As your admin gave it (web app: Settings → Bricks app)" />
          <Field label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} placeholder="Your username" />
          <View>
            <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry={!show} autoCapitalize="none" placeholder="Your password"
              onSubmitEditing={signIn} returnKeyType="go" />
            <Pressable onPress={() => setShow(!show)} hitSlop={10} style={ls.eye}>
              {show ? <EyeOff color={colors.muted} size={19} /> : <Eye color={colors.muted} size={19} />}
            </Pressable>
          </View>
          {msg ? <Banner Icon={msg.good ? Wifi : CircleAlert} tone={msg.good ? 'good' : 'bad'} text={msg.text} /> : null}
          <Button title="Sign in" Icon={LogIn} busy={busy === 'login'} onPress={signIn} />
          <Button title="Test the address" Icon={Server} kind="ghost" busy={busy === 'test'} onPress={test} />
        </View>
        <Text style={ls.foot}>You see only the screens your admin gave you in the web app.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const ls = StyleSheet.create({
  wrap: { paddingHorizontal: space.l, gap: space.xl },
  brand: { alignItems: 'center', gap: 8 },
  name: { color: colors.white, fontSize: 30, fontWeight: '900', letterSpacing: 0.5, marginTop: 6, textAlign: 'center' },
  tag: { color: '#aab3bc', fontSize: 13.5 },
  card: { backgroundColor: colors.bg, borderRadius: radius.xl, padding: space.l, gap: space.m },
  cardTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  eye: { position: 'absolute', right: 14, top: 37 },
  foot: { color: '#8a949f', fontSize: 12, textAlign: 'center' },
});
