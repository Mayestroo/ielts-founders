'use client';

import { Button, Card, CardBody, Input, Select, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { SessionReferralSource, TariffReportRow } from '@/types';
import { useMutation } from '@tanstack/react-query';
import { saveAs } from 'file-saver';
import { useMemo, useState } from 'react';
import { utils, write } from 'xlsx';

const REFERRAL_NOT_SET = '__NONE__' as const;

type ReferralFilterValue = '' | SessionReferralSource | typeof REFERRAL_NOT_SET;
type TimelineFilterValue =
  | ''
  | 'TODAY'
  | 'LAST_7_DAYS'
  | 'LAST_30_DAYS'
  | 'LAST_90_DAYS'
  | 'THIS_MONTH'
  | 'THIS_YEAR';

const formatReferralSource = (referral: TariffReportRow['referral']) => {
  if (!referral) {
    return 'By Admin';
  }

  return referral
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
};

const formatTariff = (tariff: TariffReportRow['tariff']) => {
  if (tariff === 'PREMIUM') {
    return 'Premium';
  }

  if (tariff === 'GOLD') {
    return 'Gold';
  }

  return 'Free';
};

const formatActivationDate = (value: string | null) => {
  if (!value) {
    return 'N/A';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'N/A';
  }

  return parsed.toLocaleString();
};

const buildWorksheetRows = (rows: TariffReportRow[]) => {
  return rows.map((row, index) => ({
    '#': index + 1,
    User: row.user,
    Username: row.username,
    Referral: formatReferralSource(row.referral),
    Tariff: formatTariff(row.tariff),
    'When Activated Tariff': formatActivationDate(row.tariffActivatedAt),
  }));
};

const getTimelineRange = (timelineFilter: TimelineFilterValue) => {
  if (!timelineFilter) {
    return null;
  }

  const now = new Date();
  const end = new Date(now);

  if (timelineFilter === 'TODAY') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  if (timelineFilter === 'LAST_7_DAYS') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 6);
    return { start, end };
  }

  if (timelineFilter === 'LAST_30_DAYS') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 29);
    return { start, end };
  }

  if (timelineFilter === 'LAST_90_DAYS') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 89);
    return { start, end };
  }

  if (timelineFilter === 'THIS_MONTH') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start, end };
  }

  const start = new Date(now.getFullYear(), 0, 1);
  return { start, end };
};

const parseDateInput = (value: string): Date | null => {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const [yearText, monthText, dayText] = normalized.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const parsed = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
};

const filterTariffRows = (
  rows: TariffReportRow[],
  tariffFilter: '' | TariffReportRow['tariff'],
  referralFilter: ReferralFilterValue,
  timelineFilter: TimelineFilterValue,
  fromDateInput: string,
  toDateInput: string,
) => {
  const timelineRange = getTimelineRange(timelineFilter);
  const parsedFrom = parseDateInput(fromDateInput);
  const parsedTo = parseDateInput(toDateInput);
  const fromDateBoundary =
    parsedFrom && parsedTo && parsedFrom > parsedTo ? parsedTo : parsedFrom;
  const toDateBase =
    parsedFrom && parsedTo && parsedFrom > parsedTo ? parsedFrom : parsedTo;
  const toDateBoundary = toDateBase
    ? new Date(
        toDateBase.getFullYear(),
        toDateBase.getMonth(),
        toDateBase.getDate(),
        23,
        59,
        59,
        999,
      )
    : null;

  return rows.filter((row) => {
    const matchesTariff = !tariffFilter || row.tariff === tariffFilter;

    const matchesReferral =
      !referralFilter ||
      (referralFilter === REFERRAL_NOT_SET
        ? row.referral == null
        : row.referral === referralFilter);

    const matchesTimeline = (() => {
      if (!timelineRange) {
        return true;
      }

      if (!row.tariffActivatedAt) {
        return false;
      }

      const activatedAt = new Date(row.tariffActivatedAt);
      if (Number.isNaN(activatedAt.getTime())) {
        return false;
      }

      return activatedAt >= timelineRange.start && activatedAt <= timelineRange.end;
    })();

    const matchesCustomRange = (() => {
      if (!fromDateBoundary && !toDateBoundary) {
        return true;
      }

      if (!row.tariffActivatedAt) {
        return false;
      }

      const activatedAt = new Date(row.tariffActivatedAt);
      if (Number.isNaN(activatedAt.getTime())) {
        return false;
      }

      if (fromDateBoundary && activatedAt < fromDateBoundary) {
        return false;
      }

      if (toDateBoundary && activatedAt > toDateBoundary) {
        return false;
      }

      return true;
    })();

    return matchesTariff && matchesReferral && matchesTimeline && matchesCustomRange;
  });
};

export default function ReportsPage() {
  const { success, error: showError } = useToast();
  const [tariffFilter, setTariffFilter] = useState<'' | TariffReportRow['tariff']>('');
  const [referralFilter, setReferralFilter] = useState<ReferralFilterValue>('');
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilterValue>('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const hasFilters = useMemo(
    () => Boolean(tariffFilter || referralFilter || timelineFilter || fromDate || toDate),
    [tariffFilter, referralFilter, timelineFilter, fromDate, toDate],
  );

  const downloadReportMutation = useMutation({
    mutationFn: () => api.getTariffReport(),
    onSuccess: (rows) => {
      if (!rows.length) {
        showError('No student records available for report');
        return;
      }

      const filteredRows = filterTariffRows(
        rows,
        tariffFilter,
        referralFilter,
        timelineFilter,
        fromDate,
        toDate,
      );

      if (!filteredRows.length) {
        showError('No student records match selected filters');
        return;
      }

      const worksheetRows = buildWorksheetRows(filteredRows);
      const worksheet = utils.json_to_sheet(worksheetRows);
      worksheet['!cols'] = [
        { wch: 6 },
        { wch: 30 },
        { wch: 24 },
        { wch: 18 },
        { wch: 14 },
        { wch: 24 },
      ];

      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, 'Tariff Report');

      const excelBuffer = write(workbook, {
        bookType: 'xlsx',
        type: 'array',
      });

      const fileName = `tariff-report-${new Date().toISOString().slice(0, 10)}.xlsx`;
      const blob = new Blob([excelBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      saveAs(blob, fileName);

      if (filteredRows.length === rows.length) {
        success(`Report downloaded (${rows.length} records)`);
      } else {
        success(
          `Report downloaded (${filteredRows.length} of ${rows.length} records)`,
        );
      }
    },
    onError: (error) => {
      showError(
        error instanceof Error
          ? error.message
          : 'Failed to generate Excel report',
      );
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Reports</h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">
          Download Excel report with User, Referral, Tariff, and tariff activation date.
        </p>
      </div>

      <Card>
        <CardBody className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
            The activation date uses each student&apos;s latest tariff update timestamp.
          </div>

          <div className="grid gap-3 md:grid-cols-5 md:items-end">
            <Select
              options={[
                { value: '', label: 'All Tariffs' },
                { value: 'PREMIUM', label: 'Premium' },
                { value: 'GOLD', label: 'Gold' },
                { value: 'FREE', label: 'Free' },
              ]}
              value={tariffFilter}
              onChange={(event) =>
                setTariffFilter(
                  (event.target.value as '' | TariffReportRow['tariff']) || '',
                )
              }
            />
            <Select
              options={[
                { value: '', label: 'All Referrals' },
                { value: 'TELEGRAM', label: 'Telegram' },
                { value: 'INSTAGRAM', label: 'Instagram' },
                { value: 'FACEBOOK', label: 'Facebook' },
                { value: 'GOOGLE', label: 'Google' },
                { value: 'FRIENDS', label: 'Friends' },
                { value: 'OTHER', label: 'Other' },
                { value: REFERRAL_NOT_SET, label: 'By Admin' },
              ]}
              value={referralFilter}
              onChange={(event) =>
                setReferralFilter((event.target.value as ReferralFilterValue) || '')
              }
            />
            <Select
              options={[
                { value: '', label: 'All Timeline' },
                { value: 'TODAY', label: 'Today' },
                { value: 'LAST_7_DAYS', label: 'Last 7 Days' },
                { value: 'LAST_30_DAYS', label: 'Last 30 Days' },
                { value: 'LAST_90_DAYS', label: 'Last 90 Days' },
                { value: 'THIS_MONTH', label: 'This Month' },
                { value: 'THIS_YEAR', label: 'This Year' },
              ]}
              value={timelineFilter}
              onChange={(event) =>
                setTimelineFilter((event.target.value as TimelineFilterValue) || '')
              }
            />
            <div className="w-full">
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                From date
              </label>
              <Input
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </div>
            <div className="w-full">
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                To date
              </label>
              <Input
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(event) => setToDate(event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Filters are applied before generating the Excel file.
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                setTariffFilter('');
                setReferralFilter('');
                setTimelineFilter('');
                setFromDate('');
                setToDate('');
              }}
              disabled={!hasFilters}
            >
              Clear Filters
            </Button>
          </div>

          <Button
            onClick={() => downloadReportMutation.mutate()}
            isLoading={downloadReportMutation.isPending}
            className="w-full sm:w-auto"
          >
            <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v12m0 0l-4-4m4 4l4-4M5 20h14"
              />
            </svg>
            Download Excel
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
