/**
 * ZERO-PERSISTENCE credential store.
 *
 * Plain Zustand store WITHOUT the persist middleware: endpoints and API keys exist
 * only in this tab's memory. Refreshing or closing the page erases them. They are
 * never written to any browser storage, cookie, or URL.
 *
 * A CI guard test (backend/tests/guard) fails if this file ever gains persistence.
 * Forks that add credential persistence violate project policy.
 */
import { create } from "zustand";

import type { Endpoint, FetchedModel } from "../types";

interface CredentialState {
  endpoints: Endpoint[];
  models: Record<string, FetchedModel[]>;
  addEndpoint: (e: Omit<Endpoint, "id">) => Endpoint;
  updateEndpoint: (id: string, patch: Partial<Omit<Endpoint, "id">>) => void;
  removeEndpoint: (id: string) => void;
  setModels: (endpointId: string, models: FetchedModel[]) => void;
  /** Re-create endpoints from the session cache: label + URL only, the key is ALWAYS empty. */
  restoreEndpoints: (list: { id: string; label: string; baseUrl: string }[], models: Record<string, FetchedModel[]>) => void;
  clearAll: () => void;
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

export const useCredentials = create<CredentialState>()((set) => ({
  endpoints: [],
  models: {},
  addEndpoint: (e) => {
    const endpoint: Endpoint = { ...e, id: newId() };
    set((s) => ({ endpoints: [...s.endpoints, endpoint] }));
    return endpoint;
  },
  updateEndpoint: (id, patch) =>
    set((s) => ({
      endpoints: s.endpoints.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      models: patch.baseUrl || patch.apiKey !== undefined ? omit(s.models, id) : s.models,
    })),
  removeEndpoint: (id) =>
    set((s) => ({ endpoints: s.endpoints.filter((e) => e.id !== id), models: omit(s.models, id) })),
  setModels: (endpointId, models) => set((s) => ({ models: { ...s.models, [endpointId]: models } })),
  restoreEndpoints: (list, models) =>
    set((s) =>
      s.endpoints.length > 0
        ? s
        : { endpoints: list.map((e) => ({ id: e.id, label: e.label, baseUrl: e.baseUrl, apiKey: "" })), models },
    ),
  clearAll: () => set({ endpoints: [], models: {} }),
}));

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

export function endpointLabel(e: Endpoint): string {
  if (e.label.trim()) return e.label.trim();
  try {
    return new URL(e.baseUrl).host;
  } catch {
    return e.baseUrl;
  }
}
