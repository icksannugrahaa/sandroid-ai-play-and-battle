import { efficiency, extractAnswer, overBudget } from "./answer";
import { Rng } from "./rng";
import { withExpert, type Challenge, type ChallengeOptions, type Difficulty } from "./types";
import { Caption, CellGrid, Side } from "./views";

type V = [number, number, number];
export const FACES = ["U", "R", "F", "D", "L", "B"] as const;
type Face = (typeof FACES)[number];
const COLOR: Record<Face, string> = {
  U: "W",
  R: "R",
  F: "G",
  D: "Y",
  L: "O",
  B: "B",
};
const HEX: Record<string, string> = {
  W: "#f8fafc",
  Y: "#facc15",
  G: "#16a34a",
  B: "#2563eb",
  R: "#dc2626",
  O: "#f97316",
};
const AXIS: Record<Face, V> = {
  U: [0, 1, 0],
  D: [0, -1, 0],
  R: [1, 0, 0],
  L: [-1, 0, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
};

/** sticker position for face/row/col in the standard unfolded net (U above F, D below F). */
function position(face: Face, r: number, c: number): V {
  switch (face) {
    case "U":
      return [c - 1, 1, r - 1];
    case "D":
      return [c - 1, -1, 1 - r];
    case "F":
      return [c - 1, 1 - r, 1];
    case "B":
      return [1 - c, 1 - r, -1];
    case "R":
      return [1, 1 - r, 1 - c];
    case "L":
      return [-1, 1 - r, c - 1];
  }
}

const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** quarter turn clockwise seen from the +axis side: v' = -(a×v) + a(a·v) */
function turn(v: V, a: V): V {
  const x = cross(a, v);
  const d = dot(a, v);
  return [-x[0] + a[0] * d, -x[1] + a[1] * d, -x[2] + a[2] * d];
}

const SLOTS = FACES.flatMap((f) =>
  Array.from({ length: 9 }, (_, k) => ({
    face: f,
    pos: position(f, Math.floor(k / 3), k % 3),
    normal: AXIS[f],
  })),
);
/** sticker position + outward normal for each of the 54 facelets (URFDLB order) — used by tests */
export const FACELETS = SLOTS.map(({ pos, normal }) => ({ pos, normal }));
const slotKey = (p: V, n: V) => `${p.join(",")}|${n.join(",")}`;
const SLOT_INDEX = new Map(SLOTS.map((s, i) => [slotKey(s.pos, s.normal), i]));

/** facelet colours, 54 entries in URFDLB order (9 per face, row-major) */
export type Cube = string[];
export const solvedCube = (): Cube => SLOTS.map((s) => COLOR[s.face]);

/** permutation for one quarter turn: new[target] = old[source] */
const PERM: Record<Face, number[]> = Object.fromEntries(
  FACES.map((f) => {
    const a = AXIS[f];
    const perm = SLOTS.map((_, i) => i);
    SLOTS.forEach((s, i) => {
      if (dot(s.pos, a) === 1) perm[SLOT_INDEX.get(slotKey(turn(s.pos, a), turn(s.normal, a)))!] = i;
    });
    return [f, perm];
  }),
) as Record<Face, number[]>;

export type Move = { face: Face; turns: 1 | 2 | 3 };

export function applyMoves(cube: Cube, moves: Move[]): Cube {
  let state = cube;
  for (const m of moves) for (let k = 0; k < m.turns; k++) state = PERM[m.face].map((src) => state[src]!);
  return state;
}

export const moveText = (m: Move) => m.face + (m.turns === 2 ? "2" : m.turns === 3 ? "'" : "");

export function parseMoves(answer: string): Move[] | null {
  const tokens = answer.replace(/[’`´]/g, "'").replace(/[,;]/g, " ").split(/\s+/).filter(Boolean);
  const out: Move[] = [];
  for (const tok of tokens) {
    // also accept glued sequences like R U R' U'
    const parts = tok.match(/[URFDLB](?:2'?|'2?|)/g);
    if (!parts || parts.join("") !== tok) return null;
    for (const p of parts)
      out.push({
        face: p[0] as Face,
        turns: p.includes("2") ? 2 : p.includes("'") ? 3 : 1,
      });
  }
  return out;
}

export const isSolved = (c: Cube) => FACES.every((_, f) => c.slice(f * 9, f * 9 + 9).every((x) => x === c[f * 9 + 4]));
const inPlace = (c: Cube) => c.filter((x, i) => x === c[Math.floor(i / 9) * 9 + 4]).length;

const LENGTH: Record<Difficulty, number> = withExpert({ easy: 2, medium: 4, hard: 7 });

export function scramble(seed: number, n: number): Move[] {
  const rng = new Rng(seed);
  const out: Move[] = [];
  const opposite: Record<Face, Face> = {
    U: "D",
    D: "U",
    R: "L",
    L: "R",
    F: "B",
    B: "F",
  };
  while (out.length < n) {
    const face = rng.pick(FACES);
    const prev = out.at(-1)?.face;
    if (face === prev || (prev && opposite[prev] === face && out.at(-2)?.face === face)) continue;
    out.push({ face, turns: rng.pick([1, 2, 3] as const) });
  }
  return out;
}

// ------------------------------------------------------------------ fabricated-answer detection

/**
 * Patterns of sequences that were written to *look* like a solution rather than worked out:
 * the six face names in a row ("U R F D L B"), long runs of half turns ("R2 F2 L2 B2 D2 U2 …"),
 * or one block pasted over and over. Real solutions (even long beginner-method ones) rarely do this.
 */
/**
 * The whole cube prompt, in fixed sections so every model gets the same, unambiguous brief:
 * task, current position, notation, rules (move limit, time limit, no guessing), scoring, format.
 */
function cubePrompt(
  state: Cube,
  options: ChallengeOptions | undefined,
  resume?: { movesSoFar: string[]; turn: number; budgetLeft?: number },
  scrambleLength?: number,
): string {
  const minutes = options?.timeLimitS ? Math.round(options.timeLimitS / 60) : null;
  const budget = resume ? resume.budgetLeft : options?.maxMoves;
  return [
    "## TASK",
    resume
      ? "You are solving a scrambled 3x3 Rubik's Cube step by step. Continue from the CURRENT POSITION below: give the NEXT moves (they are applied after the moves you already made)."
      : "Solve this scrambled 3x3 Rubik's Cube: give ONE sequence of face turns that takes it from the CURRENT POSITION to fully solved (every face a single colour).",
    "",
    "## CURRENT POSITION",
    ...(resume
      ? [
          `Moves you already made (${resume.movesSoFar.length}, over ${resume.turn - 1} turn(s)): ${resume.movesSoFar.join(" ") || "(none)"} — the cube is NOT solved yet.`,
          "",
        ]
      : []),
    "Colours: W white, Y yellow, G green, B blue, R red, O orange. Centres never move: U=W, R=R, F=G, D=Y, L=O, B=B.",
    stateText(state, options?.stateFormat),
    "",
    "## NOTATION",
    "Singmaster: U R F D L B = a 90° clockwise turn of that face (as seen looking at that face), X' = counter-clockwise, X2 = 180°. No slice (M E S), wide or whole-cube rotation moves.",
    "",
    "## RULES",
    budget !== undefined ? `- Move limit: at most ${budget} moves.` : "- Move limit: NONE — use as many moves as you need.",
    minutes
      ? `- Time limit: about ${minutes} minute${minutes === 1 ? "" : "s"} for this answer, thinking included. That is plenty — take your time and keep working until you have a sequence you have checked.`
      : "- Time limit: none stated — take the time you need.",
    ...(scrambleLength && !resume && options?.distanceHint !== false
      ? [
          `- Hint: this position was made by turning a solved cube ${scrambleLength} times, so a solution of at most ${scrambleLength} moves exists — the fastest route is to find the moves that UNDO the scramble (search short sequences first). You may still use more moves.`,
        ]
      : []),
    `- ${VERIFY_RULE}`,
    '- Do NOT give up and do NOT answer with a placeholder or a "standard algorithm" you haven\'t checked on THIS position.',
    "",
    "## SCORING",
    "1. The cube must end up COMPLETELY solved — otherwise the answer fails (score ≈ 0).",
    "2. Among solved answers, FEWER moves score higher (the shortest solution scores 100).",
    "3. So a long but correct solution always beats a short wrong one.",
    "",
    "## ANSWER FORMAT",
    "Put only the move sequence inside <answer></answer> at the very end, e.g. <answer>R U' F2 D</answer>.",
  ].join("\n");
}

/** Asks for worked-out moves (weak models otherwise paste a plausible-looking filler sequence). */
const VERIFY_RULE =
  "Work it out: track the pieces move by move (use the move table above, or follow the stickers), and only write moves you have actually checked. A sequence that merely looks like a solution will not solve it.";

const ADMISSION =
  /\b(I know it'?s wrong|placeholder|best guess|just a guess|cannot solve|can'?t solve|unable to solve|won'?t (?:complete|solve|work)|can'?t guarantee|can'?t honestly|not (?:sure|confident) (?:it|this) (?:works|is correct)|might not be correct)\b/i;

export function fabricationSigns(moves: string[], text = ""): string[] {
  const signs: string[] = [];
  const admitted = ADMISSION.exec(text);
  if (admitted) signs.push(`the model itself says so: "${admitted[0]}"`);
  for (let i = 0; i + 6 <= moves.length; i++) {
    const w = moves.slice(i, i + 6);
    if (w.every((m) => m.length === 1) && new Set(w).size === 6) {
      signs.push(`lists the six face names as moves ("${w.join(" ")}")`);
      break;
    }
  }
  let run = 0;
  let longest = 0;
  for (const m of moves) {
    run = m.endsWith("2") ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  if (longest >= 10) signs.push(`${longest} half turns in a row (X2 X2 X2 …), typical filler`);
  // only half-turn blocks: real methods legitimately repeat algorithms like "R U R' U'" 3–5×
  const counts = new Map<string, number>();
  for (let i = 0; i + 4 <= moves.length; i++) {
    const w = moves.slice(i, i + 4);
    if (!w.every((m) => m.endsWith("2"))) continue;
    const k = w.join(" ");
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const [block, times] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  if (times >= 3) signs.push(`the block "${block}" repeats ${times}×`);
  // any 4-move block pasted ≥6 times (real methods repeat e.g. R U R' U' at most ~5×)
  const any = new Map<string, number>();
  for (let i = 0; i + 4 <= moves.length; i += 1)
    any.set(moves.slice(i, i + 4).join(" "), (any.get(moves.slice(i, i + 4).join(" ")) ?? 0) + 1);
  const [anyBlock, anyTimes] = [...any].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  if (anyTimes >= 6 && anyBlock !== block) signs.push(`the block "${anyBlock}" repeats ${anyTimes}×`);
  return signs;
}

// ------------------------------------------------------------------ piece-list state format

/** Pieces are named by the faces they touch, in this order (UFR, DBL, UF, FR, …). */
const NAME_ORDER: Face[] = ["U", "D", "F", "B", "R", "L"];

interface Piece {
  name: string;
  pos: V;
  faces: Face[];
}

/** the 8 corners + 12 edges, each with its home position */
const PIECES: Piece[] = (() => {
  const out: Piece[] = [];
  for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++)
      for (let z = -1; z <= 1; z++) {
        const pos: V = [x, y, z];
        const faces = NAME_ORDER.filter((f) => dot(pos, AXIS[f]) === 1);
        if (faces.length >= 2) out.push({ name: faces.join(""), pos, faces });
      }
  const rank = (p: Piece) => (p.faces.length === 3 ? 0 : 1) * 100 + (p.faces[0] === "U" ? 0 : p.faces[0] === "D" ? 10 : 20);
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
})();

/** colours a piece position shows, in the order of its name ("UFR" → U, F, R sides) */
function pieceColors(c: Cube, p: Piece): string[] {
  return p.faces.map((f) => c[SLOT_INDEX.get(slotKey(p.pos, AXIS[f]))!]!);
}

/** "R: UFR→UBR→DBR→DFR · UR→UB→…" — where each clockwise face turn moves the pieces */
function moveReference(): string[] {
  const byPos = new Map(PIECES.map((p) => [p.pos.join(","), p.name]));
  return FACES.map((f) => {
    const cycles = (n: number) => {
      const layer = PIECES.filter((p) => p.faces.length === n && dot(p.pos, AXIS[f]) === 1);
      const start = layer[0]!;
      const cycle = [start.name];
      let pos = turn(start.pos, AXIS[f]);
      while (byPos.get(pos.join(",")) !== start.name) {
        cycle.push(byPos.get(pos.join(","))!);
        pos = turn(pos, AXIS[f]);
      }
      return `${cycle.join("→")}→${start.name}`;
    };
    // where every sticker of every moved piece ends up facing (the part models get wrong)
    const stickers = (n: number) =>
      PIECES.filter((p) => p.faces.length === n && dot(p.pos, AXIS[f]) === 1)
        .map((p) => {
          const dest = byPos.get(turn(p.pos, AXIS[f]).join(","))!;
          const facing = p.faces.map((side) => `${side}→${faceOf(turn(AXIS[side], AXIS[f]))}`);
          return `${p.name}→${dest} [${facing.join(" ")}]`;
        })
        .join(", ");
    return `- ${f}: corners ${cycles(3)}; edges ${cycles(2)}\n    stickers: ${stickers(3)}; ${stickers(2)}`;
  });
}

/** the face a unit normal points at */
function faceOf(n: V): Face {
  return FACES.find((f) => AXIS[f].every((v, i) => v === n[i]))!;
}

export function piecesText(c: Cube): string {
  const line = (p: Piece) => {
    const got = pieceColors(c, p);
    const home = p.faces.map((f) => COLOR[f]);
    return `${p.name}: ${got.join(" ")}${got.join() === home.join() ? "  ✓" : ""}`;
  };
  return [
    "Corners:",
    ...PIECES.filter((p) => p.faces.length === 3).map(line),
    "Edges:",
    ...PIECES.filter((p) => p.faces.length === 2).map(line),
  ].join("\n");
}

/** How to read the piece list + what each move does (state-independent, so it's the same every time). */
const PIECES_GUIDE = [
  "The cube's state is given as a list of PIECES. Each position is named by the faces it touches (e.g. UFR = the corner between U, F and R; UF = the edge between U and F).",
  'The colours after each name are the stickers that piece shows on those faces, in the same order as the name: "UFR: W G R" means W on its U side, G on its F side, R on its R side.',
  'A piece is solved when every colour matches its face\'s centre: U=W, R=R, F=G, D=Y, L=O, B=B (so solved UFR reads "W G R"). Pieces already solved are marked ✓.',
  "Where each 90° clockwise face turn moves the pieces — A→B means the piece at A moves to B (X' runs the cycle backwards, X2 applies it twice).",
  'The "stickers" line says where each sticker of a moved piece ends up facing: "UFR→UBR [U→B F→U R→R]" means the UFR piece moves to UBR, and the sticker that faced U now faces B, the one that faced F now faces U, the one on R stays on R. Use it to track twists/flips exactly:',
  ...moveReference(),
].join("\n");

/** the state block of the prompt, in the chosen format */
export function stateText(c: Cube, format: "pieces" | "net" = "pieces"): string {
  return format === "net"
    ? [
        "Sticker layout (standard unfolded net, each face as 3 rows, left→right):",
        "- U (top) is seen from above with the B face at its top edge; F (front), R, B and L are seen from straight on; D (bottom) is seen from below with the F face at its top edge.",
        "",
        netText(c),
      ].join("\n")
    : [PIECES_GUIDE, "", piecesText(c)].join("\n");
}

function netText(c: Cube): string {
  const face = (f: Face) => {
    const i = FACES.indexOf(f) * 9;
    return [0, 1, 2].map((r) => c.slice(i + r * 3, i + r * 3 + 3).join(" "));
  };
  return FACES.map((f) => `${f} face:\n${face(f).join("\n")}`).join("\n\n");
}

interface Data {
  cube: Cube;
  /** scramble in notation — the 3D board replays it from solved (not shown to models) */
  scramble: string[];
}
interface Replay {
  cube: Cube;
  /** the model's moves, in order */
  moves: string[];
}

export const cube: Challenge<Data> = {
  id: "cube",
  icon: "🧊",
  category: "spatial",
  title: { en: "Rubik's Cube", id: "Rubik's Cube" },
  blurb: {
    en: "Solve a scrambled 3×3 cube from its sticker layout, in standard notation.",
    id: "Selesaikan kubus 3×3 teracak dari susunan stikernya, pakai notasi standar.",
  },
  skill: {
    en: "3D spatial reasoning · state tracking",
    id: "penalaran spasial 3D · melacak state",
  },
  supports: { maxMoves: true, untilSolved: true, stateFormat: true, distanceHint: true },
  generate(seed, difficulty, options) {
    const n = LENGTH[difficulty];
    const scrambleMoves = scramble(seed, n);
    const start = applyMoves(solvedCube(), scrambleMoves);
    const prompt = cubePrompt(start, options, undefined, n);
    return {
      prompt,
      data: { cube: start, scramble: scrambleMoves.map(moveText) },
      iterate: {
        start,
        apply(state, output, budgetLeft) {
          const moves = parseMoves(extractAnswer(output));
          if (!moves || moves.length === 0) return { state, applied: [], valid: false, solved: false, note: "no valid move sequence" };
          let cur = state as Cube;
          const applied: string[] = [];
          for (const m of moves) {
            if (budgetLeft !== undefined && applied.length >= budgetLeft) break;
            cur = applyMoves(cur, [m]);
            applied.push(moveText(m));
            if (isSolved(cur)) break; // credit the shortest prefix that solves it
          }
          return { state: cur, applied, valid: true, solved: isSolved(cur), note: `${applied.length} moves · ${inPlace(cur)}/54 in place` };
        },
        followUp(state, movesSoFar, turn, budgetLeft) {
          return cubePrompt(state as Cube, options, { movesSoFar, turn, budgetLeft });
        },
        verdict(state, moves, turns) {
          const end = state as Cube;
          const replay: Replay = { cube: end, moves };
          const per = turns === 1 ? "1 turn" : `${turns} turns`;
          if (isSolved(end))
            return {
              score: efficiency(n, moves.length),
              solved: true,
              note: `solved in ${moves.length} moves over ${per}`,
              replay,
              moves: moves.length,
            };
          const before = inPlace(start);
          const after = inPlace(end);
          return {
            score: Math.round(30 * Math.max(0, (after - before) / (54 - before))),
            solved: false,
            note: `not solved after ${moves.length} moves over ${per} · ${after}/54 stickers in place (start ${before})`,
            replay,
            moves: moves.length,
            flags: fabricationSigns(moves),
          };
        },
      },
      check(output) {
        const moves = parseMoves(extractAnswer(output));
        if (!moves)
          return {
            score: 0,
            solved: false,
            note: "no valid move sequence (U R F D L B with ' or 2)",
          };
        const over = overBudget(moves.length, options?.maxMoves);
        if (over) return over;
        const end = applyMoves(start, moves);
        const replay: Replay = { cube: end, moves: moves.map(moveText) };
        if (isSolved(end))
          return {
            score: efficiency(n, moves.length),
            solved: true,
            note: `solved in ${moves.length} moves (scramble was ${n})`,
            replay,
            moves: moves.length,
          };
        const before = inPlace(start);
        const after = inPlace(end);
        return {
          score: Math.round(30 * Math.max(0, (after - before) / (54 - before))),
          solved: false,
          note: `not solved after ${moves.length} moves · ${after}/54 stickers in place (start ${before})`,
          replay,
          moves: moves.length,
          flags: fabricationSigns(moves.map(moveText), output),
        };
      },
    };
  },
  View({ data, replay }) {
    const end = (replay as Replay | undefined)?.cube;
    return (
      <Side>
        <Net cube={data.cube} label="scrambled" />
        {end && <Net cube={end} label={isSolved(end) ? "after answer ✓" : "after answer"} />}
      </Side>
    );
  },
};

/** cross-shaped net: U on top, L F R B in the middle row, D below F */
function Net({ cube: c, label }: { cube: Cube; label: string }) {
  const at: Record<string, [number, number]> = {
    U: [0, 1],
    L: [1, 0],
    F: [1, 1],
    R: [1, 2],
    B: [1, 3],
    D: [2, 1],
  };
  const lookup = (r: number, col: number) => {
    const f = Object.entries(at).find(([, [fr, fc]]) => fr === Math.floor(r / 3) && fc === Math.floor(col / 3));
    if (!f) return null;
    return c[FACES.indexOf(f[0] as Face) * 9 + (r % 3) * 3 + (col % 3)]!;
  };
  return (
    <div>
      <Caption>{label}</Caption>
      <CellGrid
        rows={9}
        cols={12}
        size={14}
        gap={1}
        cell={(r, col) => {
          const x = lookup(r, col);
          return x ? { bg: HEX[x]! } : { bg: "transparent" };
        }}
      />
    </div>
  );
}
