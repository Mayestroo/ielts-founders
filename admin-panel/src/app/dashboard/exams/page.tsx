'use client';

import { Badge, Button, Card, CardBody, ConfirmationModal, useToast } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { ADMIN_QUERY_TIMINGS } from '@/lib/query/config';
import { adminQueryKeys } from '@/lib/query/keys';
import { ExamSection } from '@/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type TabType = 'READING' | 'LISTENING' | 'WRITING' | 'SPEAKING';

type GroupedExamSection = {
  id: string;
  sectionIds: string[];
  centerIds: string[];
  title: string;
  type: ExamSection['type'];
  description?: string;
  duration: number;
  teacher?: ExamSection['teacher'];
  teacherId: string;
  centerNames: string[];
};

const buildSectionFingerprint = (section: ExamSection) =>
  JSON.stringify({
    title: section.title,
    type: section.type,
    description: section.description || '',
    duration: section.duration,
    audioUrl: section.audioUrl || '',
    questions: section.questions,
    passages: section.passages || [],
    teacherId: section.teacherId,
  });

export default function ExamSectionsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('LISTENING');
  
  // Modal State
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [sectionToDelete, setSectionToDelete] = useState<string[]>([]);

  // Alert State
  const queryClient = useQueryClient();
  const { success, error: showError } = useToast();

  const sectionsQuery = useQuery<ExamSection[]>({
    queryKey: adminQueryKeys.examSections(),
    queryFn: ({ signal }) => api.getExamSections({ signal }),
    staleTime: ADMIN_QUERY_TIMINGS.reference.staleTime,
    gcTime: ADMIN_QUERY_TIMINGS.reference.gcTime,
  });

  const deleteSectionMutation = useMutation({
    mutationFn: async (sectionIds: string[]) => {
      await Promise.all(sectionIds.map((sectionId) => api.deleteExamSection(sectionId)));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.examSections() });
    },
  });

  const sections = useMemo(() => sectionsQuery.data ?? [], [sectionsQuery.data]);
  const groupedSections = useMemo(() => {
    if (user?.role !== 'SUPER_ADMIN') {
      return sections.map((section) => ({
        id: section.id,
        sectionIds: [section.id],
        centerIds: [section.centerId],
        title: section.title,
        type: section.type,
        description: section.description,
        duration: section.duration,
        teacher: section.teacher,
        teacherId: section.teacherId,
        centerNames: section.center?.name ? [section.center.name] : [],
      })) satisfies GroupedExamSection[];
    }

    const groupsByFingerprint = new Map<string, GroupedExamSection[]>();

    sections.forEach((section) => {
      const fingerprint = buildSectionFingerprint(section);
      const existingGroups = groupsByFingerprint.get(fingerprint) || [];
      const centerName = section.center?.name || section.centerId;

      const reusableGroup = existingGroups.find(
        (group) => !group.centerIds.includes(section.centerId)
      );

      if (reusableGroup) {
        reusableGroup.sectionIds.push(section.id);
        reusableGroup.centerIds.push(section.centerId);
        reusableGroup.centerNames.push(centerName);
        return;
      }

      existingGroups.push({
        id: section.id,
        sectionIds: [section.id],
        centerIds: [section.centerId],
        title: section.title,
        type: section.type,
        description: section.description,
        duration: section.duration,
        teacher: section.teacher,
        teacherId: section.teacherId,
        centerNames: centerName ? [centerName] : [],
      });

      groupsByFingerprint.set(fingerprint, existingGroups);
    });

    return Array.from(groupsByFingerprint.values()).flat();
  }, [sections, user?.role]);
  const isLoading = sectionsQuery.isLoading && !sectionsQuery.data;

  useEffect(() => {
    if (!sectionsQuery.error) {
      return;
    }

    showError('Failed to load sections');
  }, [sectionsQuery.error, showError]);

  const counts = useMemo(() => {
    return {
      LISTENING: groupedSections.filter((section) => section.type === 'LISTENING').length,
      READING: groupedSections.filter((section) => section.type === 'READING').length,
      WRITING: groupedSections.filter((section) => section.type === 'WRITING').length,
      SPEAKING: groupedSections.filter((section) => section.type === 'SPEAKING').length,
    };
  }, [groupedSections]);

  const handleDeleteClick = (ids: string[]) => {
    setSectionToDelete(ids);
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    if (sectionToDelete.length === 0) return;
    try {
      await deleteSectionMutation.mutateAsync(sectionToDelete);
      success(
        sectionToDelete.length > 1
          ? 'Sections deleted successfully'
          : 'Section deleted successfully'
      );
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to delete section');
    } finally {
      setShowDeleteModal(false);
      setSectionToDelete([]);
    }
  };

  const cancelDelete = () => {
    setShowDeleteModal(false);
    setSectionToDelete([]);
  };

  const getTypeBadgeVariant = (type: string) => {
    switch (type) {
      case 'READING': return 'info';
      case 'LISTENING': return 'warning';
      case 'WRITING': return 'success';
      case 'SPEAKING': return 'default';
      default: return 'default';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'READING':
        return <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>;
      case 'LISTENING':
        return <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>;
      case 'WRITING':
        return <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>;
      case 'SPEAKING':
        return <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18.5a4.5 4.5 0 004.5-4.5V8a4.5 4.5 0 10-9 0v6a4.5 4.5 0 004.5 4.5z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11v3a7 7 0 01-14 0v-3M12 21v-3" /></svg>;
      default:
        return null;
    }
  };

  const filteredSections = groupedSections.filter((section) => section.type === activeTab);

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
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Exam Sections</h1>
          <p className="text-slate-500 mt-1">Create and manage IELTS exam sections</p>
        </div>
        <Link href={`/dashboard/exams/create?type=${activeTab}`}>
          <Button>
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Create Section
          </Button>
        </Link>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-800">
        <div className="flex space-x-8">
          <button
            onClick={() => setActiveTab('LISTENING')}
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'LISTENING'
                ? 'border-slate-900 text-slate-900 dark:text-white'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 dark:hover:text-slate-300'
            }`}
          >
            Listening
            <span className="ml-2 text-xs text-slate-400">{counts.LISTENING}</span>
          </button>
          <button
            onClick={() => setActiveTab('READING')}
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'READING'
                ? 'border-slate-900 text-slate-900 dark:text-white'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 dark:hover:text-slate-300'
            }`}
          >
            Reading
            <span className="ml-2 text-xs text-slate-400">{counts.READING}</span>
          </button>
          <button
            onClick={() => setActiveTab('WRITING')}
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'WRITING'
                ? 'border-slate-900 text-slate-900 dark:text-white'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 dark:hover:text-slate-300'
            }`}
          >
            Writing
            <span className="ml-2 text-xs text-slate-400">{counts.WRITING}</span>
          </button>
          <button
            onClick={() => setActiveTab('SPEAKING')}
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'SPEAKING'
                ? 'border-slate-900 text-slate-900 dark:text-white'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 dark:hover:text-slate-300'
            }`}
          >
            Speaking
            <span className="ml-2 text-xs text-slate-400">{counts.SPEAKING}</span>
          </button>
        </div>
      </div>

      {/* Sections Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredSections.map((section) => (
          <Card key={section.id} hover>
            <CardBody className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-sm ${
                  section.type === 'READING' ? 'bg-blue-600' :
                  section.type === 'LISTENING' ? 'bg-amber-500' :
                  section.type === 'WRITING' ? 'bg-emerald-600' :
                  'bg-indigo-600'
                }`}>
                  {getTypeIcon(section.type)}
                </div>
                <Badge variant={getTypeBadgeVariant(section.type)}>
                  {section.type}
                </Badge>
              </div>

              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2 line-clamp-2">
                {section.title}
              </h3>
              
              {section.description && (
                <p className="text-sm text-slate-500 mb-4 line-clamp-2">{section.description}</p>
              )}

              <div className="flex flex-wrap gap-3 text-sm text-slate-500 mb-4">
                <span className="flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {section.duration} min
                </span>
              </div>

              {section.centerNames.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs text-slate-400 mb-2">Assigned Centers</p>
                  <div className="flex flex-wrap gap-2">
                    {section.centerNames.slice(0, 3).map((centerName) => (
                      <span
                        key={`${section.id}-${centerName}`}
                        className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      >
                        {centerName}
                      </span>
                    ))}
                    {section.centerNames.length > 3 && (
                      <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        +{section.centerNames.length - 3} more
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-800">
                <p className="text-xs text-slate-400">
                  by {section.teacher?.firstName || section.teacher?.username || 'Unknown'}
                </p>
                <div className="flex gap-2">
                  <Link href={`/dashboard/exams/${section.id}/edit`}>
                    <Button variant="ghost" size="sm">
                      <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </Button>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteClick(section.sectionIds)}
                  >
                    <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
        {filteredSections.length === 0 && (
          <div className="col-span-full py-12 flex flex-col items-center justify-center text-slate-500">
            <p>No {activeTab.toLowerCase()} sections found.</p>
            <Link href={`/dashboard/exams/create?type=${activeTab}`} className="mt-4">
              <Button variant="secondary" size="sm">Create {activeTab.toLowerCase()} section</Button>
            </Link>
          </div>
        )}
      </div>

      <ConfirmationModal
        isOpen={showDeleteModal}
        onClose={cancelDelete}
        onConfirm={confirmDelete}
        title="Delete Exam Section"
        message="Are you sure you want to delete this exam section? This action cannot be undone."
        confirmText="Delete Section"
        variant="danger"
        isLoading={deleteSectionMutation.isPending}
      />
    </div>
  );
}
