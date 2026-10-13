/**
 * Renders model output richly: prose with links, code blocks (copy / download / preview),
 * and a gallery of media & files (image, video, audio, PDF, HTML, CSV, JSON, text, office…).
 *
 * SECURITY: model output is untrusted. HTML runs only inside <iframe sandbox="allow-scripts">
 * WITHOUT allow-same-origin (opaque origin → no access to this app, its memory-held keys or
 * storage). SVG is shown via <img> (scripts never run). HTML/SVG are never opened as blob URLs
 * in a new tab, because a blob URL would inherit this app's origin.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useT } from "../i18n";
import {
  dataUrlToBlob,
  extractArtifacts,
  parseCsv,
  parseSegments,
  safeToOpenInline,
  type Artifact,
} from "../lib/artifacts";
import { buildProject, type GameProject } from "../lib/game";
import { renderMarkdown } from "../lib/markdown";
import { GamePlayer } from "./game";
import { SourceViewer } from "./source";
import { CopyButton } from "./ui";

const MAX_REMOTE_PREVIEW = 2 * 1024 * 1024;

/** Blob URL for inline content or a data: URL; revoked on unmount. https URLs pass through. */
function useObjectUrl(a: Artifact): string | undefined {
  const url = useMemo(() => {
    if (a.content !== undefined) return URL.createObjectURL(new Blob([a.content], { type: a.mime }));
    if (a.src?.startsWith("data:")) {
      try {
        return URL.createObjectURL(dataUrlToBlob(a.src));
      } catch {
        return undefined;
      }
    }
    return a.src;
  }, [a.content, a.src, a.mime]);
  useEffect(() => () => void (url?.startsWith("blob:") && URL.revokeObjectURL(url)), [url]);
  return url;
}

/** Fetch remote text on demand (never automatically). */
function useRemoteText(src: string | undefined, enabled: boolean) {
  const [state, setState] = useState<{ text?: string; error?: boolean; loading?: boolean }>({});
  useEffect(() => {
    if (!enabled || !src || state.text !== undefined || state.loading) return;
    setState({ loading: true });
    fetch(src, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const text = await r.text();
        setState({ text: text.slice(0, MAX_REMOTE_PREVIEW) });
      })
      .catch(() => setState({ error: true }));
  }, [enabled, src, state.text, state.loading]);
  return state;
}

function SandboxedHtml({ html, height = "h-80" }: { html: string; height?: string }) {
  const t = useT();
  return (
    <div>
      <iframe
        title="html-preview"
        sandbox="allow-scripts allow-modals allow-forms"
        srcDoc={html}
        referrerPolicy="no-referrer"
        className={`${height} w-full rounded-md border border-slate-700 bg-white`}
      />
      <p className="mt-1 text-[11px] text-slate-500">🔒 {t("artifacts.sandboxNote")}</p>
    </div>
  );
}

function CsvTable({ text }: { text: string }) {
  const rows = useMemo(() => parseCsv(text), [text]);
  return <Grid rows={rows} />;
}

function Grid({ rows }: { rows: string[][] }) {
  const t = useT();
  const [head, ...body] = rows;
  if (!head) return null;
  return (
    <div className="max-h-80 overflow-auto rounded-md border border-slate-800">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-slate-900">
          <tr>{head.map((h, i) => <th key={i} className="th">{h}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className="border-t border-slate-900">
              {r.map((c, j) => <td key={j} className="td">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-2 py-1 text-[11px] text-slate-500">{t("artifacts.rows", { n: body.length })}</p>
    </div>
  );
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Visual preview for any artifact given its text (if text-like) and URL. */
function Preview({ a, url, text }: { a: Artifact; url?: string; text?: string }) {
  const t = useT();
  switch (a.kind) {
    case "image":
      return url ? <img src={url} alt={a.name} loading="lazy" referrerPolicy="no-referrer" className="max-h-96 rounded-md border border-slate-800" /> : null;
    case "svg":
      return url ? <img src={url} alt={a.name} className="max-h-96 rounded-md border border-slate-800 bg-white p-2" /> : null;
    case "video":
      return url ? <video src={url} controls preload="metadata" className="max-h-96 w-full rounded-md bg-black" /> : null;
    case "audio":
      return url ? <audio src={url} controls preload="metadata" className="w-full" /> : null;
    case "pdf":
      return url ? <iframe title={a.name} src={url} className="h-[28rem] w-full rounded-md border border-slate-800 bg-white" /> : null;
    case "html":
      return text !== undefined ? <SandboxedHtml html={text} /> : null;
    case "csv":
      return text !== undefined ? <CsvTable text={text} /> : null;
    case "json":
    case "text":
    case "code":
      return text !== undefined ? (
        <pre className="max-h-80 overflow-auto rounded-md bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-200">
          {a.kind === "json" ? prettyJson(text) : text}
        </pre>
      ) : null;
    default:
      return <p className="text-xs text-slate-500">{t("artifacts.noPreview")}</p>;
  }
}

const OFFICE_PREVIEW = new Set(["docx", "xlsx"]);
const MAX_OFFICE_BYTES = 20 * 1024 * 1024;

/**
 * Word (.docx) and Excel (.xlsx) previews. Libraries load only when asked.
 * DOCX is rendered into a sandboxed iframe WITHOUT allow-scripts, so nothing in the
 * document can execute. PPTX/XLS/DOC have no reliable in-browser renderer → open/download.
 */
function OfficePreview({ a }: { a: Artifact }) {
  const t = useT();
  const frame = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<{ loading: boolean; error?: boolean; rows?: string[][] }>({ loading: true });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let blob: Blob;
        if (a.src?.startsWith("data:")) blob = dataUrlToBlob(a.src);
        else {
          const r = await fetch(a.src ?? "", { credentials: "omit", referrerPolicy: "no-referrer" });
          if (!r.ok) throw new Error(String(r.status));
          blob = await r.blob();
        }
        if (blob.size > MAX_OFFICE_BYTES) throw new Error("too large");
        if (a.ext === "docx") {
          const { renderAsync } = await import("docx-preview");
          const doc = frame.current?.contentDocument;
          if (!doc || cancelled) return;
          doc.body.innerHTML = "";
          await renderAsync(blob, doc.body, doc.head, { inWrapper: true, ignoreLastRenderedPageBreak: true });
          if (!cancelled) setState({ loading: false });
        } else {
          const { readSheet } = await import("read-excel-file/browser");
          const data = await readSheet(blob);
          const rows = data.slice(0, 200).map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c))));
          if (!cancelled) setState({ loading: false, rows });
        }
      } catch {
        if (!cancelled) setState({ loading: false, error: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [a.src, a.ext]);

  return (
    <div>
      {state.loading && <p className="text-xs text-slate-500">{t("common.loading")}</p>}
      {state.error && <p className="text-xs text-amber-300">{t("artifacts.previewFailed")}</p>}
      {a.ext === "docx" ? (
        <iframe
          ref={frame}
          title={a.name}
          sandbox="allow-same-origin"
          className={`h-[28rem] w-full rounded-md border border-slate-800 bg-white ${state.error ? "hidden" : ""}`}
        />
      ) : (
        state.rows && <Grid rows={state.rows} />
      )}
    </div>
  );
}

const ICON: Record<Artifact["kind"], string> = {
  image: "🖼", svg: "🖼", video: "🎬", audio: "🔊", pdf: "📕", html: "🌐", csv: "📊", json: "🧾", code: "⌨", text: "📄", file: "📦",
};

function ActionLink({ href, download, children }: { href: string; download?: string; children: ReactNode }) {
  return (
    <a href={href} download={download} target={download ? undefined : "_blank"} rel="noopener noreferrer" className="text-xs text-slate-400 hover:text-slate-200">
      {children}
    </a>
  );
}

/** A file/media found in the output (link, data URL, or provider-returned media). */
export function ArtifactCard({ a }: { a: Artifact }) {
  const t = useT();
  const url = useObjectUrl(a);
  const remote = !!a.src?.startsWith("https://");
  const textLike = ["html", "csv", "json", "text"].includes(a.kind);
  const office = a.kind === "file" && OFFICE_PREVIEW.has(a.ext);
  const autoMedia = ["image", "video", "audio", "pdf"].includes(a.kind);
  const [show, setShow] = useState(autoMedia);
  // Inline (data:) text decodes locally; remote text is fetched only when asked.
  const inlineText = useMemo(() => {
    if (!textLike || !a.src?.startsWith("data:")) return undefined;
    try {
      return new TextDecoder().decode(new Uint8Array(atob(a.src.split(",", 2)[1] ?? "").split("").map((c) => c.charCodeAt(0))));
    } catch {
      return undefined;
    }
  }, [a.src, textLike]);
  const remoteText = useRemoteText(a.src, textLike && remote && show);
  const text = inlineText ?? remoteText.text;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
      <div className="mb-2 flex items-center gap-2">
        <span aria-hidden>{ICON[a.kind]}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-slate-300" title={a.name}>
          {a.name}
        </span>
        {!autoMedia && (a.kind !== "file" || office) && (
          <button type="button" className="text-xs text-sky-400 hover:text-sky-300" onClick={() => setShow((v) => !v)}>
            {show ? t("artifacts.hide") : t("artifacts.preview")}
          </button>
        )}
        {url && (remote || safeToOpenInline(a)) && <ActionLink href={url}>{t("artifacts.open")}</ActionLink>}
        {url && !remote && <ActionLink href={url} download={a.name}>{t("artifacts.download")}</ActionLink>}
      </div>
      {show && (
        <>
          {remoteText.loading && <p className="text-xs text-slate-500">{t("common.loading")}</p>}
          {remoteText.error && <p className="text-xs text-amber-300">{t("artifacts.previewFailed")}</p>}
          {office ? <OfficePreview a={a} /> : <Preview a={a} url={url} text={text} />}
        </>
      )}
    </div>
  );
}

/** Plain text first; highlight.js (+ its theme) is loaded lazily the first time code appears. */
function HighlightedCode({ code, lang }: { code: string; lang?: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import("../lib/highlight").then(({ highlight }) => {
      if (!cancelled) setHtml(highlight(code, lang));
    });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);
  // highlight() escapes all input; its output contains only hljs <span> markup.
  return html === null ? <code>{code}</code> : <code className="hljs !bg-transparent !p-0" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Fenced code block: copy, download as a file, and live preview for html/svg/csv/json. */
function CodeBlock({ a, closed, live, game }: { a: Artifact; closed: boolean; live?: boolean; game?: GameProject | null }) {
  const t = useT();
  const url = useObjectUrl(a);
  const previewable = !!game || ["html", "svg", "csv", "json"].includes(a.kind);
  // "auto": runnable things (html, svg, playable js) show their result, data shows code.
  const [choice, setChoice] = useState<"auto" | "code" | "preview">("auto");
  const mode = choice !== "auto" ? choice : game || a.kind === "html" || a.kind === "svg" ? "preview" : "code";
  const setMode = (m: "code" | "preview") => setChoice(m);
  // HTML waits for the whole answer (see RichText); other previews only need their own block closed.
  const showPreview = previewable && mode === "preview" && closed && !(a.kind === "html" && live);
  const waitingToRun = a.kind === "html" && closed && live;
  const [sourceOpen, setSourceOpen] = useState(false);
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
      <div className="flex items-center gap-3 border-b border-slate-800 bg-slate-900/70 px-3 py-1">
        <span className="font-mono text-[11px] text-slate-400">{a.name}</span>
        <span className="flex-1" />
        {previewable && closed && (
          <button type="button" className="text-xs text-sky-400 hover:text-sky-300" onClick={() => setMode(mode === "code" ? "preview" : "code")}>
            {mode === "code" ? t("artifacts.preview") : t("artifacts.code")}
          </button>
        )}
        {closed && (
          <button type="button" className="text-xs text-slate-400 hover:text-slate-200" onClick={() => setSourceOpen(true)}>
            &lt;/&gt; {t("source.view")}
          </button>
        )}
        <CopyButton text={a.content ?? ""} />
        {url && (
          <a href={url} download={a.name} className="text-xs text-slate-400 hover:text-slate-200">
            {t("artifacts.download")}
          </a>
        )}
      </div>
      {waitingToRun && <p className="border-b border-slate-800 px-3 py-1 text-[11px] text-sky-300">▶ {t("game.startsWhenDone")}</p>}
      {showPreview ? (
        <div className="p-2">{game ? <GamePlayer project={game} /> : <Preview a={a} url={url} text={a.content} />}</div>
      ) : (
        <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-slate-200">
          <HighlightedCode code={a.content ?? ""} lang={a.lang} />
        </pre>
      )}
      {sourceOpen && (
        <SourceViewer
          files={game?.files ? [...game.files, { name: t("source.combined"), lang: "html", content: game.html }] : [{ name: a.name, lang: a.lang ?? a.ext, content: a.content ?? "" }]}
          title={a.name}
          onClose={() => setSourceOpen(false)}
        />
      )}
    </div>
  );
}

/** Prose + inline code blocks. Use inside the scrollable output box. */
export function RichText({ text, cursor }: { text: string; cursor?: boolean }) {
  const segments = useMemo(() => parseSegments(text), [text]);
  // The first HTML block auto-runs as an app/game (sibling CSS/JS merged in) as soon as THIS
  // answer finishes — never half-streamed, so later style.css/game.js blocks are included.
  const live = !!cursor;
  const game = useMemo(() => (live ? null : buildProject(segments)), [segments, live]);
  // The player sits on the HTML block, or — for JS-only answers — on the first JavaScript block.
  const htmlIndex = segments.findIndex((x) => x.type === "code" && x.closed && x.artifact.kind === "html");
  const entryIndex =
    htmlIndex !== -1
      ? htmlIndex
      : segments.findIndex((x) => x.type === "code" && x.closed && (x.artifact.ext === "js" || x.artifact.ext === "mjs" || x.artifact.lang === "javascript"));
  return (
    <div className="text-sm leading-relaxed text-slate-100">
      {segments.map((s, i) =>
        s.type === "text" ? (
          // Sanitized by DOMPurify in renderMarkdown (no scripts, styles, images or unsafe links).
          <div key={i} className="md break-words" dangerouslySetInnerHTML={{ __html: renderMarkdown(s.text) }} />
        ) : (
          <CodeBlock key={i} a={s.artifact} closed={s.closed} live={live} game={i === entryIndex ? game : null} />
        ),
      )}
      {cursor && <span className="ml-0.5 animate-pulse text-sky-400">▍</span>}
    </div>
  );
}

/** Media & files referenced by the output, plus provider-returned images/audio. */
export function ArtifactGallery({ text, images, audio }: { text: string; images: string[]; audio?: string[] }) {
  const t = useT();
  const artifacts = useMemo(() => extractArtifacts(parseSegments(text), images, audio ?? []), [text, images, audio]);
  if (artifacts.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-[11px] tracking-wide text-slate-500 uppercase">{t("artifacts.title", { n: artifacts.length })}</p>
      <div className="grid gap-2">
        {artifacts.map((a) => (
          <ArtifactCard key={a.src} a={a} />
        ))}
      </div>
    </div>
  );
}

/** Your own message as a chat bubble. Messages with code get full width and no height cap,
 *  so pasted apps/games run visibly instead of being clipped. */
export function UserBubble({ text }: { text: string }) {
  const hasCode = text.includes("```") || /^\s*<(!doctype|html)/i.test(text);
  return (
    <div
      className={`ml-auto rounded-2xl rounded-br-md bg-sky-900/40 px-4 py-2.5 ${hasCode ? "w-full" : "w-fit max-w-[85%]"}`}
    >
      <div className={hasCode ? "" : "max-h-80 overflow-y-auto"}>
        <RichText text={text} />
      </div>
    </div>
  );
}
