'use client';

import {
  registerExamNoteController,
  useExamNotesStore,
} from '@/store/examNotesStore';
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

interface Highlight {
  id: string;
  start: number;
  end: number;
  kind: 'highlight' | 'note';
  text: string;
  note?: string;
}

interface HighlightableTextProps {
  content: string;
  onHighlightsChange?: (highlights: Highlight[]) => void;
  initialHighlights?: Highlight[];
  inline?: boolean;
  className?: string;
}

interface Position {
  top: number;
  left: number;
}

function normalizeIncomingHighlights(
  highlights: Highlight[] | undefined,
  maxLength: number,
): Highlight[] {
  if (!Array.isArray(highlights)) {
    return [];
  }

  const normalized: Highlight[] = [];

  for (const item of highlights) {
    const start = Number(item?.start);
    const end = Number(item?.end);

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      continue;
    }

    const safeStart = Math.max(0, Math.min(maxLength, Math.floor(start)));
    const safeEnd = Math.max(0, Math.min(maxLength, Math.floor(end)));

    if (safeEnd <= safeStart) {
      continue;
    }

    normalized.push({
      id:
        typeof item?.id === 'string' && item.id.trim().length > 0
          ? item.id
          : `h_${safeStart}_${safeEnd}_${Math.random().toString(36).slice(2, 8)}`,
      start: safeStart,
      end: safeEnd,
      kind: item?.kind === 'note' ? 'note' : 'highlight',
      text: typeof item?.text === 'string' ? item.text : '',
      note: typeof item?.note === 'string' ? item.note : undefined,
    });
  }

  return normalized.sort((left, right) => left.start - right.start);
}

export function HighlightableText({
  content: rawContent = '',
  onHighlightsChange,
  initialHighlights = [],
  inline = false,
  className = '',
}: HighlightableTextProps) {
  const { content, boldRanges } = useMemo(() => {
    const contentWithoutHtml = (rawContent || '').replace(/<[^>]*>/g, '');
    const parsedBoldRanges: { start: number; end: number }[] = [];
    let strippedContent = '';
    let strippedIdx = 0;

    const boldRegex = /\*\*(.*?)\*\*/g;
    let lastEnd = 0;
    let match: RegExpExecArray | null;

    while ((match = boldRegex.exec(contentWithoutHtml)) !== null) {
      const beforeBold = contentWithoutHtml.slice(lastEnd, match.index);
      strippedContent += beforeBold;
      strippedIdx += beforeBold.length;

      const boldText = match[1];
      parsedBoldRanges.push({
        start: strippedIdx,
        end: strippedIdx + boldText.length,
      });

      strippedContent += boldText;
      strippedIdx += boldText.length;
      lastEnd = match.index + match[0].length;
    }

    strippedContent += contentWithoutHtml.slice(lastEnd);

    return {
      content: strippedContent,
      boldRanges: parsedBoldRanges,
    };
  }, [rawContent]);

  const initial = useMemo(
    () => normalizeIncomingHighlights(initialHighlights, content.length),
    [initialHighlights, content.length],
  );

  const sourceIdSeed = useId();
  const sourceId = useMemo(() => `note_src_${sourceIdSeed.replace(/:/g, '_')}`, [sourceIdSeed]);

  const openNotesSidebar = useExamNotesStore((state) => state.openSidebar);
  const setComposer = useExamNotesStore((state) => state.setComposer);
  const setSourceNotes = useExamNotesStore((state) => state.setSourceNotes);

  const containerRef = useRef<HTMLDivElement>(null);
  const selectionMenuRef = useRef<HTMLDivElement>(null);
  const highlightMenuRef = useRef<HTMLDivElement>(null);

  const [highlights, setHighlights] = useState<Highlight[]>(initial);
  const [selectionRange, setSelectionRange] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [showSelectionMenu, setShowSelectionMenu] = useState(false);
  const [selectionMenuPosition, setSelectionMenuPosition] = useState<Position>({
    top: 0,
    left: 0,
  });
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const [highlightMenuPosition, setHighlightMenuPosition] = useState<Position>({
    top: 0,
    left: 0,
  });

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;

      const isInsideSelectionMenu = selectionMenuRef.current?.contains(target);
      const isInsideHighlightMenu = highlightMenuRef.current?.contains(target);

      if (!isInsideSelectionMenu && !isInsideHighlightMenu) {
        setShowSelectionMenu(false);
        setActiveHighlightId(null);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, []);

  const isInBoldRange = useCallback(
    (position: number): boolean => {
      return boldRanges.some((range) => position >= range.start && position < range.end);
    },
    [boldRanges],
  );

  const renderTextSegment = useCallback(
    (text: string, startOffset: number) => {
      const lines = text.split('\n');

      return lines.map((line, lineIdx) => {
        const lineStartOffset =
          startOffset +
          lines
            .slice(0, lineIdx)
            .reduce((sum, lineText, idx) => sum + lineText.length + (idx < lineIdx ? 1 : 0), 0);

        const segments: React.ReactNode[] = [];
        let currentPosition = 0;

        while (currentPosition < line.length) {
          const globalPosition = lineStartOffset + currentPosition;
          const inBold = isInBoldRange(globalPosition);

          let endPosition = currentPosition + 1;
          while (
            endPosition < line.length &&
            isInBoldRange(lineStartOffset + endPosition) === inBold
          ) {
            endPosition += 1;
          }

          const segmentText = line.slice(currentPosition, endPosition);
          if (inBold) {
            segments.push(
              <strong key={`${lineIdx}-${currentPosition}`} className="font-bold">
                {segmentText}
              </strong>,
            );
          } else {
            segments.push(<span key={`${lineIdx}-${currentPosition}`}>{segmentText}</span>);
          }

          currentPosition = endPosition;
        }

        return (
          <span key={lineIdx}>
            {segments}
            {lineIdx < lines.length - 1 && '\n'}
          </span>
        );
      });
    },
    [isInBoldRange],
  );

  const updateHighlights = useCallback(
    (updater: (current: Highlight[]) => Highlight[]) => {
      setHighlights((current) => {
        const next = updater(current).sort((left, right) => left.start - right.start);
        onHighlightsChange?.(next);
        return next;
      });
    },
    [onHighlightsChange],
  );

  useEffect(() => {
    const notesForSource = highlights
      .filter(
        (item) => item.kind === 'note' && typeof item.note === 'string' && item.note.trim().length > 0,
      )
      .map((item) => ({
        sourceId,
        highlightId: item.id,
        start: item.start,
        end: item.end,
        quote: item.text,
        note: item.note || '',
        updatedAt: Date.now(),
      }));

    setSourceNotes(sourceId, notesForSource);
  }, [highlights, setSourceNotes, sourceId]);

  useEffect(() => {
    const unregister = registerExamNoteController(sourceId, {
      saveNote: ({ highlightId, start, end, quote, note }) => {
        const trimmed = note.trim();
        if (!trimmed) {
          return;
        }

        updateHighlights((current) => {
          if (highlightId) {
            const exists = current.some((item) => item.id === highlightId);

            if (exists) {
              return current.map((item) =>
                item.id === highlightId
                  ? {
                      ...item,
                      kind: 'note',
                      start,
                      end,
                      text: quote,
                      note: trimmed,
                    }
                  : item,
              );
            }
          }

          const nextItem: Highlight = {
            id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            start,
            end,
            kind: 'note',
            text: quote,
            note: trimmed,
          };

          return [...current, nextItem];
        });
      },
      deleteNote: (highlightId) => {
        updateHighlights((current) => current.filter((item) => item.id !== highlightId));
        setActiveHighlightId((current) => (current === highlightId ? null : current));
      },
    });

    return () => {
      unregister();
    };
  }, [sourceId, updateHighlights]);

  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setShowSelectionMenu(false);
      return;
    }

    const range = selection.getRangeAt(0);
    const container = containerRef.current;
    if (!container || !container.contains(range.commonAncestorContainer)) {
      setShowSelectionMenu(false);
      return;
    }

    const preSelectionRange = range.cloneRange();
    preSelectionRange.selectNodeContents(container);
    preSelectionRange.setEnd(range.startContainer, range.startOffset);

    const start = preSelectionRange.toString().length;
    const end = start + selection.toString().length;

    if (end <= start) {
      setShowSelectionMenu(false);
      return;
    }

    const selectionRect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    setSelectionRange({ start, end });
    setSelectionMenuPosition({
      top: selectionRect.bottom - containerRect.top + 10,
      left: selectionRect.left - containerRect.left + selectionRect.width / 2,
    });
    setShowSelectionMenu(true);
    setActiveHighlightId(null);
  }, []);

  const addAnnotation = useCallback(
    (kind: 'highlight' | 'note') => {
      if (!selectionRange) {
        return;
      }

      if (kind === 'note') {
        const selectedText = content.slice(selectionRange.start, selectionRange.end);
        const existingNote = highlights.find(
          (item) =>
            item.kind === 'note' &&
            item.start === selectionRange.start &&
            item.end === selectionRange.end,
        );

        setComposer({
          sourceId,
          highlightId: existingNote?.id,
          start: selectionRange.start,
          end: selectionRange.end,
          quote: selectedText,
          note: existingNote?.note || '',
        });
        openNotesSidebar();
        setShowSelectionMenu(false);
        setSelectionRange(null);
        window.getSelection()?.removeAllRanges();
        return;
      }

      const selectedText = content.slice(selectionRange.start, selectionRange.end);

      const nextItem: Highlight = {
        id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        start: selectionRange.start,
        end: selectionRange.end,
        kind,
        text: selectedText,
      };

      updateHighlights((current) => {
        const sameIndex = current.findIndex(
          (item) =>
            item.start === nextItem.start &&
            item.end === nextItem.end &&
            item.kind === nextItem.kind,
        );

        if (sameIndex >= 0) {
          const cloned = [...current];
          cloned[sameIndex] = {
            ...cloned[sameIndex],
            text: selectedText,
          };
          return cloned;
        }

        return [...current, nextItem];
      });

      setShowSelectionMenu(false);
      setSelectionRange(null);
      window.getSelection()?.removeAllRanges();
    },
    [content, highlights, openNotesSidebar, selectionRange, setComposer, sourceId, updateHighlights],
  );

  const removeHighlight = useCallback(
    (id: string) => {
      updateHighlights((current) => current.filter((item) => item.id !== id));
      setActiveHighlightId(null);
    },
    [updateHighlights],
  );

  const handleHighlightClick = useCallback(
    (event: React.MouseEvent<HTMLSpanElement>, highlightId: string) => {
      event.preventDefault();
      event.stopPropagation();

      const clickedHighlight = highlights.find((item) => item.id === highlightId);
      if (!clickedHighlight) {
        return;
      }

      if (clickedHighlight.kind === 'note') {
        setComposer({
          sourceId,
          highlightId: clickedHighlight.id,
          start: clickedHighlight.start,
          end: clickedHighlight.end,
          quote: content.slice(clickedHighlight.start, clickedHighlight.end),
          note: clickedHighlight.note || '',
        });
        openNotesSidebar();
        setShowSelectionMenu(false);
        setActiveHighlightId(null);
        return;
      }

      const container = containerRef.current;
      if (!container) {
        return;
      }

      const target = event.currentTarget;
      const targetRect = target.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      setHighlightMenuPosition({
        top: targetRect.bottom - containerRect.top + 10,
        left: targetRect.left - containerRect.left + targetRect.width / 2,
      });
      setActiveHighlightId(highlightId);
      setShowSelectionMenu(false);
    },
    [content, highlights, openNotesSidebar, setComposer, sourceId],
  );

  const getAnnotationClass = useCallback((kind: Highlight['kind']) => {
    if (kind === 'note') {
      return 'bg-[#DCE8FF] text-[#172AB7] underline decoration-dotted decoration-[#172AB7]';
    }
    return 'bg-[#FFEB3B] text-black';
  }, []);

  const renderContent = useCallback(() => {
    if (highlights.length === 0) {
      return renderTextSegment(content, 0);
    }

    const segments: React.ReactNode[] = [];
    let currentIndex = 0;
    const sorted = [...highlights].sort((left, right) => left.start - right.start);

    sorted.forEach((highlight) => {
      if (highlight.start > currentIndex) {
        segments.push(
          <span key={`text-${currentIndex}`}>
            {renderTextSegment(content.slice(currentIndex, highlight.start), currentIndex)}
          </span>,
        );
      }

      segments.push(
        <span
          key={highlight.id}
          className={`cursor-pointer rounded-sm px-0.5 transition-all duration-150 ${getAnnotationClass(
            highlight.kind,
          )} hover:brightness-95`}
          onClick={(event) => handleHighlightClick(event, highlight.id)}
          title={highlight.kind === 'note' ? 'View note' : 'Highlight'}
        >
          {renderTextSegment(content.slice(highlight.start, highlight.end), highlight.start)}
        </span>,
      );

      currentIndex = Math.max(currentIndex, highlight.end);
    });

    if (currentIndex < content.length) {
      segments.push(
        <span key={`text-${currentIndex}`}>
          {renderTextSegment(content.slice(currentIndex), currentIndex)}
        </span>,
      );
    }

    return segments;
  }, [content, getAnnotationClass, handleHighlightClick, highlights, renderTextSegment]);

  const activeHighlight =
    activeHighlightId !== null
      ? highlights.find(
          (item) => item.id === activeHighlightId && item.kind === 'highlight',
        ) || null
      : null;

  const SelectionMenu = showSelectionMenu ? (
    <div
      ref={selectionMenuRef}
      className="absolute z-50"
      style={{
        top: selectionMenuPosition.top,
        left: selectionMenuPosition.left,
        transform: 'translateX(-50%)',
      }}
    >
      <div className="relative rounded-2xl border border-[#D0D5DD] bg-[#ECEDEF] shadow-[0_10px_22px_rgba(15,23,42,0.18)] px-2 py-1.5 flex items-center gap-1">
        <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rotate-45 border-l border-t border-[#D0D5DD] bg-[#ECEDEF]" />

        <button
          type="button"
          onClick={() => addAnnotation('note')}
          className="inline-flex flex-col items-center justify-center min-w-[82px] py-1 text-[#4B5563] hover:text-[#111827] transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 8h8M8 12h8M8 16h5" />
            <path d="M6 3h12a2 2 0 0 1 2 2v14l-4-3-4 3-4-3-4 3V5a2 2 0 0 1 2-2Z" />
          </svg>
          <span className="mt-0.5 text-sm font-semibold">Note</span>
        </button>

        <span className="w-px h-9 bg-[#D0D5DD]" />

        <button
          type="button"
          onClick={() => addAnnotation('highlight')}
          className="inline-flex flex-col items-center justify-center min-w-[82px] py-1 text-[#4B5563] hover:text-[#111827] transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 20h8" />
            <path d="M14.5 4.5 19.5 9.5" />
            <path d="m3 21 7.2-2.1L20 9.1 14.9 4 5.1 13.8 3 21Z" />
          </svg>
          <span className="mt-0.5 text-sm font-semibold">Highlight</span>
        </button>
      </div>
    </div>
  ) : null;

  const HighlightActionMenu = activeHighlight ? (
    <div
      ref={highlightMenuRef}
      className="absolute z-50"
      style={{
        top: highlightMenuPosition.top,
        left: highlightMenuPosition.left,
        transform: 'translateX(-50%)',
      }}
    >
      <div className="relative rounded-xl border border-[#E5E7EB] bg-white shadow-[0_10px_20px_rgba(15,23,42,0.16)] px-4 py-2.5 min-w-[164px]">
        <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 border-l border-t border-[#E5E7EB] bg-white" />
        <button
          type="button"
          onClick={() => removeHighlight(activeHighlight.id)}
          className="inline-flex flex-col items-center justify-center gap-0.5 w-full text-[#FF313D] font-semibold hover:text-[#E11D48] transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M9 3.75h6a1 1 0 0 1 1 1V6h4v2h-1v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8H4V6h4V4.75a1 1 0 0 1 1-1Zm1 2V6h4v-.25h-4ZM7 8v11h10V8H7Z" />
          </svg>
          <span className="text-sm leading-none tracking-tight">Delete Highlight</span>
        </button>
      </div>
    </div>
  ) : null;

  if (inline) {
    return (
      <span className="relative inline">
        <span
          ref={containerRef as unknown as React.RefObject<HTMLSpanElement>}
          className={`highlightable-content cursor-text whitespace-pre-wrap ${className}`}
          style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
          onMouseUp={handleMouseUp}
        >
          {renderContent()}
        </span>
        {SelectionMenu}
        {HighlightActionMenu}
      </span>
    );
  }

  return (
    <div className="relative group">
      <div
        ref={containerRef}
        className={`highlightable-content whitespace-pre-wrap leading-relaxed text-[#30343C] text-base font-normal tracking-wide cursor-text ${className}`}
        style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
        onMouseUp={handleMouseUp}
      >
        {renderContent()}
      </div>
      {SelectionMenu}
      {HighlightActionMenu}
    </div>
  );
}
