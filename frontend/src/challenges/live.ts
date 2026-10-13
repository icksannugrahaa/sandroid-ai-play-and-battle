/**
 * Live attempts: while a model is still thinking, pull the move sequence it is currently
 * trying out of its streamed text, so its board can act it out. Only the tail of the
 * stream is scanned, and only unambiguous runs count (reasoning text is full of stray
 * letters like "U face", "URF", "R, the right face").
 */
import { slide } from "./sliding";

export interface LiveAttempt {
  /** stable identity: a new key = a new attempt to act out from the start */
  key: string;
  /** replay-shaped data the 3D stage understands */
  replay: unknown;
  /** short text for the caption */
  label: string;
  /** maze: the attempt reaches G */
  reached?: boolean;
  /** maze: cells walked before stopping (or hitting a wall) */
  progress?: number;
  /** maze: the attempt runs into a wall */
  crashed?: boolean;
}

/**
 * True when ``next`` would be a step back from the attempt on screen: a route that reached G is
 * only replaced by another one that reaches G, and a route that hits a wall never replaces one
 * that got further. (Models re-check pieces of a finished route — "RRDDDD", "UUUUUUUUUUUU" —
 * long after they found it; showing those would throw the board back to the start.)
 */
export function stepBack(shown: LiveAttempt, next: LiveAttempt): boolean {
  if (shown.reached && !next.reached) return true;
  return !!next.crashed && (next.progress ?? 0) <= (shown.progress ?? 0);
}

const TAIL = 6000;

/**
 * The last *finished* match of `re` (global) in `text`. A run that touches the end of the
 * stream may still be growing ("R U R" → "R U R' U'"), so it only counts once text follows it.
 */
function last(text: string, re: RegExp, keep: (run: string) => boolean = () => true): string | null {
  let found: string | null = null;
  for (const m of text.matchAll(re)) if (!touchesEnd(text, m) && keep(m[1] ?? m[0])) found = m[1] ?? m[0];
  return found;
}

function touchesEnd(text: string, m: RegExpMatchArray): boolean {
  return text.slice(m.index! + m[0].length).trim() === "";
}

// U R F D L B with optional ' or 2, standing alone (not part of "URF" or "Right")
const MOVE = String.raw`[URFDLB](?:2'?|['’]2?)?(?![A-Za-z0-9'’])`;
const CUBE_RUN = new RegExp(String.raw`(?<![A-Za-z0-9'’])(${MOVE}(?:[ \t]+${MOVE}){2,})`, "g");

/** `prefix`: moves already applied in earlier turns (until-solved play) — the attempt continues from there. */
/** Not a move sequence: face-name lists ("L F R B") and sticker-colour rows ("B B B", "R B R"). */
function isFaceList(run: string): boolean {
  const tokens = run.split(/\s+/);
  if (tokens.length >= 4 && tokens.every((t) => t.length === 1) && new Set(tokens).size === tokens.length) return true;
  // R and B are also COLOURS (red, blue): sticker rows like "B B B" / "R B R" are not moves
  return tokens.every((t) => t === "R" || t === "B");
}

export function cubeAttempt(text: string, prefix: string[] = []): LiveAttempt | null {
  const run = last(text.slice(-TAIL), CUBE_RUN, (r) => !isFaceList(r));
  if (!run) return null;
  const moves = run.replace(/’/g, "'").split(/\s+/).filter(Boolean).slice(0, 500);
  return { key: moves.join(" "), replay: { moves: [...prefix, ...moves] }, label: moves.join(" ") };
}

// RRDDL… (one word, 4+ letters) or "R R D D" / "R, R, D" (4+ single letters)
const GRID_WORD = /(?<![A-Za-z])([UDLR]{4,})(?![A-Za-z])/g;
const GRID_SPACED = /(?<![A-Za-z])((?:[UDLR](?:[ \t]*[,→>-]?[ \t]*)){4,})(?![A-Za-z])/g;

function gridMoves(text: string, minLen = 4): string[] | null {
  const tail = text.slice(-TAIL);
  let best: { at: number; moves: string[] } | null = null;
  for (const re of [GRID_WORD, GRID_SPACED])
    for (const m of tail.matchAll(re)) {
      const moves = m[1]!.replace(/[^UDLR]/g, "").split("");
      if (moves.length >= minLen && !touchesEnd(tail, m) && (!best || m.index! >= best.at)) best = { at: m.index!, moves };
    }
  return best?.moves.slice(0, 400) ?? null;
}

const COORD = /\(\s*(\d{1,2})\s*,\s*(\d{1,2})\s*\)/g;

/**
 * The last finished chain of (row, col) coordinates in the reasoning — models that think in
 * coordinates ("(1,1) → (1,3) → (3,3)", BFS layers "(1,2)=1, (1,3)=2") never write move letters
 * until the very end, so this is what their board can follow live. Neighbouring entries must be
 * in the same row or column and only separated by arrows/commas/numbers (no words), so prose that
 * merely mentions two cells doesn't count.
 */
function coordChain(text: string): { at: number; cells: [number, number][] } | null {
  const tail = text.slice(-TAIL);
  let best: { at: number; cells: [number, number][] } | null = null;
  let chain: { at: number; cells: [number, number][]; end: number } | null = null;
  const close = () => {
    if (chain && chain.cells.length >= 3 && tail.slice(chain.end).trim() !== "") best = { at: chain.at, cells: chain.cells };
  };
  for (const m of tail.matchAll(COORD)) {
    const cell: [number, number] = [Number(m[1]), Number(m[2])];
    const prev = chain?.cells.at(-1);
    const gap = chain ? tail.slice(chain.end, m.index) : "";
    const linked =
      chain &&
      prev &&
      gap.length <= 16 &&
      !/[A-Za-z]{3,}/.test(gap) &&
      (prev[0] === cell[0] || prev[1] === cell[1]) &&
      (prev[0] !== cell[0] || prev[1] !== cell[1]);
    if (linked) {
      chain!.cells.push(cell);
      chain!.end = m.index! + m[0].length;
    } else {
      close();
      chain = { at: m.index!, cells: [cell], end: m.index! + m[0].length };
    }
  }
  close();
  return best;
}

const STEP: Record<string, [number, number]> = { U: [-1, 0], D: [1, 0], L: [0, -1], R: [0, 1] };

/** Walk cell to cell (straight lines expanded), stopping at the first wall or at G. */
function trace(grid: string[], from: [number, number], waypoints: [number, number][]) {
  const path: [number, number][] = [from];
  let [r, c] = from;
  for (const [tr, tc] of waypoints) {
    while (r !== tr || c !== tc) {
      const nr = r + Math.sign(tr - r);
      const nc = c + (r === tr ? Math.sign(tc - c) : 0);
      if (!grid[nr]?.[nc] || grid[nr]![nc] === "#") return { path, crashed: true };
      [r, c] = [nr, nc];
      path.push([r, c]);
      if (grid[r]![c] === "G") return { path, crashed: false };
    }
  }
  return { path, crashed: false };
}

/** Caption + identity of an acted-out route: the same cells never restart the animation. */
function routeAttempt2(grid: string[], path: [number, number][], crashed: boolean, shown: string): LiveAttempt {
  const end = path.at(-1)!;
  const outcome = crashed ? ` → wall after ${path.length - 1}` : grid[end[0]]![end[1]] === "G" ? ` → G in ${path.length - 1}` : "";
  const label = shown.length > 70 ? `${shown.slice(0, 67)}…` : shown;
  return {
    key: path.map((x) => x.join(",")).join(" ") + (crashed ? "!" : ""),
    replay: { path, crashed },
    label: label + outcome,
    reached: !crashed && grid[end[0]]![end[1]] === "G",
    progress: path.length - 1,
    crashed,
  };
}

/**
 * `prefix`: moves already made in earlier turns (until-solved play) — attempts continue from there.
 * Only whole routes are acted out: coordinate chains must start where the model stands (a chain
 * elsewhere is the model checking one corridor), and letter runs need 6+ moves ("DDDD" is a fragment
 * of a route being assembled, not a route).
 */
export function mazeAttempt(grid: string[], text: string, prefix: string[] = []): LiveAttempt | null {
  let r = grid.findIndex((row) => row.includes("S"));
  let c = grid[r]!.indexOf("S");
  for (const m of prefix) {
    const [dr, dc] = STEP[m] ?? [0, 0];
    if (grid[r + dr]?.[c + dc] && grid[r + dr]![c + dc] !== "#") [r, c] = [r + dr, c + dc];
  }
  const here: [number, number] = [r, c];
  const tail = text.slice(-TAIL);
  const moves = gridMoves(text, 6);
  const movesAt = moves ? tail.lastIndexOf(moves.join("")) : -1;
  const chain = coordChain(text);
  const fromHere = chain && chain.cells[0]![0] === here[0] && chain.cells[0]![1] === here[1];
  if (chain && fromHere && (!moves || chain.at > movesAt)) {
    const { path, crashed } = trace(grid, here, chain.cells.slice(1));
    return routeAttempt2(grid, path, crashed, chain.cells.map(([a, b]) => `(${a},${b})`).join("→"));
  }
  if (!moves) return null;
  const path: [number, number][] = [here];
  let crashed = false;
  for (const m of moves) {
    const [dr, dc] = STEP[m]!;
    if (!grid[r + dr]?.[c + dc] || grid[r + dr]![c + dc] === "#") {
      crashed = true;
      break;
    }
    r += dr;
    c += dc;
    path.push([r, c]);
    if (grid[r]![c] === "G") break;
  }
  // a run that hits a wall before half of it is walked is a piece written from some other cell
  // (a segment being re-checked, local exploration), not a route from here — drawing it would
  // throw the board back to S. Real wrong routes still show up in the final verdict.
  if (crashed && path.length - 1 < Math.max(2, moves.length / 2)) return null;
  return routeAttempt2(grid, path, crashed, moves.join(""));
}

/**
 * True when ``next`` only re-states the beginning of ``shown`` (same cells/moves, no further).
 * Models re-trace from S again and again ("From start: R×2, D×4 …") before extending a route;
 * swapping the long route on screen for that short restatement looks like a reset.
 */
export function restatesStart(shown: unknown, next: unknown): boolean {
  const seq = (r: unknown) => {
    const v = r as { path?: [number, number][]; moves?: string[] } | null;
    return v?.path ?? v?.moves;
  };
  const a = seq(shown);
  const b = seq(next);
  if (!a || !b || b.length >= a.length || (next as { crashed?: boolean }).crashed) return false;
  return b.every((x, i) => String(x) === String(a[i]));
}

/**
 * Step at which a new live attempt starts playing. When it shares its beginning with the attempt
 * already on screen, playback continues from where they part instead of restarting from scratch.
 * Maze paths start at the model's current cell (step 0); move lists start after ``prefixLen``.
 */
export function startStep(prev: unknown, next: unknown, prefixLen: number): number {
  const path = (r: unknown) => (r as { path?: [number, number][] } | null)?.path;
  const moves = (r: unknown) => (r as { moves?: string[] } | null)?.moves;
  const shared = (a: readonly unknown[] = [], b: readonly unknown[] = []) => {
    let n = 0;
    while (n < a.length && n < b.length && String(a[n]) === String(b[n])) n++;
    return n;
  };
  const nextPath = path(next);
  if (nextPath) return Math.max(0, shared(path(prev), nextPath) - 1);
  const nextMoves = moves(next);
  if (nextMoves) return Math.max(prefixLen, Math.min(shared(moves(prev), nextMoves), nextMoves.length));
  return prefixLen;
}

export function slidingAttempt(start: string, text: string, prefix: string[] = []): LiveAttempt | null {
  const moves = gridMoves(text);
  if (!moves) return null;
  const legal: string[] = [...prefix];
  let s = prefix.reduce((cur, m) => slide(cur, m) ?? cur, start);
  for (const m of moves) {
    const n = slide(s, m);
    if (!n) break;
    legal.push(m);
    s = n;
  }
  return { key: moves.join(""), replay: { moves: legal }, label: moves.join("") };
}

export function routeAttempt(names: string[], text: string): LiveAttempt | null {
  const alt = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(String.raw`((?:\b(?:${alt})\b\s*(?:->|→|=>|—>)\s*)+\b(?:${alt})\b)`, "gi");
  const run = last(text.slice(-TAIL), re);
  if (!run) return null;
  const path = run.split(/->|→|=>|—>/).map((p) => names.findIndex((n) => n.toLowerCase() === p.trim().toLowerCase()));
  if (path.length < 2 || path.includes(-1)) return null;
  return { key: path.join(","), replay: path, label: path.map((i) => names[i]).join(" → ") };
}

/** dispatch by challenge id; `data` is the puzzle's data */
export function liveAttempt(id: string, data: unknown, text: string, prefix: string[] = []): LiveAttempt | null {
  switch (id) {
    case "cube":
      return cubeAttempt(text, prefix);
    case "maze":
      return mazeAttempt((data as { grid: string[] }).grid, text, prefix);
    case "sliding":
      return slidingAttempt((data as { start: string }).start, text, prefix);
    case "routes":
      return routeAttempt((data as { names: string[] }).names, text);
    default:
      return null;
  }
}

/**
 * How many distinct attempts a model acted out while thinking (in the order they appeared),
 * so a card can say "23 attempts while thinking → final answer: 2 moves".
 */
export function attemptCount(id: string, text: string): number {
  const keys: string[] = [];
  const push = (k: string) => k && keys.at(-1) !== k && keys.push(k);
  if (id === "cube") {
    for (const m of text.matchAll(CUBE_RUN)) if (!isFaceList(m[1]!)) push(m[1]!.replace(/’/g, "'").replace(/\s+/g, " "));
  } else if (id === "maze" || id === "sliding") {
    if (id === "maze")
      for (const m of text.matchAll(/(?:\(\s*\d{1,2}\s*,\s*\d{1,2}\s*\)[\s,;:=→>\-\d]{0,16}){3,}/g)) push(m[0].replace(/\s+/g, ""));
    for (const re of [GRID_WORD, GRID_SPACED]) for (const m of text.matchAll(re)) push(m[1]!.replace(/[^UDLR]/g, ""));
  }
  return new Set(keys).size;
}
