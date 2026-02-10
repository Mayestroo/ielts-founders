'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface UseTimerOptions {
  initialSeconds: number;
  onExpire?: () => void;
  autoStart?: boolean;
}

const TICK_INTERVAL_MS = 250;

const toSafeSeconds = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

export function useTimer({ initialSeconds, onExpire, autoStart = false }: UseTimerOptions) {
  const normalizedInitialSeconds = toSafeSeconds(initialSeconds);
  const [seconds, setSeconds] = useState(normalizedInitialSeconds);
  const [isRunning, setIsRunning] = useState(autoStart && normalizedInitialSeconds > 0);

  const secondsRef = useRef(normalizedInitialSeconds);
  const endAtRef = useRef<number | null>(
    autoStart && normalizedInitialSeconds > 0
      ? Date.now() + normalizedInitialSeconds * 1000
      : null,
  );
  const autoStartRef = useRef(autoStart);
  const onExpireRef = useRef(onExpire);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasExpiredRef = useRef(false);

  const setSecondsValue = useCallback((nextSeconds: number) => {
    const safeSeconds = toSafeSeconds(nextSeconds);
    secondsRef.current = safeSeconds;
    setSeconds((current) => (current === safeSeconds ? current : safeSeconds));
    return safeSeconds;
  }, []);

  const getRemainingSeconds = useCallback(() => {
    if (endAtRef.current === null) {
      return secondsRef.current;
    }

    const remainingMs = endAtRef.current - Date.now();
    return Math.max(0, Math.ceil(remainingMs / 1000));
  }, []);

  const stopTimer = useCallback(() => {
    endAtRef.current = null;
    setIsRunning(false);
  }, []);

  const runExpire = useCallback(() => {
    if (hasExpiredRef.current) {
      return;
    }

    hasExpiredRef.current = true;
    stopTimer();
    onExpireRef.current?.();
  }, [stopTimer]);

  const startFrom = useCallback((baseSeconds: number) => {
    const safeSeconds = setSecondsValue(baseSeconds);

    if (safeSeconds <= 0) {
      runExpire();
      return;
    }

    hasExpiredRef.current = false;

    endAtRef.current = Date.now() + safeSeconds * 1000;
    setIsRunning(true);
  }, [runExpire, setSecondsValue]);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    autoStartRef.current = autoStart;

    if (autoStart) {
      startFrom(secondsRef.current);
      return;
    }

    if (endAtRef.current !== null) {
      setSecondsValue(getRemainingSeconds());
    }

    stopTimer();
  }, [autoStart, getRemainingSeconds, setSecondsValue, startFrom, stopTimer]);

  useEffect(() => {
    const safeInitialSeconds = toSafeSeconds(initialSeconds);

    if (autoStartRef.current) {
      startFrom(safeInitialSeconds);
      return;
    }

    hasExpiredRef.current = safeInitialSeconds <= 0;
    setSecondsValue(safeInitialSeconds);
    stopTimer();
  }, [initialSeconds, setSecondsValue, startFrom, stopTimer]);

  useEffect(() => {
    if (!isRunning) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const tick = () => {
      const nextSeconds = setSecondsValue(getRemainingSeconds());

      if (nextSeconds <= 0) {
        runExpire();
      }
    };

    tick();
    intervalRef.current = setInterval(tick, TICK_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [getRemainingSeconds, isRunning, runExpire, setSecondsValue]);

  const start = useCallback(() => {
    startFrom(secondsRef.current);
  }, [startFrom]);

  const pause = useCallback(() => {
    if (endAtRef.current !== null) {
      setSecondsValue(getRemainingSeconds());
    }

    stopTimer();
  }, [endAtRef, getRemainingSeconds, setSecondsValue, stopTimer]);

  const reset = useCallback(() => {
    const safeInitialSeconds = toSafeSeconds(initialSeconds);
    hasExpiredRef.current = safeInitialSeconds <= 0;
    setSecondsValue(safeInitialSeconds);
    stopTimer();
  }, [initialSeconds, setSecondsValue, stopTimer]);

  const formatTime = useCallback((secs: number) => {
    const hours = Math.floor(secs / 3600);
    const minutes = Math.floor((secs % 3600) / 60);
    const remainingSeconds = secs % 60;

    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }, []);

  return {
    seconds,
    isRunning,
    start,
    pause,
    reset,
    formattedTime: formatTime(seconds),
    isExpired: seconds <= 0,
    isUrgent: seconds <= 300 && seconds > 60, // Last 5 minutes
    isCritical: seconds <= 60, // Last minute
  };
}
