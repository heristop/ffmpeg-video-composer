import { View, Text, StyleSheet, Image, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, typography, spacing } from '@/src/styles/theme';
import logoImage from '@/assets/images/logo.png';
import { PressableScale } from '@/src/components/kinetic/pressable-scale';
import { CONTENT_MAX_WIDTH } from '@/src/styles/adaptive-layout';

interface HeaderProps {
  title?: string;
  showBackButton?: boolean;
  showLogo?: boolean;
  rightContent?: React.ReactNode;
  onBackPress?: () => void;
  showSlogan?: boolean;
  variant?: 'primary' | 'transparent' | 'light';
  actions?: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; color?: string }[];
}

function backAction(onBackPress: (() => void) | undefined, router: ReturnType<typeof useRouter>): void {
  if (onBackPress) {
    onBackPress();

    return;
  }

  if (router.canGoBack()) {
    router.back();

    return;
  }

  router.replace('/(app)');
}

function HeaderLeft({
  showBackButton,
  showLogo,
  title,
  slogan,
  textColor,
  transparent,
  onBack,
  backLabel,
}: {
  showBackButton: boolean;
  showLogo: boolean;
  title: string;
  slogan?: string;
  textColor: string;
  transparent: boolean;
  onBack: () => void;
  backLabel: string;
}) {
  return (
    <View style={styles.left}>
      {showBackButton ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          onPress={onBack}
          style={styles.action}
          haptic={false}
        >
          <Ionicons name="chevron-back" size={24} color={textColor} />
        </PressableScale>
      ) : null}
      {showLogo ? <Image source={logoImage} style={styles.logo} resizeMode="contain" accessible={false} /> : null}
      <HeaderIdentity title={title} slogan={slogan} textColor={textColor} transparent={transparent} />
    </View>
  );
}

function HeaderActions({ actions, textColor }: { actions: HeaderProps['actions']; textColor: string }) {
  return (
    <>
      {(actions ?? []).map((action, index) => (
        <PressableScale
          key={`${action.icon}-${index}`}
          onPress={action.onPress}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          style={styles.action}
          haptic={false}
        >
          <Ionicons name={action.icon} size={24} color={action.color ?? textColor} />
        </PressableScale>
      ))}
    </>
  );
}

export default function Header({
  title,
  showBackButton = false,
  showLogo = true,
  rightContent,
  onBackPress,
  showSlogan = true,
  variant = 'primary',
  actions = [],
}: HeaderProps) {
  const router = useRouter();
  const { t } = useTranslation('header');
  const backgroundColor = { transparent: 'transparent', light: colors.background, primary: colors.primaryMuted }[
    variant
  ];
  const textColor = variant === 'transparent' ? colors.monitorText : colors.text;
  const handleBack = () => {
    backAction(onBackPress, router);
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor }}>
      <StatusBar barStyle={variant === 'transparent' ? 'light-content' : 'dark-content'} />
      <View style={styles.container}>
        <HeaderLeft
          showBackButton={showBackButton}
          showLogo={showLogo}
          title={title ?? t('defaultTitle')}
          slogan={showSlogan ? t('slogan') : undefined}
          textColor={textColor}
          transparent={variant === 'transparent'}
          onBack={handleBack}
          backLabel={t('back')}
        />
        <HeaderActions actions={actions} textColor={textColor} />
        {rightContent}
      </View>
    </SafeAreaView>
  );
}

function HeaderIdentity({
  title,
  slogan,
  textColor,
  transparent,
}: {
  title: string;
  slogan?: string;
  textColor: string;
  transparent: boolean;
}) {
  return (
    <View style={styles.copy}>
      <Text style={[styles.title, { color: textColor }]} accessibilityRole="header">
        {title}
      </Text>
      {slogan ? (
        <Text style={[styles.subtitle, { color: transparent ? colors.monitorSecondary : colors.textSecondary }]}>
          {slogan}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    gap: spacing.s,
  },
  left: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  copy: { flex: 1, gap: 2 },
  title: { ...typography.title, lineHeight: 30 },
  subtitle: { ...typography.caption, lineHeight: 20 },
  logo: { width: 32, height: 32 },
  action: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
});
