import { create } from 'zustand';

export interface ExamNoteItem {
  sourceId: string;
  highlightId: string;
  start: number;
  end: number;
  quote: string;
  note: string;
  updatedAt: number;
}

export interface ExamNoteComposer {
  sourceId: string;
  highlightId?: string;
  start: number;
  end: number;
  quote: string;
  note: string;
}

interface ExamNotesState {
  notes: ExamNoteItem[];
  isSidebarOpen: boolean;
  composer: ExamNoteComposer | null;
  openSidebar: () => void;
  closeSidebar: () => void;
  setComposer: (composer: ExamNoteComposer | null) => void;
  setSourceNotes: (sourceId: string, notes: ExamNoteItem[]) => void;
  removeSourceNotes: (sourceId: string) => void;
  reset: () => void;
}

export const useExamNotesStore = create<ExamNotesState>((set) => ({
  notes: [],
  isSidebarOpen: false,
  composer: null,
  openSidebar: () => set({ isSidebarOpen: true }),
  closeSidebar: () => set({ isSidebarOpen: false }),
  setComposer: (composer) => set({ composer }),
  setSourceNotes: (sourceId, nextNotes) =>
    set((state) => ({
      notes: [
        ...state.notes.filter((note) => note.sourceId !== sourceId),
        ...nextNotes,
      ],
    })),
  removeSourceNotes: (sourceId) =>
    set((state) => ({
      notes: state.notes.filter((note) => note.sourceId !== sourceId),
      composer:
        state.composer && state.composer.sourceId === sourceId
          ? null
          : state.composer,
    })),
  reset: () => set({ notes: [], isSidebarOpen: false, composer: null }),
}));

export interface ExamNoteController {
  saveNote: (payload: {
    highlightId?: string;
    start: number;
    end: number;
    quote: string;
    note: string;
  }) => void;
  deleteNote: (highlightId: string) => void;
}

const noteControllerRegistry = new Map<string, ExamNoteController>();

export function registerExamNoteController(
  sourceId: string,
  controller: ExamNoteController,
): () => void {
  noteControllerRegistry.set(sourceId, controller);

  return () => {
    noteControllerRegistry.delete(sourceId);
  };
}

export function getExamNoteController(sourceId: string): ExamNoteController | undefined {
  return noteControllerRegistry.get(sourceId);
}
