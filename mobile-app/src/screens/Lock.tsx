/**
 * Quick unlock: a 3 × 3 pattern or a 4–6 digit PIN, the way the phone itself unlocks. The app signs in as soon as the
 * pattern is drawn (finger lifted) or the last digit is typed: no button to press.
 *
 *   LockScreen         the app is locked: draw the pattern / type the PIN, or use the password instead
 *   QuickSetupScreen   right after signing in with the password: choose a pattern or a PIN (twice), or skip
 *   PatternPad, PinPad the two inputs
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, PanResponder, Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { Delete, Grid3x3, KeyRound, Lock, LogIn, ShieldCheck } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state';
import { BrandMark, GradientPanel } from '../ui';
import { colors, space } from '../theme';

// ===================================================================== the pattern

const DOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

/** A 3 × 3 pattern; onDone gets "0-1-2-5" when the finger lifts (at least 4 dots). tone: the line's colour. */
export function PatternPad({ onDone, size = 280, tone = colors.white, error = false, disabled = false }:
  { onDone: (code: string) => void; size?: number; tone?: string; error?: boolean; disabled?: boolean }) {
  const [path, setPath] = useState<number[]>([]);
  const [finger, setFinger] = useState<{ x: number; y: number } | null>(null);
  const box = useRef<View>(null);
  const origin = useRef({ x: 0, y: 0 });
  const pathRef = useRef<number[]>([]);
  const off = useRef(disabled);
  off.current = disabled;
  const cell = size / 3;
  const centre = (i: number) => ({ x: (i % 3) * cell + cell / 2, y: Math.floor(i / 3) * cell + cell / 2 });

  const hit = (x: number, y: number) => {
    const col = Math.floor(x / cell), row = Math.floor(y / cell);
    if (col < 0 || col > 2 || row < 0 || row > 2) return -1;
    const i = row * 3 + col;
    const c = centre(i);
    return Math.hypot(c.x - x, c.y - y) < cell * 0.36 ? i : -1;
  };
  const add = (i: number) => {
    const p = pathRef.current;
    if (i < 0 || p.includes(i)) return;
    // passing straight over a dot between two picks it up too, as phones do
    const last = p[p.length - 1];
    if (last !== undefined) {
      const mid = (last + i) / 2;
      if (Number.isInteger(mid) && Math.abs((last % 3) - (i % 3)) !== 1 && Math.abs(Math.floor(last / 3) - Math.floor(i / 3)) !== 1 && !p.includes(mid)) p.push(mid);
    }
    p.push(i);
    Vibration.vibrate(8);
    setPath([...p]);
  };
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !off.current,
    onMoveShouldSetPanResponder: () => !off.current,
    onPanResponderGrant: e => {
      pathRef.current = [];
      setPath([]);
      box.current?.measure((_x, _y, _w, _h, px, py) => { origin.current = { x: px, y: py }; });
      const { locationX, locationY } = e.nativeEvent;
      add(hit(locationX, locationY));
    },
    onPanResponderMove: e => {
      const x = e.nativeEvent.pageX - origin.current.x, y = e.nativeEvent.pageY - origin.current.y;
      setFinger({ x, y });
      add(hit(x, y));
    },
    onPanResponderRelease: () => {
      setFinger(null);
      const p = pathRef.current;
      if (p.length) onDoneRef.current(p.join('-'));
      setTimeout(() => { pathRef.current = []; setPath([]); }, 350);
    },
  })).current;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const ink = error ? '#ff8a80' : tone;
  const last = path.length ? centre(path[path.length - 1]) : null;
  return (
    <View ref={box} style={{ width: size, height: size }} {...responder.panHandlers}>
      <Svg width={size} height={size}>
        {path.slice(1).map((d, k) => {
          const a = centre(path[k]), b = centre(d);
          return <Line key={k} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={ink} strokeWidth={5} strokeLinecap="round" opacity={0.75} />;
        })}
        {last && finger ? <Line x1={last.x} y1={last.y} x2={finger.x} y2={finger.y} stroke={ink} strokeWidth={4} strokeLinecap="round" opacity={0.45} /> : null}
        {DOTS.map(i => {
          const c = centre(i);
          const on = path.includes(i);
          return (
            <React.Fragment key={i}>
              {on ? <Circle cx={c.x} cy={c.y} r={cell * 0.22} fill={ink} opacity={0.18} /> : null}
              <Circle cx={c.x} cy={c.y} r={on ? 9 : 6} fill={on ? ink : tone} opacity={on ? 1 : 0.55} />
            </React.Fragment>
          );
        })}
      </Svg>
    </View>
  );
}

// ===================================================================== the PIN

/** Dots for the digits typed and a keypad; onDone gets the PIN once `length` digits are in (or Enter when no length). */
export function PinPad({ length, onDone, tone = colors.white, error = false, disabled = false }:
  { length?: number; onDone: (pin: string) => void; tone?: string; error?: boolean; disabled?: boolean }) {
  const [pin, setPin] = useState('');
  const max = length || 6;
  useEffect(() => { if (error) setPin(''); }, [error]);
  const press = (d: string) => {
    if (disabled) return;
    Vibration.vibrate(6);
    if (d === 'del') { setPin(p => p.slice(0, -1)); return; }
    if (d === 'ok') { if (pin.length >= 4) { onDone(pin); setPin(''); } return; }
    const next = (pin + d).slice(0, max);
    setPin(next);
    if (length && next.length === length) setTimeout(() => { onDone(next); setPin(''); }, 120);
  };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', length ? '' : 'ok', '0', 'del'];
  return (
    <View style={{ alignItems: 'center', gap: space.l }}>
      <View style={st.pinDots}>
        {Array.from({ length: max }).map((_, i) => (
          <View key={i} style={[st.pinDot, { borderColor: error ? '#ff8a80' : tone }, i < pin.length && { backgroundColor: error ? '#ff8a80' : tone }]} />
        ))}
      </View>
      <View style={st.keypad}>
        {keys.map((k, i) => k === '' ? <View key={i} style={st.key} /> : (
          <Pressable key={i} onPress={() => press(k)} style={({ pressed }) => [st.key, { borderColor: `${tone}33` }, pressed && { backgroundColor: `${tone}22` }]}>
            {k === 'del' ? <Delete color={tone} size={24} /> : k === 'ok' ? <Text style={[st.keyOk, { color: tone }]}>OK</Text> : <Text style={[st.keyText, { color: tone }]}>{k}</Text>}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ===================================================================== the lock

export function LockScreen({ onPassword }: { onPassword: () => void }) {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const q = app.settings.quick!;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;
  const wobble = () => Animated.sequence([10, -10, 6, -6, 0].map(v => Animated.timing(shake, { toValue: v, duration: 50, useNativeDriver: true }))).start();
  const tryCode = async (code: string) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await app.unlock(code); } catch (e: any) { setError(e.message); Vibration.vibrate(120); wobble(); } finally { setBusy(false); }
  };
  const first = (app.settings.userName || app.settings.username || '').split(' ')[0];
  return (
    <GradientPanel style={[st.full, { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.l }]} square>
      <View style={{ alignItems: 'center', gap: 6 }}>
        <BrandMark size={58} />
        <Text style={st.hello}>{first ? `Welcome back, ${first}` : 'Welcome back'}</Text>
        <Text style={st.sub}>{q.kind === 'PIN' ? 'Enter your PIN' : 'Draw your pattern'} to open {app.snapshot?.household || 'Personal Budget'}</Text>
      </View>
      <Animated.View style={{ transform: [{ translateX: shake }], alignItems: 'center', marginTop: space.xl }}>
        {q.kind === 'PIN' ? <PinPad length={q.length} onDone={tryCode} error={!!error} disabled={busy} />
          : <PatternPad onDone={tryCode} error={!!error} disabled={busy} />}
      </Animated.View>
      <View style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: space.m }}>
        {busy ? <ActivityIndicator color={colors.white} /> : error ? <Text style={st.err}>{error}</Text> : null}
      </View>
      <View style={{ flex: 1 }} />
      <Pressable onPress={onPassword} style={st.link} hitSlop={10}>
        <KeyRound color="rgba(255,255,255,0.85)" size={16} />
        <Text style={st.linkText}>Use password instead</Text>
      </Pressable>
    </GradientPanel>
  );
}

// ===================================================================== setting it up

export function QuickSetupScreen({ onDone }: { onDone?: () => void }) {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const [kind, setKind] = useState<'PATTERN' | 'PIN'>('PATTERN');
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const reset = (k = kind) => { setKind(k); setFirst(null); setError(''); };
  const got = async (code: string) => {
    if (kind === 'PATTERN' && code.split('-').length < 4) { setError('Connect at least 4 dots'); return; }
    if (kind === 'PIN' && code.length < 4) { setError('Use 4 to 6 digits'); return; }
    if (first === null) { setFirst(code); setError(''); return; }
    if (code !== first) { setFirst(null); setError(kind === 'PIN' ? 'The PINs did not match. Start again' : 'The patterns did not match. Start again'); return; }
    setBusy(true);
    try { await app.setupQuick(kind, code); app.notify(kind === 'PIN' ? 'PIN set: use it to open the app' : 'Pattern set: draw it to open the app'); onDone?.(); }
    catch (e: any) { setError(e.message); setFirst(null); } finally { setBusy(false); }
  };
  return (
    <GradientPanel style={[st.full, { paddingTop: insets.top + space.l, paddingBottom: insets.bottom + space.l }]} square>
      <View style={{ alignItems: 'center', gap: 6 }}>
        <View style={st.badge}><ShieldCheck color={colors.white} size={26} /></View>
        <Text style={st.hello}>Quick unlock</Text>
        <Text style={st.sub}>Open the app the way you open your phone. Your password stays the backup.</Text>
      </View>
      <View style={st.switch}>
        {([['PATTERN', 'Pattern', Grid3x3], ['PIN', 'PIN', Lock]] as const).map(([k, l, Icon]) => (
          <Pressable key={k} onPress={() => reset(k)} style={[st.switchItem, kind === k && st.switchOn]}>
            <Icon color={kind === k ? colors.navy : colors.white} size={16} />
            <Text style={[st.switchText, kind === k && { color: colors.navy }]}>{l}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={st.step}>{first === null ? (kind === 'PIN' ? 'Type a 4–6 digit PIN, then OK' : 'Draw a pattern (at least 4 dots)') : (kind === 'PIN' ? 'Type it again to confirm' : 'Draw it again to confirm')}</Text>
      <View style={{ alignItems: 'center', marginTop: space.m }}>
        {kind === 'PIN' ? <PinPad key={`pin-${first === null}`} length={first?.length} onDone={got} error={!!error} disabled={busy} />
          : <PatternPad key={`pat-${first === null}`} onDone={got} error={!!error} disabled={busy} />}
      </View>
      <View style={{ minHeight: 40, alignItems: 'center', justifyContent: 'center' }}>
        {busy ? <ActivityIndicator color={colors.white} /> : error ? <Text style={st.err}>{error}</Text> : null}
      </View>
      <View style={{ flex: 1 }} />
      <Pressable onPress={() => { app.skipQuick(); onDone?.(); }} style={st.link} hitSlop={10}>
        <LogIn color="rgba(255,255,255,0.85)" size={16} />
        <Text style={st.linkText}>Not now</Text>
      </Pressable>
    </GradientPanel>
  );
}

const st = StyleSheet.create({
  full: { flex: 1, borderRadius: 0, paddingHorizontal: space.l, alignItems: 'stretch' },
  hello: { color: colors.white, fontSize: 22, fontWeight: '800', marginTop: space.s },
  sub: { color: 'rgba(255,255,255,0.75)', fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: space.l },
  err: { color: '#ffb4a8', fontSize: 13.5, fontWeight: '700', textAlign: 'center' },
  link: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: space.m },
  linkText: { color: 'rgba(255,255,255,0.9)', fontSize: 14.5, fontWeight: '700' },
  pinDots: { flexDirection: 'row', gap: 16, height: 18 },
  pinDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  keypad: { width: 270, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14 },
  key: { width: 74, height: 74, borderRadius: 37, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  keyText: { fontSize: 28, fontWeight: '500' },
  keyOk: { fontSize: 17, fontWeight: '800' },
  badge: { width: 56, height: 56, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  switch: { flexDirection: 'row', alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 22, padding: 4, marginTop: space.l },
  switchItem: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, height: 36, borderRadius: 18 },
  switchOn: { backgroundColor: colors.white },
  switchText: { color: colors.white, fontWeight: '800', fontSize: 14 },
  step: { color: 'rgba(255,255,255,0.9)', fontSize: 14.5, fontWeight: '700', textAlign: 'center', marginTop: space.l },
});
