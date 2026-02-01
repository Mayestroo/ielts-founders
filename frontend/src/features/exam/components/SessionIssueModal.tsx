'use client';

import { ConfirmationModal } from '@/components/ui/ConfirmationModal';

interface SessionIssueModalProps {
  sessionError: { type: string; message: string } | null;
  onResolve: () => void;
}

export function SessionIssueModal({
  sessionError,
  onResolve,
}: SessionIssueModalProps) {
  return (
    <ConfirmationModal
      isOpen={sessionError !== null}
      onClose={onResolve}
      onConfirm={onResolve}
      title="Session Issue"
      message={
        sessionError?.message || 'An error occurred with your exam session.'
      }
      confirmText={sessionError?.type === 'tab_conflict' ? 'Reload' : 'OK'}
      cancelText=""
      variant="danger"
    />
  );
}
