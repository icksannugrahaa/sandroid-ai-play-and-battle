import { ANSWER_RULE, extractAnswer } from "./answer";
import { Rng } from "./rng";
import { withExpert, type Challenge, type Difficulty } from "./types";

const PLACES = ["harbour", "orchard", "library", "observatory", "mill", "quarry", "market", "monastery", "lighthouse", "vineyard"];
const THINGS = ["barrels", "ledgers", "lanterns", "ropes", "maps", "crates", "candles", "bells", "anchors", "scrolls"];
const VERBS = ["recorded", "counted", "repaired", "catalogued", "inspected", "moved", "cleaned", "painted"];
const PEOPLE = ["the keeper", "a clerk", "the night watch", "two apprentices", "the steward", "a visiting scholar"];
const COLORS = ["amber", "cobalt", "crimson", "emerald", "ivory", "jade", "onyx", "scarlet", "violet", "silver", "copper", "indigo"];

const CHARS: Record<Difficulty, number> = withExpert({
  easy: 12_000,
  medium: 40_000,
  hard: 90_000,
});
const NEEDLES: Record<Difficulty, number> = withExpert({ easy: 1, medium: 2, hard: 3 });

const code = (rng: Rng) => `${String.fromCharCode(65 + rng.int(0, 25))}${String.fromCharCode(65 + rng.int(0, 25))}-${rng.int(1000, 9999)}`;

function filler(rng: Rng): string {
  return `In year ${rng.int(1100, 1899)}, ${rng.pick(PEOPLE)} ${rng.pick(VERBS)} ${rng.int(2, 980)} ${rng.pick(THINGS)} at the ${rng.pick(PLACES)}.`;
}

interface Data {
  asked: string[];
  chars: number;
  depths: number[];
}

export const needle: Challenge<Data> = {
  id: "needle",
  icon: "🧷",
  category: "memory",
  title: { en: "Needle in a haystack", id: "Jarum di tumpukan jerami" },
  blurb: {
    en: "Find specific facts buried in a long document full of look-alike distractors.",
    id: "Temukan fakta tertentu yang terkubur di dokumen panjang penuh pengecoh mirip.",
  },
  skill: { en: "long-context retrieval", id: "pengambilan konteks panjang" },
  heavy: {
    medium: { en: "≈10k tokens per model", id: "≈10rb token per model" },
    hard: {
      en: "≈23k tokens per model — billed to your keys",
      id: "≈23rb token per model — ditagih ke key Anda",
    },
  },
  generate(seed, difficulty) {
    const rng = new Rng(seed);
    const colors = rng.shuffle(COLORS);
    const asked = colors.slice(0, NEEDLES[difficulty]);
    const decoys = colors.slice(NEEDLES[difficulty], NEEDLES[difficulty] + 4);
    const codes = Object.fromEntries([...asked, ...decoys].map((c) => [c, code(rng)]));
    const sentences: string[] = [];
    let len = 0;
    while (len < CHARS[difficulty]) {
      const s = filler(rng);
      sentences.push(s);
      len += s.length + 1;
    }
    const facts = [...asked, ...decoys].map((c) => `The access code for the ${c} vault is ${codes[c]}.`);
    const depths: number[] = [];
    for (const [k, fact] of facts.entries()) {
      const at = rng.int(1, sentences.length - 1);
      sentences.splice(at, 0, fact);
      if (k < asked.length) depths.push(at / sentences.length);
    }
    const doc = sentences.reduce((acc, s, i) => acc + s + (i % 7 === 6 ? "\n\n" : " "), "");
    const prompt = [
      "Read this archive log carefully.",
      "",
      "<document>",
      doc.trim(),
      "</document>",
      "",
      `What ${asked.length > 1 ? "are the access codes" : "is the access code"} for the ${asked.join(", ")} vault${asked.length > 1 ? "s" : ""}?`,
      `Answer one per line as "colour: code", e.g. <answer>\n${asked[0]}: XX-0000\n</answer>`,
      ANSWER_RULE,
    ].join("\n");
    return {
      prompt,
      data: { asked, chars: doc.length, depths },
      check(output) {
        const ans = extractAnswer(output);
        const details = asked.map((c) => {
          const m = new RegExp(`${c}[^\\n]*?([A-Z]{2}-\\d{4})`, "i").exec(ans);
          const got = m?.[1]?.toUpperCase();
          return {
            ok: got === codes[c],
            text: `${c}: ${got ?? "—"}${got === codes[c] ? "" : ` (expected ${codes[c]})`}`,
          };
        });
        const right = details.filter((d) => d.ok).length;
        return {
          score: Math.round((100 * right) / asked.length),
          solved: right === asked.length,
          note: `${right}/${asked.length} codes found`,
          details,
        };
      },
    };
  },
  View({ data }) {
    return (
      <div className="space-y-1.5 text-xs text-slate-300">
        <div>
          {Math.round(data.chars / 1000)}k characters · asking for: <span className="font-mono">{data.asked.join(", ")}</span>
        </div>
        <div className="relative h-2 w-72 rounded-full bg-slate-800">
          {data.depths.map((d, i) => (
            <span
              key={i}
              className="absolute top-0 h-2 w-1 rounded bg-amber-400"
              style={{ left: `${d * 100}%` }}
              title={`${Math.round(d * 100)}% depth`}
            />
          ))}
        </div>
      </div>
    );
  },
};
