/**
 * Playground & Arena session state — form inputs AND in-flight runs.
 *
 * Lives outside the page components so a run keeps streaming (and its output stays
 * visible) when you navigate to another page and back. Memory-only, like credentials:
 * nothing here is persisted; a refresh clears it. API keys are NOT stored here —
 * they are read from the credentials store at the moment a run starts.
 */
import { create, type StoreApi } from "zustand";

import { postChallengeResults, runArena, runPlayground } from "../api/client";
import { HttpError, type SseEvent } from "../api/sse";
import { CHALLENGE_SYSTEM, puzzleFor, verdictFor, type ChallengeRef, type Difficulty, type Verdict } from "../challenges";
import type { Puzzle } from "../challenges/types";
import { buildPrompt, chainImagePrompt, type Draft } from "../lib/attachments";
import { errorKey } from "../lib/errors";
import { effectiveSystem, stripRuntimeHint } from "../lib/runtimeHint";
import { uid } from "../lib/format";
import type {
  ArenaStrategy,
  ChallengeResultIn,
  ErrorCategory,
  GenerationParams,
  HistoryEntry,
  HistoryMessage,
  PromptConfig,
  RunMetrics,
  SlotResult,
} from "../types";
import { endpointLabel, useCredentials } from "./credentials";
import { gameBytes, SESSION_LIMIT_BYTES, useGameStorage } from "./gameStorage";
import { useHistory } from "./history";
import { usePrefs } from "./prefs";

/**
 * The challenge leaderboard compares models on the same test, so only standard settings count:
 * one answer per puzzle (no "until solved"), no move cap, the default cube format and hint.
 */
export function isStandardChallenge(ref: ChallengeRef): boolean {
  return !ref.untilSolved && !ref.maxMoves && (ref.stateFormat ?? "pieces") === "pieces" && ref.distanceHint !== false;
}

/** Fire-and-forget: post every scored slot (its run ticket proves the run was real). */
function contributeResults(ref: ChallengeRef, slots: SlotResult[], verdicts: (Verdict | null)[], timeoutS: number) {
  if (!usePrefs.getState().contribute || !isStandardChallenge(ref)) return;
  const results: ChallengeResultIn[] = slots.flatMap((slot, i) => {
    if (!slot.ticket) return [];
    const v = verdicts[i];
    // no answer at all (cut off, ran out of time) is a 0 — the server enforces it for timeouts
    return [
      {
        ticket: slot.ticket,
        challenge_id: ref.id,
        difficulty: ref.difficulty,
        seed: ref.seed,
        score: Math.max(0, Math.min(100, Math.round(v?.score ?? 0))),
        solved: !!v?.solved,
        moves: typeof v?.moves === "number" ? v.moves : null,
        time_limit_s: timeoutS,
      },
    ];
  });
  if (results.length) postChallengeResults(results).catch(() => undefined);
}

export function emptySlot(model = "", label = "", running = false): SlotResult {
  return { model, endpointLabel: label, output: "", images: [], metrics: null, error: null, running };
}

/** Pure reducer: apply one non-delta SSE event to a slot. */
function applyEvent(s: SlotResult, e: SseEvent): SlotResult {
  switch (e.event) {
    case "start":
      return { ...s, canonicalKey: String(e.data.canonical_key ?? ""), running: true, startedAt: Date.now(), firstTokenAt: undefined };
    case "reasoning":
      return { ...s, reasoning: (s.reasoning ?? "") + String(e.data.text ?? "") };
    case "image":
      return { ...s, images: [...s.images, String(e.data.url)] };
    case "audio":
      return { ...s, audio: [...(s.audio ?? []), String(e.data.url)] };
    case "error":
      return {
        ...s,
        error: e.data.category as ErrorCategory,
        errorStatus: typeof e.data.status === "number" ? e.data.status : null,
        errorAfterMs: typeof e.data.after_ms === "number" ? e.data.after_ms : undefined,
      };
    case "metrics":
      return { ...s, metrics: e.data as unknown as RunMetrics, running: false };
    case "ticket":
      return { ...s, ticket: String(e.data.ticket ?? "") || undefined };
    default:
      return s;
  }
}

interface RunState {
  usage: UsageTally;
  running: boolean;
  slots: SlotResult[];
  error: string | null;
  lastEntry: HistoryEntry | null;
}

/**
 * Feeds SSE events into `slots` of a store. Token deltas are buffered and flushed at
 * most every ~16 ms (setTimeout keeps working in background browser tabs, unlike rAF).
 */
function slotFeeder<S extends RunState>(set: StoreApi<S>["setState"]) {
  let pending = new Map<number, string>();
  let thinking = new Map<number, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    if (pending.size === 0 && thinking.size === 0) return;
    const batch = pending;
    const thought = thinking;
    pending = new Map();
    thinking = new Map();
    set(
      (st) =>
        ({
          slots: st.slots.map((s, i) =>
            batch.has(i) || thought.has(i)
              ? {
                  ...s,
                  output: s.output + (batch.get(i) ?? ""),
                  reasoning: thought.has(i) ? (s.reasoning ?? "") + thought.get(i) : s.reasoning,
                }
              : s,
          ),
        }) as Partial<S>,
    );
  };

  let firstSeen = new Set<number>();

  return {
    reset() {
      firstSeen = new Set();
    },
    handle(e: SseEvent) {
      const slot = typeof e.data.slot === "number" ? e.data.slot : 0;
      if ((e.event === "delta" || e.event === "image" || e.event === "audio") && !firstSeen.has(slot)) {
        // Mark first output immediately (not batched) so the live TTFT is accurate.
        firstSeen.add(slot);
        const at = Date.now();
        set((st) => ({ slots: st.slots.map((s, i) => (i === slot ? { ...s, firstTokenAt: at } : s)) }) as Partial<S>);
      }
      if (e.event === "delta") {
        pending.set(slot, (pending.get(slot) ?? "") + String(e.data.text ?? ""));
        timer ??= setTimeout(flush, 16);
        return;
      }
      if (e.event === "reasoning") {
        thinking.set(slot, (thinking.get(slot) ?? "") + String(e.data.text ?? ""));
        timer ??= setTimeout(flush, 16);
        return;
      }
      flush();
      set((st) => ({ slots: st.slots.map((s, i) => (i === slot ? applyEvent(s, e) : s)) }) as Partial<S>);
    },
    finish() {
      if (timer) clearTimeout(timer);
      flush();
      set((st) => ({ slots: st.slots.map((s) => ({ ...s, running: false })), running: false }) as Partial<S>);
    },
  };
}

/** Approximate in-memory size (characters ≈ bytes for text and base64 data URLs). */
export function slotsBytes(slots: SlotResult[]): number {
  let n = 0;
  for (const s of slots) {
    n += s.output.length + (s.reasoning?.length ?? 0);
    for (const x of s.images) n += x.length;
    for (const x of s.audio ?? []) n += x.length;
  }
  return n;
}

export function playgroundBytes(s: {
  slots: SlotResult[];
  conversation: HistoryMessage[];
  drafts: Draft[];
  turns?: { text: string; result: SlotResult }[];
}): number {
  const turns = s.turns ?? [];
  return (
    slotsBytes(s.slots) +
    slotsBytes(turns.map((x) => x.result)) +
    turns.reduce((n, x) => n + x.text.length, 0) +
    s.conversation.reduce((n, m) => n + m.content.length, 0) +
    draftsBytes(s.drafts)
  );
}

export function arenaBytes(s: { slots: SlotResult[]; drafts: Draft[]; rounds?: { text: string; results: SlotResult[] }[] }): number {
  const rounds = s.rounds ?? [];
  return slotsBytes(s.slots) + draftsBytes(s.drafts) + rounds.reduce((n, r) => n + r.text.length + slotsBytes(r.results), 0);
}

function overBudget(scope: "playground" | "arena", ownBytes: number): boolean {
  return ownBytes + gameBytes(useGameStorage.getState().data[scope]) >= SESSION_LIMIT_BYTES;
}

// ----------------------------------------------------------------------------- session usage
export type ComposerMode = "chat" | "image_gen";

export interface ModelUsage {
  model: string;
  runs: number;
  failed: number;
  promptTokens: number;
  completionTokens: number;
  /** sum of known costs; `pricedRuns` < runs means some runs had no price */
  cost: number;
  pricedRuns: number;
  approx: boolean;
  estimatedTokens: boolean;
}

export type UsageTally = Record<string, ModelUsage>;

/** Add finished slots to a session tally (memory-only, per workspace). */
export function tally(prev: UsageTally, slots: SlotResult[]): UsageTally {
  const next = { ...prev };
  for (const s of slots) {
    const m = s.metrics;
    if (!m) continue;
    const u = next[s.model] ?? {
      model: s.model,
      runs: 0,
      failed: 0,
      promptTokens: 0,
      completionTokens: 0,
      cost: 0,
      pricedRuns: 0,
      approx: false,
      estimatedTokens: false,
    };
    next[s.model] = {
      ...u,
      runs: u.runs + 1,
      failed: u.failed + (m.status === "success" ? 0 : 1),
      promptTokens: u.promptTokens + m.prompt_tokens,
      completionTokens: u.completionTokens + m.completion_tokens,
      cost: u.cost + (m.cost_usd ?? 0),
      pricedRuns: u.pricedRuns + (m.cost_usd !== null ? 1 : 0),
      approx: u.approx || m.price_exact === false,
      estimatedTokens: u.estimatedTokens || m.tokens_estimated,
    };
  }
  return next;
}

function draftsBytes(drafts: Draft[]): number {
  return drafts.reduce((n, d) => n + (d.dataUrl?.length ?? 0) + (d.text?.length ?? 0), 0);
}

/** History entries keep images/attachments as URLs — turn them back into composer drafts. */
function draftsFromConfig(c: PromptConfig): Draft[] {
  const id = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const size = (url: string) => Math.round(((url.split(",", 2)[1] ?? "").length * 3) / 4);
  return [
    ...(c.images ?? []).map((url, i) => ({
      id: id(),
      kind: "image" as const,
      name: `image-${i + 1}`,
      size: size(url),
      mime: url.slice(5, url.indexOf(";")),
      dataUrl: url,
    })),
    ...(c.attachments ?? []).map((a) => ({
      id: id(),
      kind: a.kind,
      name: a.name,
      size: size(a.data_url),
      mime: a.data_url.slice(5, a.data_url.indexOf(";")),
      dataUrl: a.data_url,
    })),
  ];
}

function historyText(config: PromptConfig): string {
  const names = [...(config.attachments ?? []).map((a) => a.name), ...(config.images ?? []).map((_, i) => `image-${i + 1}`)];
  return names.length ? `${config.prompt}\n\n[📎 ${names.join(", ")}]`.trim() : config.prompt;
}

function saveEntry(entry: HistoryEntry): void {
  if (usePrefs.getState().retention === "local") useHistory.getState().add(entry);
}

// ----------------------------------------------------------------------------- Playground
export interface PlaygroundForm {
  endpointId: string;
  model: string;
  mode: ComposerMode;
  system: string;
  prompt: string;
  drafts: Draft[];
  imageSize: string;
  params: GenerationParams;
  timeoutS: number;
}

/** One exchange in the chat view: what you sent + the model's full result (with metrics). */
export interface ChatTurn {
  id: string;
  text: string;
  result: SlotResult;
  /** request-level failure (e.g. rate limited, endpoint not allowed) */
  requestError?: string | null;
}

interface PlaygroundState extends PlaygroundForm, RunState {
  /** sent to the API as history (text only) */
  conversation: HistoryMessage[];
  /** what the chat view renders */
  turns: ChatTurn[];
  /** the message being answered right now */
  pendingText: string | null;
  controller: AbortController | null;
  setForm: (patch: Partial<PlaygroundForm>) => void;
  load: (entry: HistoryEntry) => void;
  newChat: () => void;
  clearCache: () => void;
  resetUsage: () => void;
  run: () => Promise<void>;
  stop: () => void;
  /** image requests of this chat (text → image keeps context by chaining them) */
  imageThread: string[];
}

export const usePlayground = create<PlaygroundState>()((set, get) => {
  const feeder = slotFeeder<PlaygroundState>(set);
  return {
    endpointId: "",
    model: "",
    mode: "chat",
    system: "",
    prompt: "",
    drafts: [],
    imageSize: "1024x1024",
    usage: {},
    params: {},
    timeoutS: 120,
    conversation: [],
    turns: [],
    imageThread: [],
    pendingText: null,
    running: false,
    slots: [],
    error: null,
    lastEntry: null,
    controller: null,

    setForm: (patch) => set(patch),
    load: (d) =>
      set({
        mode: d.config.modality === "image_gen" ? "image_gen" : "chat",
        system: stripRuntimeHint(d.config.system),
        prompt: d.config.prompt,
        drafts: draftsFromConfig(d.config),
        params: d.config.params ?? {},
        conversation: d.config.history ?? [],
        turns: [],
        model: d.results[0]?.model ?? get().model,
        slots: [],
        lastEntry: null,
      }),
    newChat: () => set({ conversation: [], turns: [], imageThread: [], slots: [], error: null, lastEntry: null }),
    clearCache: () => {
      if (get().running) return;
      set({ conversation: [], turns: [], imageThread: [], slots: [], error: null, lastEntry: null });
      useGameStorage.getState().clearScope("playground");
    },
    resetUsage: () => set({ usage: {} }),
    stop: () => get().controller?.abort(),

    run: async () => {
      const st = get();
      const endpoint = useCredentials.getState().endpoints.find((e) => e.id === st.endpointId);
      const model = st.model.trim();
      if (!endpoint || !model || (!st.prompt.trim() && st.drafts.length === 0) || st.running) return;
      if (overBudget("playground", playgroundBytes(st))) {
        set({ error: "errors.storage_full" });
        return;
      }
      const built = buildPrompt(st.prompt, st.drafts, st.mode);
      const config: PromptConfig = {
        ...built,
        system: effectiveSystem(st.system, usePrefs.getState().runtimeHint && st.mode === "chat"),
        history: st.mode === "image_gen" ? [] : st.conversation,
        image_size: st.mode === "image_gen" ? st.imageSize : undefined,
        params: st.params,
      };
      const userText = historyText(config); // what you typed — shown in the chat
      if (st.mode === "image_gen") config.prompt = chainImagePrompt(st.imageThread, built.prompt);
      const sentText = st.prompt;
      const sentDrafts = st.drafts;
      const controller = new AbortController();
      feeder.reset();
      const collected = emptySlot(model, endpointLabel(endpoint));
      set({
        running: true,
        error: null,
        lastEntry: null,
        controller,
        pendingText: userText,
        slots: [emptySlot(model, endpointLabel(endpoint), true)],
        // like any chat app: clear the composer as soon as the message is sent
        prompt: "",
        drafts: [],
      });

      const { contribute } = usePrefs.getState();
      try {
        await runPlayground(endpoint, model, config, { contribute, timeoutS: st.timeoutS, signal: controller.signal }, (e) => {
          const one = { ...e, data: { ...e.data, slot: 0 } };
          Object.assign(
            collected,
            e.event === "delta" ? { output: collected.output + String(e.data.text ?? "") } : applyEvent(collected, one),
          );
          feeder.handle(one);
        });
      } catch (err) {
        set({ error: errorKey(err) });
      } finally {
        feeder.finish();
        set({ controller: null });
      }

      // Request failed before anything came back → give the text back so it can be retried.
      const nothing = !collected.output && collected.images.length === 0;
      set((s) => (s.error && nothing && s.prompt === "" && s.drafts.length === 0 ? { prompt: sentText, drafts: sentDrafts } : {}));
      // Keep every exchange (also failed ones) in the chat view, with its own metrics.
      set((s) => ({
        turns: [
          ...s.turns,
          { id: uid(), text: s.pendingText ?? userText, result: { ...collected, running: false }, requestError: s.error },
        ],
        pendingText: null,
        imageThread: config.modality === "image_gen" && collected.images.length > 0 ? [...s.imageThread, built.prompt] : s.imageThread,
      }));
      if (collected.metrics) {
        set((s) => ({ usage: tally(s.usage, [collected]) }));
        const { running: _running, ...rest } = collected;
        const entry: HistoryEntry = {
          id: uid(),
          kind: "playground",
          createdAt: new Date().toISOString(),
          config,
          results: [{ ...rest, baseUrl: endpoint.baseUrl }],
        };
        set({ lastEntry: entry });
        saveEntry(entry);
      }
      if (collected.output && config.modality !== "image_gen") {
        set((s) => ({
          conversation: [...s.conversation, { role: "user", content: userText }, { role: "assistant", content: collected.output }],
        }));
      }
    },
  };
});

// ----------------------------------------------------------------------------- Arena
export interface ArenaPick {
  endpointId: string;
  model: string;
}

export interface ArenaForm {
  picks: ArenaPick[];
  strategy: ArenaStrategy;
  mode: ComposerMode;
  system: string;
  prompt: string;
  drafts: Draft[];
  params: GenerationParams;
  timeoutS: number;
  /** free prompt vs. auto-scored challenge puzzles */
  kind: "free" | "challenge";
  challengeId: string;
  difficulty: Difficulty;
  /** move cap for move-based challenges; 0 = unlimited */
  maxMoves: number;
  /** move-based challenges: keep giving each model the new state until it solves it */
  untilSolved: boolean;
  /** turn cap for until-solved play; 0 = unlimited */
  maxTurns: number;
  /** how the cube state is written in the prompt */
  stateFormat: "pieces" | "net";
  /** per-model time limit for challenge rounds (s); reasoning models can think for many minutes */
  challengeTimeoutS: number;
  /** cube: tell models how many turns the scramble had */
  distanceHint: boolean;
}

/** One round of a multi-turn battle: your message + every model's answer to it. */
export interface ArenaRound {
  id: string;
  text: string;
  strategy: ArenaStrategy;
  results: SlotResult[];
  entry: HistoryEntry | null;
  requestError?: string | null;
  /** set for challenge rounds: the puzzle is rebuilt from it (deterministic) */
  challenge?: ChallengeRef;
  /** automatic score per model (null = no answer to check) */
  verdicts?: (Verdict | null)[];
}

interface ArenaState extends ArenaForm, RunState {
  rounds: ArenaRound[];
  /** image requests of this battle (text → image keeps context by chaining them) */
  imageThread: string[];
  /** each model's own conversation (API history), indexed like `picks` */
  histories: HistoryMessage[][];
  /** the message being answered right now */
  pendingText: string | null;
  /** the challenge being answered right now */
  pendingChallenge: ChallengeRef | null;
  /** id the round in progress will get (keeps its per-model boards mounted when it lands) */
  pendingRoundId: string | null;
  /** until-solved play: each model's progress in the round in progress */
  pendingProgress: SlotProgress[] | null;
  pendingTurn: number;
  /** answers being scored */
  checking: boolean;
  /** "run several challenges" progress; `waitUntil` = paused by the server's rate limit */
  queue: { done: number; total: number; waitUntil?: number } | null;
  newBattle: () => void;
  controller: AbortController | null;
  setForm: (patch: Partial<ArenaForm>) => void;
  updatePick: (i: number, patch: Partial<ArenaPick>) => void;
  load: (entry: HistoryEntry, endpointId: string) => void;
  clearCache: () => void;
  resetUsage: () => void;
  run: () => Promise<void>;
  /** run one or more challenge puzzles, one round each */
  runChallenges: (refs: ChallengeRef[]) => Promise<void>;
  stop: () => void;
}

type Chosen = {
  endpoint: NonNullable<ReturnType<typeof useCredentials.getState>["endpoints"][number]>;
  model: string;
  history: HistoryMessage[];
};

export type StopReason = "solved" | "stuck" | "moves" | "turns" | "stopped";
/** what the UI needs about one model's until-solved run */
export interface SlotProgress {
  moves: string[];
  turns: number;
  fails: number;
  status: "playing" | StopReason;
}
interface TurnProgress extends SlotProgress {
  state: unknown;
}
const STOP_REASON: Record<SlotProgress["status"], string> = {
  playing: "",
  solved: "",
  stuck: "3 turns in a row without usable moves",
  moves: "move limit reached",
  turns: "turn limit reached",
  stopped: "stopped by you",
};

/** One card for a model's whole until-solved run: outputs per turn, metrics summed. */
export function mergeTurns(parts: SlotResult[]): SlotResult {
  const last = parts.at(-1)!;
  if (parts.length === 1) return last;
  const joined = (pick: (p: SlotResult) => string | undefined) =>
    parts
      .map((p, k) => (pick(p) ? `### Turn ${k + 1}\n\n${pick(p)}` : ""))
      .filter(Boolean)
      .join("\n\n");
  const ms = parts.map((p) => p.metrics).filter((m): m is RunMetrics => !!m);
  const sum = (f: (m: RunMetrics) => number | null | undefined) => ms.reduce((n, m) => n + (f(m) ?? 0), 0);
  const costs = ms.map((m) => m.cost_usd).filter((c): c is number => typeof c === "number");
  const total = sum((m) => m.total_ms);
  const out = sum((m) => m.completion_tokens);
  return {
    ...last,
    output: joined((p) => p.output),
    reasoning: joined((p) => p.reasoning) || undefined,
    images: parts.flatMap((p) => p.images),
    running: false,
    metrics: ms.length
      ? {
          ...ms[0]!,
          status: ms.some((m) => m.status === "success") ? "success" : ms.at(-1)!.status,
          error_category: last.metrics?.error_category ?? null,
          total_ms: total,
          prompt_tokens: sum((m) => m.prompt_tokens),
          completion_tokens: out,
          total_tokens: sum((m) => m.total_tokens),
          tokens_estimated: ms.some((m) => m.tokens_estimated),
          throughput_tps: total > 0 ? out / (total / 1000) : null,
          cost_usd: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
        }
      : null,
  };
}

export const useArena = create<ArenaState>()((set, get) => {
  const feeder = slotFeeder<ArenaState>(set);
  let stopQueue = false;

  const lineup = (): Chosen[] | null => {
    const st = get();
    const endpoints = useCredentials.getState().endpoints;
    const chosen = st.picks.map((p) => ({ endpoint: endpoints.find((e) => e.id === p.endpointId), model: p.model.trim() }));
    if (chosen.length < 2 || chosen.some((c) => !c.endpoint || !c.model)) return null;
    return chosen.map((c, i) => ({ endpoint: c.endpoint!, model: c.model, history: st.histories[i] ?? [] }));
  };

  /**
   * Shared battle runner: streams every slot, tallies usage, records the entry.
   * `map` (until-solved turns): request slot i is lineup position map[i]; the other positions
   * keep showing `base`, so every model's card stays where it is while only some still play.
   */
  const battle = async (
    slots: (Chosen & { prompt?: string })[],
    config: PromptConfig,
    timeoutS: number,
    patch: Partial<ArenaState>,
    turn?: { map: number[]; base: SlotResult[]; onDone?: (local: number, result: SlotResult) => void },
  ) => {
    const controller = new AbortController();
    feeder.reset();
    const strategy = get().strategy;
    const collected = slots.map((c) => emptySlot(c.model, endpointLabel(c.endpoint)));
    const fresh = slots.map((c) => emptySlot(c.model, endpointLabel(c.endpoint), strategy === "parallel"));
    set({
      ...patch,
      running: true,
      error: null,
      lastEntry: null,
      controller,
      slots: turn ? turn.base.map((r, i) => (turn.map.includes(i) ? fresh[turn.map.indexOf(i)]! : r)) : fresh,
    });
    const { contribute } = usePrefs.getState();
    let retryAfterS = 0;
    try {
      await runArena(slots, config, { strategy, contribute, timeoutS, signal: controller.signal }, (e) => {
        const i = typeof e.data.slot === "number" ? e.data.slot : -1;
        const target = collected[i];
        if (target) {
          Object.assign(target, e.event === "delta" ? { output: target.output + String(e.data.text ?? "") } : applyEvent(target, e));
        }
        feeder.handle(turn && i >= 0 ? { ...e, data: { ...e.data, slot: turn.map[i] } } : e);
        // a slot's metrics arrive once it's finished: its turn can be settled right away
        if (e.event === "metrics" && target && turn?.onDone) turn.onDone(i, target);
      });
    } catch (err) {
      set({ error: errorKey(err) });
      if (err instanceof HttpError && err.body.error === "rate_limited") retryAfterS = Math.max(1, Number(err.body.retry_after_s) || 10);
    } finally {
      feeder.finish();
      set({ controller: null });
    }
    set((s) => ({ usage: tally(s.usage, collected) }));
    let entry: HistoryEntry | null = null;
    if (collected.some((c) => c.metrics)) {
      entry = {
        id: uid(),
        kind: "arena",
        createdAt: new Date().toISOString(),
        strategy,
        config,
        results: collected.map(({ running: _r, ...r }, i) => ({ ...r, baseUrl: slots[i]!.endpoint.baseUrl })),
      };
      set({ lastEntry: entry });
      saveEntry(entry);
    }
    return { collected, entry, strategy, retryAfterS };
  };

  /** battle() that waits out the server's per-minute arena limit and retries (up to 6×). */
  const battleRetrying = async (...args: Parameters<typeof battle>) => {
    let result = await battle(...args);
    for (let attempt = 0; result.retryAfterS && attempt < 6 && !stopQueue; attempt++) {
      const waitUntil = Date.now() + result.retryAfterS * 1000 + 500;
      set((s) => ({ error: null, queue: s.queue && { ...s.queue, waitUntil } }));
      while (Date.now() < waitUntil && !stopQueue) await new Promise((r) => setTimeout(r, 250));
      set((s) => ({ queue: s.queue && { done: s.queue.done, total: s.queue.total } }));
      if (stopQueue) break;
      result = await battle(...args);
    }
    return result;
  };

  /**
   * Until-solved play: after each turn, every model that hasn't solved it gets a fresh prompt
   * with ITS current state and the moves it already made, and continues. A model stops when it
   * solves it, hits the move/turn cap, or is stuck (3 turns in a row without usable moves).
   */
  const playUntilSolved = async (ref: ChallengeRef, puzzle: Puzzle, slots: Chosen[], roundId: string, timeoutS: number) => {
    const it = puzzle.iterate!;
    const st = get();
    const progress: TurnProgress[] = slots.map(() => ({ state: it.start, moves: [], turns: 0, fails: 0, status: "playing" }));
    const parts: SlotResult[][] = slots.map(() => []);
    const base = () => slots.map((c, i) => (parts[i]!.length ? mergeTurns(parts[i]!) : emptySlot(c.model, endpointLabel(c.endpoint))));
    const view = () => progress.map(({ state: _s, ...p }) => ({ ...p, moves: [...p.moves] }));
    const budget = (p: TurnProgress) => (ref.maxMoves ? ref.maxMoves - p.moves.length : undefined);
    const firstPrompt = `${puzzle.prompt}\n\nIf it isn't solved after your moves, you'll get the new state back and can continue in another turn.`;
    let entry: HistoryEntry | null = null;
    let strategy = st.strategy;
    const settled = new Set<number>();
    let currentTurn = 0;

    for (let turn = 1; !stopQueue; turn++) {
      const active = progress.map((p, i) => (p.status === "playing" ? i : -1)).filter((i) => i >= 0);
      if (!active.length) break;
      if (ref.maxTurns && turn > ref.maxTurns) {
        for (const i of active) progress[i]!.status = "turns";
        break;
      }
      settled.clear();
      currentTurn = turn;
      const request = active.map((i) => ({
        ...slots[i]!,
        history: [],
        prompt: turn === 1 ? undefined : it.followUp(progress[i]!.state, progress[i]!.moves, turn, budget(progress[i]!)),
      }));
      set({ pendingProgress: view(), pendingTurn: turn });
      const config: PromptConfig = { modality: "chat", prompt: firstPrompt, system: CHALLENGE_SYSTEM, params: st.params };
      const result = await battleRetrying(
        request,
        config,
        timeoutS,
        { pendingText: null, pendingChallenge: ref, pendingRoundId: roundId },
        { map: active, base: base(), onDone: (local, c) => (settle(active[local]!, c), set({ pendingProgress: view() })) },
      );
      entry = result.entry ?? entry;
      strategy = result.strategy;
      // models that never reported (aborted, request failed) are settled now
      active.forEach((full, local) => settle(full, result.collected[local]!));
      set({ pendingProgress: view(), slots: base() });
    }
    for (const p of progress) if (p.status === "playing") p.status = "stopped";
    return finish();

    /** apply one model's answer for this turn — as soon as it is done, not when the slowest one is */
    function settle(full: number, c: SlotResult) {
      if (settled.has(full)) return;
      settled.add(full);
      {
        const p = progress[full]!;
        parts[full]!.push({ ...c, running: false });
        p.turns = currentTurn;
        if (!c.output.trim() || c.error) p.fails++;
        else {
          const r = it.apply(p.state, c.output, budget(p));
          p.state = r.state;
          p.moves.push(...r.applied);
          p.fails = r.applied.length ? 0 : p.fails + 1;
          if (r.solved) p.status = "solved";
          else if (ref.maxMoves && p.moves.length >= ref.maxMoves) p.status = "moves";
        }
        if (p.status === "playing" && p.fails >= 3) p.status = "stuck";
      }
    }

    function finish() {
      const verdicts: (Verdict | null)[] = progress.map((p, i) => {
        if (!parts[i]!.some((x) => x.output.trim())) return null;
        const v = it.verdict(p.state, p.moves, p.turns);
        const why = p.status === "solved" ? "" : ` · stopped: ${STOP_REASON[p.status]}`;
        return { ...v, note: v.note + why };
      });
      set((s) => ({
        pendingChallenge: null,
        pendingProgress: null,
        pendingTurn: 0,
        queue: s.queue ? { ...s.queue, done: s.queue.done + 1 } : null,
        rounds: [...s.rounds, { id: roundId, text: "", strategy, results: base(), entry, requestError: s.error, challenge: ref, verdicts }],
      }));
    }
  };

  return {
    picks: [
      { endpointId: "", model: "" },
      { endpointId: "", model: "" },
    ],
    strategy: "parallel",
    mode: "chat",
    system: "",
    prompt: "",
    drafts: [],
    usage: {},
    params: {},
    timeoutS: 120,
    kind: "free",
    challengeId: "maze",
    difficulty: "easy",
    maxMoves: 0,
    untilSolved: false,
    maxTurns: 0,
    stateFormat: "pieces",
    challengeTimeoutS: 300,
    distanceHint: true,
    rounds: [],
    histories: [],
    imageThread: [],
    pendingText: null,
    pendingChallenge: null,
    pendingRoundId: null,
    pendingProgress: null,
    pendingTurn: 0,
    checking: false,
    queue: null,
    running: false,
    slots: [],
    error: null,
    lastEntry: null,
    controller: null,

    setForm: (patch) => set(patch),
    newBattle: () => {
      if (get().running) return;
      set({
        rounds: [],
        histories: [],
        imageThread: [],
        slots: [],
        error: null,
        lastEntry: null,
        pendingText: null,
        pendingChallenge: null,
      });
    },
    updatePick: (i, patch) => set((s) => ({ picks: s.picks.map((p, j) => (j === i ? { ...p, ...patch } : p)) })),
    load: (d, endpointId) =>
      set({
        mode: d.config.modality === "image_gen" ? "image_gen" : "chat",
        system: stripRuntimeHint(d.config.system),
        prompt: d.config.prompt,
        drafts: draftsFromConfig(d.config),
        params: d.config.params ?? {},
        strategy: d.strategy ?? get().strategy,
        picks: d.results.slice(0, 4).map((r) => ({ endpointId, model: r.model })),
        slots: [],
        rounds: [],
        histories: [],
        lastEntry: null,
      }),
    stop: () => {
      stopQueue = true;
      get().controller?.abort();
    },
    clearCache: () => {
      if (get().running) return;
      set({ slots: [], rounds: [], histories: [], imageThread: [], error: null, lastEntry: null });
      useGameStorage.getState().clearScope("arena");
    },
    resetUsage: () => set({ usage: {} }),

    run: async () => {
      const st = get();
      if (st.running || st.checking || st.queue) return;
      if (overBudget("arena", arenaBytes(st))) {
        set({ error: "errors.storage_full" });
        return;
      }
      const slots = lineup();
      if (!slots || (!st.prompt.trim() && st.drafts.length === 0)) return;
      const built = buildPrompt(st.prompt, st.drafts, st.mode);
      const config: PromptConfig = {
        ...built,
        system: effectiveSystem(st.system, usePrefs.getState().runtimeHint && st.mode === "chat"),
        image_size: st.mode === "image_gen" ? "1024x1024" : undefined,
        params: st.params,
      };
      const userText = historyText(config); // what you typed — shown in the battle
      if (st.mode === "image_gen") config.prompt = chainImagePrompt(st.imageThread, built.prompt);
      const sentText = st.prompt;
      const sentDrafts = st.drafts;
      // like a chat: clear the composer as soon as the message is sent
      const { collected, entry, strategy } = await battle(slots, config, st.timeoutS, { pendingText: userText, prompt: "", drafts: [] });

      // Request failed before anything came back → give the text back so it can be retried.
      const nothing = collected.every((c) => !c.output && c.images.length === 0);
      set((s) => (s.error && nothing && s.prompt === "" && s.drafts.length === 0 ? { prompt: sentText, drafts: sentDrafts } : {}));
      set((s) => ({
        rounds: [
          ...s.rounds,
          { id: uid(), text: userText, strategy, results: collected.map((c) => ({ ...c, running: false })), entry, requestError: s.error },
        ],
        // Each model remembers only its OWN answers; a model that failed this round skips it.
        histories: slots.map((c, i) =>
          collected[i]?.output && config.modality !== "image_gen"
            ? [...c.history, { role: "user" as const, content: userText }, { role: "assistant" as const, content: collected[i]!.output }]
            : c.history,
        ),
        pendingText: null,
        imageThread:
          config.modality === "image_gen" && collected.some((c) => c.images.length > 0) ? [...s.imageThread, built.prompt] : s.imageThread,
      }));
    },

    runChallenges: async (refs) => {
      if (get().running || get().checking || get().queue || !refs.length) return;
      stopQueue = false;
      set({ queue: { done: 0, total: refs.length } });
      for (const ref of refs) {
        if (stopQueue) break;
        if (overBudget("arena", arenaBytes(get()))) {
          set({ error: "errors.storage_full" });
          break;
        }
        const puzzle = puzzleFor(ref);
        const slots = lineup();
        if (!puzzle || !slots) break;
        const st = get();
        // every puzzle starts fresh: no chat history, no runtime hint, the user's own system prompt is ignored
        const config: PromptConfig = { modality: "chat", prompt: puzzle.prompt, system: CHALLENGE_SYSTEM, params: st.params };
        const roundId = uid();
        // reasoning models can think for minutes on these; 3600 s is the backend's ceiling
        const timeoutS = st.challengeTimeoutS;
        if (ref.untilSolved && puzzle.iterate) {
          await playUntilSolved(ref, puzzle, slots, roundId, timeoutS);
          continue;
        }
        const result = await battleRetrying(
          slots.map((c) => ({ ...c, history: [] })),
          config,
          timeoutS,
          {
            pendingText: null,
            pendingChallenge: ref,
            pendingRoundId: roundId,
          },
        );
        const { collected, entry, strategy } = result;
        set({ checking: true });
        const verdicts: (Verdict | null)[] = await Promise.all(collected.map((c) => (c.output.trim() ? verdictFor(ref, c.output) : null)));
        contributeResults(ref, collected, verdicts, timeoutS);
        set((s) => ({
          checking: false,
          pendingChallenge: null,
          queue: s.queue ? { ...s.queue, done: s.queue.done + 1 } : null,
          rounds: [
            ...s.rounds,
            {
              id: roundId,
              text: "",
              strategy,
              results: collected.map((c) => ({ ...c, running: false })),
              entry,
              requestError: s.error,
              challenge: ref,
              verdicts,
            },
          ],
        }));
      }
      set({ queue: null, pendingChallenge: null, pendingRoundId: null, pendingProgress: null, pendingTurn: 0, checking: false });
    },
  };
});
