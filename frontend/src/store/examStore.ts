import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface ExamState {
  // Session data
  assignmentId: string | null;
  answers: Record<string, string | string[] | Record<string, string>>;
  highlights: Record<string, { text: string; color: string }[]>;
  syncVersion: number;
  isSyncing: boolean;
  lastSyncedAt: Date | null;
  
  // Status
  status: 'idle' | 'active' | 'paused' | 'submitted' | 'error';
  error: string | null;
  
  // Timer
  remainingSeconds: number;
  isTimerRunning: boolean;
  
  // Tab management
  activeTabId: string | null;
  tabConflict: boolean;
}

interface ExamActions {
  // Session actions
  initializeSession: (assignmentId: string) => void;
  setAnswer: (questionId: string, answer: string | string[] | Record<string, string>) => void;
  setHighlights: (passageId: string, highlights: { text: string; color: string }[]) => void;
  
  // Sync actions
  startSync: () => void;
  syncComplete: (newVersion: number) => void;
  syncError: (error: string) => void;
  
  // Status actions
  setStatus: (status: ExamState['status']) => void;
  setError: (error: string | null) => void;
  
  // Timer actions
  setRemainingSeconds: (seconds: number) => void;
  startTimer: () => void;
  pauseTimer: () => void;
  decrementTimer: () => void;
  
  // Tab actions
  setActiveTab: (tabId: string) => void;
  setTabConflict: (conflict: boolean) => void;
  
  // Reset
  reset: () => void;
  resetSession: (assignmentId?: string) => void;
}

const initialState: Omit<ExamState, keyof ExamActions> = {
  assignmentId: null,
  answers: {},
  highlights: {},
  syncVersion: 0,
  isSyncing: false,
  lastSyncedAt: null,
  status: 'idle',
  error: null,
  remainingSeconds: 0,
  isTimerRunning: false,
  activeTabId: null,
  tabConflict: false,
};

export const useExamStore = create<ExamState & ExamActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      initializeSession: (id: string) => {
        const { assignmentId } = get();
        
        // If it's a new or different assignment, clear previous local state
        if (id !== assignmentId) {
          set({
            assignmentId: id,
            answers: {},
            highlights: {},
            syncVersion: 0,
            isSyncing: false,
            status: 'active',
            error: null,
          });
        } else {
          set({
            status: 'active',
            error: null,
          });
        }
      },

      setAnswer: (questionId: string, answer: string | string[] | Record<string, string>) => {
        set((state) => ({
          answers: { ...state.answers, [questionId]: answer },
        }));
      },

      setHighlights: (passageId: string, highlights: { text: string; color: string }[]) => {
        set((state) => ({
          highlights: { ...state.highlights, [passageId]: highlights },
        }));
      },

      startSync: () => {
        set({ isSyncing: true });
      },

      syncComplete: (newVersion: number) => {
        set({
          syncVersion: newVersion,
          isSyncing: false,
          lastSyncedAt: new Date(),
          error: null,
        });
      },

      syncError: (error: string) => {
        set({
          isSyncing: false,
          error,
        });
      },

      setStatus: (status: ExamState['status']) => {
        set({ status });
      },

      setError: (error: string | null) => {
        set({ error });
      },

      setRemainingSeconds: (seconds: number) => {
        set({ remainingSeconds: seconds });
      },

      startTimer: () => {
        set({ isTimerRunning: true });
      },

      pauseTimer: () => {
        set({ isTimerRunning: false });
      },

      decrementTimer: () => {
        set((state) => ({
          remainingSeconds: Math.max(0, state.remainingSeconds - 1),
        }));
      },

      setActiveTab: (tabId: string) => {
        set({ activeTabId: tabId });
      },

      setTabConflict: (conflict: boolean) => {
        set({ tabConflict: conflict });
      },

      reset: () => {
        set(initialState);
      },
      resetSession: (assignmentId?: string) => {
        const { activeTabId } = get();
        set({
          ...initialState,
          assignmentId: assignmentId ?? null,
          activeTabId,
        });
      },
    }),
    {
      name: 'exam-session-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        assignmentId: state.assignmentId,
        answers: state.answers,
        highlights: state.highlights,
        syncVersion: state.syncVersion,
        remainingSeconds: state.remainingSeconds,
        status: state.status,
      }),
    }
  )
);

// Selector hooks for better performance
export const useExamAnswers = () => useExamStore((state) => state.answers);
export const useExamStatus = () => useExamStore((state) => state.status);
export const useExamTimer = () => useExamStore((state) => ({
  remainingSeconds: state.remainingSeconds,
  isTimerRunning: state.isTimerRunning,
}));
export const useExamSync = () => useExamStore((state) => ({
  syncVersion: state.syncVersion,
  isSyncing: state.isSyncing,
  lastSyncedAt: state.lastSyncedAt,
}));
