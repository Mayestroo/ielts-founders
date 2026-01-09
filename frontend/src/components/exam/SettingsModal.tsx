'use client';

import { useSettings } from '@/contexts/SettingsContext';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { contrast, setContrast, fontSize, setFontSize } = useSettings();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal Content */}
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden text-black animate-in fade-in zoom-in duration-200">
        <div className="p-6">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-bold tracking-tight">Accessibility</h2>
            <button 
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="space-y-8">
            {/* Contrast Setting */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center">
                  <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="9" strokeWidth="2" />
                    <path d="M12 3v18" strokeWidth="2" />
                    <path d="M12 3c4.97 0 9 4.03 9 9s-4.03 9-9 9" fill="currentColor" className="opacity-10" />
                  </svg>
                </div>
                <span className="font-semibold text-gray-700">Contrast</span>
              </div>
              
              <div className="grid grid-cols-2 gap-3 p-1 bg-gray-50 rounded-xl border border-gray-100">
                <button
                  onClick={() => setContrast('standard')}
                  style={{ 
                    backgroundColor: contrast === 'standard' ? 'var(--exam-active-bg)' : 'transparent',
                    color: contrast === 'standard' ? 'var(--exam-active-text)' : 'inherit'
                  }}
                  className={`
                    flex flex-col items-center gap-2 py-3 rounded-lg transition-all
                    ${contrast === 'standard' ? 'shadow-sm ring-1 ring-black/5' : 'text-gray-500 hover:text-gray-900'}
                  `}
                >
                  <div className="w-10 h-6 rounded flex border border-gray-200 overflow-hidden bg-white">
                    <div className="w-1/2 bg-white" style={{ backgroundColor: '#ffffff' }} />
                    <div className="w-1/2 bg-gray-100" style={{ backgroundColor: '#f3f4f6' }} />
                  </div>
                  <span className="text-xs font-bold uppercase tracking-wider">Standard</span>
                </button>
                <button
                  onClick={() => setContrast('high')}
                  style={{ 
                    backgroundColor: contrast === 'high' ? 'var(--exam-active-bg)' : 'transparent',
                    color: contrast === 'high' ? 'var(--exam-active-text)' : 'inherit'
                  }}
                  className={`
                    flex flex-col items-center gap-2 py-3 rounded-lg transition-all
                    ${contrast === 'high' ? 'shadow-lg scale-[1.02]' : 'text-gray-500 hover:text-gray-900'}
                  `}
                >
                  <div className="w-10 h-6 rounded flex border border-white/20 overflow-hidden bg-black">
                    <div className="w-1/2 bg-black" style={{ backgroundColor: '#000000' }} />
                    <div className="w-1/2 bg-gray-800" style={{ backgroundColor: '#1f2937' }} />
                  </div>
                  <span className="text-xs font-bold uppercase tracking-wider">High</span>
                </button>
              </div>
            </div>

            {/* Font Size Setting */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center">
                  <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8V6a2 2 0 012-2h14a2 2 0 012 2v2M7 20h10m-5-10V4m0 16V4m-6 4h12" />
                  </svg>
                </div>
                <span className="font-semibold text-gray-700">Text Size</span>
              </div>
              
              <div className="flex items-center justify-between gap-1 p-1 bg-gray-50 rounded-xl border border-gray-100">
                {[14, 16, 18, 20].map((size) => (
                  <button
                    key={size}
                    onClick={() => setFontSize(size as any)}
                    style={{ 
                      backgroundColor: fontSize === size ? 'var(--exam-active-bg)' : 'transparent',
                      color: fontSize === size ? 'var(--exam-active-text)' : 'inherit'
                    }}
                    className={`
                      flex-1 py-3 px-2 rounded-lg transition-all
                      ${fontSize === size ? 'shadow-sm ring-1 ring-black/5 font-bold' : 'text-gray-400 hover:text-gray-900 font-medium'}
                    `}
                  >
                    <span style={{ fontSize: `${size}px` }}>A</span>
                  </button>
                ))}
              </div>
              <div className="flex justify-between px-2 mt-2">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Small</span>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter text-right">Large</span>
              </div>
            </div>
          </div>
        </div>
        
        <div className="p-4 bg-gray-50 border-t border-gray-100">
          <button 
            onClick={onClose}
            className="w-full py-3 px-4 bg-black text-white font-bold rounded-xl hover:scale-[1.02] active:scale-95 transition-all shadow-lg"
          >
            Apply Settings
          </button>
        </div>
      </div>
    </div>
  );
}
