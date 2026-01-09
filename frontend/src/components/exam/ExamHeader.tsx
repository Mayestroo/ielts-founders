'use client';

import Image from 'next/image';
import { useAuth } from '@/contexts/AuthContext';
import { useTimer } from '@/hooks/useTimer';

interface ExamHeaderProps {
  title: string;
  remainingSeconds: number;
  sectionType: 'READING' | 'LISTENING' | 'WRITING';
  isAudioPlaying?: boolean;
  autoStart?: boolean;
  onTimerExpire: () => void;
  onOpenSettings: () => void;
}

export function ExamHeader({ 
  title, 
  remainingSeconds, 
  sectionType,
  isAudioPlaying = false,
  autoStart = true,
  onTimerExpire,
  onOpenSettings
}: ExamHeaderProps) {
  const { user } = useAuth();
  const { formattedTime, isUrgent, isCritical } = useTimer({
    initialSeconds: remainingSeconds,
    onExpire: onTimerExpire,
    autoStart: autoStart,
  });

  const fullName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'IELTS Student';

  return (
    <header className="fixed top-0 left-0 right-0 h-16 bg-white border-b border-gray-200 z-50 shadow-sm">
      <div className="h-full  mx-auto px-4 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-4">
          <div className="w-36 h-12 rounded-xl flex items-center justify-center ">
            <Image src="/logo.png" alt="logo" width={144} height={48} className="object-contain" priority />
          </div>
          <div className="hidden sm:block">
            <h1 className="font-bold text-black text-sm uppercase leading-tight">{fullName || 'IELTS Mock'}</h1>
            <p className="text-xs text-black opacity-60 font-medium">{user?.username || title}</p>
          </div>
        </div>

        {/* Right - Timer and Audio */}
        <div className="flex items-center gap-4">
          {/* Audio indicator for Listening */}
          {sectionType === 'LISTENING' && (
            <div className={`flex items-center gap-2.5 ${isAudioPlaying ? 'text-black' : 'text-gray-300'}`}>
              <svg className="w-5 h-5 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 5L6 9H2v6h4l5 4V5z" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" className={isAudioPlaying ? 'opacity-100' : 'opacity-30'} />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" className={isAudioPlaying ? 'opacity-60' : 'opacity-10'} />
              </svg>
              
              {isAudioPlaying && (
                <div className="flex items-end gap-0.75 h-4 mb-0.5">
                  <span className="w-0.75 bg-black rounded-full animate-[equalizer_0.8s_ease-in-out_infinite]" />
                  <span className="w-0.75 bg-black rounded-full animate-[equalizer_0.8s_ease-in-out_0.2s_infinite]" />
                  <span className="w-0.75 bg-black rounded-full animate-[equalizer_0.8s_ease-in-out_0.4s_infinite]" />
                </div>
              )}
            </div>
          )}

          <style jsx>{`
            @keyframes equalizer {
              0%, 100% { height: 6px; }
              50% { height: 14px; }
            }
          `}</style>

          {/* Timer */}
          <div className={`
            flex items-center gap-2 px-4 py-2 rounded-xl font-mono text-lg font-bold
            ${isCritical ? 'bg-black text-white animate-pulse' : ''}
            ${isUrgent && !isCritical ? 'bg-gray-100 text-black border-2 border-black' : ''}
            ${!isUrgent && !isCritical ? 'bg-white text-black border-2 border-black' : ''}
          `}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {formattedTime}
          </div>

          {/* Settings Hamburger */}
          <button
            onClick={onOpenSettings}
            className="p-2.5 bg-gray-100 hover:bg-black hover:text-white rounded-xl transition-all border border-gray-200 shadow-sm active:scale-90"
            title="Accessibility Settings"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
