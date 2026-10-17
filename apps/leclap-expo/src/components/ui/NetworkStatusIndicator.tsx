import React, { useState, useEffect, type ComponentProps } from 'react';
import { TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { XStack, YStack, Text, Card } from 'tamagui';
import { useOffline } from '@/src/providers/OfflineProvider';
import { useTemplatesSyncStatus } from '@/src/hooks/useTemplates';
import * as Haptics from 'expo-haptics';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

interface NetworkStatusIndicatorProps {
  showWhenOnline?: boolean;
  compact?: boolean;
  expandable?: boolean;
  showSyncStatus?: boolean;
}

interface SyncStatus {
  hasCache: boolean;
  isCacheStale: boolean;
  needsSync: boolean;
}

function getConnectionIcon(isOffline: boolean, networkType: string | null | undefined): IoniconName {
  if (isOffline) return 'wifi-outline';

  if (networkType === 'wifi') return 'wifi';

  if (networkType === 'cellular') return 'cellular';

  return 'globe-outline';
}

function getConnectionColor(isOffline: boolean, hasInternet: boolean | null | undefined): string {
  if (isOffline) return '$error';

  if (hasInternet) return '$success';

  return '$warning';
}

function getStatusText(isOffline: boolean, hasInternet: boolean | null | undefined): string {
  if (isOffline) return 'Offline';

  if (!hasInternet) return 'No Internet';

  return 'Online';
}

function triggerHaptic(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
}

function CellularBars() {
  return (
    <XStack alignItems="flex-end" gap={1}>
      {[1, 2, 3, 4].map((bar) => (
        <YStack
          key={bar}
          width={3}
          height={bar * 3 + 6}
          backgroundColor={bar <= 3 ? '$success' : '$color9'}
          borderRadius={1}
        />
      ))}
    </XStack>
  );
}

interface SyncStatusRowsProps {
  syncStatus: SyncStatus;
}

function SyncStatusRows({ syncStatus }: SyncStatusRowsProps) {
  return (
    <YStack marginTop="$s" gap="$xs">
      <XStack justifyContent="space-between" alignItems="center">
        <Text fontSize="$2" color="$colorTransparent" opacity={0.7}>
          Cache:
        </Text>
        <Text fontSize="$2" color="$color" fontWeight="500">
          {syncStatus.hasCache ? '✅' : '❌'} {syncStatus.hasCache ? 'Available' : 'Empty'}
        </Text>
      </XStack>

      <XStack justifyContent="space-between" alignItems="center">
        <Text fontSize="$2" color="$colorTransparent" opacity={0.7}>
          Status:
        </Text>
        <Text fontSize="$2" color="$color" fontWeight="500">
          {syncStatus.isCacheStale ? '⚠️ Stale' : '✅ Fresh'}
        </Text>
      </XStack>

      {syncStatus.needsSync && (
        <XStack justifyContent="space-between" alignItems="center">
          <Text fontSize="$2" color="$colorTransparent" opacity={0.7}>
            Sync:
          </Text>
          <Text fontSize="$2" color="$warning" fontWeight="500">
            📡 Pending
          </Text>
        </XStack>
      )}
    </YStack>
  );
}

interface ConnectionHeaderProps {
  connectionIcon: IoniconName;
  connectionColor: string;
  statusText: string;
  networkType: string | null | undefined;
  isOnline: boolean;
  hasInternet: boolean | null | undefined;
  isExpanded: boolean;
  expandable: boolean;
}

function ConnectionHeader({
  connectionIcon,
  connectionColor,
  statusText,
  networkType,
  isOnline,
  hasInternet,
  isExpanded,
  expandable,
}: ConnectionHeaderProps) {
  return (
    <XStack alignItems="center" justifyContent="space-between" gap="$m">
      <XStack alignItems="center" gap="$s" flex={1}>
        <XStack alignItems="center" gap="$xs">
          <Ionicons name={connectionIcon} size={20} color={connectionColor} />

          {networkType === 'cellular' && hasInternet && <CellularBars />}
        </XStack>

        <YStack flex={1}>
          <Text fontSize="$4" fontWeight="600" color="$color">
            {statusText}
          </Text>

          {networkType && isOnline && (
            <Text fontSize="$2" color="$colorTransparent" opacity={0.7}>
              {networkType.toUpperCase()}
            </Text>
          )}
        </YStack>
      </XStack>

      {expandable && <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color="$colorTransparent" />}
    </XStack>
  );
}

function useAutoExpand(
  isOnline: boolean,
  isExpanded: boolean,
  showWhenOnline: boolean,
  setIsExpanded: (v: boolean) => void,
  setLastStatusChange: (d: Date) => void
) {
  useEffect(() => {
    setLastStatusChange(new Date());

    if (!isOnline) {
      setIsExpanded(true);
    }
  }, [isOnline, setIsExpanded, setLastStatusChange]);

  useEffect(() => {
    if (isOnline && isExpanded && !showWhenOnline) {
      const timer = setTimeout(() => {
        setIsExpanded(false);
      }, 5000);

      return () => {
        clearTimeout(timer);
      };
    }

    return () => {};
  }, [isOnline, isExpanded, showWhenOnline, setIsExpanded]);
}

const NetworkStatusContent = ({
  compact,
  expandable,
  connectionIcon,
  connectionColor,
  statusText,
  networkType,
  isOnline,
  hasInternet,
  isExpanded,
  setIsExpanded,
  syncStatus,
  showSyncStatus,
}: {
  compact: boolean;
  expandable: boolean;
  connectionIcon: keyof typeof Ionicons.glyphMap;
  connectionColor: string;
  statusText: string;
  networkType: string;
  isOnline: boolean;
  hasInternet: boolean;
  isExpanded: boolean;
  setIsExpanded: (value: boolean) => void;
  syncStatus: ReturnType<typeof useTemplatesSyncStatus>['data'];
  showSyncStatus: boolean;
}) => {
  const handleToggleExpand = () => {
    if (!expandable) return;
    triggerHaptic();
    setIsExpanded(!isExpanded);
  };

  if (compact) {
    return (
      <XStack padding="$xs">
        <Ionicons name={connectionIcon} size={16} color={connectionColor} />
      </XStack>
    );
  }

  return (
    <TouchableOpacity onPress={handleToggleExpand} disabled={!expandable} activeOpacity={0.8}>
      <Card
        margin="$s"
        overflow="hidden"
        backgroundColor="$backgroundStrong"
        borderColor="$borderColor"
        borderRadius="$3"
      >
        <ConnectionHeader
          connectionIcon={connectionIcon}
          connectionColor={connectionColor}
          statusText={statusText}
          networkType={networkType}
          isOnline={isOnline}
          hasInternet={hasInternet}
          isExpanded={isExpanded}
          expandable={expandable}
        />
        {isExpanded && showSyncStatus && syncStatus ? <SyncStatusRows syncStatus={syncStatus} /> : null}
      </Card>
    </TouchableOpacity>
  );
};

function NetworkStatusIndicator({
  showWhenOnline = false,
  compact = false,
  expandable = true,
  showSyncStatus = true,
}: NetworkStatusIndicatorProps) {
  const { isOnline, isOffline, networkType, hasInternet } = useOffline();
  const { data: syncStatus } = useTemplatesSyncStatus();
  const [isExpanded, setIsExpanded] = useState(false);
  const [_lastStatusChange, setLastStatusChange] = useState<Date | null>(null);

  useAutoExpand(isOnline, isExpanded, showWhenOnline, setIsExpanded, setLastStatusChange);

  if (isOnline && !showWhenOnline) {
    return null;
  }

  const connectionIcon = getConnectionIcon(isOffline, networkType);
  const connectionColor = getConnectionColor(isOffline, hasInternet);
  const statusText = getStatusText(isOffline, hasInternet);

  return (
    <NetworkStatusContent
      compact={compact}
      expandable={expandable}
      connectionIcon={connectionIcon}
      connectionColor={connectionColor}
      statusText={statusText}
      networkType={networkType ?? 'unknown'}
      isOnline={isOnline}
      hasInternet={hasInternet}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      syncStatus={syncStatus}
      showSyncStatus={showSyncStatus}
    />
  );
}

export default NetworkStatusIndicator;
export { NetworkStatusIndicator };
