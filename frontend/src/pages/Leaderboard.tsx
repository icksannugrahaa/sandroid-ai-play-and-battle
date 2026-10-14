import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { getChallengeBoard, type ChallengeBoardParams } from "../api/client";
import { CHALLENGES, challengeById, type Difficulty } from "../challenges";
import { useLocal } from "../components/challenge";
import { EmptyState, ErrorNote, errorKey, PageHeader, Segmented, SkeletonRows } from "../components/ui";
import { useLang, useT } from "../i18n";
import { date, ms, num, pct, usd } from "../lib/format";
import type { ChallengeBoardCell, ChallengeBoardRow } from "../types";

const LEVELS: Difficulty[] = ["easy", "medium", "hard", "expert"];
const MEDALS = ["🥇", "🥈", "🥉"];

/**
 * Challenge leaderboard: every row is a model's record on ONE challenge at ONE level, so all
 * models in a table took the same kind of test. Free prompts are not ranked — their difficulty
 * varies too much to compare.
 */
const PODIUM = [
  { ring: "border-amber-500/50 from-amber-500/15", glow: "shadow-[0_0_40px_-12px_var(--color-amber-400)]", lift: "md:-translate-y-3", text: "text-amber-300" },
  { ring: "border-slate-400/40 from-slate-400/10", glow: "", lift: "", text: "text-slate-200" },
  { ring: "border-orange-700/50 from-orange-700/10", glow: "", lift: "", text: "text-orange-300" },
];

/** Top three as cards — 1st in the middle, raised. */
function Podium({ rows }: { rows: ChallengeBoardRow[] }) {
  const t = useT();
  const top = rows.slice(0, 3);
  if (top.length < 2) return null;
  const order = top.length === 3 ? [1, 0, 2] : [0, 1];
  return (
    <div className={`grid items-end gap-3 ${top.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
      {order.map((idx, pos) => {
        const r = top[idx]!;
        const look = PODIUM[idx]!;
        return (
          <div
            key={r.key}
            className={`card card-hover relative animate-fade-up overflow-hidden bg-gradient-to-b to-transparent text-center ${look.ring} ${look.glow} ${look.lift}`}
            style={{ animationDelay: `${pos * 90}ms` }}
          >
            <div className="text-3xl">{MEDALS[idx]}</div>
            <div className="mt-1 truncate font-semibold text-slate-100" title={r.display_name}>
              {r.display_name}
            </div>
            <div className="truncate text-[11px] text-slate-500">{r.family}</div>
            <div className={`mt-3 font-mono text-3xl font-semibold tabular-nums ${look.text}`}>{num(r.avg_score, 1)}</div>
            <div className="text-[11px] tracking-wider text-slate-500 uppercase">{t("board.col.score")}</div>
            <div className="mt-3 flex justify-center gap-4 text-xs text-slate-400">
              <span>
                <span className="font-mono text-slate-200">{pct(r.solve_rate)}</span> {t("board.col.solved").toLowerCase()}
              </span>
              <span>
                <span className="font-mono text-slate-200">{r.runs}</span> {t("leaderboard.col.runs").toLowerCase()}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Score bar that grows in when it mounts or the value changes. */
function ScoreBar({ value }: { value: number }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setW(Math.max(0, Math.min(100, value))));
    return () => cancelAnimationFrame(id);
  }, [value]);
  return (
    <span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-800">
      <span
        className="block h-full rounded-full bg-gradient-to-r from-sky-600 to-sky-400 transition-[width] duration-700 ease-[var(--ease-out-soft)]"
        style={{ width: `${w}%` }}
      />
    </span>
  );
}

export default function Leaderboard() {
  const t = useT();
  const local = useLocal();
  const lang = useLang((s) => s.lang);
  const [params, setParams] = useState<ChallengeBoardParams>({
    challenge: "maze",
    difficulty: "hard",
    grouping: "exact",
    period: "all",
    min_runs: 3,
    hide_insufficient: false,
  });
  const set = (patch: Partial<ChallengeBoardParams>) => setParams((p) => ({ ...p, ...patch }));

  const query = useQuery({
    queryKey: ["challenge-board", params],
    queryFn: () => getChallengeBoard(params),
    placeholderData: (prev) => prev,
  });
  const rows = query.data?.rows ?? [];
  const cells = useMemo(() => query.data?.cells ?? [], [query.data]);
  const runsOf = (id: string, level?: string) =>
    cells.filter((c) => c.challenge_id === id && (!level || c.difficulty === level)).reduce((n, c) => n + c.runs, 0);

  // first visit: open the board that has the most data instead of an empty one
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || !query.data) return;
    jumped.current = true;
    if (runsOf(params.challenge, params.difficulty) > 0 || cells.length === 0) return;
    const best = cells.reduce<ChallengeBoardCell | null>((a, c) => (!a || c.runs > a.runs ? c : a), null);
    if (best) set({ challenge: best.challenge_id, difficulty: best.difficulty });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per data load; `set`/`runsOf` are stable enough
  }, [query.data]);

  const challenge = challengeById(params.challenge);
  const levels = LEVELS.filter((d) => d !== "expert" || challenge?.supports?.expert);
  const showMoves = rows.some((r) => r.avg_moves_solved !== null);
  const pick = (id: string) => {
    const supportsExpert = !!challengeById(id)?.supports?.expert;
    set({ challenge: id, difficulty: params.difficulty === "expert" && !supportsExpert ? "hard" : params.difficulty });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        icon="trophy"
        title={t("leaderboard.title")}
        subtitle={t("board.subtitle")}
        actions={
          <Segmented
            value={params.grouping}
            onChange={(grouping) => set({ grouping })}
            options={[
              { value: "exact", label: t("leaderboard.exact") },
              { value: "family", label: t("leaderboard.family") },
            ]}
          />
        }
      />

      <section className="card space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {CHALLENGES.map((c) => {
            const n = runsOf(c.id);
            const active = c.id === params.challenge;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => pick(c.id)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition duration-150 active:scale-95 ${
                  active
                    ? "border-sky-500 bg-sky-500/15 text-white shadow-[0_0_16px_-6px_var(--color-sky-400)]"
                    : n
                      ? "border-slate-700 bg-slate-900/60 text-slate-300 hover:-translate-y-px hover:border-slate-500"
                      : "border-slate-800 text-slate-500 hover:-translate-y-px hover:border-slate-600"
                }`}
              >
                <span>{c.icon}</span>
                {local(c.title)}
                {n > 0 && <span className={`rounded-full px-1.5 font-mono text-[10px] ${active ? "bg-sky-500/25 text-sky-100" : "bg-slate-800 text-slate-400"}`}>{n}</span>}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <Segmented
            value={params.difficulty as Difficulty}
            onChange={(difficulty) => set({ difficulty })}
            options={levels.map((d) => {
              const n = runsOf(params.challenge, d);
              return { value: d, label: `${t(`challenge.${d}`)}${n ? ` · ${n}` : ""}` };
            })}
          />
          <label className="text-xs">
            <span className="label">{t("leaderboard.period")}</span>
            <select
              className="input py-1.5"
              value={params.period}
              onChange={(e) => set({ period: e.target.value as ChallengeBoardParams["period"] })}
            >
              <option value="7d">{t("leaderboard.p7d")}</option>
              <option value="30d">{t("leaderboard.p30d")}</option>
              <option value="all">{t("leaderboard.pall")}</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="label">{t("leaderboard.minRuns")}</span>
            <input
              className="input w-24 py-1.5"
              type="number"
              min={0}
              value={params.min_runs}
              onChange={(e) => set({ min_runs: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
          <label className="flex items-center gap-1.5 pb-2 text-xs text-slate-400">
            <input
              type="checkbox"
              className="accent-sky-500"
              checked={params.hide_insufficient}
              onChange={(e) => set({ hide_insufficient: e.target.checked })}
            />
            {t("leaderboard.hideInsufficient")}
          </label>
        </div>
        <p className="text-[11px] text-slate-500">{t("board.ranking")}</p>
      </section>

      <Podium key={`${params.challenge}-${params.difficulty}-${params.grouping}`} rows={rows} />

      <section className="card overflow-x-auto p-0">
        {challenge && (
          <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3 text-sm">
            <span className="text-lg leading-none">{challenge.icon}</span>
            <span className="font-medium text-slate-100">{local(challenge.title)}</span>
            <span className="badge bg-slate-800/70 text-slate-300">{t(`challenge.${params.difficulty}`)}</span>
            <span className="text-xs text-slate-500">{local(challenge.skill)}</span>
          </div>
        )}
        <table className="w-full">
          <thead className="border-b border-slate-800">
            <tr>
              <th className="th">#</th>
              <th className="th">{t("leaderboard.col.model")}</th>
              <th className="th">{t("board.col.score")}</th>
              <th className="th">{t("board.col.solved")}</th>
              <th className="th">{t("board.col.best")}</th>
              <th className="th">{t("leaderboard.col.runs")}</th>
              {showMoves && <th className="th">{t("board.col.moves")}</th>}
              <th className="th">{t("board.col.time")}</th>
              <th className="th">{t("board.col.tokens")}</th>
              <th className="th">{t("leaderboard.col.cost")}</th>
              <th className="th">{t("board.col.timeouts")}</th>
              <th className="th">{t("leaderboard.col.last")}</th>
            </tr>
          </thead>
          <tbody className={`stagger transition-opacity ${query.isFetching ? "opacity-60" : ""}`}>
            {rows.map((r, i) => (
              <tr key={r.key} className="row" style={{ "--i": i } as React.CSSProperties}>
                <td className="td text-slate-400">{MEDALS[r.rank - 1] ?? r.rank}</td>
                <td className="td">
                  <div className="font-medium">{r.display_name}</div>
                  <div className="flex gap-1.5 text-[11px] text-slate-500">
                    {params.grouping === "family" ? t("leaderboard.variants", { n: r.variants }) : r.family}
                    {r.insufficient_data && <span className="badge bg-amber-950 text-amber-300">{t("leaderboard.insufficient")}</span>}
                  </div>
                </td>
                <td className="td">
                  <div className="flex items-center gap-2">
                    <span className="w-10 font-mono text-slate-100">{num(r.avg_score, 1)}</span>
                    <ScoreBar value={r.avg_score} />
                  </div>
                </td>
                <td className="td font-mono">{pct(r.solve_rate)}</td>
                <td className="td font-mono">{r.best_score}</td>
                <td className="td font-mono">{r.runs}</td>
                {showMoves && <td className="td font-mono">{r.avg_moves_solved === null ? "–" : num(r.avg_moves_solved, 1)}</td>}
                <td className="td font-mono">{ms(r.avg_time_ms)}</td>
                <td className="td font-mono">{num(r.avg_tokens, 0)}</td>
                <td className="td font-mono">{usd(r.avg_cost_usd)}</td>
                <td className="td font-mono">{r.timeouts || "–"}</td>
                <td className="td font-mono">{date(r.last_tested, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!query.isLoading && rows.length === 0 && <EmptyState icon="trophy" title={t("board.empty")} />}
        {query.isLoading && <SkeletonRows cols={6} />}
      </section>
      {query.error && <ErrorNote code={errorKey(query.error)} />}
    </div>
  );
}
