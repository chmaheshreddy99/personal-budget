/** The app's building blocks: cards, a gradient header, icon bubbles, chips, buttons, fields and bottom sheets. */
import React from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleProp, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import {
  Banknote, Briefcase, Building2, Car, CreditCard, Gem, HandCoins, HardHat, HeartPulse, Home, Landmark, LucideIcon, PiggyBank, Plane, Receipt,
  ShoppingBag, ShoppingCart, Smartphone, Sparkles, Ticket, TrainFront, Utensils, Wallet, Wrench, Zap, Fuel, GraduationCap, Shirt, Gift, Film, Shield,
  Coffee, CalendarClock, Layers, BookOpen, Laptop, TrendingUp, Award, BadgePercent, Undo2, Tractor, Handshake, Presentation, Tag, Coins,
  Percent, Truck, Milk, Carrot, CarTaxiFront, SquareParking, Sofa, Users, Flame, Droplets, Tv, Pill as PillIcon, Dumbbell, Repeat, Flower2, Baby, PawPrint,
  WashingMachine, Newspaper,
} from 'lucide-react-native';
import { accountTone, colors, radius, space } from './theme';

export function Card({ children, style, onPress }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  if (onPress) {
    return <Pressable onPress={onPress} style={({ pressed }) => [s.card, style, pressed && s.pressed]} android_ripple={{ color: '#00000010' }}>{children}</Pressable>;
  }
  return <View style={[s.card, style]}>{children}</View>;
}

/** A navy-to-ocean gradient panel (the top of a screen). */
export function GradientPanel({ children, style, from = colors.navy, to = colors.ocean }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; from?: string; to?: string }) {
  return (
    <View style={[s.grad, style]}>
      <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill="url(#g)" />
      </Svg>
      {children}
    </View>
  );
}

export function IconBubble({ Icon, fg, bg, size = 38 }: { Icon: LucideIcon; fg: string; bg: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.32, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon color={fg} size={size * 0.5} strokeWidth={2} />
    </View>
  );
}

export function accountIcon(type: string, group?: string): LucideIcon {
  if (group === 'CONSTRUCTION') return HardHat;
  if (group === 'HOSTED_CHIT') return HandCoins;
  if (group === 'EMI') return CalendarClock;
  switch (type) {
    case 'BANK': return Landmark;
    case 'CREDIT_CARD': return CreditCard;
    case 'CASH': return Banknote;
    case 'WALLET': return Wallet;
    case 'FIXED_DEPOSIT': case 'RECURRING_DEPOSIT': case 'SAVINGS_SCHEME': return PiggyBank;
    case 'GOLD': case 'SILVER': return Gem;
    case 'REAL_ESTATE': case 'HOME_LOAN': return Home;
    case 'VEHICLE': case 'VEHICLE_LOAN': return Car;
    case 'INSURANCE_POLICY': return Shield;
    case 'CHIT_FUND': return HandCoins;
    case 'PAYABLE': return Receipt;
    case 'LOAN': case 'PERSONAL_LOAN': case 'GOLD_LOAN': case 'EDUCATION_LOAN': return Briefcase;
    default: return Layers;
  }
}

/** Full-colour cash artwork (a rupee note, a wallet with notes, a stack of coins) for the money accounts, drawn like the web app's. */
export function CashArt({ kind, size = 36 }: { kind: 'note' | 'wallet' | 'coins'; size?: number }) {
  const stroke = kind === 'coins' ? '#8a5d00' : kind === 'wallet' ? '#7a4a1e' : '#2f7d3a';
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      {kind === 'note' ? (
        <>
          <G rotation={-9} origin="24, 24"><Rect x={6} y={11} width={37} height={22} rx={3} fill="#6fbf73" stroke={stroke} strokeWidth={1.6} /></G>
          <Rect x={4} y={15} width={38} height={23} rx={3} fill="#b4e6a8" stroke={stroke} strokeWidth={1.6} />
          <Rect x={7.5} y={18.5} width={31} height={16} rx={1.8} fill="none" stroke={stroke} strokeWidth={1} strokeDasharray="2.2 1.8" />
          <Circle cx={23} cy={26.5} r={6.4} fill="#6fbf73" stroke={stroke} strokeWidth={1.3} />
          <SvgText x={23} y={30.3} textAnchor="middle" fontSize={10} fontWeight="bold" fill="#1d5a27">₹</SvgText>
          <Circle cx={11.5} cy={26.5} r={1.5} fill={stroke} /><Circle cx={34.5} cy={26.5} r={1.5} fill={stroke} />
        </>
      ) : kind === 'wallet' ? (
        <>
          <G rotation={-6} origin="25, 13"><Rect x={12} y={6} width={26} height={15} rx={2} fill="#8fd187" stroke="#2f7d3a" strokeWidth={1.4} /></G>
          <G rotation={5} origin="29, 16"><Rect x={16} y={9} width={26} height={15} rx={2} fill="#b4e6a8" stroke="#2f7d3a" strokeWidth={1.4} /></G>
          <Rect x={4} y={16} width={40} height={26} rx={5} fill="#c98544" stroke={stroke} strokeWidth={1.7} />
          <Rect x={29} y={25} width={15} height={11} rx={3.5} fill="#e3a766" stroke={stroke} strokeWidth={1.5} />
          <Circle cx={35} cy={30.5} r={2.1} fill={stroke} />
        </>
      ) : (
        <>
          <Ellipse cx={17} cy={37} rx={12} ry={5} fill="#d99a1b" stroke={stroke} strokeWidth={1.4} />
          <Path d="M5 31v6c0 2.8 5.4 5 12 5s12-2.2 12-5v-6z" fill="#f0b73a" stroke={stroke} strokeWidth={1.4} />
          <Ellipse cx={17} cy={31} rx={12} ry={5} fill="#ffd25e" stroke={stroke} strokeWidth={1.4} />
          <Path d="M5 24v7c0 2.8 5.4 5 12 5s12-2.2 12-5v-7z" fill="#f0b73a" stroke={stroke} strokeWidth={1.4} />
          <Ellipse cx={17} cy={24} rx={12} ry={5} fill="#ffd25e" stroke={stroke} strokeWidth={1.4} />
          <Path d="M23 22v8c0 2.4 4.5 4.3 10 4.3S43 32.4 43 30v-8z" fill="#f0b73a" stroke={stroke} strokeWidth={1.3} />
          <Ellipse cx={33} cy={22} rx={10} ry={4.3} fill="#ffd25e" stroke={stroke} strokeWidth={1.3} />
          <SvgText x={33} y={24.4} textAnchor="middle" fontSize={6.5} fontWeight="bold" fill={stroke}>₹</SvgText>
          <SvgText x={17} y={26.4} textAnchor="middle" fontSize={6.5} fontWeight="bold" fill={stroke}>₹</SvgText>
        </>
      )}
    </Svg>
  );
}

export function AccountBubble({ type, group, size }: { type: string; group?: string; size?: number }) {
  if (!group || group === 'OWN') {
    const art = type === 'CASH' ? 'note' : type === 'WALLET' ? 'wallet' : type === 'CHIT_FUND' ? 'coins' : null;
    if (art) return <View style={{ width: size || 44, height: size || 44, alignItems: 'center', justifyContent: 'center' }}><CashArt kind={art} size={(size || 44) * 0.95} /></View>;
  }
  const t = accountTone(type, group);
  return <IconBubble Icon={accountIcon(type, group)} fg={t.fg} bg={t.bg} size={size} />;
}

/** Category name → its icon and tone, the more specific names first ("Water Cans" before "Utilities", "Rental Income" before "Rent"). */
const CATEGORY_ICONS: [RegExp, LucideIcon, string, string][] = [
  // ---- income
  [/salary|wage/i, Briefcase, colors.green, colors.greenSoft],
  [/business|freelance/i, Laptop, colors.green, colors.greenSoft],
  [/chit commission income/i, HandCoins, colors.aqua, colors.aquaSoft],
  [/chit gain/i, HandCoins, colors.green, colors.greenSoft],
  [/chit payment/i, HandCoins, colors.aqua, colors.aquaSoft],
  [/chit/i, Percent, colors.aqua, colors.aquaSoft],
  [/dividend|capital gain/i, TrendingUp, colors.green, colors.greenSoft],
  [/^interest/i, Percent, colors.green, colors.greenSoft],
  [/rental income/i, Home, colors.green, colors.greenSoft],
  [/gifts? received/i, Gift, colors.green, colors.greenSoft],
  [/savings income/i, PiggyBank, colors.green, colors.greenSoft],
  [/bonus|incentive/i, Award, colors.gold, colors.goldSoft],
  [/pension/i, Landmark, colors.green, colors.greenSoft],
  [/cashback|reward/i, BadgePercent, colors.coral, colors.coralSoft],
  [/refund|reimburse/i, Undo2, colors.ocean, colors.oceanSoft],
  [/agricultur|farm|crop/i, Tractor, colors.green, colors.greenSoft],
  [/commission|brokerage/i, Handshake, colors.green, colors.greenSoft],
  [/tuition|coaching/i, Presentation, colors.ocean, colors.oceanSoft],
  [/sale of|selling/i, Tag, colors.green, colors.greenSoft],
  [/allowance/i, Wallet, colors.green, colors.greenSoft],
  [/other income/i, Coins, colors.green, colors.greenSoft],
  // ---- expense
  [/food deliver|takeaway/i, Truck, colors.coral, colors.coralSoft],
  [/milk|dairy/i, Milk, colors.ocean, colors.oceanSoft],
  [/vegetable|fruit/i, Carrot, colors.green, colors.greenSoft],
  [/grocer/i, ShoppingCart, colors.green, colors.greenSoft],
  [/coffee|snack|tea|beverage/i, Coffee, colors.coral, colors.coralSoft],
  [/dining|food|restaurant|eat/i, Utensils, colors.coral, colors.coralSoft],
  [/cab|auto|taxi/i, CarTaxiFront, colors.gold, colors.goldSoft],
  [/parking|toll/i, SquareParking, colors.ocean, colors.oceanSoft],
  [/vehicle/i, Car, colors.muted, colors.sunken],
  [/fuel|petrol/i, Fuel, colors.gold, colors.goldSoft],
  [/vacation|trip|holiday|flight/i, Plane, colors.ocean, colors.oceanSoft],
  [/transport|travel|commute/i, TrainFront, colors.ocean, colors.oceanSoft],
  [/furniture|decor/i, Sofa, colors.violet, colors.violetSoft],
  [/maid|household help|cook/i, Users, colors.violet, colors.violetSoft],
  [/repair|mainten/i, Wrench, colors.muted, colors.sunken],
  [/rent|hous|home/i, Home, colors.violet, colors.violetSoft],
  [/gas|lpg|cylinder/i, Flame, colors.coral, colors.coralSoft],
  [/water can|drinking water/i, Droplets, colors.ocean, colors.oceanSoft],
  [/utilit|electric|power|water/i, Zap, colors.gold, colors.goldSoft],
  [/dth|cable/i, Tv, colors.violet, colors.violetSoft],
  [/mobile|internet|phone/i, Smartphone, colors.violet, colors.violetSoft],
  [/pharma|medicine/i, PillIcon, colors.red, colors.redSoft],
  [/medic|health|hospital/i, HeartPulse, colors.red, colors.redSoft],
  [/gym|fitness/i, Dumbbell, colors.aqua, colors.aquaSoft],
  [/gadget|electronic/i, Laptop, colors.ocean, colors.oceanSoft],
  [/cloth|footwear/i, Shirt, colors.coral, colors.coralSoft],
  [/shopping/i, ShoppingBag, colors.coral, colors.coralSoft],
  [/subscription/i, Repeat, colors.violet, colors.violetSoft],
  [/entertain|movie/i, Film, colors.violet, colors.violetSoft],
  [/educat|school/i, GraduationCap, colors.ocean, colors.oceanSoft],
  [/insur/i, Shield, colors.aqua, colors.aquaSoft],
  [/festival|pooja|puja/i, Flower2, colors.gold, colors.goldSoft],
  [/gift|donat/i, Gift, colors.red, colors.redSoft],
  [/kid|family|child/i, Baby, colors.coral, colors.coralSoft],
  [/pet/i, PawPrint, colors.gold, colors.goldSoft],
  [/laundry|ironing/i, WashingMachine, colors.ocean, colors.oceanSoft],
  [/newspaper|magazine/i, Newspaper, colors.muted, colors.sunken],
  [/loan|interest|emi/i, Building2, colors.red, colors.redSoft],
  [/tax/i, Receipt, colors.red, colors.redSoft],
  [/bank|charge|fee/i, Landmark, colors.muted, colors.sunken],
  [/book|stationery/i, BookOpen, colors.ocean, colors.oceanSoft],
  [/event|ticket/i, Ticket, colors.violet, colors.violetSoft],
  [/personal|care|beauty/i, Sparkles, colors.coral, colors.coralSoft],
  [/misc/i, Layers, colors.muted, colors.sunken],
];

export function categoryLook(name: string): { Icon: LucideIcon; fg: string; bg: string } {
  const hit = CATEGORY_ICONS.find(([re]) => re.test(name));
  return hit ? { Icon: hit[1], fg: hit[2], bg: hit[3] } : { Icon: ShoppingBag, fg: colors.ocean, bg: colors.oceanSoft };
}

export function Pill({ text, fg = colors.text2, bg = colors.sunken, Icon }: { text: string; fg?: string; bg?: string; Icon?: LucideIcon }) {
  return (
    <View style={[s.pill, { backgroundColor: bg }]}>
      {Icon ? <Icon color={fg} size={11} strokeWidth={2.4} /> : null}
      <Text style={[s.pillText, { color: fg }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

export function Chip({ label, selected, onPress, Icon }: { label: string; selected?: boolean; onPress?: () => void; Icon?: LucideIcon }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, selected && s.chipOn]}>
      {Icon ? <Icon color={selected ? colors.white : colors.text2} size={14} /> : null}
      <Text style={[s.chipText, selected && { color: colors.white }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export function Button({ title, onPress, Icon, kind = 'primary', busy, disabled, style }:
  { title: string; onPress?: () => void; Icon?: LucideIcon; kind?: 'primary' | 'ghost' | 'danger' | 'soft'; busy?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  const look = {
    primary: { bg: colors.ocean, fg: colors.white, border: colors.ocean },
    soft: { bg: colors.oceanSoft, fg: colors.ocean, border: colors.oceanSoft },
    ghost: { bg: 'transparent', fg: colors.text2, border: colors.line },
    danger: { bg: colors.redSoft, fg: colors.red, border: colors.redSoft },
  }[kind];
  return (
    <Pressable onPress={busy || disabled ? undefined : onPress}
      style={({ pressed }) => [s.btn, { backgroundColor: look.bg, borderColor: look.border, opacity: disabled ? 0.5 : 1 }, pressed && s.pressed, style]}>
      {busy ? <ActivityIndicator color={look.fg} size="small" /> : Icon ? <Icon color={look.fg} size={17} strokeWidth={2.2} /> : null}
      <Text style={[s.btnText, { color: look.fg }]}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, hint, style, ...props }: TextInputProps & { label: string; hint?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap: 4 }, style]}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} style={s.input} {...props} />
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

export function SectionTitle({ title, right, Icon }: { title: string; right?: React.ReactNode; Icon?: LucideIcon }) {
  return (
    <View style={s.section}>
      {Icon ? <Icon color={colors.ocean} size={15} /> : null}
      <Text style={s.sectionText}>{title}</Text>
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

export function Empty({ Icon, title, text, action }: { Icon: LucideIcon; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <View style={s.empty}>
      <IconBubble Icon={Icon} fg={colors.ocean} bg={colors.oceanSoft} size={56} />
      <Text style={s.emptyTitle}>{title}</Text>
      {text ? <Text style={s.emptyText}>{text}</Text> : null}
      {action}
    </View>
  );
}

/** A sheet that slides up from the bottom, scrolling its content. */
export function Sheet({ visible, onClose, title, children, footer }:
  { visible: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={s.sheetWrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={s.sheet}>
          <View style={s.grabber} />
          <Text style={s.sheetTitle}>{title}</Text>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: space.l, gap: space.m }}>{children}</ScrollView>
          {footer ? <View style={s.sheetFooter}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export const s = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.l, padding: space.m + 2, borderWidth: StyleSheet.hairlineWidth, borderColor: '#e8edf4',
    shadowColor: '#0b2038', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  grad: { borderRadius: radius.xl, overflow: 'hidden', padding: space.l },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 20, borderRadius: 10, alignSelf: 'flex-start' },
  pillText: { fontSize: 10.5, fontWeight: '700' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 36, borderRadius: 18, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.line },
  chipOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.text2 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 50, borderRadius: radius.m, borderWidth: 1, paddingHorizontal: space.l,
    shadowColor: '#0b2038', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  btnText: { fontSize: 15, fontWeight: '700' },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: colors.muted, textTransform: 'uppercase' },
  input: { height: 50, borderRadius: radius.m, borderWidth: 1.2, borderColor: colors.line, backgroundColor: '#fafcfe', paddingHorizontal: 15,
    fontSize: 16, color: colors.text },
  hint: { fontSize: 11.5, color: colors.muted },
  section: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.l, marginBottom: space.s, paddingHorizontal: 2 },
  sectionText: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.9, color: colors.muted, textTransform: 'uppercase' },
  empty: { alignItems: 'center', gap: 8, padding: space.xl },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  emptyText: { fontSize: 13, color: colors.text2, textAlign: 'center', lineHeight: 19 },
  sheetWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(11,32,56,0.45)' },
  sheet: { maxHeight: '92%', backgroundColor: colors.bg, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: space.l, paddingTop: space.s },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line, marginBottom: space.s },
  sheetTitle: { fontSize: 19, fontWeight: '800', color: colors.text, marginBottom: space.m },
  sheetFooter: { paddingVertical: space.m, gap: space.s, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
});
