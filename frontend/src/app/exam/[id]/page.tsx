"use client";

import {
    BottomNav,
    ExamHeader,
    PartBanner,
    ResizablePanel,
    ReviewModal,
    SettingsModal,
} from "@/components/exam";
import { HighlightableText } from "@/components/exam/HighlightableText";
import {
    FillBlankQuestion,
    FlowChartGroup,
    MatchingGroup,
    MCQQuestion,
    ShortAnswerQuestion,
    SummaryGroup,
    TableGroup,
    TrueFalseQuestion,
    WritingTask,
} from "@/components/questions";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { useAuth } from "@/contexts/AuthContext";
import { useAntiCheat } from "@/hooks/useAntiCheat";
import { api } from "@/lib/api";
import { ExamAssignment, Question } from "@/types";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api"
).replace("/api", "");

type AnswerValue = string | string[] | Record<string, string>;
const getEffectivePoints = (q: Question) => {
  if (q.points > 1) return q.points;
  if (q.type === "MCQ_MULTIPLE") {
    if (q.questionRange) {
      const rangeMatch = q.questionRange.match(/(\d+)\s*[–-]\s*(\d+)/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1]);
        const end = parseInt(rangeMatch[2]);
        return Math.max(1, end - start + 1);
      }
    }
    if (q.instruction) {
      const instr = q.instruction.toUpperCase();
      if (instr.includes("TWO")) return 2;
      if (instr.includes("THREE")) return 3;
      if (instr.includes("FOUR")) return 4;
      if (instr.includes("FIVE")) return 5;
    }
  }
  return q.points || 1;
};

function ExamContent({ assignmentId }: { assignmentId: string }) {
  const { isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const forceShowVideo = searchParams.get("showVideo") === "1";

  const [assignment, setAssignment] = useState<
    (ExamAssignment & { remainingTime?: number }) | null
  >(null);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [currentQuestionId, setCurrentQuestionId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [showPlayOverlay, setShowPlayOverlay] = useState(false);
  const [showIntroVideo, setShowIntroVideo] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isVideoAutoplayBlocked, setIsVideoAutoplayBlocked] = useState(false);
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const introVideoRef = useRef<HTMLVideoElement | null>(null);
  const introContainerRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);

  // Enable anti-cheating measures
  useAntiCheat();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (assignmentId && isAuthenticated) {
      // Clear previous data while loading
      setAssignment(null);
      setAnswers({});
      setError("");
      
      // Fetch details first without starting the timer
      api
        .getAssignment(assignmentId)
        .then((data) => {
          setAssignment(data);
          if (data.answers) {
            setAnswers(data.answers as Record<string, AnswerValue>);
          }

          const hasProvidedAnswers =
            data.answers &&
            Object.keys(data.answers).length > 0 &&
            Object.values(data.answers).some(
              (v) => v !== "" && v !== null && v !== undefined
            );

          if (
            forceShowVideo ||
            data.status === "ASSIGNED" ||
            !hasProvidedAnswers
          ) {
            setShowIntroVideo(true);
          } else if (data.status === "IN_PROGRESS") {
            // If already in progress, use startExam to get remaining time
            api.startExam(assignmentId).then(setAssignment);
            if (data.section?.type === "LISTENING") {
              setShowPlayOverlay(true);
            }
          }
        })
        .catch((err) => {
          setError(err.message);
        });
    }
  }, [assignmentId, isAuthenticated, forceShowVideo]);

  const handleStartExam = useCallback(async () => {
    try {
      const data = await api.startExam(assignmentId);
      setAssignment(data);
    } catch (err) {
      console.error("Failed to start exam:", err);
    }
  }, [assignmentId]);

  const handleVideoEnded = useCallback(() => {
    setShowIntroVideo(false);
    if (assignment?.section?.type === "LISTENING") {
      setShowPlayOverlay(true);
    } else {
      handleStartExam();
    }
  }, [assignment?.section?.type, handleStartExam]);

  useEffect(() => {
    if (showIntroVideo && introVideoRef.current) {
      const video = introVideoRef.current;

      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // Autoplay was prevented. This is expected in some browsers/settings.
          // We show a play button overlay in this case.
          setIsVideoAutoplayBlocked(true);
        });
      }

      const container = introContainerRef.current;
      if (container && container.requestFullscreen) {
        container.requestFullscreen().catch(() => {
          console.warn("Fullscreen request blocked");
        });
      }
    }
  }, [showIntroVideo]);

  const handleAnswerChange = useCallback(
    (questionId: string, value: AnswerValue) => {
      setAnswers((prev) => ({ ...prev, [questionId]: value }));
      setCurrentQuestionId(questionId);
    },
    []
  );

  const handleQuestionClick = useCallback(
    (questionId: string) => {
      setCurrentQuestionId(questionId);

      // Check if question is in current view
      const element = document.getElementById(`question-${questionId}`);
      if (element) {
        if (assignment?.section?.type === "READING" && rightPanelRef.current) {
          // Scroll inside the right panel for Reading
          const container = rightPanelRef.current;
          const containerTop = container.getBoundingClientRect().top;
          const elementTop = element.getBoundingClientRect().top;
          const scrollTarget =
            container.scrollTop + (elementTop - containerTop) - 20;

          container.scrollTo({
            top: scrollTarget,
            behavior: "smooth",
          });
        } else {
          // Main window scroll for other types
          const headerOffset = 80;
          const elementPosition = element.getBoundingClientRect().top;
          const offsetPosition =
            elementPosition + window.pageYOffset - headerOffset;

          window.scrollTo({
            top: offsetPosition,
            behavior: "smooth",
          });
        }
      } else {
        window.scrollTo({ top: 0, behavior: "instant" });
        if (rightPanelRef.current) {
          rightPanelRef.current.scrollTo({ top: 0, behavior: "instant" });
        }
      }
    },
    [assignment?.section?.type]
  );

  const handleFinalSubmit = useCallback(async () => {
    if (!assignment) return;
    setIsSubmitting(true);
    try {
      await api.submitExam(assignment.id, answers);

      // Find next assignment for continuous flow
      const allAssignments = await api.getMyAssignments();
      const nextAssignment = ["LISTENING", "READING", "WRITING"]
        .map((type) => allAssignments.find((a) => a.section?.type === type))
        .find((a) => a && a.status !== "SUBMITTED" && a.id !== assignment.id);

      if (nextAssignment) {
        router.push(`/exam/${nextAssignment.id}?showVideo=1`);
      } else {
        router.push("/dashboard");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit exam");
      setIsSubmitting(false);
    } finally {
      setIsReviewModalOpen(false);
      setIsConfirmModalOpen(false);
    }
  }, [assignment, answers, router]);

  const handleSubmit = useCallback(async () => {
    if (!assignment) return;

    // For Reading and Listening, show the review modal first
    if (
      assignment.section?.type === "READING" ||
      assignment.section?.type === "LISTENING"
    ) {
      setIsReviewModalOpen(true);
      return;
    }

    // For Writing or other types, submit directly
    handleFinalSubmit();
  }, [assignment, handleFinalSubmit]);

  const handleTimerExpire = useCallback(() => {
    handleFinalSubmit();
  }, [handleFinalSubmit]);

  const getParts = useCallback(() => {
    if (!assignment?.section) return [];
    const questions = (assignment.section.questions || []) as Question[];
    const type = assignment.section.type;

    if (type === "READING") {
      let globalIndex = 0;
      return (assignment.section.passages || []).map((p, i) => {
        const partQuestions = questions.filter((q) => q.passageId === p.id);
        const totalPoints = partQuestions.reduce(
          (sum, q) => sum + getEffectivePoints(q),
          0
        );

        const answeredCount = partQuestions.reduce((sum, q) => {
          const ans = answers[q.id];
          const points = getEffectivePoints(q);
          if (q.type === "MCQ_MULTIPLE" && Array.isArray(ans)) {
            return sum + Math.min(ans.length, points);
          }
          return sum + (ans ? points : 0);
        }, 0);

        const firstMatch = partQuestions[0]?.id.match(/\d+/);
        const startNum = firstMatch ? parseInt(firstMatch[0]) : globalIndex + 1;

        const navQuestions = partQuestions.map((q) => {
          const m = q.id.match(/\d+/);
          const start = m ? parseInt(m[0]) : questions.indexOf(q) + 1;
          const points = getEffectivePoints(q);
          const displayLabel =
            points > 1 ? `${start}-${start + points - 1}` : start;
          return {
            id: q.id,
            number: displayLabel,
            isAnswered: Array.isArray(answers[q.id])
              ? (answers[q.id] as any[]).length > 0
              : !!answers[q.id],
          };
        });

        globalIndex += partQuestions.length;

        return {
          number: i + 1,
          questionCount: totalPoints,
          answeredCount,
          startQuestionNumber: startNum,
          questions: navQuestions,
        };
      });
    } else if (type === "WRITING") {
      return questions.map((q, i) => ({
        number: i + 1,
        questionCount: 1,
        answeredCount: !!answers[q.id] ? 1 : 0,
        startQuestionNumber: i + 1,
        questions: [
          {
            id: q.id,
            number: `Task ${i + 1}`,
            isAnswered: !!answers[q.id],
          },
        ],
      }));
    } else {
      // Hardcoded parts for Listening to ensure 1-10, 11-20, 21-30, 31-40
      const partRanges = [
        { start: 1, end: 10 },
        { start: 11, end: 20 },
        { start: 21, end: 30 },
        { start: 31, end: 40 },
      ];

      return partRanges.map((range, i) => {
        // Filter questions that fall within this range
        // Since questions list is flat, we can filter by 'number' field
        // Note: For multi-point questions (e.g. Q26 worth 2 points), the 'number' is 26.
        // It belongs to the 21-30 range.
        const partQuestions = questions.filter((q) => {
          const qNum = parseInt(q.id.replace(/\D/g, "")) || 0;
          return qNum >= range.start && qNum <= range.end;
        });

        // If no questions found (e.g. unfinished JSON), return empty part or skip
        if (partQuestions.length === 0) {
          return {
            number: i + 1,
            questionCount: 0,
            answeredCount: 0,
            startQuestionNumber: range.start,
            questions: [],
          };
        }

        const answeredCount = partQuestions.reduce((sum, q) => {
          const ans = answers[q.id];
          const points = getEffectivePoints(q);
          if (q.type === "MCQ_MULTIPLE" && Array.isArray(ans)) {
            return sum + Math.min(ans.length, points);
          }
          return sum + (ans ? points : 0);
        }, 0);

        const totalPoints = partQuestions.reduce(
          (sum, q) => sum + getEffectivePoints(q),
          0
        );

        const navQuestions = partQuestions.map((q) => {
          // Parse number reliably
          const m = q.id.match(/\d+/);
          const start = m ? parseInt(m[0]) : 0;
          const points = getEffectivePoints(q);
          const displayLabel =
            points > 1 ? `${start}-${start + points - 1}` : start;
          return {
            id: q.id,
            number: displayLabel,
            isAnswered: Array.isArray(answers[q.id])
              ? (answers[q.id] as string[]).length > 0
              : !!answers[q.id],
          };
        });

        return {
          number: i + 1,
          questionCount: totalPoints,
          answeredCount,
          startQuestionNumber: range.start,
          questions: navQuestions,
        };
      });
    }
  }, [assignment, answers]);

  const getCurrentPartNumber = useCallback(() => {
    const parts = getParts();
    if (!currentQuestionId) return 1;
    const part = parts.find((p) =>
      p.questions.some((q) => q.id === currentQuestionId)
    );
    return part ? part.number : 1;
  }, [getParts, currentQuestionId]);

  const handlePartClick = useCallback(
    (partNumber: number) => {
      const parts = getParts();
      const part = parts.find((p) => p.number === partNumber);
      if (part && part.questions.length > 0) {
        handleQuestionClick(part.questions[0].id);
      }
    },
    [getParts, handleQuestionClick]
  );

  if (isLoading || !assignment) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        {error ? (
          <div className="text-center">
            <p className="text-red-400 mb-4">{error}</p>
            <button
              onClick={() => router.push("/dashboard")}
              className="px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-900"
            >
              Back to Dashboard
            </button>
          </div>
        ) : (
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-black mx-auto mb-4"></div>
            <p className="text-gray-400">Loading exam...</p>
          </div>
        )}
      </div>
    );
  }

  const section = assignment.section;
  if (!section) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-gray-900">
        Section not found
      </div>
    );
  }

  const questions = (section.questions || []) as Question[];
  const passages = (section.passages || []) as {
    id: string;
    title: string;
    content: string;
  }[];

  const renderQuestion = (question: Question, index: number) => {
    const value = answers[question.id] ?? "";

    // Extract numeric portion from ID (e.g., "q6" -> 6) or fallback to index
    const idMatch = question.id.match(/\d+/);
    const startNum = idMatch ? parseInt(idMatch[0]) : index + 1;
    const points = getEffectivePoints(question);
    const displayNumber =
      points > 1 ? `${startNum}-${startNum + points - 1}` : startNum;
    const isActive = currentQuestionId === question.id;

    return (
      <div key={question.id} id={`question-${question.id}`}>
        {(() => {
          switch (question.type) {
            case "MCQ_SINGLE":
            case "MCQ_MULTIPLE":
              return (
                <MCQQuestion
                  id={question.id}
                  questionText={question.questionText}
                  options={question.options}
                  isMultiple={question.type === "MCQ_MULTIPLE"}
                  value={value as string | string[]}
                  onChange={(v) => handleAnswerChange(question.id, v)}
                  questionNumber={displayNumber}
                  isActive={isActive}
                  onFocus={() => setCurrentQuestionId(question.id)}
                  sectionType={section.type}
                />
              );
            case "TRUE_FALSE_NOT_GIVEN":
            case "YES_NO_NOT_GIVEN":
              return (
                <TrueFalseQuestion
                  id={question.id}
                  questionText={question.questionText}
                  variant={question.type}
                  value={value as string}
                  onChange={(v) => handleAnswerChange(question.id, v)}
                  questionNumber={displayNumber}
                  isActive={isActive}
                  onFocus={() => setCurrentQuestionId(question.id)}
                  sectionType={section.type}
                />
              );
            case "FILL_BLANK":
            case "SENTENCE_COMPLETION":
            case "SUMMARY_COMPLETION":
            case "NOTE_COMPLETION":
            case "TABLE_COMPLETION":
            case "FLOW_CHART_COMPLETION":
            case "FORM_COMPLETION":
            case "PLAN_MAP_LABELING":
            case "MATCHING":
            case "DIAGRAM_LABELING":
              return (
                <FillBlankQuestion
                  id={question.id}
                  questionText={question.questionText}
                  wordLimit={
                    "wordLimit" in question
                      ? (question as { wordLimit?: number }).wordLimit
                      : undefined
                  }
                  value={value as string}
                  onChange={(v) => handleAnswerChange(question.id, v)}
                  questionNumber={displayNumber}
                  isActive={isActive}
                  onFocus={() => setCurrentQuestionId(question.id)}
                  hideBullet={true}
                  sectionType={section.type}
                />
              );
            case "SHORT_ANSWER":
              return (
                <ShortAnswerQuestion
                  id={question.id}
                  questionText={question.questionText}
                  wordLimit={question.wordLimit}
                  value={value as string}
                  onChange={(v) => handleAnswerChange(question.id, v)}
                  questionNumber={displayNumber}
                  isActive={isActive}
                  onFocus={() => setCurrentQuestionId(question.id)}
                  sectionType={section.type}
                />
              );
          }
        })()}
      </div>
    );
  };

  const renderQuestionsWithGrouping = (groupQuestions: Question[]) => {
    const groups: { type: string; questions: Question[] }[] = [];
    let currentGroup: { type: string; questions: Question[] } | null = null;

    groupQuestions.forEach((q) => {
      const isMatching = [
        "MATCHING",
        "PLAN_MAP_LABELING",
        "DIAGRAM_LABELING",
      ].includes(q.type);
      const isFlowChart = q.type === "FLOW_CHART_COMPLETION";
      const isTable = q.type === "TABLE_COMPLETION";
      const isSummary = q.type === "SUMMARY_COMPLETION";

      let groupType = `${q.questionRange}-${JSON.stringify(q.instruction)}`;

      if (isMatching) groupType = "SPECIAL_MATCHING";
      else if (isFlowChart) groupType = "SPECIAL_FLOWCHART";
      else if (isTable) groupType = "SPECIAL_TABLE";
      else if (isSummary) groupType = "SPECIAL_SUMMARY";
      // If standard question (not special) and has no instruction/range, try to stick to previous group
      else if (
        !q.instruction &&
        !q.questionRange &&
        currentGroup &&
        !currentGroup.type.startsWith("SPECIAL_")
      ) {
        groupType = currentGroup.type;
      }

      if (!currentGroup || currentGroup.type !== groupType) {
        currentGroup = {
          type: groupType,
          questions: [q],
        };
        groups.push(currentGroup);
      } else {
        currentGroup.questions.push(q);
      }
    });

    return groups.map((group, groupIdx) => {
      const firstQ = group.questions[0];
      const isMatching = group.type === "SPECIAL_MATCHING";
      const isFlowChart = group.type === "SPECIAL_FLOWCHART";
      const isTable = group.type === "SPECIAL_TABLE";
      const isSummary = group.type === "SPECIAL_SUMMARY";
      const showHeader = isMatching || isFlowChart || isTable || isSummary;

      return (
        <div key={`group-${groupIdx}`} className="space-y-6 pb-12">
          {/* Group Header for Special Types (Matching, FlowChart, Table, Summary) */}
          {(showHeader || firstQ.questionRange) && firstQ.questionRange && (
            <div className="mt-2 mb-2 pb-2">
              <h3 className="text-[17px] font-bold text-[#30343C]">
                Questions {firstQ.questionRange}
              </h3>
            </div>
          )}
          {(showHeader || firstQ.instruction) && firstQ.instruction && (
            <div className="mb-3">
              {section.type === "LISTENING" || section.type === "READING" ? (
                <HighlightableText
                  content={firstQ.instruction}
                  initialHighlights={[]}
                  onHighlightsChange={() => {}}
                  inline={true}
                />
              ) : (
                <p
                  className="text-[#30343C] text-[15px] leading-relaxed font-normal"
                  dangerouslySetInnerHTML={{
                    __html: firstQ.instruction.replace(
                      /\*\*(.*?)\*\*/g,
                      "<strong>$1</strong>"
                    ),
                  }}
                />
              )}
            </div>
          )}
          {"title" in firstQ && (firstQ as { title?: string }).title && (
            <div className="mb-4 mt-2">
              <h4 className="text-lg font-bold text-center text-[#30343C] uppercase tracking-wide">
                {(firstQ as { title?: string }).title}
              </h4>
            </div>
          )}
          {isMatching && (
            <MatchingGroup
              questions={group.questions}
              options={
                "options" in firstQ
                  ? (firstQ as { options?: { id: string; text: string }[] })
                      .options || []
                  : []
              }
              answers={Object.fromEntries(
                Object.entries(answers).filter(
                  (entry): entry is [string, string] =>
                    typeof entry[1] === "string"
                )
              )}
              onChange={(questionId, value) =>
                handleAnswerChange(questionId, value)
              }
              currentQuestionId={currentQuestionId}
              onQuestionClick={setCurrentQuestionId}
              questionsLabel={
                "questionsLabel" in firstQ
                  ? (firstQ as { questionsLabel?: string }).questionsLabel
                  : undefined
              }
              optionsLabel={
                "optionsLabel" in firstQ
                  ? (firstQ as { optionsLabel?: string }).optionsLabel
                  : undefined
              }
              imageUrl={firstQ.imageUrl}
              sectionType={section.type}
            />
          )}

          {isSummary && (
            <SummaryGroup
              questions={group.questions}
              answers={answers}
              onChange={handleAnswerChange}
              currentQuestionId={currentQuestionId}
              onQuestionClick={setCurrentQuestionId}
              sectionType={section.type}
            />
          )}

          {group.type === "SPECIAL_FLOWCHART" && (
            <FlowChartGroup
              questions={group.questions}
              answers={answers}
              onChange={handleAnswerChange}
              currentQuestionId={currentQuestionId}
              onQuestionClick={setCurrentQuestionId}
              sectionType={section.type}
            />
          )}

          {group.type === "SPECIAL_TABLE" && (
            <TableGroup
              questions={group.questions}
              answers={answers}
              onChange={handleAnswerChange}
              currentQuestionId={currentQuestionId}
              onQuestionClick={setCurrentQuestionId}
              sectionType={section.type}
            />
          )}

          {!isMatching &&
            !isSummary &&
            group.type !== "SPECIAL_FLOWCHART" &&
            group.type !== "SPECIAL_TABLE" && (
              <div className="space-y-4">
                {group.questions.map((q) => {
                  const indexInFiltered = groupQuestions.findIndex(
                    (fq) => fq.id === q.id
                  );
                  return renderQuestion(q, indexInFiltered);
                })}
              </div>
            )}
        </div>
      );
    });
  };

  const parts = getParts();
  const currentPartNumber = getCurrentPartNumber();
  const activePartIndex = parts.findIndex(
    (p) => p.number === currentPartNumber
  );
  const currentPart = parts[activePartIndex] || parts[0];
  const startQuestion = currentPart?.startQuestionNumber || 1;
  const endQuestion = startQuestion + (currentPart?.questionCount || 1) - 1;

  // Reading Section Layout
  if (section.type === "READING") {
    return (
      <div className="h-screen overflow-hidden bg-white flex flex-col exam-content">
        <ExamHeader
          title={section.title}
          remainingSeconds={assignment.remainingTime || section.duration * 60}
          sectionType={section.type}
          onTimerExpire={handleTimerExpire}
          autoStart={!showIntroVideo}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
        />

        <div className="flex-1 pt-16 pb-16 min-h-0 flex flex-col">
          <PartBanner
            partNumber={currentPartNumber}
            startQuestion={startQuestion}
            endQuestion={endQuestion}
            type="READING"
          />
          <div className="flex-1 min-h-0">
            <ResizablePanel
              leftPanel={
                <div className="h-full overflow-y-auto">
                  {passages
                    .filter((p, i) => i === activePartIndex)
                    .map((passage) => (
                      <div key={passage.id} className="p-6">
                        <h2 className="text-xl font-bold text-gray-900 mb-4">
                          {passage.title}
                        </h2>
                        <div className="prose prose-gray max-w-none">
                          <HighlightableText
                            content={passage.content.trim()}
                            initialHighlights={[]}
                            onHighlightsChange={() => {
                              // TODO: Persist highlights to backend
                            }}
                          />
                        </div>
                      </div>
                    ))}
                </div>
              }
              rightPanel={
                <div
                  ref={rightPanelRef}
                  className="h-full overflow-y-auto p-6 space-y-4 bg-white"
                >
                  {currentPart && renderQuestionsWithGrouping(
                    questions.filter((q) =>
                      currentPart.questions?.some((pq) => pq.id === q.id)
                    )
                  )}
                </div>
              }
            />
          </div>
        </div>

        {/* Bottom Nav */}
        <BottomNav
          parts={parts}
          activePartIndex={activePartIndex !== -1 ? activePartIndex : 0}
          currentQuestionId={currentQuestionId}
          onQuestionClick={handleQuestionClick}
          onPartClick={handlePartClick}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
        />

        <ReviewModal
          isOpen={isReviewModalOpen}
          onClose={() => setIsReviewModalOpen(false)}
          onConfirm={() => setIsConfirmModalOpen(true)}
          parts={parts}
          answers={answers}
          isLoading={isSubmitting}
        />

        <ConfirmationModal
          isOpen={isConfirmModalOpen}
          onClose={() => setIsConfirmModalOpen(false)}
          onConfirm={handleFinalSubmit}
          title="Finish Section?"
          message="Are you sure you want to finish this section? You will not be able to change your answers after this."
          confirmText="Finish"
          cancelText="Go Back"
          variant="primary"
          isLoading={isSubmitting}
        />

        {/* Intro Video Overlay */}
        {showIntroVideo && assignment?.section && (
          <div
            ref={introContainerRef}
            className="fixed inset-0 bg-black z-200 flex items-center justify-center overflow-hidden"
          >
            <video
              ref={introVideoRef}
              autoPlay
              playsInline
              onEnded={handleVideoEnded}
              onPlay={() => setIsVideoAutoplayBlocked(false)}
              onLoadStart={() =>
                console.log("Video loading:", assignment?.section?.type)
              }
              onCanPlay={() =>
                console.log("Video can play:", assignment?.section?.type)
              }
              className="w-full h-full object-cover"
            >
              <source
                src={`/videos/${assignment.section.type.toLowerCase()}.mp4`}
                type="video/mp4"
              />
              Your browser does not support the video tag.
            </video>
            {isVideoAutoplayBlocked && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-10">
                <button
                  onClick={() => {
                    if (introVideoRef.current) {
                      introVideoRef.current
                        .play()
                        .catch((e) => console.warn("Manual play failed:", e));
                      setIsVideoAutoplayBlocked(false);
                    }
                  }}
                  className="px-8 py-4 bg-white text-black rounded-full font-bold flex items-center gap-2 hover:bg-gray-100 transition-all scale-110 shadow-2xl"
                >
                  <svg
                    className="w-6 h-6"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                  </svg>
                  Play Introduction
                </button>
                <p className="text-white/60 mt-4 text-sm font-medium">
                  Sound is required for this introduction
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Writing Section Layout
  if (section.type === "WRITING") {
    const questions = section.questions as Question[];
    // Use activePartIndex (which corresponds to Task index 0 or 1) to determine active question
    const activeQuestionIndex =
      activePartIndex < questions.length ? activePartIndex : 0;
    const activeQuestion = questions[activeQuestionIndex];
    const writingAnswer = (answers[activeQuestion.id] || "") as string;

    const instructionLines = activeQuestion.instruction
      ? activeQuestion.instruction
          .replace(/Write at least\s*\**\d+\s*words\**\.?/gi, "")
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0)
      : [];

    // Parse min words from instruction or default
    const minWords = activeQuestion.instruction?.match(/(\d+)\s*words/i)?.[1]
      ? parseInt(activeQuestion.instruction.match(/(\d+)\s*words/i)![1])
      : 150;

    // Determine banner instruction based on Task
    const bannerInstruction =
      activeQuestionIndex === 0
        ? "You should spend about 20 minutes on this task. Write at least 150 words."
        : "You should spend about 40 minutes on this task. Write at least 250 words.";

    return (
      <div className="h-screen overflow-hidden bg-white flex flex-col exam-content">
        <div className="h-16 shrink-0">
          <ExamHeader
            title={section.title}
            remainingSeconds={assignment.remainingTime || section.duration * 60}
            sectionType="WRITING"
            onTimerExpire={handleTimerExpire}
            autoStart={!showIntroVideo}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />
        </div>

        <PartBanner
          partNumber={activeQuestionIndex + 1}
          startQuestion={activeQuestionIndex + 1}
          endQuestion={activeQuestionIndex + 1}
          type="WRITING"
          instruction={bannerInstruction}
        />

        <div className="flex-1 pb-16 min-h-0">
          <ResizablePanel
            leftPanel={
              <div className="h-full overflow-y-auto p-6">
                <div className="prose prose-gray max-w-none">
                  <p className="font-bold text-black text-base mb-4">
                    {activeQuestion.questionText}
                  </p>
                  {activeQuestion.imageUrl && (
                    <img
                      src={activeQuestion.imageUrl}
                      alt="Task Image"
                      className="w-full h-auto mb-6 border border-gray-200 rounded-lg bg-white"
                    />
                  )}
                  {instructionLines.map((line, idx) => (
                    <p
                      key={idx}
                      className={`text-black text-base ${
                        idx === 0 ? "font-bold" : ""
                      } mb-4`}
                      dangerouslySetInnerHTML={{
                        __html: line.replace(
                          /\*\*(.*?)\*\*/g,
                          "<strong>$1</strong>"
                        ),
                      }}
                    />
                  ))}
                </div>
              </div>
            }
            rightPanel={
              <WritingTask
                id={activeQuestion.id}
                taskDescription={activeQuestion.questionText}
                value={writingAnswer}
                onChange={(v) => handleAnswerChange(activeQuestion.id, v)}
                minWords={minWords}
                onFocus={() => setCurrentQuestionId(activeQuestion.id)}
              />
            }
          />
        </div>

        {/* Bottom Nav */}
        <BottomNav
          parts={parts}
          activePartIndex={activePartIndex !== -1 ? activePartIndex : 0}
          currentQuestionId={currentQuestionId}
          onQuestionClick={handleQuestionClick}
          onPartClick={handlePartClick}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          sectionType="WRITING"
        />

        {/* Intro Video Overlay */}
        {showIntroVideo && assignment?.section && (
          <div
            ref={introContainerRef}
            className="fixed inset-0 bg-black z-200 flex items-center justify-center overflow-hidden"
          >
            <video
              ref={introVideoRef}
              autoPlay
              playsInline
              onEnded={handleVideoEnded}
              onPlay={() => setIsVideoAutoplayBlocked(false)}
              onLoadStart={() =>
                console.log("Video loading:", assignment?.section?.type)
              }
              onCanPlay={() =>
                console.log("Video can play:", assignment?.section?.type)
              }
              className="w-full h-full object-cover"
            >
              <source
                src={`/videos/${assignment.section.type.toLowerCase()}.mp4`}
                type="video/mp4"
              />
              Your browser does not support the video tag.
            </video>
            {isVideoAutoplayBlocked && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-10">
                <button
                  onClick={() => {
                    if (introVideoRef.current) {
                      introVideoRef.current
                        .play()
                        .catch((e) => console.warn("Manual play failed:", e));
                      setIsVideoAutoplayBlocked(false);
                    }
                  }}
                  className="px-8 py-4 bg-white text-black rounded-full font-bold flex items-center gap-2 hover:bg-gray-100 transition-all scale-110 shadow-2xl"
                >
                  <svg
                    className="w-6 h-6"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                  </svg>
                  Play Introduction
                </button>
                <p className="text-white/60 mt-4 text-sm font-medium">
                  Sound is required for this introduction
                </p>
              </div>
            )}
          </div>
        )}
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
        />
      </div>
    );
  }

  // Listening Section Layout (similar to Reading but with audio)
  return (
    <div
      className="h-screen overflow-hidden bg-white flex flex-col notranslate exam-content"
      translate="no"
    >
      <div className="h-16 shrink-0">
        <ExamHeader
          title={section.title}
          remainingSeconds={assignment.remainingTime || section.duration * 60}
          sectionType="LISTENING"
          isAudioPlaying={isAudioPlaying}
          autoStart={!showIntroVideo && !showPlayOverlay}
          onTimerExpire={handleTimerExpire}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />
      </div>

      <PartBanner
        partNumber={currentPartNumber}
        startQuestion={startQuestion}
        endQuestion={endQuestion}
        type="LISTENING"
      />

      <div className="flex-1 pb-20 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-2 space-y-2">
          {/* Hidden Audio Element */}
          {section.audioUrl && (
            <audio
              ref={audioRef}
              src={
                section.audioUrl.startsWith("http")
                  ? section.audioUrl
                  : `${API_BASE_URL}${
                      section.audioUrl.startsWith("/") ? "" : "/"
                    }${section.audioUrl}`
              }
              onPause={() => setIsAudioPlaying(false)}
              onPlay={() => setIsAudioPlaying(true)}
              onError={(e) => {
                const target = e.target as HTMLAudioElement;
                console.error("Audio Error:", target.error);
                setAudioError(
                  "Failed to load audio source. Please check your connection or contact support."
                );
              }}
              className="hidden"
            />
          )}

          {/* filtered questions */}
          <div className="space-y-0">
            {currentPart && renderQuestionsWithGrouping(
              questions.filter((q) =>
                currentPart.questions?.some((pq) => pq.id === q.id)
              )
            )}
          </div>
        </div>
      </div>

      {/* Audio Play Overlay - Moved to top level for full coverage */}
      {showPlayOverlay && (
        <div className="fixed inset-0 bg-[#333333] z-100 flex flex-col items-center justify-center text-white px-8 text-center overflow-hidden">
          <div className="w-32 h-32 mb-8 text-white opacity-90">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
              <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
            </svg>
          </div>

          <div className="max-w-2xl space-y-6">
            <h2 className="text-3xl font-bold mb-4">Listening Test</h2>

            {audioError ? (
              <div className="bg-red-900/40 border border-red-500 rounded-xl p-6 text-red-200">
                <p className="font-bold mb-2">Technical Error</p>
                <p>{audioError}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="mt-4 px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : (
              <>
                <p className="text-xl font-medium leading-relaxed">
                  You will be listening to an audio clip during this test. You
                  will not be permitted to pause or rewind the audio while
                  answering the questions.
                </p>
                <p className="text-lg text-gray-300">
                  To continue, click Play.
                </p>

                <button
                  onClick={() => {
                    if (audioRef.current) {
                      audioRef.current
                        .play()
                        .then(() => {
                          setShowPlayOverlay(false);
                          handleStartExam();
                        })
                        .catch((err) => {
                          console.error("Play failed:", err);
                          setAudioError(
                            "Could not start audio playback. The source may be unsupported or restricted."
                          );
                        });
                    }
                  }}
                  className="mt-8 px-8 py-3 bg-black border border-white/20 rounded-lg flex items-center gap-3 hover:bg-gray-800 transition-all font-bold text-lg mx-auto group shadow-2xl"
                >
                  <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center group-hover:scale-110 transition-transform">
                    <svg
                      className="w-5 h-5 text-black ml-0.5"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                    </svg>
                  </div>
                  Play
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Bottom Nav */}
      <BottomNav
        parts={parts}
        activePartIndex={activePartIndex !== -1 ? activePartIndex : 0}
        currentQuestionId={currentQuestionId}
        onQuestionClick={handleQuestionClick}
        onPartClick={handlePartClick}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />

      <ReviewModal
        isOpen={isReviewModalOpen}
        onClose={() => setIsReviewModalOpen(false)}
        onConfirm={() => setIsConfirmModalOpen(true)}
        parts={parts}
        answers={answers}
        isLoading={isSubmitting}
      />

      <ConfirmationModal
        isOpen={isConfirmModalOpen}
        onClose={() => setIsConfirmModalOpen(false)}
        onConfirm={handleFinalSubmit}
        title="Finish Section?"
        message="Are you sure you want to finish this section? You will not be able to change your answers after this."
        confirmText="Finish"
        cancelText="Go Back"
        variant="primary"
        isLoading={isSubmitting}
      />

      {/* Intro Video Overlay */}
      {showIntroVideo && assignment?.section && (
        <div
          ref={introContainerRef}
          className="fixed inset-0 bg-black z-200 flex items-center justify-center overflow-hidden"
        >
          <video
            ref={introVideoRef}
            autoPlay
            playsInline
            onEnded={handleVideoEnded}
            onPlay={() => setIsVideoAutoplayBlocked(false)}
            onLoadStart={() =>
              console.log("Video loading:", assignment?.section?.type)
            }
            onCanPlay={() =>
              console.log("Video can play:", assignment?.section?.type)
            }
            className="w-full h-full object-cover"
          >
            <source
              src={`/videos/${assignment.section.type.toLowerCase()}.mp4`}
              type="video/mp4"
            />
            Your browser does not support the video tag.
          </video>
          {isVideoAutoplayBlocked && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-10">
              <button
                onClick={() => {
                  if (introVideoRef.current) {
                    introVideoRef.current.play();
                    setIsVideoAutoplayBlocked(false);
                  }
                }}
                className="px-8 py-4 bg-white text-black rounded-full font-bold flex items-center gap-2 hover:bg-gray-100 transition-all scale-110 shadow-2xl"
              >
                <svg
                  className="w-6 h-6"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                </svg>
                Play Introduction
              </button>
              <p className="text-white/60 mt-4 text-sm font-medium">
                Sound is required for this introduction
              </p>
            </div>
          )}
        </div>
      )}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}

export default function ExamPage() {
  const params = useParams();
  const assignmentId = params.id as string;

  if (!assignmentId) return null;

  return <ExamContent key={assignmentId} assignmentId={assignmentId} />;
}
