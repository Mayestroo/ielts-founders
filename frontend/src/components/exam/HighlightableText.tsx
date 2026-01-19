'use client';

import { ConfirmationModal } from '@/components/ui';
import React, { useCallback, useEffect, useRef, useState } from 'react';

interface Highlight {
  id: string;
  start: number;
  end: number;
  color: string;
  text: string;
}

interface HighlightableTextProps {
  content: string;
  onHighlightsChange?: (highlights: Highlight[]) => void;
  initialHighlights?: Highlight[];
  inline?: boolean;
  className?: string;
}

export function HighlightableText({ 
  content: rawContent = '', 
  onHighlightsChange,
  initialHighlights = [],
  inline = false,
  className = ''
}: HighlightableTextProps) {
  // Strip HTML tags first
  const contentWithoutHtml = (rawContent || '').replace(/<[^>]*>/g, '');
  
  // Parse bold ranges from the original content BEFORE stripping markers
  // We need to track where bold text is in the STRIPPED content
  const boldRanges: { start: number; end: number }[] = [];
  let strippedContent = '';
  let originalIdx = 0;
  let strippedIdx = 0;
  
  // Process the content to extract bold ranges and create stripped content
  const boldRegex = /\*\*(.*?)\*\*/g;
  let lastEnd = 0;
  let match;
  
  while ((match = boldRegex.exec(contentWithoutHtml)) !== null) {
    // Add text before this bold section
    const beforeBold = contentWithoutHtml.slice(lastEnd, match.index);
    strippedContent += beforeBold;
    strippedIdx += beforeBold.length;
    
    // Track the bold range in stripped coordinates
    const boldText = match[1]; // The text inside **
    boldRanges.push({
      start: strippedIdx,
      end: strippedIdx + boldText.length
    });
    
    strippedContent += boldText;
    strippedIdx += boldText.length;
    lastEnd = match.index + match[0].length;
  }
  // Add remaining text after last bold
  strippedContent += contentWithoutHtml.slice(lastEnd);
  
  const content = strippedContent;
  
  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement | HTMLSpanElement>(null);
  // Only initialize from props once
  const [highlights, setHighlights] = useState<Highlight[]>(initialHighlights);
  const [showToolbar, setShowToolbar] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState({ top: 0, left: 0 });
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null);
  const [highlightToRemove, setHighlightToRemove] = useState<string | null>(null);

  // Hide toolbar when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const isInsideContainer = containerRef.current?.contains(event.target as Node);
      const isInsideToolbar = toolbarRef.current?.contains(event.target as Node);
      
      if (!isInsideContainer && !isInsideToolbar) {
        setShowToolbar(false);
      }
    };

    if (showToolbar) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showToolbar]);

  // Handle selection
  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setShowToolbar(false);
      return;
    }

    const range = selection.getRangeAt(0);
    const container = containerRef.current;
    if (!container || !container.contains(range.commonAncestorContainer)) {
      setShowToolbar(false);
      return;
    }
    
    // Position toolbar
    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    
    setToolbarPosition({
      top: rect.top - containerRect.top - 40,
      left: rect.left - containerRect.left + (rect.width / 2) - 50,
    });
    
    const preSelectionRange = range.cloneRange();
    preSelectionRange.selectNodeContents(container);
    preSelectionRange.setEnd(range.startContainer, range.startOffset);
    const start = preSelectionRange.toString().length;
    const end = start + selection.toString().length;

    setSelectionRange({ start, end });
    setShowToolbar(true);
  }, []);

  const addHighlight = (color: string) => {
    if (!selectionRange) return;

    const newHighlight: Highlight = {
      id: Math.random().toString(36).substr(2, 9),
      start: selectionRange.start,
      end: selectionRange.end,
      color,
      text: content.substring(selectionRange.start, selectionRange.end),
    };

    const updated = [...highlights, newHighlight];
    updated.sort((a, b) => a.start - b.start);
    
    setHighlights(updated);
    onHighlightsChange?.(updated);
    setShowToolbar(false);
    window.getSelection()?.removeAllRanges();
  };

  const removeHighlight = (id: string) => {
    const updated = highlights.filter(h => h.id !== id);
    setHighlights(updated);
    onHighlightsChange?.(updated);
  };

  // Check if a position is within a bold range
  const isInBoldRange = (pos: number): boolean => {
    return boldRanges.some(r => pos >= r.start && pos < r.end);
  };

  // Render a text segment with proper bold handling
  const renderTextSegment = (text: string, startOffset: number) => {
    // Split by newlines first
    const lines = text.split('\n');
    return lines.map((line, lineIdx) => {
      const lineStartOffset = startOffset + lines.slice(0, lineIdx).reduce((acc, l, i) => acc + l.length + (i < lineIdx ? 1 : 0), 0);
      
      // Build segments with bold ranges applied
      const segments: React.ReactNode[] = [];
      let pos = 0;
      
      while (pos < line.length) {
        const globalPos = lineStartOffset + pos;
        const inBold = isInBoldRange(globalPos);
        
        // Find how far this style extends
        let endPos = pos + 1;
        while (endPos < line.length && isInBoldRange(lineStartOffset + endPos) === inBold) {
          endPos++;
        }
        
        const segmentText = line.slice(pos, endPos);
        if (inBold) {
          segments.push(<strong key={`${lineIdx}-${pos}`} className="font-bold">{segmentText}</strong>);
        } else {
          segments.push(<span key={`${lineIdx}-${pos}`}>{segmentText}</span>);
        }
        pos = endPos;
      }
      
      return (
        <span key={lineIdx}>
          {segments}
          {lineIdx < lines.length - 1 && '\n'}
        </span>
      );
    });
  };

  const getHighlightClass = (color: string) => {
    switch (color) {
      case 'yellow': return 'bg-yellow-200 text-black shadow-[0_0_2px_rgba(234,179,8,0.3)]';
      case 'green': return 'bg-emerald-200 text-black shadow-[0_0_2px_rgba(16,185,129,0.3)]';
      case 'blue': return 'bg-sky-200 text-black shadow-[0_0_2px_rgba(14,165,233,0.3)]';
      case 'pink': return 'bg-pink-200 text-black shadow-[0_0_2px_rgba(236,72,153,0.3)]';
      default: return 'bg-yellow-200 text-black';
    }
  };

  const renderContent = () => {
    if (highlights.length === 0) return renderTextSegment(content, 0);

    const segments: React.ReactNode[] = [];
    let currentIdx = 0;

    const sortedHighlights = [...highlights].sort((a, b) => a.start - b.start);

    sortedHighlights.forEach((h) => {
      if (h.start > currentIdx) {
        segments.push(
          <span key={`text-${currentIdx}`}>
            {renderTextSegment(content.slice(currentIdx, h.start), currentIdx)}
          </span>
        );
      }

      segments.push(
        <span
          key={h.id}
          className={`
            cursor-pointer rounded-sm px-0.5 transition-all duration-200
            ${getHighlightClass(h.color)}
            hover:brightness-95
          `}
          onClick={(e) => {
             e.stopPropagation();
             setHighlightToRemove(h.id);
          }}
          title="Click to remove highlight"
        >
          {renderTextSegment(content.slice(h.start, h.end), h.start)}
        </span>
      );

      currentIdx = h.end;
    });

    if (currentIdx < content.length) {
      segments.push(
        <span key={`text-${currentIdx}`}>
          {renderTextSegment(content.slice(currentIdx), currentIdx)}
        </span>
      );
    }

    return segments;
  };

  return (
    <>
      {inline ? (
        <span className="relative inline">
          <span 
            ref={containerRef}
            className={`highlightable-content cursor-text whitespace-pre-wrap ${className}`}
            style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
            onMouseUp={handleMouseUp}
          >
            {renderContent()}
          </span>

          {showToolbar && (
            <span 
              ref={toolbarRef as any}
              className="absolute z-50 flex items-center gap-1.5 p-1.5 bg-gray-900 rounded-xl shadow-2xl animate-in fade-in zoom-in duration-200"
              style={{ top: toolbarPosition.top, left: toolbarPosition.left }}
            >
              {[
                { id: 'yellow', bg: 'bg-yellow-400' },
                { id: 'green', bg: 'bg-emerald-400' },
                { id: 'blue', bg: 'bg-sky-400' },
                { id: 'pink', bg: 'bg-pink-400' }
              ].map((color) => (
                <button
                  key={color.id}
                  onClick={() => addHighlight(color.id)}
                  className={`w-6 h-6 rounded-full ${color.bg} hover:scale-125 transition-transform shadow-sm border border-white/20`}
                  title={`Highlight ${color.id}`}
                />
              ))}
              <span className="w-px h-4 bg-white/20 mx-1" />
              <button 
                onClick={() => setShowToolbar(false)}
                className="p-1 text-white/70 hover:text-white transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          )}
        </span>
      ) : (
        <div className="relative group">
          <div 
            ref={containerRef}
            className={`highlightable-content whitespace-pre-wrap leading-relaxed text-[#30343C] text-base font-normal tracking-wide cursor-text ${className}`}
            style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
            onMouseUp={handleMouseUp}
          >
            {renderContent()}
          </div>

        {showToolbar && (
          <div 
            ref={toolbarRef as any}
            className="absolute z-50 flex items-center gap-1.5 p-1.5 bg-gray-900 rounded-xl shadow-2xl animate-in fade-in zoom-in duration-200"
            style={{ top: toolbarPosition.top, left: toolbarPosition.left }}
          >
            {[
              { id: 'yellow', bg: 'bg-yellow-400' },
              { id: 'green', bg: 'bg-emerald-400' },
              { id: 'blue', bg: 'bg-sky-400' },
              { id: 'pink', bg: 'bg-pink-400' }
            ].map((color) => (
              <button
                key={color.id}
                onClick={() => addHighlight(color.id)}
                className={`w-6 h-6 rounded-full ${color.bg} hover:scale-125 transition-transform shadow-sm border border-white/20`}
                title={`Highlight ${color.id}`}
              />
            ))}
            <div className="w-px h-4 bg-white/20 mx-1" />
            <button 
              onClick={() => setShowToolbar(false)}
              className="p-1 text-white/70 hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>
    )}

    <ConfirmationModal
        isOpen={!!highlightToRemove}
        onClose={() => setHighlightToRemove(null)}
        onConfirm={() => {
          if (highlightToRemove) {
            removeHighlight(highlightToRemove);
            setHighlightToRemove(null);
          }
        }}
        title="Remove Highlight"
        message="Are you sure you want to remove this highlight?"
        confirmText="Remove"
        variant="danger"
      />
    </>
  );
}
