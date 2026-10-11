import React, { useEffect, useEffectEvent, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors, spacing, typography } from '@/src/styles/theme';
import { SAMPLE_TEMPLATES } from '@/src/templates/sampleTemplates';
import { expandCatalogPartials } from '@/src/templates/catalog';
import { compileOnDevice } from '@/src/services/compile/compileOnDevice';
import {
  checkSummary,
  clipSlots,
  logLine,
  selectTemplates,
  type CheckRow,
} from '@/src/services/compile/all-templates-check';

/**
 * Device check: compiles every bundled template through the real on-device path, with the bundled sample
 * clip in each recorded slot. Deep link leclap://all-templates-test (or ?only=interview,story-reel); each
 * template logs a `LECLAP_ALLTEMPLATES <id>=OK|FAIL` line. Driven by `.maestro/all-templates.yaml`.
 */
const STATUS_COLOR: Record<CheckRow['status'], string> = {
  RUN: colors.textSecondary,
  OK: colors.success,
  FAIL: colors.error,
};

async function compileOne(id: string, clip: string): Promise<{ row: CheckRow; kept: string | null }> {
  const template = SAMPLE_TEMPLATES.find((t) => t.id === id);

  if (!template) return { row: { id, status: 'FAIL', info: 'not in the catalog' }, kept: null };

  const descriptor = expandCatalogPartials(template.descriptor);
  const started = Date.now();
  const result = await compileOnDevice(descriptor, clipSlots(descriptor, clip, template.orientation));
  const secs = (Date.now() - started) / 1000;
  const info = result.outputUri ? await FileSystem.getInfoAsync(result.outputUri) : null;
  const size = info?.exists ? info.size : 0;

  if (!result.success || !result.outputUri || size === 0) {
    return { row: { id, status: 'FAIL', secs, info: result.error ?? `empty output (${size})` }, kept: null };
  }

  // Keep a copy outside the compile workspace, so the last success can play below.
  const kept = `${FileSystem.documentDirectory}alltemplates-${id}.mp4`;

  await FileSystem.deleteAsync(kept, { idempotent: true });
  await FileSystem.copyAsync({ from: result.outputUri, to: kept });

  return { row: { id, status: 'OK', secs, info: `${(size / 1024).toFixed(0)} KB` }, kept };
}

export default function AllTemplatesTestScreen() {
  const { only } = useLocalSearchParams<{ only?: string }>();
  const [rows, setRows] = useState<CheckRow[]>([]);
  const [done, setDone] = useState(false);
  const [lastOk, setLastOk] = useState<string | null>(null);
  const player = useVideoPlayer(lastOk, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  const run = useEffectEvent(async () => {
    const asset = await Asset.fromModule(require('../../assets/sample.mp4')).downloadAsync();
    const clip = asset.localUri ?? asset.uri;
    const list = selectTemplates(SAMPLE_TEMPLATES, only);

    console.log(`LECLAP_ALLTEMPLATES START count=${list.length}`);

    const step = async (id: string): Promise<void> => {
      setRows((prev) => [...prev, { id, status: 'RUN' }]);

      const started = Date.now();
      const { row, kept } = await compileOne(id, clip).catch((error: unknown) => ({
        row: { id, status: 'FAIL' as const, secs: (Date.now() - started) / 1000, info: String(error) },
        kept: null,
      }));

      console.log(logLine(row));
      setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)));

      if (kept) setLastOk(kept);
    };

    // One template at a time: the device check also proves back-to-back compiles stay healthy.
    await list.reduce((chain, template) => chain.then(() => step(template.id)), Promise.resolve());

    console.log('LECLAP_ALLTEMPLATES DONE');
    setDone(true);
  });

  useEffect(() => {
    // Let the screen mount before the first compile takes the JS thread.
    const timer = setTimeout(() => {
      run().catch((error: unknown) => {
        console.log(`LECLAP_ALLTEMPLATES CRASH ${String(error)}`);
      });
    }, 800);

    return () => {
      clearTimeout(timer);
    };
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text testID="alltemplates-summary" style={styles.summary}>
        {checkSummary(rows, done)}
      </Text>
      {rows.map((r) => (
        <Text key={r.id} style={[styles.row, { color: STATUS_COLOR[r.status] }]}>
          {`${r.status}  ${r.id}  ${r.secs === undefined ? '' : `${r.secs.toFixed(1)}s`}  ${r.info ?? ''}`}
        </Text>
      ))}
      {lastOk && <VideoView player={player} style={styles.video} contentFit="contain" />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.monitorBackground },
  content: { padding: spacing.m, paddingTop: spacing.xxl },
  summary: { ...typography.subtitle, color: colors.monitorText },
  row: { ...typography.caption, marginTop: spacing.s, fontFamily: 'System' },
  video: { width: '100%', height: 220, marginTop: spacing.m },
});
