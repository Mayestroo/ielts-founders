"use client";

import { ImportModal } from "@/components/exam/ImportModal";
import {
    Button,
    Card,
    CardBody,
    CardHeader,
    Input,
    MultiSelectCheckbox,
    Modal,
    Select,
} from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { ADMIN_QUERY_TIMINGS } from "@/lib/query/config";
import { adminQueryKeys } from "@/lib/query/keys";
import {
    Center,
    CreateExamSectionForm,
    ExamSectionType,
    FlowChartData,
    MatchItem,
    Passage,
    Question,
    QuestionType,
    TableData,
} from "@/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const questionTypes: {
  value: QuestionType;
  label: string;
  category: string;
}[] = [
  { value: "MCQ_SINGLE", label: "Multiple Choice (Single)", category: "MCQ" },
  {
    value: "MCQ_MULTIPLE",
    label: "Multiple Choice (Multiple)",
    category: "MCQ",
  },
  {
    value: "TRUE_FALSE_NOT_GIVEN",
    label: "True/False/Not Given",
    category: "Identification",
  },
  {
    value: "YES_NO_NOT_GIVEN",
    label: "Yes/No/Not Given",
    category: "Identification",
  },
  { value: "FILL_BLANK", label: "Fill in the Blank", category: "Completion" },
  { value: "SHORT_ANSWER", label: "Short Answer", category: "Completion" },
  {
    value: "SENTENCE_COMPLETION",
    label: "Sentence Completion",
    category: "Completion",
  },
  {
    value: "SUMMARY_COMPLETION",
    label: "Summary Completion",
    category: "Completion",
  },
  {
    value: "NOTE_COMPLETION",
    label: "Note Completion",
    category: "Completion",
  },
  {
    value: "TABLE_COMPLETION",
    label: "Table Completion",
    category: "Completion",
  },
  {
    value: "FLOW_CHART_COMPLETION",
    label: "Flow Chart Completion",
    category: "Completion",
  },
  {
    value: "FORM_COMPLETION",
    label: "Form Completion",
    category: "Completion",
  },
  { value: "MATCHING", label: "Matching", category: "Matching" },
  { value: "DIAGRAM_LABELING", label: "Diagram Labeling", category: "Visual" },
  {
    value: "PLAN_MAP_LABELING",
    label: "Plan/Map Labeling",
    category: "Visual",
  },
];

type QuestionWithAdvancedFields = Question & {
  title?: string;
  questionRange?: string;
  isInSameLine?: boolean;
  questionsLabel?: string;
  optionsLabel?: string;
  tableData?: TableData;
  flowchartData?: FlowChartData;
  items?: MatchItem[];
  matchOptions?: MatchItem[];
  correctAnswer?: Record<string, string> | string;
};

const emptyTableData: TableData = {
  headers: [],
  rows: [],
};

const emptyFlowchartData: FlowChartData = {
  steps: [],
};

const resolveAudioSourceUrl = (audioUrl: string): string => {
  const trimmed = audioUrl.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("http")) {
    return trimmed;
  }

  const baseUrl = (
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api"
  ).replace("/api", "");

  return `${baseUrl}${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
};

const readAudioDurationMinutes = async (
  audioUrl: string,
): Promise<number | null> => {
  const source = resolveAudioSourceUrl(audioUrl);
  if (!source) {
    return null;
  }

  return new Promise((resolve) => {
    const audio = new Audio();

    const cleanup = () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("error", handleError);
      audio.src = "";
    };

    const handleLoadedMetadata = () => {
      const duration = Number.isFinite(audio.duration)
        ? Math.ceil(audio.duration / 60)
        : 0;
      cleanup();
      resolve(duration > 0 ? duration : null);
    };

    const handleError = () => {
      cleanup();
      resolve(null);
    };

    audio.preload = "metadata";
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("error", handleError);
    audio.src = source;
  });
};

export default function EditExamPage() {
  const router = useRouter();
  const params = useParams<{ id: string | string[] }>();
  const sectionId = Array.isArray(params.id) ? params.id[0] : params.id;
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [tableDataDrafts, setTableDataDrafts] = useState<Record<string, string>>({});
  const [flowchartDataDrafts, setFlowchartDataDrafts] = useState<Record<string, string>>({});
  const { user } = useAuth();

  const [formData, setFormData] = useState({
    title: "",
    type: "READING" as ExamSectionType,
    description: "",
    duration: 60,
    audioUrl: "",
    centerId: "",
  });
  const [selectedCenterIds, setSelectedCenterIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [passages, setPassages] = useState<Passage[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);

  const sectionQuery = useQuery({
    queryKey: sectionId
      ? adminQueryKeys.examSection(sectionId)
      : ["admin", "exam-sections", "edit-empty"],
    queryFn: ({ signal }) => api.getExamSection(sectionId!, { signal }),
    enabled: Boolean(sectionId),
    staleTime: ADMIN_QUERY_TIMINGS.reference.staleTime,
    gcTime: ADMIN_QUERY_TIMINGS.reference.gcTime,
  });

  const centersQuery = useQuery<Center[]>({
    queryKey: adminQueryKeys.centers(),
    queryFn: ({ signal }) => api.getCenters({ signal }),
    staleTime: ADMIN_QUERY_TIMINGS.reference.staleTime,
    gcTime: ADMIN_QUERY_TIMINGS.reference.gcTime,
    enabled: user?.role === "SUPER_ADMIN",
  });

  const updateExamMutation = useMutation({
    mutationFn: (payload: { id: string; data: Partial<CreateExamSectionForm> }) =>
      api.updateExamSection(payload.id, payload.data),
  });

  const centers = centersQuery.data ?? [];
  const isLoading = sectionQuery.isLoading && !sectionQuery.data;

  useEffect(() => {
    if (!sectionQuery.data) {
      return;
    }

    setFormData({
      title: sectionQuery.data.title,
      type: sectionQuery.data.type,
      description: sectionQuery.data.description || "",
      duration: sectionQuery.data.duration,
      audioUrl: sectionQuery.data.audioUrl || "",
      centerId: sectionQuery.data.centerId,
    });
    setSelectedCenterIds([sectionQuery.data.centerId]);
    setQuestions(sectionQuery.data.questions || []);
    setPassages(sectionQuery.data.passages || []);
    setTableDataDrafts({});
    setFlowchartDataDrafts({});
  }, [sectionQuery.data]);

  useEffect(() => {
    if (!sectionQuery.error) {
      return;
    }

    setError(
      sectionQuery.error instanceof Error
        ? sectionQuery.error.message
        : "Failed to load exam section",
    );
  }, [sectionQuery.error]);

  // Auto-calculate duration for Listening exams
  useEffect(() => {
    if (formData.type === "LISTENING" && formData.audioUrl) {
      const calculateDuration = async () => {
        try {
          const minutes = await readAudioDurationMinutes(formData.audioUrl);
          if (!minutes) {
            return;
          }

          const totalDuration = minutes + 2;
          setFormData((prev) =>
            prev.duration === totalDuration
              ? prev
              : { ...prev, duration: totalDuration }
          );
        } catch (err) {
          console.error("Error calculating audio duration:", err);
        }
      };
      calculateDuration();
    }
  }, [formData.audioUrl, formData.type]);

  useEffect(() => {
    if (!centersQuery.error) {
      return;
    }

    setError(
      centersQuery.error instanceof Error
        ? centersQuery.error.message
        : "Failed to load centers",
    );
  }, [centersQuery.error]);

  useEffect(() => {
    if (formData.type !== "SPEAKING" || questions.length > 0) {
      return;
    }

    setQuestions([
      {
        id: "s1",
        type: "SHORT_ANSWER",
        questionText: "Part 1: Personal introduction and familiar topics.",
        points: 3,
        instruction:
          "Answer briefly and naturally about yourself, your studies, and daily routines.",
      } as Question,
      {
        id: "s2",
        type: "SHORT_ANSWER",
        questionText: "Part 2: Individual long turn.",
        points: 3,
        instruction:
          "Speak for 1-2 minutes on the cue card topic with clear examples.",
      } as Question,
      {
        id: "s3",
        type: "SHORT_ANSWER",
        questionText: "Part 3: Discussion and abstract questions.",
        points: 3,
        instruction:
          "Discuss broader ideas related to Part 2 and justify your opinions.",
      } as Question,
    ]);
  }, [formData.type, questions.length]);

  // Add passage (for Reading)
  const addPassage = () => {
    const newPassage: Passage = {
      id: `passage-${Date.now()}`,
      title: `Passage ${passages.length + 1}`,
      content: "",
    };
    setPassages([...passages, newPassage]);
  };

  const updatePassage = (id: string, field: keyof Passage, value: string) => {
    setPassages(
      passages.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  };

  const removePassage = (id: string) => {
    setPassages(passages.filter((p) => p.id !== id));
    setQuestions(questions.filter((q) => q.passageId !== id));
  };

  // Add question
  const addQuestion = (type: QuestionType) => {
    const baseQuestion = {
      id: `q-${Date.now()}`,
      number: questions.length + 1,
      type,
      questionText: "",
      passageId: passages[0]?.id || "",
      points: 1,
      instruction: "",
    };

    let newQuestion: Question;

    switch (type) {
      case "MCQ_SINGLE":
      case "MCQ_MULTIPLE":
        newQuestion = {
          ...baseQuestion,
          type,
          options: [
            { id: "a", text: "" },
            { id: "b", text: "" },
            { id: "c", text: "" },
            { id: "d", text: "" },
          ],
          correctAnswer: type === "MCQ_SINGLE" ? "" : [],
        };
        break;
      case "TRUE_FALSE_NOT_GIVEN":
      case "YES_NO_NOT_GIVEN":
        newQuestion = {
          ...baseQuestion,
          type,
          correctAnswer: "TRUE" as const,
        };
        break;
      case "MATCHING":
      case "DIAGRAM_LABELING":
      case "PLAN_MAP_LABELING":
        newQuestion = {
          ...baseQuestion,
          type,
          items: [{ id: "item1", text: "" }],
          matchOptions: [{ id: "opt1", text: "" }],
          correctAnswer: {},
        };
        break;
      default:
        newQuestion = {
          ...baseQuestion,
          type,
          correctAnswer: "",
          wordLimit: 3,
        } as Question;
    }

    setQuestions((prev) => [...prev, newQuestion]);
  };

  const updateQuestion = (
    id: string,
    updates: Partial<Question> & Record<string, unknown>
  ) => {
    setQuestions((prev) =>
      prev.map((q) =>
        q.id === id ? ({ ...q, ...updates } as Question) : q
      )
    );
  };

  const removeQuestion = (id: string) => {
    setQuestions((prev) => prev.filter((q) => q.id !== id));
    setTableDataDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setFlowchartDataDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const applyStructuredJsonField = (
    questionId: string,
    field: "tableData" | "flowchartData",
    rawValue: string
  ) => {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      updateQuestion(questionId, {
        [field]: undefined,
      } as Partial<Question> & Record<string, unknown>);
      setError("");
      return;
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("JSON must be an object");
      }

      updateQuestion(questionId, {
        [field]: parsed,
      } as Partial<Question> & Record<string, unknown>);
      setError("");
    } catch {
      setError(`Invalid ${field} JSON for question ${questionId}`);
    }
  };

  const createMatchId = (prefix: "item" | "opt") =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const toMatchingAnswerMap = (
    value: Record<string, string> | string | undefined
  ): Record<string, string> => {
    if (!value || typeof value === "string" || Array.isArray(value)) {
      return {};
    }

    return value;
  };

  const addMatchingItem = (question: QuestionWithAdvancedFields) => {
    const nextItems: MatchItem[] = [
      ...(question.items || []),
      { id: createMatchId("item"), text: "" },
    ];
    updateQuestion(question.id, { items: nextItems });
  };

  const addMatchingOption = (question: QuestionWithAdvancedFields) => {
    const nextOptions: MatchItem[] = [
      ...(question.matchOptions || []),
      { id: createMatchId("opt"), text: "" },
    ];
    updateQuestion(question.id, { matchOptions: nextOptions });
  };

  const updateMatchingCorrectAnswer = (
    question: QuestionWithAdvancedFields,
    itemId: string,
    optionId: string
  ) => {
    const answerMap = toMatchingAnswerMap(question.correctAnswer);
    const nextMap: Record<string, string> = { ...answerMap };
    if (!optionId) {
      delete nextMap[itemId];
    } else {
      nextMap[itemId] = optionId;
    }
    updateQuestion(question.id, { correctAnswer: nextMap });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!sectionId) {
      setError("Missing exam section id");
      return;
    }

    setIsSubmitting(true);

    try {
      const basePayload: CreateExamSectionForm = {
        title: formData.title,
        type: formData.type,
        description: formData.description,
        duration: formData.duration,
        questions,
        passages: formData.type === "READING" ? passages : undefined,
        ...(formData.audioUrl ? { audioUrl: formData.audioUrl } : {}),
      };
      const submissionData: Partial<CreateExamSectionForm> = {
        ...basePayload,
      };

      if (user?.role === "SUPER_ADMIN") {
        const uniqueCenterIds = Array.from(
          new Set(selectedCenterIds.filter((centerId) => centerId.trim().length > 0))
        );

        if (uniqueCenterIds.length === 0) {
          setError("Please select at least one center");
          return;
        }

        const currentCenterId = sectionQuery.data?.centerId || formData.centerId;
        const primaryCenterId = uniqueCenterIds.includes(currentCenterId)
          ? currentCenterId
          : uniqueCenterIds[0];
        const additionalCenterIds = uniqueCenterIds.filter(
          (centerId) => centerId !== primaryCenterId
        );

        submissionData.centerId = primaryCenterId;

        await updateExamMutation.mutateAsync({
          id: sectionId,
          data: submissionData,
        });

        if (additionalCenterIds.length > 0) {
          await Promise.all(
            additionalCenterIds.map((centerId) =>
              api.createExamSection({
                ...basePayload,
                centerId,
              })
            )
          );
        }
      } else {
        await updateExamMutation.mutateAsync({
          id: sectionId,
          data: submissionData,
        });
      }

      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.examSections() });
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.examSection(sectionId) });
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.examSectionOptions() });
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.dashboardStats() });

      router.push("/dashboard/exams");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update exam section"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleImport = (data: CreateExamSectionForm) => {
    const importedPayload = data as CreateExamSectionForm & {
      centerIds?: string[];
    };
    const importedCenterIds = Array.isArray(importedPayload.centerIds)
      ? importedPayload.centerIds.filter(
          (centerId): centerId is string =>
            typeof centerId === "string" && centerId.trim().length > 0
        )
      : data.centerId
        ? [data.centerId]
        : [];

    setFormData({
      title: data.title || "",
      type: data.type || "READING",
      description: data.description || "",
      duration: data.duration || 60,
      audioUrl: data.audioUrl || "",
      centerId: importedCenterIds[0] || "",
    });
    setQuestions(data.questions || []);
    setPassages(data.passages || []);
    setSelectedCenterIds(importedCenterIds);
    setTableDataDrafts({});
    setFlowchartDataDrafts({});
  };

  const handleFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    target: "audio" | "writing-image" | "question-image" | "part-audio",
    questionId?: string
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadProgress(0);
    setError("");

    try {
      const { url } = await api.uploadFile(file, (percent) => {
        setUploadProgress(percent);
      });
      if (target === "audio") {
        setFormData({ ...formData, audioUrl: url });
      } else if (target === "part-audio" && questionId) {
        const detectedDuration = await readAudioDurationMinutes(url);
        const existingQuestion = questions.find(
          (question) => question.id === questionId,
        ) as QuestionWithAdvancedFields | undefined;
        updateQuestion(questionId, {
          partAudioUrl: url,
          partDurationMinutes:
            detectedDuration ?? existingQuestion?.partDurationMinutes,
        });
      } else if ((target === "writing-image" || target === "question-image") && questionId) {
        updateQuestion(questionId, { imageUrl: url });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "File upload failed");
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      // Reset input
      e.target.value = "";
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-slate-400"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
            Edit Exam Section
          </h1>
          <p className="text-slate-500 mt-1">Modify existing IELTS exam section</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setIsImportModalOpen(true)}
        >
          Quick Import
        </Button>
      </div>

      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImport={handleImport}
      />

      <Modal 
        isOpen={isUploading && uploadProgress > 0} 
        onClose={() => {}} 
        title="Uploading File..."
      >
        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-slate-500">Please wait while the file is being uploaded</span>
            <span className="font-medium text-slate-900">{uploadProgress}%</span>
          </div>
          <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5">
            <div 
              className="bg-slate-900 h-2.5 rounded-full transition-all duration-300" 
              style={{ width: `${uploadProgress}%` }}
            ></div>
          </div>
          <p className="text-xs text-center text-slate-400 mt-4">
            For large audio files, this may take a moment. Do not close this page.
          </p>
        </div>
      </Modal>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="p-4 rounded-lg bg-red-500/20 text-red-400">
            {error}
          </div>
        )}

        {/* Basic Info */}
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Basic Information
            </h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <Input
              label="Title"
              placeholder="e.g., Academic Reading Test 1"
              value={formData.title}
              onChange={(e) =>
                setFormData({ ...formData, title: e.target.value })
              }
              required
            />

            <div className="grid grid-cols-2 gap-4">
              <Select
                label="Section Type"
                options={[
                  { value: "READING", label: "Reading" },
                  { value: "LISTENING", label: "Listening" },
                  { value: "WRITING", label: "Writing" },
                  { value: "SPEAKING", label: "Speaking" },
                ]}
                value={formData.type}
                onChange={(e) => {
                  const newType = e.target.value as ExamSectionType;
                  setFormData({ ...formData, type: newType });
                  // We don't necessarily want to wipe everything on edit, but if they change type it's a major change
                  if (
                    confirm(
                      "Changing the section type will reset questions and passages. Continue?"
                    )
                  ) {
                    setQuestions([]);
                    setPassages([]);
                  }
                }}
              />

              <Input
                label="Duration (minutes)"
                type="number"
                min={1}
                value={formData.duration}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    duration: parseInt(e.target.value) || 60,
                  })
                }
                required
              />
            </div>

            <Input
              label="Description"
              placeholder="Brief description of this section"
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
            />

            {formData.type === "LISTENING" && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Audio URL / Upload
                </label>
                <div className="flex gap-2">
                  <Input
                    placeholder="https://example.com/audio.mp3"
                    value={formData.audioUrl}
                    onChange={(e) =>
                      setFormData({ ...formData, audioUrl: e.target.value })
                    }
                    required
                    className="flex-1"
                  />
                  <input
                    type="file"
                    id="audio-upload"
                    className="hidden"
                    accept="audio/*"
                    onChange={(e) => handleFileUpload(e, "audio")}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      document.getElementById("audio-upload")?.click()
                    }
                    className="shrink-0"
                  >
                    Upload Audio
                  </Button>
                </div>
              </div>
            )}

            {user?.role === "SUPER_ADMIN" && (
              <MultiSelectCheckbox
                id="assigned-centers"
                label="Assigned Centers"
                options={centers.map((center) => ({
                  value: center.id,
                  label: center.name,
                }))}
                value={selectedCenterIds}
                onChange={(nextCenterIds) => {
                  setSelectedCenterIds(nextCenterIds);
                  setFormData((prev) => ({
                    ...prev,
                    centerId: nextCenterIds[0] || "",
                  }));
                }}
              />
            )}
          </CardBody>
        </Card>

        {/* Specialized Content for Writing */}
        {formData.type === "WRITING" ? (
          <div className="space-y-6">
            {(questions.length > 0
              ? questions
              : ([
                  {
                    id: "w1",
                    type: "SHORT_ANSWER",
                    questionText: "",
                    points: 3,
                    instruction: "Write at least 150 words.",
                  },
                  {
                    id: "w2",
                    type: "SHORT_ANSWER",
                    questionText: "",
                    points: 6,
                    instruction: "Write at least 250 words.",
                  },
                ] as Question[])
            ).map((task, idx) => (
              <Card key={task.id || idx}>
                <CardHeader>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                    Task {idx + 1}
                  </h2>
                </CardHeader>
                <CardBody className="space-y-4">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                      Task Prompt (Question Text)
                    </label>
                    <textarea
                      placeholder="Enter the task description or prompt here..."
                      className="w-full h-32 px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 resize-none focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
                      value={task.questionText}
                      onChange={(e) =>
                        updateQuestion(task.id, {
                          questionText: e.target.value,
                        })
                      }
                      required
                    />
                  </div>
                  {idx === 0 && (
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                        Image URL / Upload
                      </label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="https://example.com/chart.png"
                          value={task.imageUrl || ""}
                          onChange={(e) =>
                            updateQuestion(task.id, {
                              imageUrl: e.target.value,
                            })
                          }
                          className="flex-1"
                          required
                        />
                        <input
                          type="file"
                          id={`image-upload-${task.id}`}
                          className="hidden"
                          accept="image/*"
                          onChange={(e) =>
                            handleFileUpload(e, "writing-image", task.id)
                          }
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() =>
                            document
                              .getElementById(`image-upload-${task.id}`)
                              ?.click()
                          }
                          className="shrink-0"
                        >
                          Upload Image
                        </Button>
                      </div>
                    </div>
                  )}
                  <Input
                    label="Instructions (e.g., Write at least 150 words)"
                    value={task.instruction || ""}
                    onChange={(e) =>
                      updateQuestion(task.id, { instruction: e.target.value })
                    }
                    required
                  />
                  <Input
                    label="Points / Weight"
                    type="number"
                    value={task.points}
                    onChange={(e) =>
                      updateQuestion(task.id, {
                        points: parseInt(e.target.value) || 0,
                      })
                    }
                    required
                  />
                </CardBody>
              </Card>
            ))}
          </div>
        ) : (
          <>
            {/* Passages (Reading only) */}
            {formData.type === "READING" && (
              <Card>
                <CardHeader className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                    Passages
                  </h2>
                  <Button type="button" size="sm" onClick={addPassage}>
                    Add Passage
                  </Button>
                </CardHeader>
                <CardBody className="space-y-4">
                  {passages.length === 0 ? (
                    <p className="text-slate-500 text-center py-4">
                      No passages added. Click &quot;Add Passage&quot; to start.
                    </p>
                  ) : (
                    passages.map((passage, index) => (
                      <div
                        key={passage.id}
                        className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <h3 className="font-medium text-slate-900 dark:text-white">
                            Passage {index + 1}
                          </h3>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removePassage(passage.id)}
                          >
                            Remove
                          </Button>
                        </div>
                        <Input
                          placeholder="Passage title"
                          value={passage.title}
                          onChange={(e) =>
                            updatePassage(passage.id, "title", e.target.value)
                          }
                        />
                        <textarea
                          placeholder="Paste passage content here..."
                          className="w-full h-40 px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 resize-none focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
                          value={passage.content}
                          onChange={(e) =>
                            updatePassage(passage.id, "content", e.target.value)
                          }
                        />
                      </div>
                    ))
                  )}
                </CardBody>
              </Card>
            )}

            {/* Questions (Listening/Reading) */}
            <Card>
              <CardHeader className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                  Questions ({questions.length})
                </h2>
                <Select
                  placeholder="Add question type..."
                  options={questionTypes.map((qt) => ({
                    value: qt.value,
                    label: `${qt.category}: ${qt.label}`,
                  }))}
                  onChange={(e) => {
                    if (e.target.value) {
                      addQuestion(e.target.value as QuestionType);
                      e.target.value = "";
                    }
                  }}
                  className="w-64"
                />
              </CardHeader>
              <CardBody className="space-y-4">
                {questions.length === 0 ? (
                  <p className="text-slate-500 text-center py-8">
                    No questions added. Select a question type above to start.
                  </p>
                ) : (
                  questions.map((question, index) => {
                    const questionWithAdvanced =
                      question as QuestionWithAdvancedFields;
                    const matchingAnswerMap = toMatchingAnswerMap(
                      questionWithAdvanced.correctAnswer
                    );
                    const tableDraft =
                      tableDataDrafts[question.id] ??
                      JSON.stringify(
                        questionWithAdvanced.tableData || emptyTableData,
                        null,
                        2
                      );
                    const flowchartDraft =
                      flowchartDataDrafts[question.id] ??
                      JSON.stringify(
                        questionWithAdvanced.flowchartData ||
                          emptyFlowchartData,
                        null,
                        2
                      );

                    return (
                    <div
                      key={question.id || index}
                      className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-200 text-sm font-medium">
                            {index + 1}
                          </span>
                          <span className="text-sm font-medium text-slate-500">
                            {question.type?.replace(/_/g, " ")}
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeQuestion(question.id)}
                        >
                          Remove
                        </Button>
                      </div>

                      <Input
                        placeholder="Question text"
                        value={question.questionText}
                        onChange={(e) =>
                          updateQuestion(question.id, {
                            questionText: e.target.value,
                          })
                        }
                      />

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Input
                          label="Question Number"
                          type="number"
                          min={1}
                          value={questionWithAdvanced.number ?? ""}
                          onChange={(e) => {
                            const parsed = Number.parseInt(e.target.value, 10);
                            updateQuestion(question.id, {
                              number: Number.isFinite(parsed) ? parsed : undefined,
                            });
                          }}
                        />
                        <Input
                          label="Question Title (optional)"
                          placeholder="e.g., Poppy Reserve"
                          value={questionWithAdvanced.title || ""}
                          onChange={(e) =>
                            updateQuestion(question.id, {
                              title: e.target.value,
                            })
                          }
                        />
                        <Input
                          label="Question Range (optional)"
                          placeholder="e.g., 1-5"
                          value={questionWithAdvanced.questionRange || ""}
                          onChange={(e) =>
                            updateQuestion(question.id, {
                              questionRange: e.target.value,
                            })
                          }
                        />
                        {formData.type === "LISTENING" && (
                          <div className="space-y-2">
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                              Part Audio URL (optional)
                            </label>
                            <div className="flex gap-2">
                              <Input
                                placeholder="https://.../part1.mp3"
                                value={questionWithAdvanced.partAudioUrl || ""}
                                onChange={(e) =>
                                  updateQuestion(question.id, {
                                    partAudioUrl: e.target.value,
                                  })
                                }
                                className="flex-1"
                              />
                              <input
                                type="file"
                                id={`part-audio-upload-${question.id}`}
                                className="hidden"
                                accept="audio/*"
                                onChange={(e) =>
                                  handleFileUpload(
                                    e,
                                    "part-audio",
                                    question.id
                                  )
                                }
                              />
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={() =>
                                  document
                                    .getElementById(`part-audio-upload-${question.id}`)
                                    ?.click()
                                }
                                className="shrink-0"
                              >
                                Upload Audio
                              </Button>
                            </div>
                            <Input
                              label="Part Duration (minutes)"
                              type="number"
                              min={1}
                              placeholder="Auto-filled from uploaded audio"
                              value={questionWithAdvanced.partDurationMinutes ?? ""}
                              onChange={(e) => {
                                const parsed = Number.parseInt(e.target.value, 10);
                                updateQuestion(question.id, {
                                  partDurationMinutes: Number.isFinite(parsed)
                                    ? parsed
                                    : undefined,
                                });
                              }}
                            />
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                          Instruction (optional)
                        </label>
                        <textarea
                          value={questionWithAdvanced.instruction || ""}
                          onChange={(e) =>
                            updateQuestion(question.id, {
                              instruction: e.target.value,
                            })
                          }
                          rows={3}
                          placeholder="Write ONE WORD ONLY..."
                          className="w-full px-4 py-2.5 rounded-lg border transition-all duration-200 bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
                        />
                      </div>

                      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={Boolean(questionWithAdvanced.isInSameLine)}
                          onChange={(e) =>
                            updateQuestion(question.id, {
                              isInSameLine: e.target.checked,
                            })
                          }
                          className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                        />
                        Render on same line (for combined summary/note lines)
                      </label>

                      {[
                        "MATCHING",
                        "DIAGRAM_LABELING",
                        "PLAN_MAP_LABELING",
                        "FLOW_CHART_COMPLETION",
                      ].includes(question.type) && (
                        <div className="space-y-2">
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                            Image URL / Upload (Optional)
                          </label>
                          <div className="flex gap-2">
                            <Input
                              placeholder="https://example.com/image.png"
                              value={question.imageUrl || ""}
                              onChange={(e) =>
                                updateQuestion(question.id, {
                                  imageUrl: e.target.value,
                                })
                              }
                              className="flex-1"
                            />
                            <input
                              type="file"
                              id={`image-upload-${question.id}`}
                              className="hidden"
                              accept="image/*"
                              onChange={(e) =>
                                handleFileUpload(
                                  e,
                                  "question-image",
                                  question.id
                                )
                              }
                            />
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() =>
                                document
                                  .getElementById(`image-upload-${question.id}`)
                                  ?.click()
                              }
                              className="shrink-0"
                            >
                              Upload Image
                            </Button>
                          </div>
                        </div>
                      )}

                      {[
                        "MATCHING",
                        "DIAGRAM_LABELING",
                        "PLAN_MAP_LABELING",
                      ].includes(question.type) && (
                        <div className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <Input
                              label="Questions Label (optional)"
                              placeholder="Questions"
                              value={questionWithAdvanced.questionsLabel || ""}
                              onChange={(e) =>
                                updateQuestion(question.id, {
                                  questionsLabel: e.target.value,
                                })
                              }
                            />
                            <Input
                              label="Options Label (optional)"
                              placeholder="Options"
                              value={questionWithAdvanced.optionsLabel || ""}
                              onChange={(e) =>
                                updateQuestion(question.id, {
                                  optionsLabel: e.target.value,
                                })
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                                Match Items
                              </p>
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                onClick={() => addMatchingItem(questionWithAdvanced)}
                              >
                                Add Item
                              </Button>
                            </div>
                            {(questionWithAdvanced.items || []).map((item) => (
                              <div key={item.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
                                <Input
                                  className="md:col-span-6"
                                  placeholder="Item text"
                                  value={item.text}
                                  onChange={(e) => {
                                    const nextItems = (questionWithAdvanced.items || []).map(
                                      (entry) =>
                                        entry.id === item.id
                                          ? { ...entry, text: e.target.value }
                                          : entry
                                    );
                                    updateQuestion(question.id, { items: nextItems });
                                  }}
                                />
                                <Select
                                  className="md:col-span-4"
                                  placeholder="Correct option"
                                  options={(questionWithAdvanced.matchOptions || []).map((opt) => ({
                                    value: opt.id,
                                    label: opt.text || opt.id,
                                  }))}
                                  value={matchingAnswerMap[item.id] || ""}
                                  onChange={(e) =>
                                    updateMatchingCorrectAnswer(
                                      questionWithAdvanced,
                                      item.id,
                                      e.target.value
                                    )
                                  }
                                />
                                <Button
                                  type="button"
                                  className="md:col-span-2"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    const nextItems = (questionWithAdvanced.items || []).filter(
                                      (entry) => entry.id !== item.id
                                    );
                                    const nextMap = { ...matchingAnswerMap };
                                    delete nextMap[item.id];
                                    updateQuestion(question.id, {
                                      items: nextItems,
                                      correctAnswer: nextMap,
                                    });
                                  }}
                                >
                                  Remove
                                </Button>
                              </div>
                            ))}
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                                Match Options
                              </p>
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                onClick={() => addMatchingOption(questionWithAdvanced)}
                              >
                                Add Option
                              </Button>
                            </div>
                            {(questionWithAdvanced.matchOptions || []).map((option) => (
                              <div key={option.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
                                <Input
                                  className="md:col-span-10"
                                  placeholder="Option text"
                                  value={option.text}
                                  onChange={(e) => {
                                    const nextOptions =
                                      (questionWithAdvanced.matchOptions || []).map((entry) =>
                                        entry.id === option.id
                                          ? { ...entry, text: e.target.value }
                                          : entry
                                      );
                                    updateQuestion(question.id, {
                                      matchOptions: nextOptions,
                                    });
                                  }}
                                />
                                <Button
                                  type="button"
                                  className="md:col-span-2"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    const nextOptions =
                                      (questionWithAdvanced.matchOptions || []).filter(
                                        (entry) => entry.id !== option.id
                                      );
                                    const nextMap = Object.fromEntries(
                                      Object.entries(matchingAnswerMap).filter(
                                        ([, selectedOptionId]) =>
                                          selectedOptionId !== option.id
                                      )
                                    );
                                    updateQuestion(question.id, {
                                      matchOptions: nextOptions,
                                      correctAnswer: nextMap,
                                    });
                                  }}
                                >
                                  Remove
                                </Button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Render different inputs based on question type */}
                      {(question.type === "MCQ_SINGLE" ||
                        question.type === "MCQ_MULTIPLE") && (
                        <div className="space-y-2">
                          <p className="text-sm text-slate-500">Options:</p>
                          {(question.options || []).map((opt, i) => (
                            <div
                              key={opt.id}
                              className="flex items-center gap-2"
                            >
                              <span className="w-6 text-slate-400 text-sm">
                                {String.fromCharCode(65 + i)}.
                              </span>
                              <Input
                                placeholder={`Option ${String.fromCharCode(
                                  65 + i
                                )}`}
                                value={opt.text}
                                onChange={(e) => {
                                  const newOptions = [
                                    ...(question.options || []),
                                  ];
                                  newOptions[i] = {
                                    ...opt,
                                    text: e.target.value,
                                  };
                                  updateQuestion(question.id, {
                                    options: newOptions,
                                  });
                                }}
                                className="flex-1"
                              />
                            </div>
                          ))}
                          <Input
                            label="Correct Answer"
                            placeholder={
                              question.type === "MCQ_SINGLE"
                                ? "e.g., a"
                                : "e.g., a,c"
                            }
                            value={
                              Array.isArray(question.correctAnswer)
                                ? question.correctAnswer.join(",")
                                : question.correctAnswer
                            }
                            onChange={(e) =>
                              updateQuestion(question.id, {
                                correctAnswer:
                                  question.type === "MCQ_MULTIPLE"
                                    ? e.target.value
                                        .split(",")
                                        .map((s) => s.trim())
                                    : e.target.value,
                              })
                            }
                          />
                        </div>
                      )}

                      {(question.type === "TRUE_FALSE_NOT_GIVEN" ||
                        question.type === "YES_NO_NOT_GIVEN") && (
                        <Select
                          label="Correct Answer"
                          options={
                            question.type === "TRUE_FALSE_NOT_GIVEN"
                              ? [
                                  { value: "TRUE", label: "True" },
                                  { value: "FALSE", label: "False" },
                                  { value: "NOT_GIVEN", label: "Not Given" },
                                ]
                              : [
                                  { value: "YES", label: "Yes" },
                                  { value: "NO", label: "No" },
                                  { value: "NOT_GIVEN", label: "Not Given" },
                                ]
                          }
                          value={question.correctAnswer as string}
                          onChange={(e) =>
                            updateQuestion(question.id, {
                              correctAnswer: e.target.value as
                                | "TRUE"
                                | "FALSE"
                                | "NOT_GIVEN"
                                | "YES"
                                | "NO",
                            })
                          }
                        />
                      )}

                      {(question.type === "FILL_BLANK" ||
                        question.type === "SHORT_ANSWER" ||
                        question.type === "SENTENCE_COMPLETION" ||
                        question.type === "SUMMARY_COMPLETION" ||
                        question.type === "NOTE_COMPLETION" ||
                        question.type === "TABLE_COMPLETION" ||
                        question.type === "FLOW_CHART_COMPLETION" ||
                        question.type === "FORM_COMPLETION") && (
                        <div className="grid grid-cols-2 gap-4">
                          <Input
                            label="Correct Answer"
                            value={question.correctAnswer}
                            onChange={(e) =>
                              updateQuestion(question.id, {
                                correctAnswer: e.target.value,
                              })
                            }
                          />
                          <Input
                            label="Word Limit"
                            type="number"
                            min={1}
                            value={question.wordLimit || 3}
                            onChange={(e) =>
                              updateQuestion(question.id, {
                                wordLimit: parseInt(e.target.value) || 3,
                              })
                            }
                          />
                        </div>
                      )}

                      {question.type === "TABLE_COMPLETION" && (
                        <div className="space-y-2">
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                            Table Data JSON
                          </label>
                          <textarea
                            value={tableDraft}
                            onChange={(e) =>
                              setTableDataDrafts((prev) => ({
                                ...prev,
                                [question.id]: e.target.value,
                              }))
                            }
                            rows={8}
                            className="w-full px-4 py-2.5 rounded-lg border transition-all duration-200 bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 font-mono text-xs focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
                          />
                          <div className="flex justify-end">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                applyStructuredJsonField(
                                  question.id,
                                  "tableData",
                                  tableDraft
                                )
                              }
                            >
                              Apply Table Data
                            </Button>
                          </div>
                        </div>
                      )}

                      {question.type === "FLOW_CHART_COMPLETION" && (
                        <div className="space-y-2">
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                            Flowchart Data JSON
                          </label>
                          <textarea
                            value={flowchartDraft}
                            onChange={(e) =>
                              setFlowchartDataDrafts((prev) => ({
                                ...prev,
                                [question.id]: e.target.value,
                              }))
                            }
                            rows={8}
                            className="w-full px-4 py-2.5 rounded-lg border transition-all duration-200 bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 font-mono text-xs focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
                          />
                          <div className="flex justify-end">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                applyStructuredJsonField(
                                  question.id,
                                  "flowchartData",
                                  flowchartDraft
                                )
                              }
                            >
                              Apply Flowchart Data
                            </Button>
                          </div>
                        </div>
                      )}

                      {formData.type === "READING" && passages.length > 0 && (
                        <Select
                          label="Linked Passage"
                          options={passages.map((p) => ({
                            value: p.id,
                            label: p.title,
                          }))}
                          value={question.passageId || ""}
                          onChange={(e) =>
                            updateQuestion(question.id, {
                              passageId: e.target.value,
                            })
                          }
                        />
                      )}

                      <Input
                        label="Points"
                        type="number"
                        min={1}
                        value={question.points}
                        onChange={(e) =>
                          updateQuestion(question.id, {
                            points: parseInt(e.target.value) || 1,
                          })
                        }
                        className="w-32"
                      />
                    </div>
                    );
                  })
                )}
              </CardBody>
            </Card>
          </>
        )}

        {/* Submit */}
        <div className="flex gap-4 pb-12">
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.back()}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            isLoading={isSubmitting || updateExamMutation.isPending}
            className="flex-1"
          >
            Save Changes
          </Button>
        </div>
      </form>
    </div>
  );
}
