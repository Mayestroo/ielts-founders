'use client';

import { Badge, Button, Card, CardBody, CardHeader, ConfirmationModal, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { ExamAssignment, ExamSection, User } from '@/types';
import { useEffect, useMemo, useState } from 'react';

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

  // Filtering States
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const [reassignAssignmentId, setReassignAssignmentId] = useState<string | null>(null);
  const [showReassignConfirm, setShowReassignConfirm] = useState(false);
  const [reassignLoading, setReassignLoading] = useState(false);
  
  const [deleteAssignmentId, setDeleteAssignmentId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  
  const [isSubmitting, setIsSubmitting] = useState(false);

  // UX Grouping state
  const [selectedStudent, setSelectedStudent] = useState<{ student: User; assignments: ExamAssignment[] } | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  // Group exams by type for the creation form
  const listeningExams = exams.filter(e => e.type === 'LISTENING');
  const readingExams = exams.filter(e => e.type === 'READING');
  const writingExams = exams.filter(e => e.type === 'WRITING');

  // Group assignments by student for the main table
  const groupedAssignments = useMemo(() => {
    // Perform client-side filtering
    const filtered = assignments.filter(assignment => {
      const student = assignment.student!;
      const matchesSearch = 
        (student.firstName?.toLowerCase().includes(searchTerm.toLowerCase()) || 
         student.lastName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
         student.username.toLowerCase().includes(searchTerm.toLowerCase()));
      
      const matchesType = !typeFilter || assignment.section?.type === typeFilter;
      
      return matchesSearch && matchesType;
    });

    const groups: Record<string, { student: User; assignments: ExamAssignment[]; latestDate: string }> = {};
    
    filtered.forEach((assignment) => {
      const studentId = assignment.studentId;
      if (!groups[studentId]) {
        groups[studentId] = {
          student: assignment.student!,
          assignments: [],
          latestDate: assignment.createdAt as string,
        };
      }
      groups[studentId].assignments.push(assignment);
      if (new Date(assignment.createdAt) > new Date(groups[studentId].latestDate)) {
        groups[studentId].latestDate = assignment.createdAt as string;
      }
    });

    return Object.values(groups).sort((a, b) => 
      new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime()
    );
  }, [assignments, searchTerm, typeFilter]);

  // Client-side pagination logic
  const paginatedGroups = useMemo(() => {
    const startIndex = (page - 1) * pageSize;
    return groupedAssignments.slice(startIndex, startIndex + pageSize);
  }, [groupedAssignments, page, pageSize]);

  // Update total for pagination controls
  useEffect(() => {
    setTotal(groupedAssignments.length);
  }, [groupedAssignments]);

  const handleReassign = async () => {
    if (!reassignAssignmentId) return;
    
    setReassignLoading(true);
    try {
      await api.reassignAssignment(reassignAssignmentId);
      setShowReassignConfirm(false);
      setReassignAssignmentId(null);
      
      // Update local state for the modal if open
      if (selectedStudent) {
        setSelectedStudent({
          ...selectedStudent,
          assignments: selectedStudent.assignments.map(a => 
            a.id === reassignAssignmentId ? { ...a, status: 'ASSIGNED' } : a
          )
        });
      }
      
      loadData(); // Refresh list to update status
    } catch (err) {
      console.error('Failed to reassign:', err);
    } finally {
      setReassignLoading(false);
    }
  };

  const openReassignConfirm = (id: string) => {
    setReassignAssignmentId(id);
    setShowReassignConfirm(true);
  };

  const handleDelete = async () => {
    if (!deleteAssignmentId) return;
    
    setDeleteLoading(true);
    try {
      await api.deleteAssignment(deleteAssignmentId);
      setShowDeleteConfirm(false);
      setDeleteAssignmentId(null);
      
      // Update local state for the modal if open
      if (selectedStudent) {
        setSelectedStudent({
          ...selectedStudent,
          assignments: selectedStudent.assignments.filter(a => a.id !== deleteAssignmentId)
        });
      }
      
      loadData(); // Refresh list
    } catch (err) {
      console.error('Failed to delete:', err);
      alert('Failed to delete assignment');
    } finally {
      setDeleteLoading(false);
    }
  };

  const openDeleteConfirm = (id: string) => {
    setDeleteAssignmentId(id);
    setShowDeleteConfirm(true);
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      // Fetch larger batch to allow client-side grouping
      // We ignore page/pageSize here to get "all" meaningful assignments for grouping
      const [{ assignments }, { users: studentsData }, examsData] = await Promise.all([
        api.getAssignments(0, 1000), 
        api.getUsers(0, 1000),
        api.getExamSections(),
      ]);
      setAssignments(assignments);
      // setTotal is now derived from groupedAssignments length
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
  }, []); // Remove page dependency as we create client-side pagination

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
      const promises = sectionsToAssign.map(sectionId =>
        api.createAssignment({ studentId: formData.studentId, sectionId })
      );
      
      await Promise.all(promises);
      
      setShowModal(false);
      setFormData({ studentId: '', listeningSectionId: '', readingSectionId: '', writingSectionId: '' });
      loadData();
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

      {/* Filters Bar */}
      <Card className="mb-6">
        <CardBody className="py-4 px-6">
          <div className="flex flex-wrap items-center gap-4">
             <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-400">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  </span>
                  <input 
                    type="text"
                    placeholder="Search student name or username..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
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
                 onChange={(e) => setTypeFilter(e.target.value)}
               />
             </div>
             <Button 
               variant="secondary" 
               onClick={() => {
                 setSearchTerm('');
                 setTypeFilter('');
               }}
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
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Student</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Active Exams</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Summary</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Last Activity</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {paginatedGroups.map((group) => {
                  const student = group.student;
                  const assignments = group.assignments;
                  const stats = {
                    assigned: assignments.filter(a => a.status === 'ASSIGNED').length,
                    progress: assignments.filter(a => a.status === 'IN_PROGRESS').length,
                    submitted: assignments.filter(a => a.status === 'SUBMITTED').length,
                  };

                  return (
                    <tr key={student.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-semibold text-xs">
                            {student.firstName?.[0] || student.username[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900 dark:text-white">
                              {student.firstName ? `${student.firstName} ${student.lastName || ''}` : student.username}
                            </p>
                            <p className="text-xs text-gray-500">@{student.username}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-2">
                          {assignments.slice(0, 3).map(a => (
                            <Badge key={a.id} variant={getSectionBadgeVariant(a.section?.type || '')} size="sm">
                              {a.section?.type}
                            </Badge>
                          ))}
                          {assignments.length > 3 && (
                            <span className="text-xs text-gray-500">+{assignments.length - 3} more</span>
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
                      <td className="px-6 py-4 text-gray-500 dark:text-gray-400 text-sm">
                        {new Date(group.latestDate).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Button 
                          size="sm" 
                          variant="secondary" 
                          onClick={() => {
                            setSelectedStudent(group);
                            setShowDetailsModal(true);
                          }}
                        >
                          View Details
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {paginatedGroups.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
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
                <span className="font-medium">{total}</span> groups
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

      {/* Student Details Modal */}
      {showDetailsModal && selectedStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <Card className="w-full max-w-2xl">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  Assignments for {selectedStudent.student.firstName || selectedStudent.student.username}
                </h2>
                <p className="text-sm text-gray-500 mt-1">Manage individual exam assignments</p>
              </div>
              <button 
                onClick={() => setShowDetailsModal(false)}
                className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </CardHeader>
            <CardBody className="p-0 overflow-y-auto max-h-[60vh]">
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {selectedStudent.assignments.map((assignment) => (
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
            </CardBody>
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <Button onClick={() => setShowDetailsModal(false)}>Close</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Assign Modal - Section-Based (Existing unchanged) */}
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

      <ConfirmationModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Delete Assignment"
        message="Are you sure you want to delete this assignment? This action cannot be undone."
        confirmText={deleteLoading ? "Deleting..." : "Delete Assignment"}
        variant="danger"
        isLoading={deleteLoading}
      />
    </div>
  );
}
