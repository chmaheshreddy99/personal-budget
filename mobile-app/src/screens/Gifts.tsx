/**
 * Gifts: given and received (cash, gold, silver, items), from the server and recorded on the phone, by month, with
 * what was given and received this year. "People" shows the give-and-take with each person (tap one to see only
 * theirs), so the next wedding or birthday has the answer to "what did they give us?". "Record a gift" adds one:
 * offline too, and cash given can be booked as an expense from an account at the same time.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Check, ChevronLeft, Clock, Gem, Gift as GiftIcon, Package, Search, Trash2, Users, Wallet, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state';
import { GiftKind, isExpense } from '../data';
import { date, isoDate, money, moneyShort, shortDate } from '../format';
import { AccountBubble, Button, Card, Chip, Empty, Field, GradientPanel, IconBubble, Pill, Sheet } from '../ui';
import { colors, radius, space } from '../theme';

type Tab = 'all' | 'GIVEN' | 'RECEIVED' | 'people';

/** A gift as the list shows it: from the server, or recorded on the phone. */
type Item = { key: string; direction: 'GIVEN' | 'RECEIVED'; date: string; person: string; relation: string | null; occasion: string | null; kind: GiftKind;
  description: string | null; value: number | null; quantity: number | null; unit: string | null; mode: string | null; notes: string | null;
  booked: string | null; status?: string; message?: string; clientId?: string };

const KINDS: [GiftKind, string, any][] = [['CASH', 'Cash', Wallet], ['GOLD', 'Gold', Gem], ['SILVER', 'Silver', Gem], ['ITEM', 'Item', Package], ['OTHER', 'Other', GiftIcon]];
const KIND_LOOK: Record<string, [any, string, string]> = {
  CASH: [Wallet, colors.green, colors.greenSoft], GOLD: [Gem, colors.gold, colors.goldSoft], SILVER: [Gem, colors.muted, colors.sunken],
  ITEM: [Package, colors.violet, colors.violetSoft], OTHER: [GiftIcon, colors.coral, colors.coralSoft],
};
const OCCASIONS = ['Wedding', 'Birthday', 'Housewarming', 'Festival', 'Naming ceremony', 'Anniversary'];
const MODES = ['Cash', 'UPI', 'Bank', 'Cheque'];
const PAY_TYPES = ['BANK', 'CASH', 'WALLET', 'CREDIT_CARD'];

/** "₹5,000", "10 g gold", "Silver lamp". */
function what(i: Pick<Item, 'kind' | 'value' | 'quantity' | 'unit' | 'description'>): string {
  if (i.kind === 'CASH') return i.value != null ? money(i.value) : 'Cash';
  const qty = i.quantity ? `${i.quantity}${i.unit ? ` ${i.unit}` : ''} ` : '';
  const name = i.kind === 'GOLD' ? 'gold' : i.kind === 'SILVER' ? 'silver' : '';
  return [qty + name, i.description].filter(x => x && x.trim()).join(' · ') || (i.value != null ? money(i.value) : i.kind.toLowerCase());
}

export function GiftsScreen({ onBack }: { onBack: () => void }) {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('all');
  const [person, setPerson] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState<{ direction: 'GIVEN' | 'RECEIVED'; person?: string } | null>(null);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (person) { setPerson(null); return true; } onBack(); return true; });
    return () => sub.remove();
  }, [onBack, person]);

  const items = useMemo<Item[]>(() => {
    const local: Item[] = app.records.filter(r => r.kind === 'GIFT').map(r => ({ key: r.clientId, direction: r.payload.direction, date: r.date,
      person: r.payload.person, relation: r.payload.relation, occasion: r.payload.occasion, kind: r.payload.kind, description: r.payload.description,
      value: r.payload.value, quantity: r.payload.quantity, unit: r.payload.unit, mode: r.payload.mode, notes: r.payload.notes,
      booked: r.payload.bookAccountId ? r.accountName : null, status: r.status, message: r.message, clientId: r.clientId }));
    const server: Item[] = (app.snapshot?.gifts || []).map(g => ({ key: `s${g.id}`, direction: g.direction, date: g.date, person: g.person, relation: g.relation,
      occasion: g.occasion, kind: g.kind, description: g.description, value: g.value, quantity: g.quantity, unit: g.unit, mode: g.mode, notes: g.notes,
      booked: g.entryNo ? g.accountName : null }));
    return [...local, ...server].sort((a, b) => b.date.localeCompare(a.date));
  }, [app.records, app.snapshot]);

  const year = String(new Date().getFullYear());
  const sumValue = (list: Item[]) => list.reduce((s, i) => s + (i.value || 0), 0);
  const thisYear = items.filter(i => i.date.startsWith(year));
  const given = sumValue(thisYear.filter(i => i.direction === 'GIVEN'));
  const received = sumValue(thisYear.filter(i => i.direction === 'RECEIVED'));

  const people = useMemo(() => {
    const m = new Map<string, { name: string; relation: string | null; given: number; received: number; count: number; last: string }>();
    items.forEach(i => {
      const k = i.person.trim().toLowerCase();
      const p = m.get(k) || { name: i.person.trim(), relation: i.relation, given: 0, received: 0, count: 0, last: i.date };
      p.count++;
      if (i.direction === 'GIVEN') p.given += i.value || 0; else p.received += i.value || 0;
      if (i.date > p.last) p.last = i.date;
      p.relation = p.relation || i.relation;
      m.set(k, p);
    });
    return [...m.values()].sort((a, b) => b.last.localeCompare(a.last));
  }, [items]);

  const q = query.trim().toLowerCase();
  const shown = items.filter(i => (tab === 'GIVEN' || tab === 'RECEIVED' ? i.direction === tab : true)
    && (!person || i.person.trim().toLowerCase() === person.toLowerCase())
    && (!q || [i.person, i.relation, i.occasion, i.description, i.notes].some(v => v && v.toLowerCase().includes(q))));
  const byMonth = useMemo(() => {
    const m = new Map<string, Item[]>();
    shown.forEach(i => m.set(i.date.slice(0, 7), [...(m.get(i.date.slice(0, 7)) || []), i]));
    return [...m.entries()];
  }, [shown]);
  const shownPeople = people.filter(p => !q || p.name.toLowerCase().includes(q) || (p.relation || '').toLowerCase().includes(q));
  const one = person ? people.find(p => p.name.toLowerCase() === person.toLowerCase()) : null;
  const canRecord = app.snapshot?.canRecord !== false;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.l, paddingTop: insets.top + space.m, paddingBottom: 120, gap: space.s }}>
        <Pressable onPress={() => (person ? setPerson(null) : onBack())} style={st.back} hitSlop={8}>
          <ChevronLeft color={colors.ocean} size={20} /><Text style={st.backText}>{person ? 'All gifts' : 'More'}</Text>
        </Pressable>
        <Text style={st.h1}>{one ? one.name : 'Gifts'}</Text>
        <GradientPanel from={colors.navy} to={colors.coral}>
          {one ? (
            <>
              <Text style={st.label}>{one.relation ? one.relation.toUpperCase() : 'GIVE AND TAKE'}</Text>
              <View style={st.split}>
                <View><Text style={st.small}>Given</Text><Text style={st.big}>{money(one.given)}</Text></View>
                <View style={{ alignItems: 'flex-end' }}><Text style={st.small}>Received</Text><Text style={st.big}>{money(one.received)}</Text></View>
              </View>
              <Text style={st.small}>{one.count} gift{one.count === 1 ? '' : 's'}{one.given !== one.received ? ` · ${one.given > one.received ? 'given' : 'received'} ${money(Math.abs(one.given - one.received))} more` : ''}</Text>
            </>
          ) : (
            <>
              <Text style={st.label}>THIS YEAR</Text>
              <View style={st.split}>
                <View><Text style={st.small}>Given</Text><Text style={st.big}>{money(given)}</Text></View>
                <View style={{ alignItems: 'flex-end' }}><Text style={st.small}>Received</Text><Text style={st.big}>{money(received)}</Text></View>
              </View>
              <Text style={st.small}>{thisYear.length} gift{thisYear.length === 1 ? '' : 's'} · {people.length} people in all</Text>
            </>
          )}
        </GradientPanel>
        {canRecord ? (
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <Button title="Gave a gift" kind="soft" Icon={ArrowUpRight} onPress={() => setAdding({ direction: 'GIVEN', person: one?.name })} style={{ flex: 1, height: 42 }} />
            <Button title="Received one" kind="soft" Icon={ArrowDownLeft} onPress={() => setAdding({ direction: 'RECEIVED', person: one?.name })} style={{ flex: 1, height: 42 }} />
          </View>
        ) : null}
        <View style={st.search}>
          <Search color={colors.muted} size={16} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search a person, occasion or gift" placeholderTextColor={colors.muted} style={st.searchInput} autoCorrect={false} />
          {query ? <Pressable onPress={() => setQuery('')} hitSlop={8}><X color={colors.muted} size={16} /></Pressable> : null}
        </View>
        {!one ? (
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Chip label="All" selected={tab === 'all'} onPress={() => setTab('all')} />
            <Chip label="Given" Icon={ArrowUpRight} selected={tab === 'GIVEN'} onPress={() => setTab('GIVEN')} />
            <Chip label="Received" Icon={ArrowDownLeft} selected={tab === 'RECEIVED'} onPress={() => setTab('RECEIVED')} />
            <Chip label="People" Icon={Users} selected={tab === 'people'} onPress={() => setTab('people')} />
          </View>
        ) : null}

        {tab === 'people' && !one ? (
          shownPeople.length ? shownPeople.map(p => (
            <Card key={p.name} onPress={() => setPerson(p.name)} style={st.item}>
              <View style={st.ava}><Text style={st.avaText}>{p.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()}</Text></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={st.title} numberOfLines={1}>{p.name}</Text>
                <Text style={st.sub} numberOfLines={1}>{[p.relation, `${p.count} gift${p.count === 1 ? '' : 's'}`, `last ${shortDate(p.last)}`].filter(Boolean).join(' · ')}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[st.amount, { color: colors.red }]}>↑ {moneyShort(p.given)}</Text>
                <Text style={[st.amount, { color: colors.green }]}>↓ {moneyShort(p.received)}</Text>
              </View>
            </Card>
          )) : <Empty Icon={Users} title="No one yet" />
        ) : byMonth.length ? byMonth.map(([m, list]) => (
          <View key={m} style={{ gap: 6 }}>
            <Text style={st.month}>{date(`${m}-01`).replace(/^1 /, '')}</Text>
            {list.map(i => <GiftRow key={i.key} i={i} onPerson={() => setPerson(i.person.trim())} />)}
          </View>
        )) : (
          <Empty Icon={GiftIcon} title={q || person ? 'Nothing matches' : 'No gifts yet'}
            text={q || person ? undefined : 'Note the gifts you give and get at weddings, birthdays and festivals, and never wonder what to give back.'} />
        )}
      </ScrollView>
      {adding ? <GiftSheet direction={adding.direction} person={adding.person} known={people.map(p => p.name)} onClose={() => setAdding(null)} /> : null}
    </View>
  );
}

function GiftRow({ i, onPerson }: { i: Item; onPerson: () => void }) {
  const app = useApp();
  const [Icon, fg, bg] = KIND_LOOK[i.kind] || KIND_LOOK.OTHER;
  const given = i.direction === 'GIVEN';
  const failed = i.status === 'FAILED';
  return (
    <Card style={st.item} onPress={onPerson}>
      <IconBubble Icon={Icon} fg={fg} bg={bg} size={38} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={st.title} numberOfLines={1}>{given ? 'To' : 'From'} {i.person}</Text>
        <Text style={st.sub} numberOfLines={2}>{[i.occasion, i.kind === 'CASH' ? i.mode : what(i), shortDate(i.date), i.booked ? `booked from ${i.booked}` : null].filter(Boolean).join(' · ')}</Text>
        {i.status && i.status !== 'SYNCED' ? (
          <Pill text={failed ? `Not accepted: ${i.message || ''}` : 'Waiting to sync'} fg={failed ? colors.red : colors.gold} bg={failed ? colors.redSoft : colors.goldSoft}
            Icon={failed ? AlertTriangle : Clock} />
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <Text style={[st.amount, { color: given ? colors.red : colors.green }]}>{i.value != null ? `${given ? '↑' : '↓'} ${money(i.value)}` : given ? '↑' : '↓'}</Text>
        {i.clientId && i.status !== 'SYNCED' ? <Pressable onPress={() => app.removeRecord(i.clientId!)} hitSlop={8}><Trash2 color={colors.red} size={16} /></Pressable> : null}
      </View>
    </Card>
  );
}

/** Records a gift: given or received, to / from whom, the occasion, what it was (cash, gold, silver, an item) and its value. */
function GiftSheet({ direction: initial, person: who, known, onClose }:
  { direction: 'GIVEN' | 'RECEIVED'; person?: string; known: string[]; onClose: () => void }) {
  const app = useApp();
  const [direction, setDirection] = useState(initial);
  const [person, setPerson] = useState(who || '');
  const [relation, setRelation] = useState('');
  const [occasion, setOccasion] = useState('');
  const [kind, setKind] = useState<GiftKind>('CASH');
  const [value, setValue] = useState('');
  const [quantity, setQuantity] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState('Cash');
  const [day, setDay] = useState(isoDate());
  const [notes, setNotes] = useState('');
  const [donation, setDonation] = useState(false);
  const [book, setBook] = useState(false);
  const accounts = useMemo(() => app.accounts.filter(a => a.group === 'OWN' && PAY_TYPES.includes(a.type)), [app.accounts]);
  const expenseCats = useMemo(() => (app.snapshot?.categories || []).filter(isExpense), [app.snapshot]);
  const giftCat = expenseCats.find(c => /gift|donat/i.test(c.name)) || expenseCats[0];
  const [account, setAccount] = useState<number | null>(accounts[0]?.id ?? null);
  const [categoryId, setCategoryId] = useState<number | null>(giftCat?.id ?? null);
  const [error, setError] = useState('');
  const amount = Number(value.replace(/[,₹\s]/g, '')) || 0;
  const qty = Number(quantity.replace(',', '.')) || 0;
  const metal = kind === 'GOLD' || kind === 'SILVER';
  const canBook = direction === 'GIVEN' && kind === 'CASH';
  const q = person.trim().toLowerCase();
  const suggestions = known.filter(n => !q || (n.toLowerCase().includes(q) && n.toLowerCase() !== q)).slice(0, 6);
  const acc = accounts.find(a => a.id === account);

  const save = async () => {
    if (!person.trim()) { setError(direction === 'GIVEN' ? 'Who was it for?' : 'Who gave it?'); return; }
    if (kind === 'CASH' && !(amount > 0)) { setError('Enter how much'); return; }
    if (metal && !(qty > 0) && !(amount > 0)) { setError('Enter the weight or its value'); return; }
    if (book && canBook && (!acc || !categoryId)) { setError('Pick the account and the category to book it in'); return; }
    const booked = book && canBook && acc ? acc : null;
    await app.addRecord({
      kind: 'GIFT', title: `${direction === 'GIVEN' ? 'Gift to' : 'Gift from'} ${person.trim()}`, sub: occasion.trim(), date: day, amount: amount || 0,
      accountId: booked?.id ?? null, accountName: booked?.name || '', flow: booked ? 'OUT' : 'NONE',
      payload: { direction, date: day, person: person.trim(), relation: relation.trim() || null, occasion: occasion.trim() || null, kind,
        description: description.trim() || null, value: amount || null, quantity: metal && qty ? qty : null, unit: metal && qty ? 'g' : null,
        mode: kind === 'CASH' ? mode : null, donation: direction === 'GIVEN' && donation, notes: notes.trim() || null,
        bookAccountId: booked?.id ?? null, bookCategoryId: booked ? categoryId : null },
    });
    app.notify(`Gift ${direction === 'GIVEN' ? 'to' : 'from'} ${person.trim()} saved`);
    onClose();
  };

  return (
    <Sheet visible onClose={onClose} title={direction === 'GIVEN' ? 'A gift I gave' : 'A gift I received'} footer={<Button title="Save gift" Icon={Check} onPress={save} />}>
      <View style={st.modes}>
        {(['GIVEN', 'RECEIVED'] as const).map(d => (
          <Pressable key={d} onPress={() => setDirection(d)} style={[st.mode, direction === d && st.modeOn]}>
            {d === 'GIVEN' ? <ArrowUpRight color={direction === d ? colors.white : colors.text2} size={16} /> : <ArrowDownLeft color={direction === d ? colors.white : colors.text2} size={16} />}
            <Text style={[st.modeText, direction === d && { color: colors.white }]}>{d === 'GIVEN' ? 'Given' : 'Received'}</Text>
          </Pressable>
        ))}
      </View>
      <Field label={direction === 'GIVEN' ? 'To' : 'From'} value={person} onChangeText={setPerson} placeholder="Name" maxLength={100} />
      {suggestions.length ? <View style={st.chips}>{suggestions.map(n => <Chip key={n} label={n} onPress={() => setPerson(n)} />)}</View> : null}
      <Field label="Relation" value={relation} onChangeText={setRelation} placeholder="Friend, cousin, colleague… (optional)" maxLength={40} />
      <Text style={st.k}>Occasion</Text>
      <View style={st.chips}>
        {OCCASIONS.map(o => <Chip key={o} label={o} selected={occasion === o} onPress={() => setOccasion(occasion === o ? '' : o)} />)}
      </View>
      {!OCCASIONS.includes(occasion) ? <Field label="Other occasion" value={occasion} onChangeText={setOccasion} placeholder="Optional" maxLength={60} /> : null}
      <Text style={st.k}>What</Text>
      <View style={st.chips}>
        {KINDS.map(([k, l, Icon]) => <Chip key={k} label={l} Icon={Icon} selected={kind === k} onPress={() => setKind(k)} />)}
      </View>
      {metal ? (
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <Field label="Weight (grams)" value={quantity} onChangeText={t => setQuantity(t.replace(/[^0-9.,]/g, ''))} keyboardType="decimal-pad" style={{ flex: 1 }} />
          <Field label="Value ₹ (optional)" value={value} onChangeText={t => setValue(t.replace(/[^0-9.,]/g, ''))} keyboardType="decimal-pad" style={{ flex: 1 }} />
        </View>
      ) : (
        <Field label={kind === 'CASH' ? 'Amount ₹' : 'Value ₹ (about, optional)'} value={value} onChangeText={t => setValue(t.replace(/[^0-9.,]/g, ''))} keyboardType="decimal-pad" />
      )}
      {kind === 'CASH' ? (
        <View style={st.chips}>{MODES.map(m => <Chip key={m} label={m} selected={mode === m} onPress={() => setMode(m)} />)}</View>
      ) : (
        <Field label="Description" value={description} onChangeText={setDescription} placeholder={metal ? 'Chain, coin, anklets…' : 'Watch, saree, dinner set…'} maxLength={255} />
      )}
      <View style={st.chips}>
        {[0, 1, 2].map(n => { const d = new Date(); d.setDate(d.getDate() - n); const iso = isoDate(d);
          return <Chip key={n} label={['Today', 'Yesterday', '2 days ago'][n]} selected={day === iso} onPress={() => setDay(iso)} />; })}
      </View>
      {direction === 'GIVEN' ? (
        <View style={st.switchRow}><Text style={st.switchText}>A donation</Text><Switch value={donation} onValueChange={setDonation} /></View>
      ) : null}
      {canBook ? (
        <>
          <View style={st.switchRow}>
            <View style={{ flex: 1 }}><Text style={st.switchText}>Book it as an expense too</Text><Text style={st.sub}>The money leaves the account and counts as spending</Text></View>
            <Switch value={book} onValueChange={setBook} />
          </View>
          {book ? (
            <>
              <View style={st.accounts}>
                {accounts.map(a => (
                  <Pressable key={a.id} onPress={() => setAccount(a.id)} style={[st.acc, a.id === account && st.accOn]}>
                    <AccountBubble type={a.type} size={26} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={st.accName} numberOfLines={1}>{a.name}</Text>
                      <Text style={st.sub} numberOfLines={1}>{money(app.balanceOf(a))}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
              <View style={st.chips}>
                {[giftCat, ...expenseCats.filter(c => c !== giftCat && !c.system).slice(0, 5)].filter(Boolean).map(c => (
                  <Chip key={c!.id} label={c!.name} selected={categoryId === c!.id} onPress={() => setCategoryId(c!.id)} />
                ))}
              </View>
            </>
          ) : null}
        </>
      ) : null}
      <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="Optional" maxLength={255} />
      {error ? <Text style={{ color: colors.red, fontWeight: '600' }}>{error}</Text> : null}
    </Sheet>
  );
}

const st = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: { color: colors.ocean, fontWeight: '700', fontSize: 14 },
  h1: { fontSize: 28, fontWeight: '800', color: colors.text },
  label: { color: 'rgba(255,255,255,0.65)', fontSize: 10.5, fontWeight: '800', letterSpacing: 1 },
  split: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  small: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 2 },
  big: { color: colors.white, fontSize: 24, fontWeight: '800' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, borderRadius: radius.m, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.card, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 14.5, color: colors.text, paddingVertical: 0 },
  month: { fontSize: 12.5, fontWeight: '800', color: colors.text2, marginTop: space.s, paddingHorizontal: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  title: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  sub: { fontSize: 12, color: colors.muted },
  amount: { fontSize: 14, fontWeight: '800' },
  ava: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.coralSoft, alignItems: 'center', justifyContent: 'center' },
  avaText: { color: colors.coral, fontWeight: '800', fontSize: 13 },
  modes: { flexDirection: 'row', gap: 4, backgroundColor: colors.card, borderRadius: radius.m, padding: 4, borderWidth: 1, borderColor: colors.line },
  mode: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 36, borderRadius: 9 },
  modeOn: { backgroundColor: colors.navy },
  modeText: { fontSize: 13, fontWeight: '800', color: colors.text2 },
  k: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.5, color: colors.muted, textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.card, borderRadius: radius.m, padding: space.m, borderWidth: 1, borderColor: colors.line },
  switchText: { fontSize: 14, fontWeight: '700', color: colors.text, flex: 1 },
  accounts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  acc: { width: '48.5%', flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: radius.m, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  accOn: { borderColor: colors.ocean, backgroundColor: colors.oceanSoft },
  accName: { fontSize: 12.5, fontWeight: '700', color: colors.text },
});
