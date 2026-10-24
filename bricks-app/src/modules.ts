/**
 * The screens the web app can give (Settings → Bricks app), as the phone shows them: a name, an icon, a tone and the
 * screen that opens. The bottom bar holds Home, the first three given (in TAB_ORDER) and More; the rest are on Home
 * and under More.
 */
import {
  Banknote, Bell, BrickWall, ChartColumn, ClipboardCheck, Factory, Gauge, Landmark, LucideIcon, Receipt, ShoppingCart, Truck, Users,
} from 'lucide-react-native';
import { RouteName } from './nav';
import { Tone } from './theme';
import { ModuleKey, Profile } from './types';

export type ModuleLook = { key: ModuleKey; label: string; short: string; Icon: LucideIcon; tone: Tone; route: RouteName; hint: string };

export const MODULES: Record<ModuleKey, ModuleLook> = {
  DASHBOARD: { key: 'DASHBOARD', label: 'Dashboard', short: 'Dashboard', Icon: Gauge, tone: 'info', route: 'Dashboard', hint: 'Sales, profit, dues' },
  APPROVALS: { key: 'APPROVALS', label: 'Approvals', short: 'Approvals', Icon: ClipboardCheck, tone: 'accent', route: 'Approvals', hint: 'Review and decide' },
  ORDERS: { key: 'ORDERS', label: 'Orders', short: 'Orders', Icon: ShoppingCart, tone: 'info', route: 'Orders', hint: 'Customers and orders' },
  DELIVERIES: { key: 'DELIVERIES', label: 'Deliveries', short: 'Trips', Icon: Truck, tone: 'accent', route: 'Deliveries', hint: 'Trips to run' },
  PAYMENTS: { key: 'PAYMENTS', label: 'Payments', short: 'Payments', Icon: Banknote, tone: 'good', route: 'Payments', hint: 'Collect and verify' },
  STOCK: { key: 'STOCK', label: 'Stock', short: 'Stock', Icon: BrickWall, tone: 'neutral', route: 'Stock', hint: 'Blocks and material' },
  PRODUCTION: { key: 'PRODUCTION', label: 'Production', short: 'Production', Icon: Factory, tone: 'warn', route: 'Production', hint: 'Batches made' },
  PURCHASES: { key: 'PURCHASES', label: 'Purchases & expenses', short: 'Purchases', Icon: Receipt, tone: 'violet', route: 'Purchases', hint: 'Bills with photos' },
  TEAM: { key: 'TEAM', label: 'Team & pay', short: 'Team', Icon: Users, tone: 'info', route: 'Team', hint: 'Wages and advances' },
  CASHBOOK: { key: 'CASHBOOK', label: 'Cash & bank', short: 'Cash', Icon: Landmark, tone: 'good', route: 'Cashbook', hint: 'Balances' },
  REPORTS: { key: 'REPORTS', label: 'Reports', short: 'Reports', Icon: ChartColumn, tone: 'info', route: 'Reports', hint: 'Profit and costs' },
  ALERTS: { key: 'ALERTS', label: 'Alerts', short: 'Alerts', Icon: Bell, tone: 'warn', route: 'Alerts', hint: 'What happened' },
};

const TAB_ORDER: ModuleKey[] = ['APPROVALS', 'ORDERS', 'DELIVERIES', 'PRODUCTION', 'PURCHASES', 'STOCK', 'DASHBOARD', 'PAYMENTS', 'TEAM', 'CASHBOOK', 'REPORTS'];

/** The screens in the bottom bar: approvals first for a checker, else what the role does most. */
export function tabsFor(p: Profile | null): ModuleKey[] {
  if (!p) return [];
  const order: ModuleKey[] = p.permissions.includes('APPROVE') ? TAB_ORDER : [...TAB_ORDER.filter(k => k !== 'APPROVALS'), 'APPROVALS'];
  return order.filter(k => p.modules.includes(k)).slice(0, 3);
}

/** The screens given, in a steady order (Home's grid and More). */
export function given(p: Profile | null): ModuleLook[] {
  if (!p) return [];
  return (Object.keys(MODULES) as ModuleKey[]).filter(k => p.modules.includes(k)).map(k => MODULES[k]);
}
