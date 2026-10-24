/** What screens share: doing something on the server (busy, errors, "sent for approval"), the brand mark, small bits. */
import React, { useCallback, useState } from 'react';
import { Image, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { CalendarDays, Check } from 'lucide-react-native';
import { useApp } from '../state';
import { logoUrl } from '../api';
import { useNav } from '../nav';
import { colors } from '../theme';
import { Held, isHeld } from '../types';
import { date, dayLabel, isoDate } from '../format';
import { Button, Field, Sheet, st } from '../ui';

/**
 * Runs a change on the server: one at a time per screen (busy holds its key), the server's message as a toast when it
 * fails, "sent for approval" when a checker has to make it (the server held it), then every screen fetches again.
 * Resolves with the answer (or the Held), or undefined when it failed.
 */
export function useAct() {
  const app = useApp();
  const nav = useNav();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>, done?: string | ((out: T) => string | void)): Promise<T | Held | undefined> => {
    setBusy(key);
    try {
      const out = await fn();
      if (isHeld(out)) {
        app.say(out.message || 'Sent for approval: a checker makes the change', 'info');
      } else {
        const text = typeof done === 'function' ? done(out) : done;
        if (text) app.say(text);
      }
      nav.changed();
      app.refreshProfile();
      return out;
    } catch (e: any) {
      app.say(e?.message || 'That did not work', 'bad');
      return undefined;
    } finally {
      setBusy(null);
    }
  }, [app, nav]);
  return { busy, run };
}

/** The brand mark: three grey hollow blocks stacked on an orange line (as the launcher icon). */
export function BlocksMark({ size = 64 }: { size?: number }) {
  const u = size / 72;
  const block = (left: number, top: number) => (
    <View style={{ position: 'absolute', left: left * u, top: top * u, width: 26 * u, height: 13 * u, backgroundColor: colors.concrete, borderRadius: 1.5 * u,
      borderBottomWidth: 2.2 * u, borderColor: '#9aa1a9' }}>
      <View style={{ position: 'absolute', left: 5 * u, top: 3.5 * u, width: 7 * u, height: 6 * u, backgroundColor: colors.ink }} />
      <View style={{ position: 'absolute', left: 14 * u, top: 3.5 * u, width: 7 * u, height: 6 * u, backgroundColor: colors.ink }} />
    </View>
  );
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.24, backgroundColor: colors.ink, overflow: 'hidden' }}>
      {block(23, 20)}
      {block(8.5, 36)}
      {block(37.5, 36)}
      <View style={{ position: 'absolute', left: 8.5 * u, top: 53 * u, width: 55 * u, height: 3.2 * u, backgroundColor: colors.orange2, borderRadius: 2 }} />
    </View>
  );
}

/**
 * The company's logo as the web app shows it (Settings → Organization), on a white tile so a dark logo shows on the
 * dark screens; without one (or while it cannot load) the app's own mark.
 */
export function BrandMark({ size = 64 }: { size?: number }) {
  const app = useApp();
  const uri = logoUrl(app.session);
  const [failed, setFailed] = useState<string | null>(null);
  if (!uri || failed === uri) return <BlocksMark size={size} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.24, backgroundColor: colors.white, padding: size * 0.05, overflow: 'hidden' }}>
      <Image source={{ uri, headers: { 'ngrok-skip-browser-warning': '1' } }} style={{ width: '100%', height: '100%' }} resizeMode="contain" onError={() => setFailed(uri)}
        accessibilityLabel={app.session.brand?.name || 'Company logo'} />
    </View>
  );
}

/** The company's name as the web app shows it, else the given one. */
export function useBrandName(fallback: string): string {
  return useApp().session.brand?.name || fallback;
}

/** A coloured square for a brick type (its colour as set on the web app). */
export function TypeDot({ color }: { color?: string | null }) {
  return <View style={[cs.dot, { backgroundColor: color || colors.concrete }]} />;
}

export function Note({ text }: { text: string }) {
  return <Text style={cs.note}>{text}</Text>;
}

export const num = (s: string) => {
  const n = Number(String(s).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const cs = StyleSheet.create({
  dot: { width: 12, height: 12, borderRadius: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: '#00000033' },
  note: { fontSize: 12.5, color: colors.muted, lineHeight: 18 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  toggleLabel: { fontSize: 15, fontWeight: '700', color: colors.text },
});

/** A day: quick choices (yesterday, today, tomorrow …) and the date typed, as YYYY-MM-DD. */
export function DateField({ label, value, onChange, future, hint }: { label: string; value: string; onChange: (d: string) => void; future?: boolean; hint?: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(value);
  const shift = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return isoDate(d); };
  const quick: [string, string][] = future
    ? [['Today', shift(0)], ['Tomorrow', shift(1)], ['In 2 days', shift(2)], ['In 3 days', shift(3)], ['In a week', shift(7)]]
    : [['Today', shift(0)], ['Yesterday', shift(-1)], ['2 days ago', shift(-2)], ['3 days ago', shift(-3)]];
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(typed) && !Number.isNaN(new Date(`${typed}T00:00:00`).getTime());
  return (
    <View style={{ gap: 5 }}>
      <Text style={st.label}>{label}</Text>
      <Pressable onPress={() => { setTyped(value); setOpen(true); }} style={[st.input, st.select]}>
        <CalendarDays color={colors.muted} size={18} />
        <Text style={{ flex: 1, fontSize: 15.5, color: value ? colors.text : colors.muted }}>{value ? `${dayLabel(value)} · ${date(value)}` : 'Choose a day'}</Text>
      </Pressable>
      {hint ? <Text style={st.hint}>{hint}</Text> : null}
      <Sheet visible={open} onClose={() => setOpen(false)} title={label}
        footer={<Button title="Use this day" Icon={Check} disabled={!valid} onPress={() => { onChange(typed); setOpen(false); }} />}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {quick.map(([l, d]) => (
            <Pressable key={l} onPress={() => { onChange(d); setOpen(false); }} style={[st.chip, d === value && st.chipOn]}>
              <Text style={[st.chipText, d === value && { color: colors.white }]}>{l}</Text>
            </Pressable>
          ))}
        </View>
        <Field label="Or type the date" value={typed} onChangeText={setTyped} placeholder="2026-10-23" keyboardType="numbers-and-punctuation"
          error={typed && !valid ? 'As year-month-day, e.g. 2026-10-23' : undefined} />
      </Sheet>
    </View>
  );
}

/** A yes / no line with a switch. */
export function Toggle({ label, sub, value, onChange }: { label: string; sub?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={cs.toggle}>
      <View style={{ flex: 1 }}>
        <Text style={cs.toggleLabel}>{label}</Text>
        {sub ? <Text style={cs.note}>{sub}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.orange, false: colors.concrete }} thumbColor={colors.white} />
    </Pressable>
  );
}
