"use client";

import { ConfirmationModal, Modal } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { STUDENT_QUERY_TIMINGS } from "@/lib/query/config";
import { studentQueryKeys } from "@/lib/query/keys";
import {
  transformAssignments,
  getDisplayAssignmentTier,
  type DisplayAssignment,
} from "@/lib/examParts";
import { AssignmentStatus, ExamAssignment, ExamSectionType } from "@/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type MouseEvent,
} from "react";

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

type DashboardSection =
  | "OFFLINE_EXAM"
  | "READING"
  | "LISTENING"
  | "WRITING"
  | "SPEAKING";
type TierFilter = "ALL" | "FREE" | "PREMIUM";
type AccessTier = "FREE" | "PREMIUM";

interface PremiumFlags {
  isPremium?: boolean;
  premiumActive?: boolean;
}

const FREE_TEST_LIMITS: Record<ExamSectionType, number> = {
  LISTENING: 3,
  READING: 3,
  WRITING: 3,
};
const FREE_FULL_MOCK_LIMIT = 2;
const PAYMENT_CARD_NUMBER =
  process.env.NEXT_PUBLIC_PREMIUM_CARD_NUMBER || "8600 0000 0000 0000";
const PAYMENT_TELEGRAM =
  process.env.NEXT_PUBLIC_PREMIUM_TELEGRAM || "@ielts_founders";

const SECTION_OPTIONS: Array<{ key: DashboardSection; label: string; comingSoon?: boolean }> = [
  { key: "OFFLINE_EXAM", label: "Offline Exam" },
  { key: "READING", label: "Reading" },
  { key: "LISTENING", label: "Listening" },
  { key: "WRITING", label: "Writing" },
  { key: "SPEAKING", label: "Speaking", comingSoon: true },
];

const PLAN_OPTIONS: Array<{ key: TierFilter; label: string }> = [
  { key: "ALL", label: "All Tests" },
  { key: "FREE", label: "Free" },
  { key: "PREMIUM", label: "Premium" },
];

const toTimestamp = (value: string) => new Date(value).getTime();

const buildFreeAccess = (assignments: ExamAssignment[]) => {
  const freeIds = new Set<string>();
  const sortedByCreatedAt = [...assignments].sort(
    (a, b) => toTimestamp(a.createdAt) - toTimestamp(b.createdAt),
  );

  const sectionUsage: Record<ExamSectionType, number> = {
    LISTENING: 0,
    READING: 0,
    WRITING: 0,
  };

  const fullMockGroups = new Map<string, ExamAssignment[]>();
  sortedByCreatedAt.forEach((assignment) => {
    if (!assignment.fullMockSessionId) {
      return;
    }

    const existing = fullMockGroups.get(assignment.fullMockSessionId) || [];
    existing.push(assignment);
    fullMockGroups.set(assignment.fullMockSessionId, existing);
  });

  const orderedFullMocks = [...fullMockGroups.entries()].sort(([, left], [, right]) => {
    const leftTime = Math.min(...left.map((assignment) => toTimestamp(assignment.createdAt)));
    const rightTime = Math.min(...right.map((assignment) => toTimestamp(assignment.createdAt)));
    return leftTime - rightTime;
  });

  orderedFullMocks.slice(0, FREE_FULL_MOCK_LIMIT).forEach(([, group]) => {
    group.forEach((assignment) => freeIds.add(assignment.id));
  });

  sortedByCreatedAt.forEach((assignment) => {
    const sectionType = assignment.section?.type;
    if (!sectionType) {
      return;
    }

    if (sectionUsage[sectionType] < FREE_TEST_LIMITS[sectionType]) {
      sectionUsage[sectionType] += 1;
      freeIds.add(assignment.id);
    }
  });

  return {
    freeIds,
    sectionUsage,
    freeFullMockCount: Math.min(orderedFullMocks.length, FREE_FULL_MOCK_LIMIT),
  };
};

export default function DashboardPage() {
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  const queryClient = useQueryClient();
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [selectedSection, setSelectedSection] = useState<DashboardSection>("OFFLINE_EXAM");
  const [selectedPlan, setSelectedPlan] = useState<TierFilter>("ALL");
  const [isSectionPending, startSectionTransition] = useTransition();
  const [isPlanPending, startPlanTransition] = useTransition();
  const [isPremiumModalOpen, setIsPremiumModalOpen] = useState(false);
  const [selectedPremiumAssignment, setSelectedPremiumAssignment] =
    useState<ExamAssignment | null>(null);
  const router = useRouter();

  const assignmentsQuery = useQuery({
    queryKey: studentQueryKeys.myAssignments(),
    queryFn: ({ signal }) => api.getMyAssignments({ signal }),
    enabled: !!user?.id,
    staleTime: STUDENT_QUERY_TIMINGS.assignments.staleTime,
    gcTime: STUDENT_QUERY_TIMINGS.assignments.gcTime,
    placeholderData: (previousData) => previousData,
  });

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
    enabled: !!user?.id,
    staleTime: STUDENT_QUERY_TIMINGS.profile.staleTime,
    gcTime: STUDENT_QUERY_TIMINGS.profile.gcTime,
    placeholderData: (previousData) => previousData,
  });

  const assignments = useMemo(
    () => assignmentsQuery.data ?? [],
    [assignmentsQuery.data],
  );
  const loadingAssignments = assignmentsQuery.isLoading && !assignmentsQuery.data;
  const centerLogo = centerQuery.data?.logo || null;
  const premiumProfile = profileQuery.data as (typeof profileQuery.data & PremiumFlags) | undefined;
  const isPremiumUser = Boolean(
    premiumProfile?.premiumActive ?? premiumProfile?.isPremium ?? false,
  );

  const freeAccess = useMemo(() => buildFreeAccess(assignments), [assignments]);
  const assignmentTierById = useMemo(() => {
    const tierMap = new Map<string, AccessTier>();
    assignments.forEach((assignment) => {
      tierMap.set(assignment.id, freeAccess.freeIds.has(assignment.id) ? "FREE" : "PREMIUM");
    });
    return tierMap;
  }, [assignments, freeAccess.freeIds]);

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

  const handlePremiumLockedClick = useCallback((assignment: ExamAssignment) => {
    setSelectedPremiumAssignment(assignment);
    setIsPremiumModalOpen(true);
  }, []);

  const activeAssignments = useMemo(() => {
    const offlineFlowAssignments = assignments.filter((assignment) =>
      Boolean(assignment.fullMockSessionId),
    );

    if (offlineFlowAssignments.length === 0) {
      return [];
    }

    const groups = new Map<string, ExamAssignment[]>();

    offlineFlowAssignments.forEach((assignment) => {
      if (!assignment.fullMockSessionId) return;
      const existing = groups.get(assignment.fullMockSessionId) || [];
      existing.push(assignment);
      groups.set(assignment.fullMockSessionId, existing);
    });

    if (groups.size === 0) {
      return offlineFlowAssignments;
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

    return selected ?? offlineFlowAssignments;
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

  // Transform assignments into display items (complete + parts) for each section type
  const readingDisplayAssignments = useMemo(() => {
    const readingAssignments = assignments.filter((a) => a.section?.type === "READING");
    return transformAssignments(readingAssignments, "READING");
  }, [assignments]);

  const listeningDisplayAssignments = useMemo(() => {
    const listeningAssignments = assignments.filter((a) => a.section?.type === "LISTENING");
    return transformAssignments(listeningAssignments, "LISTENING");
  }, [assignments]);

  const writingDisplayAssignments = useMemo(() => {
    const writingAssignments = assignments.filter((a) => a.section?.type === "WRITING");
    return transformAssignments(writingAssignments, "WRITING");
  }, [assignments]);

  // Get tier for a display assignment
  const getDisplayItemTier = useCallback((displayItem: DisplayAssignment): "FREE" | "PREMIUM" => {
    const sectionType = displayItem.displaySection.type;
    let allDisplayAssignments: DisplayAssignment[] = [];
    
    switch (sectionType) {
      case "READING":
        allDisplayAssignments = readingDisplayAssignments;
        break;
      case "LISTENING":
        allDisplayAssignments = listeningDisplayAssignments;
        break;
      case "WRITING":
        allDisplayAssignments = writingDisplayAssignments;
        break;
    }
    
    return getDisplayAssignmentTier(displayItem, allDisplayAssignments);
  }, [readingDisplayAssignments, listeningDisplayAssignments, writingDisplayAssignments]);

  // Get current section's display assignments based on selected section
  const currentSectionDisplayAssignments = useMemo(() => {
    switch (selectedSection) {
      case "READING":
        return readingDisplayAssignments;
      case "LISTENING":
        return listeningDisplayAssignments;
      case "WRITING":
        return writingDisplayAssignments;
      default:
        return [];
    }
  }, [selectedSection, readingDisplayAssignments, listeningDisplayAssignments, writingDisplayAssignments]);

  // Filter display assignments by plan
  const filteredDisplayAssignmentsByPlan = useMemo<Record<TierFilter, DisplayAssignment[]>>(() => {
    const all = currentSectionDisplayAssignments;
    
    if (selectedPlan === "ALL") {
      return { ALL: all, FREE: all, PREMIUM: all };
    }
    
    const free: DisplayAssignment[] = [];
    const premium: DisplayAssignment[] = [];

    for (const item of all) {
      const tier = getDisplayItemTier(item);
      if (tier === "FREE") {
        free.push(item);
      } else {
        premium.push(item);
      }
    }

    return {
      ALL: all,
      FREE: free,
      PREMIUM: premium,
    };
  }, [currentSectionDisplayAssignments, selectedPlan, getDisplayItemTier]);

  const filteredDisplayAssignments = filteredDisplayAssignmentsByPlan[selectedPlan];

  // Handle non-sectioned assignments (Offline Exam and legacy sections)
  const sectionAssignmentsBySection = useMemo<Record<DashboardSection, ExamAssignment[]>>(() => {
    const offlineExam: ExamAssignment[] = [];

    for (const assignment of sortedAssignments) {
      if (assignment.fullMockSessionId) {
        offlineExam.push(assignment);
      }
    }

    return {
      OFFLINE_EXAM: offlineExam,
      READING: [],
      LISTENING: [],
      WRITING: [],
      SPEAKING: [],
    };
  }, [sortedAssignments]);

  const sectionAssignments = sectionAssignmentsBySection[selectedSection];

  // Filter assignments by plan for non-Reading sections (legacy logic for Listening/Writing without parts)
  const filteredAssignmentsByPlan = useMemo<Record<TierFilter, ExamAssignment[]>>(() => {
    const free: ExamAssignment[] = [];
    const premium: ExamAssignment[] = [];

    for (const assignment of sectionAssignments) {
      if (assignmentTierById.get(assignment.id) === "PREMIUM") {
        premium.push(assignment);
      } else {
        free.push(assignment);
      }
    }

    return {
      ALL: sectionAssignments,
      FREE: free,
      PREMIUM: premium,
    };
  }, [assignmentTierById, sectionAssignments]);

  const filteredAssignments = filteredAssignmentsByPlan[selectedPlan];

  const displayedAssignments = useMemo(() => {
    if (selectedSection === "OFFLINE_EXAM") {
      return sectionAssignments;
    }

    return filteredAssignments;
  }, [filteredAssignments, sectionAssignments, selectedSection]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    router.prefetch("/feedback");
  }, [router]);

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    void queryClient.prefetchQuery({
      queryKey: studentQueryKeys.myResults(),
      queryFn: ({ signal }) => api.getMyResults({ signal }),
      staleTime: STUDENT_QUERY_TIMINGS.results.staleTime,
      gcTime: STUDENT_QUERY_TIMINGS.results.gcTime,
    });
  }, [queryClient, user?.id]);

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
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-4">
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
      <main className="max-w-7xl mx-auto w-full px-4 py-8">
        <div className="grid gap-6 md:grid-cols-12">
          <aside className="space-y-4 md:col-span-3 lg:col-span-2 md:sticky md:top-24 md:self-start">
            <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between px-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Sections
                </p>
                {isSectionPending && (
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    Updating
                  </span>
                )}
              </div>
              <div className="mt-3 space-y-2">
                {SECTION_OPTIONS.map((section) => {
                  const isActive = selectedSection === section.key;
                  return (
                    <button
                      key={section.key}
                      type="button"
                      disabled={section.comingSoon || isSectionPending}
                      onClick={() =>
                        startSectionTransition(() => {
                          setSelectedSection(section.key);
                        })
                      }
                      className={`w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                        isActive
                          ? "bg-black text-white"
                          : section.comingSoon
                            ? "cursor-not-allowed bg-gray-100 text-gray-400"
                            : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span>{section.label}</span>
                        {section.comingSoon && (
                          <span className="text-[10px] uppercase tracking-wider">Soon</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

          </aside>

          <div className="md:col-span-9 lg:col-span-10">
            {selectedSection !== "OFFLINE_EXAM" && (
              <div className="mb-6 grid grid-cols-3 rounded-2xl border border-gray-200 bg-white p-1">
                {PLAN_OPTIONS.map((plan) => {
                  const activePlan = selectedPlan === plan.key;
                  return (
                    <button
                      key={plan.key}
                      type="button"
                      disabled={isPlanPending}
                      onClick={() =>
                        startPlanTransition(() => {
                          setSelectedPlan(plan.key);
                        })
                      }
                      className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                        activePlan
                          ? "bg-black text-white"
                          : "text-gray-600 hover:bg-gray-100"
                      }`}
                    >
                      {plan.label}
                    </button>
                  );
                })}
              </div>
            )}

            {loadingAssignments ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-black"></div>
          </div>
        ) : (
          <>
            {selectedSection === "OFFLINE_EXAM" && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
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
                  Average Score
                </p>
                <p className="mt-3 text-3xl font-bold text-gray-900">
                  {studentStats.averageScore === null
                    ? "-"
                    : studentStats.averageScore.toFixed(1)}
                </p>
              </div>
              </div>
            )}

            {(selectedSection === "READING" || selectedSection === "LISTENING" || selectedSection === "WRITING"
              ? filteredDisplayAssignments.length === 0
              : displayedAssignments.length === 0) ? (
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
                <p className="text-gray-400">
                  {selectedSection === "OFFLINE_EXAM"
                    ? "No tests found in Offline Exam"
                    : selectedSection === "READING"
                    ? "No reading tests available"
                    : selectedSection === "LISTENING"
                    ? "No listening tests available"
                    : selectedSection === "WRITING"
                    ? "No writing tests available"
                    : "No tests found for this filter"}
                </p>
                <p className="text-gray-500 text-sm mt-1">
                  {selectedSection === "OFFLINE_EXAM"
                    ? "Try another section."
                    : "Tests will appear here once assigned."}
                </p>
              </div>
            ) : (
              <>
                {selectedSection === "OFFLINE_EXAM" && (
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
                          const nextTier =
                            assignmentTierById.get(nextAssignment.id) || "FREE";
                          const requiresPremium =
                            nextTier === "PREMIUM" && !isPremiumUser;

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
                              {requiresPremium ? (
                                <button
                                  type="button"
                                  onClick={() => handlePremiumLockedClick(nextAssignment)}
                                  className="px-10 py-4 rounded-full bg-amber-500 text-white font-bold text-lg hover:bg-amber-600 transition-all shadow-xl shadow-amber-500/20"
                                >
                                  Unlock Premium
                                </button>
                              ) : (
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
                              )}
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
                )}

                {(selectedSection === "READING" || selectedSection === "LISTENING" || selectedSection === "WRITING") && (
                  <div className="max-w-6xl mx-auto mt-8 mb-16 px-4">
                    <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
                      <div className="flex items-center justify-between gap-4">
                        <h3 className="text-xl font-bold text-gray-900">
                          {selectedSection === "READING" && "Reading Tests"}
                          {selectedSection === "LISTENING" && "Listening Tests"}
                          {selectedSection === "WRITING" && "Writing Tests"}
                        </h3>
                        <p className="text-sm text-gray-500">
                          {filteredDisplayAssignments.length} total
                        </p>
                      </div>

                      <div className="mt-6 space-y-4">
                        {filteredDisplayAssignments.map((item) => {
                          const hasScore =
                            item.status === "SUBMITTED" && typeof item.score === "number";
                          const itemTier = getDisplayItemTier(item);
                          const requiresPremium = itemTier === "PREMIUM" && !isPremiumUser;

                          return (
                            <div
                              key={item.id}
                              className="rounded-2xl border border-gray-100 p-4"
                            >
                              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                                      {selectedSection}
                                    </p>
                                    <span
                                      className={`inline-flex rounded-lg px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                                        itemTier === "FREE"
                                          ? "bg-emerald-100 text-emerald-700"
                                          : "bg-amber-100 text-amber-700"
                                      }`}
                                    >
                                      {itemTier}
                                    </span>
                                    {item.isPart && (
                                      <span className="inline-flex rounded-lg bg-blue-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                                        {selectedSection === "LISTENING" ? "Section" : "Part"} {item.partInfo?.part}
                                      </span>
                                    )}
                                    {item.isTask && (
                                      <span className="inline-flex rounded-lg bg-purple-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-purple-700">
                                        Task {item.taskInfo?.task}
                                      </span>
                                    )}
                                  </div>
                                  <h4 className="mt-1 text-lg font-semibold text-gray-900">
                                    {item.displaySection.title}
                                  </h4>
                                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                                    <span>
                                      {item.isPart
                                        ? `${item.partInfo?.duration} mins · ${item.partInfo?.questionCount} questions`
                                        : item.isTask
                                        ? `${item.taskInfo?.duration} mins · 1 task`
                                        : `${item.displaySection.duration} mins · Full Test`}
                                    </span>
                                    <span>{formatAssignmentDate(item.createdAt)}</span>
                                  </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-3">
                                  {hasScore && (
                                    <span className="inline-flex rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">
                                      Score: {Number(item.score).toFixed(1)}
                                    </span>
                                  )}

                                  {item.status === "SUBMITTED" ? (
                                    <span className="inline-flex rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500">
                                      Submitted
                                    </span>
                                  ) : requiresPremium ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const originalAssignment = assignments.find(
                                          (a) => a.id === item.originalAssignmentId
                                        );
                                        if (originalAssignment) {
                                          handlePremiumLockedClick(originalAssignment);
                                        }
                                      }}
                                      className="inline-flex rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-600"
                                    >
                                      Unlock Premium
                                    </button>
                                  ) : (
                                    <Link
                                      href={`/exam/${item.id}`}
                                      onClick={(event) =>
                                        handleStartExamClick(event, item.id)
                                      }
                                      className="inline-flex rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
                                    >
                                      {item.status === "IN_PROGRESS" ? "Continue" : "Start"}
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
                )}

                {selectedSection !== "OFFLINE_EXAM" && selectedSection !== "READING" && (
                  <div className="max-w-6xl mx-auto mt-8 mb-16 px-4">
                    <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
                      <div className="flex items-center justify-between gap-4">
                        <h3 className="text-xl font-bold text-gray-900">Your Tests</h3>
                        <p className="text-sm text-gray-500">
                          {displayedAssignments.length} total
                        </p>
                      </div>

                      <div className="mt-6 space-y-4">
                        {displayedAssignments.map((assignment) => {
                          const hasScore =
                            assignment.status === "SUBMITTED" &&
                            typeof assignment.score === "number";
                          const assignmentTier =
                            assignmentTierById.get(assignment.id) || "FREE";
                          const requiresPremium =
                            assignmentTier === "PREMIUM" && !isPremiumUser;

                          return (
                            <div
                              key={assignment.id}
                              className="rounded-2xl border border-gray-100 p-4"
                            >
                              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                                      {assignment.section?.type || "TEST"}
                                    </p>
                                    <span
                                      className={`inline-flex rounded-lg px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                                        assignmentTier === "FREE"
                                          ? "bg-emerald-100 text-emerald-700"
                                          : "bg-amber-100 text-amber-700"
                                      }`}
                                    >
                                      {assignmentTier}
                                    </span>
                                    {assignment.fullMockSessionId && (
                                      <span className="inline-flex rounded-lg bg-gray-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                                        Full Mock
                                      </span>
                                    )}
                                  </div>
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
                                  ) : requiresPremium ? (
                                    <button
                                      type="button"
                                      onClick={() => handlePremiumLockedClick(assignment)}
                                      className="inline-flex rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-600"
                                    >
                                      Unlock Premium
                                    </button>
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
                )}
              </>
            )}
          </>
        )}
          </div>
        </div>
      </main>

      <Modal
        isOpen={isPremiumModalOpen}
        onClose={() => {
          setIsPremiumModalOpen(false);
          setSelectedPremiumAssignment(null);
        }}
        title="Premium Access"
      >
        <div className="space-y-4 text-sm text-gray-700">
          <p>
            {selectedPremiumAssignment?.section?.title
              ? `"${selectedPremiumAssignment.section.title}" is available for Premium users.`
              : "This test is available for Premium users."}
          </p>

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Card Number
            </p>
            <p className="mt-1 text-base font-semibold text-gray-900">{PAYMENT_CARD_NUMBER}</p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Activation
            </p>
            <p className="mt-1 leading-relaxed">
              After you transfer the payment, send the receipt screenshot + your email to our
              Telegram account <span className="font-semibold">{PAYMENT_TELEGRAM}</span> so we
              can activate Premium within a few minutes.
            </p>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                setIsPremiumModalOpen(false);
                setSelectedPremiumAssignment(null);
              }}
              className="inline-flex rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>

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
