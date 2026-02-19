import { ExamAssignment, ExamSectionType, Passage, Question } from "@/types";

export type PartNumber = 1 | 2 | 3 | 4;
export type TaskNumber = 1 | 2;

export interface PartInfo {
  part: PartNumber;
  title: string;
  duration: number;
  questionCount: number;
}

export interface TaskInfo {
  task: TaskNumber;
  title: string;
  duration: number;
  questionCount: number;
}

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

export interface DisplayAssignment {
  id: string;
  originalAssignmentId: string;
  studentId: string;
  status: ExamAssignment["status"];
  startTime?: string;
  endTime?: string;
  score?: number;
  createdAt: string;
  isPart: boolean;
  isTask?: boolean;
  partInfo?: PartInfo;
  taskInfo?: TaskInfo;
  displaySection: {
    id: string;
    title: string;
    type: ExamSectionType;
    duration: number;
    passages?: Passage[];
    questions: Question[];
    audioUrl?: string;
  };
}

// Reading configuration
const READING_PART_DURATIONS: Record<PartNumber, number> = {
  1: 20,
  2: 20,
  3: 20,
  4: 20,
};

const READING_PART_TITLES: Record<PartNumber, string> = {
  1: "Part 1",
  2: "Part 2",
  3: "Part 3",
  4: "Part 4",
};

// Listening configuration (4 sections)
const LISTENING_PART_DURATIONS: Record<PartNumber, number> = {
  1: 8,
  2: 8,
  3: 8,
  4: 8,
};

const LISTENING_PART_TITLES: Record<PartNumber, string> = {
  1: "Section 1",
  2: "Section 2",
  3: "Section 3",
  4: "Section 4",
};

// Writing configuration (2 tasks)
const WRITING_TASK_DURATIONS: Record<TaskNumber, number> = {
  1: 20,
  2: 40,
};

const WRITING_TASK_TITLES: Record<TaskNumber, string> = {
  1: "Task 1",
  2: "Task 2",
};

/**
 * Split a complete Reading test into 3 parts
 * Each part contains one passage and its associated questions
 */
/**
 * Helper to determine part status based on answers
 */
function getPartStatus(
  assignmentStatus: ExamAssignment["status"],
  partQuestions: Question[],
  allAnswers: Record<string, unknown> | null | undefined
): ExamAssignment["status"] {
  if (assignmentStatus === "ASSIGNED") {
    return "ASSIGNED";
  }

  if (!allAnswers || partQuestions.length === 0) {
    return "IN_PROGRESS";
  }

  const hasAnswers = partQuestions.some((q) => {
    const answer = allAnswers[q.id];
    return hasAnswerValue(answer);
  });

  return hasAnswers ? "SUBMITTED" : "IN_PROGRESS";
}

/**
 * Split a complete Reading test into 3 parts
 * Each part contains one passage and its associated questions
 */
export function splitReadingTestIntoParts(
  assignment: ExamAssignment
): DisplayAssignment[] {
  const section = assignment.section;
  if (!section || section.type !== "READING") {
    return [];
  }

  const passages = section.passages || [];
  const allQuestions = section.questions || [];
  // transform answers to record if needed, though usually it comes as object from API
  const answers = assignment.answers as Record<string, unknown> | null;

  if (passages.length !== 3) {
    return [];
  }

  return [1, 2, 3].map((partNum): DisplayAssignment => {
    const passage = passages[partNum - 1];
    const passageQuestions = allQuestions.filter(
      (q) => q.passageId === passage.id
    );

    const partStatus = getPartStatus(
      assignment.status,
      passageQuestions,
      answers
    );

    return {
      id: `${assignment.id}-part-${partNum}`,
      originalAssignmentId: assignment.id,
      studentId: assignment.studentId,
      status: partStatus,
      startTime: assignment.startTime,
      endTime: assignment.endTime,
      score: assignment.score, // Shared score, imperfect but acceptable for now
      createdAt: assignment.createdAt,
      isPart: true,
      partInfo: {
        part: partNum as PartNumber,
        title: passage.title,
        duration: READING_PART_DURATIONS[partNum as PartNumber],
        questionCount: passageQuestions.length,
      },
      displaySection: {
        id: section.id,
        title: `${section.title} - ${READING_PART_TITLES[partNum as PartNumber]}`,
        type: "READING",
        duration: READING_PART_DURATIONS[partNum as PartNumber],
        passages: [passage],
        questions: passageQuestions,
      },
    };
  });
}

/**
 * Split a complete Listening test into 4 parts
 * Each part contains questions for one section
 * Assumes questions are evenly distributed or have metadata indicating section
 */
export function splitListeningTestIntoParts(
  assignment: ExamAssignment
): DisplayAssignment[] {
  const section = assignment.section;
  if (!section || section.type !== "LISTENING") {
    return [];
  }

  const allQuestions = section.questions || [];
  const answers = assignment.answers as Record<string, unknown> | null;
  
  if (allQuestions.length === 0) {
    return [];
  }

  // Split questions into 4 roughly equal parts
  const questionsPerPart = Math.ceil(allQuestions.length / 4);
  
  return [1, 2, 3, 4].map((partNum): DisplayAssignment => {
    const startIdx = (partNum - 1) * questionsPerPart;
    const endIdx = Math.min(startIdx + questionsPerPart, allQuestions.length);
    const partQuestions = allQuestions.slice(startIdx, endIdx);

    const partStatus = getPartStatus(
      assignment.status,
      partQuestions,
      answers
    );

    return {
      id: `${assignment.id}-part-${partNum}`,
      originalAssignmentId: assignment.id,
      studentId: assignment.studentId,
      status: partStatus,
      startTime: assignment.startTime,
      endTime: assignment.endTime,
      score: assignment.score,
      createdAt: assignment.createdAt,
      isPart: true,
      partInfo: {
        part: partNum as PartNumber,
        title: `${LISTENING_PART_TITLES[partNum as PartNumber]}`,
        duration: LISTENING_PART_DURATIONS[partNum as PartNumber],
        questionCount: partQuestions.length,
      },
      displaySection: {
        id: section.id,
        title: `${section.title} - ${LISTENING_PART_TITLES[partNum as PartNumber]}`,
        type: "LISTENING",
        duration: LISTENING_PART_DURATIONS[partNum as PartNumber],
        questions: partQuestions,
        audioUrl: section.audioUrl,
      },
    };
  });
}

/**
 * Split a complete Writing test into 2 tasks
 * Each task contains one writing question
 */
export function splitWritingTestIntoTasks(
  assignment: ExamAssignment
): DisplayAssignment[] {
  const section = assignment.section;
  if (!section || section.type !== "WRITING") {
    return [];
  }

  const allQuestions = section.questions || [];
  const answers = assignment.answers as Record<string, unknown> | null;
  
  // Writing typically has 2 tasks
  if (allQuestions.length < 2) {
    return [];
  }

  return [1, 2].map((taskNum): DisplayAssignment => {
    // Task 1 is first question, Task 2 is second question
    const question = allQuestions[taskNum - 1];
    
    // Check answer for this specific task
    const taskAnswerKeys = taskNum === 1
      ? ["w1", "task1", question?.id]
      : ["w2", "task2", question?.id];
    const hasAnswer = Boolean(
      answers &&
        taskAnswerKeys.some((key) =>
          key ? hasAnswerValue(answers[key]) : false
        ),
    );

    const taskStatus: ExamAssignment["status"] = hasAnswer
      ? "SUBMITTED"
      : assignment.status === "ASSIGNED"
      ? "ASSIGNED"
      : "IN_PROGRESS";

    return {
      id: `${assignment.id}-task-${taskNum}`,
      originalAssignmentId: assignment.id,
      studentId: assignment.studentId,
      status: taskStatus,
      startTime: assignment.startTime,
      endTime: assignment.endTime,
      score: assignment.score,
      createdAt: assignment.createdAt,
      isPart: false,
      isTask: true,
      taskInfo: {
        task: taskNum as TaskNumber,
        title: question?.questionText?.substring(0, 50) + "..." || WRITING_TASK_TITLES[taskNum as TaskNumber],
        duration: WRITING_TASK_DURATIONS[taskNum as TaskNumber],
        questionCount: 1,
      },
      displaySection: {
        id: section.id,
        title: `${section.title} - ${WRITING_TASK_TITLES[taskNum as TaskNumber]}`,
        type: "WRITING",
        duration: WRITING_TASK_DURATIONS[taskNum as TaskNumber],
        questions: [question],
      },
    };
  });
}

/**
 * Convert a complete assignment to a display assignment
 */
export function convertToCompleteDisplayAssignment(
  assignment: ExamAssignment
): DisplayAssignment {
  return {
    id: assignment.id,
    originalAssignmentId: assignment.id,
    studentId: assignment.studentId,
    status: assignment.status,
    startTime: assignment.startTime,
    endTime: assignment.endTime,
    score: assignment.score,
    createdAt: assignment.createdAt,
    isPart: false,
    displaySection: {
      id: assignment.section?.id || "",
      title: assignment.section?.title || "Untitled Test",
      type: assignment.section?.type || "READING",
      duration: assignment.section?.duration || 60,
      passages: assignment.section?.passages,
      questions: assignment.section?.questions || [],
      audioUrl: assignment.section?.audioUrl,
    },
  };
}

/**
 * Transform assignments into display items based on section type
 * - First complete test: shown as complete (FREE)
 * - Second complete test: split into parts (FREE)
 * - Remaining tests: shown as complete (PREMIUM)
 */
export function transformAssignments(
  assignments: ExamAssignment[],
  sectionType: ExamSectionType
): DisplayAssignment[] {
  const filteredAssignments = assignments
    .filter((a) => a.section?.type === sectionType)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const result: DisplayAssignment[] = [];

  filteredAssignments.forEach((assignment, index) => {
    if (index === 0) {
      // First test: show as complete (FREE)
      result.push(convertToCompleteDisplayAssignment(assignment));
    } else if (index === 1) {
      // Second test: split into parts (FREE)
      let parts: DisplayAssignment[] = [];
      
      switch (sectionType) {
        case "READING":
          parts = splitReadingTestIntoParts(assignment);
          break;
        case "LISTENING":
          parts = splitListeningTestIntoParts(assignment);
          break;
        case "WRITING":
          parts = splitWritingTestIntoTasks(assignment);
          break;
      }
      
      result.push(...parts);
    } else {
      // Remaining tests: show as complete (PREMIUM)
      result.push(convertToCompleteDisplayAssignment(assignment));
    }
  });

  return result;
}

/**
 * Get the tier (FREE/PREMIUM) for a display assignment
 * Based on position in the list
 */
export function getDisplayAssignmentTier(
  displayAssignment: DisplayAssignment,
  allDisplayAssignments: DisplayAssignment[]
): "FREE" | "PREMIUM" {
  const index = allDisplayAssignments.findIndex(
    (a) => a.id === displayAssignment.id
  );

  // Determine free count based on section type
  const sectionType = displayAssignment.displaySection.type;
  let freeCount = 4; // Default for Reading (1 complete + 3 parts)
  
  if (sectionType === "LISTENING") {
    freeCount = 5; // 1 complete + 4 parts
  } else if (sectionType === "WRITING") {
    freeCount = 3; // 1 complete + 2 tasks
  }

  if (index < freeCount) {
    return "FREE";
  }

  return "PREMIUM";
}

/**
 * Check if a display assignment ID is a part (virtual)
 */
export function isPartAssignmentId(id: string): boolean {
  return id.includes("-part-");
}

/**
 * Check if a display assignment ID is a task (virtual)
 */
export function isTaskAssignmentId(id: string): boolean {
  return id.includes("-task-");
}

/**
 * Extract original assignment ID from a part/task ID
 */
export function getOriginalAssignmentIdFromPartId(partId: string): string {
  return partId.split("-part-")[0].split("-task-")[0];
}

// Backward compatibility exports
export const transformReadingAssignments = (assignments: ExamAssignment[]) => 
  transformAssignments(assignments, "READING");
