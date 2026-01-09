'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

type ContrastMode = 'standard' | 'high';
type FontSize = 14 | 16 | 18 | 20;

interface SettingsContextType {
  contrast: ContrastMode;
  fontSize: FontSize;
  setContrast: (mode: ContrastMode) => void;
  setFontSize: (size: FontSize) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [contrast, setContrast] = useState<ContrastMode>('standard');
  const [fontSize, setFontSize] = useState<FontSize>(16);

  // Initialize from localStorage
  useEffect(() => {
    const savedContrast = localStorage.getItem('exam-contrast') as ContrastMode;
    const savedFontSize = parseInt(localStorage.getItem('exam-font-size') || '16') as FontSize;
    
    if (savedContrast) setContrast(savedContrast);
    if (savedFontSize) setFontSize(savedFontSize);
  }, []);

  // Apply contrast and font size to document
  useEffect(() => {
    const root = document.documentElement;
    
    // Apply contrast
    if (contrast === 'high') {
      root.classList.add('high-contrast');
    } else {
      root.classList.remove('high-contrast');
    }
    
    // Apply font size
    root.style.setProperty('--exam-base-font-size', `${fontSize}px`);
    
    // Save to localStorage
    localStorage.setItem('exam-contrast', contrast);
    localStorage.setItem('exam-font-size', fontSize.toString());
  }, [contrast, fontSize]);

  return (
    <SettingsContext.Provider value={{ contrast, fontSize, setContrast, setFontSize }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
