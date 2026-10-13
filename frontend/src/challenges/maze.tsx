import { efficiency, extractAnswer } from "./answer";
import { Rng } from "./rng";
import type { Challenge, ChallengeOptions, Difficulty } from "./types";
import { Caption, CellGrid, Side } from "./views";

interface Data {
  grid: string[];
}
interface Replay {
  path: [number, number][];
  crashed: boolean;
}

const CELLS: Record<Difficulty, number> = { easy: 4, medium: 7, hard: 11, expert: 14 };
/**
 * Hard and expert are a "perfect" maze (exactly one way between any two cells) plus a few
 * extra openings, each adding a different way to G: hard has 2–3 routes, expert 3–4, that go
 * clearly different ways and differ in length. Easy/medium knock out walls at random (many loops).
 */
const ROUTES: Partial<Record<Difficulty, [number, number]>> = { hard: [2, 3], expert: [3, 4] };
const DIRS: Record<string, [number, number]> = {
  U: [-1, 0],
  D: [1, 0],
  L: [0, -1],
  R: [0, 1],
};

export function makeMaze(seed: number, cells: number, routes?: [number, number]): string[] {
  if (!routes) {
    const rng = new Rng(seed);
    const g = perfectMaze(rng, cells);
    const n = g.length;
    // knock out a few extra walls so there is more than one route (and a shortest one to find)
    for (let k = 0; k < Math.ceil(cells * cells * 0.12); k++) {
      const r = rng.int(1, n - 2);
      const c = rng.int(1, n - 2);
      if (g[r]![c] === "#" && (r % 2) + (c % 2) === 1) g[r]![c] = ".";
    }
    return finish(g);
  }
  // some layouts have no opening that adds a clearly different route: try the next layout
  // (still deterministic per seed)
  let fallback: string[][] | null = null;
  for (let attempt = 0; attempt < 16; attempt++) {
    const rng = new Rng(seed + attempt * 1_000_003);
    const g = perfectMaze(rng, cells);
    const count = addRoutes(g, rng, routes);
    if (count >= routes[0]) return finish(g);
    fallback ??= g;
  }
  return finish(fallback!);
}

/** A "perfect" maze (exactly one way between any two cells), carved by depth-first search. */
function perfectMaze(rng: Rng, cells: number): string[][] {
  const n = cells * 2 + 1;
  const g = Array.from({ length: n }, () => Array<string>(n).fill("#"));
  const stack: [number, number][] = [[0, 0]];
  const seen = new Set(["0,0"]);
  g[1]![1] = ".";
  while (stack.length) {
    const [r, c] = stack.at(-1)!;
    const next = rng
      .shuffle(Object.values(DIRS))
      .map(([dr, dc]) => [r + dr, c + dc] as [number, number])
      .filter(([nr, nc]) => nr >= 0 && nc >= 0 && nr < cells && nc < cells && !seen.has(`${nr},${nc}`));
    if (!next.length) {
      stack.pop();
      continue;
    }
    const [nr, nc] = next[0]!;
    seen.add(`${nr},${nc}`);
    g[r + nr + 1]![c + nc + 1] = ".";
    g[nr * 2 + 1]![nc * 2 + 1] = ".";
    stack.push([nr, nc]);
  }
  return g;
}

function finish(g: string[][]): string[] {
  const n = g.length;
  g[1]![1] = "S";
  g[n - 2]![n - 2] = "G";
  return g.map((row) => row.join(""));
}

/**
 * Every route from the top-left to the bottom-right cell that never visits a cell twice (a
 * "route" in the prompt's sense), as lists of cells, shortest first. Stops after ``cap`` routes.
 */
export function routePaths(g: string[][] | string[], cap = 8): string[][] {
  const n = g.length;
  const goal = `${n - 2},${n - 2}`;
  const seen = new Set<string>();
  const trail: string[] = [];
  const out: string[][] = [];
  const walk = (r: number, c: number) => {
    if (out.length >= cap) return;
    const key = `${r},${c}`;
    trail.push(key);
    if (key === goal) out.push([...trail]);
    else {
      seen.add(key);
      for (const [dr, dc] of Object.values(DIRS)) {
        const nr = r + dr;
        const nc = c + dc;
        if (g[nr]?.[nc] && g[nr]![nc] !== "#" && !seen.has(`${nr},${nc}`)) walk(nr, nc);
      }
      seen.delete(key);
    }
    trail.pop();
  };
  walk(1, 1);
  return out.sort((a, b) => a.length - b.length);
}

/**
 * How much two routes overlap at worst: the largest share of a pair's shorter route that the
 * other one also walks (0 = completely different ways, 1 = one is inside the other).
 * Infinity when two routes are too close in length (under 10%, min. 6 moves apart).
 */
export function routeOverlap(paths: string[][]): number {
  let worst = 0;
  for (let i = 0; i < paths.length; i++)
    for (let j = i + 1; j < paths.length; j++) {
      const [a, b] = [paths[i]!, paths[j]!];
      if (b.length - a.length < Math.max(6, Math.round(b.length * 0.1))) return Infinity;
      const inA = new Set(a);
      worst = Math.max(worst, b.filter((cell) => inA.has(cell)).length / a.length);
    }
  return worst;
}

/** Routes count as different "ways" when no pair shares more than this share of cells. */
export const MAX_ROUTE_OVERLAP = 0.7;

/**
 * Open walls of a perfect maze until it has ``lo``–``hi`` clearly different routes. Each step
 * tries a batch of candidate walls and keeps the one whose new route overlaps the others least.
 */
function addRoutes(g: string[][], rng: Rng, [lo, hi]: [number, number]): number {
  const n = g.length;
  const walls: [number, number][] = [];
  for (let r = 1; r < n - 1; r++) for (let c = 1; c < n - 1; c++) if (g[r]![c] === "#" && (r % 2) + (c % 2) === 1) walls.push([r, c]);
  const pool = rng.shuffle(walls);
  const target = rng.int(lo, hi);
  let count = 1;
  const BATCH = 60;
  for (let start = 0; count < target && start < pool.length; start += BATCH) {
    let best: { wall: [number, number]; overlap: number; count: number } | null = null;
    for (const [r, c] of pool.slice(start, start + BATCH)) {
      if (g[r]![c] !== "#") continue;
      g[r]![c] = ".";
      const paths = routePaths(g, hi + 1);
      g[r]![c] = "#";
      if (paths.length <= count || paths.length > hi) continue;
      const overlap = routeOverlap(paths);
      if (overlap <= MAX_ROUTE_OVERLAP && (!best || overlap < best.overlap)) best = { wall: [r, c], overlap, count: paths.length };
    }
    if (best) {
      g[best.wall[0]]![best.wall[1]] = ".";
      count = best.count;
      start -= BATCH; // the same batch may hold the next good opening too
    }
  }
  return count;
}

function find(grid: string[], ch: string): [number, number] {
  const r = grid.findIndex((row) => row.includes(ch));
  return [r, grid[r]!.indexOf(ch)];
}

/** BFS distance from every open cell to G. */
export function distances(grid: string[]): Map<string, number> {
  const [gr, gc] = find(grid, "G");
  const dist = new Map([[`${gr},${gc}`, 0]]);
  const queue: [number, number][] = [[gr, gc]];
  while (queue.length) {
    const [r, c] = queue.shift()!;
    for (const [dr, dc] of Object.values(DIRS)) {
      const nr = r + dr;
      const nc = c + dc;
      const key = `${nr},${nc}`;
      if (grid[nr]?.[nc] && grid[nr]![nc] !== "#" && !dist.has(key)) {
        dist.set(key, dist.get(`${r},${c}`)! + 1);
        queue.push([nr, nc]);
      }
    }
  }
  return dist;
}

/** Why an answer is not a move sequence — e.g. a look-alike letter ("Д" instead of "D"). */
export function unreadable(answer: string): string {
  const stray = [...new Set(answer.toUpperCase().match(/[^UDLR\s,;>\-→.\d]/g) ?? [])].slice(0, 6);
  if (!answer.trim() || stray.length === 0 || stray.length > 4) return "no move sequence (U/D/L/R) found";
  return `answer is not a pure U/D/L/R sequence — contains ${stray.map((ch) => `"${ch}"`).join(", ")}`;
}

export function parseMoves(answer: string): string[] | null {
  const words: Record<string, string> = {
    UP: "U",
    DOWN: "D",
    LEFT: "L",
    RIGHT: "R",
    NORTH: "U",
    SOUTH: "D",
    WEST: "L",
    EAST: "R",
  };
  // "R×4", "R x 4", "R*4" → "R4" (the same shorthand the prompt uses for runs)
  let s = answer.toUpperCase().replace(/([UDLR])\s*[×X*]\s*(\d+)/g, "$1$2");
  for (const [w, m] of Object.entries(words)) s = s.replace(new RegExp(`\\b${w}\\b`, "g"), m);
  s = s.replace(/[\s,;>\-→.]+/g, "");
  // "R3" shorthand → RRR
  s = s.replace(/([UDLR])(\d+)/g, (_, m: string, n: string) => m.repeat(Math.min(200, Number(n))));
  return /^[UDLR]*$/.test(s) ? s.split("") : null;
}

/**
 * The grid with a column ruler and row numbers. A bare ASCII block makes models count
 * '#'/'.' runs by eye (tokenizers split them unevenly), so they misread walls within the
 * first few steps; explicit coordinates let them check every cell they step on.
 */
export function numberedGrid(grid: string[]): string[] {
  // one cell per column, separated by spaces: runs like "#####" or "......" are merged into a few
  // tokens by tokenizers, so models can't count them reliably — spaced cells can be read one by one
  const width = grid[0]!.length;
  const pad = String(grid.length - 1).length;
  const cell = String(width - 1).length;
  const line = (cells: string[]) => cells.map((ch) => ch.padStart(cell)).join(" ");
  return [
    `${" ".repeat(pad)} | ${line(Array.from({ length: width }, (_, c) => String(c)))}`,
    `${"-".repeat(pad)}-+-${"-".repeat(width * (cell + 1) - 1)}`,
    ...grid.map((row, r) => `${String(r).padStart(pad)} | ${line([...row])}`),
  ];
}

/** Open columns of each row as ranges ("1-3, 5, 9-13") — the same maze as a list that needs no counting. */
export function openCells(grid: string[]): string[] {
  return grid.map((row, r) => {
    const runs: string[] = [];
    for (let c = 0; c < row.length; c++) {
      if (row[c] === "#") continue;
      let end = c;
      while (end + 1 < row.length && row[end + 1] !== "#") end++;
      runs.push(end === c ? `${c}` : `${c}-${end}`);
      c = end;
    }
    return `row ${r}: ${runs.join(", ") || "none"}`;
  });
}

/** Where a route ran into a wall (shown to the model in the next turn). */
export interface Crash {
  /** 1-based number of the move that failed */
  move: number;
  dir: string;
  from: [number, number];
  wall: [number, number];
}

/** Follow-up turn in "until solved" play: what the model did so far and where it stands. */
export interface MazeProgress {
  turn: number;
  movesSoFar: string[];
  pos: [number, number];
  crash?: Crash;
  budgetLeft?: number;
}

const at = ([r, c]: [number, number]) => `row ${r}, column ${c}`;
const DIR_NAME: Record<string, string> = { U: "up", D: "down", L: "left", R: "right" };

export function crashText(k: Crash): string {
  return `move ${k.move} (${k.dir} = ${DIR_NAME[k.dir]}) from ${at(k.from)} runs into the wall at ${at(k.wall)}`;
}

export function mazePrompt(
  grid: string[],
  start: [number, number],
  goal: [number, number],
  progress?: MazeProgress,
  options?: ChallengeOptions,
): string {
  const minutes = options?.timeLimitS ? Math.round(options.timeLimitS / 60) : null;
  const resume = progress
    ? [
        `## PROGRESS (turn ${progress.turn})`,
        progress.crash
          ? `Your previous route stopped: ${crashText(progress.crash)}. The moves before it were valid and have been made.`
          : "Your previous route stopped before reaching G.",
        `Moves made so far (${progress.movesSoFar.length}): ${progress.movesSoFar.join("") || "none"}.`,
        `You are now at ${at(progress.pos)}. Continue from HERE to G — answer only the NEW moves.`,
        ...(progress.budgetLeft !== undefined ? [`Move budget left: ${progress.budgetLeft}.`] : []),
        "",
      ]
    : [];
  return [
    ...resume,
    "## TASK",
    progress
      ? "Reach G from your current position, as directly as you can."
      : "Find a route from S to G through the maze below — the shorter, the better.",
    ...(progress
      ? []
      : [
          "Priority: 1) reach G without touching a wall, 2) answer in time, 3) use few moves. Get one checked route to G, then answer — you don't need to prove it is the shortest.",
        ]),
    "",
    `## MAZE (${grid.length} rows × ${grid[0]!.length} columns)`,
    "'#' is a wall, '.' is open floor. Row numbers are on the left, column numbers on top; cells are separated by spaces.",
    `S (start) is at ${at(start)}. G (goal) is at ${at(goal)}.`,
    "",
    "```",
    ...numberedGrid(grid),
    "```",
    "",
    "### Open cells by row (columns that are '.', S or G — every other cell is '#')",
    "This list is the same maze, exact — use it to check each cell instead of counting characters.",
    "```",
    ...openCells(grid),
    "```",
    "",
    "## RULES",
    "- Moves: U = up (row - 1), D = down (row + 1), L = left (column - 1), R = right (column + 1), one cell per move.",
    "- You may never enter a '#' cell or leave the grid. A route that hits a wall fails at that move.",
    ...(minutes
      ? [
          `- Time limit: about ${minutes} minute${minutes === 1 ? "" : "s"}, thinking included. An answer that arrives after the limit scores 0.`,
        ]
      : []),
    "",
    "## HOW TO WORK (fast and reliable)",
    "1. Don't copy, rewrite or re-list the maze or the open-cells list — read them where they are.",
    "2. Walk forward from S one straight run at a time and note where it ends, e.g. `R×4 → (1,5)`. Check in the open-cells list that every column the run passes is listed for that row (a gap such as `1-3, 5` means column 4 is a wall).",
    "3. At a junction, first take the way that heads toward G, and note the other ways as untried.",
    "4. At a dead end, go back only to the latest junction with an untried way and continue from there — never start again from S.",
    "5. When you reach G, answer right away. Don't look for other routes or re-check the same one again and again: you can't see the clock, any route that reaches G scores at least 50, and an answer that comes too late scores 0.",
    "6. Write the answer straight from your list of runs (R4 D2 L1 …) — no need to spell out or count long rows of letters.",
    "",
    "## SCORING",
    "- Reaching G is required. The shortest route scores 100; any other route that reaches G scores 100 × shortest ÷ yours, at least 50.",
    "- A route that hits a wall or stops short scores at most 30 (for how close it got). No answer, or one after the time limit: 0.",
    "",
    "## ANSWER FORMAT",
    "End your reply with the moves inside <answer></answer> — the tags are required.",
    "Write runs as letter + count, separated by spaces, e.g. <answer>R4 D2 L1 D3</answer> (= RRRRDDLDDD). Plain letters also work: <answer>RRRRDDLDDD</answer>.",
    "Inside the tags: only the ASCII letters U, D, L, R, numbers and spaces — no arrows, coordinates or words.",
  ].join("\n");
}

/** Walk ``moves`` from ``pos``: stops at G, at the first wall (crash) or after ``limit`` moves. */
export function walk(grid: string[], pos: [number, number], moves: string[], limit = Infinity) {
  let [r, c] = pos;
  const path: [number, number][] = [[r, c]];
  const applied: string[] = [];
  let crash: Crash | undefined;
  for (const m of moves) {
    if (applied.length >= limit) break;
    const [dr, dc] = DIRS[m]!;
    if (!grid[r + dr]?.[c + dc] || grid[r + dr]![c + dc] === "#") {
      crash = { move: applied.length + 1, dir: m, from: [r, c], wall: [r + dr, c + dc] };
      break;
    }
    r += dr;
    c += dc;
    path.push([r, c]);
    applied.push(m);
    if (grid[r]![c] === "G") break;
  }
  return { pos: [r, c] as [number, number], path, applied, crash, atGoal: grid[r]![c] === "G" };
}

interface MazeState {
  pos: [number, number];
  path: [number, number][];
  crash?: Crash;
  /** any wall hit during the whole game (for the replay's crash marker) */
  crashed: boolean;
}

export const maze: Challenge<Data> = {
  id: "maze",
  icon: "🗺️",
  category: "planning",
  title: { en: "Maze route", id: "Rute labirin" },
  blurb: {
    en: "Find the shortest path from S to G through an ASCII maze.",
    id: "Cari jalur terpendek dari S ke G di labirin ASCII.",
  },
  skill: {
    en: "spatial planning · optimality",
    id: "perencanaan spasial · optimalitas",
  },
  // a route that hits a wall can be continued from where it stopped (the model is told where)
  supports: { untilSolved: true, expert: true },
  generate(seed, difficulty, options) {
    const grid = makeMaze(seed, CELLS[difficulty], ROUTES[difficulty]);
    const dist = distances(grid);
    const start = find(grid, "S");
    const optimal = dist.get(start.join(","))!;
    const prompt = mazePrompt(grid, start, find(grid, "G"), undefined, options);
    const goal = find(grid, "G");
    const initial: MazeState = { pos: start, path: [start], crashed: false };
    return {
      prompt,
      data: { grid },
      iterate: {
        start: initial,
        apply(state, output, budgetLeft) {
          const cur = state as MazeState;
          const moves = parseMoves(extractAnswer(output));
          if (!moves || moves.length === 0)
            return { state, applied: [], valid: false, solved: false, note: unreadable(extractAnswer(output)) };
          const run = walk(grid, cur.pos, moves, budgetLeft);
          const next: MazeState = {
            pos: run.pos,
            path: [...cur.path, ...run.path.slice(1)],
            crash: run.crash,
            crashed: cur.crashed || !!run.crash,
          };
          const note = run.crash ? `${run.applied.length} moves, then ${crashText(run.crash)}` : `${run.applied.length} moves`;
          return { state: next, applied: run.applied, valid: true, solved: run.atGoal, note };
        },
        followUp(state, movesSoFar, turn, budgetLeft) {
          const cur = state as MazeState;
          return mazePrompt(grid, start, goal, { turn, movesSoFar, pos: cur.pos, crash: cur.crash, budgetLeft }, options);
        },
        verdict(state, moves, turns) {
          const cur = state as MazeState;
          const replay: Replay = { path: cur.path, crashed: cur.crashed };
          const per = turns === 1 ? "1 turn" : `${turns} turns`;
          if (grid[cur.pos[0]]![cur.pos[1]] === "G")
            return {
              score: efficiency(optimal, moves.length),
              solved: true,
              note: `reached G in ${moves.length} moves over ${per} (optimal ${optimal})`,
              replay,
              moves: moves.length,
            };
          const left = dist.get(cur.pos.join(",")) ?? optimal;
          return {
            score: Math.round(30 * Math.max(0, (optimal - left) / optimal)),
            solved: false,
            note: `not at G after ${moves.length} moves over ${per} · ${left} steps from G (optimal route ${optimal})`,
            replay,
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
            note: unreadable(extractAnswer(output)),
          };
        const run = walk(grid, start, moves);
        const replay: Replay = { path: run.path, crashed: !!run.crash };
        const used = run.applied.length;
        if (run.atGoal) {
          return {
            score: efficiency(optimal, used),
            solved: true,
            note: `reached G in ${used} moves (optimal ${optimal})`,
            replay,
            moves: used,
          };
        }
        const left = dist.get(run.pos.join(",")) ?? optimal;
        const progress = Math.max(0, (optimal - left) / optimal);
        const why = run.crash ? `${crashText(run.crash)} (answer had ${moves.length} moves)` : `stopped after ${used} moves`;
        return {
          score: Math.round(30 * progress),
          solved: false,
          note: `${why} · ${left} steps from G (optimal route ${optimal})`,
          replay,
          moves: used,
        };
      },
    };
  },
  View({ data, replay }) {
    const rp = replay as Replay | undefined;
    const on = new Set(rp?.path.map(([r, c]) => `${r},${c}`));
    const last = rp?.path.at(-1);
    const n = data.grid.length;
    return (
      <Side>
        <div>
          <Caption>{rp ? "route" : "maze"}</Caption>
          <CellGrid
            rows={n}
            cols={data.grid[0]!.length}
            size={n > 15 ? 14 : 20}
            gap={0}
            cell={(r, c) => {
              const ch = data.grid[r]![c]!;
              if (ch === "S") return { bg: "#0284c7", text: "S" };
              if (ch === "G") return { bg: "#059669", text: "G" };
              if (ch === "#") return { bg: "#334155" };
              const isLast = last && last[0] === r && last[1] === c;
              if (isLast && rp?.crashed) return { bg: "#be123c" };
              return { bg: on.has(`${r},${c}`) ? "#f59e0b" : "#0f172a" };
            }}
          />
        </div>
      </Side>
    );
  },
};
