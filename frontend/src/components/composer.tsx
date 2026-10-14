/**
 * Chat-style prompt composer: auto-growing text box, attachments (📎, drag & drop, paste),
 * mode switch and send/stop inside the box. Enter sends, Shift+Enter adds a new line.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useT } from "../i18n";
import { parseSegments } from "../lib/artifacts";
import { AttachmentError, binaryBytes, buildPrompt, LIMITS, readFiles, type Draft } from "../lib/attachments";
import { runnableFromText } from "../lib/game";
import { bytes } from "../lib/format";
import { RUNTIME_HINT } from "../lib/runtimeHint";
import { usePrefs } from "../stores/prefs";
import type { GenerationParams } from "../types";
import { CodeRunnerModal } from "./game";
import { Icon } from "./icons";
import { Field, ParamsPanel, Segmented, Switch } from "./ui";

const ICON: Record<Draft["kind"], string> = { image: "🖼", audio: "🔊", text: "📄", file: "📎" };

export type ComposerMode = "chat" | "image_gen";

export function Composer({
  text,
  onText,
  drafts,
  onDrafts,
  mode,
  onMode,
  running,
  canSend,
  onSend,
  onStop,
  sendLabel,
  footer,
}: {
  text: string;
  onText: (v: string) => void;
  drafts: Draft[];
  onDrafts: (d: Draft[]) => void;
  mode: ComposerMode;
  onMode: (m: ComposerMode) => void;
  running: boolean;
  canSend: boolean;
  onSend: () => void;
  onStop: () => void;
  sendLabel: string;
  footer?: ReactNode;
}) {
  const t = useT();
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [errors, setErrors] = useState<AttachmentError[]>([]);
  const attachable = mode === "chat";
  const [runnerOpen, setRunnerOpen] = useState(false);
  // Pasted/attached HTML or JS can simply be run here — models can't execute code.
  const runnable = useMemo(
    () => (mode === "chat" ? runnableFromText(buildPrompt(text, drafts, "chat").prompt, parseSegments) : null),
    [text, drafts, mode],
  );

  // Grow with content up to ~12 lines, then scroll.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 288)}px`;
  }, [text]);

  const add = async (files: File[]) => {
    if (!files.length || !attachable) return;
    const res = await readFiles(files, drafts);
    onDrafts([...drafts, ...res.drafts]);
    setErrors(res.errors);
  };

  const send = () => {
    if (!running && canSend) onSend();
  };

  return (
    <div className="space-y-1.5">
      <div
        className={`relative rounded-2xl border bg-slate-950/80 shadow-[0_10px_40px_-18px_rgb(0_0_0/0.9)] transition duration-200 focus-within:border-sky-600/80 focus-within:shadow-[0_0_0_4px_rgb(14_165_233/0.12),0_10px_40px_-18px_rgb(14_165_233/0.5)] ${
          dragging ? "border-sky-500 bg-sky-950/30" : "border-slate-700/80 hover:border-slate-600"
        } ${running ? "border-sky-800/70" : ""}`}
        onDragOver={(e) => {
          if (!attachable) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void add([...e.dataTransfer.files]);
        }}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-1 z-10 flex animate-fade-in items-center justify-center gap-2 rounded-xl border-2 border-dashed border-sky-500/70 bg-sky-950/70 text-sm text-sky-200 backdrop-blur-sm">
            <Icon name="upload" className="animate-float" /> {t("composer.attachHint")}
          </div>
        )}
        {drafts.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {drafts.map((d) => (
              <div key={d.id} className="group relative flex animate-scale-in items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 py-1 pr-7 pl-1 text-xs">
                {d.kind === "image" && d.dataUrl ? (
                  <img src={d.dataUrl} alt="" className="h-9 w-9 rounded object-cover" />
                ) : (
                  <span className="flex h-9 w-9 items-center justify-center rounded bg-slate-800 text-base">{ICON[d.kind]}</span>
                )}
                <div className="max-w-40 min-w-0">
                  <div className="truncate text-slate-200" title={d.name}>
                    {d.name}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {t(`composer.kind.${d.kind}`)} · {bytes(d.size)}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={t("common.remove")}
                  className="absolute top-1 right-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-700 hover:text-white"
                  onClick={() => onDrafts(drafts.filter((x) => x.id !== d.id))}
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={area}
          rows={2}
          value={text}
          placeholder={mode === "image_gen" ? t("composer.placeholderImage") : t("composer.placeholder")}
          title={t("composer.keys")}
          className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-sm leading-relaxed text-slate-100 placeholder:text-slate-500 focus:outline-none"
          onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length && attachable) {
              e.preventDefault();
              void add(files);
            }
          }}
        />
        <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
          {attachable && (
            <>
              <button
                type="button"
                title={t("composer.attachHint")}
                className="btn-ghost px-2 py-1.5 text-xs"
                onClick={() => picker.current?.click()}
              >
                <Icon name="clip" size={15} /> {t("composer.attach")}
              </button>
              <input
                ref={picker}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  void add([...(e.target.files ?? [])]);
                  e.target.value = "";
                }}
              />
            </>
          )}
          <Segmented
            size="sm"
            value={mode}
            onChange={onMode}
            options={[
              { value: "chat", label: t("mode.chat") },
              { value: "image_gen", label: t("mode.image_gen") },
            ]}
          />
          {runnable && (
            <button
              type="button"
              title={t("runner.hint")}
              className="btn animate-scale-in border border-emerald-800 bg-emerald-950/40 px-2.5 py-1.5 text-xs text-emerald-300 hover:bg-emerald-900/50"
              onClick={() => setRunnerOpen(true)}
            >
              <Icon name="play" size={12} /> {t("runner.button")}
            </button>
          )}
          <span className="flex-1" />
          <span className="hidden text-[11px] text-slate-500 xl:inline">{t("composer.keys")}</span>
          {running ? (
            <button type="button" className="btn-danger animate-scale-in py-1.5" onClick={onStop}>
              <span className="relative flex h-3 w-3 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-sm bg-white/50" />
                <Icon name="stop" size={10} className="fill-current" />
              </span>
              {t("common.stop")}
            </button>
          ) : (
            <button type="button" className="btn-primary group py-1.5 pr-2.5" disabled={!canSend} onClick={send}>
              {sendLabel}
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-white/15 transition-transform duration-200 group-hover:-translate-y-0.5">
                <Icon name="send" size={13} strokeWidth={2.4} />
              </span>
            </button>
          )}
        </div>
      </div>
      {errors.length > 0 && (
        <ul className="text-xs text-amber-300">
          {errors.map((e, i) => (
            <li key={i}>
              {e.fileName}: {t(`composer.error.${e.code}`, { max: bytes(LIMITS.binaryBytes), count: LIMITS.count })}
            </li>
          ))}
        </ul>
      )}
      {drafts.length > 0 && (
        <p className="text-[11px] text-slate-500">
          {t("composer.usage", { used: bytes(binaryBytes(drafts)), max: bytes(LIMITS.binaryBytes) })}
        </p>
      )}
      {footer}
      {runnerOpen && runnable && <CodeRunnerModal project={runnable} onClose={() => setRunnerOpen(false)} />}
    </div>
  );
}

/** System prompt + generation parameters, collapsed by default (like other chat apps). */
export function AdvancedSettings({
  system,
  onSystem,
  params,
  onParams,
  timeoutS,
  onTimeout,
  imageSize,
  onImageSize,
  mode,
  defaultOpen = false,
}: {
  defaultOpen?: boolean;
  system: string;
  onSystem: (v: string) => void;
  params: GenerationParams;
  onParams: (p: GenerationParams) => void;
  timeoutS: number;
  onTimeout: (s: number) => void;
  imageSize?: string;
  onImageSize?: (s: string) => void;
  mode: ComposerMode;
}) {
  const t = useT();
  const active = !!system.trim() || Object.values(params).some((v) => v !== undefined);
  return (
    <details className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2" open={defaultOpen}>
      <summary className="cursor-pointer text-sm text-slate-400 hover:text-slate-200">
        {t("composer.advanced")}
        {active && <span className="ml-2 badge bg-sky-950 text-sky-300">{t("composer.customized")}</span>}
      </summary>
      <div className="mt-3 space-y-3">
        {mode === "chat" ? (
          <>
            <RuntimeHintToggle />
            <Field label={`${t("playground.system")} (${t("composer.optional")})`}>
              <textarea className="input min-h-20" value={system} placeholder={t("composer.systemPlaceholder")} onChange={(e) => onSystem(e.target.value)} />
            </Field>
            <ParamsPanel params={params} onChange={onParams} timeoutS={timeoutS} onTimeout={onTimeout} />
          </>
        ) : (
          onImageSize && (
            <Field label={t("playground.imageSize")}>
              <select className="input" value={imageSize} onChange={(e) => onImageSize(e.target.value)}>
                {["256x256", "512x512", "1024x1024", "1024x1792", "1792x1024"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
          )
        )}
      </div>
    </details>
  );
}

function RuntimeHintToggle() {
  const t = useT();
  const { runtimeHint, setRuntimeHint } = usePrefs();
  return (
    <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 px-3 py-2 text-xs">
      <label className="flex items-start gap-2.5">
        <Switch checked={runtimeHint} onChange={setRuntimeHint} />
        <span>
          <span className="font-medium text-emerald-200">{t("hint.label")}</span>
          <span className="block text-slate-400">{t("hint.description")}</span>
        </span>
      </label>
      <details className="mt-1 ml-11">
        <summary className="cursor-pointer text-slate-500">{t("hint.show")}</summary>
        <p className="mt-1 font-mono text-[11px] leading-relaxed text-slate-400">{RUNTIME_HINT}</p>
      </details>
    </div>
  );
}
