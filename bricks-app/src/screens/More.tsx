/**
 * More: who is signed in, their role and what the web app lets them do on the phone, every screen given to them, and
 * signing out or changing the password. Alerts: the notices for the user (a new order, a request and its decision, a
 * delivery the customer signed), each opening what it is about. Locked: signed in, but no screen given (yet).
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Bell, Camera, CheckCheck, ClipboardCheck, KeyRound, Lock, LogOut, Pencil, RefreshCw, Server, ShieldCheck, ShoppingCart, Truck,
} from 'lucide-react-native';
import { useApp, useLoad } from '../state';
import { RouteName, useNav } from '../nav';
import { given } from '../modules';
import { colors, space } from '../theme';
import { dateTime, initials } from '../format';
import { Notice } from '../types';
import { Avatar, Badge, Button, Card, Empty, Field, List, Loading, Row, Screen, SectionTitle } from '../ui';
import { BlocksMark, BrandMark, useAct, useBrandName } from './common';

const APP_VERSION = '1.2.1';

export function MoreScreen({ asTab }: { asTab?: boolean }) {
  const app = useApp();
  const nav = useNav();
  const p = app.profile!;
  const [busy, setBusy] = useState(false);
  const refresh = async () => { setBusy(true); await app.refreshProfile(); setBusy(false); app.say('Your access is up to date', 'info'); };
  return (
    <Screen title={asTab ? 'More' : 'Account'} subtitle={p.brandName || p.company || p.organization} onBack={asTab ? undefined : () => nav.pop()}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar text={initials(p.fullName)} size={52} />
        <View style={{ flex: 1 }}>
          <Text style={ms.name}>{p.fullName}</Text>
          <Text style={ms.sub}>@{p.username} · {p.organization}</Text>
          <View style={{ marginTop: 6 }}><Badge text={p.roleLabel} tone="accent" Icon={ShieldCheck} /></View>
        </View>
      </Card>

      <SectionTitle title="On this phone you can" />
      <List>
        <Row Icon={ClipboardCheck} tone={p.decide ? 'good' : 'neutral'} title="Approve and reject requests" right={p.decide ? 'Yes' : 'No'}
          sub={p.permissions.includes('APPROVE') ? (p.decide ? 'With a reason, after checking the evidence' : 'Switched off for the phone: use the web app') : 'Your role does not approve'} />
        <Row Icon={Pencil} tone={p.record ? 'good' : 'neutral'} title="Record" right={p.record ? 'Yes' : 'No'}
          sub={p.record ? 'Orders, batches, purchases, payments and trips, as your role allows' : 'The app only shows: record on the web app'} />
        <Row Icon={Camera} tone={p.evidence ? 'good' : 'neutral'} title="Add evidence" right={p.evidence ? 'Yes' : 'No'}
          sub="Photos of bills and slips, from the camera or files" last />
      </List>

      <SectionTitle title="Your screens" />
      <List>
        {given(p).map((m, i, all) => <Row key={m.key} Icon={m.Icon} tone={m.tone} title={m.label} sub={m.hint} onPress={() => nav.push(m.route)} last={i === all.length - 1} />)}
      </List>
      <Text style={ms.foot}>Your admin chooses these screens in the web app (Settings → Bricks app).</Text>

      <SectionTitle title="This app" />
      <List>
        <Row Icon={Server} title="Server" sub={app.session.server} />
        <Row Icon={RefreshCw} title="Check my access again" sub="After your admin changed it" onPress={busy ? undefined : refresh} />
        <Row Icon={KeyRound} title="Change password" onPress={() => nav.push('Password')} last />
      </List>
      <Button title="Sign out" kind="danger" Icon={LogOut} onPress={app.signOut} style={{ marginTop: space.s }} />
      <View style={{ alignItems: 'center', gap: 6, marginTop: space.l }}>
        <BrandMark size={36} />
        <Text style={ms.foot}>{p.brandName ? `${p.brandName} · ` : ''}Bricks {APP_VERSION}</Text>
      </View>
    </Screen>
  );
}

/** Where a notice leads: "bricks/approvals/12" → that request, "bricks/sales/40" → that order. */
function target(link: string | null): [RouteName, any] | null {
  if (!link) return null;
  const a = link.match(/approvals\/(\d+)/);
  if (a) return ['Approval', { id: Number(a[1]) }];
  const o = link.match(/sales\/(\d+)/);
  if (o) return ['Order', { id: Number(o[1]) }];
  return null;
}

const KIND_ICON: Record<string, any> = { APPROVAL: ClipboardCheck, DECISION: CheckCheck, ORDER: ShoppingCart, DELIVERY: Truck };

export function AlertsScreen() {
  const app = useApp();
  const nav = useNav();
  const res = useLoad<Notice[]>('/bricks/notices');
  const { busy, run } = useAct();
  const list = res.data || [];
  const open = async (n: Notice) => {
    app.call(`/bricks/notices/${n.id}/read`, { method: 'POST' }).then(() => { res.reload(); app.refreshProfile(); }).catch(() => undefined);
    const t = target(n.link);
    if (t && ((t[0] === 'Approval' && app.has('APPROVALS')) || (t[0] === 'Order' && (app.has('ORDERS') || app.has('DELIVERIES') || app.has('PAYMENTS'))))) nav.push(t[0], t[1]);
  };
  return (
    <Screen title="Alerts" subtitle={`${list.length} not seen`} onBack={nav.stack.length ? () => nav.pop() : undefined}
      refreshing={res.refreshing} onRefresh={res.reload} stale={res.stale} error={res.error}
      right={list.length ? <Button title="Clear" kind="ghost" small busy={busy === 'all'} onPress={() => run('all', () => app.call('/bricks/notices/read-all', { method: 'POST' }), 'All cleared')} /> : undefined}>
      {res.loading && !res.data ? <Loading /> : list.length ? (
        <List>
          {list.map((n, i) => (
            <Row key={n.id} Icon={KIND_ICON[n.kind] || Bell} tone={n.kind === 'APPROVAL' ? 'accent' : n.kind === 'DECISION' ? 'good' : 'info'} title={n.title}
              sub={`${n.body}\n${[n.actor, dateTime(n.createdAt)].filter(Boolean).join(' · ')}`} onPress={() => open(n)} last={i === list.length - 1} />
          ))}
        </List>
      ) : <Empty Icon={Bell} title="All caught up" text="New orders, requests and their decisions, and signed deliveries show up here." />}
    </Screen>
  );
}

export function PasswordScreen({ forced }: { forced?: boolean }) {
  const app = useApp();
  const nav = useNav();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (next !== again) { setErr('The new passwords differ'); return; }
    setBusy(true); setErr('');
    try {
      await app.call('/auth/password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      app.say('Password changed');
      if (forced) app.passwordChanged(); else nav.pop();
    } catch (e: any) {
      setErr(e?.message || 'The password could not be changed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title={forced ? 'Set your password' : 'Change password'} subtitle={forced ? 'Replace the password you were given' : undefined}
      onBack={forced ? undefined : () => nav.pop()} right={forced ? <Button title="Sign out" kind="ghost" small onPress={app.signOut} /> : undefined}>
      <Card style={{ gap: 12 }}>
        <Field label="Current password" secureTextEntry value={current} onChangeText={setCurrent} autoCapitalize="none" />
        <Field label="New password" secureTextEntry value={next} onChangeText={setNext} autoCapitalize="none" hint="At least 8 characters, with letters and digits" />
        <Field label="New password again" secureTextEntry value={again} onChangeText={setAgain} autoCapitalize="none" error={err || undefined} />
        <Button title="Save password" Icon={KeyRound} busy={busy} disabled={!current || next.length < 8} onPress={save} />
      </Card>
    </Screen>
  );
}

/** Signed in, but the web app gives this user no screen (or the app is switched off). */
export function LockedScreen() {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const brand = useBrandName('Bricks');
  return (
    <Screen title={brand} subtitle={app.profile?.organization}>
      <Empty Icon={Lock} title="Nothing to show yet" text={app.profile?.locked || 'Your admin has not given you any screen of the Bricks app.'}
        action={(
          <View style={{ gap: 10, alignSelf: 'stretch', marginTop: space.m }}>
            <Button title="Check again" Icon={RefreshCw} busy={busy} onPress={async () => { setBusy(true); await app.refreshProfile(); setBusy(false); }} />
            <Button title="Sign out" Icon={LogOut} kind="ghost" onPress={app.signOut} />
          </View>
        )} />
      <Text style={ms.foot}>An admin gives screens in the web app: Settings → Bricks app.</Text>
    </Screen>
  );
}

export function Splash() {
  return <View style={{ flex: 1, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}><BrandMark size={84} /><Loading text="" /></View>;
}

const ms = StyleSheet.create({
  name: { fontSize: 18, fontWeight: '800', color: colors.text },
  sub: { fontSize: 13, color: colors.text2 },
  foot: { fontSize: 12, color: colors.muted, textAlign: 'center' },
});
