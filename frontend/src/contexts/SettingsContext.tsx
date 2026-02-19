'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

type ContrastMode = 'standard' | 'high';
type FontSize = 14 | 16 | 18 | 20;

const ALLOWED_FONT_SIZES: FontSize[] = [14, 16, 18, 20];

const readInitialContrast = (): ContrastMode => {
  if (typeof window === 'undefined') {
    return 'standard';
  }

  const saved = localStorage.getItem('exam-contrast');
  return saved === 'high' ? 'high' : 'standard';
};

const readInitialFontSize = (): FontSize => {
  if (typeof window === 'undefined') {
    return 16;
  }

  const parsed = Number(localStorage.getItem('exam-font-size') || '16');
  return ALLOWED_FONT_SIZES.includes(parsed as FontSize)
    ? (parsed as FontSize)
    : 16;
};

const readInitialTimerEnabled = (): boolean => {
  if (typeof window === 'undefined') {
    return true;
  }

  const saved = localStorage.getItem('exam-timer-enabled');
  if (saved === null) {
    return true;
  }

  return saved !== 'false';
};

interface SettingsContextType {
  contrast: ContrastMode;
  fontSize: FontSize;
  timerEnabled: boolean;
  setContrast: (mode: ContrastMode) => void;
  setFontSize: (size: FontSize) => void;
  setTimerEnabled: (enabled: boolean) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [contrast, setContrast] = useState<ContrastMode>(readInitialContrast);
  const [fontSize, setFontSize] = useState<FontSize>(readInitialFontSize);
  const [timerEnabled, setTimerEnabled] = useState<boolean>(readInitialTimerEnabled);

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
    localStorage.setItem('exam-timer-enabled', timerEnabled ? 'true' : 'false');
  }, [contrast, fontSize, timerEnabled]);

  return (
    <SettingsContext.Provider
      value={{
        contrast,
        fontSize,
        timerEnabled,
        setContrast,
        setFontSize,
        setTimerEnabled,
      }}
    >
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
