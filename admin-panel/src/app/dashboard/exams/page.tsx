'use client';

import { Badge, Button, Card, CardBody, ConfirmationModal, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { ExamSection } from '@/types';
import Link from 'next/link';
import { useEffect, useState } from 'react';

type TabType = 'READING' | 'LISTENING' | 'WRITING';

export default function ExamSectionsPage() {
  const [sections, setSections] = useState<ExamSection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('LISTENING');
  
  // Modal State
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [sectionToDelete, setSectionToDelete] = useState<string | null>(null);

  // Alert State
  const { success, error: showError } = useToast();

  const loadSections = async () => {
    try {
      const data = await api.getExamSections();
      setSections(data);
    } catch (err) {
      console.error('Failed to load sections:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSections();
  }, []);

  const handleDeleteClick = (id: string) => {
    setSectionToDelete(id);
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    if (!sectionToDelete) return;
    try {
      await api.deleteExamSection(sectionToDelete);
      loadSections();
      success('Section deleted successfully');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to delete section');
    } finally {
      setShowDeleteModal(false);
      setSectionToDelete(null);
    }
  };

  const cancelDelete = () => {
    setShowDeleteModal(false);
    setSectionToDelete(null);
  };

  const getTypeBadgeVariant = (type: string) => {
    switch (type) {
      case 'READING': return 'info';
      case 'LISTENING': return 'warning';
      case 'WRITING': return 'success';
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
      default:
        return null;
    }
  };

  const filteredSections = sections.filter(section => section.type === activeTab);

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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Exam Sections</h1>
          <p className="text-gray-500 mt-1">Create and manage IELTS exam sections</p>
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
      <div className="border-b border-gray-200 dark:border-gray-700">
        <div className="flex space-x-8">
          <button
            onClick={() => setActiveTab('LISTENING')}
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'LISTENING'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:hover:text-gray-300'
            }`}
          >
            Listening
          </button>
          <button
            onClick={() => setActiveTab('READING')}
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'READING'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:hover:text-gray-300'
            }`}
          >
            Reading
          </button>
          <button
            onClick={() => setActiveTab('WRITING')}
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'WRITING'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:hover:text-gray-300'
            }`}
          >
            Writing
          </button>
        </div>
      </div>

      {/* Sections Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredSections.map((section) => (
          <Card key={section.id} hover>
            <CardBody className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-lg ${
                  section.type === 'READING' ? 'bg-linear-to-br from-blue-500 to-cyan-500' :
                  section.type === 'LISTENING' ? 'bg-linear-to-br from-amber-500 to-orange-500' :
                  'bg-linear-to-br from-emerald-500 to-teal-500'
                }`}>
                  {getTypeIcon(section.type)}
                </div>
                <Badge variant={getTypeBadgeVariant(section.type)}>
                  {section.type}
                </Badge>
              </div>

              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2 line-clamp-2">
                {section.title}
              </h3>
              
              {section.description && (
                <p className="text-sm text-gray-500 mb-4 line-clamp-2">{section.description}</p>
              )}

              <div className="flex flex-wrap gap-3 text-sm text-gray-500 mb-4">
                <span className="flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {section.duration} min
                </span>
                <span className="flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {Array.isArray(section.questions) ? section.questions.length : 0} questions
                </span>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-gray-700">
                <p className="text-xs text-gray-400">
                  by {section.teacher?.firstName || section.teacher?.username || 'Unknown'}
                </p>
                <div className="flex gap-2">
                  <Link href={`/dashboard/exams/${section.id}/edit`}>
                    <Button variant="ghost" size="sm">
                      <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </Button>
                  </Link>
                  <Button variant="ghost" size="sm" onClick={() => handleDeleteClick(section.id)}>
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
          <div className="col-span-full py-12 flex flex-col items-center justify-center text-gray-500">
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
      />
    </div>
  );
}
