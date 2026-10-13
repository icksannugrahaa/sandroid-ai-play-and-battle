import { ANSWER_RULE, efficiency, extractAnswer } from "./answer";
import { Rng } from "./rng";
import { withExpert, type Challenge, type Difficulty } from "./types";

type State = number[];
type Action = { kind: "fill" | "empty"; a: number } | { kind: "pour"; a: number; b: number };

const NAMES = ["A", "B", "C"];

export function act(s: State, caps: number[], x: Action): State {
  const n = [...s];
  if (x.kind === "fill") n[x.a] = caps[x.a]!;
  else if (x.kind === "empty") n[x.a] = 0;
  else if (x.kind === "pour") {
    const amount = Math.min(n[x.a]!, caps[x.b]! - n[x.b]!);
    n[x.a]! -= amount;
    n[x.b]! += amount;
  }
  return n;
}

function actions(k: number): Action[] {
  const out: Action[] = [];
  for (let a = 0; a < k; a++) {
    out.push({ kind: "fill", a }, { kind: "empty", a });
    for (let b = 0; b < k; b++) if (a !== b) out.push({ kind: "pour", a, b });
  }
  return out;
}

/** BFS depth to first reach every amount (in any jug) */
export function reach(caps: number[]): Map<number, number> {
  const start = caps.map(() => 0);
  const seen = new Set([start.join(",")]);
  const found = new Map<number, number>();
  let frontier = [start];
  for (let depth = 1; frontier.length; depth++) {
    const next: State[] = [];
    for (const s of frontier)
      for (const x of actions(caps.length)) {
        const n = act(s, caps, x);
        if (seen.has(n.join(","))) continue;
        seen.add(n.join(","));
        next.push(n);
        for (const v of n) if (!found.has(v)) found.set(v, depth);
      }
    frontier = next;
  }
  return found;
}

export function parseActions(text: string, k: number): Action[] | null {
  const out: Action[] = [];
  const idx = (s: string) => NAMES.slice(0, k).indexOf(s.toUpperCase());
  for (const raw of text.split(/\n|;|,(?![^(]*\))/)) {
    const line = raw.replace(/^\s*(\d+[.)]|-|\*)\s*/, "").trim();
    if (!line) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^fill\s+(?:jug\s+)?([A-C])\b/i)) && idx(m[1]!) >= 0) out.push({ kind: "fill", a: idx(m[1]!) });
    else if ((m = line.match(/^empty\s+(?:jug\s+)?([A-C])\b/i)) && idx(m[1]!) >= 0) out.push({ kind: "empty", a: idx(m[1]!) });
    else if (
      (m = line.match(/^pour\s+(?:jug\s+)?([A-C])\s+(?:into\s+|to\s+|->\s*)?(?:jug\s+)?([A-C])\b/i)) &&
      idx(m[1]!) >= 0 &&
      idx(m[2]!) >= 0 &&
      m[1] !== m[2]
    )
      out.push({ kind: "pour", a: idx(m[1]!), b: idx(m[2]!) });
    else return null;
  }
  return out;
}

const SETUP: Record<Difficulty, { jugs: number; depth: [number, number] }> = withExpert({
  easy: { jugs: 2, depth: [3, 5] },
  medium: { jugs: 2, depth: [6, 9] },
  hard: { jugs: 3, depth: [6, 12] },
});

interface Data {
  caps: number[];
  target: number;
}

export const jugs: Challenge<Data> = {
  id: "jugs",
  icon: "🫗",
  category: "planning",
  title: { en: "Water jugs", id: "Teka-teki ember" },
  blurb: {
    en: "Measure an exact amount with unmarked jugs — fill, empty, pour.",
    id: "Takar volume tepat pakai ember tanpa skala — isi, kosongkan, tuang.",
  },
  skill: {
    en: "state-space search · arithmetic",
    id: "pencarian ruang state · aritmetika",
  },
  generate(seed, difficulty) {
    const rng = new Rng(seed);
    const { jugs: k, depth } = SETUP[difficulty];
    for (;;) {
      const caps = Array.from({ length: k }, () => rng.int(3, k === 3 ? 19 : 17));
      if (new Set(caps).size < k) continue;
      const found = reach(caps);
      const options = [...found].filter(([v, d]) => v > 0 && !caps.includes(v) && d >= depth[0] && d <= depth[1]);
      if (!options.length) continue;
      const [target, optimal] = rng.pick(options);
      const names = caps.map((c, i) => `${NAMES[i]} (${c} litres)`).join(", ");
      const prompt = [
        `You have ${k} empty unmarked jugs: ${names}, and an unlimited water tap.`,
        `Goal: end with EXACTLY ${target} litres in any one jug.`,
        "Allowed actions (one per line): `fill X` (fill X to the top), `empty X` (pour X out), `pour X Y` (pour from X into Y until X is empty or Y is full).",
        "Use as few actions as possible. Example answer:",
        "<answer>\nfill A\npour A B\nempty B\n</answer>",
        ANSWER_RULE,
      ].join("\n");
      return {
        prompt,
        data: { caps, target },
        check(output) {
          const list = parseActions(extractAnswer(output), k);
          if (!list)
            return {
              score: 0,
              solved: false,
              note: "could not read the actions (use fill X / empty X / pour X Y)",
            };
          let s = caps.map(() => 0);
          const states = [s];
          const actions: string[] = [];
          for (const [i, x] of list.entries()) {
            s = act(s, caps, x);
            states.push(s);
            actions.push(x.kind === "pour" ? `pour ${NAMES[x.a]} → ${NAMES[x.b]}` : `${x.kind} ${NAMES[x.a]}`);
            if (s.includes(target))
              return {
                score: efficiency(optimal, i + 1),
                solved: true,
                note: `${target} L after ${i + 1} actions (optimal ${optimal})`,
                replay: { states, actions },
              };
          }
          return {
            score: 0,
            solved: false,
            note: `ended with [${s.join(", ")}] after ${list.length} actions — target ${target} never reached`,
            replay: { states, actions },
          };
        },
      };
    }
  },
  View({ data, replay }) {
    const end = (replay as { states: number[][] } | undefined)?.states.at(-1);
    return (
      <div className="flex items-end gap-4">
        {data.caps.map((cap, i) => {
          const v = end?.[i] ?? 0;
          return (
            <div key={i} className="flex flex-col items-center gap-1 text-[11px] text-slate-400">
              <div
                className="relative w-10 overflow-hidden rounded-b-md border-2 border-t-0 border-slate-500"
                style={{ height: 8 + cap * 5 }}
              >
                <div
                  className={`absolute inset-x-0 bottom-0 ${v === data.target ? "bg-emerald-500/80" : "bg-sky-500/70"}`}
                  style={{ height: `${(v / cap) * 100}%` }}
                />
              </div>
              <span className="font-mono">
                {NAMES[i]} {end ? `${v}/` : ""}
                {cap}L
              </span>
            </div>
          );
        })}
        <span className="pb-4 text-xs text-slate-400">
          → target <b className="text-slate-200">{data.target} L</b>
        </span>
      </div>
    );
  },
};
