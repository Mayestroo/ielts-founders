'use client';

import { ReviewModal } from '@/components/exam';
import { ConfirmationModal } from '@/components/ui/ConfirmationModal';
import { AnswerValue, ExamPart } from '../types';

interface ReviewAndConfirmModalsProps {
  isReviewOpen: boolean;
  onReviewClose: () => void;
  onReviewConfirm: () => void;
  isConfirmOpen: boolean;
  onConfirmClose: () => void;
  onConfirm: () => void;
  parts: ExamPart[];
  answers: Record<string, AnswerValue>;
  isSubmitting: boolean;
}

export function ReviewAndConfirmModals({
  isReviewOpen,
  onReviewClose,
  onReviewConfirm,
  isConfirmOpen,
  onConfirmClose,
  onConfirm,
  parts,
  answers,
  isSubmitting,
}: ReviewAndConfirmModalsProps) {
  return (
    <>
      <ReviewModal
        isOpen={isReviewOpen}
        onClose={onReviewClose}
        onConfirm={onReviewConfirm}
        parts={parts}
        answers={answers}
        isLoading={isSubmitting}
      />

      <ConfirmationModal
        isOpen={isConfirmOpen}
        onClose={onConfirmClose}
        onConfirm={onConfirm}
        title="Finish Section?"
        message="Are you sure you want to finish this section? You will not be able to change your answers after this."
        confirmText="Finish"
        cancelText="Go Back"
        variant="primary"
        isLoading={isSubmitting}
      />
    </>
  );
}
