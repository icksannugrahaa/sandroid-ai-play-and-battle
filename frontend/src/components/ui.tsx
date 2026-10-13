import { useEffect, useRef, useState, type ReactNode } from "react";

import { useT } from "../i18n";
import { errorKey } from "../lib/errors";
import { useCredentials } from "../stores/credentials";
import { usePrefs, type Retention } from "../stores/prefs";
import type { ErrorCategory, GenerationParams } from "../types";

export { errorKey };

/** "errors.server|530" → "The provider returned an error. (HTTP 530)" + what that status usually means. */
export function describeError(t: ReturnType<typeof useT>, code: string): { text: string; hint: string | null } {
  const [raw, status] = code.split("|");
  const key = raw!.startsWith("errors.") ? raw! : `errors.${raw}`;
  const hintKey = status ? `errors.http.${status}` : null;
  const hint = hintKey && t(hintKey) !== hintKey ? t(hintKey) : null;
  return { text: `${t(key)}${status ? ` (HTTP ${status})` : ""}`, hint };
}

export function ErrorNote({ code }: { code: string | ErrorCategory | null | undefined }) {
  const t = useT();
  if (!code) return null;
  const { text, hint } = describeError(t, code);
  return (
    <div className="rounded-lg border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
      {text}
      {hint && <p className="mt-1 text-xs text-rose-200/70">{hint}</p>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function CostNotice({ compact = false }: { compact?: boolean }) {
  const t = useT();
  return (
    <p
      className={`rounded-lg border border-amber-900/50 bg-amber-950/30 text-amber-200/90 ${compact ? "px-3 py-1.5 text-xs" : "px-3 py-2 text-sm"}`}
    >
      {t("notice.billing")}
    </p>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-700 bg-slate-950 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-sm transition ${value === o.value ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EndpointSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const t = useT();
  const endpoints = useCredentials((s) => s.endpoints);
  if (endpoints.length === 0) {
    return (
      <a href="#/endpoints" className="btn-secondary w-full">
        {t("notice.noEndpoint")}
      </a>
    );
  }
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      {endpoints.map((e) => (
        <option key={e.id} value={e.id}>
          {e.label || e.baseUrl}
        </option>
      ))}
    </select>
  );
}

export function ParamsPanel({
  params,
  onChange,
  timeoutS,
  onTimeout,
}: {
  params: GenerationParams;
  onChange: (p: GenerationParams) => void;
  timeoutS: number;
  onTimeout: (s: number) => void;
}) {
  const t = useT();
  const numberOrUndef = (v: string) => (v === "" ? undefined : Number(v));
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Field label={t("playground.temperature")}>
        <input
          className="input"
          type="number"
          step="0.1"
          min={0}
          max={2}
          placeholder="1.0"
          value={params.temperature ?? ""}
          onChange={(e) => onChange({ ...params, temperature: numberOrUndef(e.target.value) })}
        />
      </Field>
      <Field label={t("playground.maxTokens")}>
        <input
          className="input"
          type="number"
          min={1}
          placeholder="auto (max)"
          value={params.max_tokens ?? ""}
          onChange={(e) => onChange({ ...params, max_tokens: numberOrUndef(e.target.value) })}
        />
      </Field>
      <Field label={t("playground.topP")}>
        <input
          className="input"
          type="number"
          step="0.05"
          min={0}
          max={1}
          placeholder="1.0"
          value={params.top_p ?? ""}
          onChange={(e) => onChange({ ...params, top_p: numberOrUndef(e.target.value) })}
        />
      </Field>
      <Field label={t("playground.timeout")}>
        <input
          className="input"
          type="number"
          min={5}
          max={3600}
          value={timeoutS}
          onChange={(e) => onTimeout(Math.min(3600, Math.max(5, Number(e.target.value) || 120)))}
        />
      </Field>
    </div>
  );
}

export function RunOptions() {
  const t = useT();
  const { contribute, setContribute, retention, setRetention } = usePrefs();
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      <label className="flex items-center gap-2" title={t("playground.contributeHint")}>
        <input type="checkbox" className="h-4 w-4 accent-sky-500" checked={contribute} onChange={(e) => setContribute(e.target.checked)} />
        {t("playground.contribute")}
      </label>
      <label className="flex items-center gap-2">
        <span className="text-slate-400">{t("playground.retention")}</span>
        <select
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          value={retention}
          onChange={(e) => setRetention(e.target.value as Retention)}
        >
          <option value="ephemeral">{t("playground.retentionEphemeral")}</option>
          <option value="local">{t("playground.retentionLocal")}</option>
        </select>
      </label>
    </div>
  );
}

export function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="text-xs text-slate-400 hover:text-slate-200"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {done ? t("common.copied") : t("common.copy")}
    </button>
  );
}

/** Seconds countdown that ticks locally (no polling). */
export function useCountdown(seconds: number): number {
  const [left, setLeft] = useState(seconds);
  const started = useRef(Date.now());
  useEffect(() => {
    started.current = Date.now();
    setLeft(seconds);
    if (seconds <= 0) return;
    const id = setInterval(() => {
      const remaining = Math.max(0, seconds - Math.floor((Date.now() - started.current) / 1000));
      setLeft(remaining);
      if (remaining === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [seconds]);
  return left;
}

export function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${String(sec).padStart(2, "0")}s` : `${sec}s`;
}

export function LoadMore({ show, loading, onClick }: { show: boolean; loading: boolean; onClick: () => void }) {
  const t = useT();
  if (!show) return null;
  return (
    <div className="mt-4 flex justify-center">
      <button type="button" className="btn-secondary" disabled={loading} onClick={onClick}>
        {loading ? t("common.loading") : t("common.loadMore")}
      </button>
    </div>
  );
}
