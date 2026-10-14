import { useMemo, useRef, useState } from "react";

import { OutputView, ResultsTable, StatusBadge } from "../components/run";
import { Icon } from "../components/icons";
import { Collapse, EmptyState, PageHeader, SearchInput, Segmented } from "../components/ui";
import { useLang, useT } from "../i18n";
import { ScopeContext } from "../stores/gameStorage";
import { bytes, date } from "../lib/format";
import { useDraft } from "../stores/draft";
import { buildExport, downloadJson, HISTORY_LIMIT, historyBytes, ImportError, parseImport, useHistory } from "../stores/history";
import type { HistoryEntry } from "../types";

export default function History() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const { entries, lastError, merge, remove, clear } = useHistory();
  const openDraft = useDraft((s) => s.open);
  const [filter, setFilter] = useState("");
  const [kind, setKind] = useState<"" | HistoryEntry["kind"]>("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const size = useMemo(() => historyBytes(entries), [entries]);
  const visible = useMemo(() => {
    const q = filter.toLowerCase();
    return entries.filter(
      (e) =>
        (!kind || e.kind === kind) &&
        (!q || e.config.prompt.toLowerCase().includes(q) || e.results.some((r) => r.model.toLowerCase().includes(q))),
    );
  }, [entries, filter, kind]);

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const n = merge(parseImport(await file.text()));
      setMessage({ ok: true, text: t("history.imported", { n }) });
    } catch (err) {
      setMessage({ ok: false, text: t(`errors.${err instanceof ImportError ? err.message : "generic"}`) });
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <ScopeContext.Provider value="history">
    <div className="space-y-4">
      <PageHeader
        icon="history"
        title={t("history.title")}
        subtitle={t("history.subtitle")}
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={() => fileInput.current?.click()}>
              <Icon name="upload" size={14} /> {t("history.import")}
            </button>
            <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void importFile(e.target.files?.[0])} />
            <button type="button" className="btn-secondary" disabled={!entries.length} onClick={() => downloadJson(`sandroid-history-${new Date().toISOString().slice(0, 10)}.json`, buildExport(entries))}>
              <Icon name="download" size={14} /> {t("history.exportAll")}
            </button>
            <button
              type="button"
              className="btn-secondary hover:border-rose-800 hover:text-rose-300"
              disabled={!entries.length}
              onClick={() => {
                if (window.confirm(t("history.clearConfirm"))) clear();
              }}
            >
              <Icon name="trash" size={14} /> {t("common.clear")}
            </button>
          </>
        }
      />

      <div className="card flex flex-wrap items-center gap-4">
        <div className="min-w-48 flex-1">
          <div className="mb-1 flex justify-between text-xs text-slate-400">
            <span>{t("history.capacity", { n: entries.length, max: HISTORY_LIMIT, size: bytes(size) })}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-1.5 rounded-full bg-gradient-to-r from-sky-600 to-sky-400 transition-[width] duration-700 ease-[var(--ease-out-soft)]"
              style={{ width: `${(entries.length / HISTORY_LIMIT) * 100}%` }}
            />
          </div>
        </div>
        <SearchInput value={filter} onChange={setFilter} />
        <Segmented
          size="sm"
          value={kind || "all"}
          onChange={(v) => setKind(v === "all" ? "" : v)}
          options={[
            { value: "all", label: t("common.all") },
            { value: "playground", label: t("history.kind.playground") },
            { value: "arena", label: t("history.kind.arena") },
          ]}
        />
      </div>

      {lastError && <p className="text-sm text-amber-300">{t("history.storageError")}</p>}
      {message && <p className={`animate-slide-down text-sm ${message.ok ? "text-emerald-300" : "text-rose-300"}`}>{message.text}</p>}
      {entries.length === 0 && (
        <div className="card">
          <EmptyState icon="history" title={t("history.empty")} />
        </div>
      )}

      <ul className="stagger space-y-2">
        {visible.map((e, i) => (
          <li
            key={e.id}
            className={`card overflow-hidden p-0 transition-colors duration-200 ${expanded === e.id ? "border-sky-800/60" : "hover:border-slate-700"}`}
            style={{ "--i": i } as React.CSSProperties}
          >
            <button
              type="button"
              aria-expanded={expanded === e.id}
              className="group flex w-full items-center gap-3 p-3 text-left"
              onClick={() => setExpanded(expanded === e.id ? null : e.id)}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${e.kind === "arena" ? "border-fuchsia-900/60 bg-fuchsia-950/30 text-fuchsia-300" : "border-sky-900/60 bg-sky-950/30 text-sky-300"}`}
                title={t(`history.kind.${e.kind}`)}
              >
                <Icon name={e.kind === "arena" ? "swords" : "chat"} size={15} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{e.config.prompt}</span>
              <span className="hidden truncate text-xs text-slate-500 sm:block">{e.results.map((r) => r.model).join(" · ")}</span>
              <span className="text-xs whitespace-nowrap text-slate-500">{date(e.createdAt, lang)}</span>
              <Icon name="chevron" size={15} className={`shrink-0 text-slate-500 transition-transform duration-300 group-hover:text-slate-300 ${expanded === e.id ? "rotate-90" : ""}`} />
            </button>
            <Collapse open={expanded === e.id}>
            {expanded === e.id && (
              <div className="space-y-3 border-t border-slate-800 p-3">
                {e.config.system && <p className="text-xs text-slate-400">System: {e.config.system}</p>}
                <p className="text-sm whitespace-pre-wrap">{e.config.prompt}</p>
                <ResultsTable slots={e.results.map((r) => ({ ...r, running: false }))} />
                <div className={`grid gap-3 ${e.results.length > 1 ? "md:grid-cols-2" : ""}`}>
                  {e.results.map((r, i) => (
                    <div key={i} className="min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate font-medium">{r.model}</span>
                        {r.metrics && <StatusBadge status={r.metrics.status} />}
                      </div>
                      <p className="truncate text-[11px] text-slate-500">{r.endpointLabel}</p>
                      <OutputView result={{ ...r, running: false }} maxHeight="max-h-72" />
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary py-1 text-xs" onClick={() => openDraft(e)}>
                    <Icon name="refresh" size={13} /> {t("history.rerun")}
                  </button>
                  <button type="button" className="btn-secondary py-1 text-xs" onClick={() => downloadJson(`${e.kind}-${e.id}.json`, buildExport([e]))}>
                    {t("common.export")}
                  </button>
                  <button type="button" className="btn-secondary py-1 text-xs hover:text-rose-300" onClick={() => remove(e.id)}>
                    {t("common.remove")}
                  </button>
                </div>
              </div>
            )}
            </Collapse>
          </li>
        ))}
      </ul>
    </div>
    </ScopeContext.Provider>
  );
}
