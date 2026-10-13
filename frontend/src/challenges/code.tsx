import { extractCode } from "./answer";
import { runTests, type TestCase } from "./coderunner";
import { Rng } from "./rng";
import { withExpert, type Challenge, type Difficulty } from "./types";

interface Problem {
  id: string;
  statement: string;
  signature: string;
  example: string;
  ref: (...args: never[]) => unknown;
  edge: unknown[][];
  random: (rng: Rng) => unknown[];
}

const arr = (rng: Rng, n: number, lo: number, hi: number) => Array.from({ length: n }, () => rng.int(lo, hi));
const word = (rng: Rng, n: number, abc = "abc") => Array.from({ length: n }, () => abc[rng.int(0, abc.length - 1)]).join("");

const PROBLEMS: Record<Difficulty, Problem[]> = withExpert({
  easy: [
    {
      id: "brackets",
      statement:
        "Return true if every bracket in the string is balanced and properly nested. Brackets are ()[]{}; ignore all other characters.",
      signature: "solve(s: string): boolean",
      example: 'solve("a(b[c]{d})") === true, solve("(]") === false',
      ref: ((s: string) => {
        const st: string[] = [];
        const pair: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
        for (const ch of s) {
          if ("([{".includes(ch)) st.push(ch);
          else if (ch in pair && st.pop() !== pair[ch]) return false;
        }
        return st.length === 0;
      }) as never,
      edge: [[""], ["("], [")("], ["([)]"], ["{[()()]}"], ["x"]],
      random: (rng) => [word(rng, rng.int(2, 14), "()[]{}x")],
    },
    {
      id: "roman",
      statement: "Convert an integer 1..3999 to a Roman numeral (standard subtractive form: IV, IX, XL, XC, CD, CM).",
      signature: "solve(n: number): string",
      example: 'solve(1994) === "MCMXCIV"',
      ref: ((n: number) => {
        const t: [number, string][] = [
          [1000, "M"],
          [900, "CM"],
          [500, "D"],
          [400, "CD"],
          [100, "C"],
          [90, "XC"],
          [50, "L"],
          [40, "XL"],
          [10, "X"],
          [9, "IX"],
          [5, "V"],
          [4, "IV"],
          [1, "I"],
        ];
        let out = "";
        for (const [v, s] of t) while (n >= v) [out, n] = [out + s, n - v];
        return out;
      }) as never,
      edge: [[1], [4], [9], [40], [3999], [2024]],
      random: (rng) => [rng.int(1, 3999)],
    },
    {
      id: "rle",
      statement:
        'Run-length encode a string: each run of the same character becomes the character followed by the run length. "aaabcc" → "a3b1c2".',
      signature: "solve(s: string): string",
      example: 'solve("aaabcc") === "a3b1c2", solve("") === ""',
      ref: ((s: string) => (s.match(/(.)\1*/g) ?? []).map((r) => r[0]! + r.length).join("")) as never,
      edge: [[""], ["a"], ["aaaaaaaaaaaa"], ["abab"]],
      random: (rng) => [word(rng, rng.int(1, 20), "aab")],
    },
  ],
  medium: [
    {
      id: "intervals",
      statement: "Merge all overlapping intervals (touching ones like [1,2],[2,3] count as overlapping). Return them sorted by start.",
      signature: "solve(intervals: [number, number][]): [number, number][]",
      example: "solve([[1,3],[8,10],[2,6]]) → [[1,6],[8,10]]",
      ref: ((xs: [number, number][]) => {
        const s = [...xs].map((x) => [...x] as [number, number]).sort((a, b) => a[0] - b[0]);
        const out: [number, number][] = [];
        for (const x of s) {
          const last = out.at(-1);
          if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]);
          else out.push(x);
        }
        return out;
      }) as never,
      edge: [
        [[]],
        [
          [
            [1, 4],
            [4, 5],
          ],
        ],
        [
          [
            [5, 6],
            [1, 10],
          ],
        ],
        [[[1, 1]]],
      ],
      random: (rng) => [
        Array.from({ length: rng.int(1, 8) }, () => {
          const a = rng.int(0, 30);
          return [a, a + rng.int(0, 6)];
        }),
      ],
    },
    {
      id: "islands",
      statement: "Count the islands in a grid of 0/1 (1 = land). Land cells connect horizontally or vertically (not diagonally).",
      signature: "solve(grid: number[][]): number",
      example: "solve([[1,1,0],[0,0,1],[1,0,1]]) === 3",
      ref: ((g: number[][]) => {
        const seen = g.map((r) => r.map(() => false));
        let n = 0;
        const fill = (r: number, c: number): void => {
          if (!g[r]?.[c] || seen[r]![c]) return;
          seen[r]![c] = true;
          (fill(r + 1, c), fill(r - 1, c), fill(r, c + 1), fill(r, c - 1));
        };
        g.forEach((row, r) => row.forEach((v, c) => v && !seen[r]![c] && (n++, fill(r, c))));
        return n;
      }) as never,
      edge: [
        [[]],
        [[[0]]],
        [[[1]]],
        [
          [
            [1, 0, 1],
            [0, 1, 0],
            [1, 0, 1],
          ],
        ],
      ],
      random: (rng) => {
        const h = rng.int(1, 9);
        const w = rng.int(1, 9);
        return [Array.from({ length: h }, () => arr(rng, w, 0, 1))];
      },
    },
    {
      id: "coins",
      statement:
        "Given coin denominations (unlimited supply) and an amount, return the minimum number of coins to make the amount exactly, or -1 if impossible.",
      signature: "solve(coins: number[], amount: number): number",
      example: "solve([1,2,5], 11) === 3, solve([2], 3) === -1",
      ref: ((coins: number[], amount: number) => {
        const dp = Array(amount + 1).fill(Infinity);
        dp[0] = 0;
        for (let a = 1; a <= amount; a++) for (const c of coins) if (c <= a) dp[a] = Math.min(dp[a], dp[a - c] + 1);
        return dp[amount] === Infinity ? -1 : dp[amount];
      }) as never,
      edge: [
        [[1], 0],
        [[2], 3],
        [[3, 7], 5],
        [[1, 3, 4], 6],
        [[186, 419, 83, 408], 6249],
      ],
      random: (rng) => [[...new Set(arr(rng, rng.int(1, 4), 2, 25))], rng.int(0, 300)],
    },
  ],
  hard: [
    {
      id: "editdistance",
      statement:
        "Return the Levenshtein edit distance between two strings (insert, delete or substitute one character = 1). Strings can be up to 2000 characters, so it must be efficient.",
      signature: "solve(a: string, b: string): number",
      example: 'solve("kitten", "sitting") === 3',
      ref: ((a: string, b: string) => {
        let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
        for (let i = 1; i <= a.length; i++) {
          const cur = [i];
          for (let j = 1; j <= b.length; j++)
            cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
          prev = cur;
        }
        return prev[b.length]!;
      }) as never,
      edge: [
        ["", ""],
        ["", "abc"],
        ["abc", "abc"],
        ["flaw", "lawn"],
      ],
      random: (rng) =>
        rng.chance(0.15)
          ? [word(rng, 2000, "abcd"), word(rng, 1800, "abcd")]
          : [word(rng, rng.int(0, 12), "abcd"), word(rng, rng.int(0, 12), "abcd")],
    },
    {
      id: "lis",
      statement:
        "Return the length of the longest strictly increasing subsequence. Arrays can have up to 100000 elements, so O(n log n) is required.",
      signature: "solve(nums: number[]): number",
      example: "solve([10,9,2,5,3,7,101,18]) === 4",
      ref: ((nums: number[]) => {
        const tails: number[] = [];
        for (const x of nums) {
          let lo = 0;
          let hi = tails.length;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (tails[mid]! < x) lo = mid + 1;
            else hi = mid;
          }
          tails[lo] = x;
        }
        return tails.length;
      }) as never,
      edge: [[[]], [[5]], [[2, 2, 2]], [[1, 2, 3, 4]], [[4, 3, 2, 1]]],
      random: (rng) => [rng.chance(0.15) ? arr(rng, 100000, -1e6, 1e6) : arr(rng, rng.int(1, 15), -20, 20)],
    },
    {
      id: "rainwater",
      statement: "Given bar heights, return how much rain water is trapped between the bars after raining.",
      signature: "solve(height: number[]): number",
      example: "solve([0,1,0,2,1,0,1,3,2,1,2,1]) === 6",
      ref: ((h: number[]) => {
        let l = 0;
        let r = h.length - 1;
        let lm = 0;
        let rm = 0;
        let w = 0;
        while (l < r) {
          if (h[l]! < h[r]!) {
            lm = Math.max(lm, h[l]!);
            w += lm - h[l++]!;
          } else {
            rm = Math.max(rm, h[r]!);
            w += rm - h[r--]!;
          }
        }
        return w;
      }) as never,
      edge: [[[]], [[3]], [[3, 0, 3]], [[5, 4, 3, 2, 1]], [[4, 2, 0, 3, 2, 5]]],
      random: (rng) => [rng.chance(0.15) ? arr(rng, 50000, 0, 1000) : arr(rng, rng.int(0, 15), 0, 6)],
    },
  ],
});

const RANDOM_TESTS = 25;

interface Data {
  problem: string;
  signature: string;
  tests: number;
}

export const code: Challenge<Data> = {
  id: "code",
  icon: "💻",
  category: "code",
  title: { en: "Coding challenge", id: "Tantangan coding" },
  blurb: {
    en: "Write a JavaScript function; it's run against hidden tests in a sandbox.",
    id: "Tulis fungsi JavaScript; dijalankan terhadap tes tersembunyi di sandbox.",
  },
  skill: {
    en: "correct code · edge cases · efficiency",
    id: "kode benar · edge case · efisiensi",
  },
  generate(seed, difficulty) {
    const rng = new Rng(seed);
    const p = rng.pick(PROBLEMS[difficulty]);
    const inputs = [...p.edge, ...Array.from({ length: RANDOM_TESTS }, () => p.random(rng))];
    const tests: TestCase[] = inputs.map((args) => ({
      args,
      expected: (p.ref as (...a: unknown[]) => unknown)(...structuredClone(args)),
    }));
    const prompt = [
      "Write a JavaScript function:",
      "",
      `    ${p.signature}`,
      "",
      p.statement,
      `Example: ${p.example}`,
      "",
      "Rules: plain JavaScript (no TypeScript types, no imports, no console output needed). Name the function exactly `solve`. It will be run against hidden tests, including edge cases and large inputs.",
      "Put the code in a ```js block inside <answer></answer>.",
    ].join("\n");
    return {
      prompt,
      data: {
        problem: p.statement,
        signature: p.signature,
        tests: tests.length,
      },
      async check(output) {
        const src = extractCode(output);
        if (!/solve/.test(src))
          return {
            score: 0,
            solved: false,
            note: "no function named solve found",
          };
        const report = await runTests(src, tests, difficulty === "hard" ? 6000 : 3000);
        if (report.error && !report.results.length) return { score: 0, solved: false, note: report.error };
        const passed = report.results.filter((r) => r.ok).length;
        const details = report.results
          .map((r, i) => ({ r, i }))
          .filter(({ r }) => !r.ok)
          .slice(0, 5)
          .map(({ r, i }) => ({
            ok: false,
            text: `test ${i + 1}: ${r.error ?? `got ${r.got}`} · expected ${JSON.stringify(tests[i]!.expected).slice(0, 60)} · input ${JSON.stringify(tests[i]!.args).slice(0, 80)}`,
          }));
        return {
          score: Math.round((100 * passed) / tests.length),
          solved: passed === tests.length,
          note: `${passed}/${tests.length} tests passed`,
          details,
        };
      },
    };
  },
  View({ data }) {
    return (
      <div className="space-y-1 text-xs text-slate-300">
        <code className="text-sky-300">{data.signature}</code>
        <p>{data.problem}</p>
        <p className="text-slate-500">{data.tests} hidden tests</p>
      </div>
    );
  },
};
