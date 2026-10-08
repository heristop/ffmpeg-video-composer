import { useEffect, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { htmlRasterHost } from '@/src/services/compile/html-raster/html-raster-host';
import { loadRasterPage, type RasterPageFile } from '@/src/services/compile/html-raster/raster-page-source';

const ORIGINS = ['file://*'];

/**
 * The hidden WebView the engine draws HTML layers in (Hermes has no WebAssembly). Mounted only while a
 * render needs it: the host activates it on the first HTML layer and releases it when the compile ends.
 */
export function HtmlRasterView() {
  const active = useSyncExternalStore(htmlRasterHost.subscribe, htmlRasterHost.isActive);
  const [page, setPage] = useState<RasterPageFile | null>(null);

  useEffect(() => {
    if (!active || page) return;

    loadRasterPage().then(setPage, (error: unknown) => {
      htmlRasterHost.crashed(`page asset unreadable: ${String(error)}`);
    });
  }, [active, page]);

  if (!active || !page) return null;

  return (
    <View
      style={styles.hidden}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <WebView
        ref={(webView) => {
          htmlRasterHost.attach(
            webView
              ? {
                  post: (text) => {
                    webView.postMessage(text);
                  },
                }
              : null
          );
        }}
        source={{ uri: page.uri }}
        // The page is a local file: Android needs file access for it, iOS a read grant on its folder.
        allowFileAccess
        allowingReadAccessToURL={page.directory}
        originWhitelist={ORIGINS}
        javaScriptEnabled
        cacheEnabled={false}
        onMessage={(event) => {
          htmlRasterHost.receive(event.nativeEvent.data);
        }}
        onContentProcessDidTerminate={() => {
          htmlRasterHost.crashed('the WebView content process ended');
        }}
        onRenderProcessGone={() => {
          htmlRasterHost.crashed('the WebView render process is gone');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Off screen and one pixel: a zero-sized or detached WebView may not run its page.
  hidden: { position: 'absolute', left: 0, top: 0, width: 1, height: 1, opacity: 0.01 },
});
