/**
 * Stock: the grey blocks in the yard by type (ready, curing, booked, free to sell) and the raw material left.
 * Production: the batches made, and a new batch: what each type came to (and how many broke), and the raw material
 * counted after it (the server works out what the batch used from the count before and what came in since).
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BrickWall, Check, ChevronDown, ChevronUp, Factory, Plus, TriangleAlert } from 'lucide-react-native';
import { useApp, useLoad } from '../state';
import { useNav } from '../nav';
import { colors, space } from '../theme';
import { count, isoDate, money, qty, shortDate } from '../format';
import { BatchView, MaterialFlow, Production } from '../types';
import { Badge, Banner, Bar, Button, Card, Empty, Field, Grid, Loading, Screen, SectionTitle, Select, Stat, st } from '../ui';
import { DateField, Note, num, TypeDot, useAct } from './common';

export function StockScreen() {
  const nav = useNav();
  const res = useLoad<Production>('/bricks/production');
  const p = res.data;
  const stock = p?.stock || [];
  const sum = (k: 'inYard' | 'ready' | 'curing' | 'booked' | 'available') => stock.reduce((s, t) => s + t[k], 0);
  return (
    <Screen title="Stock" subtitle="Grey blocks and raw material" onBack={nav.stack.length ? () => nav.pop() : undefined}
      refreshing={res.refreshing} onRefresh={res.reload} stale={res.stale} error={res.error}>
      {!p ? <Loading /> : (
        <>
          <Grid>
            <Stat label="Free to sell" value={count(sum('available'))} sub={`${count(sum('booked'))} booked for orders`} Icon={BrickWall} tone="good" />
            <Stat label="In the yard" value={count(sum('inYard'))} sub={`${count(sum('ready'))} ready · ${count(sum('curing'))} curing`} Icon={Factory} tone="warn" />
          </Grid>
          <SectionTitle title="By type" Icon={BrickWall} />
          {stock.map(t => (
            <Card key={t.brickTypeId} style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TypeDot color={t.color} />
                <Text style={ps.name}>{t.name}</Text>
                <View style={{ flex: 1 }} />
                <Text style={ps.big}>{count(t.available)}</Text>
              </View>
              <Bar value={t.ready} max={Math.max(1, t.inYard)} color={colors.green} />
              <View style={ps.cells}>
                <Cell label="Ready" value={count(t.ready)} />
                <Cell label="Curing" value={count(t.curing)} />
                <Cell label="Booked" value={count(t.booked)} />
                <Cell label="Made" value={count(t.produced)} />
                <Cell label="Delivered" value={count(t.delivered)} />
              </View>
            </Card>
          ))}
          <SectionTitle title="Raw material" />
          <Card style={{ gap: 12 }}>
            {(p.materials || []).map(m => (
              <View key={m.materialId} style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={ps.name}>{m.name}</Text>
                  {m.low ? <Badge text="Low" tone="bad" Icon={TriangleAlert} /> : null}
                  <View style={{ flex: 1 }} />
                  <Text style={ps.amt}>{qty(m.stock)} {m.unit}</Text>
                </View>
                {m.reorderLevel ? <Bar value={m.stock} max={m.reorderLevel * 3} color={m.low ? colors.red : colors.slate} /> : null}
                <Text style={ps.sub}>{[m.reorderLevel ? `Reorder at ${qty(m.reorderLevel)} ${m.unit}` : null, m.avgDailyUse ? `uses ~${qty(m.avgDailyUse)} a day` : null,
                  m.daysLeft !== null ? `lasts ~${m.daysLeft} day${m.daysLeft === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || ' '}</Text>
              </View>
            ))}
          </Card>
          {p.stockIssues?.length ? <Banner Icon={TriangleAlert} tone="warn" text={`The kept stock of ${p.stockIssues.map(i => i.name).join(', ')} differs from its records: recount it on the web app.`} /> : null}
        </>
      )}
    </Screen>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={ps.cellValue}>{value}</Text>
      <Text style={ps.cellLabel}>{label}</Text>
    </View>
  );
}

export function ProductionScreen() {
  const app = useApp();
  const nav = useNav();
  const res = useLoad<Production>('/bricks/production');
  const batches = res.data?.batches || [];
  const [open, setOpen] = useState<number | null>(null);
  const month = isoDate().slice(0, 7);
  const thisMonth = batches.filter(b => b.batch.producedOn.startsWith(month));
  const made = thisMonth.reduce((s, b) => s + b.good, 0);
  const broken = thisMonth.reduce((s, b) => s + b.damaged, 0);
  const canAdd = app.profile?.record && app.has('PRODUCTION');
  return (
    <Screen title="Production" subtitle={`${batches.length} batches`} onBack={nav.stack.length ? () => nav.pop() : undefined}
      refreshing={res.refreshing} onRefresh={res.reload} stale={res.stale} error={res.error}
      footer={canAdd ? <Button title="Record a batch" Icon={Plus} onPress={() => nav.push('NewBatch')} /> : undefined}>
      {!res.data ? <Loading /> : (
        <>
          <Grid>
            <Stat label="Made this month" value={count(made)} sub={`${thisMonth.length} batches`} Icon={Factory} tone="warn" />
            <Stat label="Broken" value={count(broken)} sub={made + broken ? `${((broken / (made + broken)) * 100).toFixed(1)}% of what was made` : ' '} Icon={TriangleAlert}
              tone={broken ? 'bad' : 'neutral'} />
          </Grid>
          {batches.length ? batches.map(b => <BatchCard key={b.batch.id} b={b} open={open === b.batch.id} onToggle={() => setOpen(open === b.batch.id ? null : b.batch.id)} />)
            : <Empty Icon={Factory} title="No batches yet" />}
        </>
      )}
    </Screen>
  );
}

function BatchCard({ b, open, onToggle }: { b: BatchView; open: boolean; onToggle: () => void }) {
  return (
    <Card onPress={onToggle} style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={ps.name}>{b.batch.batchNo}</Text>
        <Text style={ps.sub}>{shortDate(b.batch.producedOn)}{b.teamName ? ` · ${b.teamName}` : ''}</Text>
        <View style={{ flex: 1 }} />
        {b.paidOn ? <Badge text="Paid" tone="good" /> : null}
        {open ? <ChevronUp color={colors.muted} size={18} /> : <ChevronDown color={colors.muted} size={18} />}
      </View>
      <Text style={ps.sub}>{count(b.good)} good{b.damaged ? ` · ${count(b.damaged)} broken` : ''}{b.labour ? ` · labour ${money(b.labour)}` : ''}</Text>
      {open ? (
        <View style={{ gap: 6, marginTop: 4 }}>
          {b.items.map(i => (
            <View key={i.brickTypeId} style={ps.line}>
              <TypeDot color={i.color} />
              <Text style={[ps.sub, { flex: 1, color: colors.text }]}>{i.name}</Text>
              <Text style={ps.sub}>{count(i.good)}{i.damaged ? ` (+${count(i.damaged)} broken)` : ''}</Text>
            </View>
          ))}
          {b.materials.filter(m => m.consumed).length ? <Text style={st.factLabel}>Raw material used</Text> : null}
          {b.materials.filter(m => m.consumed).map(m => (
            <View key={m.materialId} style={ps.line}>
              <Text style={[ps.sub, { flex: 1 }]}>{m.name}</Text>
              <Text style={ps.sub}>{qty(m.consumed)} {m.unit}</Text>
            </View>
          ))}
          {b.batch.note ? <Note text={b.batch.note} /> : null}
          {b.batch.createdBy ? <Note text={`Recorded by ${b.batch.createdBy}`} /> : null}
        </View>
      ) : null}
    </Card>
  );
}

export function NewBatchScreen() {
  const app = useApp();
  const nav = useNav();
  const { busy, run } = useAct();
  const [day, setDay] = useState(isoDate());
  const [teamId, setTeamId] = useState<number | null>(null);
  const [made, setMade] = useState<Record<number, { qty: string; damaged: string }>>({});
  const [closing, setClosing] = useState<Record<number, string>>({});
  const [flows, setFlows] = useState<MaterialFlow[] | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    app.loadMeta().then(m => {
      const teams = (m?.resources || []).filter(r => r.active !== false && /PRODUCTION/i.test(r.role));
      setTeamId(t => t ?? teams.find(r => r.defaultTeam)?.id ?? teams[0]?.id ?? null);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // the raw material before the batch: the last count and what came in since
  useEffect(() => {
    app.call<MaterialFlow[]>(`/bricks/batches/preview?date=${day}`, { method: 'POST', body: {} }).then(setFlows).catch(() => setFlows([]));
  }, [day]); // eslint-disable-line react-hooks/exhaustive-deps

  const types = (app.meta?.types || []).filter(t => t.active !== false);
  const teams = (app.meta?.resources || []).filter(r => r.active !== false && /PRODUCTION/i.test(r.role));
  const items = types.map(t => ({ brickTypeId: t.id, quantity: Math.round(num(made[t.id]?.qty || '')), damaged: Math.round(num(made[t.id]?.damaged || '')) }))
    .filter(i => i.quantity > 0 || i.damaged > 0);
  const total = items.reduce((s, i) => s + i.quantity, 0);

  const save = async () => {
    const materials = Object.entries(closing).filter(([, v]) => v.trim() !== '').map(([k, v]) => ({ materialId: Number(k), closing: num(v) }));
    const out = await run('save', () => app.call<BatchView>('/bricks/batches', { method: 'POST', body: { producedOn: day, teamId, pricingModelId: null, note: note.trim() || null, items, materials } }),
      b => `Batch ${b.batch?.batchNo || ''} recorded · ${count(total)} blocks`);
    if (out) nav.pop();
  };

  return (
    <Screen title="Record a batch" subtitle="What the team made" onBack={() => nav.pop()}
      footer={<Button title={`Save batch · ${count(total)} blocks`} Icon={Check} busy={busy === 'save'} disabled={!items.length} onPress={save} />}>
      <Card style={{ gap: 12 }}>
        <DateField label="Made on" value={day} onChange={setDay} />
        {teams.length ? <Select label="Team" value={teamId} onChange={setTeamId} options={teams.map(t => ({ value: t.id, label: t.name, sub: t.memberCount ? `${t.memberCount} people` : undefined }))} /> : null}
      </Card>
      <SectionTitle title="Blocks made" Icon={Factory} />
      <Card style={{ gap: 14 }}>
        {types.length ? types.map(t => (
          <View key={t.id} style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><TypeDot color={t.color} /><Text style={ps.name}>{t.name}</Text></View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Field label="Good" style={{ flex: 1 }} keyboardType="number-pad" placeholder="0" value={made[t.id]?.qty || ''}
                onChangeText={x => setMade(s => ({ ...s, [t.id]: { qty: x, damaged: s[t.id]?.damaged || '' } }))} />
              <Field label="Broken" style={{ flex: 1 }} keyboardType="number-pad" placeholder="0" value={made[t.id]?.damaged || ''}
                onChangeText={x => setMade(s => ({ ...s, [t.id]: { qty: s[t.id]?.qty || '', damaged: x } }))} />
            </View>
          </View>
        )) : <Loading text="Loading the brick types…" />}
      </Card>
      <SectionTitle title="Raw material left after the batch" />
      <Card style={{ gap: 12 }}>
        <Note text="Count what is left in the yard. Leave a material empty when it was not counted." />
        {flows === null ? <Loading /> : flows.map(f => {
          const left = closing[f.materialId];
          const there = Number(f.opening) + Number(f.received);
          const over = left !== undefined && left.trim() !== '' && num(left) > there;
          return (
            <Field key={f.materialId} label={`${f.name} (${f.unit})`} keyboardType="decimal-pad" value={left || ''} placeholder={`There was ${qty(there)}`}
              onChangeText={x => setClosing(s => ({ ...s, [f.materialId]: x }))}
              hint={`Before: ${qty(f.opening)} · came in: ${qty(f.received)}${left && !over ? ` · used ${qty(there - num(left))}` : ''}`}
              error={over ? `More than there was (${qty(there)})` : undefined} />
          );
        })}
      </Card>
      <Field label="Note (optional)" value={note} onChangeText={setNote} multiline style={{ marginTop: space.s }} />
    </Screen>
  );
}

const ps = StyleSheet.create({
  name: { fontSize: 15, fontWeight: '800', color: colors.text },
  sub: { fontSize: 12.5, color: colors.text2 },
  big: { fontSize: 20, fontWeight: '900', color: colors.text },
  amt: { fontSize: 15, fontWeight: '800', color: colors.text },
  cells: { flexDirection: 'row', marginTop: 2 },
  cellValue: { fontSize: 14, fontWeight: '800', color: colors.text },
  cellLabel: { fontSize: 10.5, color: colors.muted, fontWeight: '700' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
