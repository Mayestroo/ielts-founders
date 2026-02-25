"use client";

import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { getListeningPartQuestions } from "@/lib/listeningAudio";
import { STUDENT_QUERY_TIMINGS } from "@/lib/query/config";
import { studentQueryKeys } from "@/lib/query/keys";
import { ExamResult, ExamSectionType, Passage, Question } from "@/types";
import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

interface PracticeAnswerRow {
  questionId: string;
  questionNumber: number;
  studentAnswer: string;
  correctAnswer: string;
  hasCorrectAnswer: boolean;
  isCorrect: boolean | null;
}

interface AttemptHistoryItem {
  id: string;
  attempt: number;
  score: number | null;
  totalScore: number | null;
  bandScore: number | null;
  submittedAt: string;
}

const normalizeAnswerValue = (value: unknown): string =>
  String(value ?? "").trim().toLowerCase();

const hasAnswerValue = (value: unknown): boolean => {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }

  return true;
};

const formatAnswerValue = (value: unknown): string => {
  if (!hasAnswerValue(value)) {
    return "N/A";
  }

  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(", ");
  }

  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => `${key}: ${String(entry)}`)
      .join(", ");
  }

  return String(value);
};

const resolveQuestionCorrectAnswer = (question: Question): unknown => {
  if (!("correctAnswer" in question)) {
    return undefined;
  }

  const correctAnswer = (question as { correctAnswer?: unknown }).correctAnswer;

  if (
    (question.type === "MATCHING" ||
      question.type === "PLAN_MAP_LABELING" ||
      question.type === "DIAGRAM_LABELING") &&
    correctAnswer &&
    typeof correctAnswer === "object" &&
    !Array.isArray(correctAnswer)
  ) {
    return (correctAnswer as Record<string, unknown>)[question.id] ?? correctAnswer;
  }

  return correctAnswer;
};

const isAnswerCorrect = (studentAnswer: unknown, correctAnswer: unknown): boolean => {
  if (!hasAnswerValue(studentAnswer) || !hasAnswerValue(correctAnswer)) {
    return false;
  }

  if (Array.isArray(correctAnswer)) {
    const studentValues = Array.isArray(studentAnswer) ? studentAnswer : [studentAnswer];
    const studentSet = new Set(studentValues.map(normalizeAnswerValue));
    const correctSet = new Set(correctAnswer.map(normalizeAnswerValue));

    if (studentSet.size !== correctSet.size) {
      return false;
    }

    for (const value of studentSet) {
      if (!correctSet.has(value)) {
        return false;
      }
    }

    return true;
  }

  if (
    typeof studentAnswer === "object" &&
    studentAnswer !== null &&
    !Array.isArray(studentAnswer) &&
    typeof correctAnswer === "object" &&
    correctAnswer !== null &&
    !Array.isArray(correctAnswer)
  ) {
    return Object.entries(correctAnswer as Record<string, unknown>).every(
      ([key, expected]) =>
        normalizeAnswerValue((studentAnswer as Record<string, unknown>)[key]) ===
        normalizeAnswerValue(expected),
    );
  }

  return normalizeAnswerValue(studentAnswer) === normalizeAnswerValue(correctAnswer);
};

const resolveQuestionNumber = (question: Question, fallbackNumber: number): number => {
  if (typeof question.number === "number" && Number.isFinite(question.number)) {
    return question.number;
  }

  const idMatch = question.id.match(/\d+/);
  if (idMatch) {
    return Number(idMatch[0]);
  }

  return fallbackNumber;
};

const resolveIndependentStudentAnswers = (value: unknown): string[] => {
  if (!hasAnswerValue(value)) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry).trim())
      .filter((entry) => entry.length > 0);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return [String(value).trim()].filter((entry) => entry.length > 0);
};

const buildIndependentMcqRows = ({
  questionId,
  questionNumber,
  studentAnswerRaw,
  correctAnswerRaw,
}: {
  questionId: string;
  questionNumber: number;
  studentAnswerRaw: unknown;
  correctAnswerRaw: unknown[];
}): PracticeAnswerRow[] => {
  const studentAnswers = resolveIndependentStudentAnswers(studentAnswerRaw);
  const remainingCorrectAnswers = correctAnswerRaw
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0);

  const consumeMatchingCorrectAnswer = (studentEntry: string): boolean => {
    const normalizedStudentEntry = normalizeAnswerValue(studentEntry);
    const matchedIndex = remainingCorrectAnswers.findIndex(
      (correctEntry) =>
        normalizeAnswerValue(correctEntry) === normalizedStudentEntry,
    );

    if (matchedIndex < 0) {
      return false;
    }

    remainingCorrectAnswers.splice(matchedIndex, 1);
    return true;
  };

  return correctAnswerRaw.map((_, offset) => {
    const studentEntry = studentAnswers[offset];

    if (!hasAnswerValue(studentEntry)) {
      const fallbackCorrectEntry = remainingCorrectAnswers.shift();
      return {
        questionId: `${questionId}::${offset + 1}`,
        questionNumber: questionNumber + offset,
        studentAnswer: "N/A",
        correctAnswer: formatAnswerValue(fallbackCorrectEntry),
        hasCorrectAnswer: true,
        isCorrect: false,
      };
    }

    if (consumeMatchingCorrectAnswer(studentEntry)) {
      return {
        questionId: `${questionId}::${offset + 1}`,
        questionNumber: questionNumber + offset,
        studentAnswer: formatAnswerValue(studentEntry),
        correctAnswer: formatAnswerValue(studentEntry),
        hasCorrectAnswer: true,
        isCorrect: true,
      };
    }

    const fallbackCorrectEntry = remainingCorrectAnswers.shift();
    return {
      questionId: `${questionId}::${offset + 1}`,
      questionNumber: questionNumber + offset,
      studentAnswer: formatAnswerValue(studentEntry),
      correctAnswer: formatAnswerValue(fallbackCorrectEntry),
      hasCorrectAnswer: true,
      isCorrect: false,
    };
  });
};

const getAnsweredQuestionKeys = (answers: Record<string, unknown>): string[] => {
  return Object.entries(answers)
    .filter(([key, value]) => !key.startsWith("_") && hasAnswerValue(value))
    .map(([key]) => key);
};

const getExplicitPartOrTask = (attemptTypeHint: string, label: "part" | "task"): number | null => {
  const match = attemptTypeHint.match(new RegExp(`^${label}\\s+(\\d+)$`, "i"));
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
};

const resolveQuestionsForAttempt = ({
  sectionType,
  allQuestions,
  passages,
  answers,
  attemptType,
  isSplitAttempt,
}: {
  sectionType: ExamSectionType | undefined;
  allQuestions: Question[];
  passages: Passage[];
  answers: Record<string, unknown>;
  attemptType: string;
  isSplitAttempt: boolean;
}): Question[] => {
  if (!sectionType || allQuestions.length === 0 || !isSplitAttempt) {
    return allQuestions;
  }

  const normalizedAttemptType = attemptType.trim().toLowerCase();
  const hasAttemptTypeHint = normalizedAttemptType.length > 0;
  if (normalizedAttemptType === "full") {
    return allQuestions;
  }

  const answeredKeys = getAnsweredQuestionKeys(answers);

  if (sectionType === "READING") {
    const explicitPart = getExplicitPartOrTask(attemptType, "part");
    let partIndex = explicitPart ? explicitPart - 1 : null;

    if (partIndex === null && !hasAttemptTypeHint && answeredKeys.length > 0) {
      for (let index = 0; index < passages.length; index += 1) {
        const passageId = passages[index]?.id;
        const questionIds = new Set(
          allQuestions
            .filter((question) => question.passageId === passageId)
            .map((question) => question.id),
        );

        if (questionIds.size === 0) {
          continue;
        }

        if (answeredKeys.every((answerKey) => questionIds.has(answerKey))) {
          partIndex = index;
          break;
        }
      }
    }

    if (partIndex !== null && partIndex >= 0 && partIndex < passages.length) {
      const passageId = passages[partIndex]?.id;
      const filteredQuestions = allQuestions.filter(
        (question) => question.passageId === passageId,
      );

      if (filteredQuestions.length > 0) {
        return filteredQuestions;
      }
    }

    return allQuestions;
  }

  if (sectionType === "LISTENING") {
    const explicitPart = getExplicitPartOrTask(attemptType, "part");
    let partNumber =
      explicitPart && explicitPart >= 1 && explicitPart <= 4
        ? (explicitPart as 1 | 2 | 3 | 4)
        : null;

    if (partNumber === null && !hasAttemptTypeHint && answeredKeys.length > 0) {
      for (const currentPart of [1, 2, 3, 4] as const) {
        const questionIds = new Set(
          getListeningPartQuestions(allQuestions, currentPart).map(
            (question) => question.id,
          ),
        );

        if (questionIds.size === 0) {
          continue;
        }

        if (answeredKeys.every((answerKey) => questionIds.has(answerKey))) {
          partNumber = currentPart;
          break;
        }
      }
    }

    if (partNumber !== null) {
      const filteredQuestions = getListeningPartQuestions(allQuestions, partNumber);
      if (filteredQuestions.length > 0) {
        return filteredQuestions;
      }
    }

    return allQuestions;
  }

  if (sectionType === "WRITING") {
    const explicitTask = getExplicitPartOrTask(attemptType, "task");
    if (explicitTask === 1 && allQuestions[0]) {
      return [allQuestions[0]];
    }

    if (explicitTask === 2 && allQuestions[1]) {
      return [allQuestions[1]];
    }

    if (hasAttemptTypeHint) {
      return allQuestions;
    }

    const normalizedKeys = answeredKeys.map((key) => key.toLowerCase());
    const task1QuestionId = allQuestions[0]?.id;
    const task2QuestionId = allQuestions[1]?.id;

    const hasTask1 =
      normalizedKeys.includes("w1") ||
      normalizedKeys.includes("task1") ||
      (task1QuestionId ? answeredKeys.includes(task1QuestionId) : false);
    const hasTask2 =
      normalizedKeys.includes("w2") ||
      normalizedKeys.includes("task2") ||
      (task2QuestionId ? answeredKeys.includes(task2QuestionId) : false);

    if (hasTask1 && !hasTask2 && allQuestions[0]) {
      return [allQuestions[0]];
    }

    if (hasTask2 && !hasTask1 && allQuestions[1]) {
      return [allQuestions[1]];
    }

    return allQuestions;
  }

  return allQuestions;
};

export default function HistoryReviewPage() {
  const { isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const params = useParams<{ resultId: string }>();
  const searchParams = useSearchParams();
  const [showCorrectAnswers, setShowCorrectAnswers] = useState(true);

  const resultId = Array.isArray(params?.resultId)
    ? params.resultId[0]
    : params?.resultId;

  const resultQuery = useQuery({
    queryKey: resultId ? studentQueryKeys.result(resultId) : ["student", "results", "empty"],
    queryFn: ({ signal }) => api.getResult(resultId as string, { signal }),
    enabled: Boolean(resultId && isAuthenticated),
    staleTime: STUDENT_QUERY_TIMINGS.results.staleTime,
    gcTime: STUDENT_QUERY_TIMINGS.results.gcTime,
  });

  const allResultsQuery = useQuery({
    queryKey: studentQueryKeys.myResults(),
    queryFn: ({ signal }) => api.getMyResults({ signal }),
    enabled: Boolean(isAuthenticated),
    staleTime: STUDENT_QUERY_TIMINGS.results.staleTime,
    gcTime: STUDENT_QUERY_TIMINGS.results.gcTime,
    placeholderData: (previousData) => previousData,
  });

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  const result = resultQuery.data as ExamResult | undefined;
  const questions = useMemo(() => ((result?.section?.questions || []) as Question[]), [result]);
  const passages = useMemo(() => ((result?.section?.passages || []) as Passage[]), [result]);
  const attemptTypeHintFromQuery = (searchParams.get("type") || "").trim();
  const isSplitFromQuery = searchParams.get("split") === "1";

  const answerMap = useMemo<Record<string, unknown>>(
    () => (result?.answers as Record<string, unknown>) || {},
    [result],
  );

  const attemptTypeHint = useMemo(() => {
    if (attemptTypeHintFromQuery.length > 0) {
      return attemptTypeHintFromQuery;
    }

    return typeof answerMap._attemptType === "string" ? answerMap._attemptType.trim() : "";
  }, [attemptTypeHintFromQuery, answerMap]);

  const isSplitAttempt = useMemo(() => {
    if (isSplitFromQuery) {
      return true;
    }

    return /^part\s+\d+$/i.test(attemptTypeHint) || /^task\s+\d+$/i.test(attemptTypeHint);
  }, [isSplitFromQuery, attemptTypeHint]);

  const visibleQuestions = useMemo(
    () =>
      resolveQuestionsForAttempt({
        sectionType: result?.section?.type,
        allQuestions: questions,
        passages,
        answers: answerMap,
        attemptType: attemptTypeHint,
        isSplitAttempt,
      }),
    [result?.section?.type, questions, passages, answerMap, attemptTypeHint, isSplitAttempt],
  );

  const practiceAnswerRows = useMemo<PracticeAnswerRow[]>(() => {
    return visibleQuestions.flatMap((question, index) => {
      const questionNumber = resolveQuestionNumber(question, index + 1);
      const studentAnswerRaw = answerMap[question.id];
      const correctAnswerRaw = resolveQuestionCorrectAnswer(question);

      const shouldSplitIntoIndependentRows =
        question.type === "MCQ_MULTIPLE" &&
        Array.isArray(correctAnswerRaw) &&
        question.points > 1 &&
        correctAnswerRaw.length === question.points;

      if (shouldSplitIntoIndependentRows) {
        return buildIndependentMcqRows({
          questionId: question.id,
          questionNumber,
          studentAnswerRaw,
          correctAnswerRaw,
        });
      }

      const hasCorrectAnswer = hasAnswerValue(correctAnswerRaw);

      return {
        questionId: question.id,
        questionNumber,
        studentAnswer: formatAnswerValue(studentAnswerRaw),
        correctAnswer: formatAnswerValue(correctAnswerRaw),
        hasCorrectAnswer,
        isCorrect: hasCorrectAnswer
          ? isAnswerCorrect(studentAnswerRaw, correctAnswerRaw)
          : null,
      };
    });
  }, [visibleQuestions, answerMap]);

  const objectiveRows = useMemo(
    () => practiceAnswerRows.filter((row) => row.hasCorrectAnswer),
    [practiceAnswerRows],
  );

  const scoreText = useMemo(() => {
    if (objectiveRows.length > 0) {
      const correctCount = objectiveRows.filter((row) => row.isCorrect).length;
      return `${correctCount}/${objectiveRows.length}`;
    }

    if (
      result &&
      typeof result.score === "number" &&
      typeof result.totalScore === "number"
    ) {
      return `${result.score.toFixed(1)}/${result.totalScore.toFixed(1)}`;
    }

    if (result && typeof result.bandScore === "number") {
      return `Band ${result.bandScore.toFixed(1)}`;
    }

    return "Pending";
  }, [objectiveRows, result]);

  const writingResponses = useMemo(() => {
    if (result?.section?.type !== "WRITING") {
      return [];
    }

    const task1QuestionId = questions[0]?.id;
    const task2QuestionId = questions[1]?.id;

    const entries = [
      {
        label: "Task 1",
        value:
          (answerMap["w1"] as string | undefined) ||
          (answerMap["task1"] as string | undefined) ||
          (task1QuestionId ? (answerMap[task1QuestionId] as string | undefined) : undefined),
      },
      {
        label: "Task 2",
        value:
          (answerMap["w2"] as string | undefined) ||
          (answerMap["task2"] as string | undefined) ||
          (task2QuestionId ? (answerMap[task2QuestionId] as string | undefined) : undefined),
      },
    ];

    return entries.filter((entry) => hasAnswerValue(entry.value));
  }, [result, questions, answerMap]);

  const attemptHistory = useMemo<AttemptHistoryItem[]>(() => {
    if (!result) {
      return [];
    }

    const sectionId = result.section?.id || result.sectionId;
    if (!sectionId) {
      return [];
    }

    const sectionResults = (allResultsQuery.data || [])
      .filter((item) => (item.section?.id || item.sectionId) === sectionId)
      .sort(
        (left, right) =>
          new Date(left.submittedAt).getTime() - new Date(right.submittedAt).getTime(),
      );

    return sectionResults.map((item, index) => ({
      id: item.id,
      attempt: index + 1,
      score: typeof item.score === "number" ? Number(item.score) : null,
      totalScore: typeof item.totalScore === "number" ? Number(item.totalScore) : null,
      bandScore: typeof item.bandScore === "number" ? Number(item.bandScore) : null,
      submittedAt: item.submittedAt,
    }));
  }, [allResultsQuery.data, result]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-100 py-8 px-4">
        <div className="mx-auto max-w-5xl rounded-3xl border border-gray-200 bg-white p-6 shadow-sm md:p-10">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-black mx-auto mb-4"></div>
            <p className="text-gray-400">Loading result...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!resultId) {
    return (
      <div className="min-h-screen bg-gray-100 py-8 px-4">
        <div className="mx-auto max-w-3xl rounded-3xl border border-gray-200 bg-white p-8 shadow-sm text-center">
          <p className="text-sm text-red-600">Invalid result link.</p>
          <button
            type="button"
            onClick={() => router.push("/history")}
            className="mt-4 inline-flex items-center rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white hover:bg-gray-800"
          >
            Back to History
          </button>
        </div>
      </div>
    );
  }

  if (resultQuery.isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 py-8 px-4">
        <div className="mx-auto max-w-5xl rounded-3xl border border-gray-200 bg-white p-6 shadow-sm md:p-10">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-black mx-auto mb-4"></div>
            <p className="text-gray-400">Loading result...</p>
          </div>
        </div>
      </div>
    );
  }

  if (resultQuery.isError) {
    return (
      <div className="min-h-screen bg-gray-100 py-8 px-4">
        <div className="mx-auto max-w-3xl rounded-3xl border border-gray-200 bg-white p-8 shadow-sm text-center">
          <p className="text-sm text-red-600">Failed to load this attempt.</p>
          <button
            type="button"
            onClick={() => router.push("/history")}
            className="mt-4 inline-flex items-center rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white hover:bg-gray-800"
          >
            Back to History
          </button>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="min-h-screen bg-gray-100 py-8 px-4">
        <div className="mx-auto max-w-3xl rounded-3xl border border-gray-200 bg-white p-8 shadow-sm text-center">
          <p className="text-sm text-red-600">This attempt could not be found.</p>
          <button
            type="button"
            onClick={() => router.push("/history")}
            className="mt-4 inline-flex items-center rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white hover:bg-gray-800"
          >
            Back to History
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4">
      <div className="mx-auto max-w-5xl rounded-3xl border border-gray-200 bg-white p-6 shadow-sm md:p-10">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
            <svg
              className="h-9 w-9 text-emerald-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h2 className="text-3xl font-bold text-gray-900">Test Complete!</h2>
          <p className="mt-2 text-sm text-gray-500">Here are your results</p>
        </div>

        <div className="mx-auto mt-6 max-w-4xl rounded-2xl bg-gray-50 p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-lg font-medium text-gray-700">Your Score</p>
            <p className="text-4xl font-bold text-red-500">{scoreText}</p>
          </div>
        </div>

        {result.section?.type !== "WRITING" && practiceAnswerRows.length > 0 && (
          <section className="mx-auto mt-8 max-w-4xl rounded-2xl border border-gray-200 bg-white p-4 md:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-3xl font-semibold text-gray-900">Answer Sheet</h3>
              {objectiveRows.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowCorrectAnswers((previousState) => !previousState)}
                  className="inline-flex items-center gap-2 rounded-full border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  <span
                    className={`h-5 w-9 rounded-full p-0.5 transition-colors ${
                      showCorrectAnswers ? "bg-red-500" : "bg-gray-300"
                    }`}
                  >
                    <span
                      className={`block h-4 w-4 rounded-full bg-white transition-transform ${
                        showCorrectAnswers ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </span>
                  Show Correct Answers
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {practiceAnswerRows.map((row) => (
                <article
                  key={row.questionId}
                  className="rounded-xl border border-gray-200 bg-gray-50 p-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-300 text-sm font-bold text-white">
                      {row.questionNumber}
                    </div>
                    <div className="min-w-0 text-sm">
                      <p className="text-gray-700">
                        Your: <span className="font-medium text-gray-900">{row.studentAnswer}</span>
                        {row.hasCorrectAnswer && row.isCorrect === false && (
                          <span className="ml-2 font-semibold text-red-500">x</span>
                        )}
                        {row.hasCorrectAnswer && row.isCorrect === true && (
                          <span className="ml-2 font-semibold text-emerald-500">✓</span>
                        )}
                      </p>
                      {showCorrectAnswers && row.hasCorrectAnswer && (
                        <p className="mt-1 text-emerald-600">
                          Correct: <span className="font-medium">{row.correctAnswer}</span>
                        </p>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {result.section?.type === "WRITING" && writingResponses.length > 0 && (
          <section className="mx-auto mt-8 max-w-4xl rounded-2xl border border-gray-200 bg-white p-4 md:p-6">
            <h3 className="text-xl font-semibold text-gray-900">Submitted Responses</h3>
            <div className="mt-4 space-y-4">
              {writingResponses.map((entry) => (
                <article
                  key={entry.label}
                  className="rounded-xl border border-gray-200 bg-gray-50 p-4"
                >
                  <h4 className="text-sm font-bold uppercase tracking-wide text-gray-600">
                    {entry.label}
                  </h4>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">
                    {String(entry.value)}
                  </p>
                </article>
              ))}
            </div>
          </section>
        )}

        <section className="mx-auto mt-8 max-w-4xl rounded-2xl border border-gray-200 bg-white p-4 md:p-6">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-gray-900">Attempt History</h3>
            {allResultsQuery.isLoading && <span className="text-xs text-gray-500">Updating...</span>}
          </div>

          {attemptHistory.length === 0 ? (
            <p className="text-sm text-gray-500">Attempt history will appear after submissions.</p>
          ) : (
            <div className="space-y-2">
              {attemptHistory
                .slice()
                .reverse()
                .map((entry) => (
                  <div
                    key={entry.id}
                    className={`rounded-xl border px-3 py-2 ${
                      entry.id === result.id
                        ? "border-gray-300 bg-white"
                        : "border-gray-100 bg-gray-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-gray-700">
                        Attempt {entry.attempt}
                        {entry.id === result.id ? " (current)" : ""}
                      </span>
                      <span className="text-[11px] text-gray-500">
                        {new Date(entry.submittedAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-gray-900">
                      {typeof entry.score === "number"
                        ? `Score: ${entry.score.toFixed(1)}${typeof entry.totalScore === "number" ? ` / ${entry.totalScore.toFixed(1)}` : ""}`
                        : "Score pending"}
                    </p>
                    {typeof entry.bandScore === "number" && (
                      <p className="text-xs text-gray-600">Band: {entry.bandScore.toFixed(1)}</p>
                    )}
                  </div>
                ))}
            </div>
          )}
        </section>

        <div className="mx-auto mt-8 flex max-w-4xl justify-end">
          <button
            type="button"
            onClick={() => router.push("/history")}
            className="inline-flex items-center rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-gray-800"
          >
            Back to History
          </button>
        </div>
      </div>
    </div>
  );
}
