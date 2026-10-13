/**
 * One board per model: its own copy of the puzzle (3D where it makes sense), the model's
 * live thinking while it works, then a step-by-step replay of its answer on that board.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

import { challengeById, puzzleFor, verdictFor, type ChallengeRef, type Verdict } from "../challenges";
import { attemptCount, liveAttempt, restatesStart, startStep, stepBack, type LiveAttempt } from "../challenges/live";
import { HAS_3D, PLAYBACK, stepsFor } from "../challenges/three/playback";
import { useT } from "../i18n";
import type { SlotProgress } from "../stores/runs";
import type { SlotResult } from "../types";
import { SlotError, SlotTimer, TruncatedNote } from "./run";

const NO_MOVES: string[] = [];
const Board3D = lazy(() => import("../challenges/three/Board3D"));

export function ModelBoards({
  challenge,
  slots,
  verdicts,
  progress,
}: {
  challenge: ChallengeRef;
  slots: SlotResult[];
  verdicts?: (Verdict | null)[];
  /** until-solved play in progress */
  progress?: SlotProgress[] | null;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {slots.map((slot, i) => (
        <ModelBoard
          key={i}
          challenge={challenge}
          slot={slot}
          stored={verdicts ? (verdicts[i] ?? null) : undefined}
          progress={progress?.[i] ?? null}
        />
      ))}
    </div>
  );
}

/** Stored verdict for finished rounds; computed as soon as this model is done for live ones. */
function useVerdict(
  challenge: ChallengeRef,
  slot: SlotResult,
  stored: Verdict | null | undefined,
  progress?: SlotProgress | null,
): Verdict | null | "checking" {
  const [live, setLive] = useState<Verdict | null>(null);
  // until-solved: one turn's answer alone isn't the result — the round's verdict comes at the end
  const done = !progress && !slot.running && !!slot.output.trim();
  useEffect(() => {
    if (stored !== undefined || !done) return;
    let alive = true;
    void verdictFor(challenge, slot.output).then((v) => alive && setLive(v));
    return () => {
      alive = false;
    };
  }, [challenge, slot.output, done, stored]);
  if (stored !== undefined) return stored;
  if (!done) return null;
  return live ?? "checking";
}

/**
 * The latest move sequence the model is trying in its streamed thinking/answer (re-read at most
 * ~3×/s), numbered so the card can say "attempt #4". Null once the answer is checked.
 */
function useLiveAttempt(
  id: string,
  data: unknown,
  slot: SlotResult,
  done: boolean,
  prefix: string[],
): (LiveAttempt & { n: number }) | null {
  const [attempt, setAttempt] = useState<(LiveAttempt & { n: number }) | null>(null);
  const text = (slot.reasoning ?? "") + "\n" + slot.output;
  const latest = useRef(text);
  latest.current = text;
  const prefixRef = useRef(prefix);
  prefixRef.current = prefix;
  const active = slot.running && !done && !!data && !!PLAYBACK[id];
  useEffect(() => {
    if (!active) return;
    let lastKey = "";
    let n = 0;
    const scan = () => {
      const a = liveAttempt(id, data, latest.current, prefixRef.current);
      if (a && a.key !== lastKey) {
        lastKey = a.key;
        n += 1;
        setAttempt({ ...a, n });
      }
    };
    scan();
    const timer = setInterval(scan, 350);
    return () => clearInterval(timer);
    // a new turn (new request) starts its own attempt count
  }, [active, id, data, slot.startedAt]);
  useEffect(() => setAttempt(null), [slot.startedAt]);
  useEffect(() => {
    if (done) setAttempt(null);
  }, [done]);
  return active ? attempt : null;
}

/** "✓ 100" / "✗ 0" — the challenge result (as opposed to the request status). */
export function VerdictBadge({
  challenge,
  slot,
  stored,
  progress,
}: {
  challenge: ChallengeRef;
  slot: SlotResult;
  stored: Verdict | null | undefined;
  progress?: SlotProgress | null;
}) {
  const t = useT();
  const v = useVerdict(challenge, slot, stored, progress);
  if (progress && stored === undefined)
    return (
      <span
        className={`badge font-mono ${progress.status === "solved" ? "bg-emerald-950 text-emerald-300" : "bg-slate-800 text-slate-300"}`}
      >
        {progress.status === "solved" ? "✓ " : ""}
        {t("board.turnMoves", { turn: progress.turns || 1, n: progress.moves.length })}
      </span>
    );
  if (v === "checking") return <span className="badge bg-slate-800 text-slate-300">🔎 {t("challenge.checking")}</span>;
  if (!v) return <span className="text-xs text-slate-500">{slot.running ? "…" : "–"}</span>;
  return (
    <span
      className={`badge font-mono ${v.solved ? "bg-emerald-950 text-emerald-300" : v.score > 0 ? "bg-amber-950 text-amber-300" : "bg-rose-950 text-rose-300"}`}
    >
      {v.solved ? "✓" : "✗"} {v.score} · {v.solved ? t("challenge.solved") : t("challenge.failed")}
      {v.flags && v.flags.length > 0 ? <span title={v.flags.join("\n")}> · ⚠ {t("board.fabricatedShort")}</span> : null}
    </span>
  );
}

function tail(text: string, n: number) {
  return text.length > n ? `…${text.slice(-n)}` : text;
}

function ModelBoard({
  challenge,
  slot,
  stored,
  progress,
}: {
  challenge: ChallengeRef;
  slot: SlotResult;
  stored: Verdict | null | undefined;
  progress: SlotProgress | null;
}) {
  const t = useT();
  const c = challengeById(challenge.id);
  const puzzle = puzzleFor(challenge);
  const result = useVerdict(challenge, slot, stored, progress);
  const prefix = progress?.moves ?? NO_MOVES;
  const verdict = result === "checking" ? null : result;
  const steps = puzzle ? stepsFor(challenge.id, puzzle.data, verdict) : 0;
  const pb = PLAYBACK[challenge.id];
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const started = useRef(false);

  // a fresh answer plays itself once; finished rounds open on the final position
  useEffect(() => {
    if (!verdict || started.current) return;
    started.current = true;
    if (stored === undefined) {
      setStep(0);
      setPlaying(steps > 0);
    } else setStep(steps);
  }, [verdict, steps, stored]);

  useEffect(() => {
    if (!playing) return;
    if (step >= steps) {
      setPlaying(false);
      return;
    }
    const base = pb?.pace ?? 450;
    const pace = Math.max(40, Math.min(base, (base * 24) / Math.max(24, steps)) / speed);
    const id = setTimeout(() => setStep((k) => k + 1), pace);
    return () => clearTimeout(id);
  }, [playing, step, steps, speed, pb]);

  // While the model is still working: act out the move sequence it is currently trying.
  // The attempt on screen and its step live in ONE state, and a new attempt only takes over once
  // the current one has played out and been held a moment — otherwise the cube snaps between
  // states (a new attempt rendered at the old step, or resets every few hundred ms).
  const latestAttempt = useLiveAttempt(challenge.id, puzzle?.data, slot, !!verdict, prefix);
  const [shownAttempt, setShownAttempt] = useState<{ a: LiveAttempt & { n: number }; step: number; doneAt: number | null } | null>(null);
  const attempt = latestAttempt ? (shownAttempt?.a ?? null) : null;
  const attemptSteps = attempt && puzzle && pb ? pb.steps(puzzle.data, attempt.replay) : 0;
  const attemptStep = shownAttempt?.step ?? 0;
  useEffect(() => {
    if (!latestAttempt) {
      setShownAttempt(null);
      return;
    }
    const cur = shownAttempt;
    if (cur && cur.a.key === latestAttempt.key) return;
    // the model re-tracing the start of the route on screen is not a new attempt — keep the longer one
    if (cur && restatesStart(cur.a.replay, latestAttempt.replay)) return;
    // never go backwards: a finished route stays until another one also reaches G
    if (cur && stepBack(cur.a, latestAttempt)) return;
    // continue from where the new attempt departs from the one on screen, not from the start
    const adopt = () =>
      setShownAttempt({ a: latestAttempt, step: startStep(cur?.a.replay, latestAttempt.replay, prefix.length), doneAt: null });
    if (!cur) return adopt();
    if (cur.doneAt === null) return; // still playing: the newer attempt waits its turn
    const wait = cur.doneAt + 1200 - Date.now();
    if (wait <= 0) return adopt();
    const id = setTimeout(adopt, wait);
    return () => clearTimeout(id);
  }, [latestAttempt, shownAttempt, prefix.length]);
  useEffect(() => {
    if (!shownAttempt || shownAttempt.doneAt !== null) return;
    if (shownAttempt.step >= attemptSteps) {
      setShownAttempt((s) => (s ? { ...s, doneAt: Date.now() } : s));
      return;
    }
    const pace = Math.max(60, Math.min((pb?.pace ?? 450) * 0.6, 6000 / Math.max(1, attemptSteps)));
    const id = setTimeout(() => setShownAttempt((s) => (s ? { ...s, step: s.step + 1 } : s)), pace);
    return () => clearTimeout(id);
  }, [shownAttempt, attemptSteps, pb]);
  // until-solved, between attempts: show the state after the moves made so far
  const sofar = useMemo(() => (prefix.length ? { moves: prefix } : undefined), [prefix]);
  const trying = !verdict && !!attempt;

  // what the model explored while thinking vs. what it finally answered (they differ a lot)
  const thoughtAttempts = useMemo(
    () => (verdict && !slot.running ? attemptCount(challenge.id, slot.reasoning ?? "") : 0),
    [verdict, slot.running, slot.reasoning, challenge.id],
  );

  const caption = useMemo(
    () => (verdict && step > 0 && pb?.caption ? pb.caption(puzzle?.data, verdict.replay, step) : ""),
    [verdict, step, pb, puzzle],
  );
  if (!c || !puzzle) return null;
  const View = c.View;
  const thinking = slot.running && !slot.output;
  const turnInfo = progress
    ? `${t("board.turnMoves", { turn: Math.max(1, progress.turns + (slot.running ? 1 : 0)), n: prefix.length })} · `
    : "";
  const status =
    progress && !slot.running && progress.status !== "playing" && stored === undefined
      ? `${progress.status === "solved" ? "✓" : "■"} ${t(`board.stop.${progress.status}`)} · ${t("board.turnMoves", { turn: progress.turns, n: prefix.length })}`
      : progress && !slot.running && !slot.error && stored === undefined
        ? `⏳ ${turnInfo}${t("board.nextTurn")}`
        : turnInfo + statusText();
  function statusText() {
    return slot.error
      ? `⚠ ${t(`errors.${slot.error}`)}`
      : slot.running
        ? thinking
          ? `💭 ${t("board.thinking")}${slot.reasoning ? ` · ${slot.reasoning.length.toLocaleString()}` : ""}`
          : `✍️ ${t("board.writing")}`
        : result === "checking"
          ? `🔎 ${t("challenge.checking")}`
          : !verdict
            ? slot.metrics || slot.output
              ? t("challenge.noAnswer")
              : stored !== undefined || slot.reasoning || slot.startedAt
                ? `■ ${t("board.stoppedEarly")}` // the round ended (Stop / time limit) before it answered
                : `⏳ ${t("board.waiting")}`
            : verdict.solved
              ? `✓ ${t("challenge.solved")}`
              : `✗ ${t("challenge.failed")}`;
  }
  const tone = verdict
    ? verdict.solved
      ? "text-emerald-300"
      : verdict.score >= 50
        ? "text-amber-300"
        : "text-rose-300"
    : "text-slate-400";
  const live = slot.running ? (slot.output ? tail(slot.output, 360) : tail(slot.reasoning ?? "", 360)) : "";

  return (
    <section className={`card min-w-0 space-y-2 p-3 ${verdict?.solved ? "border-emerald-800/60" : ""}`}>
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium" title={slot.model}>
          {slot.model}
        </h3>
        <SlotTimer slot={slot} />
        <span className={`font-mono text-lg leading-none font-semibold ${tone}`}>{verdict ? verdict.score : ""}</span>
      </div>
      <div className={`text-xs ${tone} ${slot.running ? "animate-pulse" : ""}`}>{status}</div>
      {slot.error && <SlotError slot={slot} />}
      <TruncatedNote slot={slot} />

      {HAS_3D.has(challenge.id) ? (
        <Suspense fallback={<div className="h-60 animate-pulse rounded-md bg-slate-900" />}>
          <Board3D
            id={challenge.id}
            data={puzzle.data}
            replay={trying ? attempt.replay : (verdict?.replay ?? sofar)}
            step={trying ? attemptStep : verdict ? step : prefix.length}
            spin={slot.running && !attempt && challenge.id === "cube"}
          />
        </Suspense>
      ) : (
        View && (
          <div className="max-h-60 overflow-auto rounded-md bg-slate-950/60 p-2">
            <View data={puzzle.data} replay={verdict?.replay} />
          </div>
        )
      )}

      {live && (
        <pre
          className={`max-h-24 overflow-hidden rounded-md px-2 py-1.5 text-[11px] leading-relaxed whitespace-pre-wrap ${thinking ? "bg-violet-950/30 text-violet-100/70" : "bg-slate-950 text-slate-300"}`}
        >
          {live}
        </pre>
      )}

      {trying && (
        <div className="truncate font-mono text-[11px] text-violet-300/90" title={attempt.label}>
          💭 {t("board.attempt", { n: attempt.n })}: {attempt.label}
        </div>
      )}
      {steps > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary px-2 py-0.5 text-xs"
              onClick={() => (setStep(0), setPlaying(false))}
              title={t("board.restart")}
            >
              ⏮
            </button>
            <button
              type="button"
              className="btn-secondary px-2 py-0.5 text-xs"
              onClick={() => {
                if (step >= steps) setStep(0);
                setPlaying((p) => !p);
              }}
            >
              {playing ? "⏸" : "▶"}
            </button>
            <input
              type="range"
              min={0}
              max={steps}
              value={step}
              onChange={(e) => (setPlaying(false), setStep(Number(e.target.value)))}
              className="min-w-0 flex-1 accent-sky-500"
              aria-label={t("board.step")}
            />
            <span className="w-16 text-right font-mono text-[11px] text-slate-400">
              {step}/{steps}
            </span>
            <button
              type="button"
              className="w-9 rounded text-[11px] text-slate-400 hover:text-slate-200"
              onClick={() => setSpeed((s) => (s >= 4 ? 1 : s * 2))}
            >
              {speed}×
            </button>
          </div>
          {caption && <div className="truncate font-mono text-[11px] text-sky-300/90">{caption}</div>}
        </div>
      )}

      {verdict?.flags && verdict.flags.length > 0 && (
        <div
          className="rounded-md border border-amber-800/60 bg-amber-950/30 px-2 py-1.5 text-[11px] text-amber-200"
          title={t("board.fabricatedHint")}
        >
          ⚠ {t("board.fabricated")}
          <ul className="mt-0.5 list-disc pl-4 text-amber-200/80">
            {verdict.flags.map((f, k) => (
              <li key={k}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      {verdict && thoughtAttempts > 0 && (
        <p className="text-[11px] text-violet-300/80" title={t("board.attemptsHint")}>
          💭 {t("board.attemptsThenFinal", { n: thoughtAttempts, m: verdict.moves ?? "?" })}
        </p>
      )}
      {verdict && (
        <p className="text-[11px] break-words text-slate-400">
          {verdict.moves !== undefined && (
            <span className="mr-1.5 font-mono text-slate-200">🔁 {t("board.moves", { n: verdict.moves })} ·</span>
          )}
          {verdict.note}
        </p>
      )}
      {verdict?.details && verdict.details.length > 0 && (
        <ul className="space-y-0.5 text-[11px]">
          {verdict.details.slice(0, PLAYBACK[challenge.id] ? verdict.details.length : step).map((d, k) => (
            <li key={k} className={d.ok ? "text-emerald-300/90" : "text-rose-300/90"}>
              {d.ok ? "✓" : "✗"} {d.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
