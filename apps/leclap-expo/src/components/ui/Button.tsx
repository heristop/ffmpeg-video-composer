import { type ColorTokens, type FontSizeTokens, Button as TamaguiButton, Text, XStack } from 'tamagui';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator } from 'react-native';
import { useMotionPreferences } from '@/src/hooks/use-motion-preferences';
import { colors } from '@/src/styles/theme';
import { triggerHaptic } from '@/src/hooks/use-haptic-press';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'success';
type ButtonSize = 'small' | 'medium' | 'large' | 'x-large';

interface ButtonProps {
  children?: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  onPress?: () => void | Promise<void>;
  disabled?: boolean;
  loading?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  hapticFeedback?: boolean;
}

const getVariantProps = (variant: ButtonVariant) => {
  switch (variant) {
    case 'primary':
      return {
        backgroundColor: colors.primaryDark as ColorTokens,
        borderColor: colors.primaryDark as ColorTokens,
        hoverStyle: { backgroundColor: colors.primaryDark as ColorTokens },
        pressStyle: { backgroundColor: colors.primaryDark as ColorTokens },
        focusStyle: { backgroundColor: colors.primaryDark as ColorTokens },
      } as const;
    case 'secondary':
      return {
        backgroundColor: '$secondary',
        borderColor: '$secondary',
        hoverStyle: { backgroundColor: '$secondaryHover' },
        pressStyle: { backgroundColor: '$secondaryPress' },
      } as const;
    case 'ghost':
      return {
        backgroundColor: 'transparent',
        borderColor: '$borderColor',
        borderWidth: 1,
        hoverStyle: { backgroundColor: '$backgroundHover' },
        pressStyle: { backgroundColor: '$backgroundPress' },
      } as const;
    case 'destructive':
      return {
        backgroundColor: '$error',
        borderColor: '$error',
        hoverStyle: { backgroundColor: '#E53E3E' },
        pressStyle: { backgroundColor: '#C53030' },
      } as const;
    case 'success':
      return {
        backgroundColor: '$success',
        borderColor: '$success',
        hoverStyle: { backgroundColor: '#48BB78' },
        pressStyle: { backgroundColor: '#38A169' },
      } as const;
    default:
      return {};
  }
};

const getSizeProps = (size: ButtonSize) => {
  switch (size) {
    case 'small':
      return {
        paddingHorizontal: '$m',
        paddingVertical: '$s',
        fontSize: '$3',
        minHeight: 48,
      } as const;
    case 'medium':
      return {
        paddingHorizontal: '$l',
        paddingVertical: '$s',
        fontSize: '$4',
        minHeight: 52,
      } as const;
    case 'large':
      return {
        paddingHorizontal: '$xl',
        paddingVertical: '$s',
        fontSize: '$5',
        minHeight: 62,
      } as const;
    case 'x-large':
      return {
        paddingHorizontal: '$xl',
        paddingVertical: '$m',
        fontSize: '$6',
        minHeight: 68,
      } as const;
    default:
      return {};
  }
};

const getTextColor = (variant: ButtonVariant, disabled: boolean): ColorTokens => {
  if (disabled) return colors.textSecondary as ColorTokens;

  switch (variant) {
    case 'primary':
    case 'destructive':
    case 'success':
      return 'white';
    case 'secondary':
    case 'ghost':
      return '$color';
    default:
      return 'white';
  }
};

const getIconSize = (size: ButtonSize): number => {
  switch (size) {
    case 'small':
      return 16;
    case 'medium':
      return 18;
    case 'large':
      return 20;
    default:
      return 18;
  }
};

const resolveIconColor = (textColor: ColorTokens): string => {
  if (textColor === 'white') return 'white';

  if (textColor === '$color') return colors.textStrong;

  return colors.textSecondary;
};

const getScales = (disabled: boolean, reduced: boolean) =>
  disabled || reduced ? { default: 1, hover: 1, press: 1 } : { default: 1, hover: 1, press: 0.97 };

interface ButtonContentProps {
  loading: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  iconPosition: 'left' | 'right';
  iconSize: number;
  iconColor: string;
  textColor: ColorTokens;
  fontSize?: FontSizeTokens;
  children?: React.ReactNode;
}

function ButtonContent({
  loading,
  icon,
  iconPosition,
  iconSize,
  iconColor,
  textColor,
  fontSize,
  children,
}: ButtonContentProps) {
  const leftIcon = loading ? (
    <XStack>
      <ActivityIndicator size="small" color={iconColor} />
    </XStack>
  ) : (
    icon && iconPosition === 'left' && <Ionicons name={icon} size={iconSize} color={iconColor} />
  );

  const rightIcon = !loading && icon && iconPosition === 'right' && (
    <Ionicons name={icon} size={iconSize} color={iconColor} />
  );

  return (
    <XStack alignItems="center" justifyContent="center" gap="$s">
      {leftIcon}
      {children && (
        <Text color={textColor} fontSize={fontSize} fontWeight="600" textAlign="center">
          {children}
        </Text>
      )}
      {rightIcon}
    </XStack>
  );
}

const runAsync = (fn: () => Promise<void>) => {
  fn().catch(() => {});
};

function getButtonMotion(unavailable: boolean, preferences: ReturnType<typeof useMotionPreferences>) {
  const reduced = preferences.reducedMotion || !preferences.appActive;

  return { scales: getScales(unavailable, reduced), transition: reduced ? '0ms' : 'quicker' } as const;
}

export default function Button({
  children,
  variant = 'primary',
  size = 'medium',
  onPress,
  disabled = false,
  loading = false,
  icon,
  iconPosition = 'left',
  fullWidth = false,
  hapticFeedback = true,
}: ButtonProps) {
  const unavailable = disabled || loading;
  const handlePress = () => {
    if (unavailable) return;

    const impact = variant === 'destructive' ? 'heavy' : 'light';
    triggerHaptic(hapticFeedback ? impact : false);

    runAsync(async () => {
      await onPress?.();
    });
  };

  const variantProps = getVariantProps(variant);
  const sizeProps = getSizeProps(size);
  const textColor = getTextColor(variant, disabled);
  const iconSize = getIconSize(size);
  const iconColor = resolveIconColor(textColor);
  const isGhost = variant === 'ghost';
  const preferences = useMotionPreferences();
  const { scales, transition } = getButtonMotion(unavailable, preferences);

  return (
    <TamaguiButton
      {...variantProps}
      {...sizeProps}
      onPress={handlePress}
      disabled={unavailable}
      accessibilityRole="button"
      accessibilityState={{ disabled: unavailable, busy: loading }}
      opacity={disabled ? 0.6 : 1}
      width={fullWidth ? '100%' : 'auto'}
      borderRadius="$4"
      shadowColor={colors.primary as ColorTokens}
      shadowOffset={{ width: 0, height: 6 }}
      shadowOpacity={isGhost ? 0 : 0.14}
      shadowRadius={14}
      transition={transition}
      scale={scales.default}
      hoverStyle={{
        ...variantProps.hoverStyle,
        scale: scales.hover,
      }}
      pressStyle={{
        ...variantProps.pressStyle,
        scale: scales.press,
      }}
    >
      <ButtonContent
        loading={loading}
        icon={icon}
        iconPosition={iconPosition}
        iconSize={iconSize}
        iconColor={iconColor}
        textColor={textColor}
        fontSize={sizeProps.fontSize}
      >
        {children}
      </ButtonContent>
    </TamaguiButton>
  );
}
