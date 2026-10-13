import { ANSWER_RULE, extractAnswer } from "./answer";
import { Rng } from "./rng";
import { withExpert, type Challenge, type Difficulty } from "./types";
import { Caption, CellGrid, Side } from "./views";

type Grid = number[]; // 81 cells, 0 = empty

const peers = (i: number) => {
  const r = Math.floor(i / 9);
  const c = i % 9;
  const out: number[] = [];
  for (let k = 0; k < 9; k++)
    out.push(r * 9 + k, k * 9 + c, (Math.floor(r / 3) * 3 + Math.floor(k / 3)) * 9 + Math.floor(c / 3) * 3 + (k % 3));
  return out.filter((j) => j !== i);
};
const PEERS = Array.from({ length: 81 }, (_, i) => peers(i));
const allowed = (g: Grid, i: number, v: number) => PEERS[i]!.every((j) => g[j] !== v);

/** counts solutions up to `limit` (fewest-candidates-first backtracking) */
export function countSolutions(g: Grid, limit = 2, order: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9]): { count: number; first: Grid | null } {
  let count = 0;
  let first: Grid | null = null;
  const grid = [...g];
  const solve = (): boolean => {
    let best = -1;
    let bestOpts: number[] = [];
    for (let i = 0; i < 81; i++) {
      if (grid[i]) continue;
      const opts = order.filter((v) => allowed(grid, i, v));
      if (opts.length === 0) return false;
      if (best < 0 || opts.length < bestOpts.length) {
        best = i;
        bestOpts = opts;
        if (opts.length === 1) break;
      }
    }
    if (best < 0) {
      count++;
      first ??= [...grid];
      return count >= limit;
    }
    for (const v of bestOpts) {
      grid[best] = v;
      if (solve()) return true;
    }
    grid[best] = 0;
    return false;
  };
  solve();
  return { count, first };
}

const CLUES: Record<Difficulty, number> = withExpert({ easy: 42, medium: 32, hard: 25 });

export function makeSudoku(seed: number, difficulty: Difficulty): { puzzle: Grid; solution: Grid } {
  const rng = new Rng(seed);
  const solution = countSolutions(Array(81).fill(0), 1, rng.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])).first!;
  const puzzle = [...solution];
  let clues = 81;
  for (const i of rng.shuffle([...Array(81).keys()])) {
    if (clues <= CLUES[difficulty]) break;
    const keep = puzzle[i]!;
    puzzle[i] = 0;
    if (countSolutions(puzzle).count !== 1) puzzle[i] = keep;
    else clues--;
  }
  return { puzzle, solution };
}

const text = (g: Grid) =>
  [...Array(9).keys()]
    .map((r) =>
      g
        .slice(r * 9, r * 9 + 9)
        .map((v) => v || ".")
        .join(" "),
    )
    .join("\n");

interface Data {
  puzzle: Grid;
}
interface Replay {
  grid: Grid;
  wrong: number[];
}

export const sudoku: Challenge<Data> = {
  id: "sudoku",
  icon: "🔢",
  category: "logic",
  title: { en: "Sudoku", id: "Sudoku" },
  blurb: {
    en: "Fill a 9×9 Sudoku with a unique solution.",
    id: "Isi Sudoku 9×9 yang solusinya unik.",
  },
  skill: {
    en: "constraint satisfaction · consistency",
    id: "pemenuhan batasan · konsistensi",
  },
  generate(seed, difficulty) {
    const { puzzle, solution } = makeSudoku(seed, difficulty);
    const blanks = puzzle.filter((v) => !v).length;
    const prompt = [
      "Solve this Sudoku ('.' = empty). Every row, column and 3x3 box must contain 1-9 exactly once. It has exactly one solution.",
      "",
      "```",
      text(puzzle),
      "```",
      "",
      "Answer with the completed grid: 9 lines of 9 digits, e.g.",
      "<answer>\n534678912\n672195348\n…\n</answer>",
      ANSWER_RULE,
    ].join("\n");
    return {
      prompt,
      data: { puzzle },
      check(output) {
        const digits = extractAnswer(output).replace(/[^0-9]/g, "");
        if (digits.length !== 81 || digits.includes("0"))
          return {
            score: 0,
            solved: false,
            note: `need 81 digits 1-9, got ${digits.length}`,
          };
        const grid = digits.split("").map(Number);
        const changed = puzzle.filter((v, i) => v && v !== grid[i]).length;
        const wrong = grid.map((v, i) => (v !== solution[i] ? i : -1)).filter((i) => i >= 0);
        const replay: Replay = { grid, wrong };
        if (wrong.length === 0)
          return {
            score: 100,
            solved: true,
            note: `all ${blanks} blanks correct`,
            replay,
          };
        const right = blanks - wrong.filter((i) => !puzzle[i]).length;
        return {
          score: changed ? 0 : Math.round((60 * right) / blanks),
          solved: false,
          note: changed ? `changed ${changed} given clue(s)` : `${right}/${blanks} blanks correct`,
          replay,
        };
      },
    };
  },
  View({ data, replay }) {
    const rp = replay as Replay | undefined;
    const bad = new Set(rp?.wrong);
    return (
      <Side>
        <div>
          <Caption>{rp ? "answer (red = wrong)" : "puzzle"}</Caption>
          <CellGrid
            rows={9}
            cols={9}
            size={24}
            cell={(r, c) => {
              const i = r * 9 + c;
              const given = data.puzzle[i];
              const shade = (Math.floor(r / 3) + Math.floor(c / 3)) % 2 ? "#0f172a" : "#162033";
              if (given) return { bg: shade, text: given, fg: "#f1f5f9" };
              const v = rp?.grid[i];
              return {
                bg: bad.has(i) ? "#4c0519" : shade,
                text: v || "",
                fg: bad.has(i) ? "#fda4af" : "#7dd3fc",
              };
            }}
          />
        </div>
      </Side>
    );
  },
};
