import { useEffect, useRef, useState } from "react";

import { CacheSetting } from "../components/cache";
import { ModelBoards, VerdictBadge } from "../components/boards";
import { ChallengeBar, ChallengeGallery, ChallengeHeader, PuzzleCard, Scoreboard } from "../components/challenge";
import { HAS_3D } from "../challenges/three/playback";
import { AdvancedSettings, Composer } from "../components/composer";
import { StorageMeter } from "../components/game";
import { UserBubble } from "../components/rich";
import { ModelPicker, OutputView, ResultsTable, SlotTimer, StatusBadge } from "../components/run";
import { ErrorNote, RunOptions, Segmented } from "../components/ui";
import { UsageMini, UsageSummary } from "../components/usage";
import { useT } from "../i18n";
import { useCredentials } from "../stores/credentials";
import { useDraft } from "../stores/draft";
import { ScopeContext } from "../stores/gameStorage";
import { buildExport, downloadJson } from "../stores/history";
import { useArena, type SlotProgress } from "../stores/runs";
import type { ChallengeRef, Verdict } from "../challenges";
import type { HistoryEntry, SlotResult } from "../types";

function RoundView({
  index,
  text,
  results,
  entry,
  requestError,
  collapsible,
  challenge,
  verdicts,
  progress,
}: {
  index: number;
  text: string | null;
  results: SlotResult[];
  entry?: HistoryEntry | null;
  requestError?: string | null;
  collapsible: boolean;
  challenge?: ChallengeRef | null;
  verdicts?: (Verdict | null)[];
  progress?: SlotProgress[] | null;
}) {
  const t = useT();
  // challenge rounds lead with the scores; raw answers stay folded
  const startOpen = !collapsible && !(challenge && verdicts);
  const [open, setOpen] = useState(startOpen);
  useEffect(() => setOpen(startOpen), [startOpen]);
  return (
    <section className="space-y-3">
      {challenge ? (
        <ChallengeHeader challenge={challenge} index={index} />
      ) : (
        <div className="flex items-center gap-3">
          <span className="badge bg-slate-800 text-slate-300">{t("arena.round", { n: index + 1 })}</span>
          <div className="h-px flex-1 bg-slate-800" />
        </div>
      )}
      {challenge && <PuzzleCard challenge={challenge} overview={!HAS_3D.has(challenge.id) || challenge.id === "arc"} />}
      {challenge && <ModelBoards challenge={challenge} slots={results} verdicts={verdicts} progress={progress} />}
      {text && <UserBubble text={text} />}
      <ResultsTable
        slots={results}
        extra={
          challenge
            ? {
                header: t("challenge.result"),
                cell: (i) => (
                  <VerdictBadge
                    challenge={challenge}
                    slot={results[i]!}
                    stored={verdicts ? (verdicts[i] ?? null) : undefined}
                    progress={progress?.[i] ?? null}
                  />
                ),
              }
            : undefined
        }
        actions={
          <>
            {(collapsible || (challenge && verdicts)) && (
              <button type="button" className="btn-secondary py-1 text-xs" onClick={() => setOpen((v) => !v)}>
                {challenge
                  ? open
                    ? t("challenge.hideAnswers")
                    : t("challenge.showAnswers")
                  : open
                    ? t("arena.hideAnswers")
                    : t("arena.showAnswers")}
              </button>
            )}
            {entry && (
              <button
                type="button"
                className="btn-secondary py-1 text-xs"
                onClick={() => downloadJson(`arena-${entry.id}.json`, buildExport([entry]))}
              >
                {t("common.export")}
              </button>
            )}
          </>
        }
      />
      {requestError && <ErrorNote code={requestError} />}
      {open && (
        <div className="grid gap-3 md:grid-cols-2">
          {results.map((x, i) => (
            <section key={i} className="card min-w-0 space-y-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="truncate text-sm font-medium" title={x.model}>
                  {x.model}
                </h3>
                <div className="flex shrink-0 items-center gap-2">
                  <SlotTimer slot={x} />
                  {challenge ? (
                    <VerdictBadge
                      challenge={challenge}
                      slot={x}
                      stored={verdicts ? (verdicts[i] ?? null) : undefined}
                      progress={progress?.[i] ?? null}
                    />
                  ) : (
                    x.metrics && <StatusBadge status={x.metrics.status} />
                  )}
                </div>
              </div>
              <OutputView result={x} maxHeight="max-h-[28rem]" />
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

export default function Arena() {
  const t = useT();
  // All state lives in the store, so a battle keeps going while you visit other pages.
  const s = useArena();
  const endpoints = useCredentials((st) => st.endpoints);
  const firstId = endpoints[0]?.id ?? "";
  const { picks, strategy, mode, system, prompt, drafts, params, timeoutS, running, error, slots, rounds, setForm, kind } = s;
  const busy = running || s.checking || !!s.queue;
  const locked = rounds.length > 0 || busy; // a battle in progress keeps its lineup
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Keep picks pointing at live endpoints. Only when there IS an endpoint to point to —
  // with none, re-setting picks every render looped forever (React error #185).
  useEffect(() => {
    if (!firstId) return;
    const valid = (id: string) => endpoints.some((e) => e.id === id);
    if (picks.some((p) => !valid(p.endpointId))) {
      setForm({
        picks: picks.map((p) => (valid(p.endpointId) ? p : { ...p, endpointId: firstId })),
      });
    }
  }, [endpoints, firstId, picks, setForm]);

  const take = useDraft((st) => st.take);
  const load = s.load;
  useEffect(() => {
    const d = take("arena");
    if (d) load(d, firstId);
  }, [take, load, firstId]);

  // Follow the battle as it streams — unless you scrolled up to read.
  const bottom = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  useEffect(() => {
    const onScroll = () => {
      nearBottom.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 320;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const streamed = slots.reduce((n, x) => n + x.output.length, 0);
  useEffect(() => {
    if (nearBottom.current) bottom.current?.scrollIntoView({ block: "end" });
  }, [streamed, rounds.length, s.pendingText]);

  const ready = picks.filter((p) => p.model.trim() && endpoints.some((e) => e.id === p.endpointId));
  const lineupReady = ready.length >= 2 && ready.length === picks.length;
  const canRun = lineupReady && (!!prompt.trim() || drafts.length > 0) && !busy;
  const update = s.updatePick;
  const setPicks = (next: typeof picks) => setForm({ picks: next });
  const modeLabel = t(strategy === "parallel" ? "arena.parallel" : "arena.sequential");
  const customized = !!system.trim() || Object.values(params).some((v) => v !== undefined);
  const lastRoundError = rounds.at(-1)?.requestError;

  return (
    <ScopeContext.Provider value="arena">
      <div className="flex min-h-[calc(100vh-9rem)] flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{t("arena.title")}</h1>
          <Segmented
            value={kind}
            onChange={(v) => setForm({ kind: v })}
            options={[
              { value: "free", label: t("arena.kindFree") },
              { value: "challenge", label: t("arena.kindChallenge") },
            ]}
          />
          {rounds.length > 0 && <span className="text-xs text-slate-500">{t("arena.roundsSoFar", { n: rounds.length })}</span>}
          <span className="flex-1" />
          {rounds.length > 0 && !busy && (
            <button type="button" className="btn-secondary py-1 text-xs" onClick={s.newBattle}>
              ⟲ {t("arena.newBattle")}
            </button>
          )}
        </div>

        {/* Lineup */}
        <section className="card space-y-3">
          {locked ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-400">{t("arena.lineup")}:</span>
              {picks.map((p, i) => (
                <span key={i} className="badge bg-slate-800 font-mono text-slate-200">
                  {i + 1}. {p.model}
                </span>
              ))}
              <span className="text-slate-500">· {t("arena.lineupLocked")}</span>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {picks.map((p, i) => (
                <div key={i} className="rounded-lg border border-slate-800 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-400">{t("arena.slot", { n: i + 1 })}</span>
                    {picks.length > 2 && (
                      <button
                        type="button"
                        className="text-xs text-slate-500 hover:text-rose-300"
                        onClick={() => setPicks(picks.filter((_, j) => j !== i))}
                      >
                        {t("common.remove")}
                      </button>
                    )}
                  </div>
                  <ModelPicker
                    compact
                    need={mode === "image_gen" ? "image_gen" : "chat"}
                    endpointId={p.endpointId}
                    onEndpoint={(id) => update(i, { endpointId: id })}
                    model={p.model}
                    onModel={(m) => update(i, { model: m })}
                  />
                </div>
              ))}
              {picks.length < 4 && (
                <button
                  type="button"
                  className="rounded-lg border border-dashed border-slate-700 p-3 text-sm text-slate-400 hover:border-slate-500 hover:text-slate-200"
                  onClick={() => setPicks([...picks, { endpointId: firstId, model: "" }])}
                >
                  + {t("arena.addSlot")}
                </button>
              )}
            </div>
          )}
          {ready.length < 2 && !locked && <p className="text-xs text-slate-500">{t("arena.needTwo")}</p>}
        </section>

        <Scoreboard rounds={rounds} models={picks.map((p) => p.model)} />

        {/* Rounds */}
        <div className="flex-1 space-y-8">
          {rounds.length === 0 && !running && kind === "free" && (
            <div className="flex min-h-[20vh] flex-col items-center justify-center gap-2 text-center">
              <p className="text-lg text-slate-300">{t("arena.emptyTitle")}</p>
              <p className="max-w-xl text-sm text-slate-500">{t("arena.emptyHint")}</p>
            </div>
          )}
          {rounds.length === 0 && !running && kind === "challenge" && (
            <div className="space-y-3">
              <div>
                <p className="text-lg text-slate-300">{t("challenge.emptyTitle")}</p>
                <p className="max-w-3xl text-sm text-slate-500">{t("challenge.emptyHint")}</p>
              </div>
              <ChallengeGallery value={s.challengeId} onPick={(id) => setForm({ challengeId: id })} />
            </div>
          )}
          {[
            ...rounds.map((r, i) => (
              <RoundView
                key={r.id}
                index={i}
                text={r.text}
                results={r.results}
                entry={r.entry}
                requestError={r.requestError}
                collapsible={i < rounds.length - 1 || busy}
                challenge={r.challenge}
                verdicts={r.verdicts}
              />
            )),
            // same list + the id the round will get → its boards stay mounted (animations keep playing) when it lands
            // (between until-solved turns `running` is briefly false — the round is still in progress)
            (running || s.checking || !!s.pendingChallenge) && (
              <RoundView
                key={s.pendingRoundId ?? "pending"}
                index={rounds.length}
                text={s.pendingText}
                results={slots}
                collapsible={false}
                challenge={s.pendingChallenge}
                progress={s.pendingProgress}
              />
            ),
          ]}
          {!running && error && error !== lastRoundError && <ErrorNote code={error} />}
          <div ref={bottom} />
        </div>

        {/* Composer + settings, pinned to the bottom like a chat */}
        <div className="sticky bottom-0 z-20 -mx-4 border-t border-slate-800 bg-slate-950/95 px-4 pt-3 pb-4 backdrop-blur">
          {kind === "challenge" ? (
            <ChallengeBar
              challengeId={s.challengeId}
              difficulty={s.difficulty}
              onDifficulty={(difficulty) => setForm({ difficulty })}
              maxMoves={s.maxMoves}
              onMaxMoves={(maxMoves) => setForm({ maxMoves })}
              untilSolved={s.untilSolved}
              onUntilSolved={(untilSolved) => setForm({ untilSolved })}
              maxTurns={s.maxTurns}
              onMaxTurns={(maxTurns) => setForm({ maxTurns })}
              stateFormat={s.stateFormat}
              onStateFormat={(stateFormat) => setForm({ stateFormat })}
              timeoutS={s.challengeTimeoutS}
              onTimeoutS={(challengeTimeoutS) => setForm({ challengeTimeoutS })}
              distanceHint={s.distanceHint}
              onDistanceHint={(distanceHint) => setForm({ distanceHint })}
              onPick={(challengeId) => setForm({ challengeId })}
              busy={busy}
              canRun={lineupReady && !busy}
              models={picks.length}
              onRun={(refs) => void s.runChallenges(refs)}
              onStop={s.stop}
              queue={s.queue}
              checking={s.checking}
            />
          ) : (
            <>
              {rounds.length > 0 && !running && <p className="mb-2 text-[11px] text-sky-300/80">↪ {t("arena.followUpHint")}</p>}
              <Composer
                text={prompt}
                onText={(v) => setForm({ prompt: v })}
                drafts={drafts}
                onDrafts={(v) => setForm({ drafts: v })}
                mode={mode}
                onMode={(v) => setForm({ mode: v })}
                running={running}
                canSend={!!canRun}
                onSend={() => canRun && void s.run()}
                onStop={s.stop}
                sendLabel={t("arena.runLabel", {
                  mode: modeLabel,
                  n: picks.length,
                })}
              />
            </>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Segmented
              value={strategy}
              onChange={(v) => setForm({ strategy: v })}
              options={[
                { value: "parallel", label: t("arena.parallel") },
                { value: "sequential", label: t("arena.sequential") },
              ]}
            />
            <span className="hidden text-[11px] text-slate-500 lg:inline">
              {t(strategy === "parallel" ? "arena.parallelHint" : "arena.sequentialHint")}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              aria-expanded={settingsOpen}
              className={`btn-secondary py-1.5 text-xs ${settingsOpen ? "border-sky-700 text-sky-300" : ""}`}
              onClick={() => setSettingsOpen((v) => !v)}
            >
              ⚙ {t("playground.settings")}
              {customized && <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />}
            </button>
            <UsageMini usage={s.usage} />
          </div>
          {settingsOpen && (
            <div className="mt-3 max-h-[45vh] space-y-3 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <AdvancedSettings
                defaultOpen
                mode={mode}
                system={system}
                onSystem={(v) => setForm({ system: v })}
                params={params}
                onParams={(v) => setForm({ params: v })}
                timeoutS={timeoutS}
                onTimeout={(v) => setForm({ timeoutS: v })}
              />
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <RunOptions />
                <StorageMeter scope="arena" onClear={s.clearCache} disabled={running} />
                <CacheSetting />
              </div>
              <UsageSummary usage={s.usage} onReset={s.resetUsage} />
              <p className="text-[11px] text-slate-500">{t("notice.billing")}</p>
            </div>
          )}
        </div>
      </div>
    </ScopeContext.Provider>
  );
}
