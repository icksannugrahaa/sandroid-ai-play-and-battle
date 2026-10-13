/** Playback metadata per challenge (no three.js here, so cards can use it before the 3D chunk loads). */
import type { Verdict } from "../types";

interface Playback {
  /** steps in the model's answer replay (0 = nothing to animate) */
  steps: (data: unknown, replay: unknown) => number;
  /** caption after step k (1-based) */
  caption?: (data: unknown, replay: unknown, k: number) => string;
  /** ms per step at 1× */
  pace?: number;
}

export const PLAYBACK: Record<string, Playback> = {
  cube: {
    steps: (_d, r) => (r as { moves?: string[] } | undefined)?.moves?.length ?? 0,
    caption: (_d, r, k) => (r as { moves: string[] }).moves.slice(Math.max(0, k - 8), k).join(" "),
    pace: 650,
  },
  maze: { steps: (_d, r) => Math.max(0, ((r as { path: unknown[] } | undefined)?.path.length ?? 1) - 1), pace: 190 },
  sliding: {
    steps: (_d, r) => (r as { moves?: string[] } | undefined)?.moves?.length ?? 0,
    caption: (_d, r, k) => (r as { moves: string[] }).moves.slice(Math.max(0, k - 16), k).join(""),
    pace: 320,
  },
  jugs: {
    steps: (_d, r) => (r as { actions?: string[] } | undefined)?.actions?.length ?? 0,
    caption: (_d, r, k) => (r as { actions: string[] }).actions[k - 1] ?? "",
    pace: 800,
  },
  sudoku: { steps: (d, r) => (r ? (d as { puzzle: number[] }).puzzle.filter((v) => !v).length : 0), pace: 90 },
  arc: { steps: (_d, r) => ((r as unknown[][] | undefined)?.length ?? -1) + 1, pace: 420 },
  routes: {
    steps: (_d, r) => Math.max(0, ((r as number[] | undefined)?.length ?? 1) - 1),
    caption: (d, r, k) => {
      const names = (d as { names: string[] }).names;
      return (r as number[])
        .slice(0, k + 1)
        .map((i) => names[i] ?? "?")
        .join(" → ");
    },
    pace: 700,
  },
  knights: {
    steps: (d, r) => (r ? (d as { names: string[] }).names.length : 0),
    caption: (d, r, k) => {
      const nm = (d as { names: string[] }).names[k - 1];
      const { got, truth } = r as { got: (boolean | null)[]; truth: boolean[] };
      const g = got[k - 1];
      return `${nm}: ${g === null || g === undefined ? "—" : g ? "knight" : "knave"} ${g === truth[k - 1] ? "✓" : "✗"}`;
    },
    pace: 650,
  },
};

/** Challenges with a 3D stage. */
export const HAS_3D = new Set(Object.keys(PLAYBACK));

/** Text challenges replay their checklist (tests, rules, answers) one line at a time. */
export function stepsFor(id: string, data: unknown, v: Verdict | null): number {
  if (!v) return 0;
  const p = PLAYBACK[id];
  return p ? p.steps(data, v.replay) : (v.details?.length ?? 0);
}
