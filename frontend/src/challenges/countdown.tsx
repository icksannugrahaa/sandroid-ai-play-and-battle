import { ANSWER_RULE, extractAnswer } from "./answer";
import { Rng } from "./rng";
import { withExpert, type Challenge, type Difficulty } from "./types";

/** Integer-only arithmetic parser (+ − × ÷ and parentheses); division must be exact. */
export function evaluate(expr: string): { value: number; used: number[] } {
  const src = expr.replace(/[×x*]/g, "*").replace(/[÷:/]/g, "/").replace(/[−–]/g, "-").replace(/\s+/g, "");
  let i = 0;
  const used: number[] = [];
  const fail = (msg: string): never => {
    throw new Error(msg);
  };
  const primary = (): number => {
    if (src[i] === "(") {
      i++;
      const v = sum();
      if (src[i++] !== ")") fail("missing )");
      return v;
    }
    const m = /^\d+/.exec(src.slice(i));
    if (!m) fail(`unexpected "${src[i] ?? "end"}"`);
    i += m![0].length;
    used.push(Number(m![0]));
    return Number(m![0]);
  };
  const product = (): number => {
    let v = primary();
    while (src[i] === "*" || src[i] === "/") {
      const op = src[i++];
      const r = primary();
      if (op === "*") v *= r;
      else {
        if (r === 0 || v % r !== 0) fail(`${v} / ${r} is not a whole number`);
        v /= r;
      }
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (src[i] === "+" || src[i] === "-") {
      const op = src[i++];
      const r = product();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const value = sum();
  if (i !== src.length) fail(`unexpected "${src[i]}"`);
  return { value, used };
}

const SETUP: Record<Difficulty, { n: number; large: number; min: number; max: number }> = withExpert({
  easy: { n: 4, large: 0, min: 20, max: 99 },
  medium: { n: 5, large: 1, min: 100, max: 499 },
  hard: { n: 6, large: 2, min: 500, max: 999 },
});

interface Data {
  numbers: number[];
  target: number;
}

export const countdown: Challenge<Data> = {
  id: "countdown",
  icon: "🎯",
  category: "math",
  title: { en: "Countdown numbers", id: "Hitung target" },
  blurb: {
    en: "Reach the target using the given numbers once each with + − × ÷.",
    id: "Capai angka target pakai angka yang diberikan (sekali pakai) dengan + − × ÷.",
  },
  skill: {
    en: "arithmetic search · rule following",
    id: "pencarian aritmetika · patuh aturan",
  },
  generate(seed, difficulty) {
    const rng = new Rng(seed);
    const { n, large, min, max } = SETUP[difficulty];
    for (;;) {
      const numbers = [...rng.shuffle([25, 50, 75, 100]).slice(0, large), ...Array.from({ length: n - large }, () => rng.int(1, 10))];
      // build a target from a random combination so it's always reachable
      let pool = rng.shuffle(numbers).slice(0, Math.max(3, n - rng.int(0, 1)));
      while (pool.length > 1) {
        const [a, b, ...rest] = rng.shuffle(pool);
        const options = [a! + b!, a! * b!, Math.abs(a! - b!), a! % b! === 0 ? a! / b! : b! % a! === 0 ? b! / a! : a! + b!].filter(
          (v) => v > 0,
        );
        pool = [rng.pick(options), ...rest];
      }
      const target = pool[0]!;
      if (target < min || target > max || numbers.includes(target)) continue;
      const prompt = [
        `Numbers: ${numbers.join(", ")}`,
        `Target: ${target}`,
        "",
        "Write an arithmetic expression that equals the target exactly. Rules: use + - * / and parentheses; each given number at most once (you don't have to use all); no other numbers; division must give a whole number.",
        "Example answer: <answer>(25 + 3) * 4 - 7</answer>",
        ANSWER_RULE,
      ].join("\n");
      return {
        prompt,
        data: { numbers, target },
        check(output) {
          const expr = extractAnswer(output).replace(/`/g, "").split("=")[0]!.trim();
          let value: number;
          let used: number[];
          try {
            ({ value, used } = evaluate(expr));
          } catch (e) {
            return {
              score: 0,
              solved: false,
              note: `invalid expression: ${(e as Error).message}`,
            };
          }
          const left = [...numbers];
          for (const u of used) {
            const k = left.indexOf(u);
            if (k < 0)
              return {
                score: 0,
                solved: false,
                note: `${u} is not available (numbers can be used once)`,
                replay: value,
              };
            left.splice(k, 1);
          }
          const off = Math.abs(value - target);
          if (off === 0)
            return {
              score: 100,
              solved: true,
              note: `${expr} = ${value}`,
              replay: value,
            };
          return {
            score: off <= 5 ? 70 : off <= 10 ? 50 : 0,
            solved: false,
            note: `= ${value}, ${off} away from ${target}`,
            replay: value,
          };
        },
      };
    }
  },
  View({ data, replay }) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {data.numbers.map((v, i) => (
          <span key={i} className="rounded-md bg-slate-800 px-2.5 py-1 font-mono text-sm text-slate-100">
            {v}
          </span>
        ))}
        <span className="px-1 text-slate-500">→</span>
        <span className="rounded-md bg-sky-900 px-3 py-1 font-mono text-base font-semibold text-sky-100">{data.target}</span>
        {typeof replay === "number" && (
          <span className={`font-mono text-sm ${replay === data.target ? "text-emerald-300" : "text-rose-300"}`}>= {replay}</span>
        )}
      </div>
    );
  },
};
