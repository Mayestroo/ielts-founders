'use client';

import { useCallback, useEffect } from 'react';

export type AntiCheatViolationType =
  | 'context_menu'
  | 'blocked_shortcut'
  | 'devtools_shortcut'
  | 'copy'
  | 'paste';

interface AntiCheatViolation {
  type: AntiCheatViolationType;
  detail: string;
  occurredAt: string;
}

interface UseAntiCheatOptions {
  onViolation?: (violation: AntiCheatViolation) => void;
}

export function useAntiCheat(enabled = true, options: UseAntiCheatOptions = {}) {
  const { onViolation } = options;

  const reportViolation = useCallback(
    (type: AntiCheatViolationType, detail: string) => {
      onViolation?.({
        type,
        detail,
        occurredAt: new Date().toISOString(),
      });
    },
    [onViolation],
  );

  // Disable right-click context menu
  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
    reportViolation('context_menu', 'Right-click context menu blocked');
    return false;
  }, [reportViolation]);

  // Disable copy/paste shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Disable Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+A
    if (e.ctrlKey || e.metaKey) {
      if (['c', 'v', 'x', 'a', 'p', 's'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        reportViolation(
          'blocked_shortcut',
          `${e.ctrlKey ? 'Ctrl' : 'Meta'}+${e.key.toUpperCase()}`,
        );
        return false;
      }
    }
    // Disable F12 (Dev Tools)
    if (e.key === 'F12') {
      e.preventDefault();
      reportViolation('devtools_shortcut', 'F12');
      return false;
    }
    // Disable Ctrl+Shift+I (Dev Tools)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      reportViolation(
        'devtools_shortcut',
        `${e.ctrlKey ? 'Ctrl' : 'Meta'}+Shift+I`,
      );
      return false;
    }
  }, [reportViolation]);

  // Disable text selection CSS
  const disableSelection = useCallback(() => {
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';
  }, []);

  const enableSelection = useCallback(() => {
    document.body.style.userSelect = 'auto';
    document.body.style.webkitUserSelect = 'auto';
  }, []);

  // Disable copy event
  const handleCopy = useCallback((e: ClipboardEvent) => {
    e.preventDefault();
    reportViolation('copy', 'Copy event blocked');
    return false;
  }, [reportViolation]);

  // Disable paste event
  const handlePaste = useCallback((e: ClipboardEvent) => {
    e.preventDefault();
    reportViolation('paste', 'Paste event blocked');
    return false;
  }, [reportViolation]);

  useEffect(() => {
    if (!enabled) {
      enableSelection();
      return;
    }

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('copy', handleCopy);
    document.addEventListener('paste', handlePaste);
    disableSelection();

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('copy', handleCopy);
      document.removeEventListener('paste', handlePaste);
      enableSelection();
    };
  }, [enabled, handleContextMenu, handleKeyDown, handleCopy, handlePaste, disableSelection, enableSelection]);

  return {
    enableSelection,
    disableSelection,
  };
}
