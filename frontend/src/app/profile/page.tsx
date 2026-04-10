"use client";

import { ConfirmationModal } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { STUDENT_QUERY_TIMINGS } from "@/lib/query/config";
import { studentQueryKeys } from "@/lib/query/keys";
import { ExamResult } from "@/types";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const POINT_RULES: Array<{ minBand: number; points: number }> = [
  { minBand: 9.0, points: 200 },
  { minBand: 8.5, points: 100 },
  { minBand: 8.0, points: 50 },
  { minBand: 7.5, points: 30 },
  { minBand: 7.0, points: 20 },
  { minBand: 6.5, points: 10 },
  { minBand: 6.0, points: 5 },
];
const PROFILE_ENABLED = false;

interface PointsHistoryEntry {
  key: string;
  submittedAt: string;
  sectionLabel: string;
  averageBand: number;
  previousPoints: number;
  currentPoints: number;
  delta: number;
}

const mapAverageBandToPoints = (averageBand: number | null) => {
  if (averageBand === null || !Number.isFinite(averageBand)) {
    return 0;
  }

  for (const rule of POINT_RULES) {
    if (averageBand >= rule.minBand) {
      return rule.points;
    }
  }

  return 0;
};

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

export default function ProfilePage() {
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const router = useRouter();

  const centerQuery = useQuery({
    queryKey: studentQueryKeys.center(user?.centerId || ""),
    queryFn: ({ signal }) => api.getCenter(user!.centerId!, { signal }),
    enabled: !!user?.centerId,
    staleTime: STUDENT_QUERY_TIMINGS.center.staleTime,
    gcTime: STUDENT_QUERY_TIMINGS.center.gcTime,
  });

  const profileQuery = useQuery({
    queryKey: studentQueryKeys.authProfile(),
    queryFn: ({ signal }) => api.getProfile({ signal }),
    enabled: !!user?.id && PROFILE_ENABLED,
    staleTime: STUDENT_QUERY_TIMINGS.profile.staleTime,
    gcTime: STUDENT_QUERY_TIMINGS.profile.gcTime,
    placeholderData: (previousData) => previousData,
  });

  const resultsQuery = useQuery({
    queryKey: studentQueryKeys.myResults(),
    queryFn: ({ signal }) => api.getMyResults({ signal }),
    enabled: !!user?.id && PROFILE_ENABLED,
    staleTime: STUDENT_QUERY_TIMINGS.results.staleTime,
    gcTime: STUDENT_QUERY_TIMINGS.results.gcTime,
    placeholderData: (previousData) => previousData,
  });

  const centerLogo = centerQuery.data?.logo || null;
  const profile = profileQuery.data ?? user;
  const profilePoints = profile?.points ?? user?.points ?? 0;
  const sessionDetails = {
    sessionAttendanceMode: profile?.sessionAttendanceMode,
    sessionScheduledAt: profile?.sessionScheduledAt,
    sessionReferralSource: profile?.sessionReferralSource,
    phoneNumber: profile?.phoneNumber,
  };
  const results = useMemo(
    () => (resultsQuery.data ?? []) as ExamResult[],
    [resultsQuery.data],
  );
  const loadingProfile =
    (profileQuery.isLoading && !profileQuery.data) ||
    (resultsQuery.isLoading && !resultsQuery.data);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  const scoredResults = useMemo(() => {
    return results
      .filter((result) => typeof result.bandScore === "number")
      .sort(
        (a, b) =>
          new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime(),
      );
  }, [results]);

  const averageBand = useMemo(() => {
    if (scoredResults.length === 0) {
      return null;
    }

    const totalBand = scoredResults.reduce(
      (sum, result) => sum + Number(result.bandScore),
      0,
    );

    return totalBand / scoredResults.length;
  }, [scoredResults]);

  const pointsHistory = useMemo<PointsHistoryEntry[]>(() => {
    let runningTotal = 0;
    let runningCount = 0;
    let previousPoints = 0;
    const entries: PointsHistoryEntry[] = [];

    for (const result of scoredResults) {
      runningTotal += Number(result.bandScore);
      runningCount += 1;

      const currentAverage = runningTotal / runningCount;
      const currentPoints = mapAverageBandToPoints(currentAverage);

      if (currentPoints !== previousPoints) {
        entries.push({
          key: result.id,
          submittedAt: result.submittedAt,
          sectionLabel: result.section?.type || result.section?.title || "Exam",
          averageBand: currentAverage,
          previousPoints,
          currentPoints,
          delta: currentPoints - previousPoints,
        });

        previousPoints = currentPoints;
      }
    }

    return entries.reverse();
  }, [scoredResults]);

  const nextTarget = useMemo(() => {
    if (averageBand === null) {
      return POINT_RULES[POINT_RULES.length - 1];
    }

    const ascendingRules = [...POINT_RULES].sort(
      (a, b) => a.minBand - b.minBand,
    );
    return ascendingRules.find((rule) => averageBand < rule.minBand) || null;
  }, [averageBand]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-black"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-40 h-14 rounded-xl flex items-center justify-center">
              {centerLogo ? (
                <Image
                  src={centerLogo}
                  alt="Center Logo"
                  width={160}
                  height={56}
                  loading="eager"
                  className="max-h-14 h-auto w-auto object-contain"
                />
              ) : (
                <Image
                  src="/logo.png"
                  alt="logo"
                  width={160}
                  height={56}
                  loading="eager"
                  className="max-h-14 h-auto w-auto object-contain"
                />
              )}
            </div>
          </div>

          <nav className="order-3 w-full md:order-2 md:w-auto">
            <ul className="flex items-center justify-start gap-2 md:gap-4">
              <li>
                <Link
                  href="/dashboard"
                  className="inline-flex rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                >
                  Dashboard
                </Link>
              </li>
              <li>
                <Link
                  href="/feedback"
                  className="inline-flex rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                >
                  Offline Results
                </Link>
              </li>
              <li>
                <Link
                  href="/pricing"
                  className="inline-flex rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                >
                  Pricing
                </Link>
              </li>
            </ul>
          </nav>

          <div className="order-2 md:order-3 flex items-center gap-4">
            <span className="text-gray-600">
              Welcome, {user?.firstName || user?.username}
            </span>
            <button
              onClick={() => setIsLogoutModalOpen(true)}
              className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors text-sm font-medium"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto w-full px-4 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">Profile</h2>
          <p className="text-gray-500 mt-1">
            Track your points and earning history.
          </p>
        </div>

        {!PROFILE_ENABLED ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
            <h3 className="text-lg font-semibold text-gray-900">Profile is temporarily disabled</h3>
            <p className="mt-2 text-sm text-gray-500">
              You can continue using Dashboard, Offline Results, and Exams.
            </p>
            <Link
              href="/dashboard"
              className="mt-5 inline-flex rounded-lg bg-black px-4 py-2 text-sm font-medium text-white"
            >
              Back to Dashboard
            </Link>
          </div>
        ) : loadingProfile ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-black"></div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-gray-200 bg-white p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Current Points
                </p>
                <p className="mt-3 text-3xl font-bold text-gray-900">{profilePoints}</p>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-white p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Average Band
                </p>
                <p className="mt-3 text-3xl font-bold text-gray-900">
                  {averageBand === null ? "-" : averageBand.toFixed(2)}
                </p>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-white p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Scored Tests
                </p>
                <p className="mt-3 text-3xl font-bold text-gray-900">
                  {scoredResults.length}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-6">
              <h3 className="text-lg font-semibold text-gray-900">Session Details</h3>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <p className="text-sm text-gray-600">
                  Mode: <span className="font-medium text-gray-900">{sessionDetails?.sessionAttendanceMode || "-"}</span>
                </p>
                <p className="text-sm text-gray-600">
                  Time: <span className="font-medium text-gray-900">{formatDateTime(sessionDetails?.sessionScheduledAt)}</span>
                </p>
                <p className="text-sm text-gray-600">
                  Source: <span className="font-medium text-gray-900">{sessionDetails?.sessionReferralSource || "-"}</span>
                </p>
                <p className="text-sm text-gray-600">
                  Phone: <span className="font-medium text-gray-900">{sessionDetails?.phoneNumber || "-"}</span>
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-gray-900">Points History</h3>
                {nextTarget ? (
                  <p className="text-sm text-gray-500">
                    Next target: avg {nextTarget.minBand.toFixed(1)} ({nextTarget.points} pts)
                  </p>
                ) : (
                  <p className="text-sm text-emerald-600">Maximum points reached</p>
                )}
              </div>

              {pointsHistory.length === 0 ? (
                <p className="mt-4 text-sm text-gray-500">
                  No point changes yet. Complete and submit scored tests to start earning points.
                </p>
              ) : (
                <div className="mt-4 space-y-3">
                  {pointsHistory.map((entry) => (
                    <article
                      key={entry.key}
                      className="rounded-xl border border-gray-100 bg-gray-50 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-gray-900">
                          {entry.sectionLabel} · Avg {entry.averageBand.toFixed(2)}
                        </p>
                        <span
                          className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${
                            entry.delta >= 0
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {entry.delta >= 0 ? `+${entry.delta}` : entry.delta} pts
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {new Date(entry.submittedAt).toLocaleDateString()} · {entry.previousPoints} → {entry.currentPoints} points
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <ConfirmationModal
        isOpen={isLogoutModalOpen}
        onClose={() => setIsLogoutModalOpen(false)}
        onConfirm={logout}
        title="Sign Out"
        message="Are you sure you want to sign out?"
        confirmText="Sign Out"
        variant="danger"
      />
    </div>
  );
}
