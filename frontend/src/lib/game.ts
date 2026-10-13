/**
 * Turns code blocks from a model answer into one runnable HTML document (pure).
 *
 *  - one ```html block is the entry point
 *  - <script src="game.js"> / <link href="style.css"> that reference other blocks by
 *    filename are inlined; otherwise unreferenced JS/CSS blocks are appended when the
 *    HTML has no scripts/styles of its own (the usual "three separate files" answer)
 *  - a storage shim is injected first, because the sandbox (no allow-same-origin) has no
 *    localStorage/sessionStorage/cookies: games keep working, data goes to the parent app
 */
import type { Artifact, Segment } from "./artifacts";

export interface SourceFile {
  name: string;
  lang: string;
  content: string;
}

export interface GameProject {
  html: string;
  name: string;
  /** stable id: same code → same saved game data */
  id: string;
  /** the original blocks the page was built from (for the source viewer) */
  files?: SourceFile[];
}

function sourceFile(a: Artifact): SourceFile {
  return { name: a.name, lang: a.lang ?? a.ext, content: a.content ?? "" };
}

const SCRIPT_SRC = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi;
const LINK_CSS = /<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi;
const HREF = /\bhref=["']([^"']+)["']/i;

function basename(path: string): string {
  return path.split(/[?#]/)[0]!.split("/").pop()!.toLowerCase();
}

/** Escape a block so it cannot close its own <script>/<style> early. */
function inlineScript(code: string): string {
  return `<script>\n${code.replace(/<\/script/gi, "<\\/script")}\n</script>`;
}
function inlineStyle(code: string): string {
  return `<style>\n${code.replace(/<\/style/gi, "<\\/style")}\n</style>`;
}

function insertBefore(html: string, tag: "</head>" | "</body>", chunk: string): string {
  const i = html.toLowerCase().lastIndexOf(tag);
  if (i !== -1) return html.slice(0, i) + chunk + "\n" + html.slice(i);
  return tag === "</head>" ? chunk + "\n" + html : html + "\n" + chunk;
}

export function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function buildProject(segments: Segment[]): GameProject | null {
  const blocks = segments.flatMap((s) => (s.type === "code" && s.closed ? [s.artifact] : []));
  const entry = blocks.find((b) => b.kind === "html");
  if (!entry?.content) return synthesizeFromScripts(blocks);
  const isJs = (b: Artifact) => ["js", "mjs", "jsx"].includes(b.ext) || b.lang === "javascript";
  const isCss = (b: Artifact) => b.ext === "css";
  const js = blocks.filter(isJs);
  const css = blocks.filter(isCss);
  const byName = new Map([...js, ...css].map((b) => [b.name.toLowerCase(), b]));
  const used = new Set<Artifact>();

  let html = entry.content.replace(SCRIPT_SRC, (tag, src: string) => {
    const b = byName.get(basename(src));
    if (!b || !isJs(b)) return tag; // CDN or unknown → keep as-is
    used.add(b);
    return inlineScript(b.content ?? "");
  });
  html = html.replace(LINK_CSS, (tag) => {
    const href = HREF.exec(tag)?.[1];
    const b = href ? byName.get(basename(href)) : undefined;
    if (!b || !isCss(b)) return tag;
    used.add(b);
    return inlineStyle(b.content ?? "");
  });

  const rest = (list: Artifact[]) => list.filter((b) => !used.has(b));
  if (!/<style\b/i.test(html)) for (const b of rest(css)) html = insertBefore(html, "</head>", inlineStyle(b.content ?? ""));
  if (!/<script\b(?![^>]*\bsrc=)/i.test(html)) for (const b of rest(js)) html = insertBefore(html, "</body>", inlineScript(b.content ?? ""));

  const files = [entry, ...css, ...js].map(sourceFile);
  return { html, name: entry.name, id: hashString(html), files };
}

// --------------------------------------------------------------------------- JS-only answers
/** Visual/browser code worth running. Plain utility snippets are left as code. */
const VISUAL =
  /\bdocument\.|\bgetContext\s*\(|requestAnimationFrame|\bcreateCanvas\s*\(|function\s+(setup|draw)\s*\(|\bnew\s+p5\b|\bTHREE\b|from\s+["'](three|gsap|d3|animejs)|\bgsap\.|\banime\s*\(|\bd3\.|\bMatter\.|\bnew\s+Chart\s*\(|\bwindow\.inner(Width|Height)/;
/** Node.js code cannot run in a browser page. */
const NODE_ONLY = /\brequire\s*\(|\bprocess\.(env|argv|exit)|\bmodule\.exports|from\s+["'](fs|path|http|https|child_process|node:[\w/]+)["']/;
const ES_MODULE = /^\s*(import\s[^(]|export\s)/m;

/** Classic (global) builds, loaded when the code uses the global without importing it. */
const GLOBAL_LIBS: { uses: RegExp; imported: RegExp; src: string }[] = [
  { uses: /function\s+(setup|draw)\s*\(|\bnew\s+p5\b|\bcreateCanvas\s*\(/, imported: /from\s+["']p5["']/, src: "https://cdn.jsdelivr.net/npm/p5@1.11.3/lib/p5.min.js" },
  { uses: /\bTHREE\./, imported: /from\s+["']three["']/, src: "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js" },
  { uses: /\bgsap\./, imported: /from\s+["']gsap["']/, src: "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js" },
  { uses: /\banime\s*\(/, imported: /from\s+["']animejs["']/, src: "https://cdn.jsdelivr.net/npm/animejs@3.2.2/lib/anime.min.js" },
  { uses: /\bd3\./, imported: /from\s+["']d3["']/, src: "https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js" },
  { uses: /\bMatter\./, imported: /from\s+["']matter-js["']/, src: "https://cdn.jsdelivr.net/npm/matter-js@0.20.0/build/matter.min.js" },
  { uses: /\bnew\s+Chart\s*\(/, imported: /from\s+["']chart\.js/, src: "https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js" },
];

/** Bare module specifiers resolved for `<script type="module">`. */
const IMPORT_MAP: Record<string, string> = {
  three: "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/",
  "three/examples/jsm/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/",
  gsap: "https://cdn.jsdelivr.net/npm/gsap@3.12.5/index.js",
  d3: "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm",
  animejs: "https://cdn.jsdelivr.net/npm/animejs@3.2.2/lib/anime.es.js",
  "chart.js": "https://cdn.jsdelivr.net/npm/chart.js@4.4.7/+esm",
  "matter-js": "https://cdn.jsdelivr.net/npm/matter-js@0.20.0/+esm",
  p5: "https://cdn.jsdelivr.net/npm/p5@1.11.3/+esm",
};

const ELEMENT_ID = /getElementById\(\s*["']([\w-]+)["']\s*\)|querySelector\(\s*["']#([\w-]+)["']\s*\)/g;

function referencedElements(code: string): string {
  const ids = new Set<string>();
  for (const m of code.matchAll(ELEMENT_ID)) ids.add((m[1] ?? m[2])!);
  const usesContext = /getContext\s*\(/.test(code);
  return [...ids]
    .map((id) =>
      /canvas|cnv|stage|screen|game/i.test(id) || (usesContext && ids.size === 1)
        ? `<canvas id="${id}" width="800" height="600"></canvas>`
        : `<div id="${id}"></div>`,
    )
    .join("\n");
}

/** Wrap JavaScript (+ CSS) blocks without an HTML page into a runnable page. */
export function synthesizeFromScripts(blocks: Artifact[]): GameProject | null {
  const js = blocks.filter((b) => (["js", "mjs"].includes(b.ext) || b.lang === "javascript") && b.content);
  const code = js.map((b) => b.content!).join("\n;\n");
  if (!code.trim() || !VISUAL.test(code) || NODE_ONLY.test(code)) return null;
  const css = blocks.filter((b) => b.ext === "css" && b.content).map((b) => inlineStyle(b.content!));
  const isModule = ES_MODULE.test(code);
  const libs = GLOBAL_LIBS.filter((l) => l.uses.test(code) && !(isModule && l.imported.test(code))).map(
    (l) => `<script src="${l.src}"></script>`,
  );
  const importMap = isModule ? `<script type="importmap">${JSON.stringify({ imports: IMPORT_MAP })}</script>` : "";
  const scripts = js.map((b) =>
    isModule ? `<script type="module">\n${(b.content ?? "").replace(/<\/script/gi, "<\\/script")}\n</script>` : inlineScript(b.content ?? ""),
  );
  const html = [
    "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
    "<style>html,body{margin:0;height:100%}canvas{display:block;max-width:100%}</style>",
    ...css,
    importMap,
    ...libs,
    "</head><body>",
    referencedElements(code),
    ...scripts,
    "</body></html>",
  ].join("\n");
  const files = [...js, ...blocks.filter((b) => b.ext === "css" && b.content)].map(sourceFile);
  return { html, name: js[0]!.name, id: hashString(html), files };
}

/**
 * In-iframe replacement for localStorage/sessionStorage/document.cookie.
 * Writes are mirrored to the parent via postMessage; quota mirrors the session budget.
 */
export function storageShim(gameId: string, initial: Record<string, string>, quotaBytes: number): string {
  const boot = JSON.stringify({ id: gameId, data: initial, quota: Math.max(0, Math.floor(quotaBytes)) }).replace(/</g, "\\u003c");
  return `<script>(function(){
var B=${boot},d=B.data,used=0,k;for(k in d)used+=k.length+d[k].length;
function post(op,key,val){try{parent.postMessage({__sandroid:"game-storage",id:B.id,op:op,key:key,value:val},"*")}catch(e){}}
function mk(persist){var m=persist?d:{},s={
getItem:function(x){x=String(x);return Object.prototype.hasOwnProperty.call(m,x)?m[x]:null},
setItem:function(x,v){x=String(x);v=String(v);var old=Object.prototype.hasOwnProperty.call(m,x)?x.length+m[x].length:0,next=used-old+x.length+v.length;
if(persist&&next>B.quota)throw new DOMException("Sandroid session storage is full (50 MB). Clear cache in the app.","QuotaExceededError");
if(persist)used=next;m[x]=v;if(persist)post("set",x,v)},
removeItem:function(x){x=String(x);if(!Object.prototype.hasOwnProperty.call(m,x))return;if(persist)used-=x.length+m[x].length;delete m[x];if(persist)post("remove",x)},
clear:function(){for(var y in m)delete m[y];if(persist){used=0;post("clear")}},
key:function(i){return Object.keys(m)[i]||null}};
Object.defineProperty(s,"length",{get:function(){return Object.keys(m).length}});return s}
var ls=mk(true),ss=mk(false),jar="";
try{Object.defineProperty(window,"localStorage",{value:ls,configurable:true})}catch(e){}
try{Object.defineProperty(window,"sessionStorage",{value:ss,configurable:true})}catch(e){}
try{Object.defineProperty(document,"cookie",{get:function(){return jar},set:function(v){jar=String(v).split(";")[0]},configurable:true})}catch(e){}
})();</script>`;
}

/**
 * In-iframe pause/resume, driven by the parent ({__sandroid:"control", paused}), plus
 * runtime error reporting ({__sandroid:"runtime-error"}) so broken AI code is visible. Holds back
 * requestAnimationFrame / setTimeout callbacks, skips setInterval ticks, pauses CSS
 * animations, media elements and Web Audio — so off-screen animations stop burning CPU
 * without losing their state.
 */
export function controlShim(): string {
  return `<script>(function(){
var P=false,rq=[],tq=[],media=[],ctxs=[],css=document.createElement("style");
css.textContent="*,*::before,*::after{animation-play-state:paused!important}";
var raf=window.requestAnimationFrame.bind(window),st=window.setTimeout.bind(window),si=window.setInterval.bind(window);
window.requestAnimationFrame=function(cb){return raf(function(t){P?rq.push(cb):cb(t)})};
window.setTimeout=function(fn,ms){var a=[].slice.call(arguments,2);if(typeof fn!=="function")return st.apply(window,arguments);
return st(function run(){P?tq.push(run):fn.apply(window,a)},ms)};
window.setInterval=function(fn,ms){var a=[].slice.call(arguments,2);if(typeof fn!=="function")return si.apply(window,arguments);
return si(function(){if(!P)fn.apply(window,a)},ms)};
["AudioContext","webkitAudioContext"].forEach(function(n){var C=window[n];if(!C)return;
var W=function(){var c=new (Function.prototype.bind.apply(C,[null].concat([].slice.call(arguments))))();ctxs.push(c);return c};
W.prototype=C.prototype;window[n]=W});
function set(p){if(p===P)return;P=p;
if(P){(document.head||document.documentElement).appendChild(css);
media=[].slice.call(document.querySelectorAll("video,audio")).filter(function(m){return!m.paused});media.forEach(function(m){m.pause()});
ctxs.forEach(function(c){if(c.state==="running")c.suspend()})}
else{css.remove();media.forEach(function(m){m.play().catch(function(){})});media=[];
ctxs.forEach(function(c){if(c.state==="suspended")c.resume()});
var r=rq;rq=[];r.forEach(function(cb){raf(cb)});var t=tq;tq=[];t.forEach(function(f){st(f,0)})}}
addEventListener("message",function(e){if(e.source!==parent)return;var d=e.data;if(d&&d.__sandroid==="control")set(!!d.paused)});
var sent=0;function report(m){if(sent++>=30)return;try{parent.postMessage({__sandroid:"runtime-error",message:String(m).slice(0,500)},"*")}catch(x){}}
addEventListener("error",function(e){var t=e.target;if(t&&t!==window&&(t.src||t.href)){report("Failed to load "+(t.src||t.href))}
else{report((e.message||"Error")+(e.lineno?" (line "+e.lineno+")":""))}},true);
addEventListener("unhandledrejection",function(e){var r=e.reason;report("Unhandled promise rejection: "+(r&&r.message?r.message:r))});
var ce=console.error;console.error=function(){report([].map.call(arguments,function(a){return a&&a.message?a.message:String(a)}).join(" "));return ce.apply(console,arguments)};
})();</script>`;
}

export function gameDocument(project: GameProject, initial: Record<string, string>, quotaBytes: number): string {
  const shim = controlShim() + storageShim(project.id, initial, quotaBytes);
  const html = /<html[\s>]/i.test(project.html) ? project.html : `<!doctype html><html><head></head><body>${project.html}</body></html>`;
  const head = /<head[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + shim + html.slice(head.index + head[0].length);
  return shim + html;
}

export function storageBytes(data: Record<string, string>): number {
  let n = 0;
  for (const [k, v] of Object.entries(data)) n += k.length + v.length;
  return n;
}

/**
 * Something the user typed/attached that can run as-is: fenced html/js blocks, or a raw
 * HTML document pasted without fences. Used for "Run code" (no AI call, no cost).
 */
export function runnableFromText(text: string, parse: (t: string) => Segment[]): GameProject | null {
  const fenced = buildProject(parse(text));
  if (fenced) return fenced;
  const raw = text.trim();
  if (/^(<!doctype html|<html[\s>])/i.test(raw)) return buildProject(parse("```html\n" + raw + "\n```"));
  return null;
}
