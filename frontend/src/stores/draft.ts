/** In-memory hand-off from History → editor ("Open in editor"). Not persisted. */
import { create } from "zustand";

import type { HistoryEntry } from "../types";

interface DraftState {
  draft: HistoryEntry | null;
  open: (entry: HistoryEntry) => void;
  take: (kind: HistoryEntry["kind"]) => HistoryEntry | null;
}

export const useDraft = create<DraftState>()((set, get) => ({
  draft: null,
  open: (entry) => {
    set({ draft: entry });
    window.location.hash = `#/${entry.kind}`;
  },
  take: (kind) => {
    const d = get().draft;
    if (!d || d.kind !== kind) return null;
    set({ draft: null });
    return d;
  },
}));
