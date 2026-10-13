import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { getChallengeBoard, type ChallengeBoardParams } from "../api/client";
import { CHALLENGES, challengeById, type Difficulty } from "../challenges";
import { useLocal } from "../components/challenge";
import { ErrorNote, errorKey, PageHeader, Segmented } from "../components/ui";
import { useLang, useT } from "../i18n";
import { date, ms, num, pct, usd } from "../lib/format";
import type { ChallengeBoardCell } from "../types";

const LEVELS: Difficulty[] = ["easy", "medium", "hard", "expert"];
const MEDALS = ["🥇", "🥈", "🥉"];

/**
 * Challenge leaderboard: every row is a model's record on ONE challenge at ONE level, so all
 * models in a table took the same kind of test. Free prompts are not ranked — their difficulty
 * varies too much to compare.
 */
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
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition ${
                  active
                    ? "border-sky-600 bg-sky-950/50 text-slate-100"
                    : n
                      ? "border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-500"
                      : "border-slate-800 text-slate-500 hover:border-slate-600"
                }`}
              >
                <span>{c.icon}</span>
                {local(c.title)}
                {n > 0 && <span className="font-mono text-[10px] text-slate-500">{n}</span>}
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
          <tbody className={query.isFetching ? "opacity-60" : ""}>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-slate-900 hover:bg-slate-900/50">
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
                    <span className="h-1.5 w-20 overflow-hidden rounded bg-slate-800">
                      <span className="block h-full bg-sky-500" style={{ width: `${Math.max(0, Math.min(100, r.avg_score))}%` }} />
                    </span>
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
        {!query.isLoading && rows.length === 0 && <p className="p-6 text-center text-sm text-slate-500">{t("board.empty")}</p>}
        {query.isLoading && <p className="p-6 text-center text-sm text-slate-500">{t("common.loading")}</p>}
      </section>
      {query.error && <ErrorNote code={errorKey(query.error)} />}
    </div>
  );
}
