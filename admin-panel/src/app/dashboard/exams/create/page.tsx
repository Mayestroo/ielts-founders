"use client";

import { ImportModal } from "@/components/exam/ImportModal";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Select,
} from "@/components/ui";
import { api } from "@/lib/api";
import {
  CreateExamSectionForm,
  ExamSectionType,
  Passage,
  Question,
  QuestionType,
} from "@/types";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

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

export default function CreateExamPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
        </div>
      }
    >
      <CreateExamContent />
    </Suspense>
  );
}

function CreateExamContent() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  const [formData, setFormData] = useState({
    title: "",
    type: "READING" as ExamSectionType,
    description: "",
    duration: 60,
    audioUrl: "",
  });

  const [passages, setPassages] = useState<Passage[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);

  const searchParams = useSearchParams();
  const typeParam = searchParams.get("type");

  useEffect(() => {
    if (typeParam && ["READING", "LISTENING", "WRITING"].includes(typeParam)) {
      setFormData((prev) => ({ ...prev, type: typeParam as ExamSectionType }));
    }
  }, [typeParam]);

  // Auto-calculate duration for Listening exams
  useEffect(() => {
    if (formData.type === "LISTENING" && formData.audioUrl) {
      const calculateDuration = async () => {
        try {
          const baseUrl = (
            process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api"
          ).replace("/api", "");
          const url = formData.audioUrl.startsWith("http")
            ? formData.audioUrl
            : `${baseUrl}${formData.audioUrl.startsWith("/") ? "" : "/"}${
                formData.audioUrl
              }`;

          const audio = new Audio(url);
          audio.addEventListener("loadedmetadata", () => {
            const minutes = Math.ceil(audio.duration / 60);
            const totalDuration = minutes + 2;
            // Only update if it's different and reasonable
            if (totalDuration > 2 && formData.duration !== totalDuration) {
              setFormData((prev) => ({ ...prev, duration: totalDuration }));
            }
          });
        } catch (err) {
          console.error("Error calculating audio duration:", err);
        }
      };
      calculateDuration();
    }
  }, [formData.audioUrl, formData.type]);

  // Initialize Writing tasks if type is WRITING
  useEffect(() => {
    if (formData.type === "WRITING" && questions.length === 0) {
      setQuestions([
        {
          id: "w1",
          type: "SHORT_ANSWER",
          questionText: "",
          points: 3,
          instruction: "Write at least 150 words.",
        } as any,
        {
          id: "w2",
          type: "SHORT_ANSWER",
          questionText: "",
          points: 6,
          instruction: "Write at least 250 words.",
        } as any,
      ]);
    }
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
      type,
      questionText: "",
      passageId: passages[0]?.id || "",
      points: 1,
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
          type: type as any,
          correctAnswer: "",
          wordLimit: 3,
        };
    }

    setQuestions([...questions, newQuestion]);
  };

  const updateQuestion = (id: string, updates: Partial<Question>) => {
    setQuestions(
      questions.map((q) =>
        q.id === id ? ({ ...q, ...updates } as Question) : q
      )
    );
  };

  const removeQuestion = (id: string) => {
    setQuestions(questions.filter((q) => q.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const submissionData = {
        ...formData,
        questions,
        passages: formData.type === "READING" ? passages : undefined,
      };

      // Remove audioUrl if it's empty or null to avoid validation errors
      if (!submissionData.audioUrl) {
        delete (submissionData as any).audioUrl;
      }

      await api.createExamSection(submissionData);
      router.push("/dashboard/exams");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create exam section"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = (data: CreateExamSectionForm) => {
    setFormData({
      title: data.title || "",
      type: data.type || "READING",
      description: data.description || "",
      duration: data.duration || 60,
      audioUrl: data.audioUrl || "",
    });
    setQuestions(data.questions || []);
    setPassages(data.passages || []);
  };

  const handleFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    target: "audio" | "question-image",
    questionId?: string
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setError("");

    try {
      const { url } = await api.uploadFile(file);
      if (target === "audio") {
        setFormData({ ...formData, audioUrl: url });
      } else if (target === "question-image" && questionId) {
        updateQuestion(questionId, { imageUrl: url });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "File upload failed");
    } finally {
      setIsLoading(false);
      // Reset input
      e.target.value = "";
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Create Exam Section
          </h1>
          <p className="text-gray-500 mt-1">
            Build a new IELTS exam section with questions
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setIsImportModalOpen(true)}
          className="border-black text-black hover:bg-gray-50"
        >
          Quick Import
        </Button>
      </div>

      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImport={handleImport}
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="p-4 rounded-lg bg-red-500/20 text-red-400">
            {error}
          </div>
        )}

        {/* Basic Info */}
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
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
                ]}
                value={formData.type}
                onChange={(e) => {
                  const newType = e.target.value as ExamSectionType;
                  setFormData({ ...formData, type: newType });
                  setQuestions([]); // Reset questions when type changes to avoid mixing
                  setPassages([]);
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
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
          </CardBody>
        </Card>

        {/* Specialized Content for Writing */}
        {formData.type === "WRITING" ? (
          <div className="space-y-6">
            {questions.map((task, idx) => (
              <Card key={task.id}>
                <CardHeader>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Task {idx + 1}
                  </h2>
                </CardHeader>
                <CardBody className="space-y-4">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Task Prompt (Question Text)
                    </label>
                    <textarea
                      placeholder="Enter the task description or prompt here..."
                      className="w-full h-32 px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white resize-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
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
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
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
                            handleFileUpload(e, "question-image", task.id)
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
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Passages
                  </h2>
                  <Button type="button" size="sm" onClick={addPassage}>
                    Add Passage
                  </Button>
                </CardHeader>
                <CardBody className="space-y-4">
                  {passages.length === 0 ? (
                    <p className="text-gray-500 text-center py-4">
                      No passages added. Click &quot;Add Passage&quot; to start.
                    </p>
                  ) : (
                    passages.map((passage, index) => (
                      <div
                        key={passage.id}
                        className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <h3 className="font-medium text-gray-900 dark:text-white">
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
                          className="w-full h-40 px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white resize-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
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
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
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
                  <p className="text-gray-500 text-center py-8">
                    No questions added. Select a question type above to start.
                  </p>
                ) : (
                  questions.map((question, index) => (
                    <div
                      key={question.id || index}
                      className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 text-sm font-medium">
                            {index + 1}
                          </span>
                          <span className="text-sm font-medium text-gray-500">
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

                      {[
                        "MATCHING",
                        "DIAGRAM_LABELING",
                        "PLAN_MAP_LABELING",
                        "FLOW_CHART_COMPLETION",
                      ].includes(question.type) && (
                        <div className="space-y-2">
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
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

                      {/* Render different inputs based on question type */}
                      {(question.type === "MCQ_SINGLE" ||
                        question.type === "MCQ_MULTIPLE") && (
                        <div className="space-y-2">
                          <p className="text-sm text-gray-500">Options:</p>
                          {(question.options || []).map((opt, i) => (
                            <div
                              key={opt.id}
                              className="flex items-center gap-2"
                            >
                              <span className="w-6 text-gray-400 text-sm">
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
                              correctAnswer: e.target.value as any,
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
                  ))
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
          <Button type="submit" isLoading={isLoading} className="flex-1">
            Create Exam Section
          </Button>
        </div>
      </form>
    </div>
  );
}
