/**
 * The app's building blocks: the screen frame (header, pull to refresh, "from earlier" banner), cards, list rows, icon
 * bubbles, badges, buttons, fields, pickers, bottom sheets, a reason sheet (approve / reject / answer), stat tiles,
 * progress bars, facts and the toast.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Pressable, RefreshControl, ScrollView, StatusBar, StyleProp, StyleSheet, Text, TextInput,
  TextInputProps, View, ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Check, ChevronDown, ChevronRight, CircleAlert, CloudOff, LucideIcon, X } from 'lucide-react-native';
import { colors, radius, space, Tone, tones } from './theme';
import { ago } from './format';
import { Toast } from './state';

// ===================================================================== the frame

export function Screen({ title, subtitle, onBack, lead, right, children, refreshing, onRefresh, stale, error, dark, scroll = true, footer }: {
  title: string; subtitle?: string; onBack?: () => void; lead?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; refreshing?: boolean;
  onRefresh?: () => void; stale?: number | null; error?: string | null; dark?: boolean; scroll?: boolean; footer?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const body = (
    <>
      {stale ? <Banner Icon={CloudOff} tone="warn" text={`No signal: showing what was loaded ${ago(stale)}`} /> : null}
      {error ? <Banner Icon={CircleAlert} tone="bad" text={error} /> : null}
      {children}
    </>
  );
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="light-content" backgroundColor={colors.ink} />
      <View style={[st.header, { paddingTop: insets.top + 6 }, dark && st.headerDark]}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={12} style={st.back} android_ripple={{ color: '#ffffff22', borderless: true }}>
            <ArrowLeft color={colors.white} size={22} />
          </Pressable>
        ) : null}
        {lead}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.title} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={st.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
      {scroll ? (
        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[colors.orange]} /> : undefined}>
          {body}
        </ScrollView>
      ) : <View style={{ flex: 1 }}>{body}</View>}
      {footer ? <View style={[st.footer, { paddingBottom: Math.max(insets.bottom, 10) }]}>{footer}</View> : null}
    </View>
  );
}

export function HeaderButton({ Icon, onPress, badge }: { Icon: LucideIcon; onPress: () => void; badge?: number }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} style={st.hbtn} android_ripple={{ color: '#ffffff22', borderless: true }}>
      <Icon color={colors.white} size={21} />
      {badge ? <View style={st.hbadge}><Text style={st.hbadgeText}>{badge > 99 ? '99+' : badge}</Text></View> : null}
    </Pressable>
  );
}

export function Banner({ Icon, text, tone = 'info', action }: { Icon: LucideIcon; text: string; tone?: Tone; action?: React.ReactNode }) {
  const t = tones[tone];
  return (
    <View style={[st.banner, { backgroundColor: t.bg }]}>
      <Icon color={t.fg} size={16} />
      <Text style={[st.bannerText, { color: t.fg }]}>{text}</Text>
      {action}
    </View>
  );
}

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return (
    <View style={{ padding: space.xl, alignItems: 'center', gap: 10 }}>
      <ActivityIndicator color={colors.orange} size="large" />
      <Text style={{ color: colors.muted }}>{text}</Text>
    </View>
  );
}

// ===================================================================== blocks

export function Card({ children, style, onPress }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  if (onPress) {
    return <Pressable onPress={onPress} style={({ pressed }) => [st.card, style, pressed && st.pressed]} android_ripple={{ color: '#00000010' }}>{children}</Pressable>;
  }
  return <View style={[st.card, style]}>{children}</View>;
}

export function IconBubble({ Icon, tone = 'neutral', size = 40, fg, bg }: { Icon: LucideIcon; tone?: Tone; size?: number; fg?: string; bg?: string }) {
  const t = tones[tone];
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: bg || t.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon color={fg || t.fg} size={size * 0.5} strokeWidth={2} />
    </View>
  );
}

export function Badge({ text, tone = 'neutral', Icon }: { text: string; tone?: Tone; Icon?: LucideIcon }) {
  const t = tones[tone];
  return (
    <View style={[st.badge, { backgroundColor: t.bg }]}>
      {Icon ? <Icon color={t.fg} size={11} strokeWidth={2.4} /> : null}
      <Text style={[st.badgeText, { color: t.fg }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

/** A list row: an icon, a title and a line under it, a value on the right. */
export function Row({ Icon, tone, title, sub, right, rightSub, onPress, badge, last }: {
  Icon?: LucideIcon; tone?: Tone; title: string; sub?: string | null; right?: string | React.ReactNode; rightSub?: string | null;
  onPress?: () => void; badge?: React.ReactNode; last?: boolean;
}) {
  const inner = (
    <>
      {Icon ? <IconBubble Icon={Icon} tone={tone} size={38} /> : null}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={st.rowTitle} numberOfLines={1}>{title}</Text>
          {badge}
        </View>
        {sub ? <Text style={st.rowSub} numberOfLines={2}>{sub}</Text> : null}
      </View>
      {right !== undefined ? (
        <View style={{ alignItems: 'flex-end', gap: 2, maxWidth: '45%' }}>
          {typeof right === 'string' ? <Text style={st.rowRight} numberOfLines={1}>{right}</Text> : right}
          {rightSub ? <Text style={st.rowSub} numberOfLines={1}>{rightSub}</Text> : null}
        </View>
      ) : null}
      {onPress ? <ChevronRight color={colors.muted} size={18} /> : null}
    </>
  );
  const style = [st.row, !last && st.rowLine];
  return onPress
    ? <Pressable onPress={onPress} style={({ pressed }) => [style, pressed && { backgroundColor: colors.sunken }]} android_ripple={{ color: '#00000008' }}>{inner}</Pressable>
    : <View style={style}>{inner}</View>;
}

/** A card holding rows. */
export function List({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[st.card, { padding: 0, overflow: 'hidden' }, style]}>{children}</View>;
}

export function SectionTitle({ title, right, Icon }: { title: string; right?: React.ReactNode; Icon?: LucideIcon }) {
  return (
    <View style={st.section}>
      {Icon ? <Icon color={colors.orange} size={15} /> : null}
      <Text style={st.sectionText}>{title}</Text>
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

export function Stat({ label, value, sub, Icon, tone = 'neutral', onPress, style }: {
  label: string; value: string; sub?: string | null; Icon?: LucideIcon; tone?: Tone; onPress?: () => void; style?: StyleProp<ViewStyle>;
}) {
  return (
    <Card style={[st.stat, style]} onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {Icon ? <IconBubble Icon={Icon} tone={tone} size={28} /> : null}
        <Text style={st.statLabel} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={st.statValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {sub ? <Text style={st.statSub} numberOfLines={1}>{sub}</Text> : null}
    </Card>
  );
}

export function Grid({ children, gap = 10 }: { children: React.ReactNode; gap?: number }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>{children}</View>;
}

export function Bar({ value, max, color = colors.orange, height = 6 }: { value: number; max: number; color?: string; height?: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <View style={{ height, borderRadius: height, backgroundColor: colors.concreteSoft, overflow: 'hidden' }}>
      <View style={{ width: `${pct * 100}%`, height, borderRadius: height, backgroundColor: color }} />
    </View>
  );
}

/** Label / value pairs, two to a line. */
export function Facts({ items }: { items: [string, string | null | undefined | false][] }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== false && v !== '') as [string, string][];
  return (
    <View style={st.facts}>
      {shown.map(([k, v]) => (
        <View key={k} style={st.fact}>
          <Text style={st.factLabel}>{k}</Text>
          <Text style={st.factValue}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

export function Empty({ Icon, title, text, action }: { Icon: LucideIcon; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <View style={st.empty}>
      <IconBubble Icon={Icon} tone="neutral" size={60} />
      <Text style={st.emptyTitle}>{title}</Text>
      {text ? <Text style={st.emptyText}>{text}</Text> : null}
      {action}
    </View>
  );
}

export function Avatar({ text, size = 40, tone = 'accent' }: { text: string; size?: number; tone?: Tone }) {
  const t = tones[tone];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: t.fg, fontWeight: '800', fontSize: size * 0.36 }}>{text}</Text>
    </View>
  );
}

// ===================================================================== inputs

export function Button({ title, onPress, Icon, kind = 'primary', busy, disabled, style, small }: {
  title: string; onPress?: () => void; Icon?: LucideIcon; kind?: 'primary' | 'dark' | 'ghost' | 'danger' | 'soft' | 'good';
  busy?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; small?: boolean;
}) {
  const look = {
    primary: { bg: colors.orange, fg: colors.white, border: colors.orange },
    dark: { bg: colors.ink, fg: colors.white, border: colors.ink },
    good: { bg: colors.green, fg: colors.white, border: colors.green },
    soft: { bg: colors.orangeSoft, fg: colors.orange, border: colors.orangeSoft },
    ghost: { bg: colors.card, fg: colors.text2, border: colors.line },
    danger: { bg: colors.redSoft, fg: colors.red, border: colors.redSoft },
  }[kind];
  return (
    <Pressable onPress={busy || disabled ? undefined : onPress}
      style={({ pressed }) => [st.btn, small && st.btnSmall, { backgroundColor: look.bg, borderColor: look.border, opacity: disabled ? 0.45 : 1 },
        pressed && st.pressed, style]}>
      {busy ? <ActivityIndicator color={look.fg} size="small" /> : Icon ? <Icon color={look.fg} size={small ? 15 : 18} strokeWidth={2.2} /> : null}
      <Text style={[st.btnText, small && { fontSize: 13 }, { color: look.fg }]} numberOfLines={1}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, hint, style, error, ...props }: TextInputProps & { label: string; hint?: string; error?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap: 5 }, style]}>
      <Text style={st.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} style={[st.input, props.multiline && st.inputMulti, error ? { borderColor: colors.red } : null]} {...props} />
      {error ? <Text style={[st.hint, { color: colors.red }]}>{error}</Text> : hint ? <Text style={st.hint}>{hint}</Text> : null}
    </View>
  );
}

export type Option<T> = { value: T; label: string; sub?: string };

/** A field that opens a sheet of choices. */
export function Select<T>({ label, value, options, onChange, placeholder = 'Choose', style, hint }: {
  label: string; value: T | null | undefined; options: Option<T>[]; onChange: (v: T) => void; placeholder?: string;
  style?: StyleProp<ViewStyle>; hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find(o => o.value === value);
  return (
    <View style={[{ gap: 5 }, style]}>
      <Text style={st.label}>{label}</Text>
      <Pressable onPress={() => setOpen(true)} style={[st.input, st.select]}>
        <Text style={{ flex: 1, fontSize: 15.5, color: current ? colors.text : colors.muted }} numberOfLines={1}>{current?.label || placeholder}</Text>
        <ChevronDown color={colors.muted} size={18} />
      </Pressable>
      {hint ? <Text style={st.hint}>{hint}</Text> : null}
      <Sheet visible={open} onClose={() => setOpen(false)} title={label}>
        <List>
          {options.map((o, i) => (
            <Pressable key={String(o.value)} onPress={() => { onChange(o.value); setOpen(false); }}
              style={({ pressed }) => [st.row, i < options.length - 1 && st.rowLine, pressed && { backgroundColor: colors.sunken }]}>
              <View style={{ flex: 1 }}>
                <Text style={st.rowTitle}>{o.label}</Text>
                {o.sub ? <Text style={st.rowSub}>{o.sub}</Text> : null}
              </View>
              {o.value === value ? <Check color={colors.orange} size={18} /> : null}
            </Pressable>
          ))}
        </List>
      </Sheet>
    </View>
  );
}

export function Chips<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
      {options.map(o => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} style={[st.chip, o.value === value && st.chipOn]}>
          <Text style={[st.chipText, o.value === value && { color: colors.white }]}>{o.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** A sheet that slides up from the bottom, scrolling its content. */
export function Sheet({ visible, onClose, title, children, footer }: {
  visible: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={st.sheetWrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[st.sheet, { paddingBottom: footer ? 0 : insets.bottom + 8 }]}>
          <View style={st.grabber} />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.m }}>
            <Text style={st.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10}><X color={colors.muted} size={20} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: space.l, gap: space.m }}>{children}</ScrollView>
          {footer ? <View style={[st.sheetFooter, { paddingBottom: insets.bottom + 10 }]}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * Asks for a short text before an action: the reason a request is rejected (required), a word with an approval, an
 * answer to a rejection. Resolves the action with the text; an error from it is shown in the sheet.
 */
export function ReasonSheet({ visible, onClose, title, intro, label, placeholder, required, actionTitle, actionKind = 'primary', ActionIcon, onSubmit, children,
  suggestions }: {
  visible: boolean; onClose: () => void; title: string; intro?: string; label: string; placeholder?: string; required?: boolean;
  actionTitle: string; actionKind?: 'primary' | 'danger' | 'good' | 'dark'; ActionIcon?: LucideIcon; onSubmit: (text: string) => Promise<void>;
  children?: React.ReactNode;
  /** reasons often given, to tap instead of typing */
  suggestions?: string[];
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (visible) { setText(''); setErr(''); } }, [visible]);
  const submit = async () => {
    if (required && !text.trim()) { setErr('Please write the reason'); return; }
    setBusy(true); setErr('');
    try {
      await onSubmit(text.trim());
    } catch (e: any) {
      setErr(e?.message || 'That did not work');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={title}
      footer={<Button title={actionTitle} kind={actionKind} Icon={ActionIcon} busy={busy} onPress={submit} />}>
      {intro ? <Text style={{ color: colors.text2, lineHeight: 20 }}>{intro}</Text> : null}
      <Field label={label} value={text} onChangeText={setText} placeholder={placeholder} multiline maxLength={255} error={err || undefined} />
      {suggestions?.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {suggestions.map(r => (
            <Pressable key={r} onPress={() => { setText(r); setErr(''); }} style={[st.chip, st.chipSmall, text === r && st.chipOn]}>
              <Text style={[st.chipText, { fontSize: 12 }, text === r && { color: colors.white }]}>{r}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {children}
    </Sheet>
  );
}

export function ToastView({ toast }: { toast: Toast | null }) {
  const insets = useSafeAreaInsets();
  if (!toast) return null;
  const bg = toast.tone === 'bad' ? colors.red : toast.tone === 'info' ? colors.ink2 : colors.green;
  return (
    <View pointerEvents="none" style={[st.toast, { bottom: insets.bottom + 90, backgroundColor: bg }]}>
      <Text style={st.toastText}>{toast.text}</Text>
    </View>
  );
}

export const st = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.ink, paddingHorizontal: space.l, paddingBottom: 14 },
  headerDark: { paddingBottom: 18 },
  back: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginLeft: -6 },
  title: { color: colors.white, fontSize: 19, fontWeight: '800' },
  subtitle: { color: '#b8c0c8', fontSize: 12.5, marginTop: 1 },
  hbtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  hbadge: { position: 'absolute', top: 2, right: 0, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.orange, paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.ink },
  hbadgeText: { color: colors.white, fontSize: 9.5, fontWeight: '800' },
  body: { padding: space.l, paddingBottom: 40, gap: space.m },
  footer: { paddingHorizontal: space.l, paddingTop: 10, backgroundColor: colors.card, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line,
    flexDirection: 'row', gap: 10 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: radius.m },
  bannerText: { flex: 1, fontSize: 12.5, fontWeight: '600' },
  card: { backgroundColor: colors.card, borderRadius: radius.l, padding: space.m, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line,
    shadowColor: '#1e252c', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 21, borderRadius: 11, alignSelf: 'flex-start' },
  badgeText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: space.m, paddingVertical: 12, backgroundColor: colors.card },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  rowTitle: { fontSize: 15, fontWeight: '700', color: colors.text, flexShrink: 1 },
  rowSub: { fontSize: 12.5, color: colors.text2 },
  rowRight: { fontSize: 15, fontWeight: '800', color: colors.text },
  section: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.s, paddingHorizontal: 2 },
  sectionText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, color: colors.text2, textTransform: 'uppercase' },
  stat: { flexGrow: 1, flexBasis: '46%', gap: 6, padding: space.m },
  statLabel: { fontSize: 12, fontWeight: '700', color: colors.text2, flexShrink: 1 },
  statValue: { fontSize: 22, fontWeight: '800', color: colors.text },
  statSub: { fontSize: 11.5, color: colors.muted },
  facts: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 },
  fact: { width: '50%', paddingRight: 8, gap: 2 },
  factLabel: { fontSize: 10.5, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  factValue: { fontSize: 14, color: colors.text, fontWeight: '600' },
  empty: { alignItems: 'center', gap: 8, padding: space.xl },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: colors.text, textAlign: 'center' },
  emptyText: { fontSize: 13, color: colors.text2, textAlign: 'center', lineHeight: 19 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 50, borderRadius: radius.m, borderWidth: 1,
    paddingHorizontal: space.l, flexGrow: 1 },
  btnSmall: { height: 38, paddingHorizontal: space.m, flexGrow: 0 },
  btnText: { fontSize: 15, fontWeight: '800' },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: colors.muted, textTransform: 'uppercase' },
  input: { minHeight: 48, borderRadius: radius.m, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, paddingHorizontal: 14,
    fontSize: 15.5, color: colors.text },
  inputMulti: { minHeight: 90, paddingTop: 12, textAlignVertical: 'top' },
  select: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hint: { fontSize: 11.5, color: colors.muted },
  chip: { paddingHorizontal: 14, height: 34, borderRadius: 17, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipSmall: { height: 'auto', paddingVertical: 7, paddingHorizontal: 11, borderRadius: 14 },
  chipText: { fontSize: 13, fontWeight: '700', color: colors.text2 },
  sheetWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(30,37,44,0.5)' },
  sheet: { maxHeight: '92%', backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: space.l, paddingTop: space.s },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.concrete, marginBottom: space.s },
  sheetTitle: { flex: 1, fontSize: 19, fontWeight: '800', color: colors.text },
  sheetFooter: { paddingTop: space.m, gap: space.s, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line, flexDirection: 'row' },
  toast: { position: 'absolute', left: space.l, right: space.l, padding: 14, borderRadius: radius.m, elevation: 6, shadowColor: '#000',
    shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  toastText: { color: colors.white, fontWeight: '700', fontSize: 14, textAlign: 'center' },
});
