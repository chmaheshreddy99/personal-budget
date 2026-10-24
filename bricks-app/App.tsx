/**
 * Bricks for Android: the grey blocks business on the phone. It signs in to the Personal Budget server as the Bricks
 * app and shows only the screens the web app gives the user (Settings → Bricks app): approvals (check the evidence,
 * approve or reject with a reason), orders, deliveries, payments, stock, production, purchases and expenses, the team's
 * pay, cash and bank, the dashboard and reports, and alerts.
 *
 * The bottom bar: Home, the three screens the user needs most, More. Other screens open over it (see src/nav.tsx).
 */
import React, { useEffect } from 'react';
import { BackHandler, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CloudOff, House, LayoutGrid, LogOut, RefreshCw } from 'lucide-react-native';
import { AppProvider, useApp } from './src/state';
import { NavProvider, Route, useNav } from './src/nav';
import { MODULES, tabsFor } from './src/modules';
import { colors } from './src/theme';
import { Button, Empty, Screen, ToastView } from './src/ui';
import { LoginScreen } from './src/screens/Login';
import { HomeScreen } from './src/screens/Home';
import { ApprovalScreen, ApprovalsScreen } from './src/screens/Approvals';
import { NewOrderScreen, OrderScreen, OrdersScreen } from './src/screens/Orders';
import { DeliveriesScreen, PaymentsScreen } from './src/screens/Deliveries';
import { NewBatchScreen, ProductionScreen, StockScreen } from './src/screens/Production';
import { NewExpenseScreen, NewPurchaseScreen, PurchasesScreen } from './src/screens/Purchases';
import { CashbookScreen, DashboardScreen, ReportsScreen } from './src/screens/Finance';
import { PaySlipScreen, TeamScreen } from './src/screens/Team';
import { DocScreen } from './src/screens/Doc';
import { AlertsScreen, LockedScreen, MoreScreen, PasswordScreen, Splash } from './src/screens/More';
import { ModuleKey } from './src/types';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.ink} />
      <NavProvider>
        <AppProvider>
          <Shell />
        </AppProvider>
      </NavProvider>
    </SafeAreaProvider>
  );
}

function Shell() {
  const app = useApp();
  let body: React.ReactNode;
  if (!app.ready) body = <Splash />;
  else if (!app.session.token) body = <LoginScreen />;
  else if (app.mustChangePassword) body = <PasswordScreen forced />;
  else if (!app.profile) body = <NoProfile />;
  else if (!app.profile.modules.length) body = <LockedScreen />;
  else body = <Main />;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {body}
      <ToastView toast={app.toast} />
    </View>
  );
}

/** Signed in, but the profile could not be loaded (no signal the first time). */
function NoProfile() {
  const app = useApp();
  const [busy, setBusy] = React.useState(true);
  useEffect(() => { app.refreshProfile().finally(() => setBusy(false)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (busy) return <Splash />;
  return (
    <Screen title="Bricks">
      <Empty Icon={CloudOff} title="The server does not answer" text={`Check the signal, or that ${app.session.server} is running.`}
        action={(
          <View style={{ gap: 10, alignSelf: 'stretch', marginTop: 12 }}>
            <Button title="Try again" Icon={RefreshCw} onPress={async () => { setBusy(true); await app.refreshProfile(); setBusy(false); }} />
            <Button title="Sign out" Icon={LogOut} kind="ghost" onPress={app.signOut} />
          </View>
        )} />
    </Screen>
  );
}

function screenFor(r: Pick<Route, 'name' | 'params'>): React.ReactNode {
  switch (r.name) {
    case 'Approvals': return <ApprovalsScreen />;
    case 'Approval': return <ApprovalScreen id={r.params.id} />;
    case 'Orders': return <OrdersScreen />;
    case 'Order': return <OrderScreen id={r.params.id} />;
    case 'NewOrder': return <NewOrderScreen />;
    case 'Deliveries': return <DeliveriesScreen />;
    case 'Payments': return <PaymentsScreen />;
    case 'Stock': return <StockScreen />;
    case 'Production': return <ProductionScreen />;
    case 'NewBatch': return <NewBatchScreen />;
    case 'Purchases': return <PurchasesScreen />;
    case 'NewPurchase': return <NewPurchaseScreen />;
    case 'NewExpense': return <NewExpenseScreen />;
    case 'Team': return <TeamScreen />;
    case 'Cashbook': return <CashbookScreen />;
    case 'Reports': return <ReportsScreen />;
    case 'Dashboard': return <DashboardScreen />;
    case 'Alerts': return <AlertsScreen />;
    case 'Account': return <MoreScreen />;
    case 'Password': return <PasswordScreen />;
    case 'Doc': return <DocScreen params={r.params} />;
    case 'PaySlip': return <PaySlipScreen resourceId={r.params.resourceId} cycle={r.params.cycle} from={r.params.from} to={r.params.to} />;
    default: return null;
  }
}

function Main() {
  const app = useApp();
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const tabs = tabsFor(app.profile);

  // a tab no longer given (changed on the web app): back to Home
  useEffect(() => {
    if (nav.tab !== 'home' && nav.tab !== 'more' && !tabs.includes(nav.tab as ModuleKey)) nav.setTab('home');
  }, [tabs.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Back: the top screen closes, then Home, then out of the app
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (nav.stack.length) { nav.pop(); return true; }
      if (nav.tab !== 'home') { nav.setTab('home'); return true; }
      return false;
    });
    return () => sub.remove();
  }, [nav]);

  const root = nav.tab === 'home' ? <HomeScreen /> : nav.tab === 'more' ? <MoreScreen asTab /> : screenFor({ name: MODULES[nav.tab as ModuleKey].route, params: {} });
  const items: { key: string; label: string; Icon: any; badge?: number }[] = [
    { key: 'home', label: 'Home', Icon: House },
    ...tabs.map(k => ({ key: k, label: MODULES[k].short, Icon: MODULES[k].Icon, badge: k === 'APPROVALS' ? app.profile?.pendingApprovals : undefined })),
    { key: 'more', label: 'More', Icon: LayoutGrid },
  ];

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <View style={[StyleSheet.absoluteFill, nav.stack.length ? sx.hidden : null]}>{root}</View>
        {nav.stack.map((r, i) => (
          <View key={r.key} style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }, i < nav.stack.length - 1 ? sx.hidden : null]}>{screenFor(r)}</View>
        ))}
      </View>
      {!nav.stack.length ? (
        <View style={[sx.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          {items.map(t => {
            const on = nav.tab === t.key;
            return (
              <Pressable key={t.key} onPress={() => nav.setTab(t.key)} style={sx.tab} android_ripple={{ color: '#00000010', borderless: true }}>
                <View style={[sx.iconWrap, on && sx.iconOn]}>
                  <t.Icon color={on ? colors.orange : colors.muted} size={21} strokeWidth={on ? 2.4 : 2} />
                  {t.badge ? <View style={sx.badge}><Text style={sx.badgeText}>{t.badge > 99 ? '99+' : t.badge}</Text></View> : null}
                </View>
                <Text style={[sx.label, on && { color: colors.text, fontWeight: '800' }]} numberOfLines={1}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const sx = StyleSheet.create({
  hidden: { display: 'none' },
  bar: { flexDirection: 'row', backgroundColor: colors.card, borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line, paddingTop: 6, elevation: 12, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8 },
  tab: { flex: 1, alignItems: 'center', gap: 3 },
  iconWrap: { width: 48, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  iconOn: { backgroundColor: colors.orangeSoft },
  label: { fontSize: 11, color: colors.muted, fontWeight: '600' },
  badge: { position: 'absolute', top: -2, right: 4, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: colors.red, alignItems: 'center',
    justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: colors.white, fontSize: 9.5, fontWeight: '800' },
});
