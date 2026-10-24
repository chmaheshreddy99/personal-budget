/**
 * A bill (the tax invoice once paid in full) or a payment / advance slip, exactly as the web app shows it: the server's
 * document page (brick-doc.html) draws it with the web app's own renderer, letterhead, seal, signatures and the digital
 * signature checked. Pinch to zoom; Print opens Android's print service (a printer, or Save as PDF to share) with the
 * same A4 sheet the web app prints. A draft slip (before the payment is recorded) is handed to the page as it is.
 */
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Printer } from 'lucide-react-native';
import { normalizeUrl } from '../api';
import { nativePrint } from '../native';
import { useApp } from '../state';
import { useNav } from '../nav';
import { colors } from '../theme';
import { Banner, HeaderButton, Screen } from '../ui';
import { CircleAlert } from 'lucide-react-native';

/** Not a browser's: ngrok's free tunnels show their warning page to browsers only. */
export const DOC_AGENT = 'BricksApp/1.0 (Android; documents)';

export type DocParams = { kind: 'bill' | 'slip' | 'draft-slip'; id?: number; title?: string; draft?: unknown };

export function docUrl(server: string, token: string | null, p: DocParams, print = false): string {
  return `${normalizeUrl(server)}/brick-doc.html#${p.kind}${p.id ? `/${p.id}` : ''}&t=${encodeURIComponent(token || '')}${print ? '&print=1' : ''}`;
}

export function DocScreen({ params }: { params: DocParams }) {
  const app = useApp();
  const nav = useNav();
  const [title, setTitle] = useState(params.title || (params.kind === 'bill' ? 'Bill' : 'Payment slip'));
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [printing, setPrinting] = useState(false);
  const url = docUrl(app.session.server, app.session.token, params);
  const draft = params.kind === 'draft-slip';

  const print = async () => {
    setPrinting(true);
    try {
      await nativePrint.page(docUrl(app.session.server, app.session.token, params, true), title, DOC_AGENT);
    } catch (e: any) {
      app.say(e?.message || 'Could not print', 'bad');
    } finally {
      setTimeout(() => setPrinting(false), 1500);
    }
  };

  return (
    <Screen title={title} subtitle={draft ? 'Draft · not paid yet' : 'As in the web app'} onBack={() => nav.pop()} scroll={false}
      right={!draft && ready ? (printing ? <ActivityIndicator color={colors.white} /> : <HeaderButton Icon={Printer} onPress={print} />) : undefined}>
      {error ? <View style={{ padding: 16 }}><Banner Icon={CircleAlert} tone="bad" text={error} /></View> : null}
      <WebView
        source={{ uri: url, headers: { 'ngrok-skip-browser-warning': '1' } }}
        userAgent={DOC_AGENT}
        originWhitelist={['*']}
        mixedContentMode="always"
        setBuiltInZoomControls
        setDisplayZoomControls={false}
        scalesPageToFit
        injectedJavaScriptBeforeContentLoaded={draft ? `window.__BK_DRAFT = ${JSON.stringify(params.draft)}; true;` : undefined}
        onMessage={e => {
          try {
            const m = JSON.parse(e.nativeEvent.data);
            if (m.ready) { setReady(true); if (m.title) setTitle(m.title); }
            if (m.error) setError(m.error);
          } catch { /* not ours */ }
        }}
        onError={e => setError(e.nativeEvent.description || 'The document could not be opened')}
        style={ds.web}
        startInLoadingState
        renderLoading={() => <View style={ds.loading}><ActivityIndicator color={colors.orange} size="large" /></View>}
      />
    </Screen>
  );
}

const ds = StyleSheet.create({
  web: { flex: 1, backgroundColor: '#eceff1' },
  loading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eceff1' },
});
