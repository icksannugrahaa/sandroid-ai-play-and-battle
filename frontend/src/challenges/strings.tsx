import { ANSWER_RULE, extractAnswer } from "./answer";
import { Rng } from "./rng";
import { withExpert, type Challenge, type Difficulty } from "./types";

const SYL = [
  "ra",
  "ber",
  "ry",
  "mis",
  "sis",
  "sip",
  "pi",
  "ban",
  "na",
  "lol",
  "li",
  "pop",
  "per",
  "ter",
  "ess",
  "ell",
  "oo",
  "kk",
  "zz",
  "str",
  "aw",
  "ee",
  "ll",
  "on",
  "mm",
];
const LEN: Record<Difficulty, [number, number]> = withExpert({
  easy: [3, 4],
  medium: [5, 7],
  hard: [9, 13],
});

interface Task {
  q: string;
  a: string;
}

function word(rng: Rng, [lo, hi]: [number, number]): string {
  return Array.from({ length: rng.int(lo, hi) }, () => rng.pick(SYL)).join("");
}

function tasks(seed: number, difficulty: Difficulty): Task[] {
  const rng = new Rng(seed);
  const len = LEN[difficulty];
  const w1 = word(rng, len);
  const letter = rng.pick([...new Set(w1)]);
  const w2 = word(rng, len);
  const words = Array.from({ length: difficulty === "hard" ? 9 : difficulty === "medium" ? 7 : 5 }, () => word(rng, [2, 3]));
  const w3 = word(rng, len);
  const k = rng.int(2, Math.min(9, w3.length));
  const sentence = Array.from({ length: difficulty === "hard" ? 14 : 9 }, () => word(rng, [1, 3])).join(" ");
  const nth = rng.int(3, sentence.split(" ").length);
  return [
    {
      q: `How many times does the letter "${letter}" appear in "${w1}"?`,
      a: String(w1.split(letter).length - 1),
    },
    {
      q: `Write "${w2}" backwards (reverse the letters).`,
      a: [...w2].reverse().join(""),
    },
    {
      q: `Sort these words alphabetically, separated by single spaces: ${words.join(" ")}`,
      a: [...words].sort().join(" "),
    },
    {
      q: `What is the ${k}th letter of "${w3}"? (1 = first letter)`,
      a: w3[k - 1]!,
    },
    {
      q: `What is word number ${nth} in: "${sentence}"?`,
      a: sentence.split(" ")[nth - 1]!,
    },
  ];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/["'`.*]/g, "")
    .replace(/\s+/g, " ")
    .trim();

interface Data {
  tasks: Task[];
}

export const strings: Challenge<Data> = {
  id: "strings",
  icon: "🔤",
  category: "language",
  title: { en: "Letter-level tasks", id: "Tugas level huruf" },
  blurb: {
    en: "Count letters, reverse and sort made-up words (the 'strawberry' test).",
    id: "Hitung huruf, balik & urutkan kata buatan (tes 'strawberry').",
  },
  skill: {
    en: "character-level precision (tokenizer blind spots)",
    id: "ketelitian level karakter (titik buta tokenizer)",
  },
  generate(seed, difficulty) {
    const list = tasks(seed, difficulty);
    const prompt = [
      "Answer these 5 questions exactly. The words are made up — work letter by letter.",
      "",
      ...list.map((t, i) => `${i + 1}. ${t.q}`),
      "",
      "Answer as a numbered list with just the answers:",
      "<answer>\n1. …\n2. …\n3. …\n4. …\n5. …\n</answer>",
      ANSWER_RULE,
    ].join("\n");
    return {
      prompt,
      data: { tasks: list },
      check(output) {
        const lines = extractAnswer(output).split("\n");
        const got = list.map((_, i) => {
          const line = lines.find((l) => new RegExp(`^\\s*${i + 1}[.):]`).test(l));
          return line ? norm(line.replace(/^\s*\d+[.):]\s*/, "")) : "";
        });
        const details = list.map((t, i) => ({
          ok: got[i] === norm(t.a),
          text: `${i + 1}. ${got[i] || "—"}${got[i] === norm(t.a) ? "" : `  (expected ${t.a})`}`,
        }));
        const right = details.filter((d) => d.ok).length;
        return {
          score: right * 20,
          solved: right === 5,
          note: `${right}/5 correct`,
          details,
        };
      },
    };
  },
  View({ data }) {
    return (
      <ol className="list-decimal space-y-0.5 pl-5 font-mono text-xs text-slate-300">
        {data.tasks.map((t, i) => (
          <li key={i}>{t.q}</li>
        ))}
      </ol>
    );
  },
};
