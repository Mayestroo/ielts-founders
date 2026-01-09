'use client';

import { useCallback, useEffect } from 'react';

export function useAntiCheat() {
  // Disable right-click context menu
  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
    return false;
  }, []);

  // Disable copy/paste shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Disable Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+A
    if (e.ctrlKey || e.metaKey) {
      if (['c', 'v', 'x', 'a', 'p', 's'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        return false;
      }
    }
    // Disable F12 (Dev Tools)
    if (e.key === 'F12') {
      e.preventDefault();
      return false;
    }
    // Disable Ctrl+Shift+I (Dev Tools)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      return false;
    }
  }, []);

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
    return false;
  }, []);

  // Disable paste event
  const handlePaste = useCallback((e: ClipboardEvent) => {
    e.preventDefault();
    return false;
  }, []);

  useEffect(() => {
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
  }, [handleContextMenu, handleKeyDown, handleCopy, handlePaste, disableSelection, enableSelection]);

  return {
    enableSelection,
    disableSelection,
  };
}
