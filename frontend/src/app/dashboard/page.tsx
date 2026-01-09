"use client";

import { ConfirmationModal } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { Center, ExamAssignment } from "@/types";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function DashboardPage() {
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  const [assignments, setAssignments] = useState<ExamAssignment[]>([]);
  const [loadingAssignments, setLoadingAssignments] = useState(true);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [centerLogo, setCenterLogo] = useState<string | null>(null);
  const router = useRouter();

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
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-36 h-12 rounded-xl flex items-center justify-center">
              {centerLogo ? (
                <Image
                  src={centerLogo}
                  alt="Center Logo"
                  width={144}
                  height={48}
                  loading="eager"
                  className="max-h-12 w-auto object-contain"
                />
              ) : (
                <Image
                  src="/logo.png"
                  alt="logo"
                  width={144}
                  height={48}
                  loading="eager"
                  style={{ width: "auto", height: "auto" }}
                />
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
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
        ) : assignments.length === 0 ? (
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
          <div className="max-w-6xl mx-auto mt-12 mb-16 px-4">
            <div className="bg-white rounded-4xl border border-gray-100 p-12 shadow-sm">
              <div className="flex items-center justify-between relative px-4 mb-20">
                {/* Background Connecting Line */}
                <div className="absolute top-6 left-[10%] right-[10%] h-px bg-gray-200 z-0" />

                {(() => {
                  const orderedTypes = ["LISTENING", "READING", "WRITING"];
                  const nextToComplete = orderedTypes.find((type) => {
                    const a = assignments.find((a) => a.section?.type === type);
                    return a && a.status !== "SUBMITTED";
                  });

                  return orderedTypes.map((type, idx) => {
                    const assignment = assignments.find(
                      (a) => a.section?.type === type
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
                      assignments.find((a) => a.section?.type === type)
                    )
                    .find((a) => a && a.status !== "SUBMITTED");

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
                  } else {
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
                  }
                })()}
              </div>
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
