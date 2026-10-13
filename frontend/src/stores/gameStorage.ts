/**
 * Session storage budget per workspace (Playground / Arena / History view) + the data
 * games save through the in-iframe localStorage shim. Memory-only: refresh clears it.
 */
import { createContext } from "react";
import { create } from "zustand";

import { storageBytes } from "../lib/game";

export const SESSION_LIMIT_BYTES = 50 * 1024 * 1024;

export type Scope = "playground" | "arena" | "history";

/** Which workspace a rendered output belongs to (for game storage accounting). */
export const ScopeContext = createContext<Scope>("playground");

type GameData = Record<string, Record<string, string>>; // gameId → key → value

interface GameStorageState {
  data: Record<Scope, GameData>;
  get: (scope: Scope, gameId: string) => Record<string, string>;
  apply: (scope: Scope, gameId: string, op: "set" | "remove" | "clear", key?: string, value?: string) => void;
  clearScope: (scope: Scope) => void;
}

export const useGameStorage = create<GameStorageState>()((set, get) => ({
  data: { playground: {}, arena: {}, history: {} },
  get: (scope, gameId) => get().data[scope][gameId] ?? {},
  apply: (scope, gameId, op, key, value) =>
    set((s) => {
      const game = { ...(s.data[scope][gameId] ?? {}) };
      if (op === "clear") for (const k of Object.keys(game)) delete game[k];
      else if (op === "remove" && key !== undefined) delete game[key];
      else if (op === "set" && key !== undefined && value !== undefined) game[key] = value;
      return { data: { ...s.data, [scope]: { ...s.data[scope], [gameId]: game } } };
    }),
  clearScope: (scope) => set((s) => ({ data: { ...s.data, [scope]: {} } })),
}));

export function gameBytes(data: GameData): number {
  let n = 0;
  for (const game of Object.values(data)) n += storageBytes(game);
  return n;
}
