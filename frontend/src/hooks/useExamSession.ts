'use client';

import { api } from '@/lib/api';
import { useExamStore } from '@/store';
import { HeartbeatResponse, ReconnectResponse, SyncResponse } from '@/types';
import { useCallback, useEffect, useRef, useState } from 'react';

interface UseExamSessionOptions {
  assignmentId: string | null;
  enabled: boolean;
  heartbeatIntervalMs?: number;
  syncDebounceMs?: number;
  onSyncError?: (error: Error) => void;
  onSessionExpired?: () => void;
  onTabConflict?: () => void;
}

interface UseExamSessionReturn {
  syncVersion: number;
  isSyncing: boolean;
  syncAnswers: (answers: Record<string, unknown>, highlights?: unknown[]) => Promise<void>;
  tabId: string;
  isSessionActive: boolean;
  lastHeartbeatAt: Date | null;
  lastSyncAt: Date | null;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30000;
const DEFAULT_SYNC_DEBOUNCE_MS = 5000;
const SYNC_RETRY_MS = 7000;

const createTabId = (): string =>
  `tab_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

export function useExamSession({
  assignmentId,
  enabled,
  heartbeatIntervalMs,
  syncDebounceMs,
  onSyncError,
  onSessionExpired,
  onTabConflict,
}: UseExamSessionOptions): UseExamSessionReturn {
  // Get state and actions from Zustand store
  const {
    syncVersion,
    isSyncing,
    lastSyncedAt,
    status,
    startSync,
    syncComplete,
    syncError,
    setStatus,
    setActiveTab,
    setTabConflict,
    setError,
  } = useExamStore();

  const isSessionActive = status === 'active';
  const resolvedHeartbeatIntervalMs = Math.max(
    15000,
    heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
  );
  const resolvedSyncDebounceMs = Math.max(
    2500,
    syncDebounceMs ?? DEFAULT_SYNC_DEBOUNCE_MS,
  );

  const heartbeatTimerRef = useRef<NodeJS.Timeout | null>(null);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const retrySyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingAnswersRef = useRef<Record<string, unknown> | null>(null);
  const pendingHighlightsRef = useRef<unknown[] | null>(null);
  const isSyncingRef = useRef(false);
  const performSyncRef = useRef<
    | ((answers: Record<string, unknown>, highlights?: unknown[]) => Promise<void>)
    | null
  >(null);

  const isAlreadySubmittedError = useCallback((error: unknown) => {
    if (!(error instanceof Error)) return false;
    const lower = error.message.toLowerCase();
    return (
      lower.includes('already submitted') ||
      lower.includes('already been submitted') ||
      lower.includes('already_submitted') ||
      lower.includes('submission already')
    );
  }, []);

  const isSessionExpiredError = useCallback((error: unknown) => {
    if (!(error instanceof Error)) return false;
    const lower = error.message.toLowerCase();
    return (
      lower.includes('time expired') ||
      lower.includes('time has expired') ||
      lower.includes('exam time has expired') ||
      lower.includes('session expired')
    );
  }, []);

  const isTransientNetworkError = useCallback((error: unknown) => {
    if (error instanceof TypeError) {
      return true;
    }

    if (!(error instanceof Error)) {
      return false;
    }

    return (
      error.message.includes('HTTP error! status: 502') ||
      error.message.includes('HTTP error! status: 503') ||
      error.message.includes('HTTP error! status: 504') ||
      error.message.includes('Request timeout after')
    );
  }, []);

  const isBrowserOffline = useCallback(() => {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  }, []);

  // Keep ref in sync with state
  useEffect(() => {
    isSyncingRef.current = isSyncing;
  }, [isSyncing]);

  const generateTabId = useCallback((): string => {
    if (typeof window === 'undefined') return 'unknown';

    const storedTabId = sessionStorage.getItem('exam_tab_id');
    if (storedTabId) return storedTabId;

    const newTabId = createTabId();
    sessionStorage.setItem('exam_tab_id', newTabId);
    return newTabId;
  }, []);

  const [tabIdValue, setTabIdValue] = useState<string>(generateTabId);
  const tabId = useRef<string>(tabIdValue);

  useEffect(() => {
    tabId.current = tabIdValue;
  }, [tabIdValue]);

  // Set active tab in store on mount
  useEffect(() => {
    setActiveTab(tabIdValue);
  }, [setActiveTab, tabIdValue]);

  // Detect duplicated tabs that copied sessionStorage and rotate tab id.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
      return;
    }

    const channel = new BroadcastChannel('exam-tab-presence');
    const currentTabId = tabId.current;
    const probeId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    let hasConflict = false;
    const navigationEntry = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    const shouldProbeForDuplicates = navigationEntry?.type !== 'reload';

    const onMessage = (event: MessageEvent) => {
      const payload = event.data as
        | {
            type?: 'probe' | 'alive';
            tabId?: string;
            probeId?: string;
          }
        | undefined;

      if (!payload?.type || payload.tabId !== currentTabId) {
        return;
      }

      if (payload.type === 'probe' && payload.probeId && payload.probeId !== probeId) {
        channel.postMessage({
          type: 'alive',
          tabId: currentTabId,
          probeId: payload.probeId,
        });
        return;
      }

      if (
        shouldProbeForDuplicates &&
        payload.type === 'alive' &&
        payload.probeId === probeId &&
        !hasConflict
      ) {
        hasConflict = true;
        const rotatedTabId = createTabId();
        tabId.current = rotatedTabId;
        sessionStorage.setItem('exam_tab_id', rotatedTabId);
        setTabIdValue(rotatedTabId);
        setActiveTab(rotatedTabId);
      }
    };

    channel.addEventListener('message', onMessage);

    if (shouldProbeForDuplicates) {
      channel.postMessage({
        type: 'probe',
        tabId: currentTabId,
        probeId,
      });
    }

    return () => {
      channel.removeEventListener('message', onMessage);
      channel.close();
    };
  }, [setActiveTab]);

  const handleHeartbeat = useCallback(async () => {
    if (!assignmentId || !enabled || !isSessionActive) return;

    if (isBrowserOffline()) {
      setError('You are offline. Reconnecting automatically when network returns...');
      return;
    }

    try {
      const response: HeartbeatResponse = await api.heartbeat(assignmentId, tabId.current);

      // Clear network error if heartbeat succeeds
      setError(null);
      setTabConflict(false);

      if (!response.active) {
        switch (response.reason) {
          case 'time_expired':
          case 'expired':
            setStatus('error');
            onSessionExpired?.();
            break;
          case 'submitted':
          case 'already_submitted':
            setStatus('submitted');
            setError(null);
            break;
          case 'another_tab':
            setTabConflict(true);
            onTabConflict?.();
            break;
          default:
            onSyncError?.(new Error(`Session inactive: ${response.reason}`));
        }
        return;
      }

      if (response.syncVersion !== undefined && response.syncVersion > syncVersion) {
        syncComplete(response.syncVersion);
      }
    } catch (error) {
      if (isAlreadySubmittedError(error)) {
        setStatus('submitted');
        setError(null);
        return;
      }
      const isNetworkError = isTransientNetworkError(error);
    
      if (isNetworkError) {
        console.warn('Heartbeat failed due to network:', error);
        setError('Network connection unstable. Retrying...');
      } else {
        console.error('Heartbeat failed:', error);
        onSyncError?.(error as Error);
      }
    }
  }, [assignmentId, enabled, isSessionActive, syncVersion, onSyncError, onSessionExpired, onTabConflict, setError, setStatus, setTabConflict, syncComplete, isAlreadySubmittedError, isTransientNetworkError, isBrowserOffline]);

  const startHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
    }

    handleHeartbeat();
    heartbeatTimerRef.current = setInterval(
      handleHeartbeat,
      resolvedHeartbeatIntervalMs,
    );
  }, [handleHeartbeat, resolvedHeartbeatIntervalMs]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const reconnect = useCallback(async () => {
    if (!assignmentId) return false;

    try {
      const response: ReconnectResponse = await api.reconnectExam(
        assignmentId,
        pendingAnswersRef.current || undefined,
        tabId.current
      );

      if (response.success) {
        syncComplete(response.syncVersion || 0);
        setStatus('active');
        return true;
      } else {
        switch (response.reason) {
          case 'already_submitted':
            setStatus('submitted');
            break;
          case 'time_expired':
            setStatus('error');
            onSessionExpired?.();
            break;
          default:
            onSyncError?.(new Error(response.message || 'Reconnect failed'));
        }
        return false;
      }
    } catch (error) {
      console.error('Reconnect failed:', error);
      return false;
    }
  }, [assignmentId, syncComplete, setStatus, onSyncError, onSessionExpired]);

  const performSync = useCallback(async (
    answersToSync: Record<string, unknown>,
    highlightsToSync: unknown[] = [],
  ) => {
    if (!assignmentId || !enabled) return;

    startSync();

    try {
      const response: SyncResponse = await api.syncAnswers(
        assignmentId,
        answersToSync,
        highlightsToSync,
        tabId.current,
        syncVersion
      );

      if (!response.success) {
        const message = response.message || 'Answer sync conflict. Reconnecting...';
        syncError(message);

        if (response.action === 'refresh') {
          const recovered = await reconnect();
          if (recovered) {
            setError(null);
            return;
          }
        }

        setError(message);
        onSyncError?.(new Error(message));
        return;
      }

      syncComplete(response.newVersion);
      setError(null);

      if (pendingAnswersRef.current === answersToSync) {
        pendingAnswersRef.current = null;
      }
      if (pendingHighlightsRef.current === highlightsToSync) {
        pendingHighlightsRef.current = null;
      }

      if (retrySyncTimeoutRef.current) {
        clearTimeout(retrySyncTimeoutRef.current);
        retrySyncTimeoutRef.current = null;
      }
    } catch (error) {
      if (isAlreadySubmittedError(error)) {
        syncError('Exam already submitted');
        setStatus('submitted');
        setError(null);
        return;
      }

      if (isSessionExpiredError(error)) {
        syncError('Session expired');
        setStatus('error');
        setError('Exam session expired. Submitting latest state...');
        onSessionExpired?.();
        return;
      }

      const isNetworkError = isTransientNetworkError(error);

      if (isNetworkError) {
        console.warn('Sync failed due to network:', error);
        syncError('Temporary network error');
        setError('Network connection unstable. Keeping local changes...');

        if (!retrySyncTimeoutRef.current) {
          retrySyncTimeoutRef.current = setTimeout(() => {
            retrySyncTimeoutRef.current = null;

            if (!assignmentId || !enabled || isSyncingRef.current) {
              return;
            }

            const pendingAnswers = pendingAnswersRef.current;
            if (!pendingAnswers) {
              return;
            }

            void performSyncRef.current?.(
              pendingAnswers,
              pendingHighlightsRef.current || [],
            );
          }, SYNC_RETRY_MS);
        }
      } else {
        console.error('Sync failed:', error);
        const message =
          error instanceof Error ? error.message : 'Unknown sync failure';
        syncError(message);
        onSyncError?.(new Error(message));
      }
    }
  }, [assignmentId, enabled, startSync, syncVersion, syncError, reconnect, setError, onSyncError, syncComplete, isAlreadySubmittedError, setStatus, onSessionExpired, isSessionExpiredError, isTransientNetworkError]);

  useEffect(() => {
    performSyncRef.current = performSync;
  }, [performSync]);

  const flushPendingSync = useCallback(async () => {
    if (!assignmentId || !enabled) return;
    if (isSyncingRef.current) return;

    const pendingAnswers = pendingAnswersRef.current;
    if (!pendingAnswers) return;

    await performSync(
      pendingAnswers,
      pendingHighlightsRef.current || [],
    );
  }, [assignmentId, enabled, performSync]);

  const syncAnswers = useCallback(async (newAnswers: Record<string, unknown>, highlights: unknown[] = []) => {
    if (!assignmentId || !enabled) return;

    // Store merged pending changes to avoid sending full answer payload every time
    pendingAnswersRef.current = {
      ...(pendingAnswersRef.current || {}),
      ...newAnswers,
    };
    if (highlights.length > 0) {
      pendingHighlightsRef.current = highlights;
    }

    if (isBrowserOffline()) {
      syncError('Offline - pending sync');
      setError('You are offline. Changes are saved locally and will sync automatically.');
      return;
    }

    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    syncTimeoutRef.current = setTimeout(async () => {
      // If a sync is already in progress, reschedule this check
      if (isSyncingRef.current) {
        syncTimeoutRef.current = setTimeout(async () => {
          if (!assignmentId || !enabled || isSyncingRef.current) {
            return;
          }

          const pendingAnswers = pendingAnswersRef.current;
          if (!pendingAnswers) {
            return;
          }

          await performSync(
            pendingAnswers,
            pendingHighlightsRef.current || [],
          );
        }, resolvedSyncDebounceMs);
        return;
      }

      await performSync(
        pendingAnswersRef.current || {},
        pendingHighlightsRef.current || [],
      );
    }, resolvedSyncDebounceMs);
  }, [assignmentId, enabled, syncError, setError, isBrowserOffline, performSync, resolvedSyncDebounceMs]);

  const handleVisibilityChange = useCallback(() => {
    if (document.hidden) {
      stopHeartbeat();
    } else {
      if (enabled && isSessionActive) {
        startHeartbeat();
        reconnect();
      }
    }
  }, [stopHeartbeat, startHeartbeat, enabled, isSessionActive, reconnect]);

  const handleOnline = useCallback(() => {
    if (!enabled || !assignmentId || !isSessionActive) {
      return;
    }

    void (async () => {
      if (retrySyncTimeoutRef.current) {
        clearTimeout(retrySyncTimeoutRef.current);
        retrySyncTimeoutRef.current = null;
      }

      setError(null);
      startHeartbeat();
      const recovered = await reconnect();
      if (recovered) {
        await flushPendingSync();
      }
      await handleHeartbeat();
    })();
  }, [enabled, assignmentId, isSessionActive, setError, startHeartbeat, reconnect, flushPendingSync, handleHeartbeat]);

  const handleOffline = useCallback(() => {
    if (!enabled || !assignmentId) {
      return;
    }

    stopHeartbeat();
    setError('Connection lost. Answers remain local and will sync when online.');
  }, [enabled, assignmentId, stopHeartbeat, setError]);

  useEffect(() => {
    const sessionEnded = status === 'submitted' || status === 'error';

    if (enabled && assignmentId && !sessionEnded) {
      if (status === 'idle' || status === 'paused') {
        setStatus('active');
      }
      startHeartbeat();

      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);

      return () => {
        stopHeartbeat();
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
        if (syncTimeoutRef.current) {
          clearTimeout(syncTimeoutRef.current);
        }
        if (retrySyncTimeoutRef.current) {
          clearTimeout(retrySyncTimeoutRef.current);
          retrySyncTimeoutRef.current = null;
        }
      };
    }

    stopHeartbeat();

    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }

    if (retrySyncTimeoutRef.current) {
      clearTimeout(retrySyncTimeoutRef.current);
      retrySyncTimeoutRef.current = null;
    }
  }, [enabled, assignmentId, startHeartbeat, stopHeartbeat, handleVisibilityChange, handleOnline, handleOffline, setStatus, status]);

  useEffect(() => {
    if (!enabled) {
      stopHeartbeat();

      if (retrySyncTimeoutRef.current) {
        clearTimeout(retrySyncTimeoutRef.current);
        retrySyncTimeoutRef.current = null;
      }
    }
  }, [enabled, stopHeartbeat]);

  return {
    syncVersion,
    isSyncing,
    syncAnswers,
    tabId: tabIdValue,
    isSessionActive,
    lastHeartbeatAt: null, // Now tracked in store
    lastSyncAt: lastSyncedAt,
  };
}
