import { ANSWER_RULE, extractAnswer } from "./answer";
import { Rng } from "./rng";
import { withExpert, type Challenge, type Difficulty } from "./types";

const CITIES = [
  "Avalon",
  "Brava",
  "Cedar",
  "Dune",
  "Ember",
  "Fjord",
  "Garnet",
  "Harbor",
  "Iris",
  "Juniper",
  "Kestrel",
  "Lumen",
  "Marrow",
  "Nectar",
  "Onyx",
  "Pike",
  "Quarry",
  "Rook",
];
const SIZE: Record<Difficulty, number> = withExpert({ easy: 6, medium: 10, hard: 16 });

interface Edge {
  a: number;
  b: number;
  w: number;
}
interface Data {
  names: string[];
  pos: [number, number][];
  edges: Edge[];
  from: number;
  to: number;
}

export function dijkstra(n: number, edges: Edge[], from: number): number[] {
  const dist = Array(n).fill(Infinity);
  const done = Array(n).fill(false);
  dist[from] = 0;
  for (let k = 0; k < n; k++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity) break;
    done[u] = true;
    for (const e of edges) {
      const v = e.a === u ? e.b : e.b === u ? e.a : -1;
      if (v >= 0 && dist[u] + e.w < dist[v]) dist[v] = dist[u] + e.w;
    }
  }
  return dist;
}

export function generateMap(seed: number, n: number): Data {
  const rng = new Rng(seed);
  const names = rng.shuffle(CITIES).slice(0, n);
  const pos = names.map(() => [rng.int(8, 92), rng.int(8, 92)] as [number, number]);
  const d = (i: number, j: number) => Math.hypot(pos[i]![0] - pos[j]![0], pos[i]![1] - pos[j]![1]);
  const edges: Edge[] = [];
  const has = (a: number, b: number) => edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  // spanning tree to the nearest connected city, then extra short-ish links
  for (let i = 1; i < n; i++) {
    const j = [...Array(i).keys()].sort((x, y) => d(i, x) - d(i, y))[0]!;
    edges.push({
      a: i,
      b: j,
      w: Math.max(1, Math.round(d(i, j) / 4) + rng.int(0, 6)),
    });
  }
  for (let k = 0; k < Math.round(n * 0.9); k++) {
    const a = rng.int(0, n - 1);
    const near = [...Array(n).keys()]
      .filter((b) => b !== a && !has(a, b))
      .sort((x, y) => d(a, x) - d(a, y))
      .slice(0, 3);
    if (!near.length) continue;
    const b = rng.pick(near);
    edges.push({
      a,
      b,
      w: Math.max(1, Math.round(d(a, b) / 4) + rng.int(0, 12)),
    });
  }
  // farthest pair by edge count, so the answer needs several hops
  let best = { from: 0, to: 1, hops: 0 };
  for (let s = 0; s < n; s++) {
    const hops = dijkstra(
      n,
      edges.map((e) => ({ ...e, w: 1 })),
      s,
    );
    hops.forEach((h, t) => h > best.hops && (best = { from: s, to: t, hops: h }));
  }
  // a tempting but expensive direct road
  if (!has(best.from, best.to))
    edges.push({
      a: best.from,
      b: best.to,
      w: dijkstra(n, edges, best.from)[best.to]! + rng.int(3, 9),
    });
  return {
    names,
    pos,
    edges: rng.shuffle(edges),
    from: best.from,
    to: best.to,
  };
}

export const routes: Challenge<Data> = {
  id: "routes",
  icon: "🛣️",
  category: "planning",
  title: { en: "Cheapest route", id: "Rute termurah" },
  blurb: {
    en: "Find the lowest-cost path between two cities on a weighted road map.",
    id: "Cari rute biaya terendah antar dua kota di peta jalan berbobot.",
  },
  skill: {
    en: "graph search · careful addition",
    id: "pencarian graf · penjumlahan teliti",
  },
  generate(seed, difficulty) {
    const data = generateMap(seed, SIZE[difficulty]);
    const { names, edges, from, to } = data;
    const optimal = dijkstra(names.length, edges, from)[to]!;
    const prompt = [
      `Road map (two-way roads, cost per road):`,
      ...edges.map((e) => `- ${names[e.a]} — ${names[e.b]}: ${e.w}`),
      "",
      `Find the CHEAPEST route from ${names[from]} to ${names[to]}. The cost of a route is the sum of its road costs.`,
      `Answer with the city names in order separated by " -> ", e.g. <answer>${names[from]} -> … -> ${names[to]}</answer>.`,
      ANSWER_RULE,
    ].join("\n");
    return {
      prompt,
      data,
      check(output) {
        const raw = extractAnswer(output).replace(/\(.*?\)|=.*$|cost.*$/gim, "");
        const parts = raw
          .split(/->|→|—>|=>|,|\n/)
          .map((p) => p.trim().toLowerCase())
          .filter(Boolean);
        const path = parts.map((p) => names.findIndex((nm) => nm.toLowerCase() === p));
        if (!path.length || path.includes(-1))
          return {
            score: 0,
            solved: false,
            note: "route contains unknown city names",
          };
        if (path[0] !== from || path.at(-1) !== to)
          return {
            score: 0,
            solved: false,
            note: `route must go from ${names[from]} to ${names[to]}`,
            replay: path,
          };
        let cost = 0;
        for (let i = 1; i < path.length; i++) {
          const e = edges.find((x) => (x.a === path[i - 1] && x.b === path[i]) || (x.b === path[i - 1] && x.a === path[i]));
          if (!e)
            return {
              score: 0,
              solved: false,
              note: `no road ${names[path[i - 1]!]} — ${names[path[i]!]}`,
              replay: path,
            };
          cost += e.w;
        }
        if (cost === optimal)
          return {
            score: 100,
            solved: true,
            note: `optimal route, cost ${cost}`,
            replay: path,
          };
        return {
          score: Math.round((60 * optimal) / cost),
          solved: false,
          note: `valid route, cost ${cost} (cheapest ${optimal})`,
          replay: path,
        };
      },
    };
  },
  View({ data, replay }) {
    const path = (replay as number[] | undefined) ?? [];
    const onPath = (a: number, b: number) =>
      path.some((p, i) => i > 0 && ((path[i - 1] === a && p === b) || (path[i - 1] === b && p === a)));
    return (
      <svg viewBox="0 0 100 100" className="h-72 w-full max-w-md rounded-md bg-slate-950">
        {data.edges.map((e, i) => {
          const [x1, y1] = data.pos[e.a]!;
          const [x2, y2] = data.pos[e.b]!;
          const hot = onPath(e.a, e.b);
          return (
            <g key={i}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={hot ? "#f59e0b" : "#334155"} strokeWidth={hot ? 0.9 : 0.4} />
              <text x={(x1 + x2) / 2} y={(y1 + y2) / 2} fontSize={2.6} fill={hot ? "#fcd34d" : "#64748b"} textAnchor="middle">
                {e.w}
              </text>
            </g>
          );
        })}
        {data.names.map((nm, i) => {
          const [x, y] = data.pos[i]!;
          const end = i === data.from || i === data.to;
          return (
            <g key={nm}>
              <circle cx={x} cy={y} r={1.6} fill={end ? "#38bdf8" : "#94a3b8"} />
              <text x={x} y={y - 2.4} fontSize={3} fill={end ? "#e0f2fe" : "#cbd5e1"} textAnchor="middle">
                {nm}
              </text>
            </g>
          );
        })}
      </svg>
    );
  },
};
