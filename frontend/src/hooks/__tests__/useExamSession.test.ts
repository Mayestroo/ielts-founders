import { renderHook, act, waitFor } from '@testing-library/react';
import { useExamSession } from '../useExamSession';
import * as api from '@/lib/api';

// Mock the api module
jest.mock('@/lib/api');

const mockApi = api as jest.Mocked<typeof api>;

describe('useExamSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const defaultOptions = {
    assignmentId: 'test-assignment-123',
    enabled: true,
  };

  describe('Tab ID Generation', () => {
    it('generates unique tab ID on first call', () => {
      sessionStorage.clear();
      const { result } = renderHook(() => useExamSession(defaultOptions));

      const tabId = sessionStorage.getItem('exam_tab_id');
      expect(tabId).toBeDefined();
      expect(tabId).toMatch(/^tab_\d+_[a-z0-9]+$/);
    });

    it('reuses existing tab ID from sessionStorage', () => {
      const existingTabId = 'tab_123_abc123';
      sessionStorage.setItem('exam_tab_id', existingTabId);

      const { result } = renderHook(() => useExamSession(defaultOptions));

      expect(sessionStorage.getItem('exam_tab_id')).toBe(existingTabId);
    });
  });

  describe('Heartbeat', () => {
    it('calls heartbeat API every 30 seconds when enabled', async () => {
      mockApi.heartbeat.mockResolvedValue({
        active: true,
        remainingSeconds: 1800,
        syncVersion: 1,
        serverTime: new Date().toISOString(),
      });

      renderHook(() => useExamSession(defaultOptions));

      // Initial heartbeat
      await waitFor(() => {
        expect(mockApi.heartbeat).toHaveBeenCalledTimes(1);
      });

      // Advance time by 30 seconds
      act(() => {
        jest.advanceTimersByTime(30000);
      });

      await waitFor(() => {
        expect(mockApi.heartbeat).toHaveBeenCalledTimes(2);
      });
    });

    it('does not call heartbeat when disabled', async () => {
      const { result } = renderHook(() =>
        useExamSession({ ...defaultOptions, enabled: false })
      );

      // Advance time by 60 seconds
      act(() => {
        jest.advanceTimersByTime(60000);
      });

      expect(mockApi.heartbeat).not.toHaveBeenCalled();
    });

    it('handles session expiration', async () => {
      const onSessionExpired = jest.fn();

      mockApi.heartbeat.mockResolvedValue({
        active: false,
        reason: 'time_expired',
      });

      renderHook(() =>
        useExamSession({ ...defaultOptions, onSessionExpired })
      );

      await waitFor(() => {
        expect(onSessionExpired).toHaveBeenCalledTimes(1);
      });
    });

    it('handles tab conflict', async () => {
      const onTabConflict = jest.fn();

      mockApi.heartbeat.mockResolvedValue({
        active: false,
        reason: 'another_tab',
      });

      renderHook(() => useExamSession({ ...defaultOptions, onTabConflict }));

      await waitFor(() => {
        expect(onTabConflict).toHaveBeenCalledTimes(1);
      });
    });

    it('pauses heartbeat when tab is hidden', async () => {
      mockApi.heartbeat.mockResolvedValue({
        active: true,
        remainingSeconds: 1800,
      });

      const { result } = renderHook(() => useExamSession(defaultOptions));

      await waitFor(() => {
        expect(mockApi.heartbeat).toHaveBeenCalledTimes(1);
      });

      const callCountBeforeHide = mockApi.heartbeat.mock.calls.length;

      // Hide tab
      act(() => {
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });

      // Advance time by 60 seconds while hidden
      act(() => {
        jest.advanceTimersByTime(60000);
      });

      expect(mockApi.heartbeat).toHaveBeenCalledTimes(callCountBeforeHide);

      // Show tab
      act(() => {
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });

      await waitFor(() => {
        expect(mockApi.heartbeat).toHaveBeenCalledTimes(callCountBeforeHide + 1);
      });
    });
  });

  describe('Answer Synchronization', () => {
    it('debounces sync calls', async () => {
      mockApi.syncAnswers.mockResolvedValue({
        success: true,
        newVersion: 1,
        syncedAt: new Date().toISOString(),
      });

      const { result } = renderHook(() => useExamSession(defaultOptions));

      const syncAnswers = result.current.syncAnswers;

      // Make multiple rapid changes
      await act(async () => {
        syncAnswers({ q1: 'answer1' });
        syncAnswers({ q1: 'answer2' });
        syncAnswers({ q1: 'answer3' });
      });

      // Should only call sync once due to debounce
      await waitFor(() => {
        expect(mockApi.syncAnswers).toHaveBeenCalledTimes(1);
      });

      expect(mockApi.syncAnswers).toHaveBeenCalledWith(
        'test-assignment-123',
        { q1: 'answer3' },
        [],
        0
      );
    });

    it('updates syncVersion on successful sync', async () => {
      mockApi.syncAnswers.mockResolvedValue({
        success: true,
        newVersion: 5,
        syncedAt: new Date().toISOString(),
      });

      const { result } = renderHook(() => useExamSession(defaultOptions));

      await act(async () => {
        await result.current.syncAnswers({ q1: 'answer' });
      });

      await waitFor(() => {
        expect(result.current.syncVersion).toBe(5);
      });
    });

    it('handles merge conflicts from server', async () => {
      mockApi.syncAnswers.mockResolvedValue({
        success: false,
        newVersion: 3,
        syncedAt: new Date().toISOString(),
        mergedAnswers: { q1: 'server-answer', q2: 'client-answer' },
      });

      const { result } = renderHook(() => useExamSession(defaultOptions));

      await act(async () => {
        await result.current.syncAnswers({ q2: 'client-answer' });
      });

      await waitFor(() => {
        expect(result.current.syncVersion).toBe(3);
      });
    });

    it('sets isSyncing state during sync', async () => {
      let syncResolve: (value: any) => void;
      const syncPromise = new Promise((resolve) => {
        syncResolve = resolve;
      });

      mockApi.syncAnswers.mockImplementation(() => syncPromise);

      const { result } = renderHook(() => useExamSession(defaultOptions));

      act(() => {
        result.current.syncAnswers({ q1: 'answer' });
      });

      expect(result.current.isSyncing).toBe(true);

      await act(async () => {
        await syncResolve({ success: true, newVersion: 1, syncedAt: new Date().toISOString() });
      });

      expect(result.current.isSyncing).toBe(false);
    });
  });

  describe('Reconnection', () => {
    it('attempts reconnection on tab visibility change', async () => {
      mockApi.reconnectExam.mockResolvedValue({
        success: true,
        assignment: {
          id: 'test-assignment-123',
          remainingTime: 1800,
        } as any,
        syncVersion: 2,
      });

      renderHook(() => useExamSession(defaultOptions));

      // Trigger visibility change
      act(() => {
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });

      await waitFor(() => {
        expect(mockApi.reconnectExam).toHaveBeenCalledWith('test-assignment-123', null);
      });
    });

    it('updates syncVersion on successful reconnection', async () => {
      mockApi.reconnectExam.mockResolvedValue({
        success: true,
        assignment: {
          id: 'test-assignment-123',
          remainingTime: 1800,
        } as any,
        syncVersion: 7,
      });

      const { result } = renderHook(() => useExamSession(defaultOptions));

      // Trigger visibility change
      act(() => {
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });

      await waitFor(() => {
        expect(result.current.syncVersion).toBe(7);
      });
    });

    it('handles session already submitted on reconnection', async () => {
      const onSessionExpired = jest.fn();

      mockApi.reconnectExam.mockResolvedValue({
        success: false,
        reason: 'already_submitted',
        message: 'This exam has already been submitted',
      });

      renderHook(() =>
        useExamSession({ ...defaultOptions, onSessionExpired })
      );

      act(() => {
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });

      await waitFor(() => {
        expect(onSessionExpired).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Error Handling', () => {
    it('calls onSyncError on heartbeat failure', async () => {
      const onSyncError = jest.fn();

      mockApi.heartbeat.mockRejectedValue(new Error('Network error'));

      renderHook(() => useExamSession({ ...defaultOptions, onSyncError }));

      await waitFor(() => {
        expect(onSyncError).toHaveBeenCalled();
      });
    });

    it('calls onSyncError on sync failure', async () => {
      const onSyncError = jest.fn();

      mockApi.syncAnswers.mockRejectedValue(new Error('Sync failed'));

      const { result } = renderHook(() =>
        useExamSession({ ...defaultOptions, onSyncError })
      );

      await act(async () => {
        await result.current.syncAnswers({ q1: 'answer' });
      });

      await waitFor(() => {
        expect(onSyncError).toHaveBeenCalled();
      });
    });
  });

  describe('Cleanup', () => {
    it('clears heartbeat timer on unmount', async () => {
      const { unmount } = renderHook(() => useExamSession(defaultOptions));

      await waitFor(() => {
        expect(mockApi.heartbeat).toHaveBeenCalled();
      });

      unmount();

      const callCount = mockApi.heartbeat.mock.calls.length;

      // Advance time by 60 seconds
      act(() => {
        jest.advanceTimersByTime(60000);
      });

      expect(mockApi.heartbeat).toHaveBeenCalledTimes(callCount);
    });

    it('removes visibility event listener on unmount', () => {
      const { unmount } = renderHook(() => useExamSession(defaultOptions));

      const addEventListenerSpy = jest.spyOn(document, 'addEventListener');
      const removeEventListenerSpy = jest.spyOn(document, 'removeEventListener');

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'visibilitychange',
        expect.any(Function)
      );
    });
  });
});
