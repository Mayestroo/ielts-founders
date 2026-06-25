'use client';

import { Badge, Button, Card, CardBody, CardHeader, ConfirmationModal, Select, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { ADMIN_QUERY_TIMINGS } from '@/lib/query/config';
import { adminQueryKeys } from '@/lib/query/keys';
import {
  BulkFullMockResult,
  ExamAssignment,
  ExamSectionOption,
  GroupedAssignmentsResponse,
  StudentSummary,
} from '@/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';

export default function AssignmentsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-slate-400"></div>
        </div>
      }
    >
      <AssignmentsContent />
    </Suspense>
  );
}

function AssignmentsContent() {
  const searchParams = useSearchParams();
  const offlineModePreset = searchParams.get('mode') === 'offline';
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [showModal, setShowModal] = useState(offlineModePreset);
  const [error, setError] = useState('');
  
  const [formData, setFormData] = useState({
    studentId: '',
    listeningSectionId: '',
    readingSectionId: '',
    writingSectionId: '',
    showResultsToStudent: false,
  });
  const [isFullMock] = useState(true);
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [studentSearchTerm, setStudentSearchTerm] = useState('');

  // Filtering States
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const [reassignAssignmentId, setReassignAssignmentId] = useState<string | null>(null);
  const [showReassignConfirm, setShowReassignConfirm] = useState(false);

  const [deleteAssignmentId, setDeleteAssignmentId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingVisibilitySessionId, setPendingVisibilitySessionId] = useState<string | null>(null);

  // UX Grouping state
  const [selectedStudent, setSelectedStudent] = useState<StudentSummary | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const queryClient = useQueryClient();
  const { success, error: showError } = useToast();

  const closeAssignModal = () => {
    setShowModal(false);
    setFormData({
      studentId: '',
      listeningSectionId: '',
      readingSectionId: '',
      writingSectionId: '',
      showResultsToStudent: false,
    });
    setError('');
    setSelectedStudentIds(new Set());
    setStudentSearchTerm('');
  };

  const openAssignModal = () => {
    setShowModal(true);
    setError('');
    setFormData({
      studentId: '',
      listeningSectionId: '',
      readingSectionId: '',
      writingSectionId: '',
      showResultsToStudent: false,
    });
    setSelectedStudentIds(new Set());
    setStudentSearchTerm('');
  };

  const groupedAssignmentsQuery = useQuery({
    queryKey: adminQueryKeys.groupedAssignments({
      page,
      pageSize,
      search: debouncedSearchTerm,
      sectionType: typeFilter,
    }),
    queryFn: ({ signal }) =>
      api.getGroupedAssignments(
        (page - 1) * pageSize,
        pageSize,
        debouncedSearchTerm || undefined,
        typeFilter || undefined,
        true, // fullMockOnly — admin page only shows offline exams
        { signal },
      ),
    staleTime: ADMIN_QUERY_TIMINGS.list.staleTime,
    gcTime: ADMIN_QUERY_TIMINGS.list.gcTime,
    placeholderData: (previousData) => previousData,
  });

  const studentsQuery = useQuery({
    queryKey: adminQueryKeys.students({ skip: 0, take: 500, search: '' }),
    queryFn: ({ signal }) => api.getStudents(0, 500, undefined, { signal }),
    staleTime: ADMIN_QUERY_TIMINGS.reference.staleTime,
    gcTime: ADMIN_QUERY_TIMINGS.reference.gcTime,
    enabled: showModal,
  });

  const examsQuery = useQuery<ExamSectionOption[]>({
    queryKey: adminQueryKeys.examSectionOptions(),
    queryFn: ({ signal }) => api.getExamSectionOptions({ signal }),
    staleTime: ADMIN_QUERY_TIMINGS.reference.staleTime,
    gcTime: ADMIN_QUERY_TIMINGS.reference.gcTime,
    enabled: showModal,
  });

  const studentAssignmentsQuery = useQuery({
    queryKey: selectedStudent
      ? adminQueryKeys.studentAssignments(selectedStudent.id)
      : ['admin', 'assignments', 'student', 'none'],
    queryFn: ({ signal }) =>
      api.getStudentAssignments(selectedStudent!.id, true, { signal }),
    enabled: showDetailsModal && Boolean(selectedStudent),
    staleTime: ADMIN_QUERY_TIMINGS.list.staleTime,
    gcTime: ADMIN_QUERY_TIMINGS.list.gcTime,
    placeholderData: (previousData) => previousData,
  });

  const groups = groupedAssignmentsQuery.data?.groups ?? [];
  const total = groupedAssignmentsQuery.data?.total ?? 0;
  const students = useMemo(() => studentsQuery.data?.users ?? [], [studentsQuery.data]);
  const exams = examsQuery.data ?? [];
  const isLoading = groupedAssignmentsQuery.isLoading && !groupedAssignmentsQuery.data;
  const isReferenceLoading =
    (studentsQuery.isLoading && !studentsQuery.data) ||
    (examsQuery.isLoading && !examsQuery.data);
  const selectedStudentAssignments = useMemo(
    () => studentAssignmentsQuery.data ?? [],
    [studentAssignmentsQuery.data],
  );
  const isDetailsLoading =
    studentAssignmentsQuery.isLoading && !studentAssignmentsQuery.data;
  const selectedSessionVisibility = useMemo(() => {
    const assignmentWithSession = selectedStudentAssignments.find(
      (assignment) => assignment.fullMockSessionId,
    );

    if (!assignmentWithSession?.fullMockSessionId) {
      return null;
    }

    return {
      sessionId: assignmentWithSession.fullMockSessionId,
      showResultsToStudent: Boolean(
        assignmentWithSession.resultsVisibleToStudent,
      ),
    };
  }, [selectedStudentAssignments]);

  const reassignMutation = useMutation({
    mutationFn: (assignmentId: string) => api.reassignAssignment(assignmentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'assignments'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (assignmentId: string) => api.deleteAssignment(assignmentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'assignments'] });
    },
  });

  const createAssignmentsMutation = useMutation({
    mutationFn: async (payload: {
      studentId: string;
      listeningSectionId: string;
      readingSectionId: string;
      writingSectionId: string;
      isFullMock: boolean;
    }) => {
      if (payload.isFullMock) {
        return api.createFullMockAssignment({
          studentId: payload.studentId,
          listeningSectionId: payload.listeningSectionId,
          readingSectionId: payload.readingSectionId,
          writingSectionId: payload.writingSectionId,
        });
      }

      const sectionsToAssign = [
        payload.listeningSectionId,
        payload.readingSectionId,
        payload.writingSectionId,
      ].filter(Boolean);

      return Promise.all(
        sectionsToAssign.map((sectionId) =>
          api.createAssignment({ studentId: payload.studentId, sectionId }),
        ),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'assignments'] });
    },
  });

  const bulkAssignMutation = useMutation({
    mutationFn: (payload: {
      studentIds: string[];
      listeningSectionId: string;
      readingSectionId: string;
      writingSectionId: string;
      showResultsToStudent: boolean;
    }) => api.createBulkFullMockAssignment(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'assignments'] });
    },
  });

  const updateResultVisibilityMutation = useMutation({
    mutationFn: (payload: { sessionId: string; showResultsToStudent: boolean }) =>
      api.updateFullMockResultVisibility(
        payload.sessionId,
        payload.showResultsToStudent,
      ),
  });

  // Filter students for multi-select search in modal
  const filteredStudents = useMemo(() => {
    if (!studentSearchTerm.trim()) return students;
    const term = studentSearchTerm.toLowerCase();
    return students.filter(s => 
      (s.firstName?.toLowerCase() || '').includes(term) ||
      (s.lastName?.toLowerCase() || '').includes(term) ||
      s.username.toLowerCase().includes(term)
    );
  }, [students, studentSearchTerm]);

  const toggleStudent = (id: string) => {
    setSelectedStudentIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllStudents = () => {
    if (selectedStudentIds.size === filteredStudents.length) {
      setSelectedStudentIds(new Set());
    } else {
      setSelectedStudentIds(new Set(filteredStudents.map(s => s.id)));
    }
  };

  // Group exams by type for the creation form
  const listeningExams = exams.filter(e => e.type === 'LISTENING');
  const readingExams = exams.filter(e => e.type === 'READING');
  const writingExams = exams.filter(e => e.type === 'WRITING');

  const hasFilters = Boolean(searchTerm.trim() || typeFilter);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageItems = useMemo<(number | string)[]>(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const items: (number | string)[] = [1];
    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);

    if (start > 2) {
      items.push('left-ellipsis');
    }

    for (let current = start; current <= end; current += 1) {
      items.push(current);
    }

    if (end < totalPages - 1) {
      items.push('right-ellipsis');
    }

    items.push(totalPages);
    return items;
  }, [page, totalPages]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim());
    }, 300);

    return () => clearTimeout(timeout);
  }, [searchTerm]);

  useEffect(() => {
    if (!groupedAssignmentsQuery.error) {
      return;
    }

    showError('Failed to load assignments');
  }, [groupedAssignmentsQuery.error, showError]);

  useEffect(() => {
    if (!showModal) {
      return;
    }

    if (!studentsQuery.error && !examsQuery.error) {
      return;
    }

    showError('Failed to load assignment metadata');
  }, [showModal, studentsQuery.error, examsQuery.error, showError]);

  useEffect(() => {
    if (!showDetailsModal || !studentAssignmentsQuery.error) {
      return;
    }

    showError('Failed to load student assignment details');
  }, [showDetailsModal, studentAssignmentsQuery.error, showError]);

  const handleReassign = async () => {
    if (!reassignAssignmentId) return;

    try {
      await reassignMutation.mutateAsync(reassignAssignmentId);
      setShowReassignConfirm(false);
      setReassignAssignmentId(null);
      success('Assignment reset to assigned');
    } catch (err) {
      console.error('Failed to reassign:', err);
      showError('Failed to reset assignment');
    }
  };

  const openReassignConfirm = (id: string) => {
    setReassignAssignmentId(id);
    setShowReassignConfirm(true);
  };

  const handleDelete = async () => {
    if (!deleteAssignmentId) return;

    try {
      await deleteMutation.mutateAsync(deleteAssignmentId);
      setShowDeleteConfirm(false);
      setDeleteAssignmentId(null);
      success('Assignment deleted');
    } catch (err) {
      console.error('Failed to delete:', err);
      showError('Failed to delete assignment');
    }
  };

  const openDeleteConfirm = (id: string) => {
    setDeleteAssignmentId(id);
    setShowDeleteConfirm(true);
  };

  const openStudentDetails = (student: StudentSummary) => {
    setSelectedStudent(student);
    setShowDetailsModal(true);
  };

  const syncResultVisibilityInCache = (
    sessionId: string,
    resultsVisibleToStudent: boolean,
  ) => {
    queryClient.setQueriesData<GroupedAssignmentsResponse>(
      { queryKey: ['admin', 'assignments', 'grouped'] },
      (previous) => {
        if (!previous) {
          return previous;
        }

        return {
          ...previous,
          groups: previous.groups.map((group) => {
            const hasSession = group.previewAssignments.some(
              (assignment) => assignment.fullMockSessionId === sessionId,
            );

            if (!hasSession) {
              return group;
            }

            return {
              ...group,
              resultsVisibleToStudent,
            };
          }),
        };
      },
    );

    queryClient.setQueriesData<ExamAssignment[]>(
      { queryKey: ['admin', 'assignments', 'student'] },
      (previous) => {
        if (!previous) {
          return previous;
        }

        return previous.map((assignment) =>
          assignment.fullMockSessionId === sessionId
            ? { ...assignment, resultsVisibleToStudent }
            : assignment,
        );
      },
    );
  };

  const handleToggleResultsVisibilityBySession = async (
    sessionId: string,
    showResultsToStudent: boolean,
  ) => {
    setPendingVisibilitySessionId(sessionId);
    try {
      const result = await updateResultVisibilityMutation.mutateAsync({
        sessionId,
        showResultsToStudent,
      });
      syncResultVisibilityInCache(sessionId, result.resultsVisibleToStudent);
      success(
        result.resultsVisibleToStudent
          ? 'Offline results are now visible to student'
          : 'Offline results are now hidden from student',
      );
    } catch (err) {
      console.error('Failed to update result visibility:', err);
      showError('Failed to update result visibility');
    } finally {
      setPendingVisibilitySessionId((current) =>
        current === sessionId ? null : current,
      );
    }
  };

  const handleToggleResultsVisibility = async (showResultsToStudent: boolean) => {
    if (!selectedSessionVisibility?.sessionId) {
      return;
    }

    await handleToggleResultsVisibilityBySession(
      selectedSessionVisibility.sessionId,
      showResultsToStudent,
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      if (isFullMock) {
        if (
          !formData.listeningSectionId ||
          !formData.readingSectionId ||
          !formData.writingSectionId
        ) {
          setError('Full mock requires listening, reading, and writing sections');
          return;
        }

        if (selectedStudentIds.size === 0) {
          setError('Please select at least one student');
          return;
        }

        // Use bulk endpoint for multi-student offline exam
        const result: BulkFullMockResult = await bulkAssignMutation.mutateAsync({
          studentIds: Array.from(selectedStudentIds),
          listeningSectionId: formData.listeningSectionId,
          readingSectionId: formData.readingSectionId,
          writingSectionId: formData.writingSectionId,
          showResultsToStudent: formData.showResultsToStudent,
        });

        if (result.errorCount === 0) {
          success(`Offline exam assigned to ${result.successCount} student${result.successCount > 1 ? 's' : ''}`);
        } else if (result.successCount > 0) {
          showError(
            `${result.successCount} assigned, ${result.errorCount} failed: ${result.results.filter(r => !r.success).map(r => `${r.studentName}: ${r.error}`).join('; ')}`
          );
        } else {
          setError(
            `All ${result.errorCount} failed: ${result.results.map(r => `${r.studentName}: ${r.error}`).join('; ')}`
          );
          return;
        }

        closeAssignModal();
        return;
      }

      // Single section assignment flow (unchanged)
      const sectionsToAssign = [
        formData.listeningSectionId,
        formData.readingSectionId,
        formData.writingSectionId,
      ].filter(Boolean);

      if (sectionsToAssign.length === 0) {
        setError('Please select at least one exam section');
        return;
      }

      await createAssignmentsMutation.mutateAsync({
        studentId: formData.studentId,
        listeningSectionId: formData.listeningSectionId,
        readingSectionId: formData.readingSectionId,
        writingSectionId: formData.writingSectionId,
        isFullMock,
      });

      success('Assignment created');
      closeAssignModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign exam');
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'ASSIGNED': return 'info';
      case 'IN_PROGRESS': return 'warning';
      case 'SUBMITTED': return 'success';
      default: return 'default';
    }
  };

  const getSectionBadgeVariant = (type: string) => {
    switch (type) {
      case 'READING': return 'info';
      case 'LISTENING': return 'warning';
      case 'WRITING': return 'success';
      default: return 'default';
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Offline Exams</h1>
          <p className="text-slate-500 mt-1">
            Manage offline exam assignments for center students
            <span className="ml-2 text-xs text-slate-400">{total} groups</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => openAssignModal()}>
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5a2 2 0 002 2h2a2 2 0 002-2" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Assign Offline Exam
          </Button>
        </div>
      </div>

      {/* Filters Bar */}
      <Card className="mb-6">
        <CardBody className="py-4 px-6">
          <div className="flex flex-wrap items-center gap-4">
             <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  </span>
                  <input 
                    type="text"
                    placeholder="Search student name or username..." 
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setPage(1);
                    }}
                    className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-slate-300 outline-none transition-all"
                  />
                </div>
             </div>
             <div className="w-48">
               <Select
                 options={[
                    { value: '', label: 'All Section Types' },
                    { value: 'READING', label: 'Reading' },
                    { value: 'LISTENING', label: 'Listening' },
                    { value: 'WRITING', label: 'Writing' },
                  ]}
                  value={typeFilter}
                  onChange={(e) => {
                    setTypeFilter(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
               <Button 
                variant="secondary" 
                onClick={() => {
                  setSearchTerm('');
                  setTypeFilter('');
                  setPage(1);
                }}
                disabled={!hasFilters}
              >
                Clear
              </Button>
           </div>
        </CardBody>
      </Card>

      {/* Grouped Assignments Table */}

      <Card>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-900/60">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Student</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Exams</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Summary</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Last Activity</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Results</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {groups.map((group) => {
                  const student = group.student;
                  const previewAssignments = group.previewAssignments;
                  const hasFullMock = group.hasFullMock;
                  const stats = group.stats;
                  const sessionId =
                    previewAssignments.find((assignment) => assignment.fullMockSessionId)
                      ?.fullMockSessionId ?? null;
                  const resultsVisible = group.resultsVisibleToStudent === true;
                  const isUpdatingCurrentRow =
                    pendingVisibilitySessionId !== null &&
                    pendingVisibilitySessionId === sessionId;

                  return (
                    <tr key={student.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-slate-900 flex items-center justify-center text-white font-semibold text-xs">
                            {student.firstName?.[0] || student.username[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-slate-900 dark:text-white">
                              {student.firstName ? `${student.firstName} ${student.lastName || ''}` : student.username}
                            </p>
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                              <span>@{student.username}</span>
                              {hasFullMock && (
                                <Badge variant="info" size="sm">Full Mock</Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-2">
                          {previewAssignments.map((assignment) => (
                            <Badge
                              key={assignment.id}
                              variant={getSectionBadgeVariant(assignment.section?.type || '')}
                              size="sm"
                            >
                              {assignment.section?.type}
                            </Badge>
                          ))}
                          {stats.total > previewAssignments.length && (
                            <span className="text-xs text-slate-500">
                              +{stats.total - previewAssignments.length} more
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex gap-3 text-xs font-medium">
                           {stats.assigned > 0 && <span className="text-blue-600 dark:text-blue-400">{stats.assigned} Assigned</span>}
                           {stats.progress > 0 && <span className="text-amber-600 dark:text-amber-400">{stats.progress} In Progress</span>}
                           {stats.submitted > 0 && <span className="text-emerald-600 dark:text-emerald-400">{stats.submitted} Submitted</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-500 dark:text-slate-400 text-sm">
                        {new Date(group.latestDate).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        {hasFullMock && sessionId ? (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={resultsVisible}
                              aria-label={`Toggle results visibility for ${student.username}`}
                              onClick={() =>
                                handleToggleResultsVisibilityBySession(
                                  sessionId,
                                  !resultsVisible,
                                )
                              }
                              disabled={isUpdatingCurrentRow}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-slate-400 ${
                                resultsVisible
                                  ? 'bg-emerald-500'
                                  : 'bg-amber-500'
                              } ${isUpdatingCurrentRow ? 'opacity-60 cursor-not-allowed' : ''}`}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                  resultsVisible
                                    ? 'translate-x-6'
                                    : 'translate-x-1'
                                }`}
                              />
                            </button>
                            <span className="text-xs font-medium text-slate-500">
                              {isUpdatingCurrentRow
                                ? 'Updating...'
                                : resultsVisible
                                ? 'On'
                                : 'Off'}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Button 
                          size="sm" 
                          variant="secondary" 
                          onClick={() => openStudentDetails(student)}
                        >
                          View Details
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {groups.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                      {searchTerm || typeFilter ? 'No assignments match your filters' : 'No assignments found'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-between bg-white dark:bg-slate-900 px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-800">
          <div className="flex flex-1 justify-between sm:hidden">
            <Button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              variant="secondary"
            >
              Previous
            </Button>
            <Button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= totalPages}
              variant="secondary"
            >
              Next
            </Button>
          </div>
          <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-slate-700 dark:text-slate-300">
                Showing <span className="font-medium">{(page - 1) * pageSize + 1}</span> to <span className="font-medium">{Math.min(page * pageSize, total)}</span> of{' '}
                <span className="font-medium">{total}</span> groups
              </p>
            </div>
            <div>
              <nav className="isolate inline-flex -space-x-px rounded-md shadow-xs" aria-label="Pagination">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="relative inline-flex items-center rounded-l-md px-2 py-2 text-slate-400 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50"
                >
                  <span className="sr-only">Previous</span>
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
                  </svg>
                </button>
                {pageItems.map((item, index) => {
                  if (typeof item === 'string') {
                    return (
                      <span
                        key={`${item}-${index}`}
                        className="relative inline-flex items-center px-4 py-2 text-sm font-semibold text-slate-500 ring-1 ring-inset ring-slate-200"
                      >
                        ...
                      </span>
                    );
                  }

                  return (
                    <button
                      key={item}
                      onClick={() => setPage(item)}
                      className={`relative inline-flex items-center px-4 py-2 text-sm font-semibold ring-1 ring-inset ring-slate-200 focus:z-20 focus:outline-offset-0 ${
                        page === item
                          ? 'z-10 bg-slate-900 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900'
                          : 'text-slate-900 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      {item}
                    </button>
                  );
                })}
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={page >= totalPages}
                  className="relative inline-flex items-center rounded-r-md px-2 py-2 text-slate-400 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50"
                >
                  <span className="sr-only">Next</span>
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                  </svg>
                </button>
              </nav>
            </div>
          </div>
        </div>
      )}

      {/* Student Details Modal */}
      {showDetailsModal && selectedStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <Card className="w-full max-w-2xl">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  Assignments for {selectedStudent.firstName || selectedStudent.username}
                </h2>
                <p className="text-sm text-gray-500 mt-1">Manage individual exam assignments</p>
                {selectedSessionVisibility && (
                  <div className="mt-3 flex items-center gap-3">
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
                      Show results to student
                    </label>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={selectedSessionVisibility.showResultsToStudent}
                      aria-label="Toggle student results visibility"
                      onClick={() =>
                        handleToggleResultsVisibility(
                          !selectedSessionVisibility.showResultsToStudent,
                        )
                      }
                      disabled={
                        pendingVisibilitySessionId ===
                        selectedSessionVisibility.sessionId
                      }
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-slate-400 ${
                        selectedSessionVisibility.showResultsToStudent
                          ? 'bg-emerald-500'
                          : 'bg-amber-500'
                      } ${
                        pendingVisibilitySessionId ===
                        selectedSessionVisibility.sessionId
                          ? 'opacity-60 cursor-not-allowed'
                          : ''
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          selectedSessionVisibility.showResultsToStudent
                            ? 'translate-x-6'
                            : 'translate-x-1'
                        }`}
                      />
                    </button>
                    <span className="text-xs font-medium text-gray-500">
                      {pendingVisibilitySessionId ===
                      selectedSessionVisibility.sessionId
                        ? 'Updating...'
                        : selectedSessionVisibility.showResultsToStudent
                        ? 'On'
                        : 'Off'}
                    </span>
                  </div>
                )}
              </div>
              <button 
                onClick={() => {
                  setShowDetailsModal(false);
                  setSelectedStudent(null);
                }}
                className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </CardHeader>
            <CardBody className="p-0 overflow-y-auto max-h-[60vh]">
              {isDetailsLoading ? (
                <div className="p-6 text-sm text-gray-500">Loading assignments...</div>
              ) : selectedStudentAssignments.length === 0 ? (
                <div className="p-6 text-sm text-gray-500">No assignments found for this student.</div>
              ) : (
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {selectedStudentAssignments.map((assignment) => (
                  <div key={assignment.id} className="p-6 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={getSectionBadgeVariant(assignment.section?.type || '')} size="sm">
                          {assignment.section?.type}
                        </Badge>
                        <span className="font-medium text-gray-900 dark:text-white">{assignment.section?.title}</span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span>Assigned: {new Date(assignment.createdAt).toLocaleDateString()}</span>
                        {assignment.startTime && <span>Started: {new Date(assignment.startTime).toLocaleString()}</span>}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      <Badge variant={getStatusBadgeVariant(assignment.status)}>
                        {assignment.status.replace('_', ' ')}
                      </Badge>
                      
                      <div className="flex items-center gap-2">
                        {(assignment.status === 'SUBMITTED' || assignment.status === 'IN_PROGRESS') && (
                          <Button 
                            size="sm" 
                            variant="danger" 
                            onClick={() => openReassignConfirm(assignment.id)}
                            className="text-xs"
                          >
                            Reassign
                          </Button>
                        )}
                        
                        <Button 
                          size="sm" 
                          variant="secondary" 
                          onClick={() => openDeleteConfirm(assignment.id)}
                          className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              )}
            </CardBody>
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <Button
                onClick={() => {
                  setShowDetailsModal(false);
                  setSelectedStudent(null);
                }}
              >
                Close
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Assign Modal - Section-Based (Existing unchanged) */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <Card className={`w-full ${isFullMock ? 'max-w-2xl' : 'max-w-lg'}`}>
            <CardHeader>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                {isFullMock ? 'Assign Offline Exam' : 'Assign Exam Sections'}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                {isFullMock
                  ? 'Select students and exam sections for offline center-based exam flow.'
                  : 'Select section tests to assign to the student'}
              </p>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleSubmit} className="space-y-5">
                {error && (
                  <div className="p-3 rounded-lg bg-red-500/20 text-red-400 text-sm">{error}</div>
                )}

                {isReferenceLoading && (
                  <div className="p-3 rounded-lg bg-slate-100 text-slate-600 text-sm dark:bg-slate-800 dark:text-slate-300">
                    Loading students and exam sections...
                  </div>
                )}

                {/* Multi-student selection for full mock */}
                {isFullMock ? (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Students
                        {selectedStudentIds.size > 0 && (
                          <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-900 text-white">
                            {selectedStudentIds.size} selected
                          </span>
                        )}
                      </label>
                      <button
                        type="button"
                        onClick={toggleAllStudents}
                        className="text-xs text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white font-medium"
                      >
                        {selectedStudentIds.size === filteredStudents.length && filteredStudents.length > 0
                          ? 'Deselect All'
                          : 'Select All'}
                      </button>
                    </div>
                    <div className="relative mb-2">
                      <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                      </span>
                      <input
                        type="text"
                        placeholder="Search students..."
                        value={studentSearchTerm}
                        onChange={(e) => setStudentSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-slate-300 outline-none"
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredStudents.length === 0 ? (
                        <div className="p-4 text-sm text-slate-500 text-center">
                          {studentSearchTerm ? 'No students match your search' : 'No students found'}
                        </div>
                      ) : (
                        filteredStudents.map(s => (
                          <label
                            key={s.id}
                            className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${
                              selectedStudentIds.has(s.id) ? 'bg-slate-50 dark:bg-slate-800/30' : ''
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedStudentIds.has(s.id)}
                              onChange={() => toggleStudent(s.id)}
                              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-300"
                            />
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-7 h-7 rounded-full bg-slate-900 flex items-center justify-center text-white font-semibold text-xs shrink-0">
                                {s.firstName?.[0] || s.username[0].toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                                  {s.firstName ? `${s.firstName} ${s.lastName || ''}` : s.username}
                                </p>
                                <p className="text-xs text-slate-500 truncate">@{s.username}</p>
                              </div>
                            </div>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                ) : (
                  <Select
                    label="Student"
                    options={students.map(s => ({ 
                      value: s.id, 
                      label: s.firstName ? `${s.firstName} ${s.lastName || ''} (@${s.username})` : s.username 
                    }))}
                    value={formData.studentId}
                    onChange={(e) => setFormData({ ...formData, studentId: e.target.value })}
                    placeholder="Select a student"
                    disabled={isReferenceLoading || students.length === 0}
                    required
                  />
                )}


                <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Exam Sections</p>
                  
                  {/* Listening Section */}
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                       <Badge variant="warning" size="sm">LISTENING</Badge>
                    </div>
                    <Select
                      options={[
                        { value: '', label: '-- No Listening Section --' },
                        ...listeningExams.map(e => ({ 
                          value: e.id, 
                          label: `${e.title} (${e.duration}m)` 
                        }))
                      ]}
                      value={formData.listeningSectionId}
                      onChange={(e) => setFormData({ ...formData, listeningSectionId: e.target.value })}
                      placeholder="Select listening exam"
                      disabled={isReferenceLoading || listeningExams.length === 0}
                    />
                  </div>

                  {/* Reading Section */}
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                       <Badge variant="info" size="sm">READING</Badge>
                    </div>
                    <Select
                      options={[
                        { value: '', label: '-- No Reading Section --' },
                        ...readingExams.map(e => ({ 
                          value: e.id, 
                          label: `${e.title} (${e.duration}m)` 
                        }))
                      ]}
                      value={formData.readingSectionId}
                      onChange={(e) => setFormData({ ...formData, readingSectionId: e.target.value })}
                      placeholder="Select reading exam"
                      disabled={isReferenceLoading || readingExams.length === 0}
                    />
                  </div>

                  {/* Writing Section */}
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                       <Badge variant="success" size="sm">WRITING</Badge>
                    </div>
                    <Select
                      options={[
                        { value: '', label: '-- No Writing Section --' },
                        ...writingExams.map(e => ({ 
                          value: e.id, 
                          label: `${e.title} (${e.duration}m)` 
                        }))
                      ]}
                      value={formData.writingSectionId}
                      onChange={(e) => setFormData({ ...formData, writingSectionId: e.target.value })}
                      placeholder="Select writing exam"
                      disabled={isReferenceLoading || writingExams.length === 0}
                    />
                  </div>
                </div>

                {isFullMock && (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-3 bg-slate-50 dark:bg-slate-900/50">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          Show offline results immediately
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Turn this off to hide Offline Results from student page until you enable later.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={formData.showResultsToStudent}
                          aria-label="Toggle immediate offline results visibility"
                          onClick={() =>
                            setFormData({
                              ...formData,
                              showResultsToStudent: !formData.showResultsToStudent,
                            })
                          }
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-slate-400 ${
                            formData.showResultsToStudent
                              ? 'bg-emerald-500'
                              : 'bg-amber-500'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              formData.showResultsToStudent
                                ? 'translate-x-6'
                                : 'translate-x-1'
                            }`}
                          />
                        </button>
                        <span className="text-xs font-medium text-slate-500">
                          {formData.showResultsToStudent ? 'On' : 'Off'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-3 pt-4">
                  <Button 
                    type="button" 
                    variant="secondary" 
                    onClick={closeAssignModal}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="flex-1"
                    disabled={
                      (isFullMock ? bulkAssignMutation.isPending : createAssignmentsMutation.isPending) ||
                      isReferenceLoading ||
                      students.length === 0 ||
                      exams.length === 0 ||
                      (isFullMock && selectedStudentIds.size === 0)
                    }
                  >
                    {(isFullMock ? bulkAssignMutation.isPending : createAssignmentsMutation.isPending)
                      ? 'Assigning...'
                      : isFullMock
                      ? `Assign to ${selectedStudentIds.size} Student${selectedStudentIds.size !== 1 ? 's' : ''}`
                      : 'Assign Sections'}
                  </Button>
                </div>
              </form>
            </CardBody>
          </Card>
        </div>
      )}


      <ConfirmationModal
        isOpen={showReassignConfirm}
        onClose={() => setShowReassignConfirm(false)}
        onConfirm={handleReassign}
        title="Reassign Exam"
        message="Are you sure you want to reassign this exam? This will PERMANENTLY DELETE any current result, score, and all student answers. The student will be able to start the exam again from scratch."
        confirmText={reassignMutation.isPending ? "Reassigning..." : "Reassign Exam"}
        variant="danger"
        isLoading={reassignMutation.isPending}
      />

      <ConfirmationModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Delete Assignment"
        message="Are you sure you want to delete this assignment? This action cannot be undone."
        confirmText={deleteMutation.isPending ? "Deleting..." : "Delete Assignment"}
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
