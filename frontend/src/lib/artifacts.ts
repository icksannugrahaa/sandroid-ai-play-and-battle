/**
 * Finds renderable things in a model's output (pure, no DOM):
 *  - fenced code blocks  ```lang [filename] … ```  (unclosed fences count while streaming)
 *  - links / data URLs to images, video, audio, PDF, HTML, text-like and office files
 *  - images / audio the provider returned out-of-band (SSE `image` / `audio` events)
 */

export type ArtifactKind = "image" | "video" | "audio" | "pdf" | "html" | "svg" | "csv" | "json" | "code" | "text" | "file";

export interface Artifact {
  kind: ArtifactKind;
  name: string;
  ext: string;
  mime: string;
  /** https URL or data: URL */
  src?: string;
  /** inline content (code blocks) */
  content?: string;
  lang?: string;
}

export type Segment = { type: "text"; text: string } | { type: "code"; artifact: Artifact; closed: boolean };

const LANG_EXT: Record<string, string> = {
  python: "py", py: "py", javascript: "js", js: "js", jsx: "jsx", typescript: "ts", ts: "ts", tsx: "tsx",
  html: "html", htm: "html", css: "css", json: "json", csv: "csv", svg: "svg", xml: "xml", yaml: "yaml", yml: "yaml",
  bash: "sh", sh: "sh", shell: "sh", zsh: "sh", powershell: "ps1", sql: "sql", markdown: "md", md: "md",
  java: "java", go: "go", rust: "rs", rs: "rs", c: "c", cpp: "cpp", "c++": "cpp", csharp: "cs", cs: "cs",
  php: "php", ruby: "rb", rb: "rb", kotlin: "kt", swift: "swift", dart: "dart", r: "r", lua: "lua",
  toml: "toml", ini: "ini", dockerfile: "Dockerfile", text: "txt", txt: "txt", plaintext: "txt",
};

const EXT_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif",
  bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", m4v: "video/mp4", ogv: "video/ogg",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac",
  flac: "audio/flac", opus: "audio/opus", weba: "audio/webm",
  pdf: "application/pdf", html: "text/html", htm: "text/html", csv: "text/csv", json: "application/json",
  txt: "text/plain", md: "text/markdown", log: "text/plain",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip", gz: "application/gzip", tar: "application/x-tar", "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar", epub: "application/epub+zip",
};

const TEXT_EXTS = new Set(["txt", "md", "log", "py", "js", "jsx", "ts", "tsx", "css", "sh", "sql", "yaml", "yml", "xml", "java", "go", "rs", "c", "cpp", "cs", "php", "rb", "kt", "swift", "toml", "ini"]);

function kindFor(ext: string, mime: string): ArtifactKind | null {
  if (mime === "image/svg+xml") return "image";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/html") return "html";
  if (mime === "text/csv") return "csv";
  if (mime === "application/json") return "json";
  if (TEXT_EXTS.has(ext) || mime.startsWith("text/")) return "text";
  if (mime) return "file";
  return null;
}

const MIME_EXT = Object.fromEntries(Object.entries(EXT_MIME).map(([e, m]) => [m, e]));

/** Classify a URL. Unknown plain web links return null (they are just links). */
export function classifyUrl(url: string, fallbackName = "file"): Artifact | null {
  if (url.startsWith("data:")) {
    const mime = url.slice(5, url.indexOf(";")).toLowerCase() || "application/octet-stream";
    const ext = MIME_EXT[mime] ?? (mime.split("/")[1] ?? "bin").replace(/[^a-z0-9]/g, "");
    const kind = kindFor(ext, mime) ?? "file";
    return { kind, name: `${fallbackName}.${ext}`, ext, mime, src: url };
  }
  let path: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    path = decodeURIComponent(u.pathname);
  } catch {
    return null;
  }
  const last = path.split("/").filter(Boolean).pop() ?? "";
  const ext = last.includes(".") ? last.split(".").pop()!.toLowerCase() : "";
  const mime = EXT_MIME[ext] ?? (TEXT_EXTS.has(ext) ? "text/plain" : "");
  const kind = ext ? kindFor(ext, mime) : null;
  if (!kind) return null;
  return { kind, name: last, ext, mime, src: url };
}

const FENCE = /```([^\n`]*)\n([\s\S]*?)(```|$)/g;

export function codeArtifact(info: string, code: string, index: number): Artifact {
  const [langRaw = "", ...rest] = info.trim().split(/\s+/);
  const lang = langRaw.toLowerCase();
  let ext = LANG_EXT[lang] ?? (/^[a-z0-9]{1,6}$/.test(lang) ? lang : "txt");
  const named = rest.map((r) => r.replace(/^(title|file|filename)=/, "").replace(/^["']|["']$/g, "")).find((r) => /\.\w+$/.test(r));
  const trimmed = code.trimStart().toLowerCase();
  if (!lang && (trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html"))) ext = "html";
  if ((lang === "xml" || !lang) && trimmed.startsWith("<svg")) ext = "svg";
  const kind: ArtifactKind = ext === "html" ? "html" : ext === "svg" ? "svg" : ext === "csv" ? "csv" : ext === "json" ? "json" : "code";
  const name = named ?? `snippet-${index + 1}.${ext}`;
  return { kind, name, ext: named?.split(".").pop() ?? ext, mime: EXT_MIME[ext] ?? "text/plain", content: code, lang: lang || ext };
}

/** Split output into prose and code blocks. */
export function parseSegments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  let n = 0;
  FENCE.lastIndex = 0;
  for (let m = FENCE.exec(text); m; m = FENCE.exec(text)) {
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    out.push({ type: "code", artifact: codeArtifact(m[1] ?? "", m[2] ?? "", n++), closed: m[3] === "```" });
    last = m.index + m[0].length;
    if (m[0].length === 0) break;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

export const URL_RE = /(https:\/\/[^\s<>"'`)\]]+|data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+)/gi;

function trimUrl(url: string): string {
  return url.replace(/[.,;:!?]+$/, "");
}

/** Media/files referenced in prose + out-of-band images/audio. Deduplicated by source. */
export function extractArtifacts(segments: Segment[], images: string[] = [], audio: string[] = []): Artifact[] {
  const seen = new Set<string>();
  const out: Artifact[] = [];
  const add = (a: Artifact | null) => {
    if (a?.src && !seen.has(a.src)) {
      seen.add(a.src);
      out.push(a);
    }
  };
  images.forEach((src, i) => add(classifyUrl(src, `image-${i + 1}`) ?? { kind: "image", name: `image-${i + 1}.png`, ext: "png", mime: "image/png", src }));
  audio.forEach((src, i) => add(classifyUrl(src, `audio-${i + 1}`)));
  let i = 0;
  for (const seg of segments) {
    if (seg.type !== "text") continue;
    for (const match of seg.text.match(URL_RE) ?? []) add(classifyUrl(trimUrl(match), `attachment-${++i}`));
  }
  return out;
}

/** Minimal RFC-4180-ish CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string, maxRows = 200): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if ((field || row.length) && rows.length < maxRows) rows.push([...row, field]);
  return rows.filter((r) => r.some((f) => f.trim()));
}

export function dataUrlToBlob(url: string): Blob {
  const [head = "", data = ""] = url.split(",", 2);
  const mime = head.slice(5).split(";")[0] || "application/octet-stream";
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Types that are safe to open in a new tab from a blob URL (no script execution in our origin). */
export function safeToOpenInline(a: Artifact): boolean {
  return ["image", "video", "audio", "pdf", "text", "code", "csv", "json"].includes(a.kind) && a.mime !== "image/svg+xml";
}
