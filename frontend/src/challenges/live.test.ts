import { describe, expect, it } from "vitest";

import { attemptCount, cubeAttempt, mazeAttempt, routeAttempt, restatesStart, slidingAttempt, startStep, stepBack } from "./live";

describe("live attempts from streamed reasoning", () => {
  it("cube: picks the latest real move run, ignores stray letters", () => {
    const noisy = "Looking at the U face, the corners URF and UBR. R is the right face. Clockwise from top means front-right goes to...";
    expect(cubeAttempt(noisy)).toBeNull();
    const text = `${noisy} Let me try R U R' U' first. Hmm, that breaks the cross. Try F2 L D' B2 instead.`;
    expect(cubeAttempt(text)?.replay).toEqual({ moves: ["F2", "L", "D'", "B2"] });
    expect(cubeAttempt("apply R’ U2 F then")?.label).toBe("R' U2 F");
    // face-name lists aren't attempts — the previous real attempt stays
    expect(cubeAttempt("Try R U R' U' now. The side faces L F R B rotate around U.")?.label).toBe("R U R' U'");
    expect(cubeAttempt("faces U R F D L B are fixed.")).toBeNull();
    // sticker colours (R = red, B = blue) are not moves
    expect(cubeAttempt("F left column = B B B. Row: R B R. Then try R L2 F'.")?.label).toBe("R L2 F'");
    expect(cubeAttempt("The U face reads B R R here.")).toBeNull();
    // still being typed → wait until the run is finished
    expect(cubeAttempt("Let me try R U R")).toBeNull();
    expect(cubeAttempt("Let me try R U R' U'.")?.label).toBe("R U R' U'");
  });

  it("maze: word or spaced runs, simulated against the walls", () => {
    const grid = ["#######", "#S....#", "#####.#", "#G....#", "#######"];
    expect(mazeAttempt(grid, "So: RRRRDDLLLL")).toBeNull(); // may still grow
    const a = mazeAttempt(grid, "UP is blocked. So: RRRRDDLLLL then done");
    expect(a?.label).toBe("RRRRDDLLLL → G in 10");
    expect(a?.replay).toMatchObject({ crashed: false });
    expect((a?.replay as { path: unknown[] }).path).toHaveLength(11);
    expect(mazeAttempt(grid, "moves: R, R, R, R, R, D. Hmm")?.replay).toMatchObject({ crashed: true });
    expect(mazeAttempt(grid, "moves: R, R, R, R, R, D. Hmm")?.label).toBe("RRRRRD → wall after 4");
    expect(mazeAttempt(grid, "Up (U) and down (D)")).toBeNull();
    expect(mazeAttempt(grid, "the segment DDDD then")).toBeNull(); // a fragment, not a route
  });

  it("sliding: keeps the legal prefix", () => {
    expect(slidingAttempt("123456708", "try RRLU next")?.replay).toEqual({ moves: ["R"] });
  });

  it("routes: latest arrow chain of known cities", () => {
    const names = ["Avalon", "Brava", "Cedar"];
    expect(routeAttempt(names, "Avalon -> Cedar costs 9. Better: Avalon → Brava -> Cedar.")?.replay).toEqual([0, 1, 2]);
    expect(routeAttempt(names, "Avalon to Cedar")).toBeNull();
  });
});

describe("attempt count", () => {
  it("counts distinct move runs, ignoring face lists", () => {
    const text = "Try R U R' U'. No. Try F2 L D' B2. Faces L F R B. Back to R U R' U' then U R2 F'.";
    expect(attemptCount("cube", text)).toBe(3);
  });
});

describe("maze: following coordinate reasoning", () => {
  const grid = ["#######", "#S....#", "#.###.#", "#...#.#", "###.#G#", "#######"];

  it("acts out a chain of (row,col) cells, expanding straight runs", () => {
    const a = mazeAttempt(grid, "Path: (1,1) -> (1,5) -> (3,5) then check")!;
    expect(a.replay).toEqual({
      path: [
        [1, 1],
        [1, 2],
        [1, 3],
        [1, 4],
        [1, 5],
        [2, 5],
        [3, 5],
      ],
      crashed: false,
    });
    expect(a.label).toBe("(1,1)→(1,5)→(3,5)");
  });

  it("follows BFS layers written as (r,c)=distance and stops at a wall", () => {
    const a = mazeAttempt(grid, "BFS: (1,1)=0, (2,1)=1, (3,1)=2, (3,3)=4, (1,3)=6. next")!;
    expect((a.replay as { crashed: boolean }).crashed).toBe(true); // (3,3) → (1,3) goes through the wall at (2,3)
  });

  it("ignores cells merely mentioned in prose, and chains still growing at the end", () => {
    expect(mazeAttempt(grid, "S is at (1,1) and G is at (4,5), the wall at (2,2) blocks")).toBeNull();
    expect(mazeAttempt(grid, "(1,1) -> (1,2) -> (1,3)")).toBeNull();
  });

  it("uses whichever attempt came last: letters or coordinates", () => {
    const a = mazeAttempt(grid, "(1,1) -> (1,2) -> (1,3) hmm. Better: RRRRDD then done")!;
    expect(a.label).toBe("RRRRDD");
    const b = mazeAttempt(grid, "RRRRDD hmm. Better: (1,1) -> (2,1) -> (3,1) yes")!;
    expect(b.label).toBe("(1,1)→(2,1)→(3,1)");
  });

  it("in until-solved play, letter attempts continue from where the model stands", () => {
    const a = mazeAttempt(grid, "now: RRRDDD then", ["R"])!;
    expect((a.replay as { path: [number, number][] }).path[0]).toEqual([1, 2]);
    expect(a.label).toBe("RRRDDD → G in 6");
  });

  it("skips chains that don't start where the model stands (local checks, not routes)", () => {
    expect(mazeAttempt(grid, "check: (1,3) -> (1,5) -> (3,5) ok")).toBeNull();
    expect(mazeAttempt(grid, "check: (1,2) -> (1,5) -> (3,5) ok", ["R"])?.label).toBe("(1,2)→(1,5)→(3,5)");
  });

  it("the same route re-verified keeps the same key, so the animation doesn't restart", () => {
    const a = mazeAttempt(grid, "RRRRDDD then")!;
    const b = mazeAttempt(grid, "RRRRDDD then verify (1,1) -> (1,5) -> (4,5) done")!;
    expect(a.label).toBe("RRRRDDD → G in 7");
    expect(b.key).toBe(a.key);
  });
});

describe("live playback continuity", () => {
  const grid = ["#######", "#S....#", "#.###.#", "#...#.#", "###.#G#", "#######"];

  it("ignores letter runs that hit a wall at once (exploration written from another cell)", () => {
    expect(mazeAttempt(grid, "from (3,3): LLDDRRUU then")).toBeNull();
    expect(mazeAttempt(grid, 'segment "DDDDDD" ok')).toBeNull(); // wall after 2 of 6: a re-checked piece
    expect(mazeAttempt(grid, "try RRRRLLLD then")?.label).toBe("RRRRLLLD → wall after 7");
  });

  it("a new attempt continues from where it parts from the one on screen", () => {
    const a = mazeAttempt(grid, "RRRRLLLD then")!;
    const b = mazeAttempt(grid, "RRRRDDD then")!;
    expect(startStep(a.replay, b.replay, 0)).toBe(4); // both walk (1,1)→(1,5) first
    expect(startStep(null, b.replay, 0)).toBe(0);
    expect(startStep({ moves: ["R", "U", "F"] }, { moves: ["R", "U", "B", "L"] }, 0)).toBe(2);
    expect(startStep({ moves: ["R"] }, { moves: ["R", "U", "B"] }, 2)).toBe(2);
  });
});

describe("re-traced starts don't replace a longer route", () => {
  const grid = ["#######", "#S....#", "#.###.#", "#...#.#", "###.#G#", "#######"];
  it("a shorter restatement of the same start is kept out, a different branch is not", () => {
    const long = mazeAttempt(grid, "RRRRDDD then")!;
    const again = mazeAttempt(grid, "From start: (1,1) -> (1,5) -> (2,5) next")!;
    expect(restatesStart(long.replay, again.replay)).toBe(true);
    const other = mazeAttempt(grid, "(1,1) -> (3,1) -> (3,3) next")!;
    expect(restatesStart(long.replay, other.replay)).toBe(false);
    expect(restatesStart(again.replay, long.replay)).toBe(false); // going further replaces it
    expect(restatesStart({ moves: ["R", "U", "F"] }, { moves: ["R", "U"] })).toBe(true);
  });
});

describe("the board never goes backwards", () => {
  const grid = ["#######", "#S....#", "#.###.#", "#...#.#", "###.#G#", "#######"];
  it("a route that reached G stays; wall-hits never replace a route that got further", () => {
    const done = mazeAttempt(grid, "RRRRDDD then")!;
    expect(done.reached).toBe(true);
    const recheck = mazeAttempt(grid, "count: RRRRLLLD ok")!; // hits a wall after 7
    expect(stepBack(done, recheck)).toBe(true);
    const otherDone = mazeAttempt(grid, "(1,1) -> (1,5) -> (4,5) yes")!;
    expect(stepBack(done, otherDone)).toBe(false);
    const partial = mazeAttempt(grid, "(1,1) -> (1,2) -> (1,3) next")!;
    expect(stepBack(partial, recheck)).toBe(false); // got further than the partial one
    expect(stepBack(recheck, partial)).toBe(false); // exploring on is fine
  });
});
