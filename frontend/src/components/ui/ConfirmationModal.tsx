'use client';

import { Button } from './Button';
import { Modal } from './Modal';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string | null;
  variant?: 'danger' | 'warning' | 'info' | 'primary';
  isLoading?: boolean;
  dismissible?: boolean;
}

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  isLoading = false,
  dismissible = true,
}: ConfirmationModalProps) {
  const showCancel = cancelText !== null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} dismissible={dismissible}>
      <p className="text-gray-600 mb-8">
        {message}
      </p>
      <div className="flex justify-end gap-3">
        {showCancel && (
          <Button variant="ghost" onClick={onClose} disabled={isLoading}>
            {cancelText}
          </Button>
        )}
        <Button 
          variant={variant} 
          onClick={onConfirm} 
          isLoading={isLoading}
        >
          {confirmText}
        </Button>
      </div>
    </Modal>
  );
}
