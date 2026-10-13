/**
 * Composer attachments → OpenAI-compatible request parts.
 *
 *  image      → `images` (image_url parts; turns the request into vision)
 *  audio      → `attachments` kind "audio" (input_audio; providers accept WAV/MP3)
 *  text/code  → inlined into the prompt as a fenced block, so every model can read it
 *  other file → `attachments` kind "file" (file part, e.g. PDF)
 */
import type { Modality, PromptConfig } from "../types";

export type DraftKind = "image" | "audio" | "text" | "file";

export interface Draft {
  id: string;
  kind: DraftKind;
  name: string;
  size: number;
  mime: string;
  dataUrl?: string;
  text?: string;
}

export const LIMITS = {
  count: 12,
  /** images + audio + files together (the API body cap is 10 MB) */
  binaryBytes: 8 * 1024 * 1024,
  textBytes: 512 * 1024,
};

const TEXT_EXTS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "xml", "yaml", "yml", "toml", "ini", "env", "log",
  "html", "htm", "css", "scss", "js", "mjs", "cjs", "jsx", "ts", "tsx", "py", "rb", "php", "java", "kt", "go",
  "rs", "c", "h", "cpp", "hpp", "cs", "swift", "dart", "sh", "bash", "zsh", "ps1", "sql", "r", "lua", "vue", "svelte",
]);
const AUDIO_OK = new Set(["audio/wav", "audio/x-wav", "audio/wave", "audio/mpeg", "audio/mp3"]);

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

export function classify(file: { name: string; type: string }): DraftKind {
  const mime = file.type.toLowerCase();
  const ext = extOf(file.name);
  if (mime.startsWith("image/") && mime !== "image/svg+xml") return "image";
  if (mime.startsWith("audio/") || ext === "wav" || ext === "mp3") return "audio";
  if (mime.startsWith("text/") || TEXT_EXTS.has(ext) || /json|xml|javascript|yaml/.test(mime) || ext === "svg") return "text";
  return "file";
}

export class AttachmentError extends Error {
  constructor(
    public code: "too_many" | "too_large" | "audio_format" | "unreadable",
    public fileName: string,
  ) {
    super(code);
  }
}

function readAs(file: File, how: "text" | "dataUrl"): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    if (how === "text") r.readAsText(file);
    else r.readAsDataURL(file);
  });
}

function normalizeAudioMime(file: File): string {
  const ext = extOf(file.name);
  if (AUDIO_OK.has(file.type)) return file.type;
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  return file.type || "application/octet-stream";
}

export function binaryBytes(drafts: Draft[]): number {
  return drafts.filter((d) => d.kind !== "text").reduce((n, d) => n + d.size, 0);
}

/** Read files into drafts, enforcing limits. Returns accepted drafts and per-file errors. */
export async function readFiles(files: File[], existing: Draft[]): Promise<{ drafts: Draft[]; errors: AttachmentError[] }> {
  const drafts: Draft[] = [];
  const errors: AttachmentError[] = [];
  let binary = binaryBytes(existing);
  for (const file of files) {
    if (existing.length + drafts.length >= LIMITS.count) {
      errors.push(new AttachmentError("too_many", file.name));
      continue;
    }
    const kind = classify(file);
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    try {
      if (kind === "text") {
        if (file.size > LIMITS.textBytes) throw new AttachmentError("too_large", file.name);
        drafts.push({ id, kind, name: file.name, size: file.size, mime: file.type, text: await readAs(file, "text") });
        continue;
      }
      if (kind === "audio" && !AUDIO_OK.has(normalizeAudioMime(file))) throw new AttachmentError("audio_format", file.name);
      if (binary + file.size > LIMITS.binaryBytes) throw new AttachmentError("too_large", file.name);
      let dataUrl = await readAs(file, "dataUrl");
      if (kind === "audio") dataUrl = dataUrl.replace(/^data:[^;]*;/, `data:${normalizeAudioMime(file)};`);
      if (kind === "file" && dataUrl.startsWith("data:;")) dataUrl = dataUrl.replace("data:;", "data:application/octet-stream;");
      binary += file.size;
      drafts.push({ id, kind, name: file.name, size: file.size, mime: file.type, dataUrl });
    } catch (err) {
      errors.push(err instanceof AttachmentError ? err : new AttachmentError("unreadable", file.name));
    }
  }
  return { drafts, errors };
}

/** Inline a text file so any model can read it; fence long enough not to collide with its content. */
export function inlineTextFile(name: string, text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${extOf(name) || "text"} ${name}\n${text.replace(/\n$/, "")}\n${fence}`;
}

/** Composer text + drafts → the prompt fields of a run request. */
export function buildPrompt(
  text: string,
  drafts: Draft[],
  mode: "chat" | "image_gen",
): Pick<PromptConfig, "prompt" | "images" | "attachments" | "modality"> {
  const textFiles = drafts.filter((d) => d.kind === "text").map((d) => inlineTextFile(d.name, d.text ?? ""));
  const prompt = [text.trim(), ...textFiles].filter(Boolean).join("\n\n");
  if (mode === "image_gen") return { modality: "image_gen", prompt, images: [], attachments: [] };
  const images = drafts.filter((d) => d.kind === "image" && d.dataUrl).map((d) => d.dataUrl!);
  const attachments = drafts
    .filter((d) => (d.kind === "audio" || d.kind === "file") && d.dataUrl)
    .map((d) => ({ kind: d.kind as "audio" | "file", name: d.name, data_url: d.dataUrl! }));
  const modality: Modality = images.length ? "vision" : "chat";
  return { modality, prompt, images, attachments };
}

/**
 * Image endpoints take a single prompt (no chat history), so a follow-up like
 * "make it black" would be drawn from scratch. Chain the conversation's image
 * requests into one self-contained prompt instead.
 */
export function chainImagePrompt(previous: string[], current: string): string {
  if (previous.length === 0) return current;
  const changes = [...previous.slice(1), current].map((p, i) => `${i + 1}. ${p}`).join("\n");
  return `Create one image based on this request: ${previous[0]}\nThen apply these follow-up changes, in order:\n${changes}\nKeep everything else from the original request unchanged.`;
}
