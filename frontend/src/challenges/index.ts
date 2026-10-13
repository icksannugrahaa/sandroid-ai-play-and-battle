import { arc } from "./arc";
import { arithmetic } from "./arithmetic";
import { code } from "./code";
import { countdown } from "./countdown";
import { cube } from "./cube";
import { instructions } from "./instructions";
import { jugs } from "./jugs";
import { knights } from "./knights";
import { maze } from "./maze";
import { needle } from "./needle";
import { routes } from "./routes";
import { sliding } from "./sliding";
import { strings } from "./strings";
import { sudoku } from "./sudoku";
import type { Challenge, ChallengeRef, Difficulty, Puzzle, Verdict } from "./types";

export const CHALLENGES: Challenge[] = [
  cube,
  maze,
  routes,
  sliding,
  jugs,
  sudoku,
  knights,
  arc,
  countdown,
  arithmetic,
  strings,
  instructions,
  code,
  needle,
] as Challenge[];

export const challengeById = (id: string) => CHALLENGES.find((c) => c.id === id);

/** "expert" only exists for challenges that support it; the others play it as "hard". */
export function levelFor(id: string, difficulty: Difficulty): Difficulty {
  return difficulty === "expert" && !challengeById(id)?.supports?.expert ? "hard" : difficulty;
}

const refKey = (ref: ChallengeRef) =>
  `${ref.id}:${ref.seed}:${ref.difficulty}:${ref.maxMoves ?? "∞"}:${ref.stateFormat ?? "pieces"}:${ref.timeLimitS ?? "-"}:${ref.distanceHint === false ? "nohint" : "hint"}`;
const cache = new Map<string, Puzzle>();
/** Puzzles are deterministic, so a round only stores {id, seed, difficulty}. */
export function puzzleFor(ref: ChallengeRef): Puzzle | null {
  const key = refKey(ref);
  if (!cache.has(key)) {
    const c = challengeById(ref.id);
    if (!c) return null;
    if (cache.size > 40) cache.clear();
    cache.set(
      key,
      c.generate(ref.seed, levelFor(ref.id, ref.difficulty), {
        maxMoves: ref.maxMoves,
        stateFormat: ref.stateFormat,
        timeLimitS: ref.timeLimitS,
        distanceHint: ref.distanceHint,
      }),
    );
  }
  return cache.get(key)!;
}

const verdicts = new Map<string, Promise<Verdict>>();
/**
 * Check a model's answer once: the live per-model card and the store share the result
 * (the coding challenge runs real tests, so it shouldn't run twice).
 */
export function verdictFor(ref: ChallengeRef, output: string): Promise<Verdict> {
  const key = `${refKey(ref)}:${output.length}:${output.slice(-200)}`;
  let v = verdicts.get(key);
  if (!v) {
    const puzzle = puzzleFor(ref);
    v = (async () => {
      if (!puzzle) return { score: 0, solved: false, note: "unknown challenge" };
      try {
        return await puzzle.check(output);
      } catch {
        return { score: 0, solved: false, note: "could not check this answer" };
      }
    })();
    if (verdicts.size > 200) verdicts.clear();
    verdicts.set(key, v);
  }
  return v;
}

export const CHALLENGE_SYSTEM =
  "You are taking part in a reasoning benchmark. Solve the task yourself (no tools, no code execution unless asked to write code). Follow the answer format exactly — the answer is checked automatically.";

export type { Challenge, ChallengeOptions, ChallengeRef, Difficulty, Verdict } from "./types";
