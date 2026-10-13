import { ANSWER_RULE, efficiency, extractAnswer, moveRule, overBudget } from "./answer";
import { parseMoves } from "./maze";
import { Rng } from "./rng";
import { withExpert, type Challenge, type Difficulty } from "./types";
import { Caption, CellGrid, Side } from "./views";

const GOAL = "123456780";
const STEP: Record<string, number> = { U: -3, D: 3, L: -1, R: 1 };

/** move the blank (0); null when it would leave the board */
export function slide(state: string, m: string): string | null {
  const z = state.indexOf("0");
  const to = z + STEP[m]!;
  if (to < 0 || to > 8 || ((m === "L" || m === "R") && Math.floor(to / 3) !== Math.floor(z / 3))) return null;
  const a = state.split("");
  [a[z], a[to]] = [a[to]!, a[z]!];
  return a.join("");
}

export function optimalMoves(start: string): number {
  if (start === GOAL) return 0;
  const seen = new Map([[start, 0]]);
  const queue = [start];
  for (let q = 0; q < queue.length; q++) {
    const s = queue[q]!;
    for (const m of "UDLR") {
      const n = slide(s, m);
      if (n && !seen.has(n)) {
        if (n === GOAL) return seen.get(s)! + 1;
        seen.set(n, seen.get(s)! + 1);
        queue.push(n);
      }
    }
  }
  return -1;
}

const manhattan = (s: string) =>
  s
    .split("")
    .reduce(
      (sum, ch, i) =>
        ch === "0" ? sum : sum + Math.abs(Math.floor(i / 3) - Math.floor((+ch - 1) / 3)) + Math.abs((i % 3) - ((+ch - 1) % 3)),
      0,
    );

const WALK: Record<Difficulty, number> = withExpert({ easy: 8, medium: 18, hard: 40 });

interface Data {
  start: string;
}
interface Replay {
  end: string;
  /** legal moves applied, in order */
  moves: string[];
  illegal?: boolean;
}

const board = (s: string) =>
  [0, 1, 2]
    .map((r) =>
      s
        .slice(r * 3, r * 3 + 3)
        .replace(/0/g, "_")
        .split("")
        .join(" "),
    )
    .join("\n");

export const sliding: Challenge<Data> = {
  id: "sliding",
  icon: "🧩",
  category: "planning",
  title: { en: "8-puzzle", id: "Puzzle geser 8" },
  blurb: {
    en: "Slide tiles back to 1–8 order in as few moves as possible.",
    id: "Geser ubin kembali ke urutan 1–8 dengan langkah sesedikit mungkin.",
  },
  skill: {
    en: "search · look-ahead planning",
    id: "pencarian · perencanaan ke depan",
  },
  supports: { maxMoves: true, untilSolved: true },
  generate(seed, difficulty, options) {
    const rng = new Rng(seed);
    let start = GOAL;
    let prev = "";
    const back: Record<string, string> = { U: "D", D: "U", L: "R", R: "L" };
    for (let k = 0; k < WALK[difficulty] || start === GOAL; k++) {
      const m = rng.pick([..."UDLR"].filter((x) => x !== back[prev]));
      const n = slide(start, m);
      if (n) [start, prev] = [n, m];
    }
    const optimal = optimalMoves(start);
    const prompt = [
      "Solve this 8-puzzle. '_' is the empty square. The goal is:",
      "```\n1 2 3\n4 5 6\n7 8 _\n```",
      "Current board:",
      "```",
      board(start),
      "```",
      "A move slides the EMPTY square: U (up), D (down), L (left), R (right) — i.e. it swaps with the neighbouring tile in that direction.",
      `Give a move sequence that solves it (the optimum is ${optimal} moves), e.g. <answer>LURD</answer>.`,
      moveRule(options?.maxMoves),
      ANSWER_RULE,
    ].join("\n");
    return {
      prompt,
      data: { start },
      iterate: {
        start,
        apply(state, output, budgetLeft) {
          const moves = parseMoves(extractAnswer(output));
          if (!moves || moves.length === 0) return { state, applied: [], valid: false, solved: false, note: "no move sequence (U/D/L/R)" };
          let cur = state as string;
          const applied: string[] = [];
          for (const m of moves) {
            if (budgetLeft !== undefined && applied.length >= budgetLeft) break;
            const next = slide(cur, m);
            if (!next) break; // stop at the first illegal move
            cur = next;
            applied.push(m);
            if (cur === GOAL) break;
          }
          return { state: cur, applied, valid: applied.length > 0, solved: cur === GOAL, note: `${applied.length} moves` };
        },
        followUp(state, movesSoFar, turn, budgetLeft) {
          return [
            "You are solving an 8-puzzle step by step. '_' is the empty square. The goal is:",
            "```\n1 2 3\n4 5 6\n7 8 _\n```",
            `Moves you have already made (turn ${turn - 1} so far, ${movesSoFar.length} moves): ${movesSoFar.join("") || "(none)"}`,
            "It is NOT solved yet. CURRENT board after those moves:",
            "```",
            board(state as string),
            "```",
            "A move slides the EMPTY square: U (up), D (down), L (left), R (right). An illegal move ends your turn.",
            budgetLeft !== undefined ? `You have ${budgetLeft} moves left in total.` : "There is no move limit.",
            "Continue from the CURRENT board: give only the NEXT moves, e.g. <answer>LURD</answer>.",
            ANSWER_RULE,
          ].join("\n");
        },
        verdict(state, moves, turns) {
          const end = state as string;
          const per = turns === 1 ? "1 turn" : `${turns} turns`;
          if (end === GOAL)
            return {
              score: efficiency(optimal, moves.length),
              solved: true,
              note: `solved in ${moves.length} moves over ${per} (optimal ${optimal})`,
              replay: { end, moves },
              moves: moves.length,
            };
          const before = manhattan(start);
          return {
            score: Math.round(30 * Math.max(0, (before - manhattan(end)) / before)),
            solved: false,
            note: `not solved after ${moves.length} moves over ${per} (optimal ${optimal})`,
            replay: { end, moves },
            moves: moves.length,
          };
        },
      },
      check(output) {
        const moves = parseMoves(extractAnswer(output));
        if (!moves)
          return {
            score: 0,
            solved: false,
            note: "no move sequence (U/D/L/R) found",
          };
        const over = overBudget(moves.length, options?.maxMoves);
        if (over) return over;
        let s = start;
        for (const [k, m] of moves.entries()) {
          const n = slide(s, m);
          if (!n)
            return {
              score: 0,
              solved: false,
              note: `illegal move #${k + 1} (${m})`,
              replay: { end: s, moves: moves.slice(0, k), illegal: true },
            };
          s = n;
          if (s === GOAL)
            return {
              score: efficiency(optimal, k + 1),
              solved: true,
              note: `solved in ${k + 1} moves (optimal ${optimal})`,
              replay: { end: s, moves: moves.slice(0, k + 1) },
              moves: k + 1,
            };
        }
        const before = manhattan(start);
        return {
          score: Math.round(30 * Math.max(0, (before - manhattan(s)) / before)),
          solved: false,
          note: `not solved after ${moves.length} moves (optimal ${optimal})`,
          replay: { end: s, moves },
          moves: moves.length,
        };
      },
    };
  },
  View({ data, replay }) {
    const end = (replay as Replay | undefined)?.end;
    const Board = ({ s, label }: { s: string; label: string }) => (
      <div>
        <Caption>{label}</Caption>
        <CellGrid
          rows={3}
          cols={3}
          size={34}
          gap={2}
          cell={(r, c) => {
            const ch = s[r * 3 + c]!;
            return ch === "0" ? { bg: "#0f172a" } : { bg: "#1e3a5f", text: ch, fg: "#e0f2fe" };
          }}
        />
      </div>
    );
    return (
      <Side>
        <Board s={data.start} label="start" />
        {end && <Board s={end} label={end === GOAL ? "after answer ✓" : "after answer"} />}
      </Side>
    );
  },
};
