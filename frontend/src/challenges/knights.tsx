import { ANSWER_RULE, extractAnswer } from "./answer";
import { Rng } from "./rng";
import { withExpert, type Challenge, type Difficulty } from "./types";

const NAMES = ["Ava", "Ben", "Cleo", "Dev", "Eli", "Faye", "Gus"];
type World = boolean[]; // true = knight

interface Statement {
  text: (names: string[]) => string;
  eval: (w: World) => boolean;
}

function randomStatement(rng: Rng, self: number, n: number): Statement {
  const other = () => {
    let j = rng.int(0, n - 1);
    while (j === self) j = rng.int(0, n - 1);
    return j;
  };
  const a = other();
  let b = other();
  for (let k = 0; k < 5 && b === a && n > 2; k++) b = other();
  const k = rng.int(1, n - 1);
  const kinds: Statement[] = [
    { text: (nm) => `${nm[a]} is a knight.`, eval: (w) => w[a]! },
    { text: (nm) => `${nm[a]} is a knave.`, eval: (w) => !w[a] },
    {
      text: (nm) => `${nm[a]} and ${nm[b]} are the same kind.`,
      eval: (w) => w[a] === w[b],
    },
    {
      text: (nm) => `${nm[a]} and ${nm[b]} are different kinds.`,
      eval: (w) => w[a] !== w[b],
    },
    {
      text: (nm) => `${nm[a]} is a knight or ${nm[b]} is a knave.`,
      eval: (w) => w[a]! || !w[b],
    },
    {
      text: (nm) => `Both ${nm[a]} and ${nm[b]} are knaves.`,
      eval: (w) => !w[a] && !w[b],
    },
    {
      text: () => `Exactly ${k} of us ${k === 1 ? "is a knave" : "are knaves"}.`,
      eval: (w) => w.filter((x) => !x).length === k,
    },
    {
      text: () => `At least ${k} of us are knights.`,
      eval: (w) => w.filter(Boolean).length >= k,
    },
    {
      text: (nm) => `If ${nm[a]} is a knight, then so is ${nm[b]}.`,
      eval: (w) => !w[a] || w[b]!,
    },
  ];
  return a === b ? kinds[rng.int(0, 1)]! : rng.pick(kinds);
}

const worlds = (n: number): World[] => Array.from({ length: 1 << n }, (_, m) => Array.from({ length: n }, (_, i) => !!(m & (1 << i))));
const COUNT: Record<Difficulty, number> = withExpert({ easy: 3, medium: 5, hard: 7 });

interface Data {
  lines: string[];
  names: string[];
}

export const knights: Challenge<Data> = {
  id: "knights",
  icon: "🛡️",
  category: "logic",
  title: { en: "Knights & Knaves", id: "Ksatria & Penipu" },
  blurb: {
    en: "Knights always tell the truth, knaves always lie. Who is who?",
    id: "Ksatria selalu jujur, penipu selalu bohong. Siapa yang mana?",
  },
  skill: {
    en: "deductive logic · case analysis",
    id: "logika deduktif · analisis kasus",
  },
  generate(seed, difficulty) {
    const rng = new Rng(seed);
    const n = COUNT[difficulty];
    const names = NAMES.slice(0, n);
    for (;;) {
      const truth: World = names.map(() => rng.chance(0.5));
      // each speaker says something true iff they're a knight
      const said = names.map((_, i) => {
        for (;;) {
          const s = randomStatement(rng, i, n);
          if (s.eval(truth) === truth[i]) return s;
        }
      });
      const consistent = worlds(n).filter((w) => said.every((s, i) => s.eval(w) === w[i]));
      if (consistent.length !== 1) continue;
      const lines = said.map((s, i) => `${names[i]} says: "${s.text(names)}"`);
      const prompt = [
        `On an island, knights always tell the truth and knaves always lie. You meet ${n} inhabitants: ${names.join(", ")}.`,
        ...lines,
        "",
        "Exactly one assignment is consistent. Who is a knight and who is a knave?",
        `Answer one per line, e.g. <answer>\n${names[0]}: knight\n${names[1]}: knave\n…\n</answer>`,
        ANSWER_RULE,
      ].join("\n");
      return {
        prompt,
        data: { lines, names },
        check(output) {
          const ans = extractAnswer(output);
          const got = names.map((nm) => {
            const m = new RegExp(`\\b${nm}\\b[^\\n]*?\\b(knight|knave)`, "i").exec(ans);
            return m ? m[1]!.toLowerCase() === "knight" : null;
          });
          const details = names.map((nm, i) => ({
            ok: got[i] === truth[i],
            text: `${nm}: ${got[i] === null ? "—" : got[i] ? "knight" : "knave"}${got[i] === truth[i] ? "" : ` (is ${truth[i] ? "knight" : "knave"})`}`,
          }));
          const right = details.filter((d) => d.ok).length;
          return {
            score: right === n ? 100 : 0,
            solved: right === n,
            note: `${right}/${n} identified`,
            details,
            replay: { got, truth },
          };
        },
      };
    }
  },
  View({ data }) {
    return (
      <ul className="space-y-0.5 text-xs text-slate-300">
        {data.lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    );
  },
};
