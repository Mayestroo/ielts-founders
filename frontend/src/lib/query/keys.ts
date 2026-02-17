export const studentQueryKeys = {
  authProfile: () => ["student", "auth", "profile"] as const,
  center: (centerId: string) => ["student", "centers", centerId] as const,
  myAssignments: () => ["student", "assignments", "my"] as const,
  assignment: (assignmentId: string) =>
    ["student", "assignments", assignmentId] as const,
  myResults: () => ["student", "results", "my"] as const,
  result: (resultId: string) => ["student", "results", resultId] as const,
  feedbackLatest: () => ["student", "results", "feedback-latest"] as const,
  writingSubmissionStatus: (submissionId: string) =>
    ["student", "writing-submission-status", submissionId] as const,
};
