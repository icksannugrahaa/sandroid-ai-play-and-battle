import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { fetchModels } from "../api/client";
import { useT } from "../i18n";
import { ms, num, usd } from "../lib/format";
import { endpointLabel, useCredentials } from "../stores/credentials";
import type { FetchedModel, Modality, RunMetrics, SlotResult } from "../types";
import { Icon } from "./icons";
import { ArtifactGallery, RichText } from "./rich";
import { CopyButton, EndpointSelect, ErrorNote, errorKey } from "./ui";

export function ModelPicker({
  endpointId,
  onEndpoint,
  model,
  onModel,
  compact = false,
  inline = false,
  need = "chat",
}: {
  endpointId: string;
  onEndpoint: (id: string) => void;
  model: string;
  onModel: (m: string) => void;
  compact?: boolean;
  /** one compact row (endpoint · model · refresh) for the chat settings bar */
  inline?: boolean;
  /** what the current mode needs: image_gen shows only image models; chat hides image-only ones */
  need?: Modality;
}) {
  const t = useT();
  const endpoint = useCredentials((s) => s.endpoints.find((e) => e.id === endpointId));
  const models = useCredentials((s) => s.models[endpointId]);
  const setModels = useCredentials((s) => s.setModels);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const listId = `models-${endpointId}-${need}-${showAll ? "all" : "fit"}`;
  const fitting = useMemo(
    () => (models ?? []).filter((m) => (need === "image_gen" ? m.capabilities.includes("image_gen") : m.capabilities.includes("chat"))),
    [models, need],
  );
  const options = showAll ? (models ?? []) : fitting;
  const filterNote = models && models.length > 0 && fitting.length < models.length && (
    <span className="text-[11px] whitespace-nowrap text-slate-500">
      {t(need === "image_gen" ? "models.filteredImage" : "models.filteredChat", { n: fitting.length, total: models.length })}{" "}
      <button type="button" className="text-sky-400 hover:text-sky-300" onClick={() => setShowAll((v) => !v)}>
        {showAll ? t("models.onlyFitting") : t("models.showAll")}
      </button>
    </span>
  );

  const load = useCallback(async () => {
    if (!endpoint) return;
    setLoading(true);
    setError(null);
    try {
      setModels(endpoint.id, (await fetchModels(endpoint)).models);
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setLoading(false);
    }
  }, [endpoint, setModels]);

  useEffect(() => {
    if (endpoint && models === undefined && !loading && !error) void load();
  }, [endpoint, models, loading, error, load]);

  const selected = models?.find((m) => m.id === model);
  if (inline) {
    return (
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <div className="w-44 shrink-0 [&_.input]:py-1.5 [&_.input]:text-xs">
          <EndpointSelect value={endpointId} onChange={onEndpoint} />
        </div>
        <input
          className="input min-w-40 flex-1 py-1.5 font-mono text-xs"
          list={listId}
          value={model}
          placeholder={t("playground.modelPlaceholder")}
          onChange={(e) => onModel(e.target.value)}
        />
        <button type="button" className="btn-secondary px-2 py-1.5 text-xs" title={t("endpoints.test")} onClick={() => void load()}>
          {loading ? "…" : "↻"}
        </button>
        <datalist id={listId}>
          {options.map((m) => (
            <option key={m.id} value={m.id}>
              {m.capabilities.join(", ")}
            </option>
          ))}
        </datalist>
        {error && <ErrorNote code={error} />}
        {filterNote}
      </div>
    );
  }
  return (
    <div className={compact ? "space-y-2" : "grid gap-3 sm:grid-cols-2"}>
      <EndpointSelect value={endpointId} onChange={onEndpoint} />
      <div>
        <div className="flex gap-2">
          <input
            className="input"
            list={listId}
            value={model}
            placeholder={t("playground.modelPlaceholder")}
            onChange={(e) => onModel(e.target.value)}
          />
          <button type="button" className="btn-secondary px-2.5" title={t("endpoints.test")} onClick={() => void load()}>
            {loading ? "…" : "↻"}
          </button>
        </div>
        <datalist id={listId}>
          {options.map((m) => (
            <option key={m.id} value={m.id}>
              {m.capabilities.join(", ")}
            </option>
          ))}
        </datalist>
        {selected && <CapabilityBadges model={selected} />}
        {filterNote && <div className="mt-1">{filterNote}</div>}
        {error && <ErrorNote code={error} />}
      </div>
    </div>
  );
}

export function CapabilityBadges({ model }: { model: FetchedModel }) {
  const t = useT();
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {model.capabilities.map((c) => (
        <span key={c} className="badge bg-slate-800 text-slate-300">
          {t(`mode.${c}`)}
        </span>
      ))}
      <span className="badge bg-slate-900 text-slate-500">{model.family}</span>
    </div>
  );
}

type MetricKey = "ttft_ms" | "total_ms" | "completion_tokens" | "throughput_tps" | "cost_usd";
const BEST: { key: MetricKey; better: "min" | "max" }[] = [
  { key: "ttft_ms", better: "min" },
  { key: "total_ms", better: "min" },
  { key: "completion_tokens", better: "min" }, // fewest output tokens = most economical
  { key: "throughput_tps", better: "max" },
  { key: "cost_usd", better: "min" },
];

function bestIndex(slots: SlotResult[], key: MetricKey, better: "min" | "max"): number {
  let best = -1;
  let bestVal = 0;
  slots.forEach((s, i) => {
    const v = s.metrics?.status === "success" ? s.metrics[key] : null;
    if (v === null || v === undefined) return;
    if (key === "completion_tokens" && v <= 0) return; // "0 tokens" means unknown, not best
    if (best === -1 || (better === "min" ? v < bestVal : v > bestVal)) {
      best = i;
      bestVal = v;
    }
  });
  return best;
}

/** Request status of a run. `answered`: in challenge rounds "success" only means the model replied. */
export function StatusBadge({ status, answered }: { status: RunMetrics["status"] | "running" | "waiting"; answered?: boolean }) {
  const t = useT();
  const color =
    status === "success"
      ? "bg-emerald-950 text-emerald-300"
      : status === "timeout"
        ? "bg-amber-950 text-amber-300"
        : status === "running"
          ? "bg-sky-950 text-sky-300"
          : status === "waiting"
            ? "bg-slate-800 text-slate-400"
            : "bg-rose-950 text-rose-300";
  return (
    <span key={status} className={`badge animate-pop ${color}`}>
      {status === "running" && <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />}
      {status === "success" && <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />}
      {answered && status === "success" ? t("status.answered") : t(`status.${status}`)}
    </span>
  );
}

/** Re-renders every 100 ms while `active` — drives the live per-model timers. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** Live elapsed time while a model is working; final server-measured total once done. */
export function SlotTimer({ slot }: { slot: SlotResult }) {
  const now = useNow(slot.running);
  if (slot.metrics) return <span className="font-mono text-xs text-slate-400">✓ {ms(slot.metrics.total_ms)}</span>;
  if (!slot.running || !slot.startedAt) return null;
  return <span className="font-mono text-xs text-sky-300">⏱ {ms(now - slot.startedAt)}</span>;
}

function slotStatus(s: SlotResult): RunMetrics["status"] | "running" | "waiting" {
  if (s.metrics) return s.metrics.status;
  if (s.running) return "running";
  return s.error ? "error" : "waiting";
}

/**
 * Compact results table — one row per model, updated live while streaming.
 * Best value per metric is highlighted when 2+ models finished.
 */
export function ResultsTable({
  slots,
  actions,
  extra,
}: {
  slots: SlotResult[];
  actions?: ReactNode;
  /** an extra column after the request status (challenge verdicts) */
  extra?: { header: string; cell: (i: number) => ReactNode };
}) {
  const t = useT();
  const [open, setOpen] = useState<number | null>(null);
  const finished = slots.filter((s) => s.metrics?.status === "success").length;
  const winners = Object.fromEntries(BEST.map((c) => [c.key, finished > 1 ? bestIndex(slots, c.key, c.better) : -1]));
  const costs = slots.map((s) => s.metrics?.cost_usd).filter((c): c is number => typeof c === "number");
  const anyEstimated = slots.some((s) => s.metrics?.tokens_estimated);
  const now = useNow(slots.some((s) => s.running));
  const liveTtft = (s: SlotResult) => (s.firstTokenAt && s.startedAt ? ms(s.firstTokenAt - s.startedAt) : s.running ? "…" : "–");
  const liveTotal = (s: SlotResult) => (s.running && s.startedAt ? `⏱ ${ms(now - s.startedAt)}` : "–");

  const cell = (i: number, key: MetricKey, text: string, title?: string) => (
    <td className={`td text-right font-mono ${winners[key] === i ? "text-emerald-300" : ""}`} title={title}>
      {text}
      {winners[key] === i && <span className="ml-1 inline-block animate-pop text-[10px] text-emerald-400">★</span>}
    </td>
  );

  return (
    <section className="card overflow-hidden p-0">
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <span className={`h-2 w-2 rounded-full ${slots.some((x) => x.running) ? "animate-pulse bg-sky-400 shadow-[0_0_8px_var(--color-sky-400)]" : "bg-emerald-400"}`} />
          {t("results.title")}
        </h2>
        <div className="flex gap-2">{actions}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-800 bg-slate-950/40">
            <tr>
              <th className="th">{t("common.model")}</th>
              <th className="th">{extra ? t("metrics.response") : t("metrics.status")}</th>
              {extra && <th className="th">{extra.header}</th>}
              <th className="th text-right">{t("metrics.ttft")}</th>
              <th className="th text-right">{t("metrics.total")}</th>
              <th className="th text-right">{t("metrics.tokens")}</th>
              <th className="th text-right">{t("metrics.tps")}</th>
              <th className="th text-right">{t("metrics.cost")}</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {slots.map((s, i) => {
              const m = s.metrics;
              return (
                <tr key={i} className={`row ${s.running ? "bg-sky-950/10" : ""}`}>
                  <td className="td max-w-64">
                    <div className="truncate font-medium" title={s.model}>
                      {s.model}
                    </div>
                    <div className="truncate text-[11px] text-slate-500">
                      {s.endpointLabel}
                      {s.error && <span className="ml-1.5 text-rose-300">· {t(`errors.${s.error}`)}</span>}
                    </div>
                  </td>
                  <td className="td">
                    <StatusBadge status={slotStatus(s)} answered={!!extra} />
                  </td>
                  {extra && <td className="td">{extra.cell(i)}</td>}
                  {cell(i, "ttft_ms", m ? (m.ttft_supported ? ms(m.ttft_ms) : t("metrics.ttftUnsupported")) : liveTtft(s))}
                  {cell(i, "total_ms", m ? ms(m.total_ms) : liveTotal(s))}
                  {cell(i, "completion_tokens", m ? `${m.prompt_tokens} → ${m.completion_tokens}${m.tokens_estimated ? "*" : ""}` : "–")}
                  {cell(i, "throughput_tps", m ? num(m.throughput_tps) : "–")}
                  {cell(
                    i,
                    "cost_usd",
                    m ? (m.cost_usd !== null && m.price_exact === false ? `≈${usd(m.cost_usd)}` : usd(m.cost_usd)) : "–",
                    m?.price_key
                      ? t(m.price_exact === false ? "results.priceApprox" : "results.priceExact", { key: m.price_key })
                      : undefined,
                  )}
                  <td className="td text-right">
                    {(s.output || s.images.length > 0 || (s.audio?.length ?? 0) > 0) && (
                      <button type="button" className="btn-ghost px-2 py-1 text-xs text-sky-400 hover:text-sky-300" onClick={() => setOpen(i)}>
                        {t("results.view")} <Icon name="chevron" size={12} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {(slots.length > 1 || costs.length > 0) && (
            <tfoot className="border-t border-slate-800 text-xs text-slate-400">
              <tr>
                <td className="td" colSpan={8}>
                  {t("arena.totalCost")}:{" "}
                  <span className="font-mono text-slate-200">{costs.length ? usd(costs.reduce((a, b) => a + b, 0)) : "–"}</span> ·{" "}
                  {t("notice.estimated")}
                  {anyEstimated && <span> · * {t("metrics.estimated")}</span>}
                  {finished > 1 && <span> · ★ {t("results.bestLegend")}</span>}
                  {slots.some((s) => s.metrics?.price_exact === false) && <span> · ≈ {t("results.approxLegend")}</span>}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {open !== null && slots[open] && <OutputModal result={slots[open]} onClose={() => setOpen(null)} />}
    </section>
  );
}

/** Full-size reader for one output. Esc or backdrop click closes it. */
export function OutputModal({ result, onClose }: { result: SlotResult; onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="flex max-h-[90vh] w-full max-w-4xl animate-scale-in flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.8)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate font-medium">{result.model}</div>
            <div className="truncate text-xs text-slate-500">{result.endpointLabel}</div>
          </div>
          <div className="flex items-center gap-3">
            {result.output && <CopyButton text={result.output} />}
            <button type="button" className="icon-btn" onClick={onClose} aria-label={t("common.close")} title={t("common.close")}>
              <Icon name="x" />
            </button>
          </div>
        </div>
        <div className="space-y-4 overflow-y-auto p-4">
          <RichText text={result.output} cursor={result.running} />
          <ArtifactGallery text={result.output} images={result.images} audio={result.audio} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Height-capped output with its own scroll. While streaming it follows the newest
 * tokens unless you scroll up to read; "Expand" opens the full text.
 */
/** "Provider timed out (HTTP 524 · after 2m 4s)" + what usually causes that status. */
export function slotErrorText(t: ReturnType<typeof useT>, slot: SlotResult): { text: string; hint: string | null } {
  const bits = [
    slot.errorStatus ? `HTTP ${slot.errorStatus}` : null,
    slot.errorAfterMs !== undefined ? t("errors.after", { t: ms(slot.errorAfterMs) }) : null,
  ].filter(Boolean);
  const hintKey = slot.errorStatus ? `errors.http.${slot.errorStatus}` : null;
  const hint = hintKey && t(hintKey) !== hintKey ? t(hintKey) : null;
  return { text: `${t(`errors.${slot.error}`)}${bits.length ? ` (${bits.join(" · ")})` : ""}`, hint };
}

/** The provider stopped the answer at its output-token cap — the model never got to finish. */
export function TruncatedNote({ slot }: { slot: SlotResult }) {
  const t = useT();
  const reason = slot.metrics?.finish_reason;
  if (slot.error || (reason !== "length" && reason !== "incomplete")) return null;
  const key = reason === "length" ? "truncated" : "incomplete";
  return (
    <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
      ✂ {t(`errors.${key}`)}
      <p className="mt-0.5 text-amber-200/70">{t(`errors.${key}Hint`)}</p>
    </div>
  );
}

export function SlotError({ slot }: { slot: SlotResult }) {
  const t = useT();
  if (!slot.error) return null;
  const { text, hint } = slotErrorText(t, slot);
  return (
    <div className="rounded-lg border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
      {text}
      {hint && <p className="mt-1 text-xs text-rose-200/70">{hint}</p>}
    </div>
  );
}

/** Live "thinking" of reasoning models: open while the model is still thinking, folded after. */
export function ThinkingPanel({ result }: { result: SlotResult }) {
  const t = useT();
  const thinking = result.running && !result.output;
  const [open, setOpen] = useState<boolean | null>(null);
  const box = useRef<HTMLPreElement>(null);
  const shown = open ?? thinking;
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [result.reasoning, shown]);
  if (!result.reasoning) return null;
  return (
    <div className="rounded-lg border border-violet-900/50 bg-violet-950/20">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-violet-300/90"
        onClick={() => setOpen(!shown)}
        aria-expanded={shown}
      >
        <span>{shown ? "▾" : "▸"}</span>
        <span className={thinking ? "animate-pulse" : ""}>💭 {thinking ? t("run.thinking") : t("run.thoughts")}</span>
        <span className="text-violet-400/60">· {result.reasoning.length.toLocaleString()}</span>
      </button>
      {shown && (
        <pre ref={box} className="max-h-48 overflow-auto px-3 pb-2 text-[11px] leading-relaxed whitespace-pre-wrap text-violet-100/70">
          {result.reasoning}
        </pre>
      )}
    </div>
  );
}

export function OutputView({ result, maxHeight = "max-h-96" }: { result: SlotResult; maxHeight?: string }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [result.output]);

  // When a run finishes with a runnable app/game, bring the game (not the trailing code) into view.
  useEffect(() => {
    const el = box.current;
    if (!el || result.running) return;
    const game = el.querySelector<HTMLIFrameElement>("iframe[srcdoc]");
    if (game) el.scrollTop = Math.max(0, game.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 48);
  }, [result.running]);

  const hasContent = result.output || result.images.length > 0 || (result.audio?.length ?? 0) > 0;
  return (
    <div className="space-y-2">
      <ThinkingPanel result={result} />
      <div className={`rounded-xl border bg-slate-950/80 transition-colors duration-300 ${result.running ? "border-sky-900/70" : "border-slate-800"}`}>
        {hasContent && (
          <div className="flex justify-end gap-3 border-b border-slate-800/70 px-3 py-1">
            {result.output && <CopyButton text={result.output} />}
            <button type="button" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200" onClick={() => setExpanded(true)}>
              <Icon name="external" size={12} /> {t("common.expand")}
            </button>
          </div>
        )}
        <div
          ref={box}
          className={`${maxHeight} min-h-24 overflow-y-auto p-3`}
          onScroll={(e) => {
            const el = e.currentTarget;
            follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
        >
          {result.output ? (
            <RichText text={result.output} cursor={result.running} />
          ) : result.running ? (
            <TypingDots label={t("arena.waiting")} />
          ) : null}
        </div>
      </div>
      <ArtifactGallery text={result.output} images={result.images} audio={result.audio} />
      <SlotError slot={result} />
      <TruncatedNote slot={result} />
      {expanded && <OutputModal result={result} onClose={() => setExpanded(false)} />}
    </div>
  );
}

export function useEndpointDefault(current: string, set: (id: string) => void) {
  const endpoints = useCredentials((s) => s.endpoints);
  useEffect(() => {
    if (!endpoints.some((e) => e.id === current) && endpoints[0]) set(endpoints[0].id);
  }, [endpoints, current, set]);
  return endpoints;
}

export { endpointLabel };

/** Compact metrics line under a chat answer (live while streaming). */
export function TurnMeta({ slot }: { slot: SlotResult }) {
  const t = useT();
  const now = useNow(slot.running);
  const m = slot.metrics;
  const chip = (label: string, value: string, title?: string) => (
    <span className="whitespace-nowrap" title={title}>
      <span className="text-slate-500">{label}</span> <span className="font-mono text-slate-300">{value}</span>
    </span>
  );
  const ttft = m
    ? m.ttft_supported
      ? ms(m.ttft_ms)
      : "–"
    : slot.firstTokenAt && slot.startedAt
      ? ms(slot.firstTokenAt - slot.startedAt)
      : "…";
  const total = m ? ms(m.total_ms) : slot.startedAt ? `⏱ ${ms(now - slot.startedAt)}` : "…";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
      <StatusBadge status={slotStatus(slot)} />
      {chip(t("metrics.ttft"), ttft)}
      {chip(t("metrics.total"), total)}
      {m &&
        chip(
          t("metrics.tokens"),
          `${m.prompt_tokens} → ${m.completion_tokens}${m.tokens_estimated ? "*" : ""}`,
          m.tokens_estimated ? t("metrics.estimated") : undefined,
        )}
      {m && chip(t("metrics.tps"), num(m.throughput_tps))}
      {m &&
        chip(
          t("metrics.cost"),
          m.cost_usd !== null && m.price_exact === false ? `≈${usd(m.cost_usd)}` : usd(m.cost_usd),
          m.price_key ? t(m.price_exact === false ? "results.priceApprox" : "results.priceExact", { key: m.price_key }) : undefined,
        )}
    </div>
  );
}

/** One assistant answer in the chat view: full-length rich output (no inner scroll box). */
export function AssistantMessage({ result, requestError }: { result: SlotResult; requestError?: string | null }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const hasContent = result.output || result.images.length > 0 || (result.audio?.length ?? 0) > 0;
  return (
    <div
      className={`space-y-3 rounded-2xl border px-4 py-3 transition-[border-color,box-shadow] duration-500 ${
        result.running ? "border-sky-800/60 bg-slate-900/50 shadow-[0_0_40px_-20px_var(--color-sky-500)]" : "border-slate-800/80 bg-slate-900/40"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-indigo-500 text-white shadow-md shadow-sky-500/30 ${result.running ? "animate-pulse" : ""}`}
        >
          <Icon name="sparkles" size={14} />
        </span>
        <span className="text-sm font-medium text-slate-200">{result.model}</span>
        <span className="text-[11px] text-slate-500">{result.endpointLabel}</span>
        <span className="flex-1" />
        {hasContent && (
          <>
            {result.output && <CopyButton text={result.output} />}
            <button type="button" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200" onClick={() => setExpanded(true)}>
              <Icon name="external" size={12} /> {t("common.expand")}
            </button>
          </>
        )}
      </div>
      <ThinkingPanel result={result} />
      {result.output ? (
        <RichText text={result.output} cursor={result.running} />
      ) : result.running && !result.reasoning ? (
        <TypingDots label={t("arena.waiting")} />
      ) : null}
      <ArtifactGallery text={result.output} images={result.images} audio={result.audio} />
      <SlotError slot={result} />
      <TruncatedNote slot={result} />
      {requestError && <ErrorNote code={requestError} />}
      <TurnMeta slot={result} />
      {expanded && <OutputModal result={result} onClose={() => setExpanded(false)} />}
    </div>
  );
}

/** Three bouncing dots — "the model is thinking". */
export function TypingDots({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-1 text-sm text-slate-500" role="status">
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400/80" style={{ animationDelay: `${i * 140}ms` }} />
        ))}
      </span>
      {label}
    </div>
  );
}

/** A finished, metric-less result (e.g. a conversation restored from History). */
export function emptySlotView(model: string): SlotResult {
  return { model, endpointLabel: "", output: "", images: [], metrics: null, error: null, running: false };
}
