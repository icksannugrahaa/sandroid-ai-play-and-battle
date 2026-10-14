/** ⌘K / Ctrl+K command palette: jump to a page or run a quick action from the keyboard. */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useT } from "../i18n";
import { Icon, type IconName } from "./icons";

export type Command = { id: string; label: string; hint?: string; icon: IconName; run: () => void; keywords?: string };

export function CommandPalette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Command[] }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((c) => `${c.label} ${c.hint ?? ""} ${c.keywords ?? ""}`.toLowerCase().includes(needle));
  }, [q, commands]);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(0);
    requestAnimationFrame(() => input.current?.focus());
  }, [open]);
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    (list.current?.children[active] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;
  const pick = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex animate-fade-in items-start justify-center bg-slate-950/70 p-4 pt-[14vh] backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.title")}
        className="w-full max-w-lg animate-scale-in overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900/95 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.8),0_0_0_1px_rgb(255_255_255/0.03)_inset]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          else if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(shown.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(shown[active]);
          }
        }}
      >
        <div className="flex items-center gap-3 border-b border-slate-800 px-4">
          <Icon name="search" className="text-slate-500" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("palette.placeholder")}
            className="h-12 flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          <span className="kbd">Esc</span>
        </div>
        <ul ref={list} className="max-h-80 overflow-y-auto p-1.5">
          {shown.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseMove={() => setActive(i)}
                onClick={() => pick(c)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${i === active ? "bg-sky-500/15 text-white" : "text-slate-300"}`}
              >
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-colors ${i === active ? "border-sky-700/60 bg-sky-500/20 text-sky-300" : "border-slate-800 bg-slate-800/60 text-slate-400"}`}
                >
                  <Icon name={c.icon} size={14} />
                </span>
                <span className="flex-1">{c.label}</span>
                {c.hint && <span className="text-xs text-slate-500">{c.hint}</span>}
                {i === active && <Icon name="chevron" size={14} className="text-sky-400" />}
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">{t("palette.empty")}</li>}
        </ul>
        <div className="flex items-center gap-3 border-t border-slate-800 px-4 py-2 text-[11px] text-slate-500">
          <span className="flex items-center gap-1">
            <span className="kbd">↑</span>
            <span className="kbd">↓</span> {t("palette.navigate")}
          </span>
          <span className="flex items-center gap-1">
            <span className="kbd">↵</span> {t("palette.select")}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
