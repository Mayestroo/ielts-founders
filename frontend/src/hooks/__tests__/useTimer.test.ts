import { act, renderHook } from '@testing-library/react';

import { useTimer } from '../useTimer';

describe('useTimer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps counting down when onExpire callback identity changes frequently', () => {
    const expireSpy = jest.fn();

    const { result, rerender } = renderHook(
      ({ onExpire }) =>
        useTimer({
          initialSeconds: 5,
          autoStart: true,
          onExpire,
        }),
      {
        initialProps: {
          onExpire: () => expireSpy(),
        },
      },
    );

    act(() => {
      for (let index = 0; index < 25; index += 1) {
        rerender({ onExpire: () => expireSpy() });
        jest.advanceTimersByTime(200);
      }
    });

    expect(result.current.seconds).toBe(0);
    expect(result.current.isExpired).toBe(true);
    expect(expireSpy).toHaveBeenCalledTimes(1);
  });

  it('pauses and resumes without resetting remaining seconds', () => {
    const { result, rerender } = renderHook(
      ({ autoStart }) =>
        useTimer({
          initialSeconds: 10,
          autoStart,
        }),
      {
        initialProps: {
          autoStart: false,
        },
      },
    );

    act(() => {
      rerender({ autoStart: true });
    });

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(result.current.seconds).toBe(7);

    act(() => {
      rerender({ autoStart: false });
    });

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(result.current.seconds).toBe(7);

    act(() => {
      rerender({ autoStart: true });
    });

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(result.current.seconds).toBe(5);
  });
});
