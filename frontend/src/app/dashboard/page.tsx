"use client";

import { ConfirmationModal } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { AssignmentStatus, Center, ExamAssignment } from "@/types";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";

const getStatusPillClasses = (status: AssignmentStatus) => {
  if (status === "SUBMITTED") {
    return "inline-flex rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700";
  }

  if (status === "IN_PROGRESS") {
    return "inline-flex rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-amber-700";
  }

  return "inline-flex rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700";
};

const formatAssignmentDate = (timestamp: string) => {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

export default function DashboardPage() {
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  const [assignments, setAssignments] = useState<ExamAssignment[]>([]);
  const [loadingAssignments, setLoadingAssignments] = useState(true);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [centerLogo, setCenterLogo] = useState<string | null>(null);
  const [profilePoints, setProfilePoints] = useState<number | null>(null);
  const router = useRouter();

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

  const handleStartExamClick = useCallback(
    async (event: MouseEvent<HTMLAnchorElement>, assignmentId: string) => {
      event.preventDefault();
      await requestFullscreen();
      router.push(`/exam/${assignmentId}`);
    },
    [requestFullscreen, router]
  );

  const activeAssignments = useMemo(() => {
    const groups = new Map<string, ExamAssignment[]>();

    assignments.forEach((assignment) => {
      if (!assignment.fullMockSessionId) return;
      const existing = groups.get(assignment.fullMockSessionId) || [];
      existing.push(assignment);
      groups.set(assignment.fullMockSessionId, existing);
    });

    if (groups.size === 0) {
      return assignments;
    }

    let selected: ExamAssignment[] | null = null;
    let latestTimestamp = 0;

    groups.forEach((group) => {
      const hasPending = group.some((item) => item.status !== "SUBMITTED");
      if (!hasPending) return;
      const groupLatest = Math.max(
        ...group.map((item) => new Date(item.createdAt).getTime()),
      );
      if (groupLatest > latestTimestamp) {
        latestTimestamp = groupLatest;
        selected = group;
      }
    });

    return selected ?? assignments;
  }, [assignments]);

  const studentStats = useMemo(() => {
    const totalTests = assignments.length;
    const completedTests = assignments.filter(
      (assignment) => assignment.status === "SUBMITTED",
    ).length;
    const inProgressTests = assignments.filter(
      (assignment) => assignment.status === "IN_PROGRESS",
    ).length;
    const assignedTests = assignments.filter(
      (assignment) => assignment.status === "ASSIGNED",
    ).length;

    const scoredAssignments = assignments.filter(
      (assignment) => typeof assignment.score === "number",
    );
    const averageScore =
      scoredAssignments.length > 0
        ? scoredAssignments.reduce((sum, assignment) => sum + Number(assignment.score), 0) /
          scoredAssignments.length
        : null;

    return {
      totalTests,
      completedTests,
      inProgressTests,
      assignedTests,
      averageScore,
    };
  }, [assignments]);

  const sortedAssignments = useMemo(() => {
    return [...assignments].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [assignments]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (user?.id) {
      api
        .getMyAssignments()
        .then(setAssignments)
        .catch(console.error)
        .finally(() => setLoadingAssignments(false));
    }
  }, [user?.id]);

  // Load center logo for students
  useEffect(() => {
    if (user?.centerId) {
      api
        .getCenter(user.centerId)
        .then((center: Center) => {
          if (center.logo) {
            setCenterLogo(center.logo);
          }
        })
        .catch(console.error);
    }
  }, [user?.centerId]);

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    api
      .getProfile()
      .then((profile) => setProfilePoints(profile.points ?? 0))
      .catch(() => undefined);
  }, [user?.id]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-black"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-36 h-12 rounded-xl flex items-center justify-center">
              {centerLogo ? (
                <Image
                  src={centerLogo}
                  alt="Center Logo"
                  width={144}
                  height={48}
                  loading="eager"
                  className="max-h-12 h-auto w-auto object-contain"
                />
              ) : (
                <Image
                  src="/logo.png"
                  alt="logo"
                  width={144}
                  height={48}
                  loading="eager"
                  className="max-h-12 h-auto w-auto object-contain"
                />
              )}
            </div>
          </div>

          <nav className="order-3 w-full md:order-2 md:w-auto">
            <ul className="flex items-center justify-start gap-2 md:gap-4">
              <li>
                <Link
                  href="/dashboard"
                  className="inline-flex rounded-lg bg-black px-3 py-2 text-sm font-medium text-white"
                >
                  Dashboard
                </Link>
              </li>
              <li>
                <Link
                  href="/feedback"
                  className="inline-flex rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                >
                  Feedback
                </Link>
              </li>
              <li>
                <Link
                  href="/profile"
                  className="inline-flex rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                >
                  Profile ({profilePoints ?? user?.points ?? 0} pts)
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

      {/* Main Content */}
      <main className="max-w-6xl mx-auto w-full px-4 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">Your Exams</h2>
          <p className="text-gray-500 mt-1">
            View and take your assigned exam sections
          </p>
        </div>

        {loadingAssignments ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-black"></div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-2xl border border-gray-200 bg-white p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Total Tests
                </p>
                <p className="mt-3 text-3xl font-bold text-gray-900">
                  {studentStats.totalTests}
                </p>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Completed
                </p>
                <p className="mt-3 text-3xl font-bold text-gray-900">
                  {studentStats.completedTests}
                </p>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  In Progress
                </p>
                <p className="mt-3 text-3xl font-bold text-gray-900">
                  {studentStats.inProgressTests}
                </p>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Assigned
                </p>
                <p className="mt-3 text-3xl font-bold text-gray-900">
                  {studentStats.assignedTests}
                </p>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Average Score
                </p>
                <p className="mt-3 text-3xl font-bold text-gray-900">
                  {studentStats.averageScore === null
                    ? "-"
                    : studentStats.averageScore.toFixed(1)}
                </p>
              </div>
            </div>

            {assignments.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-800 flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-gray-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                </div>
                <p className="text-gray-400">No exams assigned yet</p>
                <p className="text-gray-500 text-sm mt-1">
                  Your teacher will assign exams to you
                </p>
              </div>
            ) : (
              <>
                <div className="max-w-6xl mx-auto mt-12 px-4">
                  <div className="bg-white rounded-4xl border border-gray-100 p-12 shadow-sm">
                    <div className="flex items-center justify-between relative px-4 mb-20">
                      {/* Background Connecting Line */}
                      <div className="absolute top-6 left-[10%] right-[10%] h-px bg-gray-200 z-0" />

                      {(() => {
                        const orderedTypes = ["LISTENING", "READING", "WRITING"];
                        const nextToComplete = orderedTypes.find((type) => {
                          const a = activeAssignments.find(
                            (assignment) => assignment.section?.type === type,
                          );
                          return a && a.status !== "SUBMITTED";
                        });

                        return orderedTypes.map((type, idx) => {
                          const assignment = activeAssignments.find(
                            (item) => item.section?.type === type,
                          );
                          const isCompleted = assignment?.status === "SUBMITTED";
                          const isActive = type === nextToComplete;
                          const stepNum = idx + 1;

                          return (
                            <div
                              key={type}
                              className="flex flex-col items-center relative z-10 bg-white px-4"
                            >
                              {/* Step Circle */}
                              <div
                                className={`
                                w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all duration-300
                                ${
                                  isCompleted
                                    ? "bg-black border-black text-white"
                                    : isActive
                                      ? "bg-white border-black text-black shadow-[0_0_0_4px_rgba(0,0,0,0.05)]"
                                      : "bg-white border-gray-200 text-gray-400"
                                }
                              `}
                              >
                                {isCompleted ? (
                                  <svg
                                    className="w-6 h-6"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={3}
                                      d="M5 13l4 4L19 7"
                                    />
                                  </svg>
                                ) : (
                                  <span className="text-lg font-bold">{stepNum}</span>
                                )}
                              </div>

                              {/* Step Label */}
                              <div className="absolute -bottom-10 whitespace-nowrap text-center">
                                <p
                                  className={`text-sm font-bold uppercase tracking-widest ${
                                    isCompleted || isActive
                                      ? "text-black"
                                      : "text-gray-400"
                                  }`}
                                >
                                  {type}
                                </p>
                                {assignment?.section?.duration && (
                                  <p className="text-[10px] text-gray-400 font-medium mt-0.5">
                                    {assignment.section.duration} MINS
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>

                    <div className="flex flex-col items-center gap-6 mt-16 pt-8 border-t border-gray-50">
                      {(() => {
                        const orderedTypes = ["LISTENING", "READING", "WRITING"];
                        const nextAssignment = orderedTypes
                          .map((type) =>
                            activeAssignments.find(
                              (assignment) => assignment.section?.type === type,
                            ),
                          )
                          .find((assignment) => assignment && assignment.status !== "SUBMITTED");

                        if (nextAssignment) {
                          return (
                            <>
                              <div className="text-center mb-2">
                                <h3 className="text-xl font-bold text-gray-900">
                                  Ready to start your{" "}
                                  {nextAssignment.section?.type.toLowerCase()}?
                                </h3>
                                <p className="text-gray-500 text-sm mt-1">
                                  Please ensure you are in a quiet environment.
                                </p>
                              </div>
                              <Link
                                href={`/exam/${nextAssignment.id}`}
                                onClick={(event) =>
                                  handleStartExamClick(event, nextAssignment.id)
                                }
                                className="px-20 py-5 rounded-full bg-black text-white font-bold text-lg hover:bg-gray-800 transition-all shadow-xl shadow-black/10 hover:scale-[1.02] active:scale-[0.98] group flex items-center gap-3"
                              >
                                {nextAssignment.status === "IN_PROGRESS"
                                  ? "Continue Exam"
                                  : "Start Exam"}
                                <svg
                                  className="w-5 h-5 group-hover:translate-x-1 transition-transform"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M17 8l4 4m0 0l-4 4m4-4H3"
                                  />
                                </svg>
                              </Link>
                            </>
                          );
                        }

                        return (
                          <div className="flex flex-col items-center text-center animate-in fade-in zoom-in duration-700">
                            <div className="w-20 h-20 rounded-full bg-black flex items-center justify-center mb-6">
                              <svg
                                className="w-10 h-10 text-white"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                            </div>
                            <h3 className="text-2xl font-bold text-gray-900">
                              Exam Fully Completed
                            </h3>
                            <p className="text-gray-500 mt-2">
                              All your sections have been successfully submitted.
                            </p>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                <div className="max-w-6xl mx-auto mt-8 mb-16 px-4">
                  <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
                    <div className="flex items-center justify-between gap-4">
                      <h3 className="text-xl font-bold text-gray-900">Your Tests</h3>
                      <p className="text-sm text-gray-500">
                        {sortedAssignments.length} total
                      </p>
                    </div>

                    <div className="mt-6 space-y-4">
                      {sortedAssignments.map((assignment) => {
                        const hasScore =
                          assignment.status === "SUBMITTED" &&
                          typeof assignment.score === "number";

                        return (
                          <div
                            key={assignment.id}
                            className="rounded-2xl border border-gray-100 p-4"
                          >
                            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                                  {assignment.section?.type || "TEST"}
                                </p>
                                <h4 className="mt-1 text-lg font-semibold text-gray-900">
                                  {assignment.section?.title || "Untitled Test"}
                                </h4>
                                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                                  <span>
                                    {assignment.section?.duration
                                      ? `${assignment.section.duration} mins`
                                      : "Duration not set"}
                                  </span>
                                  <span>{formatAssignmentDate(assignment.createdAt)}</span>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-3">
                                <span className={getStatusPillClasses(assignment.status)}>
                                  {assignment.status.replace(/_/g, " ")}
                                </span>

                                {hasScore && (
                                  <span className="inline-flex rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">
                                    Score: {Number(assignment.score).toFixed(1)}
                                  </span>
                                )}

                                {assignment.status === "SUBMITTED" ? (
                                  <span className="inline-flex rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500">
                                    Submitted
                                  </span>
                                ) : (
                                  <Link
                                    href={`/exam/${assignment.id}`}
                                    onClick={(event) =>
                                      handleStartExamClick(event, assignment.id)
                                    }
                                    className="inline-flex rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
                                  >
                                    {assignment.status === "IN_PROGRESS"
                                      ? "Continue"
                                      : "Start"}
                                  </Link>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
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
