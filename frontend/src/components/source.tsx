/**
 * Full-screen source viewer: one tab per file (+ the combined document that actually runs),
 * line numbers, syntax highlighting (lazy), wrap toggle, copy & download per file.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { useT } from "../i18n";
import { bytes } from "../lib/format";
import type { SourceFile } from "../lib/game";
import { CopyButton } from "./ui";

function useHighlighted(code: string, lang: string): string | null {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    void import("../lib/highlight").then(({ highlight }) => {
      if (!cancelled) setHtml(highlight(code, lang));
    });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);
  return html;
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SourceViewer({ files, title, onClose }: { files: SourceFile[]; title: string; onClose: () => void }) {
  const t = useT();
  const [active, setActive] = useState(0);
  const [wrap, setWrap] = useState(false);
  const file = files[Math.min(active, files.length - 1)]!;
  const html = useHighlighted(file.content, file.lang);
  const lines = useMemo(() => file.content.replace(/\n$/, "").split("\n").length, [file.content]);

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
    <div className="fixed inset-0 z-[70] flex animate-fade-in bg-slate-950/80 p-2 backdrop-blur-sm sm:p-6" onClick={onClose} role="dialog" aria-modal="true">
      <div className="flex min-h-0 w-full animate-scale-in flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 px-4 py-2.5">
          <span className="font-mono text-sm text-slate-300">&lt;/&gt;</span>
          <span className="truncate text-sm font-medium">{title}</span>
          <span className="flex-1" />
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            <input type="checkbox" className="accent-sky-500" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
            {t("source.wrap")}
          </label>
          <CopyButton text={file.content} />
          <button type="button" className="text-xs text-slate-400 hover:text-slate-200" onClick={() => download(file.name, file.content)}>
            {t("artifacts.download")}
          </button>
          <button type="button" className="btn-secondary py-1 text-xs" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
        {files.length > 1 && (
          <div className="flex gap-1 overflow-x-auto border-b border-slate-800 bg-slate-900/60 px-2 pt-1.5">
            {files.map((f, i) => (
              <button
                key={`${f.name}-${i}`}
                type="button"
                onClick={() => setActive(i)}
                className={`rounded-t-md px-3 py-1.5 font-mono text-xs whitespace-nowrap ${
                  i === active ? "border border-b-0 border-slate-700 bg-slate-950 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {f.name}
              </button>
            ))}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="flex min-w-max font-mono text-xs leading-5">
            {!wrap && (
              <pre aria-hidden className="sticky left-0 border-r border-slate-800 bg-slate-950 px-3 py-3 text-right text-slate-600 select-none">
                {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
              </pre>
            )}
            <pre className={`flex-1 px-4 py-3 text-slate-200 ${wrap ? "max-w-[calc(100vw-4rem)] break-words whitespace-pre-wrap" : ""}`}>
              {html === null ? <code>{file.content}</code> : <code className="hljs !bg-transparent !p-0" dangerouslySetInnerHTML={{ __html: html }} />}
            </pre>
          </div>
        </div>
        <div className="border-t border-slate-800 px-4 py-1.5 text-[11px] text-slate-500">
          {file.name} · {file.lang} · {t("source.lines", { n: lines })} · {bytes(new Blob([file.content]).size)}
        </div>
      </div>
    </div>,
    document.body,
  );
}
