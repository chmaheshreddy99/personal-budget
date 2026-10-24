/**
 * Purchases & expenses: raw material that came in (cement, sand, gravel …) and the production expenses (diesel, power,
 * repairs …), each with a photo of its bill; a new purchase or expense, the bill photographed before saving.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Check, PackageCheck, Paperclip, Plus, Receipt } from 'lucide-react-native';
import { useApp, useLoad } from '../state';
import { useNav } from '../nav';
import { colors } from '../theme';
import { isoDate, money, qty, shortDate } from '../format';
import { ExpenseView, Production, PurchaseView } from '../types';
import { PickedFile } from '../native';
import { Button, Card, Chips, Empty, Facts, Field, List, Loading, Row, Screen, SectionTitle, Select, Sheet } from '../ui';
import { EvidenceGallery, EvidencePicker, uploadAll } from '../evidence';
import { DateField, num, useAct } from './common';

export function PurchasesScreen() {
  const app = useApp();
  const nav = useNav();
  const res = useLoad<Production>('/bricks/production');
  const [tab, setTab] = useState<'purchases' | 'expenses'>('purchases');
  const [openP, setOpenP] = useState<PurchaseView | null>(null);
  const [openE, setOpenE] = useState<ExpenseView | null>(null);
  const month = isoDate().slice(0, 7);
  const purchases = [...(res.data?.purchases || [])].sort((a, b) => b.purchase.receivedOn.localeCompare(a.purchase.receivedOn) || b.purchase.id - a.purchase.id);
  const expenses = [...(res.data?.expenses || [])].sort((a, b) => b.expense.spentOn.localeCompare(a.expense.spentOn) || b.expense.id - a.expense.id);
  const spent = tab === 'purchases'
    ? purchases.filter(p => p.purchase.receivedOn.startsWith(month)).reduce((s, p) => s + (p.purchase.amount || 0), 0)
    : expenses.filter(e => e.expense.spentOn.startsWith(month)).reduce((s, e) => s + e.expense.amount, 0);
  const record = app.profile?.record;
  return (
    <Screen title="Purchases & expenses" subtitle={`${money(spent)} this month`} onBack={nav.stack.length ? () => nav.pop() : undefined}
      refreshing={res.refreshing} onRefresh={res.reload} stale={res.stale} error={res.error}
      footer={record ? (
        <>
          <Button title="Material in" Icon={PackageCheck} kind="dark" onPress={() => nav.push('NewPurchase')} />
          <Button title="Expense" Icon={Plus} onPress={() => nav.push('NewExpense')} />
        </>
      ) : undefined}>
      <Chips value={tab} onChange={setTab} options={[{ value: 'purchases', label: `Raw material · ${purchases.length}` }, { value: 'expenses', label: `Expenses · ${expenses.length}` }]} />
      {!res.data ? <Loading /> : tab === 'purchases' ? (purchases.length ? (
        <List>
          {purchases.slice(0, 120).map((p, i) => (
            <Row key={p.purchase.id} Icon={PackageCheck} tone="violet" title={`${p.material} · ${qty(p.purchase.quantity)} ${p.unit}`}
              sub={[shortDate(p.purchase.receivedOn), p.purchase.vendor, p.purchase.billNo ? `Bill ${p.purchase.billNo}` : null].filter(Boolean).join(' · ')}
              right={p.purchase.amount ? money(p.purchase.amount) : '—'} rightSub={p.purchase.rate ? `@ ${money(p.purchase.rate, 2)}` : null}
              onPress={() => setOpenP(p)} last={i === Math.min(purchases.length, 120) - 1} />
          ))}
        </List>
      ) : <Empty Icon={PackageCheck} title="No raw material bought yet" />) : (expenses.length ? (
        <List>
          {expenses.slice(0, 120).map((e, i) => (
            <Row key={e.expense.id} Icon={Receipt} tone="accent" title={e.expense.head}
              sub={[shortDate(e.expense.spentOn), e.expense.description, e.expense.vendor].filter(Boolean).join(' · ')} right={money(e.expense.amount)}
              rightSub={e.account} onPress={() => setOpenE(e)} last={i === Math.min(expenses.length, 120) - 1} />
          ))}
        </List>
      ) : <Empty Icon={Receipt} title="No expenses yet" />)}

      {openP ? (
        <Sheet visible onClose={() => setOpenP(null)} title={`${openP.material} · ${qty(openP.purchase.quantity)} ${openP.unit}`}>
          <Facts items={[['Received', shortDate(openP.purchase.receivedOn)], ['Amount', openP.purchase.amount ? money(openP.purchase.amount) : null],
            ['Rate', openP.purchase.rate ? `${money(openP.purchase.rate, 2)} a ${openP.unit}` : null], ['Supplier', openP.purchase.vendor], ['Bill no.', openP.purchase.billNo],
            ['Vehicle', openP.purchase.vehicleNo], ['Paid from', openP.account], ['Entry', openP.entryNo], ['Recorded by', openP.purchase.createdBy], ['Note', openP.purchase.note]]} />
          {openP.purchase.journalEntryId ? (
            <>
              <SectionTitle title="Bill and evidence" Icon={Paperclip} />
              <EvidenceGallery entryId={openP.purchase.journalEntryId} canAdd={record} />
            </>
          ) : null}
        </Sheet>
      ) : null}
      {openE ? (
        <Sheet visible onClose={() => setOpenE(null)} title={`${openE.expense.head} · ${money(openE.expense.amount)}`}>
          <Facts items={[['Spent', shortDate(openE.expense.spentOn)], ['For', openE.expense.description], ['Paid to', openE.expense.vendor], ['Bill no.', openE.expense.billNo],
            ['Paid from', openE.account], ['Batch', openE.batchNo], ['Entry', openE.entryNo], ['Recorded by', openE.expense.createdBy]]} />
          {openE.expense.journalEntryId ? (
            <>
              <SectionTitle title="Bill and evidence" Icon={Paperclip} />
              <EvidenceGallery entryId={openE.expense.journalEntryId} canAdd={record} />
            </>
          ) : null}
        </Sheet>
      ) : null}
    </Screen>
  );
}

function usePayFrom() {
  const app = useApp();
  const [accountId, setAccountId] = useState<number | null>(null);
  useEffect(() => {
    app.loadMeta();
    app.loadAccounts().then(a => setAccountId(id => id ?? app.meta?.settings.payAccountId ?? a.find(x => x.accountType === 'CASH')?.id ?? a[0]?.id ?? null));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return [accountId, setAccountId] as const;
}

/** After saving: the bill photos go to the entry the purchase or expense made. */
async function sendEvidence(app: ReturnType<typeof useApp>, files: PickedFile[], entryId: number | null | undefined) {
  if (!files.length || !entryId) return;
  const failed = await uploadAll(app.session, files, { entryId });
  if (failed) app.say(`${failed} photo${failed === 1 ? '' : 's'} could not be sent: add them again from the list`, 'bad');
}

export function NewPurchaseScreen() {
  const app = useApp();
  const nav = useNav();
  const { busy, run } = useAct();
  const [materialId, setMaterialId] = useState<number | null>(null);
  const [day, setDay] = useState(isoDate());
  const [quantity, setQuantity] = useState('');
  const [rate, setRate] = useState('');
  const [vendor, setVendor] = useState('');
  const [billNo, setBillNo] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [accountId, setAccountId] = usePayFrom();
  const materials = (app.meta?.materials || []).filter(m => m.active !== false);
  const m = materials.find(x => x.id === materialId);
  useEffect(() => { if (m && !rate && m.lastRate) setRate(String(m.lastRate)); }, [materialId]); // eslint-disable-line react-hooks/exhaustive-deps
  const amount = num(quantity) * num(rate);

  const save = async () => {
    const out = await run('save', () => app.call<PurchaseView>('/bricks/purchases', { method: 'POST', body: { materialId, receivedOn: day, quantity: num(quantity),
      rate: rate ? num(rate) : null, amount: rate ? Math.round(amount * 100) / 100 : null, vendor: vendor.trim() || null, billNo: billNo.trim() || null,
      vehicleNo: vehicleNo.trim() || null, accountId, note: note.trim() || null } }), `${m?.name} · ${qty(num(quantity))} ${m?.unit} recorded`);
    if (out && 'purchase' in out) {
      await sendEvidence(app, files, out.purchase.journalEntryId);
      nav.pop();
    }
  };

  return (
    <Screen title="Raw material in" subtitle="A purchase that reached the yard" onBack={() => nav.pop()}
      footer={<Button title={amount ? `Save · ${money(amount)}` : 'Save'} Icon={Check} busy={busy === 'save'} disabled={!materialId || num(quantity) <= 0} onPress={save} />}>
      <Card style={{ gap: 12 }}>
        <Select label="Material" value={materialId} onChange={setMaterialId} options={materials.map(x => ({ value: x.id, label: x.name, sub: x.unit }))} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Field label={`Quantity${m ? ` (${m.unit})` : ''}`} style={{ flex: 1 }} keyboardType="decimal-pad" value={quantity} onChangeText={setQuantity} />
          <Field label="Rate (₹)" style={{ flex: 1 }} keyboardType="decimal-pad" value={rate} onChangeText={setRate} hint={m?.lastRate ? `Last ${money(m.lastRate, 2)}` : undefined} />
        </View>
        <DateField label="Received on" value={day} onChange={setDay} />
        <Field label="Supplier" value={vendor} onChangeText={setVendor} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Field label="Bill no." style={{ flex: 1 }} value={billNo} onChangeText={setBillNo} />
          <Field label="Vehicle no." style={{ flex: 1 }} value={vehicleNo} onChangeText={setVehicleNo} autoCapitalize="characters" />
        </View>
        <Select label="Paid from" value={accountId} onChange={setAccountId} options={app.accounts.map(a => ({ value: a.id, label: a.name }))} />
        <Field label="Note (optional)" value={note} onChangeText={setNote} />
      </Card>
      <SectionTitle title="Photo of the bill" Icon={Paperclip} />
      <Card><EvidencePicker files={files} onChange={setFiles} /></Card>
    </Screen>
  );
}

export function NewExpenseScreen() {
  const app = useApp();
  const nav = useNav();
  const { busy, run } = useAct();
  const [head, setHead] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState(isoDate());
  const [description, setDescription] = useState('');
  const [vendor, setVendor] = useState('');
  const [billNo, setBillNo] = useState('');
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [accountId, setAccountId] = usePayFrom();
  const heads = app.meta?.expenseHeads || [];

  const save = async () => {
    const out = await run('save', () => app.call<ExpenseView>('/bricks/expenses', { method: 'POST', body: { head, description: description.trim() || null,
      vendor: vendor.trim() || null, billNo: billNo.trim() || null, amount: num(amount), spentOn: day, accountId, batchId: null } }), `${head} · ${money(num(amount))} recorded`);
    if (out && 'expense' in out) {
      await sendEvidence(app, files, out.expense.journalEntryId);
      nav.pop();
    }
  };

  return (
    <Screen title="Production expense" subtitle="Diesel, power, repairs, food …" onBack={() => nav.pop()}
      footer={<Button title="Save expense" Icon={Check} busy={busy === 'save'} disabled={!head || num(amount) <= 0} onPress={save} />}>
      <Card style={{ gap: 12 }}>
        <Select label="Head" value={head} onChange={setHead} options={heads.map(h => ({ value: h, label: h }))} />
        <Field label="Amount (₹)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
        <DateField label="Spent on" value={day} onChange={setDay} />
        <Field label="What for" value={description} onChangeText={setDescription} placeholder="e.g. 50 L diesel for the loader" />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Field label="Paid to" style={{ flex: 1 }} value={vendor} onChangeText={setVendor} />
          <Field label="Bill no." style={{ flex: 1 }} value={billNo} onChangeText={setBillNo} />
        </View>
        <Select label="Paid from" value={accountId} onChange={setAccountId} options={app.accounts.map(a => ({ value: a.id, label: a.name }))} />
      </Card>
      <SectionTitle title="Photo of the bill" Icon={Paperclip} />
      <Card><EvidencePicker files={files} onChange={setFiles} /></Card>
      <Text style={xs.note}>The bill is kept with the entry, for the accountant and the checker.</Text>
    </Screen>
  );
}

const xs = StyleSheet.create({ note: { fontSize: 12, color: colors.muted, textAlign: 'center' } });
