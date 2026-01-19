'use client';

import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';

interface ResizablePanelProps {
  leftPanel: ReactNode;
  rightPanel: ReactNode;
  leftMinWidth?: number;
  rightMinWidth?: number;
  initialLeftWidth?: number;
}

export function ResizablePanel({
  leftPanel,
  rightPanel,
  leftMinWidth = 300,
  rightMinWidth = 400,
  initialLeftWidth = 65,
}: ResizablePanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftWidth, setLeftWidth] = useState(initialLeftWidth);
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = useCallback(() => {
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !containerRef.current) return;

    const container = containerRef.current;
    const containerRect = container.getBoundingClientRect();
    const containerWidth = containerRect.width;
    
    const newLeftWidth = ((e.clientX - containerRect.left) / containerWidth) * 100;
    
    // Calculate min percentages based on actual container width
    const minLeftPercent = (leftMinWidth / containerWidth) * 100;
    const maxLeftPercent = 100 - (rightMinWidth / containerWidth) * 100;
    
    if (newLeftWidth >= minLeftPercent && newLeftWidth <= maxLeftPercent) {
      setLeftWidth(newLeftWidth);
    }
  }, [isDragging, leftMinWidth, rightMinWidth]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div ref={containerRef} className="flex h-full w-full">
      {/* Left Panel */}
      <div 
        className="overflow-y-auto bg-white"
        style={{ width: `${leftWidth}%` }}
      >
        {leftPanel}
      </div>

      {/* Resizer Handle */}
      <div
        onMouseDown={handleMouseDown}
        className={`
          w-2 z-10 cursor-col-resize shrink-0 relative group
          transition-all duration-200 ease-in-out
          ${isDragging 
            ? 'bg-blue-300 ' 
            : 'bg-gray-200 hover:bg-blue-300'}
        `}
      >
        {/* Visual indicator / Grip */}
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 flex items-center justify-center pointer-events-none">
          <div className={`p-1 rounded-md transition-all duration-300 shadow-sm ${
            isDragging ? 'bg-white scale-110' : 'bg-gray-100 group-hover:bg-white group-hover:scale-110'
          }`}>
            <svg 
              className={`w-6 h-6 transition-colors duration-300 ${
                isDragging ? 'text-blue-500' : 'text-gray-600 group-hover:text-blue-500'
              }`} 
              fill="currentColor" 
              viewBox="0 0 24 24"
            >
              <path d="M18.41 11L15.82 8.41L17.24 7L22.24 12L17.24 17L15.82 15.59L18.41 13H5.59L8.18 15.59L6.76 17L1.76 12L6.76 7L8.18 8.41L5.59 11H18.41Z" />
            </svg>
          </div>
        </div>
        
        {/* Transparent hit area expansion */}
        <div className="absolute inset-y-0 -left-2 -right-2 cursor-col-resize" />
      </div>

      {/* Right Panel */}
      <div 
        className="flex-1 overflow-y-auto bg-gray-50"
        style={{ width: `${100 - leftWidth}%` }}
      >
        {rightPanel}
      </div>
    </div>
  );
}
