import { useMemo, useRef, useState } from "react";

import { OutputView, ResultsTable, StatusBadge } from "../components/run";
import { PageHeader } from "../components/ui";
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
        title={t("history.title")}
        subtitle={t("history.subtitle")}
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={() => fileInput.current?.click()}>
              {t("history.import")}
            </button>
            <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void importFile(e.target.files?.[0])} />
            <button type="button" className="btn-secondary" disabled={!entries.length} onClick={() => downloadJson(`sandroid-history-${new Date().toISOString().slice(0, 10)}.json`, buildExport(entries))}>
              {t("history.exportAll")}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={!entries.length}
              onClick={() => {
                if (window.confirm(t("history.clearConfirm"))) clear();
              }}
            >
              {t("common.clear")}
            </button>
          </>
        }
      />

      <div className="card flex flex-wrap items-center gap-4">
        <div className="min-w-48 flex-1">
          <div className="mb-1 flex justify-between text-xs text-slate-400">
            <span>{t("history.capacity", { n: entries.length, max: HISTORY_LIMIT, size: bytes(size) })}</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-800">
            <div className="h-1.5 rounded-full bg-sky-600" style={{ width: `${(entries.length / HISTORY_LIMIT) * 100}%` }} />
          </div>
        </div>
        <input className="input max-w-xs" placeholder={t("common.search")} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select className="input w-auto" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="">{t("common.all")}</option>
          <option value="playground">{t("history.kind.playground")}</option>
          <option value="arena">{t("history.kind.arena")}</option>
        </select>
      </div>

      {lastError && <p className="text-sm text-amber-300">{t("history.storageError")}</p>}
      {message && <p className={`text-sm ${message.ok ? "text-emerald-300" : "text-rose-300"}`}>{message.text}</p>}
      {entries.length === 0 && <p className="card text-sm text-slate-400">{t("history.empty")}</p>}

      <ul className="space-y-2">
        {visible.map((e) => (
          <li key={e.id} className="card p-0">
            <button type="button" className="flex w-full items-center gap-3 p-3 text-left" onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
              <span className="badge bg-slate-800 text-slate-300">{t(`history.kind.${e.kind}`)}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{e.config.prompt}</span>
              <span className="hidden truncate text-xs text-slate-500 sm:block">{e.results.map((r) => r.model).join(" · ")}</span>
              <span className="text-xs whitespace-nowrap text-slate-500">{date(e.createdAt, lang)}</span>
            </button>
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
                    {t("history.rerun")}
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
          </li>
        ))}
      </ul>
    </div>
    </ScopeContext.Provider>
  );
}
