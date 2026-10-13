/**
 * 3D scenes per challenge. Each model's card gets its own scene built from the same
 * puzzle data, then plays back that model's answer step by step.
 */
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import { ease, glyphTexture, label, placeCamera, THREE, type Stage, type StageCtx, type StageDef } from "./stage";

type V3 = [number, number, number];
const ARC_PALETTE = ["#1f2937", "#0074d9", "#ff4136", "#2ecc40", "#ffdc00", "#aaaaaa", "#f012be", "#ff851b", "#7fdbff", "#870c25"];

/** Small tween helper: run `fn(t)` for t 0→1 over `dur` seconds. */
class Tweens {
  private list: { t: number; dur: number; fn: (t: number) => void; done?: () => void }[] = [];
  add(dur: number, fn: (t: number) => void, done?: () => void) {
    this.list.push({ t: 0, dur, fn, done });
  }
  finishAll() {
    for (const tw of this.list) {
      tw.fn(1);
      tw.done?.();
    }
    this.list = [];
  }
  tick(dt: number) {
    for (const tw of [...this.list]) {
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      tw.fn(ease(tw.t));
      if (tw.t >= 1) {
        this.list.splice(this.list.indexOf(tw), 1);
        tw.done?.();
      }
    }
  }
  get busy() {
    return this.list.length > 0;
  }
}

function base(ctx: StageCtx, w: number, d: number, color = "#0f172a") {
  const plate = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
  plate.position.y = -0.1;
  ctx.root.add(plate);
  return plate;
}

// ------------------------------------------------------------------ Rubik's cube

const STICKER: Record<string, string> = {
  "0,1,0": "#f8fafc",
  "0,-1,0": "#facc15",
  "0,0,1": "#16a34a",
  "0,0,-1": "#2563eb",
  "1,0,0": "#dc2626",
  "-1,0,0": "#f97316",
};
const AXIS: Record<string, V3> = { U: [0, 1, 0], D: [0, -1, 0], R: [1, 0, 0], L: [-1, 0, 0], F: [0, 0, 1], B: [0, 0, -1] };

function parseMove(m: string): { axis: THREE.Vector3; angle: number } | null {
  const a = AXIS[m[0]!];
  if (!a) return null;
  const turns = m.includes("2") ? 2 : m.includes("'") ? 3 : 1;
  // clockwise seen from the face = −90° about its outward axis (right-hand rule)
  return { axis: new THREE.Vector3(...a), angle: turns === 1 ? -Math.PI / 2 : turns === 2 ? -Math.PI : Math.PI / 2 };
}

/** Remove float drift after a turn: integer position, rotation matrix of exact 0/±1 entries. */
function snap(o: THREE.Object3D) {
  o.position.set(Math.round(o.position.x), Math.round(o.position.y), Math.round(o.position.z));
  const m = new THREE.Matrix4().makeRotationFromQuaternion(o.quaternion);
  m.elements.forEach((v, i) => (m.elements[i] = Math.round(v)));
  o.quaternion.setFromRotationMatrix(m);
  o.updateMatrix();
}

const cube: StageDef = {
  create(ctx, data, replay) {
    const scramble = (data as { scramble: string[] }).scramble;
    const moves = (replay as { moves?: string[] } | undefined)?.moves ?? [];
    placeCamera(ctx, [4.4, 3.8, 5.4]);
    const body = new THREE.MeshStandardMaterial({ color: "#0b1220", roughness: 0.5 });
    const geo = new RoundedBoxGeometry(0.96, 0.96, 0.96, 3, 0.1);
    const plane = new THREE.PlaneGeometry(0.8, 0.8);
    const mats = Object.fromEntries(
      Object.entries(STICKER).map(([k, c]) => [k, new THREE.MeshStandardMaterial({ color: c, roughness: 0.35 })]),
    );
    const cubies: THREE.Group[] = [];
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++) {
          if (!x && !y && !z) continue;
          const g = new THREE.Group();
          g.add(new THREE.Mesh(geo, body));
          for (const [key, mat] of Object.entries(mats)) {
            const n = key.split(",").map(Number) as V3;
            if (n[0] * x + n[1] * y + n[2] * z !== 1) continue; // only outward faces
            const s = new THREE.Mesh(plane, mat);
            s.position.set(n[0] * 0.485, n[1] * 0.485, n[2] * 0.485);
            s.lookAt(n[0] * 2, n[1] * 2, n[2] * 2);
            g.add(s);
          }
          g.userData.home = [x, y, z];
          ctx.root.add(g);
          cubies.push(g);
        }
    const tweens = new Tweens();
    const layer = (axis: THREE.Vector3) => cubies.filter((c) => Math.round(c.position.dot(axis)) === 1);
    const turnNow = (m: string) => {
      const mv = parseMove(m);
      if (!mv) return;
      const q = new THREE.Quaternion().setFromAxisAngle(mv.axis, mv.angle);
      for (const c of layer(mv.axis)) {
        c.position.applyQuaternion(q);
        c.quaternion.premultiply(q);
        snap(c);
      }
    };
    const turnAnimated = (m: string) => {
      const mv = parseMove(m);
      if (!mv) return;
      const pivot = new THREE.Group();
      ctx.root.add(pivot);
      for (const c of layer(mv.axis)) pivot.attach(c);
      tweens.add(
        Math.abs(mv.angle) > 2 ? 0.55 : 0.35,
        (t) => pivot.quaternion.setFromAxisAngle(mv.axis, mv.angle * t),
        () => {
          for (const c of [...pivot.children]) {
            ctx.root.attach(c);
            snap(c);
          }
          ctx.root.remove(pivot);
        },
      );
    };
    const reset = (k: number) => {
      for (const c of cubies) {
        c.position.set(...(c.userData.home as V3));
        c.quaternion.identity();
      }
      for (const m of scramble) turnNow(m);
      for (const m of moves.slice(0, k)) turnNow(m);
    };
    reset(0);
    return {
      setStep(k, animate) {
        tweens.finishAll();
        if (animate && k >= 1) turnAnimated(moves[k - 1]!);
        else reset(k);
      },
      tick: (dt) => tweens.tick(dt),
    };
  },
};

// ------------------------------------------------------------------ maze

interface MazeReplay {
  path: [number, number][];
  crashed: boolean;
}

const maze: StageDef = {
  create(ctx, data, replay) {
    const grid = (data as { grid: string[] }).grid;
    const rp = replay as MazeReplay | undefined;
    const n = grid.length;
    const at = (r: number, c: number) => new THREE.Vector3(c - (n - 1) / 2, 0, r - (n - 1) / 2);
    placeCamera(ctx, [0, n * 0.95, n * 0.72]);
    base(ctx, n + 0.4, n + 0.4, "#1e293b");
    const walls = grid.flatMap((row, r) => [...row].map((ch, c) => (ch === "#" ? at(r, c) : null))).filter(Boolean) as THREE.Vector3[];
    const wallMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.7, 1),
      new THREE.MeshStandardMaterial({ color: "#334155", roughness: 0.7 }),
      walls.length,
    );
    const m = new THREE.Matrix4();
    walls.forEach((p, i) => wallMesh.setMatrixAt(i, m.makeTranslation(p.x, 0.35, p.z)));
    ctx.root.add(wallMesh);
    const marker = (ch: string, color: string) => {
      const r = grid.findIndex((row) => row.includes(ch));
      const p = at(r, grid[r]!.indexOf(ch));
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.38, 0.38, 0.08, 24),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5 }),
      );
      mesh.position.set(p.x, 0.04, p.z);
      ctx.root.add(mesh);
      const l = label(ch, { size: 0.6, bold: true });
      l.position.set(p.x, 1.1, p.z);
      ctx.root.add(l);
    };
    marker("S", "#0284c7");
    marker("G", "#059669");
    const path = rp?.path ?? [];
    const trail = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.7, 0.04, 0.7),
      new THREE.MeshStandardMaterial({ color: "#f59e0b", emissive: "#b45309", emissiveIntensity: 0.4 }),
      Math.max(1, path.length),
    );
    path.forEach(([r, c], i) => {
      const p = at(r, c);
      trail.setMatrixAt(i, m.makeTranslation(p.x, 0.03, p.z));
    });
    trail.count = 0;
    ctx.root.add(trail);
    const ballMat = new THREE.MeshStandardMaterial({ color: "#fbbf24", emissive: "#f59e0b", emissiveIntensity: 0.6, roughness: 0.3 });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), ballMat);
    ball.visible = path.length > 0;
    ctx.root.add(ball);
    const tweens = new Tweens();
    const place = (k: number) => {
      const p = path[k] ? at(...path[k]!) : at(1, 1);
      ball.position.set(p.x, 0.32, p.z);
    };
    const crashAt = (k: number) => !!rp?.crashed && k === path.length - 1;
    return {
      setStep(k, animate) {
        tweens.finishAll();
        trail.count = Math.min(path.length, k + 1);
        trail.instanceMatrix.needsUpdate = true;
        ballMat.color.set(crashAt(k) ? "#e11d48" : "#fbbf24");
        ballMat.emissive.set(crashAt(k) ? "#9f1239" : "#f59e0b");
        if (animate && k >= 1 && path[k]) {
          const from = at(...path[k - 1]!);
          const to = at(...path[k]!);
          tweens.add(0.16, (t) => {
            ball.position.lerpVectors(from, to, t);
            ball.position.y = 0.32 + Math.sin(t * Math.PI) * 0.15;
          });
        } else place(k);
      },
      tick: (dt) => tweens.tick(dt),
    };
  },
};

// ------------------------------------------------------------------ 8-puzzle

const STEP: Record<string, number> = { U: -3, D: 3, L: -1, R: 1 };
function slideState(s: string, m: string): string {
  const z = s.indexOf("0");
  const to = z + STEP[m]!;
  const a = s.split("");
  [a[z], a[to]] = [a[to]!, a[z]!];
  return a.join("");
}

const sliding: StageDef = {
  create(ctx, data, replay) {
    const start = (data as { start: string }).start;
    const moves = (replay as { moves?: string[] } | undefined)?.moves ?? [];
    const states = [start];
    for (const m of moves) states.push(slideState(states.at(-1)!, m));
    placeCamera(ctx, [0, 4.6, 3.6]);
    base(ctx, 3.4, 3.4, "#1e293b");
    const pos = (i: number) => new THREE.Vector3((i % 3) - 1, 0.2, Math.floor(i / 3) - 1);
    const tiles: Record<string, THREE.Mesh> = {};
    const side = new THREE.MeshStandardMaterial({ color: "#1e3a5f", roughness: 0.6 });
    for (let d = 1; d <= 8; d++) {
      const top = new THREE.MeshStandardMaterial({ map: glyphTexture(String(d), "#e0f2fe", "#1e40af"), roughness: 0.5 });
      const tile = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.36, 0.92), [side, side, top, side, side, side]);
      tiles[String(d)] = tile;
      ctx.root.add(tile);
    }
    const tweens = new Tweens();
    const layout = (s: string) => [...s].forEach((ch, i) => ch !== "0" && tiles[ch]!.position.copy(pos(i)));
    const glow = (on: boolean) => {
      side.color.set(on ? "#065f46" : "#1e3a5f");
    };
    return {
      setStep(k, animate) {
        tweens.finishAll();
        const s = states[Math.min(k, states.length - 1)]!;
        glow(s === "123456780");
        if (animate && k >= 1) {
          const prev = states[k - 1]!;
          const moved = s[prev.indexOf("0")]!; // the tile now where the blank was
          const tile = tiles[moved]!;
          const from = tile.position.clone();
          const to = pos(s.indexOf(moved));
          tweens.add(0.18, (t) => tile.position.lerpVectors(from, to, t));
        } else layout(s);
      },
      tick: (dt) => tweens.tick(dt),
    };
  },
};

// ------------------------------------------------------------------ water jugs

const jugs: StageDef = {
  create(ctx, data, replay) {
    const { caps, target } = data as { caps: number[]; target: number };
    const states = (replay as { states?: number[][] } | undefined)?.states ?? [caps.map(() => 0)];
    const max = Math.max(...caps);
    const gap = 1.5;
    placeCamera(ctx, [0, 2.4, 5.6], [0, 1.1, 0]);
    base(ctx, caps.length * gap + 1, 2.2, "#1e293b");
    const waters: THREE.Mesh[] = [];
    const labels: THREE.Sprite[] = [];
    caps.forEach((cap, i) => {
      const h = 0.4 + (cap / max) * 2.2;
      const x = (i - (caps.length - 1) / 2) * gap;
      const glass = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, h, 40, 1, true),
        new THREE.MeshPhysicalMaterial({ color: "#e2e8f0", transparent: true, opacity: 0.32, roughness: 0.15, side: THREE.DoubleSide }),
      );
      glass.position.set(x, h / 2, 0);
      ctx.root.add(glass);
      // rim + bottom so an empty jug still reads clearly
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 8, 40), new THREE.MeshStandardMaterial({ color: "#cbd5e1" }));
      rim.rotation.x = Math.PI / 2;
      rim.position.set(x, h, 0);
      const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.04, 40), new THREE.MeshStandardMaterial({ color: "#94a3b8" }));
      bottom.position.set(x, 0.02, 0);
      ctx.root.add(rim, bottom);
      const water = new THREE.Mesh(
        new THREE.CylinderGeometry(0.46, 0.46, 1, 40),
        new THREE.MeshStandardMaterial({ color: "#0ea5e9", transparent: true, opacity: 0.85, roughness: 0.2 }),
      );
      water.userData = { h, x };
      ctx.root.add(water);
      waters.push(water);
      const name = label(`${"ABC"[i]} · ${cap} L`, { size: 0.32, color: "#94a3b8" });
      name.position.set(x, -0.35 + 0.1, 0.9);
      ctx.root.add(name);
      labels.push(name);
    });
    const goal = label(`target ${target} L`, { size: 0.34, color: "#e2e8f0", bg: "#0f172acc" });
    goal.position.set(0, 3.1, 0);
    ctx.root.add(goal);
    const tweens = new Tweens();
    const level = (i: number, v: number) => {
      const w = waters[i]!;
      const { h, x } = w.userData as { h: number; x: number };
      const y = Math.max(0.001, (v / caps[i]!) * h);
      w.scale.y = y;
      w.position.set(x, y / 2, 0);
    };
    const shown = caps.map(() => 0);
    return {
      setStep(k, animate) {
        tweens.finishAll();
        const s = states[Math.min(k, states.length - 1)]!;
        s.forEach((v, i) => {
          (waters[i]!.material as THREE.MeshStandardMaterial).color.set(v === target ? "#10b981" : "#0ea5e9");
          const from = shown[i]!;
          if (animate) tweens.add(0.45, (t) => level(i, from + (v - from) * t));
          else level(i, v);
          shown[i] = v;
        });
      },
      tick: (dt) => tweens.tick(dt),
    };
  },
};

// ------------------------------------------------------------------ sudoku

const sudoku: StageDef = {
  create(ctx, data, replay) {
    const puzzle = (data as { puzzle: number[] }).puzzle;
    const rp = replay as { grid: number[]; wrong: number[] } | undefined;
    const wrong = new Set(rp?.wrong);
    const blanks = puzzle.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    placeCamera(ctx, [0, 8.6, 6.4]);
    base(ctx, 9.6, 9.6, "#0b1220");
    // 3×3 box shading
    for (let b = 0; b < 9; b++) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(2.96, 0.02, 2.96),
        new THREE.MeshStandardMaterial({ color: b % 2 ? "#13203a" : "#172a48" }),
      );
      box.position.set(((b % 3) - 1) * 3, 0.01, (Math.floor(b / 3) - 1) * 3);
      ctx.root.add(box);
    }
    const tex = new Map<string, THREE.Texture>();
    const face = (d: number, fg: string, bg: string) => {
      const key = `${d}${fg}${bg}`;
      if (!tex.has(key)) tex.set(key, glyphTexture(String(d), fg, bg));
      return tex.get(key)!;
    };
    const tileGeo = new THREE.BoxGeometry(0.9, 0.22, 0.9);
    const sideMat = new THREE.MeshStandardMaterial({ color: "#334155" });
    const at = (i: number) => new THREE.Vector3((i % 9) - 4, 0.12, Math.floor(i / 9) - 4);
    puzzle.forEach((v, i) => {
      if (!v) return;
      const top = new THREE.MeshStandardMaterial({ map: face(v, "#0f172a", "#e2e8f0") });
      const t = new THREE.Mesh(tileGeo, [sideMat, sideMat, top, sideMat, sideMat, sideMat]);
      t.position.copy(at(i));
      ctx.root.add(t);
    });
    const fills = blanks.map((i) => {
      const v = rp?.grid[i] ?? 0;
      const bad = wrong.has(i);
      const top = new THREE.MeshStandardMaterial({ map: face(v, bad ? "#fff1f2" : "#e0f2fe", bad ? "#be123c" : "#0369a1") });
      const t = new THREE.Mesh(tileGeo, [sideMat, sideMat, top, sideMat, sideMat, sideMat]);
      t.position.copy(at(i));
      t.visible = false;
      ctx.root.add(t);
      return t;
    });
    const tweens = new Tweens();
    return {
      setStep(k, animate) {
        tweens.finishAll();
        fills.forEach((t, j) => {
          t.visible = j < k;
          t.scale.setScalar(1);
          t.position.y = 0.12;
        });
        const t = fills[k - 1];
        if (animate && t)
          tweens.add(0.18, (x) => {
            t.scale.setScalar(0.4 + 0.6 * x);
            t.position.y = 0.12 + (1 - x) * 0.8;
          });
      },
      tick: (dt) => tweens.tick(dt),
    };
  },
};

// ------------------------------------------------------------------ ARC grids

const arc: StageDef = {
  create(ctx, data, replay) {
    const { test, expected } = data as { test: number[][]; expected: number[][] };
    const got = replay as number[][] | undefined;
    const width = (g: number[][]) => g[0]?.length ?? 0;
    const gap = 1.6;
    const total = width(test) + (got ? width(got) + gap : 0) + (got ? width(expected) + gap : 0);
    const span = Math.max(total, 8);
    placeCamera(ctx, [0, span * 0.85, span * 0.75]);
    const geo = new THREE.BoxGeometry(0.9, 1, 0.9);
    const mats = ARC_PALETTE.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
    const badMat = new THREE.MeshStandardMaterial({ color: "#be123c", emissive: "#be123c", emissiveIntensity: 0.6 });
    let x0 = -total / 2;
    const build = (g: number[][], caption: string, wrongVs?: number[][]) => {
      const group = new THREE.Group();
      const h = g.length;
      g.forEach((row, r) =>
        row.forEach((v, c) => {
          const wrong = wrongVs && wrongVs[r]?.[c] !== v;
          const y = v ? 0.55 : 0.12;
          const cell = new THREE.Mesh(geo, wrong ? badMat : (mats[v] ?? mats[0]!));
          cell.scale.y = y;
          cell.position.set(x0 + c + 0.5, y / 2, r - h / 2 + 0.5);
          cell.userData.row = r;
          group.add(cell);
        }),
      );
      const l = label(caption, { size: 0.5, color: "#94a3b8" });
      l.position.set(x0 + width(g) / 2, 0.2, -h / 2 - 0.8);
      group.add(l);
      ctx.root.add(group);
      x0 += width(g) + gap;
      return group;
    };
    build(test, "test input");
    const answer = got ? build(got, "answer", expected) : null;
    const exp = got ? build(expected, "expected") : null;
    const tweens = new Tweens();
    return {
      setStep(k, animate) {
        tweens.finishAll();
        if (exp) exp.visible = !!got && k > got.length;
        answer?.children.forEach((c) => {
          const row = c.userData.row as number | undefined;
          c.visible = row === undefined || row < k;
          if (animate && row === k - 1) {
            const y = c.position.y;
            tweens.add(0.25, (t) => (c.position.y = y + (1 - t) * 1.2));
          }
        });
      },
      tick: (dt) => tweens.tick(dt),
    };
  },
};

// ------------------------------------------------------------------ cheapest route

const routes: StageDef = {
  create(ctx, data, replay) {
    const { names, pos, edges, from, to } = data as {
      names: string[];
      pos: [number, number][];
      edges: { a: number; b: number; w: number }[];
      from: number;
      to: number;
    };
    const path = (replay as number[] | undefined) ?? [];
    const P = (i: number) => new THREE.Vector3((pos[i]![0] - 50) / 9, 0, (pos[i]![1] - 50) / 9);
    placeCamera(ctx, [0, 9.5, 8.2]);
    base(ctx, 12, 12, "#0b1424");
    const roadMat = new THREE.MeshStandardMaterial({ color: "#475569" });
    const hotMat = new THREE.MeshStandardMaterial({ color: "#f59e0b", emissive: "#b45309", emissiveIntensity: 0.6 });
    const badMat = new THREE.MeshStandardMaterial({ color: "#e11d48", emissive: "#9f1239", emissiveIntensity: 0.6 });
    const road = (a: THREE.Vector3, b: THREE.Vector3, mat: THREE.Material, w = 0.08) => {
      const len = a.distanceTo(b);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, len), mat);
      m.position.copy(a).lerp(b, 0.5).setY(0.03);
      m.lookAt(b.x, 0.03, b.z);
      ctx.root.add(m);
      return m;
    };
    for (const e of edges) {
      road(P(e.a), P(e.b), roadMat);
      const w = label(String(e.w), { size: 0.32, color: "#cbd5e1", bg: "#0f172acc" });
      w.position.copy(P(e.a).lerp(P(e.b), 0.5)).setY(0.3);
      ctx.root.add(w);
    }
    names.forEach((nm, i) => {
      const end = i === from || i === to;
      const c = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.26, end ? 0.6 : 0.35, 20),
        new THREE.MeshStandardMaterial({ color: end ? "#38bdf8" : "#94a3b8", emissive: end ? "#0369a1" : "#000", emissiveIntensity: 0.5 }),
      );
      c.position.copy(P(i)).setY(end ? 0.3 : 0.18);
      ctx.root.add(c);
      const l = label(nm, { size: 0.36, color: end ? "#e0f2fe" : "#e2e8f0" });
      l.position.copy(P(i)).setY(end ? 0.95 : 0.7);
      ctx.root.add(l);
    });
    const hops = path.slice(1).map((b, k) => {
      const a = path[k]!;
      const ok = edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
      const m = road(P(a), P(b), ok ? hotMat : badMat, 0.16);
      m.position.y = 0.06;
      m.visible = false;
      return m;
    });
    const car = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 20, 14),
      new THREE.MeshStandardMaterial({ color: "#fde68a", emissive: "#f59e0b", emissiveIntensity: 0.8 }),
    );
    car.visible = path.length > 0;
    ctx.root.add(car);
    const tweens = new Tweens();
    return {
      setStep(k, animate) {
        tweens.finishAll();
        hops.forEach((h, j) => (h.visible = j < k));
        const here = path[Math.min(k, path.length - 1)];
        if (here === undefined) return;
        if (animate && k >= 1) {
          const a = P(path[k - 1]!).setY(0.3);
          const b = P(here).setY(0.3);
          tweens.add(0.5, (t) => car.position.lerpVectors(a, b, t));
        } else car.position.copy(P(here)).setY(0.3);
      },
      tick: (dt) => tweens.tick(dt),
    };
  },
};

// ------------------------------------------------------------------ knights & knaves

const knights: StageDef = {
  create(ctx, data, replay) {
    const names = (data as { names: string[] }).names;
    const rp = replay as { got: (boolean | null)[]; truth: boolean[] } | undefined;
    const n = names.length;
    const R = 1.2 + n * 0.25;
    placeCamera(ctx, [0, R * 1.5, R * 2.1], [0, 0.6, 0]);
    base(ctx, R * 2 + 1.6, R * 2 + 1.6, "#111827");
    const people = names.map((nm, i) => {
      const a = (i / n) * Math.PI * 2;
      const g = new THREE.Group();
      g.position.set(Math.sin(a) * R, 0, Math.cos(a) * R);
      const bodyMat = new THREE.MeshStandardMaterial({ color: "#64748b", roughness: 0.6 });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.5, 6, 16), bodyMat);
      body.position.y = 0.55;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), new THREE.MeshStandardMaterial({ color: "#e2e8f0" }));
      head.position.y = 1.15;
      const ringMat = new THREE.MeshStandardMaterial({ color: "#1e293b", emissive: "#000" });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 10, 32), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.04;
      const l = label(nm, { size: 0.34 });
      l.position.y = 1.65;
      g.add(body, head, ring, l);
      ctx.root.add(g);
      return { g, bodyMat, ringMat };
    });
    const tweens = new Tweens();
    const paint = (i: number, on: boolean) => {
      const p = people[i]!;
      const g = rp?.got[i];
      const ok = on && g === rp?.truth[i];
      p.bodyMat.color.set(!on || g === null || g === undefined ? "#64748b" : g ? "#eab308" : "#7c3aed");
      p.ringMat.color.set(!on ? "#1e293b" : ok ? "#10b981" : "#e11d48");
      p.ringMat.emissive.set(!on ? "#000" : ok ? "#065f46" : "#881337");
    };
    return {
      setStep(k, animate) {
        tweens.finishAll();
        people.forEach((_, i) => paint(i, i < k));
        const p = people[k - 1];
        if (animate && p) tweens.add(0.35, (t) => (p.g.position.y = Math.sin(t * Math.PI) * 0.4));
      },
      tick: (dt) => tweens.tick(dt),
    };
  },
};

export const STAGES: Record<string, StageDef> = { cube, maze, sliding, jugs, sudoku, arc, routes, knights };
export type { Stage };
