import type { ComponentType } from "react";

export type Difficulty = "easy" | "medium" | "hard" | "expert";

/** Per-level settings for challenges without their own "expert" level: it plays like "hard". */
export function withExpert<T>(levels: Record<Exclude<Difficulty, "expert">, T>): Record<Difficulty, T> {
  return { ...levels, expert: levels.hard };
}
export type Category = "spatial" | "planning" | "logic" | "math" | "language" | "code" | "memory";
export type Localized = { en: string; id: string };

/** Result of checking one model's answer. Plain data — it goes into the session cache. */
export interface Verdict {
  /** 0–100 */
  score: number;
  solved: boolean;
  /** one line, English + numbers (shown under the score) */
  note: string;
  /** per-check breakdown, e.g. instruction-following constraints */
  details?: { ok: boolean; text: string }[];
  /** challenge-specific data for the replay view (path walked, final board, …) */
  replay?: unknown;
  /** moves/actions the answer used (move-based challenges) */
  moves?: number;
  /** signs the answer was made up rather than worked out (shown as a warning, not scored) */
  flags?: string[];
}

export interface Puzzle<D = unknown> {
  /** the message every model receives */
  prompt: string;
  /** puzzle data for the visual view */
  data: D;
  /** checks the model's full raw output */
  check: (output: string) => Verdict | Promise<Verdict>;
  /** "keep going until solved": multi-turn play for move-based puzzles */
  iterate?: Iteration;
}

/** Outcome of applying one turn's answer. */
export interface TurnResult {
  state: unknown;
  /** moves actually applied this turn (stops early once solved / at an illegal move / at the cap) */
  applied: string[];
  /** false = no usable moves in the answer */
  valid: boolean;
  solved: boolean;
  note: string;
}

/**
 * Multi-turn play: the model answers, its moves are applied, and if the puzzle isn't solved
 * it gets the NEW state (plus the moves it already made) and continues — one fresh prompt per
 * turn instead of a growing chat, so cost stays flat.
 */
export interface Iteration {
  start: unknown;
  apply: (state: unknown, output: string, budgetLeft?: number) => TurnResult;
  followUp: (state: unknown, movesSoFar: string[], turn: number, budgetLeft?: number) => string;
  verdict: (state: unknown, moves: string[], turns: number) => Verdict;
}

export interface Challenge<D = unknown> {
  id: string;
  icon: string;
  category: Category;
  title: Localized;
  blurb: Localized;
  /** what it measures, shown on the card */
  skill: Localized;
  /** shown before running when a puzzle is token-heavy */
  heavy?: Partial<Record<Difficulty, Localized>>;
  generate: (seed: number, difficulty: Difficulty, options?: ChallengeOptions) => Puzzle<D>;
  /** which options this challenge understands */
  supports?: { maxMoves?: boolean; untilSolved?: boolean; stateFormat?: boolean; distanceHint?: boolean; expert?: boolean };
  /** visual of the puzzle; `replay` is a Verdict.replay of the same challenge */
  View?: ComponentType<{ data: D; replay?: unknown }>;
}

export interface ChallengeOptions {
  /** cap on the answer's length; unset = unlimited (the point is to see how many a model needs) */
  maxMoves?: number;
  /** keep going (new turns with the new state) until solved — puzzles with `iterate` */
  untilSolved?: boolean;
  /** cap on turns in until-solved play; unset = unlimited */
  maxTurns?: number;
  /** how a puzzle state is written in the prompt (cube): piece list (default) or sticker net */
  stateFormat?: "pieces" | "net";
  /** the per-model time limit, stated in the prompt so models know they may take their time */
  timeLimitS?: number;
  /** cube: tell the model how many turns the scramble had (a solution that short exists); default on */
  distanceHint?: boolean;
}

/** what a round stores to rebuild its puzzle (puzzles are deterministic) */
export interface ChallengeRef extends ChallengeOptions {
  id: string;
  seed: number;
  difficulty: Difficulty;
}
