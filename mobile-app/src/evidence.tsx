/**
 * Evidence for an expense: a bill photographed now or an image / PDF from the phone. Shown as thumbnails with a
 * remove button; kept in the app's files until the next sync uploads them to the expense on the server.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, CloudUpload, FileText, Paperclip, X } from 'lucide-react-native';
import { PickedFile, nativeFiles } from './native';
import { bytes } from './format';
import { colors, radius } from './theme';

export type EvidenceItem = PickedFile & { id?: string; status?: string; message?: string };

/** Take a photo or pick a file: resolves with the file, or null when cancelled (errors are shown as a toast). */
export async function pickEvidence(source: 'camera' | 'files', onError: (m: string) => void): Promise<PickedFile | null> {
  try {
    return await nativeFiles.pick(source);
  } catch (e: any) {
    onError(e?.message || 'Could not add the evidence');
    return null;
  }
}

export function EvidenceStrip({ items, onAdd, onRemove, note, compact }: {
  items: EvidenceItem[]; onAdd?: (f: PickedFile) => void; onRemove?: (item: EvidenceItem) => void; note?: string; compact?: boolean;
}) {
  const [busy, setBusy] = useState<'camera' | 'files' | null>(null);
  const [err, setErr] = useState('');
  const add = async (source: 'camera' | 'files') => {
    setBusy(source); setErr('');
    const f = await pickEvidence(source, setErr);
    setBusy(null);
    if (f && onAdd) onAdd(f);
  };
  return (
    <View style={{ gap: 8 }}>
      {items.length ? (
        <View style={st.thumbs}>
          {items.map((it, i) => (
            <View key={it.id || it.path || i} style={[st.thumb, compact && st.thumbSmall]}>
              {it.type.startsWith('image/')
                ? <Image source={{ uri: `file://${it.path}` }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                : <View style={st.pdf}><FileText color={colors.red} size={22} /><Text style={st.pdfText} numberOfLines={1}>{it.name}</Text></View>}
              {it.status ? (
                <View style={[st.badge, { backgroundColor: it.status === 'FAILED' ? colors.red : colors.gold }]}>
                  <CloudUpload color={colors.white} size={10} />
                </View>
              ) : null}
              {onRemove ? (
                <Pressable onPress={() => onRemove(it)} style={st.remove} hitSlop={8}><X color={colors.white} size={12} strokeWidth={3} /></Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      {onAdd ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={() => add('camera')} style={({ pressed }) => [st.btn, pressed && { opacity: 0.8 }]}>
            {busy === 'camera' ? <ActivityIndicator size="small" color={colors.ocean} /> : <Camera color={colors.ocean} size={16} />}
            <Text style={st.btnText}>Take photo</Text>
          </Pressable>
          <Pressable onPress={() => add('files')} style={({ pressed }) => [st.btn, pressed && { opacity: 0.8 }]}>
            {busy === 'files' ? <ActivityIndicator size="small" color={colors.ocean} /> : <Paperclip color={colors.ocean} size={16} />}
            <Text style={st.btnText}>Attach file</Text>
          </Pressable>
        </View>
      ) : null}
      {note || items.length ? (
        <Text style={st.note}>{note || `${items.length} file${items.length === 1 ? '' : 's'} · ${bytes(items.reduce((s, x) => s + (x.size || 0), 0))} · uploaded at the next sync`}</Text>
      ) : null}
      {err ? <Text style={st.err}>{err}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumb: { width: 76, height: 76, borderRadius: radius.m, overflow: 'hidden', backgroundColor: colors.sunken, borderWidth: 1, borderColor: colors.line },
  thumbSmall: { width: 60, height: 60 },
  pdf: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, padding: 4, backgroundColor: colors.redSoft },
  pdfText: { fontSize: 9, color: colors.text2, fontWeight: '700' },
  remove: { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(11,32,56,0.7)', alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', bottom: 4, left: 4, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 40, borderRadius: radius.m,
    backgroundColor: colors.oceanSoft, borderWidth: 1, borderColor: colors.oceanSoft },
  btnText: { color: colors.ocean, fontWeight: '700', fontSize: 13 },
  note: { fontSize: 11.5, color: colors.muted },
  err: { fontSize: 12, color: colors.red, fontWeight: '600' },
});
