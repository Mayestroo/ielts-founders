import { useExamStore } from '@/store';
import { useEffect, useState } from 'react';

interface SessionStatusBadgeProps {
  isSyncing: boolean;
}

export function SessionStatusBadge({ isSyncing }: SessionStatusBadgeProps) {
  const error = useExamStore((state) => state.error);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isSyncing || error) {
      setIsVisible(true);
    } else {
      // Keep "Saved" visible for 3 seconds then hide
      const timer = setTimeout(() => {
        setIsVisible(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isSyncing, error]);

  if (!isVisible && !isSyncing && !error) return null;

  return (
    <div className={`fixed top-20 right-4 z-50 flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-lg max-w-xs transition-opacity duration-500 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
      <div
        className={`w-2 h-2 rounded-full shrink-0 ${
          error ? 'bg-red-500' : isSyncing ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'
        }`}
      />
      <span className="text-xs text-gray-600 truncate">
        {error || (isSyncing ? 'Saving...' : 'Saved')}
      </span>
    </div>
  );
}
