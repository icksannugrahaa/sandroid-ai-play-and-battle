import { describe, expect, it } from "vitest";

import { applyMoves, cube, isSolved, parseMoves, scramble, solvedCube } from "./cube";

const m = (s: string) => parseMoves(s)!;

describe("cube model", () => {
  it("four quarter turns are the identity for every face", () => {
    for (const f of "URFDLB") expect(applyMoves(solvedCube(), m(`${f} ${f} ${f} ${f}`))).toEqual(solvedCube());
  });
  it("sexy move ×6 is the identity, and a sequence + inverse cancels", () => {
    expect(isSolved(applyMoves(solvedCube(), m("R U R' U' ".repeat(6))))).toBe(true);
    expect(isSolved(applyMoves(solvedCube(), m("R U F2 L' D B")))).toBe(false);
    expect(isSolved(applyMoves(solvedCube(), m("R U F2 L' D B B' D' L F2 U' R'")))).toBe(true);
  });
  it("U moves the front top row to the left face", () => {
    const c = applyMoves(solvedCube(), m("U"));
    expect(c.slice(36, 39)).toEqual(["G", "G", "G"]); // L top row (index 4*9)
    expect(c.slice(18, 21)).toEqual(["R", "R", "R"]); // F top row gets R
  });
  it("R moves the front right column up to U", () => {
    const c = applyMoves(solvedCube(), m("R"));
    expect([c[2], c[5], c[8]]).toEqual(["G", "G", "G"]);
  });
  it("the inverse scramble solves the puzzle with full score", async () => {
    const p = cube.generate(42, "medium");
    const inv = scramble(42, 4)
      .reverse()
      .map((x) => x.face + (x.turns === 1 ? "'" : x.turns === 3 ? "" : "2"))
      .join(" ");
    const v = await p.check(`ok <answer>${inv}</answer>`);
    expect(v.solved).toBe(true);
    expect(v.score).toBe(100);
    expect((await p.check("<answer>R</answer>")).solved).toBe(false);
    expect((await p.check("<answer>hello</answer>")).score).toBe(0);
  });
});

describe("move budget", () => {
  const inverse = (seed: number, n: number) =>
    scramble(seed, n)
      .reverse()
      .map((x) => x.face + (x.turns === 1 ? "'" : x.turns === 3 ? "" : "2"))
      .join(" ");

  it("is unlimited by default and no longer hints the scramble length", async () => {
    const p = cube.generate(42, "medium");
    // the brief: task, position, unlimited moves, time limit, scoring = solved first, then fewest moves
    expect(p.prompt).toMatch(/## TASK[\s\S]*## CURRENT POSITION[\s\S]*## NOTATION[\s\S]*## RULES[\s\S]*## SCORING[\s\S]*## ANSWER FORMAT/);
    expect(p.prompt).toMatch(/Move limit: NONE/);
    expect(p.prompt).toMatch(/COMPLETELY solved — otherwise the answer fails/);
    expect(p.prompt).toMatch(/FEWER moves score higher/);
    expect(p.prompt).toMatch(/long but correct solution always beats a short wrong one/);
    expect(p.prompt).toMatch(/do NOT answer with a placeholder/);
    expect(cube.generate(42, "medium", { timeLimitS: 600 }).prompt).toMatch(/Time limit: about 10 minutes/);
    expect(p.prompt).not.toMatch(/scrambled with at most/);
    // a long but valid solution: 4 extra U turns (identity) + the inverse scramble
    const v = await p.check(`<answer>U U U U ${inverse(42, 4)}</answer>`);
    expect(v).toMatchObject({ solved: true, moves: 8 });
    expect(v.score).toBeLessThan(100);
  });

  it("enforces a cap when one is set", async () => {
    const p = cube.generate(42, "medium", { maxMoves: 6 });
    expect(p.prompt).toMatch(/at most 6 moves/);
    expect(await p.check(`<answer>${inverse(42, 4)}</answer>`)).toMatchObject({ solved: true, moves: 4 });
    expect(await p.check(`<answer>U U U U ${inverse(42, 4)}</answer>`)).toMatchObject({ solved: false, score: 0, moves: 8 });
  });
});

describe("piece-list state format", () => {
  it("names pieces and their colours correctly", async () => {
    const { piecesText, stateText } = await import("./cube");
    const solved = piecesText(solvedCube());
    expect(solved).toMatch(/UFR: W G R {2}✓/);
    expect(solved.match(/✓/g)).toHaveLength(20);
    // R: the DFR corner rises to UFR, its F (green) sticker now facing up
    const r = piecesText(applyMoves(solvedCube(), m("R")));
    expect(r).toMatch(/UFR: G Y R\n/);
    expect(r).toMatch(/UR: G R\n/);
    expect(r.match(/✓/g)).toHaveLength(12); // 8 pieces of the R layer moved
    // the move reference: R takes the front-top corner to the back-top
    const rLine = stateText(solvedCube())
      .split("\n")
      .find((l) => l.startsWith("- R:"))!;
    for (const step of ["UFR→UBR", "UBR→DBR", "DBR→DFR", "DFR→UFR", "UR→BR", "FR→UR"]) expect(rLine).toContain(step);
  });

  it("is the default; the old net is still available", () => {
    expect(cube.generate(5, "easy").prompt).toMatch(/list of PIECES/);
    expect(cube.generate(5, "easy", { stateFormat: "net" }).prompt).toMatch(/U face:\n/);
  });
});

describe("move reference matches the simulation", () => {
  it("every arrow A→B: after the turn, position B holds the piece that was at A", async () => {
    const { piecesText, stateText } = await import("./cube");
    const colours = (text: string) =>
      Object.fromEntries(
        text
          .split("\n")
          .filter((l) => /^[UDFBRL]{2,3}:/.test(l))
          .map((l) => [l.split(":")[0]!, l.split(":")[1]!.replace("✓", "").trim().split(" ").sort().join("")]),
      );
    const before = colours(piecesText(solvedCube()));
    for (const face of "URFDLB") {
      const after = colours(piecesText(applyMoves(solvedCube(), m(face))));
      const line = stateText(solvedCube())
        .split("\n")
        .find((l) => l.startsWith(`- ${face}:`))!;
      for (const cycle of line.match(/[UDFBRL]{2,3}(?:→[UDFBRL]{2,3})+/g)!) {
        const names = cycle.split("→");
        for (let i = 0; i + 1 < names.length; i++)
          expect(after[names[i + 1]!], `${face}: ${names[i]}→${names[i + 1]}`).toBe(before[names[i]!]);
      }
    }
  });
});

describe("fabricated-answer detection", () => {
  it("flags deepseek's filler answer from a live run", async () => {
    const { fabricationSigns } = await import("./cube");
    const deepseek =
      "U R2 F2 D' L2 B2 R2 F2 U' R2 B2 L2 D2 F2 R2 U2 F2 L2 B2 D2 R2 U2 B2 U R F D L B R2 F2 D2 L2 B2 U2 R2 F2 D2 L2 B2 U2".split(" ");
    const signs = fabricationSigns(deepseek);
    expect(signs.join()).toMatch(/six face names/);
    expect(signs.join()).toMatch(/half turns in a row/);
  });

  it("does not flag real solutions", async () => {
    const { fabricationSigns } = await import("./cube");
    // claude's beginner-method answer (repeats R U R' U' legitimately) and kimi's optimal one
    const claude =
      "F2 U' R U R' F R' F' U' F U F' R U R' U2 F U F' U' R U R' U F U' F' U2 R U R' U R U2 R' U2 F U F' U F U2 F' U R U R' U' R U R' U' R U R' U R U2 R' U".split(
        " ",
      );
    expect(fabricationSigns(claude)).toEqual([]);
    expect(fabricationSigns(["R'", "L2"])).toEqual([]);
    // a Kociemba solution (phase 2 has many half turns, but not 10 in a row)
    expect(fabricationSigns("U D B U' D B D2 R2 F2 L2 F2 B2 D' R2 B2 R2 B2".split(" "))).toEqual([]);
  });

  it("shows up on a wrong answer's verdict", async () => {
    const p = cube.generate(141405, "easy");
    const v = await p.check("<answer>U R F D L B R2 F2</answer>");
    expect(v.solved).toBe(false);
    expect(v.flags!.length).toBeGreaterThan(0);
    expect(p.prompt).toMatch(/only write moves you have actually checked/);
  });
});

describe("fabrication: admissions and pasted blocks", () => {
  it("flags deepseek's give-up answer from a live run", async () => {
    const { fabricationSigns } = await import("./cube");
    const moves = "B U B' U' ".repeat(8).trim().split(" ");
    const text = "I'm sorry, I cannot solve this in time. I'll provide a placeholder answer… but I know it's wrong.";
    const signs = fabricationSigns(moves, text).join(" | ");
    expect(signs).toMatch(/the model itself says so/);
    expect(signs).toMatch(/"B U B' U'" repeats 8×/);
  });
  it("flags deepseek's T-perm placeholder from a live run", async () => {
    const { fabricationSigns } = await import("./cube");
    const text =
      "I'll put a placeholder algorithm… (a T-perm) — might not be correct for full cube… I recognize it won't complete. I can't honestly give correct one under constraints.";
    expect(fabricationSigns("R U R' U' R' F R2 U' R' U' R U R' F'".split(" "), text).join()).toMatch(/the model itself says so/);
  });
  it("still leaves honest beginner-method answers alone", async () => {
    const { fabricationSigns } = await import("./cube");
    const claude =
      "F2 U' R U R' F R' F' U' F U F' R U R' U2 F U F' U' R U R' U F U' F' U2 R U R' U R U2 R' U2 F U F' U F U2 F' U R U R' U' R U R' U' R U R' U R U2 R' U".split(
        " ",
      );
    expect(fabricationSigns(claude, "Working through the layers step by step…")).toEqual([]);
  });
});

describe("sticker-orientation table matches the simulation", () => {
  it("every 'A→B [X→Y …]': after the turn, B shows A's X-colour on face Y", async () => {
    const { stateText } = await import("./cube");
    const HOME: Record<string, string> = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };
    const text = stateText(solvedCube());
    let checked = 0;
    for (const face of "URFDLB") {
      const line = text
        .split("\n")
        .find((l) => l.trim().startsWith("stickers:") && text.split("\n")[text.split("\n").indexOf(l) - 1]!.startsWith(`- ${face}:`))!;
      const after = applyMoves(solvedCube(), m(face));
      // colours at a position, keyed by face, read from the piece list
      const { piecesText } = await import("./cube");
      const rows = Object.fromEntries(
        piecesText(after)
          .split("\n")
          .filter((l) => /^[UDFBRL]{2,3}:/.test(l))
          .map((l) => {
            const [name, rest] = l.split(":");
            const cols = rest!.replace("✓", "").trim().split(" ");
            return [name!, Object.fromEntries(name!.split("").map((f, i) => [f, cols[i]]))];
          }),
      );
      for (const entry of line.matchAll(/([UDFBRL]{2,3})→([UDFBRL]{2,3}) \[([^\]]+)\]/g)) {
        const [, , dest, map] = entry;
        for (const pair of map!.split(" ")) {
          const [from, to] = pair.split("→");
          expect(rows[dest!]![to!], `${face}: ${entry[0]}`).toBe(HOME[from!]);
          checked++;
        }
      }
    }
    expect(checked).toBe(6 * (4 * 3 + 4 * 2));
  });

  it("distance hint: on by default on the first turn only, can be turned off", () => {
    const p = cube.generate(42, "medium");
    expect(p.prompt).toMatch(/turning a solved cube 4 times, so a solution of at most 4 moves exists/);
    expect(p.prompt).toMatch(/Move limit: NONE/); // still unlimited
    expect(cube.generate(42, "medium", { distanceHint: false }).prompt).not.toMatch(/solution of at most/);
    const follow = p.iterate!.followUp(p.iterate!.start, ["R"], 2, undefined);
    expect(follow).not.toMatch(/solution of at most/);
  });
});
