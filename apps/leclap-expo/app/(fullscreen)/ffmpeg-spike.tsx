import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors, spacing, typography } from '@/src/styles/theme';
import * as Leclap from '@/modules/leclap-ffmpeg';

import { runNativeSmoke } from '@/src/services/compile/native-smoke';

/** Auto-runs the production JSON pipeline via deep link leclap://ffmpeg-spike. */
async function resolveSampleClip(): Promise<string> {
  const asset = Asset.fromModule(require('../../assets/sample.mp4'));
  await asset.downloadAsync();

  return asset.localUri ?? asset.uri;
}

export default function FFmpegSpikeScreen() {
  const router = useRouter();
  const [log, setLog] = useState('Tap “Check version” to begin.');
  const [busy, setBusy] = useState(false);
  const [outputUri, setOutputUri] = useState<string | null>(null);

  const player = useVideoPlayer(outputUri, (p) => {
    p.loop = true;
    p.play();
  });

  const append = useCallback((line: string) => {
    setLog((prev) => `${prev}\n${line}`);
  }, []);

  // When deep-linked directly (leclap://ffmpeg-spike) the stack is empty, so router.back()
  // throws "GO_BACK was not handled". Fall back to the app home in that case.
  const handleClose = useCallback(() => {
    if (router.canGoBack()) {
      router.back();

      return;
    }
    router.replace('/');
  }, [router]);

  const checkVersion = useCallback(() => {
    try {
      setLog(`✅ FFmpeg ${Leclap.version()} (native engine loaded)`);
    } catch (error) {
      setLog(`❌ Native engine unavailable.\n${String(error)}`);
    }
  }, []);

  const render = useCallback(async () => {
    setBusy(true);
    setOutputUri(null);
    setLog('Resolving bundled clip…');

    try {
      const inputUri = await resolveSampleClip();
      append('Compiling JSON on-device (title, footage, motion and music)…');
      const outUri = await runNativeSmoke(inputUri, append);
      const info = await FileSystem.getInfoAsync(outUri);

      if (!info.exists || info.size === 0) throw new Error('Native output is empty');
      append(`✅ H.264 output ${(info.size / 1024).toFixed(0)} KB — playing below.`);
      setOutputUri(outUri);
    } catch (error) {
      console.error('[native-smoke]', String(error));
      append(`❌ ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [append]);

  // Auto-run on mount so the on-device smoke test is deterministic.
  useEffect(() => {
    checkVersion();
    const timer = setTimeout(() => {
      render().catch(() => null);
    }, 600);

    return () => {
      clearTimeout(timer);
    };
  }, [checkVersion, render]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleClose} style={styles.iconBtn} accessibilityLabel="Close">
          <Ionicons name="close" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Native JSON engine check</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.row}>
          <TouchableOpacity testID="spike-version" onPress={checkVersion} style={styles.btn} disabled={busy}>
            <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
            <Text style={styles.btnText}>Check version</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="spike-render"
            onPress={() => {
              render().catch(() => {});
            }}
            style={[styles.btn, styles.btnPrimary]}
            disabled={busy}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="play" size={18} color="#fff" />}
            <Text style={[styles.btnText, styles.btnTextPrimary]}>Compile clip</Text>
          </TouchableOpacity>
        </View>

        {outputUri && (
          <VideoView testID="spike-video" player={player} style={styles.video} contentFit="contain" nativeControls />
        )}

        <Text style={styles.logLabel}>Log</Text>
        <View style={styles.logBox}>
          <Text style={styles.logText}>{log}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.m,
    paddingTop: spacing.xl,
    paddingBottom: spacing.s,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  headerTitle: { ...typography.subtitle, color: colors.text },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.m },
  row: { flexDirection: 'row', gap: spacing.s },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.m,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: 'rgba(124,131,253,0.08)',
  },
  btnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  btnText: { ...typography.button, color: colors.primary },
  btnTextPrimary: { color: '#fff' },
  video: { width: '100%', height: 200, marginTop: spacing.m, borderRadius: 12, backgroundColor: '#000' },
  logLabel: {
    ...typography.smallText,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    marginTop: spacing.l,
    marginBottom: spacing.xs,
  },
  logBox: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: spacing.m,
    minHeight: 160,
  },
  logText: { ...typography.caption, color: colors.text, fontFamily: 'System' },
});
