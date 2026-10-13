import { useEffect, useState } from "react";

import { useT } from "../i18n";
import { usePrefs } from "../stores/prefs";
import { clearSessionCache, useCacheStatus } from "../stores/sessionCache";

const HOURS = [0, 1, 3, 6, 12, 24];

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** "Keep session for N hours" — workspace survives a refresh; API keys never do. */
export function CacheSetting() {
  const t = useT();
  const hours = usePrefs((s) => s.cacheHours);
  const setHours = usePrefs((s) => s.setCacheHours);
  const { expiresAt } = useCacheStatus();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <label className="flex items-center gap-2" title={t("cache.hint")}>
        <span className="text-slate-400">{t("cache.label")}</span>
        <select
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
        >
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h === 0 ? t("cache.off") : t("cache.hours", { n: h })}
            </option>
          ))}
        </select>
      </label>
      {hours > 0 && expiresAt && expiresAt > Date.now() && (
        <span className="text-[11px] text-slate-500">{t("cache.until", { time: clock(expiresAt) })}</span>
      )}
      {hours > 0 && (
        <button type="button" className="text-[11px] text-slate-500 hover:text-rose-300" onClick={() => void clearSessionCache()}>
          {t("cache.clear")}
        </button>
      )}
      <span className="text-[11px] text-slate-500">· {t("cache.noKeys")}</span>
    </div>
  );
}
