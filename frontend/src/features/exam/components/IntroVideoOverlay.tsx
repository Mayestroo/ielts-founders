'use client';

import { RefObject } from 'react';

interface IntroVideoOverlayProps {
  isOpen: boolean;
  sectionType?: string | null;
  introVideoRef: RefObject<HTMLVideoElement>;
  containerRef: RefObject<HTMLDivElement>;
  isAutoplayBlocked: boolean;
  onAutoplayBlockedChange: (blocked: boolean) => void;
  onEnded: () => void;
  onRequestFullscreen?: () => Promise<void>;
}

export function IntroVideoOverlay({
  isOpen,
  sectionType,
  introVideoRef,
  containerRef,
  isAutoplayBlocked,
  onAutoplayBlockedChange,
  onEnded,
  onRequestFullscreen,
}: IntroVideoOverlayProps) {
  if (!isOpen || !sectionType) return null;

  const videoSource = `/videos/${sectionType.toLowerCase()}.mp4`;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 bg-black z-200 flex items-center justify-center overflow-hidden"
    >
      <video
        ref={introVideoRef}
        autoPlay
        playsInline
        onEnded={onEnded}
        onPlay={() => onAutoplayBlockedChange(false)}
        onLoadStart={() => console.log('Video loading:', sectionType)}
        onCanPlay={() => console.log('Video can play:', sectionType)}
        className="w-full h-full object-cover"
      >
        <source src={videoSource} type="video/mp4" />
        Your browser does not support the video tag.
      </video>

      {isAutoplayBlocked && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-10">
          <button
            onClick={() => {
              if (introVideoRef.current) {
                if (!document.fullscreenElement) {
                  onRequestFullscreen?.();
                }
                introVideoRef.current
                  .play()
                  .catch((error) => console.warn('Manual play failed:', error));
                onAutoplayBlockedChange(false);
              }
            }}
            className="px-8 py-4 bg-white text-black rounded-full font-bold flex items-center gap-2 hover:bg-gray-100 transition-all scale-110 shadow-2xl"
          >
            <svg
              className="w-6 h-6"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
            </svg>
            Play Introduction
          </button>
          <p className="text-white/60 mt-4 text-sm font-medium">
            Sound is required for this introduction
          </p>
        </div>
      )}
    </div>
  );
}
