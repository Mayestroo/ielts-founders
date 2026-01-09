'use client';

import { Badge, Button, Card, CardBody, CardHeader, ConfirmationModal, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { ExamAssignment, ExamSection, User } from '@/types';
import { useEffect, useState } from 'react';

export default function AssignmentsPage() {
  const [assignments, setAssignments] = useState<ExamAssignment[]>([]);
  const [total, setTotal] = useState(0);
  const [students, setStudents] = useState<User[]>([]);
  const [exams, setExams] = useState<ExamSection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState('');
  
  const [formData, setFormData] = useState({
    studentId: '',
    listeningSectionId: '',
    readingSectionId: '',
    writingSectionId: '',
  });

  const [reassignAssignmentId, setReassignAssignmentId] = useState<string | null>(null);
  const [showReassignConfirm, setShowReassignConfirm] = useState(false);
  const [reassignLoading, setReassignLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Group exams by type
  const listeningExams = exams.filter(e => e.type === 'LISTENING');
  const readingExams = exams.filter(e => e.type === 'READING');
  const writingExams = exams.filter(e => e.type === 'WRITING');

  const handleReassign = async () => {
    if (!reassignAssignmentId) return;
    
    setReassignLoading(true);
    try {
      await api.reassignAssignment(reassignAssignmentId);
      setShowReassignConfirm(false);
      setReassignAssignmentId(null);
      loadData(); // Refresh list to update status
    } catch (err) {
      console.error('Failed to reassign:', err);
      // Ideally show toast error here
    } finally {
      setReassignLoading(false);
    }
  };

  const openReassignConfirm = (id: string) => {
    setReassignAssignmentId(id);
    setShowReassignConfirm(true);
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      const skip = (page - 1) * pageSize;
      const [{ assignments, total }, { users: studentsData }, examsData] = await Promise.all([
        api.getAssignments(skip, pageSize),
        api.getUsers(0, 1000), // Get enough students for the dropdown
        api.getExamSections(),
      ]);
      setAssignments(assignments);
      setTotal(total);
      setStudents(studentsData.filter(u => u.role === 'STUDENT'));
      setExams(examsData);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [page]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    const sectionsToAssign = [
      formData.listeningSectionId,
      formData.readingSectionId,
      formData.writingSectionId,
    ].filter(Boolean);

    if (sectionsToAssign.length === 0) {
      setError('Please select at least one exam section');
      setIsSubmitting(false);
      return;
    }

    try {
      // Create assignments for each selected section
      const promises = sectionsToAssign.map(sectionId =>
        api.createAssignment({ studentId: formData.studentId, sectionId })
      );
      
      await Promise.all(promises);
      
      setShowModal(false);
      setFormData({ studentId: '', listeningSectionId: '', readingSectionId: '', writingSectionId: '' });
      const { assignments: assignmentsData, total: assignmentsTotal } = await api.getAssignments((page - 1) * pageSize, pageSize);
      setAssignments(assignmentsData);
      setTotal(assignmentsTotal);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign exam');
    } finally {
      setIsSubmitting(false);
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Assignments</h1>
          <p className="text-gray-500 mt-1">Manage exam assignments for students</p>
        </div>
        <Button onClick={() => setShowModal(true)}>
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Assign Exam
        </Button>
      </div>

      {/* Assignments Table */}
      <Card>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Student</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Exam Section</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Assigned At</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {assignments.map((assignment) => (
                  <tr key={assignment.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-semibold text-xs">
                          {assignment.student?.firstName?.[0] || assignment.student?.username[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">
                            {assignment.student?.firstName ? `${assignment.student.firstName} ${assignment.student.lastName || ''}` : assignment.student?.username}
                          </p>
                          <p className="text-xs text-gray-500">@{assignment.student?.username}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Badge variant={
                          assignment.section?.type === 'READING' ? 'info' :
                          assignment.section?.type === 'LISTENING' ? 'warning' : 'success'
                        } size="sm">
                          {assignment.section?.type}
                        </Badge>
                        <span className="text-gray-900 dark:text-white">{assignment.section?.title}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant={getStatusBadgeVariant(assignment.status)}>
                        {assignment.status.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                      {new Date(assignment.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
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
                    </td>
                  </tr>
                ))}
                {assignments.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                      No assignments found
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
        <div className="flex items-center justify-between bg-white dark:bg-gray-800 px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700">
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
              disabled={page * pageSize >= total}
              variant="secondary"
            >
              Next
            </Button>
          </div>
          <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                Showing <span className="font-medium">{(page - 1) * pageSize + 1}</span> to <span className="font-medium">{Math.min(page * pageSize, total)}</span> of{' '}
                <span className="font-medium">{total}</span> results
              </p>
            </div>
            <div>
              <nav className="isolate inline-flex -space-x-px rounded-md shadow-xs" aria-label="Pagination">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="relative inline-flex items-center rounded-l-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50"
                >
                  <span className="sr-only">Previous</span>
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
                  </svg>
                </button>
                {[...Array(Math.ceil(total / pageSize))].map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setPage(i + 1)}
                    className={`relative inline-flex items-center px-4 py-2 text-sm font-semibold ring-1 ring-inset ring-gray-300 focus:z-20 focus:outline-offset-0 ${
                      page === i + 1
                        ? 'z-10 bg-indigo-600 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600'
                        : 'text-gray-900 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={page * pageSize >= total}
                  className="relative inline-flex items-center rounded-r-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50"
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

      {/* Assign Modal - Section-Based */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Assign Exam Sections</h2>
              <p className="text-sm text-gray-500 mt-1">Select sections to assign to the student</p>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleSubmit} className="space-y-5">
                {error && (
                  <div className="p-3 rounded-lg bg-red-500/20 text-red-400 text-sm">{error}</div>
                )}
                
                <Select
                  label="Student"
                  options={students.map(s => ({ 
                    value: s.id, 
                    label: s.firstName ? `${s.firstName} ${s.lastName || ''} (@${s.username})` : s.username 
                  }))}
                  value={formData.studentId}
                  onChange={(e) => setFormData({ ...formData, studentId: e.target.value })}
                  placeholder="Select a student"
                  required
                />

                <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Exam Sections</p>
                  
                  {/* Listening Section */}
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                        LISTENING
                      </span>
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
                    />
                  </div>

                  {/* Reading Section */}
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                        READING
                      </span>
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
                    />
                  </div>

                  {/* Writing Section */}
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                        WRITING
                      </span>
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
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <Button 
                    type="button" 
                    variant="secondary" 
                    onClick={() => {
                      setShowModal(false);
                      setFormData({ studentId: '', listeningSectionId: '', readingSectionId: '', writingSectionId: '' });
                      setError('');
                    }} 
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" className="flex-1" disabled={isSubmitting}>
                    {isSubmitting ? 'Assigning...' : 'Assign Sections'}
                  </Button>
                </div>
              </form>
            </CardBody>
          </Card>
        </div>
      )}


      {/* Reassign Confirmation Modal */}
      <ConfirmationModal
        isOpen={showReassignConfirm}
        onClose={() => setShowReassignConfirm(false)}
        onConfirm={handleReassign}
        title="Reassign Exam"
        message="Are you sure you want to reassign this exam? This will PERMANENTLY DELETE any current result, score, and all student answers. The student will be able to start the exam again from scratch."
        confirmText={reassignLoading ? "Reassigning..." : "Reassign Exam"}
        variant="danger"
        isLoading={reassignLoading}
      />
    </div>
  );
}
