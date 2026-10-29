/**
 * The app is locked: the phone's own lock (pattern, PIN, password or fingerprint, whichever the person set up) opens it. It asks as soon as the
 * screen shows; nothing of the person's money is on screen until it passes. "Use my password instead" signs out, so the sign-in screen asks for
 * the password (the saved server address stays).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Fingerprint, LockKeyhole } from 'lucide-react-native';
import { useApp } from '../state';
import { Button, GradientPanel } from '../ui';
import { colors, space } from '../theme';

export function LockScreen() {
  const app = useApp();
  const [denied, setDenied] = useState(false);
  const asking = useRef(false);

  const ask = useCallback(async () => {
    if (asking.current) return;
    asking.current = true;
    setDenied(false);
    const ok = await app.unlock();
    asking.current = false;
    if (!ok) setDenied(true);
  }, [app]);

  useEffect(() => { const t = setTimeout(ask, 250); return () => clearTimeout(t); }, [ask]);

  return (
    <GradientPanel from={colors.navy} to={colors.ocean} style={st.wrap}>
      <View style={st.body}>
        <View style={st.icon}><LockKeyhole color={colors.white} size={34} /></View>
        <Text style={st.title}>Personal Budget</Text>
        <Text style={st.sub}>{app.settings.userName || app.settings.username ? `Welcome back, ${app.settings.userName || app.settings.username}` : 'Welcome back'}</Text>
        <Text style={st.hint}>{denied ? 'Not unlocked. Try again with your pattern, PIN, password or fingerprint.' : 'Unlock with your phone lock'}</Text>
        <Button title="Unlock" Icon={Fingerprint} onPress={ask} style={st.btn} />
        <Pressable onPress={() => app.signOut()} hitSlop={10}><Text style={st.link}>Use my password instead</Text></Pressable>
      </View>
    </GradientPanel>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, borderRadius: 0, justifyContent: 'center' },
  body: { alignItems: 'center', gap: space.m, padding: space.xl },
  icon: { width: 76, height: 76, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  title: { color: colors.white, fontSize: 28, fontWeight: '800' },
  sub: { color: 'rgba(255,255,255,0.9)', fontSize: 16 },
  hint: { color: 'rgba(255,255,255,0.75)', fontSize: 13.5, textAlign: 'center', marginTop: space.s },
  btn: { alignSelf: 'stretch', marginTop: space.m, minWidth: 220, backgroundColor: 'rgba(255,255,255,0.18)', borderColor: 'rgba(255,255,255,0.35)' },
  link: { color: 'rgba(255,255,255,0.85)', fontWeight: '700', fontSize: 13.5, marginTop: space.m },
});
