import { act, cleanup, renderHook } from '@testing-library/react';
import { api as apiClient } from '@/lib/api';
import { useExamStore } from '@/store';
import { useExamSession } from '../useExamSession';

jest.mock('@/lib/api', () => ({
  api: {
    heartbeat: jest.fn(),
    reconnectExam: jest.fn(),
    syncAnswers: jest.fn(),
  },
}));

const mockApi = apiClient as jest.Mocked<
  Pick<typeof apiClient, 'heartbeat' | 'reconnectExam' | 'syncAnswers'>
>;

const HEARTBEAT_INTERVAL = 30_000;
const SYNC_DEBOUNCE_MS = 5_000;

const defaultOptions = {
  assignmentId: 'test-assignment-123',
  enabled: true,
};

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useExamSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    act(() => {
      useExamStore.getState().reset();
      useExamStore.setState({ status: 'active' });
    });
    sessionStorage.clear();
    localStorage.clear();
    (document as Document & { hidden: boolean }).hidden = false;

    mockApi.heartbeat.mockResolvedValue({
      active: true,
      remainingSeconds: 1800,
      syncVersion: 0,
      serverTime: new Date().toISOString(),
    });
    mockApi.syncAnswers.mockResolvedValue({
      success: true,
      newVersion: 1,
      syncedAt: new Date().toISOString(),
    });
    mockApi.reconnectExam.mockResolvedValue({
      success: true,
      syncVersion: 1,
    });
  });

  afterEach(() => {
    cleanup();
    jest.clearAllTimers();
    jest.useRealTimers();
    act(() => {
      useExamStore.getState().reset();
    });
  });

  it('generates a tab id and reuses an existing one', () => {
    const { unmount } = renderHook(() =>
      useExamSession({ ...defaultOptions, enabled: false }),
    );
    const first = sessionStorage.getItem('exam_tab_id');
    expect(first).toMatch(/^tab_\d+_[a-z0-9]+$/);
    unmount();

    sessionStorage.setItem('exam_tab_id', 'tab_123_existing');
    const { unmount: unmountSecond } = renderHook(() =>
      useExamSession({ ...defaultOptions, enabled: false }),
    );
    expect(sessionStorage.getItem('exam_tab_id')).toBe('tab_123_existing');
    unmountSecond();
  });

  it('runs heartbeat immediately and every 30 seconds', async () => {
    jest.useFakeTimers();
    const { unmount } = renderHook(() => useExamSession(defaultOptions));

    await flushAsync();
    expect(mockApi.heartbeat).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(HEARTBEAT_INTERVAL);
      await Promise.resolve();
    });

    expect(mockApi.heartbeat).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('does not heartbeat when disabled', async () => {
    renderHook(() => useExamSession({ ...defaultOptions, enabled: false }));
    await flushAsync();
    expect(mockApi.heartbeat).not.toHaveBeenCalled();
  });

  it('invokes session-expired callback when heartbeat reports expiration', async () => {
    const onSessionExpired = jest.fn();
    mockApi.heartbeat.mockResolvedValue({ active: false, reason: 'time_expired' });

    renderHook(() => useExamSession({ ...defaultOptions, onSessionExpired }));
    await flushAsync();

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('invokes tab-conflict callback when heartbeat reports another tab', async () => {
    const onTabConflict = jest.fn();
    mockApi.heartbeat.mockResolvedValue({ active: false, reason: 'another_tab' });

    renderHook(() => useExamSession({ ...defaultOptions, onTabConflict }));
    await flushAsync();

    expect(onTabConflict).toHaveBeenCalledTimes(1);
  });

  it('debounces answer sync requests and sends latest payload', async () => {
    jest.useFakeTimers();
    const { result, unmount } = renderHook(() => useExamSession(defaultOptions));

    await act(async () => {
      await result.current.syncAnswers({ q1: 'answer-1' });
      await result.current.syncAnswers({ q1: 'answer-2' });
      await result.current.syncAnswers({ q1: 'answer-3' });
    });

    expect(mockApi.syncAnswers).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(SYNC_DEBOUNCE_MS);
      await Promise.resolve();
    });

    expect(mockApi.syncAnswers).toHaveBeenCalledTimes(1);
    expect(mockApi.syncAnswers).toHaveBeenCalledWith(
      'test-assignment-123',
      { q1: 'answer-3' },
      [],
      expect.any(String),
      0,
    );
    unmount();
  });

  it('updates syncVersion after a successful sync', async () => {
    jest.useFakeTimers();
    mockApi.syncAnswers.mockResolvedValue({
      success: true,
      newVersion: 5,
      syncedAt: new Date().toISOString(),
    });

    const { result, unmount } = renderHook(() => useExamSession(defaultOptions));

    await act(async () => {
      await result.current.syncAnswers({ q1: 'answer' });
    });

    act(() => {
      jest.advanceTimersByTime(SYNC_DEBOUNCE_MS);
    });
    await flushAsync();

    expect(result.current.syncVersion).toBe(5);
    unmount();
  });

  it('reconnects when tab becomes visible again', async () => {
    const { unmount } = renderHook(() => useExamSession(defaultOptions));
    await flushAsync();

    act(() => {
      (document as Document & { hidden: boolean }).hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
    });

    act(() => {
      (document as Document & { hidden: boolean }).hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await flushAsync();

    expect(mockApi.reconnectExam).toHaveBeenCalledWith(
      'test-assignment-123',
      undefined,
      expect.any(String),
    );
    unmount();
  });

  it('calls onSyncError for non-transient heartbeat failures', async () => {
    const onSyncError = jest.fn();
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockApi.heartbeat.mockRejectedValue(new Error('Server exploded'));

    renderHook(() => useExamSession({ ...defaultOptions, onSyncError }));
    await flushAsync();

    expect(onSyncError).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });

  it('stops heartbeat interval on unmount', async () => {
    jest.useFakeTimers();
    const { unmount } = renderHook(() => useExamSession(defaultOptions));

    await flushAsync();
    const beforeUnmount = mockApi.heartbeat.mock.calls.length;

    unmount();

    await act(async () => {
      jest.advanceTimersByTime(HEARTBEAT_INTERVAL * 2);
      await Promise.resolve();
    });

    expect(mockApi.heartbeat).toHaveBeenCalledTimes(beforeUnmount);
  });
});
