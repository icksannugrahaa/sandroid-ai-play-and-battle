/**
 * Challenge mode UI: gallery, control bar, puzzle + per-model replay, verdicts, scoreboard.
 * Puzzles are rebuilt from {id, seed, difficulty}; only verdicts are stored per round.
 */
import { useEffect, useState } from "react";

import { CHALLENGES, challengeById, levelFor, puzzleFor, type ChallengeRef, type Difficulty } from "../challenges";
import { randomSeed } from "../challenges/rng";
import { useLang, useT } from "../i18n";
import { ms, usd } from "../lib/format";
import type { ArenaRound } from "../stores/runs";
import { Segmented } from "./ui";

const LEVELS: Difficulty[] = ["easy", "medium", "hard", "expert"];

/** re-render every second while `on` (countdowns) */
function useTicker(on: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [on]);
  return now;
}

export function useLocal() {
  const lang = useLang((s) => s.lang);
  return (v: { en: string; id: string }) => v[lang];
}

export function ChallengeGallery({ value, onPick, compact }: { value: string; onPick: (id: string) => void; compact?: boolean }) {
  const local = useLocal();
  return (
    <div className={`stagger grid gap-2 ${compact ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" : "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"}`}>
      {CHALLENGES.map((c, i) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onPick(c.id)}
          style={{ "--i": i } as React.CSSProperties}
          className={`group rounded-xl border p-3 text-left transition duration-200 hover:-translate-y-0.5 active:scale-[0.98] ${
            value === c.id
              ? "border-sky-500 bg-sky-500/10 shadow-[0_0_24px_-10px_var(--color-sky-400)]"
              : "border-slate-800 bg-slate-900/40 hover:border-slate-600 hover:bg-slate-900/70"
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-lg leading-none transition-transform duration-200 group-hover:scale-125">{c.icon}</span>
            <span className="text-sm font-medium text-slate-100">{local(c.title)}</span>
          </div>
          {!compact && <p className="mt-1.5 text-xs text-slate-400">{local(c.blurb)}</p>}
          <p className="mt-1 text-[11px] text-slate-500">{local(c.skill)}</p>
        </button>
      ))}
    </div>
  );
}

/** Bottom bar in challenge mode: which puzzle, how hard, start one / run them all. */
export function ChallengeBar({
  challengeId,
  difficulty,
  onDifficulty,
  maxMoves,
  onMaxMoves,
  untilSolved,
  onUntilSolved,
  maxTurns,
  onMaxTurns,
  stateFormat,
  onStateFormat,
  timeoutS,
  onTimeoutS,
  distanceHint,
  onDistanceHint,
  onPick,
  busy,
  canRun,
  models,
  onRun,
  onStop,
  queue,
  checking,
}: {
  challengeId: string;
  difficulty: Difficulty;
  onDifficulty: (d: Difficulty) => void;
  /** 0 = unlimited */
  maxMoves: number;
  onMaxMoves: (n: number) => void;
  untilSolved: boolean;
  onUntilSolved: (v: boolean) => void;
  /** 0 = unlimited */
  maxTurns: number;
  onMaxTurns: (n: number) => void;
  stateFormat: "pieces" | "net";
  onStateFormat: (f: "pieces" | "net") => void;
  timeoutS: number;
  onTimeoutS: (s: number) => void;
  distanceHint: boolean;
  onDistanceHint: (v: boolean) => void;
  onPick: (id: string) => void;
  busy: boolean;
  canRun: boolean;
  models: number;
  onRun: (refs: ChallengeRef[]) => void;
  onStop: () => void;
  queue: { done: number; total: number; waitUntil?: number } | null;
  checking: boolean;
}) {
  const now = useTicker(!!queue?.waitUntil);
  const t = useT();
  const local = useLocal();
  const [gallery, setGallery] = useState(false);
  const [seedText, setSeedText] = useState("");
  const c = challengeById(challengeId) ?? CHALLENGES[0]!;
  const heavy = c.heavy?.[levelFor(c.id, difficulty)];
  // the move cap only goes to challenges that understand it
  const cap = (id: string) => {
    const s = challengeById(id)?.supports;
    return {
      ...(maxMoves > 0 && s?.maxMoves ? { maxMoves } : {}),
      ...(untilSolved && s?.untilSolved ? { untilSolved: true, ...(maxTurns > 0 ? { maxTurns } : {}) } : {}),
      ...(s?.stateFormat ? { stateFormat } : {}),
      ...(s?.distanceHint ? { distanceHint } : {}),
      timeLimitS: timeoutS,
    };
  };
  const seed = () => (seedText.trim() && /^\d+$/.test(seedText.trim()) ? Number(seedText.trim()) : randomSeed());

  const runAll = () => {
    const ok = window.confirm(
      t("challenge.confirmAll", {
        n: CHALLENGES.length,
        m: models,
        r: CHALLENGES.length * models,
      }),
    );
    if (ok) onRun(CHALLENGES.map((x) => ({ id: x.id, seed: randomSeed(), difficulty: levelFor(x.id, difficulty), ...cap(x.id) })));
  };

  return (
    <div className="space-y-2">
      {gallery && (
        <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <ChallengeGallery
            compact
            value={challengeId}
            onPick={(id) => {
              onPick(id);
              setGallery(false);
            }}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary py-1.5 text-sm" onClick={() => setGallery((v) => !v)} aria-expanded={gallery}>
          <span>{c.icon}</span> {local(c.title)} <span className="text-slate-500">▾</span>
        </button>
        <Segmented
          value={levelFor(c.id, difficulty)}
          onChange={onDifficulty}
          options={LEVELS.filter((d) => d !== "expert" || c.supports?.expert).map((d) => ({
            value: d,
            label: t(`challenge.${d}`),
          }))}
        />
        <label className="flex items-center gap-1.5 text-xs text-slate-400" title={t("challenge.timeLimitHint")}>
          {t("challenge.timeLimit")}
          <select
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
            value={timeoutS}
            onChange={(e) => onTimeoutS(Number(e.target.value))}
          >
            {[60, 120, 300, 600, 900, 1200, 1500, 1800, 2700, 3600].map((s) => (
              <option key={s} value={s}>
                {s / 60} {t("challenge.minutes")}
              </option>
            ))}
          </select>
        </label>
        {c.supports?.stateFormat && (
          <label className="flex items-center gap-1.5 text-xs text-slate-400" title={t("challenge.formatHint")}>
            {t("challenge.format")}
            <select
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
              value={stateFormat}
              onChange={(e) => onStateFormat(e.target.value as "pieces" | "net")}
            >
              <option value="pieces">{t("challenge.formatPieces")}</option>
              <option value="net">{t("challenge.formatNet")}</option>
            </select>
          </label>
        )}
        {c.supports?.distanceHint && (
          <label className="flex items-center gap-1.5 text-xs text-slate-300" title={t("challenge.distanceHintHint")}>
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-sky-500"
              checked={distanceHint}
              onChange={(e) => onDistanceHint(e.target.checked)}
            />
            💡 {t("challenge.distanceHint")}
          </label>
        )}
        {c.supports?.untilSolved && (
          <label className="flex items-center gap-1.5 text-xs text-slate-300" title={t("challenge.untilSolvedHint")}>
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-sky-500"
              checked={untilSolved}
              onChange={(e) => onUntilSolved(e.target.checked)}
            />
            🔁 {t("challenge.untilSolved")}
          </label>
        )}
        {c.supports?.untilSolved && untilSolved && (
          <label className="flex items-center gap-1.5 text-xs text-slate-400" title={t("challenge.maxTurnsHint")}>
            {t("challenge.maxTurns")}
            <select
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
              value={maxTurns}
              onChange={(e) => onMaxTurns(Number(e.target.value))}
            >
              {[0, 3, 5, 10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "∞" : n}
                </option>
              ))}
            </select>
          </label>
        )}
        {c.supports?.maxMoves && (
          <label className="flex items-center gap-1.5 text-xs text-slate-400" title={t("challenge.maxMovesHint")}>
            {t("challenge.maxMoves")}
            <select
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
              value={maxMoves}
              onChange={(e) => onMaxMoves(Number(e.target.value))}
            >
              {[0, 20, 50, 100, 200].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "∞" : n}
                </option>
              ))}
            </select>
          </label>
        )}
        <input
          className="input w-28 py-1.5 font-mono text-xs"
          inputMode="numeric"
          placeholder={t("challenge.seedRandom")}
          title={t("challenge.seedHint")}
          value={seedText}
          onChange={(e) => setSeedText(e.target.value.replace(/[^\d]/g, "").slice(0, 9))}
        />
        <span className="flex-1" />
        {busy ? (
          <>
            <span className="text-xs text-slate-400">
              {queue?.waitUntil
                ? t("challenge.rateWait", { s: Math.max(0, Math.ceil((queue.waitUntil - now) / 1000)) })
                : checking
                  ? t("challenge.checking")
                  : t("challenge.thinking")}
              {queue && queue.total > 1 && ` · ${queue.done}/${queue.total}`}
            </span>
            <button type="button" className="btn-secondary py-1.5 text-sm hover:text-rose-300" onClick={onStop}>
              ■ {t("common.stop")}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn-secondary py-1.5 text-sm" disabled={!canRun} onClick={runAll}>
              {t("challenge.runAll", { n: CHALLENGES.length })}
            </button>
            <button
              type="button"
              className="btn-primary py-1.5 text-sm"
              disabled={!canRun}
              onClick={() => onRun([{ id: c.id, seed: seed(), difficulty: levelFor(c.id, difficulty), ...cap(c.id) }])}
            >
              ▶ {t("challenge.start")}
            </button>
          </>
        )}
      </div>
      {heavy && <p className="text-[11px] text-amber-300/90">⚠ {local(heavy)}</p>}
    </div>
  );
}

export function ChallengeHeader({ challenge, index }: { challenge: ChallengeRef; index: number }) {
  const t = useT();
  const local = useLocal();
  const c = challengeById(challenge.id);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="badge bg-slate-800 text-slate-300">{t("arena.round", { n: index + 1 })}</span>
      <span className="text-sm font-medium">
        {c?.icon} {c ? local(c.title) : challenge.id}
      </span>
      <span className="badge bg-slate-800/70 text-slate-400">{t(`challenge.${challenge.difficulty}`)}</span>
      {challenge.untilSolved ? (
        <span className="badge bg-sky-950/60 text-sky-300">
          🔁 {t("challenge.untilSolved")}
          {challenge.maxTurns ? ` · ${t("challenge.maxTurnsBadge", { n: challenge.maxTurns })}` : ""}
        </span>
      ) : null}
      {challenge.distanceHint ? <span className="badge bg-amber-950/50 text-amber-300">💡 {t("challenge.distanceHint")}</span> : null}
      {challenge.stateFormat ? (
        <span className="badge bg-slate-800/70 text-slate-400">
          {challenge.stateFormat === "net" ? t("challenge.formatNet") : t("challenge.formatPieces")}
        </span>
      ) : null}
      {challenge.maxMoves ? (
        <span className="badge bg-slate-800/70 text-slate-400">{t("challenge.maxBadge", { n: challenge.maxMoves })}</span>
      ) : null}
      <span className="font-mono text-[11px] text-slate-500" title={t("challenge.seedHint")}>
        seed {challenge.seed}
      </span>
      <div className="h-px flex-1 bg-slate-800" />
    </div>
  );
}

/** The shared puzzle: overview (e.g. ARC examples, text questions) + the exact prompt every model got. */
export function PuzzleCard({ challenge, overview = true }: { challenge: ChallengeRef; overview?: boolean }) {
  const t = useT();
  const [showView, setShowView] = useState(overview);
  const [showPrompt, setShowPrompt] = useState(false);
  const c = challengeById(challenge.id);
  const puzzle = puzzleFor(challenge);
  if (!c || !puzzle) return null;
  const View = c.View;
  return (
    <section className="card space-y-2 py-2.5">
      {showView && View && (
        <div className="overflow-x-auto">
          <View data={puzzle.data} />
        </div>
      )}
      <div className="flex flex-wrap gap-4">
        {!overview && View && (
          <button type="button" className="text-[11px] text-slate-500 hover:text-slate-300" onClick={() => setShowView((v) => !v)}>
            {showView ? "▾" : "▸"} {t("challenge.puzzle")} (2D)
          </button>
        )}
        <button type="button" className="text-[11px] text-slate-500 hover:text-slate-300" onClick={() => setShowPrompt((v) => !v)}>
          {showPrompt ? "▾" : "▸"} {t("challenge.prompt", { n: puzzle.prompt.length.toLocaleString() })}
        </button>
      </div>
      {showPrompt && (
        <pre className="max-h-72 overflow-auto rounded-md bg-slate-950 p-3 text-[11px] leading-relaxed whitespace-pre-wrap text-slate-300">
          {puzzle.prompt}
        </pre>
      )}
    </section>
  );
}

/** Totals over every challenge round of this battle. */
export function Scoreboard({ rounds, models }: { rounds: ArenaRound[]; models: string[] }) {
  const t = useT();
  const played = rounds.filter((r) => r.challenge && r.verdicts);
  if (!played.length) return null;
  const rows = models
    .map((model, i) => {
      const vs = played.map((r) => r.verdicts![i] ?? null);
      const total = vs.reduce((n, v) => n + (v?.score ?? 0), 0);
      const time = played.reduce((n, r) => n + (r.results[i]?.metrics?.total_ms ?? 0), 0);
      const costs = played.map((r) => r.results[i]?.metrics?.cost_usd).filter((c): c is number => typeof c === "number");
      return {
        i,
        model,
        avg: Math.round(total / played.length),
        solved: vs.filter((v) => v?.solved).length,
        time,
        cost: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
        scores: vs,
      };
    })
    .sort((a, b) => b.avg - a.avg || b.solved - a.solved || a.time - b.time);
  const medal = ["🥇", "🥈", "🥉", ""];
  return (
    <section className="card space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">🏆 {t("challenge.scoreboard")}</h2>
        <span className="text-xs text-slate-500">{t("challenge.played", { n: played.length })}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="py-1 pr-3 font-medium">{t("challenge.model")}</th>
              <th className="py-1 pr-3 text-right font-medium">{t("challenge.avgScore")}</th>
              <th className="py-1 pr-3 text-right font-medium">{t("challenge.solvedCol")}</th>
              <th className="py-1 pr-3 text-right font-medium">{t("challenge.time")}</th>
              <th className="py-1 pr-3 text-right font-medium">{t("challenge.cost")}</th>
              <th className="py-1 font-medium">{t("challenge.perRound")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, k) => (
              <tr key={r.i} className="border-t border-slate-800/80">
                <td className="max-w-[16rem] truncate py-1.5 pr-3" title={r.model}>
                  {medal[k] ?? ""} {r.model}
                </td>
                <td className="py-1.5 pr-3 text-right font-mono font-semibold">{r.avg}</td>
                <td className="py-1.5 pr-3 text-right font-mono">
                  {r.solved}/{played.length}
                </td>
                <td className="py-1.5 pr-3 text-right font-mono text-xs text-slate-400">{ms(r.time)}</td>
                <td className="py-1.5 pr-3 text-right font-mono text-xs text-slate-400">{r.cost === null ? "–" : usd(r.cost)}</td>
                <td className="py-1.5">
                  <div className="flex flex-wrap gap-1">
                    {r.scores.map((v, j) => {
                      const c = challengeById(played[j]!.challenge!.id);
                      return (
                        <span
                          key={j}
                          title={`${c?.id ?? ""} · ${v?.note ?? "no answer"}`}
                          className={`rounded px-1 font-mono text-[10px] ${!v ? "bg-slate-800 text-slate-500" : v.solved ? "bg-emerald-950 text-emerald-300" : v.score > 0 ? "bg-amber-950 text-amber-300" : "bg-rose-950 text-rose-300"}`}
                        >
                          {c?.icon}
                          {v?.score ?? "–"}
                        </span>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
