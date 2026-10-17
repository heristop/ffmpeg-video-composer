import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  subscribeToNetworkState,
  getNetworkState,
  hasInternetConnection,
  type NetworkState,
} from '@/src/services/network';

/**
 * Hook for monitoring network state with real-time updates
 */
export const useNetworkState = () => {
  const [networkState, setNetworkState] = useState<NetworkState>({
    isConnected: false,
    isInternetReachable: null,
    type: null,
  });

  useEffect(() => {
    // Get initial state
    const fetchInitialState = async () => {
      const state = await getNetworkState();
      setNetworkState(state);
    };
    fetchInitialState().catch(() => null);

    // Subscribe to changes
    const unsubscribe = subscribeToNetworkState(setNetworkState);

    return unsubscribe;
  }, []);

  return networkState;
};

/**
 * Hook for checking internet connectivity with periodic updates
 */
export const useInternetConnectivity = (refetchInterval = 30000) => {
  return useQuery({
    queryKey: ['internet-connectivity'],
    queryFn: hasInternetConnection,
    refetchInterval,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
};

/**
 * Hook for network-aware operations
 */
export const useNetworkAware = () => {
  const networkState = useNetworkState();
  const { data: hasInternet = false } = useInternetConnectivity();

  return {
    ...networkState,
    hasInternet,
    isOnline: networkState.isConnected && hasInternet,
    isOffline: !networkState.isConnected || !hasInternet,
  };
};

/**
 * Hook for detecting when device comes back online
 */
export const useOnlineStatusChange = (onOnline?: () => void, onOffline?: () => void) => {
  const networkState = useNetworkState();
  const { data: hasInternet } = useInternetConnectivity();

  const isOnline = networkState.isConnected && Boolean(hasInternet);

  // Keep the callbacks and the previous status in refs so the effect depends ONLY on the
  // stable `isOnline` boolean. Listing the (inline) callbacks as deps re-ran this effect on
  // every render, and the previous setState made it re-render, causing an update-depth loop.
  const onOnlineRef = useRef(onOnline);
  const onOfflineRef = useRef(onOffline);
  const previouslyOnlineRef = useRef<boolean | null>(null);

  useEffect(() => {
    onOnlineRef.current = onOnline;
    onOfflineRef.current = onOffline;
  }, [onOnline, onOffline]);

  useEffect(() => {
    const previouslyOnline = previouslyOnlineRef.current;

    if (previouslyOnline !== null) {
      if (!previouslyOnline && isOnline) {
        // Just came online
        onOnlineRef.current?.();
      }

      if (previouslyOnline && !isOnline) {
        // Just went offline
        onOfflineRef.current?.();
      }
    }

    previouslyOnlineRef.current = isOnline;
  }, [isOnline]);

  return {
    isOnline,
    isOffline: !isOnline,
    networkState,
    hasInternet,
  };
};
