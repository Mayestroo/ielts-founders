'use client';

import { api } from '@/lib/api';
import { useExamStore } from '@/store';
import { HeartbeatResponse, ReconnectResponse, SyncResponse } from '@/types';
import { useCallback, useEffect, useRef } from 'react';

interface UseExamSessionOptions {
  assignmentId: string | null;
  enabled: boolean;
  onSyncError?: (error: Error) => void;
  onSessionExpired?: () => void;
  onTabConflict?: () => void;
}

interface UseExamSessionReturn {
  syncVersion: number;
  isSyncing: boolean;
  syncAnswers: (answers: Record<string, unknown>, highlights?: unknown[]) => Promise<void>;
  isSessionActive: boolean;
  lastHeartbeatAt: Date | null;
  lastSyncAt: Date | null;
}

const HEARTBEAT_INTERVAL = 10000; // 10 seconds
const SYNC_DEBOUNCE_MS = 1000; // Debounce sync calls

export function useExamSession({
  assignmentId,
  enabled,
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
    answers,
  } = useExamStore();

  const isSessionActive = status === 'active';

  const heartbeatTimerRef = useRef<NodeJS.Timeout | null>(null);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingAnswersRef = useRef<Record<string, unknown> | null>(null);
  const pendingHighlightsRef = useRef<unknown[] | null>(null);
  const isSyncingRef = useRef(false);

  // Keep ref in sync with state
  useEffect(() => {
    isSyncingRef.current = isSyncing;
  }, [isSyncing]);

  const generateTabId = useCallback((): string => {
    if (typeof window === 'undefined') return 'unknown';

    const storedTabId = sessionStorage.getItem('exam_tab_id');
    if (storedTabId) return storedTabId;

    const newTabId = `tab_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    sessionStorage.setItem('exam_tab_id', newTabId);
    return newTabId;
  }, []);

  const tabId = useRef<string>(generateTabId());

  // Set active tab in store on mount
  useEffect(() => {
    setActiveTab(tabId.current);
  }, [setActiveTab]);

  const handleHeartbeat = useCallback(async () => {
    if (!assignmentId || !enabled || !isSessionActive) return;

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
      const isNetworkError = 
        error instanceof TypeError || 
        (error instanceof Error && (
          error.message.includes('HTTP error! status: 502') ||
          error.message.includes('HTTP error! status: 503') ||
          error.message.includes('HTTP error! status: 504')
        ));
      
      if (isNetworkError) {
        console.warn('Heartbeat failed due to network:', error);
        setError('Network connection unstable. Retrying...');
      } else {
        console.error('Heartbeat failed:', error);
        onSyncError?.(error as Error);
      }
    }
  }, [assignmentId, enabled, isSessionActive, syncVersion, onSyncError, onSessionExpired, onTabConflict, setStatus, setTabConflict, syncComplete]);

  const startHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
    }

    handleHeartbeat();
    heartbeatTimerRef.current = setInterval(handleHeartbeat, HEARTBEAT_INTERVAL);
  }, [handleHeartbeat]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const syncAnswers = useCallback(async (newAnswers: Record<string, unknown>, highlights: unknown[] = []) => {
    if (!assignmentId || !enabled) return;

    // Store the latest data regardless of sync status
    pendingAnswersRef.current = newAnswers;
    pendingHighlightsRef.current = highlights;

    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    syncTimeoutRef.current = setTimeout(async () => {
      // If a sync is already in progress, reschedule this check
      if (isSyncingRef.current) {
        syncAnswers(pendingAnswersRef.current || newAnswers, pendingHighlightsRef.current || highlights);
        return;
      }

      startSync();
      // isSyncingRef is already handled by the useEffect watching the store's isSyncing
      
      try {
        const response: SyncResponse = await api.syncAnswers(
          assignmentId,
          pendingAnswersRef.current || {},
          pendingHighlightsRef.current || [],
          syncVersion
        );

        if (response.success) {
          syncComplete(response.newVersion);
          setError(null);
          if (response.mergedAnswers) {
            // Only update if we don't have even newer pending changes locally
            // (Standard optimistic UI pattern)
          }
        }
      } catch (error) {
        const isNetworkError = 
        error instanceof TypeError || 
        (error instanceof Error && (
          error.message.includes('HTTP error! status: 502') ||
          error.message.includes('HTTP error! status: 503') ||
          error.message.includes('HTTP error! status: 504')
        ));
        
        if (isNetworkError) {
          console.warn('Sync failed due to network:', error);
          setError('Network connection unstable. Keeping local changes...');
        } else {
          console.error('Sync failed:', error);
          syncError((error as Error).message);
          onSyncError?.(error as Error);
        }
      } finally {
        // syncComplete or syncError will eventually set isSyncing to false in the store
        // which will update our isSyncingRef.current via useEffect
      }
    }, SYNC_DEBOUNCE_MS);
  }, [assignmentId, enabled, syncVersion, startSync, syncComplete, syncError, onSyncError]);

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
            onSessionExpired?.();
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

  useEffect(() => {
    if (enabled && assignmentId) {
      if (status !== 'active') {
        setStatus('active');
      }
      startHeartbeat();

      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        stopHeartbeat();
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        if (syncTimeoutRef.current) {
          clearTimeout(syncTimeoutRef.current);
        }
      };
    }
  }, [enabled, assignmentId, startHeartbeat, stopHeartbeat, handleVisibilityChange, setStatus, status]);

  useEffect(() => {
    if (!enabled) {
      stopHeartbeat();
    }
  }, [enabled, stopHeartbeat]);

  return {
    syncVersion,
    isSyncing,
    syncAnswers,
    isSessionActive,
    lastHeartbeatAt: null, // Now tracked in store
    lastSyncAt: lastSyncedAt,
  };
}
