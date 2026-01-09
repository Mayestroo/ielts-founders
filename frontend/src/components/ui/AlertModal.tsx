'use client';

import { Button } from './Button';
import { Modal } from './Modal';

interface AlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  message: string;
  variant?: 'danger' | 'info' | 'success' | 'warning';
}

export function AlertModal({
  isOpen,
  onClose,
  title = 'Alert',
  message,
  variant = 'info',
}: AlertModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <p className="text-gray-600 mb-8">
        {message}
      </p>
      <div className="flex justify-end">
        <Button 
          variant={variant === 'danger' ? 'danger' : 'primary'} 
          onClick={onClose}
        >
          Close
        </Button>
      </div>
    </Modal>
  );
}
