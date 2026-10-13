/**
 * Client-side run history (opt-in). Stored in this browser only; never sent to the server.
 * Entries are sanitized so no key/credential field can ever be saved or imported.
 */
import { create } from "zustand";

import { EXPORT_SCHEMA, type ExportFile, type HistoryEntry } from "../types";

export const HISTORY_LIMIT = 200;
const STORAGE_KEY = "sandroid.history.v1";
const FORBIDDEN_FIELDS = /^(api_?key|apikey|key|token|secret|password|authorization|headers?)$/i;

/** Deep-copy dropping any credential-looking field, whatever the nesting. */
export function sanitize<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sanitize) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!FORBIDDEN_FIELDS.test(k)) out[k] = sanitize(v);
    }
    return out as T;
  }
  return value;
}

function load(): HistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed.filter(isEntry).map(sanitize) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function save(entries: HistoryEntry[]): string | null {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    return null;
  } catch {
    return "quota";
  }
}

function isEntry(v: unknown): v is HistoryEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Partial<HistoryEntry>;
  return (
    typeof e.id === "string" &&
    (e.kind === "playground" || e.kind === "arena") &&
    typeof e.createdAt === "string" &&
    !!e.config &&
    typeof e.config === "object" &&
    Array.isArray(e.results)
  );
}

export function buildExport(runs: HistoryEntry[]): ExportFile {
  return { schema: EXPORT_SCHEMA, exported_at: new Date().toISOString(), runs: sanitize(runs) };
}

export class ImportError extends Error {}

export function parseImport(text: string): HistoryEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError("invalid_json");
  }
  const file = data as Partial<ExportFile>;
  if (!file || typeof file !== "object" || file.schema !== EXPORT_SCHEMA) throw new ImportError("unsupported_schema");
  if (!Array.isArray(file.runs)) throw new ImportError("invalid_runs");
  const runs = file.runs.filter(isEntry);
  if (runs.length !== file.runs.length) throw new ImportError("invalid_runs");
  return sanitize(runs);
}

interface HistoryState {
  entries: HistoryEntry[];
  lastError: string | null;
  add: (entry: HistoryEntry) => void;
  merge: (entries: HistoryEntry[]) => number;
  remove: (id: string) => void;
  clear: () => void;
}

export const useHistory = create<HistoryState>()((set, get) => ({
  entries: typeof window === "undefined" ? [] : load(),
  lastError: null,
  add: (entry) => {
    const entries = [sanitize(entry), ...get().entries].slice(0, HISTORY_LIMIT); // FIFO: oldest dropped
    set({ entries, lastError: save(entries) });
  },
  merge: (incoming) => {
    const known = new Set(get().entries.map((e) => e.id));
    const fresh = incoming.filter((e) => !known.has(e.id));
    const entries = [...fresh, ...get().entries]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, HISTORY_LIMIT);
    set({ entries, lastError: save(entries) });
    return fresh.length;
  },
  remove: (id) => {
    const entries = get().entries.filter((e) => e.id !== id);
    set({ entries, lastError: save(entries) });
  },
  clear: () => {
    window.localStorage.removeItem(STORAGE_KEY);
    set({ entries: [], lastError: null });
  },
}));

export function historyBytes(entries: HistoryEntry[]): number {
  return new Blob([JSON.stringify(entries)]).size;
}

export function downloadJson(filename: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
