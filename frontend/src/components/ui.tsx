import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { useT } from "../i18n";
import { errorKey } from "../lib/errors";
import { useCredentials } from "../stores/credentials";
import { usePrefs, type Retention } from "../stores/prefs";
import type { ErrorCategory, GenerationParams } from "../types";
import { Icon, type IconName } from "./icons";

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
    <div className="flex animate-slide-down gap-2.5 rounded-xl border border-rose-900/60 bg-rose-950/30 px-3 py-2.5 text-sm text-rose-200">
      <Icon name="alert" className="mt-0.5 shrink-0 text-rose-400" />
      <div>
        {text}
        {hint && <p className="mt-1 text-xs text-rose-200/70">{hint}</p>}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, icon }: { title: string; subtitle?: string; actions?: ReactNode; icon?: IconName }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        {icon && <IconTile name={icon} />}
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-gradient">{title}</h1>
          {subtitle && <p className="mt-1 max-w-2xl text-sm text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Rounded glowing tile holding an icon (page headers, empty states). */
export function IconTile({ name, size = "md" }: { name: IconName; size?: "md" | "lg" }) {
  const lg = size === "lg";
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-2xl border border-sky-800/50 bg-gradient-to-br from-sky-500/20 to-indigo-500/10 text-sky-300 shadow-[0_0_30px_-8px_var(--color-sky-500)] ${lg ? "h-16 w-16" : "h-10 w-10"}`}
    >
      <Icon name={name} size={lg ? 28 : 19} />
    </span>
  );
}

/** Centered illustration + text + optional actions for pages with nothing to show yet. */
export function EmptyState({ icon, title, hint, children }: { icon: IconName; title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="flex animate-fade-up flex-col items-center justify-center gap-3 px-4 py-10 text-center">
      <div className="animate-float">
        <IconTile name={icon} size="lg" />
      </div>
      <p className={`mt-2 max-w-xl font-medium text-slate-200 ${title.length > 60 ? "text-sm sm:text-base" : "text-lg"}`}>{title}</p>
      {hint && <p className="max-w-xl text-sm text-slate-500">{hint}</p>}
      {children && <div className="mt-2 flex max-w-2xl flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

/** Height-animated show/hide (CSS grid-rows trick — no measuring). */
export function Collapse({ open, children, className = "" }: { open: boolean; children: ReactNode; className?: string }) {
  // `inert` keeps hidden controls out of the tab order (attribute set directly — React 18 has no prop for it).
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) ref.current?.removeAttribute("inert");
    else ref.current?.setAttribute("inert", "");
  }, [open]);
  return (
    <div
      ref={ref}
      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[var(--ease-out-soft)] ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      aria-hidden={!open}
    >
      <div className={`min-h-0 overflow-hidden ${className}`}>{children}</div>
    </div>
  );
}

export function SkeletonRows({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4" style={{ opacity: 1 - r * 0.15 }}>
          {Array.from({ length: cols }, (_, c) => (
            <div key={c} className="skeleton h-4" style={{ flex: c === 0 ? 3 : 1 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CostNotice({ compact = false }: { compact?: boolean }) {
  const t = useT();
  return (
    <p
      className={`flex items-start gap-2 rounded-xl border border-amber-900/50 bg-amber-950/20 text-amber-200/90 ${compact ? "px-3 py-1.5 text-xs" : "px-3 py-2.5 text-sm"}`}
    >
      <Icon name="bolt" className="mt-0.5 shrink-0 text-amber-400" size={compact ? 13 : 15} />
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
  size = "md",
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  // A pill slides under the active option (measured, so labels can be any width).
  const box = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const index = options.findIndex((o) => o.value === value);
  const labels = options.map((o) => o.label).join("|");
  useLayoutEffect(() => {
    const el = box.current?.children[index + 1] as HTMLElement | undefined;
    setPill(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
  }, [index, labels]);
  return (
    <div ref={box} role="tablist" className="relative inline-flex rounded-xl border border-slate-700/80 bg-slate-950/70 p-0.5">
      <span
        aria-hidden
        className="absolute top-0.5 bottom-0.5 rounded-[10px] bg-gradient-to-b from-slate-700 to-slate-800 shadow-[0_1px_0_0_rgb(255_255_255/0.08)_inset,0_2px_8px_-2px_rgb(0_0_0/0.5)] transition-[left,width] duration-300 ease-[var(--ease-out-soft)]"
        style={pill ? { left: pill.left, width: pill.width } : { opacity: 0 }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`relative z-10 rounded-[10px] transition-colors duration-200 ${size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm"} ${value === o.value ? "text-white" : "text-slate-400 hover:text-slate-200"}`}
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
        <Switch checked={contribute} onChange={setContribute} />
        {t("playground.contribute")}
      </label>
      <label className="flex items-center gap-2">
        <span className="text-slate-400">{t("playground.retention")}</span>
        <select
          className="input w-auto py-1"
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
      className={`inline-flex items-center gap-1 text-xs transition ${done ? "text-emerald-400" : "text-slate-400 hover:text-slate-200"}`}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      <Icon name={done ? "check" : "copy"} size={13} className={done ? "animate-pop" : ""} />
      {done ? t("common.copied") : t("common.copy")}
    </button>
  );
}

/** iOS-style toggle; a real checkbox underneath so labels and keyboard keep working. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <span className="relative inline-flex shrink-0">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        className="peer absolute inset-0 z-10 cursor-pointer opacity-0"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className={`h-5 w-9 rounded-full border transition-colors duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-sky-500 ${checked ? "border-sky-500 bg-sky-500/80" : "border-slate-700 bg-slate-800"}`}
      />
      <span
        aria-hidden
        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ease-[var(--ease-spring)] ${checked ? "translate-x-4" : ""}`}
      />
    </span>
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
      <button type="button" className="btn-secondary min-w-36" disabled={loading} onClick={onClick}>
        {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-500 border-t-sky-400" />}
        {loading ? t("common.loading") : t("common.loadMore")}
      </button>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const t = useT();
  return (
    <div className="relative w-full max-w-sm">
      <Icon name="search" size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-500" />
      <input className="input pr-8 pl-9" placeholder={placeholder ?? t("common.search")} value={value} onChange={(e) => onChange(e.target.value)} />
      {value && (
        <button
          type="button"
          aria-label={t("common.clear")}
          className="absolute top-1/2 right-2 inline-flex h-5 w-5 -translate-y-1/2 animate-pop items-center justify-center rounded-full text-slate-500 hover:bg-slate-700 hover:text-slate-200"
          onClick={() => onChange("")}
        >
          <Icon name="x" size={12} />
        </button>
      )}
    </div>
  );
}
