import { stripThinking } from "./answer";
import { Rng } from "./rng";
import { withExpert, type Challenge, type Difficulty } from "./types";

const TOPICS = [
  "the history of tea",
  "how bridges stay up",
  "life on a coral reef",
  "why the sky is blue",
  "learning to ride a bicycle",
  "the first trip to the Moon",
  "how bread rises",
  "volcanoes",
  "city gardens",
  "the invention of paper",
];
const KEYWORDS = ["river", "silver", "window", "balance", "harvest", "compass", "lantern", "signal"];

interface Constraint {
  text: string;
  test: (s: string) => boolean;
  /** constraints that can't be combined with this one */
  tag?: string;
  /** text this rule forces into the answer / letter it forbids — the two must not clash */
  needs?: string;
  bans?: string;
}

const words = (s: string) => s.match(/[A-Za-z0-9']+/g) ?? [];
const paragraphs = (s: string) =>
  s
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

function pool(rng: Rng): Constraint[] {
  const kw = rng.pick(KEYWORDS);
  const times = rng.int(2, 4);
  const paras = rng.int(2, 4);
  const lo = rng.pick([60, 80, 100]);
  const hi = lo + rng.pick([30, 40]);
  const bullets = rng.int(3, 5);
  const end = rng.pick(["is there anything else i can help with?", "and that is the whole story.", "thanks for reading."]);
  const first = rng.pick(["imagine", "today", "once"]);
  const banned = rng.pick(["z", "q", "j"]);
  return [
    {
      text: `Use the word "${kw}" exactly ${times} times.`,
      test: (s) => words(s).filter((w) => w.toLowerCase() === kw).length === times,
      needs: kw,
    },
    {
      text: `Write exactly ${paras} paragraphs separated by blank lines.`,
      test: (s) => paragraphs(s).length === paras,
      tag: "layout",
    },
    {
      text: `Use between ${lo} and ${hi} words in total.`,
      test: (s) => words(s).length >= lo && words(s).length <= hi,
    },
    {
      text: `Format the whole answer as exactly ${bullets} bullet points, each line starting with "- ".`,
      test: (s) =>
        s
          .trim()
          .split("\n")
          .filter((l) => l.trim())
          .every((l) => l.startsWith("- ")) &&
        s
          .trim()
          .split("\n")
          .filter((l) => l.trim()).length === bullets,
      tag: "layout",
    },
    {
      text: "Write everything in lowercase letters only.",
      test: (s) => s === s.toLowerCase(),
    },
    {
      text: `End your response with the exact phrase "${end}"`,
      test: (s) => s.trim().toLowerCase().endsWith(end),
      needs: end,
    },
    {
      text: `Start your response with the word "${first}".`,
      test: (s) => words(s)[0]?.toLowerCase() === first,
      needs: first,
    },
    { text: "Do not use any commas.", test: (s) => !s.includes(",") },
    {
      text: `Do not use the letter "${banned}" anywhere.`,
      test: (s) => !s.toLowerCase().includes(banned),
      bans: banned,
    },
    {
      text: "Include a title wrapped in double angular brackets, like <<my title>>.",
      test: (s) => /<<[^<>\n]+>>/.test(s),
      tag: "layout",
    },
    {
      text: 'Do not use the letter "e" anywhere.',
      test: (s) => !/e/i.test(s),
      tag: "lipogram",
      bans: "e",
    },
  ];
}

const COUNT: Record<Difficulty, number> = withExpert({ easy: 2, medium: 4, hard: 6 });

interface Data {
  topic: string;
  rules: string[];
}

export const instructions: Challenge<Data> = {
  id: "instructions",
  icon: "📏",
  category: "language",
  title: { en: "Instruction following", id: "Patuh instruksi" },
  blurb: {
    en: "Write a short text that satisfies several strict, checkable constraints (IFEval-style).",
    id: "Tulis teks pendek yang memenuhi beberapa batasan ketat yang bisa dicek (gaya IFEval).",
  },
  skill: {
    en: "precise instruction following",
    id: "kepatuhan instruksi yang presisi",
  },
  generate(seed, difficulty) {
    const rng = new Rng(seed);
    const topic = rng.pick(TOPICS);
    const all = rng.shuffle(pool(rng)).filter((c) => difficulty === "hard" || c.tag !== "lipogram");
    const chosen: Constraint[] = [];
    for (const c of all) {
      if (chosen.length >= COUNT[difficulty]) break;
      if (c.tag && chosen.some((x) => x.tag === c.tag)) continue;
      const clash = (x: Constraint, y: Constraint) => !!x.bans && !!y.needs?.includes(x.bans);
      if (chosen.some((x) => clash(x, c) || clash(c, x))) continue;
      chosen.push(c);
    }
    const prompt = [
      `Write about ${topic}. Follow ALL of these rules:`,
      ...chosen.map((c, i) => `${i + 1}. ${c.text}`),
      "",
      "Reply with the text only — no preamble, no explanations, no <answer> tags.",
    ].join("\n");
    return {
      prompt,
      data: { topic, rules: chosen.map((c) => c.text) },
      check(output) {
        const text = stripThinking(output)
          .replace(/<\/?answer>/gi, "")
          .trim();
        const details = chosen.map((c) => ({ ok: c.test(text), text: c.text }));
        // "no commas" & co. are trivially met by a non-answer
        if (words(text).length < 20)
          return {
            score: 0,
            solved: false,
            note: `too short to be an answer (${words(text).length} words)`,
            details,
          };
        const ok = details.filter((d) => d.ok).length;
        return {
          score: Math.round((100 * ok) / chosen.length),
          solved: ok === chosen.length,
          note: `${ok}/${chosen.length} rules satisfied`,
          details,
        };
      },
    };
  },
  View({ data }) {
    return (
      <div className="text-xs text-slate-300">
        <div className="mb-1 text-slate-400">Topic: {data.topic}</div>
        <ol className="list-decimal space-y-0.5 pl-5">
          {data.rules.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ol>
      </div>
    );
  },
};
