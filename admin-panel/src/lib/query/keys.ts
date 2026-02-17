export const adminQueryKeys = {
  authProfile: () => ["admin", "auth", "profile"] as const,
  center: (centerId: string) => ["admin", "centers", centerId] as const,
  centers: () => ["admin", "centers", "all"] as const,
  dashboardStats: () => ["admin", "dashboard", "stats"] as const,
  usersList: (params: {
    page: number;
    pageSize: number;
    search: string;
    role: string;
    centerId: string;
  }) => ["admin", "users", params] as const,
  groupedAssignments: (params: {
    page: number;
    pageSize: number;
    search: string;
    sectionType: string;
  }) => ["admin", "assignments", "grouped", params] as const,
  studentAssignments: (studentId: string) =>
    ["admin", "assignments", "student", studentId] as const,
  examSections: () => ["admin", "exam-sections", "all"] as const,
  examSection: (sectionId: string) =>
    ["admin", "exam-sections", sectionId] as const,
  examSectionOptions: () => ["admin", "exam-sections", "options"] as const,
  resultsList: (params: { skip: number; take: number }) =>
    ["admin", "results", params] as const,
  result: (resultId: string) => ["admin", "results", resultId] as const,
  students: (params: { skip: number; take: number; search: string }) =>
    ["admin", "students", params] as const,
};
