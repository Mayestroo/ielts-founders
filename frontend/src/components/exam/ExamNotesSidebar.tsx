'use client';

import {
  getExamNoteController,
  useExamNotesStore,
} from '@/store/examNotesStore';
import { useMemo } from 'react';

interface SidebarEntry {
  key: string;
  sourceId: string;
  highlightId?: string;
  start: number;
  end: number;
  quote: string;
  note: string;
  updatedAt: number;
  isComposerDraft: boolean;
}

function getEntryKey(entry: SidebarEntry): string {
  return entry.isComposerDraft
    ? `composer-${entry.sourceId}-${entry.start}-${entry.end}`
    : `${entry.sourceId}:${entry.highlightId}`;
}

export function ExamNotesSidebar() {
  const notes = useExamNotesStore((state) => state.notes);
  const isSidebarOpen = useExamNotesStore((state) => state.isSidebarOpen);
  const composer = useExamNotesStore((state) => state.composer);
  const closeSidebar = useExamNotesStore((state) => state.closeSidebar);
  const setComposer = useExamNotesStore((state) => state.setComposer);

  const entries = useMemo<SidebarEntry[]>(() => {
    const sorted = [...notes].sort((left, right) => right.updatedAt - left.updatedAt);

    if (!composer) {
      return sorted.map((note) => ({
        key: `${note.sourceId}:${note.highlightId}`,
        sourceId: note.sourceId,
        highlightId: note.highlightId,
        start: note.start,
        end: note.end,
        quote: note.quote,
        note: note.note,
        updatedAt: note.updatedAt,
        isComposerDraft: false,
      }));
    }

    const selectedExisting = composer.highlightId
      ? sorted.find(
          (note) =>
            note.sourceId === composer.sourceId &&
            note.highlightId === composer.highlightId,
        )
      : undefined;

    const withoutSelected = selectedExisting
      ? sorted.filter((note) => note !== selectedExisting)
      : sorted;

    const selectedEntry: SidebarEntry = {
      key: selectedExisting
        ? `${selectedExisting.sourceId}:${selectedExisting.highlightId}`
        : `composer-${composer.sourceId}-${composer.start}-${composer.end}`,
      sourceId: composer.sourceId,
      highlightId: selectedExisting?.highlightId,
      start: composer.start,
      end: composer.end,
      quote: composer.quote,
      note: composer.note,
      updatedAt: selectedExisting?.updatedAt || 0,
      isComposerDraft: !selectedExisting,
    };

    return [
      selectedEntry,
      ...withoutSelected.map((note) => ({
        key: `${note.sourceId}:${note.highlightId}`,
        sourceId: note.sourceId,
        highlightId: note.highlightId,
        start: note.start,
        end: note.end,
        quote: note.quote,
        note: note.note,
        updatedAt: note.updatedAt,
        isComposerDraft: false,
      })),
    ];
  }, [composer, notes]);

  const totalCount = notes.length + (composer && !composer.highlightId ? 1 : 0);

  const handleSave = (entry: SidebarEntry, noteValue: string) => {
    const value = noteValue.trim();

    if (!value) {
      return;
    }

    const controller = getExamNoteController(entry.sourceId);
    if (!controller) {
      return;
    }

    controller.saveNote({
      highlightId: entry.highlightId,
      start: entry.start,
      end: entry.end,
      quote: entry.quote,
      note: value,
    });

    if (composer && composer.sourceId === entry.sourceId) {
      const isSameDraft =
        composer.start === entry.start && composer.end === entry.end;
      if (isSameDraft) {
        setComposer(null);
      }
    }
  };

  const handleDelete = (entry: SidebarEntry) => {
    if (!entry.highlightId) {
      if (
        composer &&
        composer.sourceId === entry.sourceId &&
        composer.start === entry.start &&
        composer.end === entry.end
      ) {
        setComposer(null);
      }
      return;
    }

    const controller = getExamNoteController(entry.sourceId);
    if (!controller) {
      return;
    }

    controller.deleteNote(entry.highlightId);

    if (
      composer &&
      composer.sourceId === entry.sourceId &&
      composer.highlightId === entry.highlightId
    ) {
      setComposer(null);
    }
  };

  if (!isSidebarOpen) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={closeSidebar}
        aria-label="Close notes sidebar overlay"
        className="fixed inset-0 z-[119] bg-transparent"
      />

      <aside className="fixed top-0 right-0 z-[120] h-screen w-[360px] max-w-[95vw] border-l border-[#D5D7DB] bg-[#ECECEC]">
        <div className="h-14 border-b border-[#D5D7DB] flex items-center justify-between px-4">
        <div className="flex items-center gap-2 font-semibold text-[#111827]">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5v12A1.5 1.5 0 0 1 17.5 18h-6.2L6.8 21a.5.5 0 0 1-.8-.4V18h-.5A1.5 1.5 0 0 1 4 16.5v-12Z" />
          </svg>
          <span className="text-lg leading-none">Notes ({totalCount})</span>
        </div>

        <button
          type="button"
          onClick={closeSidebar}
          className="p-1 text-[#111827] hover:opacity-70"
          aria-label="Close notes sidebar"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        </div>

        <div className="h-[calc(100vh-56px)] overflow-y-auto p-6">
          <div className="space-y-5">
          {entries.length === 0 && (
            <div className="rounded-xl border border-[#DADDE3] bg-white px-4 py-5 text-sm text-[#6B7280]">
              No notes yet.
            </div>
          )}

            {entries.map((entry) => {
            const key = getEntryKey(entry);

              return (
                <article key={key} className="rounded-xl border border-[#DADDE3] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.08)]">
                <div className="mb-3 rounded-md bg-[#E9EDF3] px-3 py-2 border-l-4 border-[#3B82F6]">
                  <p className="text-sm italic text-[#4B5563] leading-relaxed">&ldquo;{entry.quote}&rdquo;</p>
                </div>

                <textarea
                  defaultValue={entry.note}
                  onChange={(event) => {
                    const value = event.target.value;

                    if (
                      composer &&
                      composer.sourceId === entry.sourceId &&
                      composer.start === entry.start &&
                      composer.end === entry.end
                    ) {
                      setComposer({ ...composer, note: value });
                    }
                  }}
                  onBlur={(event) => handleSave(entry, event.target.value)}
                  className="w-full min-h-[130px] resize-y rounded-md border border-[#3B82F6] bg-[#F9FAFB] px-3 py-2 text-sm text-[#111827] outline-none focus:ring-2 focus:ring-[#3B82F6]/25"
                />

                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleDelete(entry)}
                    className="inline-flex items-center gap-1.5 text-[#FF313D] font-semibold hover:text-[#E11D48]"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M9 3.75h6a1 1 0 0 1 1 1V6h4v2h-1v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8H4V6h4V4.75a1 1 0 0 1 1-1Zm1 2V6h4v-.25h-4ZM7 8v11h10V8H7Z" />
                    </svg>
                    <span className="text-sm leading-none">Delete</span>
                  </button>
                </div>
                </article>
              );
            })}
          </div>
        </div>
      </aside>
    </>
  );
}
