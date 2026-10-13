/** Session usage (this workspace, this tab): runs, models, tokens and estimated cost. Memory-only. */
import { useState } from "react";

import { useT } from "../i18n";
import { usd } from "../lib/format";
import type { ModelUsage, UsageTally } from "../stores/runs";

function compact(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 10_000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString();
}

function costText(u: Pick<ModelUsage, "cost" | "pricedRuns" | "approx">): string {
  if (u.pricedRuns === 0) return "–";
  return `${u.approx ? "≈" : ""}${usd(u.cost)}`;
}

export function UsageSummary({ usage, onReset }: { usage: UsageTally; onReset: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rows = Object.values(usage).sort((a, b) => b.cost - a.cost || b.completionTokens - a.completionTokens);
  if (rows.length === 0) return null;
  const sum = rows.reduce(
    (acc, r) => ({
      runs: acc.runs + r.runs,
      inTok: acc.inTok + r.promptTokens,
      outTok: acc.outTok + r.completionTokens,
      cost: acc.cost + r.cost,
      pricedRuns: acc.pricedRuns + r.pricedRuns,
      approx: acc.approx || r.approx,
      estimated: acc.estimated || r.estimatedTokens,
    }),
    { runs: 0, inTok: 0, outTok: 0, cost: 0, pricedRuns: 0, approx: false, estimated: false },
  );
  const unpriced = sum.runs - sum.pricedRuns;

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 text-xs">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
        <span className="font-medium text-slate-300">{t("usage.title")}</span>
        <span className="text-slate-400">{t("usage.runs", { n: sum.runs })}</span>
        <span className="text-slate-400">{t("usage.models", { n: rows.length })}</span>
        <span className="font-mono text-slate-300" title={t("usage.tokensHint")}>
          {compact(sum.inTok + sum.outTok)} {t("usage.tokens")}{" "}
          <span className="text-slate-500">
            ({t("usage.in")} {compact(sum.inTok)} / {t("usage.out")} {compact(sum.outTok)})
          </span>
          {sum.estimated && "*"}
        </span>
        <span className="font-mono text-emerald-300" title={t("notice.estimated")}>
          {costText({ cost: sum.cost, pricedRuns: sum.pricedRuns, approx: sum.approx })}
        </span>
        {unpriced > 0 && <span className="text-amber-300/80">{t("usage.unpriced", { n: unpriced })}</span>}
        <span className="flex-1" />
        <button type="button" className="text-sky-400 hover:text-sky-300" onClick={() => setOpen((v) => !v)}>
          {open ? t("artifacts.hide") : t("usage.details")}
        </button>
        <button type="button" className="text-slate-500 hover:text-rose-300" onClick={onReset}>
          {t("usage.reset")}
        </button>
      </div>
      {open && (
        <div className="overflow-x-auto border-t border-slate-800">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">{t("common.model")}</th>
                <th className="th text-right">{t("usage.runsCol")}</th>
                <th className="th text-right">{t("usage.in")}</th>
                <th className="th text-right">{t("usage.out")}</th>
                <th className="th text-right">{t("metrics.cost")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.model} className="border-t border-slate-900">
                  <td className="td max-w-72 truncate" title={r.model}>
                    {r.model}
                  </td>
                  <td className="td text-right font-mono">
                    {r.runs}
                    {r.failed > 0 && <span className="text-rose-300"> ({t("usage.failed", { n: r.failed })})</span>}
                  </td>
                  <td className="td text-right font-mono">{compact(r.promptTokens)}</td>
                  <td className="td text-right font-mono">
                    {compact(r.completionTokens)}
                    {r.estimatedTokens && "*"}
                  </td>
                  <td className="td text-right font-mono">{costText(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-1.5 text-[11px] text-slate-500">{t("usage.footnote")}</p>
        </div>
      )}
    </section>
  );
}

/** One-line usage hint for the chat settings bar. */
export function UsageMini({ usage }: { usage: UsageTally }) {
  const t = useT();
  const rows = Object.values(usage);
  if (rows.length === 0) return null;
  const runs = rows.reduce((n, r) => n + r.runs, 0);
  const tokens = rows.reduce((n, r) => n + r.promptTokens + r.completionTokens, 0);
  const priced = rows.reduce((n, r) => n + r.pricedRuns, 0);
  const cost = rows.reduce((n, r) => n + r.cost, 0);
  const approx = rows.some((r) => r.approx);
  return (
    <span className="text-[11px] whitespace-nowrap text-slate-400" title={t("usage.title")}>
      {t("usage.runs", { n: runs })} · <span className="font-mono">{compact(tokens)}</span> {t("usage.tokens")}
      {priced > 0 && (
        <>
          {" "}
          · <span className="font-mono text-emerald-300">{costText({ cost, pricedRuns: priced, approx })}</span>
        </>
      )}
    </span>
  );
}
