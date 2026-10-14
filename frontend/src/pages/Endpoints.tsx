import { useState } from "react";

import { fetchModels } from "../api/client";
import { CacheSetting } from "../components/cache";
import { Icon } from "../components/icons";
import { CostNotice, EmptyState, ErrorNote, errorKey, Field, PageHeader } from "../components/ui";
import { useT } from "../i18n";
import { endpointLabel, useCredentials } from "../stores/credentials";
import { useCacheStatus } from "../stores/sessionCache";

/** Inline key field for endpoints without one (e.g. restored from the session cache). */
function KeyInput({ id }: { id: string }) {
  const t = useT();
  const update = useCredentials((s) => s.updateEndpoint);
  const [value, setValue] = useState("");
  return (
    <form
      className="mt-2 flex gap-2"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (value.trim()) update(id, { apiKey: value.trim() });
      }}
    >
      <input
        type="password"
        autoComplete="off"
        className="input max-w-xs py-1 font-mono text-xs"
        placeholder="sk-…"
        value={value}
        onChange={(ev) => setValue(ev.target.value)}
      />
      <button type="submit" className="btn-secondary py-1 text-xs" disabled={!value.trim()}>
        {t("endpoints.setKey")}
      </button>
    </form>
  );
}

/** Well-known OpenAI-compatible base URLs (convenience only — any https endpoint works). */
const PRESETS: { label: string; url: string }[] = [
  { label: "OpenAI", url: "https://api.openai.com/v1" },
  { label: "OpenRouter", url: "https://openrouter.ai/api/v1" },
  { label: "Groq", url: "https://api.groq.com/openai/v1" },
  { label: "Together", url: "https://api.together.xyz/v1" },
  { label: "DeepSeek", url: "https://api.deepseek.com/v1" },
  { label: "Mistral", url: "https://api.mistral.ai/v1" },
  { label: "Google Gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { label: "xAI", url: "https://api.x.ai/v1" },
  { label: "Fireworks", url: "https://api.fireworks.ai/inference/v1" },
];

function validUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.hostname === "localhost";
  } catch {
    return false;
  }
}

export default function Endpoints() {
  const t = useT();
  const { endpoints, models, addEndpoint, removeEndpoint, setModels, clearAll } = useCredentials();
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const urlOk = validUrl(baseUrl.trim());
  const restored = useCacheStatus((st) => st.restoredAt) !== null && endpoints.some((e) => !e.apiKey);

  const test = async (id: string) => {
    const endpoint = useCredentials.getState().endpoints.find((e) => e.id === id);
    if (!endpoint) return;
    setBusy(id);
    setErrors((e) => ({ ...e, [id]: null }));
    try {
      setModels(id, (await fetchModels(endpoint)).models);
    } catch (err) {
      setErrors((e) => ({ ...e, [id]: errorKey(err) }));
    } finally {
      setBusy(null);
    }
  };

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    if (!urlOk) return;
    const e = addEndpoint({ label: label.trim(), baseUrl: baseUrl.trim().replace(/\/+$/, ""), apiKey: apiKey.trim() });
    setLabel("");
    setBaseUrl("");
    setApiKey("");
    void test(e.id);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        icon="plug"
        title={t("endpoints.title")}
        subtitle={t("endpoints.subtitle")}
        actions={
          endpoints.length > 0 && (
            <button type="button" className="btn-secondary hover:border-rose-800 hover:text-rose-300" onClick={clearAll}>
              <Icon name="trash" size={14} /> {t("endpoints.clearAll")}
            </button>
          )
        }
      />
      <CostNotice />

      <form className="card grid gap-3 md:grid-cols-[1fr_1.4fr_1.4fr_auto] md:items-end" onSubmit={add} autoComplete="off">
        <div className="flex flex-wrap items-center gap-1.5 md:col-span-4">
          <span className="label mb-0 mr-1">{t("endpoints.presets")}</span>
          {PRESETS.map((p) => (
            <button
              key={p.url}
              type="button"
              className={`chip py-1 ${baseUrl === p.url ? "border-sky-500 bg-sky-950/60 text-sky-100" : ""}`}
              onClick={() => {
                setBaseUrl(p.url);
                if (!label || PRESETS.some((x) => x.label === label)) setLabel(p.label);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <Field label={t("endpoints.label")}>
          <input className="input" value={label} placeholder={t("endpoints.labelPlaceholder")} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label={t("endpoints.baseUrl")}>
          <input
            className="input"
            list="endpoint-presets"
            value={baseUrl}
            placeholder="https://api.openai.com/v1"
            onChange={(e) => {
              setBaseUrl(e.target.value);
              const preset = PRESETS.find((p) => p.url === e.target.value);
              if (preset && !label) setLabel(preset.label);
            }}
          />
          <datalist id="endpoint-presets">
            {PRESETS.map((p) => (
              <option key={p.url} value={p.url}>
                {p.label}
              </option>
            ))}
          </datalist>
        </Field>
        <Field label={t("endpoints.apiKey")}>
          {/* autocomplete off + no name: the browser should not offer to save it either */}
          <input
            className="input font-mono"
            type="password"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            value={apiKey}
            placeholder="sk-…"
            onChange={(e) => setApiKey(e.target.value)}
          />
        </Field>
        <button type="submit" className="btn-primary" disabled={!urlOk}>
          <Icon name="plus" size={15} /> {t("common.add")}
        </button>
        <p className="text-xs text-slate-500 md:col-span-4">{t("endpoints.apiKeyHint")}</p>
        {baseUrl && !urlOk && <p className="animate-slide-down text-xs text-rose-300 md:col-span-4">{t("endpoints.invalidUrl")}</p>}
      </form>

      <CacheSetting />
      {restored && <p className="animate-slide-down rounded-xl border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">{t("endpoints.restoredNote")}</p>}
      {endpoints.length === 0 ? (
        <div className="card">
          <EmptyState icon="plug" title={t("endpoints.empty")} />
        </div>
      ) : (
        <ul className="stagger space-y-2">
          {endpoints.map((e, i) => {
            const state = busy === e.id ? "testing" : errors[e.id] ? "error" : models[e.id] ? "ready" : "idle";
            return (
            <li key={e.id} className="card card-hover flex flex-wrap items-center gap-3" style={{ "--i": i } as React.CSSProperties}>
              <span
                className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
                  state === "ready"
                    ? "border-emerald-800/60 bg-emerald-950/40 text-emerald-300"
                    : state === "error"
                      ? "border-rose-800/60 bg-rose-950/40 text-rose-300"
                      : "border-slate-700 bg-slate-900 text-slate-400"
                }`}
                title={state === "ready" ? t("endpoints.ready") : state === "idle" ? t("endpoints.untested") : undefined}
              >
                {state === "testing" ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400" />
                ) : (
                  <Icon name={state === "error" ? "alert" : "plug"} />
                )}
                {state === "ready" && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-slate-900 bg-emerald-400" />
                  </span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{endpointLabel(e)}</div>
                <div className="truncate font-mono text-xs text-slate-500">
                  {e.baseUrl} · {e.apiKey ? `key ••••${e.apiKey.slice(-4)}` : <span className="text-amber-300">{t("endpoints.needsKey")}</span>}
                </div>
                {!e.apiKey && <KeyInput id={e.id} />}
                <ErrorNote code={errors[e.id]} />
              </div>
              {models[e.id] && (
                <span key={models[e.id]!.length} className="badge animate-pop bg-emerald-950/70 text-emerald-300">
                  {t("endpoints.models", { n: models[e.id]!.length })}
                </span>
              )}
              <button type="button" className="btn-secondary" disabled={busy === e.id} onClick={() => void test(e.id)}>
                <Icon name="refresh" size={14} className={busy === e.id ? "animate-spin" : ""} />
                {busy === e.id ? t("endpoints.testing") : t("endpoints.test")}
              </button>
              <button
                type="button"
                className="icon-btn hover:bg-rose-950/60 hover:text-rose-300"
                title={t("common.remove")}
                aria-label={t("common.remove")}
                onClick={() => removeEndpoint(e.id)}
              >
                <Icon name="trash" />
              </button>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
