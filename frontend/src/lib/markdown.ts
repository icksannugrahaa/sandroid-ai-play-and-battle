/**
 * Markdown → sanitized HTML for model prose. Code fences are handled separately (CodeBlock),
 * images are shown by the artifact gallery, so <img> is stripped here.
 */
import DOMPurify from "dompurify";
import { Marked } from "marked";

const marked = new Marked({ gfm: true, breaks: true, async: false });

const SAFE_HREF = /^(https?:|mailto:|#)/i;

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    const href = node.getAttribute("href") ?? "";
    if (!SAFE_HREF.test(href)) node.removeAttribute("href");
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

const DATA_URL = /data:([a-z]+\/[a-z0-9.+-]+);base64,[A-Za-z0-9+/=]+/gi;

export function renderMarkdown(text: string): string {
  // Huge base64 blobs are attachments, not prose — show a short marker instead.
  const prose = text.replace(DATA_URL, (_m, mime: string) => `\`📎 ${mime}\``);
  const html = marked.parse(prose) as string;
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ["img", "style", "iframe", "form", "input", "button", "video", "audio", "object", "embed", "svg", "math"],
    FORBID_ATTR: ["style", "class", "id"],
  });
}
