import { StyleSheet } from 'react-native';
import { colors, spacing, typography, fonts, withAlpha } from '@/src/styles/theme';
import { elevation } from '@/src/styles/elevation';
import { FORM_MAX_WIDTH } from '@/src/styles/adaptive-layout';

export const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1 },
  contentContainer: { paddingHorizontal: spacing.l, paddingTop: spacing.s, paddingBottom: spacing.l },

  // States
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  loadingText: { ...typography.body, marginTop: spacing.m, color: colors.textSecondary },
  errorText: { ...typography.body, color: colors.error, marginBottom: spacing.l, textAlign: 'center' },
  stateBackButton: { paddingHorizontal: spacing.l, paddingVertical: spacing.s },
  stateBackButtonText: { ...typography.button, color: colors.primary },

  // Masthead
  masthead: { paddingTop: spacing.s },
  mastheadTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 40 },
  backChevron: { width: 40, height: 40, alignItems: 'flex-start', justifyContent: 'center' },
  formatChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.s,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: withAlpha(colors.primary, 0.08),
  },
  formatChipText: {
    fontFamily: fonts.poppins.semiBold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.primary,
    textTransform: 'uppercase',
  },
  mastheadHeading: { marginTop: spacing.m },
  standfirst: { ...typography.body, color: colors.textSecondary, marginTop: spacing.s },

  // Program status strip
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    marginTop: spacing.l,
    marginBottom: spacing.s,
  },
  statusMeter: { flex: 1 },
  statusFraction: {
    fontFamily: fonts.poppins.bold,
    fontSize: 20,
    letterSpacing: 0.5,
    color: colors.textStrong,
    fontVariant: ['tabular-nums'],
  },
  statusFractionMuted: { color: colors.textSecondary },

  // Shot list + filmstrip
  shotList: { position: 'relative', marginTop: spacing.m },
  filmstrip: { position: 'absolute', left: 0, top: 6, bottom: 6, width: 32 },
  shotRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.s + 2 },
  shotBodyPress: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  rail: { width: 32, alignItems: 'center', justifyContent: 'center' },
  shotBody: { flex: 1, paddingLeft: spacing.xs },
  shotHeadline: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.s },
  shotIndex: {
    fontFamily: fonts.poppins.medium,
    fontSize: 13,
    letterSpacing: 0.5,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  shotTitle: { ...typography.subtitle, color: colors.textStrong, flexShrink: 1 },
  shotDesc: { ...typography.caption, marginTop: 2 },
  thumbChip: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(colors.primary, 0.1),
    marginLeft: spacing.s,
  },

  // Keyframe dot (status)
  keyframe: { width: 14, height: 14, borderRadius: 4, transform: [{ rotate: '45deg' }] },
  keyframeFill: { borderRadius: 4 },
  keyframePending: {
    borderWidth: 2,
    borderColor: colors.divider,
    backgroundColor: colors.background,
  },

  // Create CTA
  qualityRow: { marginBottom: spacing.s },
  footer: {
    paddingHorizontal: spacing.l,
    paddingTop: spacing.m,
    paddingBottom: spacing.xl,
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  cta: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.s,
    height: 60,
    borderRadius: 18,
    overflow: 'hidden',
    ...elevation.raised,
    shadowOpacity: 0.32,
  },
  // Disabled cancels the lift inherited from `cta`: a disabled control shouldn't read as raised, and
  // elevation under a see-through fill shows the shadow through the button (see `primaryMuted`).
  ctaDisabled: { backgroundColor: colors.primaryMuted, elevation: 0, shadowOpacity: 0, shadowRadius: 0 },
  ctaTextDisabled: { color: withAlpha(colors.textStrong, 0.72) },
  ctaText: {
    color: '#FFFFFF',
    fontFamily: fonts.poppins.semiBold,
    fontSize: 17,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  ctaHelper: { ...typography.caption, textAlign: 'center', marginTop: spacing.s, color: colors.textSecondary },

  // Modals (form + music)
  formModalContainer: {
    flex: 1,
    width: '100%',
    maxWidth: FORM_MAX_WIDTH,
    alignSelf: 'center',
    backgroundColor: colors.background,
  },
  formHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  formTitle: { ...typography.title, color: colors.textStrong, flex: 1, marginRight: spacing.m },
  formFooter: {
    padding: spacing.l,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  formSubmitButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.m,
    borderRadius: 16,
    alignItems: 'center',
    ...elevation.raised,
    shadowOpacity: 0.3,
  },
  formSubmitButtonText: {
    color: '#FFFFFF',
    fontFamily: fonts.poppins.semiBold,
    fontSize: 16,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  musicScroll: { padding: spacing.l },
  musicHint: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.m },
  musicRowCover: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  musicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    minHeight: 56,
    paddingHorizontal: spacing.m,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
    marginBottom: spacing.s,
  },
  musicRowActive: { borderColor: colors.primary, borderWidth: 1.5, backgroundColor: withAlpha(colors.primary, 0.06) },
  musicRowText: { flex: 1 },
  musicRowTitle: { ...typography.body, color: colors.textStrong },
  musicRowAuthor: { ...typography.smallText, color: colors.textSecondary },
  musicDefaultText: { ...typography.body, color: colors.textStrong, flex: 1 },
});
