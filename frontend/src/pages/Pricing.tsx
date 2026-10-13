import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";

import { getPricing, researchPricing } from "../api/client";
import { ErrorNote, errorKey, formatDuration, LoadMore, PageHeader, useCountdown } from "../components/ui";
import { useLang, useT } from "../i18n";
import { date, usd } from "../lib/format";
import type { PricingResponse } from "../types";

export default function Pricing() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());

  const query = useInfiniteQuery({
    queryKey: ["pricing", deferredSearch],
    queryFn: ({ pageParam }) => getPricing(deferredSearch, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last: PricingResponse) => last.next_cursor,
    placeholderData: (prev) => prev,
  });
  const first = query.data?.pages[0];
  const entries = query.data?.pages.flatMap((p) => p.entries) ?? [];
  const cooldown = useCountdown(first?.cooldown_remaining_s ?? 0);

  const research = useMutation({
    mutationFn: researchPricing,
    onSettled: () => client.invalidateQueries({ queryKey: ["pricing"] }),
  });

  const last = first?.last_research;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("pricing.title")}
        subtitle={t("pricing.subtitle")}
        actions={
          <button
            type="button"
            className="btn-primary"
            disabled={cooldown > 0 || research.isPending}
            onClick={() => {
              if (window.confirm(t("pricing.researchConfirm"))) research.mutate();
            }}
          >
            {research.isPending ? t("pricing.researching") : cooldown > 0 ? t("pricing.cooldown", { time: formatDuration(cooldown) }) : t("pricing.research")}
          </button>
        }
      />
      {research.error && <ErrorNote code={errorKey(research.error)} />}

      {last && (
        <section className="card space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-slate-400">
              {t("pricing.lastResearch")}: {date(last.created_at, lang)}
            </span>
            <span className="text-slate-400">{t("pricing.entriesUpdated", { n: last.entries_updated })}</span>
            {Object.entries(last.sources_status).map(([name, s]) => (
              <span key={name} className={`badge ${s.ok ? "bg-emerald-950 text-emerald-300" : "bg-rose-950 text-rose-300"}`}>
                {name}: {s.ok ? s.entries : s.error}
              </span>
            ))}
          </div>
          {last.alias_candidates.length > 0 && (
            <details>
              <summary className="cursor-pointer text-slate-300">
                {t("pricing.aliasCandidates")} ({last.alias_candidates.length})
              </summary>
              <p className="mt-1 text-xs text-slate-500">{t("pricing.aliasHint")}</p>
              <ul className="mt-2 grid gap-1 font-mono text-xs sm:grid-cols-2">
                {last.alias_candidates.map((c) => (
                  <li key={c.model_key}>
                    {c.model_key} → {c.suggested_key} <span className="text-slate-500">({c.score})</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      <div className="flex items-center gap-3">
        <input className="input max-w-sm" placeholder={t("common.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        {first && <span className="text-sm text-slate-500">{t("pricing.total", { n: first.total })}</span>}
      </div>

      <section className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-slate-800">
            <tr>
              <th className="th">{t("common.model")}</th>
              <th className="th">{t("pricing.input")}</th>
              <th className="th">{t("pricing.output")}</th>
              <th className="th">{t("pricing.image")}</th>
              <th className="th">{t("pricing.source")}</th>
              <th className="th">{t("pricing.updated")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.canonical_key} className="border-b border-slate-900 hover:bg-slate-900/50">
                <td className="td">
                  <div>{e.raw_name}</div>
                  <div className="font-mono text-[11px] text-slate-500">{e.canonical_key}</div>
                </td>
                <td className="td font-mono">{usd(e.input_per_1m)}</td>
                <td className="td font-mono">{usd(e.output_per_1m)}</td>
                <td className="td font-mono">{usd(e.image_price)}</td>
                <td className="td text-slate-400">{e.source}</td>
                <td className="td text-slate-400">{date(e.fetched_at, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!query.isLoading && entries.length === 0 && <p className="p-6 text-center text-sm text-slate-500">{t("common.noData")}</p>}
      </section>
      {query.error && <ErrorNote code={errorKey(query.error)} />}
      <LoadMore show={!!query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()} />
    </div>
  );
}
