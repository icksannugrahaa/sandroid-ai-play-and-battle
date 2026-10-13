import { ANSWER_RULE, extractAnswer } from "./answer";
import { Rng } from "./rng";
import { withExpert, type Challenge, type Difficulty } from "./types";

const digits = (rng: Rng, n: number) => BigInt(String(rng.int(1, 9)) + Array.from({ length: n - 1 }, () => rng.int(0, 9)).join(""));

interface Data {
  expr: string;
}

const SHAPE: Record<Difficulty, (rng: Rng) => { expr: string; value: bigint }> = withExpert({
  easy: (rng) => {
    const a = digits(rng, 4);
    const b = digits(rng, 4);
    return { expr: `${a} × ${b}`, value: a * b };
  },
  medium: (rng) => {
    const a = digits(rng, 7);
    const b = digits(rng, 6);
    const c = digits(rng, 8);
    return { expr: `${a} × ${b} − ${c}`, value: a * b - c };
  },
  hard: (rng) => {
    const a = digits(rng, 12);
    const b = digits(rng, 11);
    const c = digits(rng, 9);
    const d = digits(rng, 9);
    return { expr: `${a} × ${b} − ${c} × ${d}`, value: a * b - c * d };
  },
});

export const arithmetic: Challenge<Data> = {
  id: "arithmetic",
  icon: "🧮",
  category: "math",
  title: { en: "Exact arithmetic", id: "Hitungan presisi" },
  blurb: {
    en: "Multiply big numbers exactly — no calculator, no rounding.",
    id: "Kalikan angka besar secara tepat — tanpa kalkulator, tanpa pembulatan.",
  },
  skill: {
    en: "long multiplication · precision",
    id: "perkalian panjang · ketelitian",
  },
  generate(seed, difficulty) {
    const { expr, value } = SHAPE[difficulty](new Rng(seed));
    const want = value.toString();
    return {
      prompt: [
        `Compute exactly: ${expr}`,
        "Give the exact integer (no commas, no scientific notation), e.g. <answer>123456789</answer>.",
        ANSWER_RULE,
      ].join("\n"),
      data: { expr },
      check(output) {
        const got = extractAnswer(output)
          .replace(/[,\s_.](?=\d{3}\b)/g, "")
          .replace(/[^\d-]/g, "");
        if (!got) return { score: 0, solved: false, note: "no integer found" };
        if (got === want) return { score: 100, solved: true, note: `${want} ✓` };
        let k = 0;
        while (k < got.length && got[k] === want[k]) k++;
        return {
          score: got.length === want.length ? Math.round((30 * k) / want.length) : 0,
          solved: false,
          note: `got ${got}, expected ${want} (${k} leading digits right)`,
        };
      },
    };
  },
  View({ data }) {
    return <div className="font-mono text-base break-all text-slate-100">{data.expr} = ?</div>;
  },
};
