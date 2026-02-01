'use client';

import { useEffect, useState } from 'react';

interface SessionDebugInfo {
  tabId: string | null;
  lastHeartbeat: string | null;
  lastSync: string | null;
  syncVersion: number;
  sessionActive: boolean;
  isSyncing: boolean;
  heartbeatCount: number;
  syncCount: number;
  networkStatus: 'online' | 'offline' | 'unknown';
}

export function SessionDebug({ enabled = false }: { enabled?: boolean }) {
  const [debugInfo, setDebugInfo] = useState<SessionDebugInfo>({
    tabId: null,
    lastHeartbeat: null,
    lastSync: null,
    syncVersion: 0,
    sessionActive: true,
    isSyncing: false,
    heartbeatCount: 0,
    syncCount: 0,
    networkStatus: 'unknown',
  });

  useEffect(() => {
    if (!enabled) return;

    const updateDebugInfo = () => {
      const tabId = sessionStorage.getItem('exam_tab_id');
      setDebugInfo((prev) => ({
        ...prev,
        tabId,
        networkStatus: navigator.onLine ? 'online' : 'offline',
      }));
    };

    // Listen for network changes
    const handleOnline = () => {
      setDebugInfo((prev) => ({ ...prev, networkStatus: 'online' }));
    };

    const handleOffline = () => {
      setDebugInfo((prev) => ({ ...prev, networkStatus: 'offline' }));
    };

    // Listen for visibility changes
    const handleVisibilityChange = () => {
      console.log('[Session Debug] Visibility changed:', document.hidden ? 'hidden' : 'visible');
    };

    // Initial update
    updateDebugInfo();

    // Event listeners
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled]);

  // Expose debug functions to window for console debugging
  useEffect(() => {
    if (!enabled) return;

    (window as any).__sessionDebug = {
      updateState: (updates: Partial<SessionDebugInfo>) => {
        setDebugInfo((prev) => ({ ...prev, ...updates }));
      },
      getState: () => debugInfo,
      incrementHeartbeat: () => {
        setDebugInfo((prev) => ({
          ...prev,
          lastHeartbeat: new Date().toISOString(),
          heartbeatCount: prev.heartbeatCount + 1,
        }));
      },
      incrementSync: () => {
        setDebugInfo((prev) => ({
          ...prev,
          lastSync: new Date().toISOString(),
          syncCount: prev.syncCount + 1,
        }));
      },
    };

    return () => {
      delete (window as any).__sessionDebug;
    };
  }, [enabled, debugInfo]);

  if (!enabled) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-black/90 text-white p-2 text-xs font-mono z-9999">
      <div className="flex items-center justify-between mb-1">
        <span className="font-bold">Session Debug</span>
        <button
          onClick={() => {
            (window as any).__sessionDebug?.getState() && console.log(
              '[Session Debug] Current state:',
              (window as any).__sessionDebug.getState()
            );
          }}
          className="bg-blue-600 px-2 py-0.5 rounded hover:bg-blue-700"
        >
          Log to Console
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <div className="text-gray-400">Tab ID:</div>
          <div className="text-yellow-400 break-all">{debugInfo.tabId || 'N/A'}</div>
        </div>
        <div>
          <div className="text-gray-400">Network:</div>
          <div className={`${debugInfo.networkStatus === 'online' ? 'text-green-400' : 'text-red-400'}`}>
            {debugInfo.networkStatus.toUpperCase()}
          </div>
        </div>
        <div>
          <div className="text-gray-400">Session:</div>
          <div className={`${debugInfo.sessionActive ? 'text-green-400' : 'text-red-400'}`}>
            {debugInfo.sessionActive ? 'ACTIVE' : 'INACTIVE'}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-1">
        <div>
          <div className="text-gray-400">Last Heartbeat:</div>
          <div className="text-blue-400">
            {debugInfo.lastHeartbeat
              ? new Date(debugInfo.lastHeartbeat).toLocaleTimeString()
              : 'Never'}
          </div>
        </div>
        <div>
          <div className="text-gray-400">Last Sync:</div>
          <div className="text-purple-400">
            {debugInfo.lastSync
              ? new Date(debugInfo.lastSync).toLocaleTimeString()
              : 'Never'}
          </div>
        </div>
        <div>
          <div className="text-gray-400">Sync Version:</div>
          <div className="text-orange-400">v{debugInfo.syncVersion}</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-1">
        <div>
          <div className="text-gray-400">Heartbeats:</div>
          <div className="text-cyan-400">{debugInfo.heartbeatCount}</div>
        </div>
        <div>
          <div className="text-gray-400">Syncs:</div>
          <div className="text-pink-400">{debugInfo.syncCount}</div>
        </div>
        <div>
          <div className="text-gray-400">Syncing:</div>
          <div className={debugInfo.isSyncing ? 'text-yellow-400 animate-pulse' : 'text-gray-500'}>
            {debugInfo.isSyncing ? 'YES' : 'NO'}
          </div>
        </div>
      </div>
    </div>
  );
}

// Export types for TypeScript
export type { SessionDebugInfo };
