/** UI preferences only (retention mode, contribute default). Nothing sensitive is kept here. */
import { create } from "zustand";

export type Retention = "ephemeral" | "local";

const KEY = "sandroid.prefs.v1";

interface Prefs {
  retention: Retention;
  contribute: boolean;
  /** tell models that HTML/JS they write is executed in this app's browser sandbox */
  runtimeHint: boolean;
  /** keep the workspace (not API keys) across refreshes for this many hours; 0 = off */
  cacheHours: number;
  setCacheHours: (h: number) => void;
  setRetention: (r: Retention) => void;
  setContribute: (c: boolean) => void;
  setRuntimeHint: (v: boolean) => void;
}

function initial(): Pick<Prefs, "retention" | "contribute" | "runtimeHint" | "cacheHours"> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>;
    return {
      retention: raw.retention === "local" ? "local" : "ephemeral",
      contribute: raw.contribute !== false,
      runtimeHint: raw.runtimeHint !== false,
      cacheHours: clampHours(raw.cacheHours),
    };
  } catch {
    return { retention: "ephemeral", contribute: true, runtimeHint: true, cacheHours: 0 };
  }
}

export const usePrefs = create<Prefs>()((set, get) => {
  const persist = (patch: Partial<Prefs>) => {
    set(patch);
    const { retention, contribute, runtimeHint, cacheHours } = { ...get(), ...patch };
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ retention, contribute, runtimeHint, cacheHours }));
    } catch {
      /* storage unavailable */
    }
  };
  return {
    ...(typeof window === "undefined" ? { retention: "ephemeral" as const, contribute: true, runtimeHint: true, cacheHours: 0 } : initial()),
    setCacheHours: (h) => persist({ cacheHours: clampHours(h) }),
    setRetention: (retention) => persist({ retention }),
    setContribute: (contribute) => persist({ contribute }),
    setRuntimeHint: (runtimeHint) => persist({ runtimeHint }),
  };
});

function clampHours(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(24, Math.max(0, Math.round(n))) : 0;
}
