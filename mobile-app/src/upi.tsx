/**
 * Paying a chit instalment by UPI when the chit has the organizer's UPI ID: a upi://pay link (payee, amount, a compact
 * note ending with the instalment) opened in Google Pay or PhonePe, with each app's own mark on its button. The note
 * is built the way the web app builds it, so the organizer sees the same text whichever way it was paid.
 */
import React from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Text as SvgText } from 'react-native-svg';
import { Chit, Installment } from './data';
import { nativeUpi } from './native';
import { colors, radius } from './theme';

/** UPI apps cut long notes; 50 characters is the safe common limit. */
const NOTE_LIMIT = 50;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Inst 7/20 Oct26" */
function installmentTag(chit: Chit, inst: Installment): string {
  const [y, m] = inst.dueDate.split('-').map(Number);
  return `Inst ${inst.no}/${chit.months} ${MONTHS[m - 1]}${String(y).slice(2)}`;
}

/** The chit's own note text (or its name and ticket), trimmed so the instalment tag always fits. */
export function upiNote(chit: Chit, inst: Installment): string {
  const tag = installmentTag(chit, inst);
  const room = NOTE_LIMIT - tag.length - 1;
  let lead = (chit.upiNote || [chit.name, chit.ticketNo].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim();
  if (lead.length > room) lead = lead.slice(0, Math.max(0, room)).trimEnd();
  return lead ? `${lead} ${tag}` : tag;
}

/** upi://pay link understood by every UPI app ('@' stays literal: a few apps do not decode %40). */
export function upiLink(chit: Chit, amount: number, note: string): string {
  const params: [string, string][] = [['pa', chit.organizerUpi || ''], ['pn', chit.organizer || chit.organizerUpi || ''],
    ['am', amount.toFixed(2)], ['cu', 'INR'], ['tn', note]];
  return 'upi://pay?' + params.filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%40/g, '@')}`).join('&');
}

export type UpiApp = { key: 'gpay' | 'phonepe'; name: string; pkg: string };
export const UPI_APPS: UpiApp[] = [
  { key: 'gpay', name: 'Google Pay', pkg: 'com.google.android.apps.nbu.paisa.user' },
  { key: 'phonepe', name: 'PhonePe', pkg: 'com.phonepe.app' },
];

/** Opens the payment in that app; 'STORE' when it is not installed (its Play Store page opened instead). */
export async function payWith(app: UpiApp, link: string): Promise<'APP' | 'STORE'> {
  const out = await nativeUpi.open(link, app.pkg);
  if (out) return out;
  await Linking.openURL(link);   // no bridge (iOS later): any UPI app
  return 'APP';
}

/** Google Pay's mark: the four-colour G and "Pay". */
function GPayMark({ height = 22 }: { height?: number }) {
  return (
    <Svg width={(height * 112) / 48} height={height} viewBox="0 0 112 48">
      <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      <SvgText x="56" y="36" fontSize="31" fontWeight="500" fill="#5F6368">Pay</SvgText>
    </Svg>
  );
}

/** PhonePe's own app icon (the white "पे" on its purple circle) and its name. */
function PhonePeMark({ height = 22 }: { height?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <Image source={require('./assets/phonepe.png')} style={{ width: height, height }} />
      <Text style={{ fontSize: height * 0.68, fontWeight: '800', color: '#5F259F' }}>PhonePe</Text>
    </View>
  );
}

/** "Pay with" buttons, one per app, each with its mark. */
export function UpiButtons({ onPay, disabled }: { onPay: (app: UpiApp) => void; disabled?: boolean }) {
  return (
    <View style={st.row}>
      {UPI_APPS.map(a => (
        <Pressable key={a.key} onPress={disabled ? undefined : () => onPay(a)} accessibilityLabel={`Pay with ${a.name}`}
          style={({ pressed }) => [st.btn, pressed && { opacity: 0.8 }, disabled && { opacity: 0.5 }]}>
          {a.key === 'gpay' ? <GPayMark /> : <PhonePeMark />}
        </Pressable>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  btn: { flex: 1, height: 48, borderRadius: radius.m, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white,
    alignItems: 'center', justifyContent: 'center' },
});
