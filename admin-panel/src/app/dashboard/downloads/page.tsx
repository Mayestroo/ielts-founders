'use client';

import { Badge, Button, Card, CardBody } from '@/components/ui';
import { api } from '@/lib/api';
import { generateBatchPDF } from '@/lib/generatePDF';
import { ExamResult, User } from '@/types';
import { useEffect, useState } from 'react';

interface StudentReportGroup {
  student: User;
  results: {
    listening?: ExamResult;
    reading?: ExamResult;
    writing?: ExamResult;
  };
  testDate: string;
}

export default function DownloadsPage() {
  const [reportGroups, setReportGroups] = useState<StudentReportGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDownloading, setIsDownloading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [total, setTotal] = useState(0);
  
  // Filtering State
  const [searchTerm, setSearchTerm] = useState('');

  const loadData = async () => {
    setIsLoading(true);
    try {
      // Fetch results based on page and pageSize.
      const skip = (page - 1) * pageSize;
      const { results, total } = await api.getResults(skip, pageSize);
      setTotal(total);
      
      const groups: Record<string, StudentReportGroup> = {};
      
      results.forEach(result => {
        const studentId = result.studentId;
        if (!groups[studentId]) {
          groups[studentId] = {
            student: result.student!,
            results: {},
            testDate: result.submittedAt,
          };
        }
        
        const type = result.section?.type;
        if (type === 'LISTENING') groups[studentId].results.listening = result;
        if (type === 'READING') groups[studentId].results.reading = result;
        if (type === 'WRITING') groups[studentId].results.writing = result;
      });

      setReportGroups(Object.values(groups));
    } catch (err) {
      console.error('Failed to load results for downloads:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [page]);

  const filteredGroups = reportGroups.filter(group => {
    const student = group.student;
    return (
      student.firstName?.toLowerCase().includes(searchTerm.toLowerCase()) || 
      student.lastName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      student.username.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  const toggleSelect = (studentId: string) => {
    const next = new Set(selectedIds);
    if (next.has(studentId)) {
      next.delete(studentId);
    } else {
      next.add(studentId);
    }
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredGroups.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredGroups.map(g => g.student.id)));
    }
  };

  const handleBatchDownload = async () => {
    if (selectedIds.size === 0) return;
    
    setIsDownloading(true);
    try {
      const selectedReports = reportGroups
        .filter(g => selectedIds.has(g.student.id))
        .map(g => ({
          student: g.student,
          results: g.results,
          testDate: g.testDate,
        }));

      await generateBatchPDF(selectedReports);
    } catch (err) {
      console.error('Batch download failed:', err);
      alert('Failed to generate batch PDF.');
    } finally {
      setIsDownloading(false);
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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Batch Downloads</h1>
          <p className="text-gray-500 mt-1">Select students to download their combined IELTS reports</p>
        </div>
        
        <Button 
          onClick={handleBatchDownload} 
          disabled={selectedIds.size === 0 || isDownloading}
          className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-500/30"
        >
          {isDownloading ? (
            <>
              <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
              Generating PDF...
            </>
          ) : (
            <>
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download {selectedIds.size} {selectedIds.size === 1 ? 'Report' : 'Reports'}
            </>
          )}
        </Button>
      </div>

      {/* Filters Bar */}
      <Card className="mb-6">
        <CardBody className="py-4 px-6">
          <div className="flex flex-wrap items-center gap-6">
             <div className="flex-1 min-w-[250px]">
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
             <Button 
               size="sm" 
               variant="secondary" 
               onClick={loadData}
               className="ml-auto"
             >
               <svg className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
               </svg>
               Refresh
             </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="px-6 py-4 text-left">
                    <input 
                      type="checkbox" 
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      checked={selectedIds.size === filteredGroups.length && filteredGroups.length > 0}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Student</th>
                  <th className="px-6 py-4 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Listening</th>
                  <th className="px-6 py-4 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Reading</th>
                  <th className="px-6 py-4 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Writing</th>
                  <th className="px-6 py-4 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Overall Band</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filteredGroups.map((group) => {
                  const scores = [
                    group.results.listening?.bandScore || 0,
                    group.results.reading?.bandScore || 0,
                    group.results.writing?.bandScore || 0,
                    0 // Speaking placeholder
                  ].filter(s => s > 0);
                  
                  const overall = scores.length > 0 
                    ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 2) / 2 
                    : '-';

                  return (
                    <tr 
                      key={group.student.id} 
                      className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer ${selectedIds.has(group.student.id) ? 'bg-indigo-50/50 dark:bg-indigo-900/10' : ''}`}
                      onClick={() => toggleSelect(group.student.id)}
                    >
                      <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                        <input 
                          type="checkbox" 
                          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          checked={selectedIds.has(group.student.id)}
                          onChange={() => toggleSelect(group.student.id)}
                        />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-semibold text-xs text-center">
                            {group.student.firstName?.[0] || group.student.username[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900 dark:text-white">
                              {group.student.firstName ? `${group.student.firstName} ${group.student.lastName || ''}` : group.student.username}
                            </p>
                            <p className="text-xs text-gray-500">@{group.student.username}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {group.results.listening ? (
                          <Badge variant="success" size="sm">
                            <span className="font-bold">{group.results.listening.bandScore}</span>
                          </Badge>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center">
                        {group.results.reading ? (
                          <Badge variant="success" size="sm">
                            <span className="font-bold">{group.results.reading.bandScore}</span>
                          </Badge>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center">
                        {group.results.writing ? (
                          <Badge variant="success" size="sm">
                            <span className="font-bold">{group.results.writing.bandScore}</span>
                          </Badge>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="inline-flex items-center justify-center px-3 py-1 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-bold text-sm">
                          {overall}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => generateBatchPDF([{
                            student: group.student,
                            results: group.results,
                            testDate: group.testDate
                          }])}
                        >
                          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          Report
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {filteredGroups.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                      {searchTerm ? 'No students match your search' : 'No results found for report generation.'}
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
        <div className="flex items-center justify-between bg-white dark:bg-gray-800 px-6 py-4 rounded-xl border border-gray-100 mt-6">
            <p className="text-sm text-gray-500 font-medium">Showing grouped entries for <span className="text-gray-900 font-bold">{filteredGroups.length}</span> students</p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</Button>
              <Button size="sm" variant="secondary" onClick={() => setPage(p => p + 1)} disabled={page * pageSize >= total}>Next</Button>
            </div>
        </div>
      )}
    </div>
  );
}
