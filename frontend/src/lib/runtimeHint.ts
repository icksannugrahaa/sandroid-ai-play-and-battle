/**
 * Tells models what this app can do with their output. Models can't run code themselves,
 * but this UI renders and executes HTML/JS blocks in a sandboxed browser — without this
 * note they answer "I don't have a browser" when asked to run or demo code.
 */
export const RUNTIME_HINT = [
  "[Environment] This chat interface has a built-in browser sandbox.",
  "Any complete HTML document you put in a ```html code block is rendered and executed live for the user, right under your message",
  "(it may load libraries from CDNs such as jsDelivr, unpkg or cdnjs; it can also be split into ```html, ```css and ```javascript blocks named by filename, e.g. ```javascript game.js).",
  "JavaScript-only answers that draw with canvas, p5.js, three.js, GSAP, D3 or Chart.js are also wrapped into a page and run automatically.",
  "So when the user asks you to run, preview, test or demo code (including code they paste), reply with the complete, self-contained runnable code in such a block instead of saying you cannot run code.",
  "You cannot see the rendered result or console yourself; runtime errors are shown to the user, who may paste them back to you.",
].join(" ");

/** System prompt actually sent: the runtime note (optional) followed by the user's own system prompt. */
export function effectiveSystem(userSystem: string, withHint: boolean): string | undefined {
  const parts = [withHint ? RUNTIME_HINT : "", userSystem.trim()].filter(Boolean);
  return parts.length ? parts.join("\n\n") : undefined;
}

/** History entries store what was sent — drop the note again when reopening them in the editor. */
export function stripRuntimeHint(system: string | undefined): string {
  return (system ?? "").replace(RUNTIME_HINT, "").trim();
}
