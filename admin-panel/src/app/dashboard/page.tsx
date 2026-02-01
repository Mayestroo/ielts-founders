'use client';

import { Badge, Card, CardBody } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { useEffect, useState } from 'react';

const timeAgo = (dateIdx: string) => {
  const date = new Date(dateIdx);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + " years ago";
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + " months ago";
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + " days ago";
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + " hours ago";
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + " mins ago";
  return Math.floor(seconds) + " seconds ago";
};

export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<{
    counts: {
      totalUsers: number;
      examSections: number;
      activeAssignments: number;
      completedTests: number;
    };
    growth: {
      users: number;
      sections: number;
      assignments: number;
      completedTests: number;
    };
    activity: {
      type: 'success' | 'info' | 'warning' | 'default';
      action: string;
      user: string;
      time: string;
    }[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadStats() {
      try {
        const stats = await api.getDashboardStats();
        setData(stats);
      } catch (e) {
        console.error('Failed to load dashboard stats', e);
      } finally {
        setIsLoading(false);
      }
    }
    loadStats();
  }, []);

  const formatGrowth = (val?: number) => {
    if (val === undefined) return '-';
    if (val === 0) return '0%';
    return (val > 0 ? '+' : '') + val + '%';
  };

  const growthVariant = (val?: number): 'default' | 'success' | 'danger' => {
    if (val === undefined || val === 0) return 'default';
    return val > 0 ? 'success' : 'danger';
  };

  const stats = [
    {
      label: 'Total Users',
      value: data?.counts.totalUsers ?? '-',
      change: formatGrowth(data?.growth.users),
      variant: growthVariant(data?.growth.users),
      icon: <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>,
      tone: 'bg-slate-900 text-white',
    },
    {
      label: 'Exam Sections',
      value: data?.counts.examSections ?? '-',
      change: formatGrowth(data?.growth.sections),
      variant: growthVariant(data?.growth.sections),
      icon: <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
      tone: 'bg-blue-600 text-white',
    },
    {
      label: 'Active Assignments',
      value: data?.counts.activeAssignments ?? '-',
      change: formatGrowth(data?.growth.assignments),
      variant: growthVariant(data?.growth.assignments),
      icon: <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>,
      tone: 'bg-emerald-600 text-white',
    },
    {
      label: 'Completed Tests',
      value: data?.counts.completedTests ?? '-',
      change: formatGrowth(data?.growth.completedTests),
      variant: growthVariant(data?.growth.completedTests),
      icon: <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
      tone: 'bg-amber-500 text-white',
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">
          Welcome back, {user?.firstName || user?.username}
        </h1>
        <p className="text-slate-500 mt-2">
          Here&apos;s what&apos;s happening with your IELTS platform today.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
           <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-slate-400"></div>
        </div>
      ) : (
        <>
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((stat, index) => (
            <Card key={index} hover>
              <CardBody className="p-6">
                <div className="flex items-center justify-between">
                  <div className={`w-12 h-12 rounded-2xl ${stat.tone} flex items-center justify-center shadow-sm`}>
                    {stat.icon}
                  </div>
                  {/* Keeping mock change percentage for now, ideally would compare with prev period */}
                  <Badge variant={stat.variant} size="sm">{stat.change}</Badge>
                </div>
                <div className="mt-4">
                  <p className="text-3xl font-bold text-gray-900 dark:text-white">{stat.value}</p>
                  <p className="text-sm text-gray-500 mt-1">{stat.label}</p>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>

        {/* Quick Actions & Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
            <CardBody className="p-6">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Quick Actions</h3>
              <div className="grid grid-cols-2 gap-4">
                <button className="group p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-sm transition-all text-left" onClick={() => window.location.href='/dashboard/exams'}>
                  <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-200 mb-3 transition-colors group-hover:bg-slate-900 group-hover:text-white">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                  </div>
                  <p className="font-medium text-slate-900 dark:text-white">Create Exam</p>
                  <p className="text-sm text-slate-500 mt-1">Add new exam section</p>
                </button>
                <button className="group p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-sm transition-all text-left" onClick={() => window.location.href='/dashboard/users'}>
                  <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center text-blue-700 dark:text-blue-300 mb-3 transition-colors group-hover:bg-blue-600 group-hover:text-white">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
                  </div>
                  <p className="font-medium text-slate-900 dark:text-white">Add User</p>
                  <p className="text-sm text-slate-500 mt-1">Create new account</p>
                </button>
                <button className="group p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-sm transition-all text-left" onClick={() => window.location.href='/dashboard/assignments'}>
                  <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/20 flex items-center justify-center text-emerald-700 dark:text-emerald-300 mb-3 transition-colors group-hover:bg-emerald-600 group-hover:text-white">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                  </div>
                  <p className="font-medium text-slate-900 dark:text-white">Assign Exam</p>
                  <p className="text-sm text-slate-500 mt-1">Assign to students</p>
                </button>
                <button className="group p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-sm transition-all text-left" onClick={() => window.location.href='/dashboard/results'}>
                  <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/20 flex items-center justify-center text-amber-700 dark:text-amber-300 mb-3 transition-colors group-hover:bg-amber-500 group-hover:text-white">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                  </div>
                  <p className="font-medium text-slate-900 dark:text-white">View Results</p>
                  <p className="text-sm text-slate-500 mt-1">Check scores</p>
                </button>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="p-6">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Recent Activity</h3>
              <div className="space-y-4">
                {data?.activity.length === 0 ? (
                    <p className="text-slate-500 text-sm">No recent activity found.</p>
                ) : (
                  data?.activity.map((activity, index) => (
                    <div key={index} className="flex items-center gap-4">
                      <div className={`w-2 h-2 rounded-full ${
                        activity.type === 'success' ? 'bg-emerald-500' : 
                        activity.type === 'info' ? 'bg-blue-500' : 
                        activity.type === 'warning' ? 'bg-amber-500' : 'bg-gray-400'
                      }`} />
                      <div className="flex-1">
                        <p className="text-sm text-slate-900 dark:text-white">{activity.action}</p>
                        <p className="text-xs text-slate-500">{activity.user}</p>
                      </div>
                      <span className="text-xs text-slate-400 whitespace-nowrap">{timeAgo(activity.time)}</span>
                    </div>
                  ))
                )}
              </div>
            </CardBody>
          </Card>
        </div>
        </>
      )}
    </div>
  );
}
