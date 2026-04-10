'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useTimer } from '@/hooks/useTimer';
import Image from 'next/image';

interface ExamHeaderProps {
  title: string;
  remainingSeconds: number;
  sectionType: 'READING' | 'LISTENING' | 'WRITING' | 'SPEAKING';
  isAudioPlaying?: boolean;
  autoStart?: boolean;
  showTimer?: boolean;
  noteCount?: number;
  onOpenNotes?: () => void;
  onTimerExpire: () => void;
  onOpenSettings: () => void;
}

export function ExamHeader({
  title,
  remainingSeconds,
  sectionType,
  isAudioPlaying = false,
  autoStart = true,
  showTimer = true,
  noteCount = 0,
  onOpenNotes,
  onTimerExpire,
  onOpenSettings,
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
            <Image
              src="/logo.png"
              alt="logo"
              width={144}
              height={48}
              className="object-contain"
              style={{ width: 'auto', height: 'auto' }}
              priority
            />
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
          {showTimer && (
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
          )}

          {onOpenNotes && (
            <button
              type="button"
              onClick={onOpenNotes}
              className="relative p-2.5 bg-[#ECEEF1] hover:bg-[#E3E6EB] text-[#3F444D] rounded-2xl transition-all border border-[#D6DAE0] shadow-[0_2px_5px_rgba(15,23,42,0.12)] active:scale-95"
              title="Open notes"
              aria-label="Open notes"
            >
              <svg
                className="w-[22px] h-[22px]"
                viewBox="0 0 32 32"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M24.98 30.009h-23v-25h14.050l2.022-1.948-0.052-0.052h-16.020c-1.105 0-2 0.896-2 2v25c0 1.105 0.895 2 2 2h23c1.105 0 2-0.895 2-2v-14.646l-2 1.909v12.736zM30.445 1.295c-0.902-0.865-1.898-1.304-2.961-1.304-1.663 0-2.876 1.074-3.206 1.403-0.468 0.462-13.724 13.699-13.724 13.699-0.104 0.106-0.18 0.235-0.219 0.38-0.359 1.326-2.159 7.218-2.176 7.277-0.093 0.302-0.010 0.631 0.213 0.851 0.159 0.16 0.373 0.245 0.591 0.245 0.086 0 0.172-0.012 0.257-0.039 0.061-0.020 6.141-1.986 7.141-2.285 0.132-0.039 0.252-0.11 0.351-0.207 0.631-0.623 12.816-12.618 13.802-13.637 1.020-1.052 1.526-2.146 1.507-3.253-0.019-1.094-0.55-2.147-1.575-3.129zM29.076 6.285c-0.556 0.574-4.914 4.88-12.952 12.798l-0.615 0.607c-0.921 0.285-3.128 0.994-4.796 1.532 0.537-1.773 1.181-3.916 1.469-4.929 1.717-1.715 13.075-13.055 13.506-13.48 0.084-0.084 0.851-0.821 1.795-0.821 0.536 0 1.053 0.244 1.577 0.748 0.627 0.602 0.95 1.179 0.959 1.72 0.010 0.556-0.308 1.171-0.943 1.827z" />
              </svg>
              {noteCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#FF313D] text-white text-[10px] font-bold leading-[18px]">
                  {noteCount > 99 ? '99+' : noteCount}
                </span>
              )}
            </button>
          )}

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
