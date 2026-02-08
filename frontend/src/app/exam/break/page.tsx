"use client";

import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { ExamAssignment } from "@/types";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

function formatTime(totalSeconds: number) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

import { Suspense } from "react";

function BreakContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading } = useAuth();
  const nextAssignmentId = searchParams.get("next");
  const endsAtParam = searchParams.get("endsAt");

  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [nextAssignment, setNextAssignment] = useState<ExamAssignment | null>(null);
  const [autoStarted, setAutoStarted] = useState(false);

  const requestFullscreen = useCallback(async () => {
    try {
      const nav = navigator as Navigator & {
        keyboard?: { lock?: (keys: string[]) => Promise<void> };
        userActivation?: { isActive: boolean };
      };

      if (nav.userActivation && !nav.userActivation.isActive) {
        return;
      }

      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }

      if (nav.keyboard?.lock) {
        try {
          await nav.keyboard.lock(["Escape"]);
        } catch (lockError) {
          console.warn("Keyboard lock failed:", lockError);
        }
      }
    } catch (error) {
      console.warn("Fullscreen request failed:", error);
    }
  }, []);

  const endsAt = useMemo(() => {
    if (!endsAtParam) return null;
    const parsed = new Date(endsAtParam);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }, [endsAtParam]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/login");
      return;
    }
    if (!nextAssignmentId || !endsAt) {
      router.push("/dashboard");
    }
  }, [endsAt, isAuthenticated, isLoading, nextAssignmentId, router]);

  useEffect(() => {
    if (!nextAssignmentId || !isAuthenticated) return;
    api
      .getAssignment(nextAssignmentId)
      .then((assignment) => setNextAssignment(assignment))
      .catch(() => setNextAssignment(null));
  }, [isAuthenticated, nextAssignmentId]);

  useEffect(() => {
    if (!endsAt) return;

    const tick = () => {
      const now = new Date();
      const diff = Math.ceil((endsAt.getTime() - now.getTime()) / 1000);
      setRemainingSeconds(diff);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [endsAt]);

  const handleStart = useCallback(async () => {
    if (!nextAssignmentId) return;
    await requestFullscreen();
    router.push(`/exam/${nextAssignmentId}?showVideo=1`);
  }, [nextAssignmentId, requestFullscreen, router]);

  useEffect(() => {
    if (remainingSeconds === null || remainingSeconds > 0 || autoStarted) {
      return;
    }
    setAutoStarted(true);
    const timeout = setTimeout(() => handleStart(), 1000);
    return () => clearTimeout(timeout);
  }, [autoStarted, handleStart, remainingSeconds]);

  const canStart = remainingSeconds !== null && remainingSeconds <= 0;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-lg bg-white border border-gray-100 shadow-sm rounded-3xl p-10">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-gray-900 text-white flex items-center justify-center">
            <svg
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mt-4">
            Break in progress
          </h1>
          <p className="text-gray-500 mt-2">
            Take a short break. Your next section will unlock automatically.
          </p>
        </div>

        <div className="mt-8 rounded-2xl border border-gray-100 bg-gray-50 px-6 py-5 text-center">
          <p className="text-sm uppercase tracking-widest text-gray-400">Time remaining</p>
          <p className="text-4xl font-semibold text-gray-900 mt-2">
            {remainingSeconds === null ? "--:--" : formatTime(remainingSeconds)}
          </p>
          {nextAssignment?.section?.type && (
            <p className="text-sm text-gray-500 mt-2">
              Next: {nextAssignment.section.type} ({nextAssignment.section.duration} mins)
            </p>
          )}
        </div>

        <div className="mt-8 flex flex-col items-center gap-3">
          <button
            onClick={handleStart}
            disabled={!canStart}
            className={`w-full py-3 rounded-full text-sm font-semibold transition-all ${
              canStart
                ? "bg-black text-white hover:bg-gray-800"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}
          >
            {canStart ? "Start next section" : "Break time"}
          </button>
          <button
            onClick={() => router.push("/dashboard")}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Return to dashboard
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BreakPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <BreakContent />
    </Suspense>
  );
}
