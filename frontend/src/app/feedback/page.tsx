"use client";

import { ConfirmationModal } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { STUDENT_QUERY_TIMINGS } from "@/lib/query/config";
import { studentQueryKeys } from "@/lib/query/keys";
import { ExamResult, ExamSectionType, Question } from "@/types";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type FeedbackSectionType = Extract<ExamSectionType, "LISTENING" | "READING" | "WRITING">;

interface IncorrectFeedbackItem {
  key: string;
  questionNumber: number;
  questionText: string;
  studentAnswer: string;
  correctAnswer: string;
  reason: string;
}

interface WritingFeedbackSummary {
  overall: string | null;
  strengths: string[];
  improvements: string[];
  taskBreakdown: Array<{
    task: string;
    overall: string | null;
    improvements: string[];
  }>;
}

const SECTION_ORDER: FeedbackSectionType[] = ["LISTENING", "READING", "WRITING"];
const PROFILE_ENABLED = false;

const SECTION_LABELS: Record<FeedbackSectionType, string> = {
  LISTENING: "Listening",
  READING: "Reading",
  WRITING: "Writing",
};

const EMPTY_RESULTS_BY_TYPE: Record<FeedbackSectionType, ExamResult | null> = {
  LISTENING: null,
  READING: null,
  WRITING: null,
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const hasAnswer = (value: unknown): boolean => {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (isObjectRecord(value)) {
    return Object.keys(value).length > 0;
  }

  return true;
};

const normalizeText = (value: unknown) => String(value).toLowerCase().trim();

const formatAnswerValue = (value: unknown, questionType: Question["type"]): string => {
  if (!hasAnswer(value)) {
    return "-";
  }

  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).toUpperCase()).join(", ");
  }

  if (isObjectRecord(value)) {
    return Object.entries(value)
      .map(([key, entry]) => `${key}: ${String(entry).toUpperCase()}`)
      .join(", ");
  }

  if (
    questionType === "MCQ_SINGLE" ||
    questionType === "TRUE_FALSE_NOT_GIVEN" ||
    questionType === "YES_NO_NOT_GIVEN"
  ) {
    return String(value).toUpperCase();
  }

  return String(value);
};

const resolveCorrectAnswer = (question: Question): unknown => {
  const correctAnswer = question.correctAnswer;

  if (
    (question.type === "MATCHING" ||
      question.type === "PLAN_MAP_LABELING" ||
      question.type === "DIAGRAM_LABELING") &&
    isObjectRecord(correctAnswer) &&
    question.id in correctAnswer
  ) {
    return correctAnswer[question.id];
  }

  return correctAnswer;
};

const isAnswerCorrect = (
  studentAnswer: unknown,
  correctAnswer: unknown,
  questionType: Question["type"],
): boolean => {
  if (!hasAnswer(studentAnswer) || !hasAnswer(correctAnswer)) {
    return false;
  }

  if (questionType === "MCQ_MULTIPLE") {
    const studentOptions = Array.isArray(studentAnswer)
      ? studentAnswer
      : [studentAnswer];
    const correctOptions = Array.isArray(correctAnswer)
      ? correctAnswer
      : [correctAnswer];

    const normalizedStudent = new Set(studentOptions.map((entry) => normalizeText(entry)));
    const normalizedCorrect = new Set(correctOptions.map((entry) => normalizeText(entry)));

    if (normalizedStudent.size !== normalizedCorrect.size) {
      return false;
    }

    for (const option of normalizedStudent) {
      if (!normalizedCorrect.has(option)) {
        return false;
      }
    }

    return true;
  }

  if (
    questionType === "MATCHING" ||
    questionType === "PLAN_MAP_LABELING" ||
    questionType === "DIAGRAM_LABELING"
  ) {
    if (isObjectRecord(studentAnswer) && isObjectRecord(correctAnswer)) {
      const correctEntries = Object.entries(correctAnswer);

      if (correctEntries.length === 0) {
        return false;
      }

      return correctEntries.every(([key, expected]) => {
        const actual = studentAnswer[key];
        return normalizeText(actual) === normalizeText(expected);
      });
    }

    return normalizeText(studentAnswer) === normalizeText(correctAnswer);
  }

  return normalizeText(studentAnswer) === normalizeText(correctAnswer);
};

const getIncorrectReason = (
  questionType: Question["type"],
  studentAnswer: unknown,
): string => {
  if (!hasAnswer(studentAnswer)) {
    return "No answer was submitted for this question.";
  }

  if (questionType === "MCQ_MULTIPLE") {
    return "One or more selected options are missing or incorrect.";
  }

  if (
    questionType === "MATCHING" ||
    questionType === "PLAN_MAP_LABELING" ||
    questionType === "DIAGRAM_LABELING"
  ) {
    return "At least one of your matches does not align with the correct pair.";
  }

  if (
    questionType === "FILL_BLANK" ||
    questionType === "SHORT_ANSWER" ||
    questionType === "SENTENCE_COMPLETION" ||
    questionType === "SUMMARY_COMPLETION" ||
    questionType === "NOTE_COMPLETION" ||
    questionType === "TABLE_COMPLETION" ||
    questionType === "FLOW_CHART_COMPLETION" ||
    questionType === "FORM_COMPLETION"
  ) {
    return "Your response does not match the expected word or phrase.";
  }

  return "Your selected answer is different from the expected answer.";
};

const getIncorrectFeedbackItems = (result: ExamResult): IncorrectFeedbackItem[] => {
  const questions = result.section?.questions || [];
  const answers = result.answers || {};

  return questions.reduce<IncorrectFeedbackItem[]>((items, question, index) => {
    const studentAnswer = answers[question.id];
    const correctAnswer = resolveCorrectAnswer(question);
    const questionType = question.type;
    const isCorrect = isAnswerCorrect(studentAnswer, correctAnswer, questionType);

    if (isCorrect) {
      return items;
    }

    items.push({
      key: `${question.id}-${index}`,
      questionNumber: index + 1,
      questionText: question.questionText,
      studentAnswer: formatAnswerValue(studentAnswer, questionType),
      correctAnswer: formatAnswerValue(correctAnswer, questionType),
      reason: getIncorrectReason(questionType, studentAnswer),
    });

    return items;
  }, []);
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
};

const parseWritingFeedback = (feedback: unknown): WritingFeedbackSummary | null => {
  if (!isObjectRecord(feedback)) {
    return null;
  }

  const overall =
    typeof feedback.overallFeedback === "string" ? feedback.overallFeedback : null;
  const strengths = toStringArray(feedback.strengths);
  const improvements = toStringArray(feedback.areasForImprovement);

  const taskBreakdown: WritingFeedbackSummary["taskBreakdown"] = [];
  if (isObjectRecord(feedback.tasks)) {
    for (const [taskName, taskValue] of Object.entries(feedback.tasks)) {
      if (!isObjectRecord(taskValue)) {
        continue;
      }

      const taskOverall =
        typeof taskValue.overallFeedback === "string"
          ? taskValue.overallFeedback
          : null;
      const taskImprovements = toStringArray(taskValue.areasForImprovement);

      if (taskOverall || taskImprovements.length > 0) {
        taskBreakdown.push({
          task: taskName,
          overall: taskOverall,
          improvements: taskImprovements,
        });
      }
    }
  }

  if (
    !overall &&
    strengths.length === 0 &&
    improvements.length === 0 &&
    taskBreakdown.length === 0
  ) {
    return null;
  }

  return {
    overall,
    strengths,
    improvements,
    taskBreakdown,
  };
};

export default function FeedbackPage() {
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [expandedSection, setExpandedSection] = useState<FeedbackSectionType | null>("LISTENING");
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
    enabled: !!user?.id,
    staleTime: STUDENT_QUERY_TIMINGS.profile.staleTime,
    gcTime: STUDENT_QUERY_TIMINGS.profile.gcTime,
    placeholderData: (previousData) => previousData,
  });

  const feedbackQuery = useQuery({
    queryKey: studentQueryKeys.feedbackLatest(),
    queryFn: async ({ signal }) => {
      const results = await api.getMyResults({ signal });

      const latestByType: Record<FeedbackSectionType, ExamResult | null> = {
        LISTENING: null,
        READING: null,
        WRITING: null,
      };

      for (const result of results) {
        const type = result.section?.type;
        if (!type || !SECTION_ORDER.includes(type as FeedbackSectionType)) {
          continue;
        }

        const sectionType = type as FeedbackSectionType;
        if (!latestByType[sectionType]) {
          latestByType[sectionType] = result;
        }
      }

      const detailEntries = await Promise.all(
        SECTION_ORDER.map(async (sectionType) => {
          const summaryResult = latestByType[sectionType];
          if (!summaryResult) {
            return [sectionType, null] as const;
          }

          try {
            const detailed = await api.getResult(summaryResult.id, { signal });
            return [sectionType, detailed] as const;
          } catch {
            return [sectionType, summaryResult] as const;
          }
        }),
      );

      return detailEntries.reduce<Record<FeedbackSectionType, ExamResult | null>>(
        (accumulator, [sectionType, result]) => {
          accumulator[sectionType] = result;
          return accumulator;
        },
        {
          LISTENING: null,
          READING: null,
          WRITING: null,
        },
      );
    },
    enabled: !!user?.id,
    staleTime: STUDENT_QUERY_TIMINGS.feedback.staleTime,
    gcTime: STUDENT_QUERY_TIMINGS.feedback.gcTime,
    placeholderData: (previousData) => previousData,
  });

  const centerLogo = centerQuery.data?.logo || null;
  const profilePoints = profileQuery.data?.points ?? user?.points ?? 0;
  const resultsByType = feedbackQuery.data ?? EMPTY_RESULTS_BY_TYPE;
  const loadingFeedback = feedbackQuery.isLoading && !feedbackQuery.data;

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  const feedbackMetaByType = useMemo(() => {
    return {
      LISTENING: resultsByType.LISTENING
        ? getIncorrectFeedbackItems(resultsByType.LISTENING)
        : [],
      READING: resultsByType.READING ? getIncorrectFeedbackItems(resultsByType.READING) : [],
    };
  }, [resultsByType]);

  const toggleSection = (sectionType: FeedbackSectionType) => {
    setExpandedSection((current) =>
      current === sectionType ? null : sectionType,
    );
  };

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
                  className="inline-flex rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                >
                  Dashboard
                </Link>
              </li>
              <li>
                <Link
                  href="/feedback"
                  className="inline-flex rounded-lg bg-black px-3 py-2 text-sm font-medium text-white"
                >
                  Feedback
                </Link>
              </li>
              <li>
                {PROFILE_ENABLED ? (
                  <Link
                    href="/profile"
                    className="inline-flex rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                  >
                    Profile ({profilePoints ?? user?.points ?? 0} pts)
                  </Link>
                ) : (
                  <span
                    aria-disabled="true"
                    className="inline-flex cursor-not-allowed rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-400"
                  >
                    Profile ({profilePoints ?? user?.points ?? 0} pts)
                  </span>
                )}
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
          <h2 className="text-2xl font-bold text-gray-900">Feedback</h2>
          <p className="text-gray-500 mt-1">
            Review your latest Listening, Reading, and Writing performance.
          </p>
        </div>

        {loadingFeedback ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-black"></div>
          </div>
        ) : (
          <div className="space-y-6">
            {SECTION_ORDER.map((sectionType) => {
              const result = resultsByType[sectionType];
              const isExpanded = expandedSection === sectionType;

              if (!result) {
                return (
                  <section
                    key={sectionType}
                    className="rounded-3xl border border-gray-200 bg-white p-6"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSection(sectionType)}
                      className="w-full text-left"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <h3 className="text-xl font-bold text-gray-900">
                          {SECTION_LABELS[sectionType]}
                        </h3>
                        <div className="flex items-center gap-3">
                          <span className="inline-flex rounded-lg bg-gray-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Not Attempted
                          </span>
                          <svg
                            className={`h-5 w-5 text-gray-400 transition-transform ${
                              isExpanded ? "rotate-180" : ""
                            }`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 9l-7 7-7-7"
                            />
                          </svg>
                        </div>
                      </div>
                    </button>
                    {isExpanded && (
                      <p className="mt-3 text-sm text-gray-500">
                        Complete this section to receive feedback.
                      </p>
                    )}
                  </section>
                );
              }

              if (sectionType === "WRITING") {
                const writingFeedback = parseWritingFeedback(result.feedback);

                return (
                  <section
                    key={sectionType}
                    className="rounded-3xl border border-gray-200 bg-white p-6"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSection(sectionType)}
                      className="w-full text-left"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-xl font-bold text-gray-900">Writing</h3>
                          <p className="text-sm text-gray-500 mt-1">
                            Submitted on {new Date(result.submittedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="inline-flex rounded-lg bg-gray-900 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                            {typeof result.bandScore === "number"
                              ? `Band ${result.bandScore.toFixed(1)}`
                              : "Pending"}
                          </span>
                          <svg
                            className={`h-5 w-5 text-gray-400 transition-transform ${
                              isExpanded ? "rotate-180" : ""
                            }`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 9l-7 7-7-7"
                            />
                          </svg>
                        </div>
                      </div>
                    </button>

                    {isExpanded && (
                      <>
                        {writingFeedback ? (
                          <div className="mt-5 space-y-4">
                            {writingFeedback.overall && (
                              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700">
                                {writingFeedback.overall}
                              </div>
                            )}

                            {writingFeedback.taskBreakdown.length > 0 && (
                              <div className="space-y-3">
                                {writingFeedback.taskBreakdown.map((task) => (
                                  <div
                                    key={task.task}
                                    className="rounded-xl border border-gray-100 p-4"
                                  >
                                    <p className="text-sm font-semibold text-gray-900">{task.task}</p>
                                    {task.overall && (
                                      <p className="mt-2 text-sm text-gray-600">{task.overall}</p>
                                    )}
                                    {task.improvements.length > 0 && (
                                      <div className="mt-3 space-y-1">
                                        {task.improvements.map((point, index) => (
                                          <p
                                            key={`${task.task}-${index}`}
                                            className="text-sm text-amber-700"
                                          >
                                            - {point}
                                          </p>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            {writingFeedback.improvements.length > 0 && (
                              <div className="rounded-xl border border-amber-100 bg-amber-50/70 p-4">
                                <p className="text-sm font-semibold text-amber-800">
                                  Areas for improvement
                                </p>
                                <div className="mt-2 space-y-1">
                                  {writingFeedback.improvements.map((point, index) => (
                                    <p key={index} className="text-sm text-amber-700">
                                      - {point}
                                    </p>
                                  ))}
                                </div>
                              </div>
                            )}

                            {writingFeedback.strengths.length > 0 && (
                              <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4">
                                <p className="text-sm font-semibold text-emerald-800">Strengths</p>
                                <div className="mt-2 space-y-1">
                                  {writingFeedback.strengths.map((point, index) => (
                                    <p key={index} className="text-sm text-emerald-700">
                                      - {point}
                                    </p>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="mt-4 text-sm text-gray-500">
                            Writing feedback is being prepared. Please check back shortly.
                          </p>
                        )}
                      </>
                    )}
                  </section>
                );
              }

              const incorrectItems = feedbackMetaByType[sectionType];
              const totalQuestions = result.section?.questions?.length || 0;
              const correctCount = Math.max(totalQuestions - incorrectItems.length, 0);

              return (
                <section
                  key={sectionType}
                  className="rounded-3xl border border-gray-200 bg-white p-6"
                >
                  <button
                    type="button"
                    onClick={() => toggleSection(sectionType)}
                    className="w-full text-left"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-xl font-bold text-gray-900">
                          {SECTION_LABELS[sectionType]}
                        </h3>
                        <p className="text-sm text-gray-500 mt-1">
                          Submitted on {new Date(result.submittedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex rounded-lg bg-gray-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-700">
                          {correctCount}/{totalQuestions} correct
                        </span>
                        <span className="inline-flex rounded-lg bg-gray-900 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                          {typeof result.bandScore === "number"
                            ? `Band ${result.bandScore.toFixed(1)}`
                            : `Score ${result.score}`}
                        </span>
                        <svg
                          className={`h-5 w-5 text-gray-400 transition-transform ${
                            isExpanded ? "rotate-180" : ""
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 9l-7 7-7-7"
                          />
                        </svg>
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <>
                      {incorrectItems.length === 0 ? (
                        <p className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-700">
                          Great work. No incorrect responses found in your latest {" "}
                          {SECTION_LABELS[sectionType].toLowerCase()} attempt.
                        </p>
                      ) : (
                        <div className="mt-5 space-y-3">
                          {incorrectItems.map((item) => (
                            <article
                              key={item.key}
                              className="rounded-xl border border-red-100 bg-red-50/40 p-4"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <p className="text-sm font-semibold text-gray-900">
                                  Q{item.questionNumber}. {item.questionText}
                                </p>
                                <span className="inline-flex rounded-lg bg-red-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-red-700">
                                  Incorrect
                                </span>
                              </div>

                              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Your answer
                                  </p>
                                  <p className="mt-1 text-sm font-medium text-red-700">
                                    {item.studentAnswer}
                                  </p>
                                </div>

                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Correct answer
                                  </p>
                                  <p className="mt-1 text-sm font-medium text-gray-800">
                                    {item.correctAnswer}
                                  </p>
                                </div>
                              </div>

                              <p className="mt-3 text-sm text-red-700">Why: {item.reason}</p>
                            </article>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </section>
              );
            })}
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
