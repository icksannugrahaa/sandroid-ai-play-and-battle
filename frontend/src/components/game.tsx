/**
 * Runs an HTML answer (single file or html+css+js blocks) inline, automatically.
 *
 * Sandbox: allow-scripts / modals / forms / pointer-lock — NEVER allow-same-origin, so the
 * game has an opaque origin and cannot touch this app, its in-memory API keys or storage.
 * The only channel back is postMessage, accepted solely from this iframe's window and only
 * for the storage protocol below.
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useT } from "../i18n";
import { SourceViewer } from "./source";
import { bytes } from "../lib/format";
import { gameDocument, storageBytes, type GameProject } from "../lib/game";
import { useScopeUsage } from "../stores/budget";
import { gameBytes, ScopeContext, SESSION_LIMIT_BYTES, useGameStorage, type Scope } from "../stores/gameStorage";

interface StorageMessage {
  __sandroid: "game-storage";
  id: string;
  op: "set" | "remove" | "clear";
  key?: string;
  value?: string;
}

function isStorageMessage(d: unknown, gameId: string): d is StorageMessage {
  if (!d || typeof d !== "object") return false;
  const m = d as Partial<StorageMessage>;
  return (
    m.__sandroid === "game-storage" &&
    m.id === gameId &&
    (m.op === "set" || m.op === "remove" || m.op === "clear") &&
    (m.key === undefined || typeof m.key === "string") &&
    (m.value === undefined || typeof m.value === "string")
  );
}

export function GamePlayer({ project, height = "h-[26rem]" }: { project: GameProject; height?: string }) {
  const t = useT();
  const scope = useContext(ScopeContext);
  const frame = useRef<HTMLIFrameElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [runId, setRunId] = useState(0);
  const [nativeFs, setNativeFs] = useState(false);
  // Fallback when the browser refuses element fullscreen (embedded webviews, iOS Safari): fill the window.
  const [windowFs, setWindowFs] = useState(false);
  const fullscreen = nativeFs || windowFs;
  const [manualPause, setManualPause] = useState(false);
  const [visible, setVisible] = useState(true);
  // Off-screen animations pause themselves (saves CPU when 4 run side by side); fullscreen is always visible.
  const paused = manualPause || (!visible && !fullscreen);

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const sendControl = useCallback(() => {
    frame.current?.contentWindow?.postMessage({ __sandroid: "control", paused }, "*");
  }, [paused]);
  useEffect(sendControl, [sendControl]);
  const saved = useGameStorage((s) => storageBytes(s.data[scope][project.id] ?? {}));
  const [errors, setErrors] = useState<string[]>([]);
  const [showSource, setShowSource] = useState(false);
  const sourceFiles = useMemo(
    () => [...(project.files ?? []), { name: t("source.combined"), lang: "html", content: project.html }],
    [project, t],
  );
  const [showErrors, setShowErrors] = useState(false);
  useEffect(() => setErrors([]), [project.id, runId]);

  // Built once per (code, restart): storage writes must NOT reload the running game.
  const doc = useMemo(() => {
    const st = useGameStorage.getState();
    const initial = st.get(scope, project.id);
    const othersBytes = gameBytes(st.data[scope]) - storageBytes(initial);
    return gameDocument(project, initial, Math.max(0, SESSION_LIMIT_BYTES - othersBytes));
  }, [project.id, runId, scope]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const d: unknown = e.data;
      if (isStorageMessage(d, project.id)) {
        useGameStorage.getState().apply(scope, project.id, d.op, d.key, d.value);
      } else if (d && typeof d === "object" && (d as { __sandroid?: unknown }).__sandroid === "runtime-error") {
        const message = String((d as { message?: unknown }).message ?? "").slice(0, 500);
        setErrors((list) => (list.includes(message) || list.length >= 20 ? list : [...list, message]));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [project.id, scope]);

  useEffect(() => {
    const onChange = () => {
      const on = document.fullscreenElement === wrap.current;
      setNativeFs(on);
      if (on) setWindowFs(false); // a late native success wins over the fallback
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (!windowFs) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setWindowFs(false);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [windowFs]);

  const toggleFullscreen = async () => {
    if (windowFs) return setWindowFs(false);
    if (document.fullscreenElement) return void document.exitFullscreen();
    const el = wrap.current;
    // Some embedded browsers never settle the promise — give native fullscreen 400 ms, then fall back.
    const entered = el?.requestFullscreen
      ? await Promise.race([
          el.requestFullscreen().then(
            () => true,
            () => false,
          ),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 400)),
        ])
      : false;
    if (!entered || document.fullscreenElement !== el) setWindowFs(true);
    frame.current?.focus();
  };

  return (
    <div
      ref={wrap}
      className={`flex flex-col overflow-hidden border-slate-700 bg-slate-950 ${
        windowFs ? "fixed inset-0 z-[60]" : nativeFs ? "h-screen" : "rounded-md border"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-800 px-2 py-1 text-xs whitespace-nowrap">
        {paused ? (
          <span className="flex items-center gap-1.5 text-amber-300">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
            {manualPause ? t("game.paused") : t("game.pausedOffscreen")}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-emerald-300">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            {t("game.running")}
          </span>
        )}
        {saved > 0 && <span className="text-slate-500">{t("game.saved", { size: bytes(saved) })}</span>}
        {errors.length > 0 && (
          <button
            type="button"
            className="text-rose-300 hover:text-rose-200"
            title={errors[0]}
            onClick={() => setShowErrors((v) => !v)}
          >
            ⚠ {t("game.errors", { n: errors.length })}
          </button>
        )}
        <span className="flex-1" />
        <button type="button" className="font-medium text-sky-400 hover:text-sky-300" onClick={() => setShowSource(true)}>
          &lt;/&gt; {t("source.view")}
        </button>
        <button type="button" className="text-slate-400 hover:text-slate-200" onClick={() => setManualPause((v) => !v)}>
          {manualPause ? `▶ ${t("game.resume")}` : `⏸ ${t("game.pause")}`}
        </button>
        <button type="button" className="text-slate-400 hover:text-slate-200" onClick={() => setRunId((n) => n + 1)}>
          ⟳ {t("game.restart")}
        </button>
        <button type="button" className="text-slate-400 hover:text-slate-200" onClick={() => void toggleFullscreen()}>
          {fullscreen ? `✕ ${t("game.exitFullscreen")}` : `⛶ ${t("game.fullscreen")}`}
        </button>
      </div>
      {showErrors && errors.length > 0 && (
        <ul className="max-h-32 space-y-0.5 overflow-y-auto border-b border-slate-800 bg-rose-950/40 px-2 py-1 font-mono text-[11px] text-rose-200">
          {errors.map((m, i) => (
            <li key={i} className="break-all">
              {m}
            </li>
          ))}
        </ul>
      )}
      <iframe
        key={runId}
        ref={frame}
        title={project.name}
        srcDoc={doc}
        sandbox="allow-scripts allow-modals allow-forms allow-pointer-lock"
        allow="fullscreen; autoplay; gamepad"
        referrerPolicy="no-referrer"
        className={`w-full bg-white ${fullscreen ? "flex-1" : height}`}
        onLoad={() => {
          sendControl(); // a reloaded document starts unpaused — re-apply the current state
          if (!paused) frame.current?.focus();
        }}
      />
      <p className="px-2 py-1 text-[11px] text-slate-500">🔒 {t("artifacts.sandboxNote")}</p>
      {showSource && <SourceViewer files={sourceFiles} title={project.name} onClose={() => setShowSource(false)} />}
    </div>
  );
}

/** "Session storage: 3.2 MB / 50 MB" + Clear cache. */
export function StorageMeter({ scope, onClear, disabled }: { scope: Exclude<Scope, "history">; onClear: () => void; disabled?: boolean }) {
  const t = useT();
  const { used, limit, full } = useScopeUsage(scope);
  const ratio = Math.min(1, used / limit);
  const color = full ? "bg-rose-500" : ratio > 0.8 ? "bg-amber-500" : "bg-sky-600";
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3 text-xs">
        <span className="text-slate-400">{t("budget.label", { used: bytes(used), limit: bytes(limit) })}</span>
        <div className="h-1.5 max-w-40 flex-1 rounded-full bg-slate-800">
          <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${Math.max(ratio * 100, used > 0 ? 1 : 0)}%` }} />
        </div>
        <button type="button" className="text-slate-400 hover:text-rose-300 disabled:opacity-40" disabled={disabled || used === 0} onClick={onClear}>
          {t("budget.clear")}
        </button>
      </div>
      {full && <p className="text-xs text-rose-300">{t("budget.full")}</p>}
    </div>
  );
}

/** Runs code the user pasted/attached — locally in the sandbox, no AI call, no cost. */
export function CodeRunnerModal({ project, onClose }: { project: GameProject; onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);
  // Portal: an ancestor with backdrop-filter (the sticky composer) would trap `position: fixed`.
  return createPortal(
    <div className="fixed inset-0 z-[65] flex animate-fade-in bg-slate-950/80 p-2 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="flex min-h-0 w-full animate-scale-in flex-col gap-2 overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 p-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">▶ {t("runner.title")}</span>
          <span className="text-xs text-slate-500">{t("runner.subtitle")}</span>
          <span className="flex-1" />
          <button type="button" className="btn-secondary py-1 text-xs" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <GamePlayer project={project} height="h-[calc(100vh-11rem)]" />
        </div>
      </div>
    </div>,
    document.body,
  );
}
