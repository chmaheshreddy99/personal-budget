/**
 * Evidence: photos, scans and PDFs kept with a request waiting for approval (pendingId) or with an entry in the books
 * (entryId): a bill, the customer's message, a UPI screenshot, delivery proof.
 *
 *   <EvidenceGallery pendingId={…} canAdd />   what is attached, as thumbnails; tap one to check it full screen (a PDF
 *                                               opens in the phone's PDF viewer); add more with the camera or from files
 *   <EvidencePicker files={…} onChange={…} />   photos to send with something not saved yet (uploadAll() after saving)
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, ChevronLeft, ChevronRight, ExternalLink, FileText, Paperclip, X } from 'lucide-react-native';
import { fileUrl, headers, upload } from './api';
import { nativeFiles, PickedFile } from './native';
import { useApp } from './state';
import { colors, radius } from './theme';
import { bytes, dateTime } from './format';
import { Attachment } from './types';

/** Take a photo or pick a file: the file, or null when cancelled (an error is shown as a toast). */
async function pick(source: 'camera' | 'files', onError: (m: string) => void): Promise<PickedFile | null> {
  try {
    return await nativeFiles.pick(source);
  } catch (e: any) {
    onError(e?.message || 'Could not add the evidence');
    return null;
  }
}

function AddButtons({ onPicked, busy }: { onPicked: (f: PickedFile) => void; busy?: boolean }) {
  const { say } = useApp();
  const [picking, setPicking] = useState<'camera' | 'files' | null>(null);
  const add = async (source: 'camera' | 'files') => {
    setPicking(source);
    const f = await pick(source, m => say(m, 'bad'));
    setPicking(null);
    if (f) onPicked(f);
  };
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Pressable onPress={() => add('camera')} disabled={busy} style={({ pressed }) => [ev.add, pressed && { opacity: 0.8 }]}>
        {picking === 'camera' || busy ? <ActivityIndicator size="small" color={colors.orange} /> : <Camera color={colors.orange} size={17} />}
        <Text style={ev.addText}>Take photo</Text>
      </Pressable>
      <Pressable onPress={() => add('files')} disabled={busy} style={({ pressed }) => [ev.add, pressed && { opacity: 0.8 }]}>
        {picking === 'files' ? <ActivityIndicator size="small" color={colors.orange} /> : <Paperclip color={colors.orange} size={17} />}
        <Text style={ev.addText}>Attach file</Text>
      </Pressable>
    </View>
  );
}

/** What is attached on the server, to check (and add to, when allowed). */
export function EvidenceGallery({ pendingId, entryId, canAdd, onCount }: {
  pendingId?: number; entryId?: number; canAdd?: boolean; onCount?: (n: number) => void;
}) {
  const app = useApp();
  const [list, setList] = useState<Attachment[] | null>(null);
  const [err, setErr] = useState('');
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const q = pendingId ? `pendingId=${pendingId}` : `entryId=${entryId}`;
  const counted = useRef(onCount);
  counted.current = onCount;

  const load = useCallback(async () => {
    try {
      const l = await app.call<Attachment[]>(`/attachments?${q}`);
      setList(l);
      setErr('');
      counted.current?.(l.length);
    } catch (e: any) {
      setErr(e?.message || 'The evidence could not be loaded');
      setList(l => l || []);
    }
  }, [app.call, q]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const send = async (f: PickedFile) => {
    setUploading(true);
    try {
      await upload(app.session, f, pendingId ? { pendingId } : { entryId });
      await nativeFiles.remove(f.path);
      app.say('Evidence added');
      await load();
    } catch (e: any) {
      app.say(e?.message || 'The evidence could not be sent', 'bad');
    } finally {
      setUploading(false);
    }
  };

  const allowAdd = canAdd && app.profile?.evidence;
  return (
    <View style={{ gap: 10 }}>
      {list === null ? <ActivityIndicator color={colors.orange} /> : list.length ? (
        <View style={ev.thumbs}>
          {list.map((a, i) => <Thumb key={a.id} a={a} onPress={() => setOpen(i)} />)}
        </View>
      ) : <Text style={ev.none}>{err || 'Nothing attached.'}</Text>}
      {allowAdd ? <AddButtons onPicked={send} busy={uploading} /> : null}
      {list && open !== null ? <Viewer list={list} index={open} onIndex={setOpen} onClose={() => setOpen(null)} /> : null}
    </View>
  );
}

function Thumb({ a, onPress }: { a: Attachment; onPress: () => void }) {
  const { session } = useApp();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [ev.thumb, pressed && { opacity: 0.85 }]}>
      {a.image ? (
        <Image source={{ uri: fileUrl(session, a.id, a.hasThumbnail), headers: headers(session.token) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={ev.pdf}><FileText color={colors.red} size={24} /><Text style={ev.pdfText} numberOfLines={2}>{a.fileName}</Text></View>
      )}
    </Pressable>
  );
}

/** One piece of evidence full screen, with the ones around it: who sent it and when; a PDF or the original opens in the phone's viewer. */
function Viewer({ list, index, onIndex, onClose }: { list: Attachment[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const a = list[index];
  const [opening, setOpening] = useState(false);
  const openOutside = async () => {
    setOpening(true);
    try {
      const ext = a.pdf ? 'pdf' : (a.contentType.split('/')[1] || 'jpg');
      const path = await nativeFiles.download(fileUrl(app.session, a.id), headers(app.session.token), `ev-${a.id}.${ext}`);
      await nativeFiles.open(path, a.contentType);
    } catch (e: any) {
      app.say(e?.message || 'Could not open it', 'bad');
    } finally {
      setOpening(false);
    }
  };
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <View style={[ev.viewer, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <View style={ev.vTop}>
          <Pressable onPress={onClose} hitSlop={12}><X color={colors.white} size={24} /></Pressable>
          <View style={{ flex: 1 }}>
            <Text style={ev.vTitle} numberOfLines={1}>{a.caption || a.fileName}</Text>
            <Text style={ev.vSub} numberOfLines={1}>{[a.createdBy, dateTime(a.createdAt), bytes(a.sizeBytes)].filter(Boolean).join(' · ')}</Text>
          </View>
          <Text style={ev.vSub}>{index + 1} / {list.length}</Text>
        </View>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          {a.image ? (
            <Image source={{ uri: fileUrl(app.session, a.id), headers: headers(app.session.token) }} style={{ flex: 1 }} resizeMode="contain" />
          ) : (
            <View style={{ alignItems: 'center', gap: 12 }}>
              <FileText color={colors.white} size={64} />
              <Text style={ev.vTitle}>{a.fileName}</Text>
              <Text style={ev.vSub}>A PDF: open it in the phone's PDF viewer to read it.</Text>
            </View>
          )}
        </View>
        <View style={ev.vBar}>
          <Pressable disabled={index === 0} onPress={() => onIndex(index - 1)} style={[ev.vNav, index === 0 && { opacity: 0.3 }]}>
            <ChevronLeft color={colors.white} size={26} />
          </Pressable>
          <Pressable onPress={openOutside} style={ev.vOpen}>
            {opening ? <ActivityIndicator color={colors.white} size="small" /> : <ExternalLink color={colors.white} size={17} />}
            <Text style={{ color: colors.white, fontWeight: '800' }}>{a.pdf ? 'Open PDF' : 'Open to zoom'}</Text>
          </Pressable>
          <Pressable disabled={index === list.length - 1} onPress={() => onIndex(index + 1)} style={[ev.vNav, index === list.length - 1 && { opacity: 0.3 }]}>
            <ChevronRight color={colors.white} size={26} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** Photos and files for something not saved yet: kept on the phone, sent once it is saved (uploadAll). */
export function EvidencePicker({ files, onChange, note }: { files: PickedFile[]; onChange: (f: PickedFile[]) => void; note?: string }) {
  const { profile } = useApp();
  if (!profile?.evidence) return <Text style={ev.none}>Adding evidence on the phone is switched off.</Text>;
  return (
    <View style={{ gap: 10 }}>
      {files.length ? (
        <View style={ev.thumbs}>
          {files.map(f => (
            <View key={f.path} style={ev.thumb}>
              {f.type.startsWith('image/')
                ? <Image source={{ uri: `file://${f.path}` }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                : <View style={ev.pdf}><FileText color={colors.red} size={22} /><Text style={ev.pdfText} numberOfLines={2}>{f.name}</Text></View>}
              <Pressable onPress={() => { nativeFiles.remove(f.path); onChange(files.filter(x => x !== f)); }} style={ev.remove} hitSlop={8}>
                <X color={colors.white} size={12} strokeWidth={3} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <AddButtons onPicked={f => onChange([...files, f])} />
      <Text style={ev.none}>{note || (files.length ? `${files.length} file${files.length === 1 ? '' : 's'} · sent when you save` : 'A photo of the bill or slip helps the checker.')}</Text>
    </View>
  );
}

/** Sends what was picked to what was saved; the files on the phone go once sent. Resolves with how many failed. */
export async function uploadAll(session: Parameters<typeof upload>[0], files: PickedFile[], target: { pendingId?: number; entryId?: number }): Promise<number> {
  let failed = 0;
  for (const f of files) {
    try {
      await upload(session, f, target);
      await nativeFiles.remove(f.path);
    } catch {
      failed++;
    }
  }
  return failed;
}

const ev = StyleSheet.create({
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumb: { width: 82, height: 82, borderRadius: radius.m, overflow: 'hidden', backgroundColor: colors.sunken, borderWidth: 1, borderColor: colors.line },
  pdf: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, padding: 6, backgroundColor: colors.redSoft },
  pdfText: { fontSize: 9.5, color: colors.text2, fontWeight: '700', textAlign: 'center' },
  remove: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(30,37,44,0.75)',
    alignItems: 'center', justifyContent: 'center' },
  add: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 42, borderRadius: radius.m,
    backgroundColor: colors.orangeSoft },
  addText: { color: colors.orange, fontWeight: '800', fontSize: 13 },
  none: { fontSize: 12.5, color: colors.muted },
  viewer: { flex: 1, backgroundColor: '#0d1115', paddingHorizontal: 14, gap: 10 },
  vTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  vTitle: { color: colors.white, fontWeight: '800', fontSize: 15 },
  vSub: { color: '#a8b1ba', fontSize: 12 },
  vBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  vNav: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#ffffff1a', alignItems: 'center', justifyContent: 'center' },
  vOpen: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, height: 46, borderRadius: 23, backgroundColor: colors.orange },
});
