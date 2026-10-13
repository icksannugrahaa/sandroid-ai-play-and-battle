import { describe, expect, it } from "vitest";

import { extractAnswer } from "./answer";
import { CHALLENGES, challengeById } from "./index";
import { distances, makeMaze, parseMoves, MAX_ROUTE_OVERLAP, routeOverlap, routePaths, unreadable } from "./maze";
import { countSolutions } from "./sudoku";
import { optimalMoves, slide } from "./sliding";
import type { Difficulty } from "./types";

const LEVELS: Difficulty[] = ["easy", "medium", "hard"];
const gen = (id: string, seed: number, d: Difficulty) => challengeById(id)!.generate(seed, d);

describe("every challenge", () => {
  for (const c of CHALLENGES)
    for (const d of LEVELS)
      it(`${c.id}/${d}: deterministic, fits the prompt limit, rejects garbage`, async () => {
        for (const seed of [1, 7, 12345]) {
          const a = c.generate(seed, d);
          expect(c.generate(seed, d).prompt).toBe(a.prompt);
          expect(a.prompt.length).toBeLessThan(99_000);
          if (c.id === "code") continue; // needs a real browser worker
          const v = await a.check("I don't know. <answer>banana</answer>");
          expect(v.solved).toBe(false);
          expect(v.score).toBeLessThanOrEqual(40);
        }
      });
});

describe("perfect answers score 100", () => {
  it("maze: BFS route", async () => {
    for (const d of LEVELS) {
      const p = gen("maze", 3, d);
      const grid = (p.data as { grid: string[] }).grid;
      const dist = distances(grid);
      let [r, c] = [1, 1];
      let moves = "";
      while (grid[r]![c] !== "G") {
        const step = (
          [
            ["U", -1, 0],
            ["D", 1, 0],
            ["L", 0, -1],
            ["R", 0, 1],
          ] as const
        ).find(([, dr, dc]) => dist.get(`${r + dr},${c + dc}`) === dist.get(`${r},${c}`)! - 1)!;
        moves += step[0];
        r += step[1];
        c += step[2];
      }
      expect(await p.check(`<answer>${moves}</answer>`)).toMatchObject({
        solved: true,
        score: 100,
      });
      expect((await p.check(`<answer>${moves}LRLR</answer>`)).solved).toBe(true); // stops at G
      expect((await p.check("<answer>UUUU</answer>")).note).toMatch(/wall/);
    }
  });

  it("sudoku: unique solution", async () => {
    for (const d of LEVELS) {
      const p = gen("sudoku", 5, d);
      const puzzle = (p.data as { puzzle: number[] }).puzzle;
      const { count, first } = countSolutions(puzzle);
      expect(count).toBe(1);
      const rows = [...Array(9).keys()].map((r) => first!.slice(r * 9, r * 9 + 9).join("")).join("\n");
      expect(await p.check(`<answer>\n${rows}\n</answer>`)).toMatchObject({
        solved: true,
        score: 100,
      });
    }
  });

  it("sliding: BFS optimum is reachable", () => {
    const p = gen("sliding", 9, "medium");
    const start = (p.data as { start: string }).start;
    const n = optimalMoves(start);
    expect(n).toBeGreaterThan(0);
    expect(slide("123456780", "R")).toBeNull();
    expect(slide("123456780", "U")).toBe("123450786");
  });

  it("knights: exactly one assignment scores 100", async () => {
    for (const d of LEVELS) {
      const p = gen("knights", 11, d);
      const names = (p.data as { names: string[] }).names;
      let winners = 0;
      for (let m = 0; m < 1 << names.length; m++) {
        const ans = names.map((nm, i) => `${nm}: ${m & (1 << i) ? "knight" : "knave"}`).join("\n");
        if ((await p.check(`<answer>\n${ans}\n</answer>`)).solved) winners++;
      }
      expect(winners).toBe(1);
    }
  });

  it("arc: expected grid", async () => {
    for (const d of LEVELS) {
      const p = gen("arc", 21, d);
      const exp = (p.data as { expected: number[][] }).expected;
      expect(await p.check(`<answer>\n${exp.map((r) => r.join("")).join("\n")}\n</answer>`)).toMatchObject({ solved: true });
    }
  });

  it("strings: reference answers", async () => {
    const p = gen("strings", 4, "hard");
    const tasks = (p.data as { tasks: { a: string }[] }).tasks;
    expect(await p.check(`<answer>\n${tasks.map((t, i) => `${i + 1}. ${t.a}`).join("\n")}\n</answer>`)).toMatchObject({ score: 100 });
  });

  it("needle: codes from the document", async () => {
    const p = gen("needle", 8, "medium");
    const asked = (p.data as { asked: string[] }).asked;
    const ans = asked.map((c) => `${c}: ${new RegExp(`${c} vault is ([A-Z]{2}-\\d{4})`).exec(p.prompt)![1]}`).join("\n");
    expect(await p.check(`<answer>\n${ans}\n</answer>`)).toMatchObject({
      solved: true,
    });
  });

  it("arithmetic: BigInt answer", async () => {
    const p = gen("arithmetic", 2, "hard");
    const expr = (p.data as { expr: string }).expr.replace(/×/g, "*").replace(/−/g, "-");
    const value = expr
      .split(" - ")
      .map((part) =>
        part
          .split(" * ")
          .map(BigInt)
          .reduce((a, b) => a * b),
      )
      .reduce((a, b) => a - b);
    expect(await p.check(`<answer>${value}</answer>`)).toMatchObject({
      solved: true,
    });
    expect(await p.check(`<answer>${value + 1n}</answer>`)).toMatchObject({
      solved: false,
    });
  });

  it("countdown: rules enforced", async () => {
    const p = gen("countdown", 3, "easy");
    const { numbers } = p.data as { numbers: number[] };
    expect((await p.check(`<answer>${numbers[0]} + ${numbers[0]} + ${numbers[0]} + ${numbers[0]} + ${numbers[0]}</answer>`)).note).toMatch(
      /not available|away|=/,
    );
    expect((await p.check("<answer>7 / 2</answer>")).score).toBe(0);
  });

  it("instructions: a fully compliant text passes", async () => {
    const p = gen("instructions", 1, "easy");
    const v = await p.check("whatever");
    expect(v.details).toHaveLength(2);
  });
});

describe("answer extraction", () => {
  it("prefers the last answer tag and ignores thinking", () => {
    expect(extractAnswer("<think><answer>X</answer></think> blah <answer>A</answer> then <answer> B </answer>")).toBe("B");
    expect(extractAnswer("result:\n```\nRRDD\n```")).toBe("RRDD");
    expect(extractAnswer("so the answer is\nLURD")).toBe("LURD");
  });
});

describe("maze prompt", () => {
  it("numbers every row and column so cells can be checked", async () => {
    const { numberedGrid, mazePrompt } = await import("./maze");
    const grid = ["#####", "#S..#", "#.#.#", "#..G#", "#####"];
    const lines = numberedGrid(grid);
    expect(lines[0]).toBe("  | 0 1 2 3 4");
    expect(lines.at(-2)).toBe("3 | # . . G #");
    const prompt = mazePrompt(grid, [1, 1], [3, 3]);
    expect(prompt).toContain("S (start) is at row 1, column 1. G (goal) is at row 3, column 3.");
    expect(prompt).toContain("## SCORING");
    expect(prompt).toContain("only the ASCII letters U, D, L, R, numbers and spaces");
    expect(prompt).toContain("## HOW TO WORK");
    expect(prompt).toContain("never start again from S");
    expect(prompt).not.toContain("Time limit");
    expect(mazePrompt(grid, [1, 1], [3, 3], undefined, { timeLimitS: 300 })).toContain("Time limit: about 5 minutes");
  });

  it("pads cells to the widest column number so wide grids stay aligned", async () => {
    const { numberedGrid } = await import("./maze");
    const row = "#".repeat(11) + "." + "#".repeat(11);
    const lines = numberedGrid(Array(23).fill(row));
    expect(lines[0]!.startsWith("   |  0  1  2")).toBe(true);
    expect(lines[0]!.endsWith("21 22")).toBe(true);
    expect(lines[2]).toBe(" 0 |  #  #  #  #  #  #  #  #  #  #  #  .  #  #  #  #  #  #  #  #  #  #  #");
    // column 11 sits under its number
    expect(lines[2]![lines[0]!.indexOf("11") + 1]).toBe(".");
    expect(new Set(lines.filter((l) => !l.includes("+")).map((l) => l.indexOf("|"))).size).toBe(1);
  });

  it("lists the open cells of each row as ranges", async () => {
    const { openCells, mazePrompt } = await import("./maze");
    const grid = ["#######", "#S..#.#", "#.#...#", "#..##G#", "#######"];
    expect(openCells(grid)).toEqual(["row 0: none", "row 1: 1-3, 5", "row 2: 1, 3-5", "row 3: 1-2, 5", "row 4: none"]);
    expect(mazePrompt(grid, [1, 1], [3, 5])).toContain("row 2: 1, 3-5");
  });
});

describe("maze until solved", () => {
  const grid = ["#####", "#S..#", "##.##", "#..G#", "#####"];

  it("names the move and cell a route crashes into", async () => {
    const { walk, crashText } = await import("./maze");
    const run = walk(grid, [1, 1], ["D"]);
    expect(run.crash).toEqual({ move: 1, dir: "D", from: [1, 1], wall: [2, 1] });
    expect(crashText(run.crash!)).toBe("move 1 (D = down) from row 1, column 1 runs into the wall at row 2, column 1");
  });

  it("keeps the valid moves, tells the model where it stands, and finishes later", async () => {
    const { maze } = await import("./maze");
    const p = maze.generate(7, "easy");
    const it2 = p.iterate!;
    const g = (p.data as { grid: string[] }).grid;
    // first turn: one valid step then straight into the outer wall
    const firstOpen = g[1]![2] !== "#" ? "R" : "D";
    const wallDir = firstOpen === "R" ? "U" : "L";
    const t1 = it2.apply(it2.start, `<answer>${firstOpen}${wallDir}</answer>`);
    expect(t1.valid).toBe(true);
    expect(t1.solved).toBe(false);
    expect(t1.applied).toEqual([firstOpen]);
    expect(t1.note).toContain("runs into the wall");
    const follow = it2.followUp(t1.state, t1.applied, 2);
    expect(follow).toContain("## PROGRESS (turn 2)");
    expect(follow).toMatch(/runs into the wall at row \d+, column \d+/);
    expect(follow).toContain("You are now at row");
    const v = it2.verdict(t1.state, t1.applied, 2);
    expect(v.solved).toBe(false);
    expect(v.note).toContain("over 2 turns");
  });
});

describe("maze: unreadable answers say why", () => {
  it("points at look-alike letters", () => {
    expect(unreadable("DDRRDDDДRR")).toBe('answer is not a pure U/D/L/R sequence — contains "Д"');
    expect(unreadable("")).toBe("no move sequence (U/D/L/R) found");
    expect(unreadable("I could not find a path")).toBe("no move sequence (U/D/L/R) found");
  });
});

describe("maze: hard has 2–3 routes, expert 3–4, that go clearly different ways", () => {
  it.each([
    ["hard", 2, 3],
    ["expert", 3, 4],
  ] as const)(
    "%s",
    (level, lo, hi) => {
      for (let seed = 1; seed <= 12; seed++) {
        const puzzle = challengeById("maze")!.generate(seed, level);
        const grid = (puzzle.data as { grid: string[] }).grid;
        const paths = routePaths(grid);
        expect(paths.length).toBeGreaterThanOrEqual(lo);
        expect(paths.length).toBeLessThanOrEqual(hi);
        // no two routes share more than 70% of the shorter one, lengths ≥10% (min 6) apart
        expect(routeOverlap(paths)).toBeLessThanOrEqual(MAX_ROUTE_OVERLAP);
        // the count is not told: it made careful models stop and verify the maze's structure
        expect(puzzle.prompt).not.toContain("different routes");
      }
    },
    20_000,
  );

  it("easy keeps its loops and says nothing about a route count", () => {
    const puzzle = challengeById("maze")!.generate(7, "easy");
    expect(puzzle.prompt).not.toContain("different routes");
    expect(makeMaze(7, 4)).toEqual(makeMaze(7, 4)); // deterministic
  });

  it("other challenges play expert as hard", async () => {
    const { levelFor } = await import("./index");
    expect(levelFor("maze", "expert")).toBe("expert");
    expect(levelFor("cube", "expert")).toBe("hard");
    expect(challengeById("cube")!.generate(5, "expert").prompt).toBe(challengeById("cube")!.generate(5, "hard").prompt);
  });
});

describe("maze answers may use run-length shorthand", () => {
  it("expands runs like the prompt shows them", () => {
    expect(parseMoves("R4 D2 L1 D3")?.join("")).toBe("RRRRDDLDDD");
    expect(parseMoves("R×4 D×2")?.join("")).toBe("RRRRDD");
    expect(parseMoves("r x 3, d*1")?.join("")).toBe("RRRD");
    expect(parseMoves("RRDD")?.join("")).toBe("RRDD");
    expect(parseMoves("R4 then go D2")).toBeNull();
  });
});
