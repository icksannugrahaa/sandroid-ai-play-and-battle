import { ANSWER_RULE, extractAnswer } from "./answer";
import { Rng } from "./rng";
import type { Challenge, Difficulty } from "./types";
import { Caption, CellGrid } from "./views";

export type Grid = number[][];
const PALETTE = ["#111827", "#0074d9", "#ff4136", "#2ecc40", "#ffdc00", "#aaaaaa", "#f012be", "#ff851b", "#7fdbff", "#870c25"];

interface Rule {
  name: string;
  apply: (g: Grid) => Grid;
}

const flipH = (g: Grid) => g.map((r) => [...r].reverse());
const flipV = (g: Grid) => [...g].reverse().map((r) => [...r]);
const transpose = (g: Grid) => g[0]!.map((_, c) => g.map((r) => r[c]!));
const rotate = (g: Grid) => flipH(transpose(g));
const gravity = (g: Grid) => {
  const t = transpose(g).map((col) => {
    const filled = col.filter((v) => v);
    return [...Array(col.length - filled.length).fill(0), ...filled];
  });
  return transpose(t);
};
const scale2 = (g: Grid) => g.flatMap((r) => [r.flatMap((v) => [v, v]), r.flatMap((v) => [v, v])]);
const mirrorExtend = (g: Grid) => g.map((r) => [...r, ...[...r].reverse()]);

function rules(rng: Rng): Rule[] {
  const [a, b] = rng.shuffle([1, 2, 3, 4, 6, 7, 8]);
  const border = rng.pick([5, 9]);
  return [
    { name: "flip horizontally", apply: flipH },
    { name: "flip vertically", apply: flipV },
    { name: "rotate 90° clockwise", apply: rotate },
    { name: "transpose", apply: transpose },
    { name: "gravity down", apply: gravity },
    {
      name: `swap colours ${a} and ${b}`,
      apply: (g) => g.map((r) => r.map((v) => (v === a ? b! : v === b ? a! : v))),
    },
    {
      name: `draw a border of colour ${border}`,
      apply: (g) => g.map((r, i) => r.map((v, j) => (i === 0 || j === 0 || i === g.length - 1 || j === r.length - 1 ? border : v))),
    },
    { name: "scale ×2", apply: scale2 },
    { name: "mirror to the right", apply: mirrorExtend },
  ];
}

const SIMPLE = ["flip horizontally", "flip vertically", "rotate 90° clockwise", "transpose", "gravity down"];

function randomGrid(rng: Rng, h: number, w: number, colors: number[]): Grid {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => (rng.chance(0.45) ? rng.pick(colors) : 0)));
}

const same = (a: Grid, b: Grid) => JSON.stringify(a) === JSON.stringify(b);
const text = (g: Grid) => g.map((r) => r.join("")).join("\n");

interface Data {
  train: [Grid, Grid][];
  test: Grid;
  expected: Grid;
}

export function parseGrid(s: string): Grid | null {
  const rows = s
    .split("\n")
    .map((l) => l.replace(/[^0-9]/g, ""))
    .filter(Boolean);
  if (!rows.length || rows.some((r) => r.length !== rows[0]!.length)) return null;
  return rows.map((r) => r.split("").map(Number));
}

export const arc: Challenge<Data> = {
  id: "arc",
  icon: "🟦",
  category: "logic",
  title: { en: "Pattern grids (ARC)", id: "Pola grid (ARC)" },
  blurb: {
    en: "Infer the hidden transformation from examples and apply it (ARC-AGI style).",
    id: "Tebak transformasi tersembunyi dari contoh lalu terapkan (gaya ARC-AGI).",
  },
  skill: {
    en: "abstraction · few-shot induction",
    id: "abstraksi · induksi dari sedikit contoh",
  },
  generate(seed, difficulty: Difficulty) {
    const rng = new Rng(seed);
    const all = rules(rng);
    const pick = (names?: string[]) => rng.pick(names ? all.filter((r) => names.includes(r.name)) : all);
    const chain: Rule[] = difficulty === "easy" ? [pick(SIMPLE)] : difficulty === "medium" ? [pick()] : [pick(SIMPLE), pick()];
    if (chain.length === 2 && chain[0]!.name === chain[1]!.name) chain.pop();
    const apply = (g: Grid) => chain.reduce((acc, r) => r.apply(acc), g);
    const swap = /swap colours (\d) and (\d)/.exec(chain.map((c) => c.name).join(" "));
    const colors = swap ? [Number(swap[1]), Number(swap[2]), rng.pick([3, 4, 6])] : rng.shuffle([1, 2, 3, 4, 6, 7, 8]).slice(0, 3);
    const max = difficulty === "hard" ? 7 : 5;
    const make = (): [Grid, Grid] => {
      for (;;) {
        const g = randomGrid(rng, rng.int(3, max), rng.int(3, max), colors);
        const out = apply(g);
        if (!same(g, out)) return [g, out];
      }
    };
    const train = [make(), make(), make()];
    const [test, expected] = make();
    const prompt = [
      "Each example maps an input grid to an output grid with the same hidden rule. Digits are colours (0 = background).",
      "",
      ...train.flatMap(([i, o], k) => [`Example ${k + 1} input:`, text(i), `Example ${k + 1} output:`, text(o), ""]),
      "Test input:",
      text(test),
      "",
      "Apply the rule to the test input. Answer with the output grid, one row per line, digits only, e.g.",
      "<answer>\n0120\n0300\n</answer>",
      ANSWER_RULE,
    ].join("\n");
    return {
      prompt,
      data: { train, test, expected },
      check(output) {
        const got = parseGrid(extractAnswer(output));
        if (!got)
          return {
            score: 0,
            solved: false,
            note: "no rectangular digit grid found",
          };
        if (same(got, expected))
          return {
            score: 100,
            solved: true,
            note: `exact match (${chain.map((c) => c.name).join(" + ")})`,
            replay: got,
          };
        const dims = got.length === expected.length && got[0]!.length === expected[0]!.length;
        const cells = expected.flat().length;
        const right = dims ? expected.flat().filter((v, i) => v === got.flat()[i]).length : 0;
        return {
          score: dims ? Math.round((40 * right) / cells) : 0,
          solved: false,
          note: dims
            ? `${right}/${cells} cells right · rule: ${chain.map((c) => c.name).join(" + ")}`
            : `wrong size ${got.length}×${got[0]!.length} (expected ${expected.length}×${expected[0]!.length})`,
          replay: got,
        };
      },
    };
  },
  View({ data, replay }) {
    const got = replay as Grid | undefined;
    const G = ({ g, label, ring }: { g: Grid; label: string; ring?: (r: number, c: number) => boolean }) => (
      <div>
        <Caption>{label}</Caption>
        <CellGrid
          rows={g.length}
          cols={g[0]!.length}
          size={14}
          cell={(r, c) => ({
            bg: PALETTE[g[r]![c]!] ?? "#000",
            ring: ring?.(r, c) ? "#f43f5e" : undefined,
          })}
        />
      </div>
    );
    return (
      <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
        {data.train.map(([i, o], k) => (
          <div key={k} className="flex items-center gap-1.5">
            <G g={i} label={`ex ${k + 1}`} />
            <span className="text-slate-500">→</span>
            <G g={o} label="&nbsp;" />
          </div>
        ))}
        <div className="flex items-center gap-1.5 border-l border-slate-800 pl-5">
          <G g={data.test} label="test" />
          <span className="text-slate-500">→</span>
          {got ? (
            <G g={got} label="answer" ring={(r, c) => got[r]?.[c] !== data.expected[r]?.[c]} />
          ) : (
            <span className="text-2xl text-slate-600">?</span>
          )}
          {got && <G g={data.expected} label="expected" />}
        </div>
      </div>
    );
  },
};
