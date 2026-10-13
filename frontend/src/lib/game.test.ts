import { afterEach, describe, expect, it, vi } from "vitest";

import { parseSegments } from "./artifacts";
import { buildProject, controlShim, gameDocument, storageShim } from "./game";

const fence = (info: string, code: string) => "```" + info + "\n" + code + "\n```\n";

describe("buildProject", () => {
  it("returns null without a complete html block", () => {
    expect(buildProject(parseSegments("no code"))).toBeNull();
    expect(buildProject(parseSegments("```html\n<p>still streaming"))).toBeNull();
  });

  it("inlines referenced files by name, keeps CDN scripts", () => {
    const text =
      fence("html index.html", '<html><head><link rel="stylesheet" href="./style.css"><script src="https://cdn.x/p5.js"></script></head><body><script src="game.js"></script></body></html>') +
      fence("css style.css", "body{margin:0}") +
      fence("javascript game.js", 'console.log("</script>")');
    const p = buildProject(parseSegments(text))!;
    expect(p.html).toContain("<style>\nbody{margin:0}");
    expect(p.html).toContain('console.log("<\\/script>")'); // cannot break out of its tag
    expect(p.html).toContain('src="https://cdn.x/p5.js"');
    expect(p.html).not.toContain('src="game.js"');
  });

  it("appends unreferenced js/css when the page has none of its own", () => {
    const text = fence("html", "<html><head></head><body><canvas id=c></canvas></body></html>") + fence("css", "canvas{}") + fence("js", "draw()");
    const p = buildProject(parseSegments(text))!;
    expect(p.html.indexOf("<style>")).toBeLessThan(p.html.indexOf("</head>"));
    expect(p.html.indexOf("draw()")).toBeLessThan(p.html.indexOf("</body>"));
  });

  it("id is stable for identical code", () => {
    const t = fence("html", "<p>a</p>");
    expect(buildProject(parseSegments(t))!.id).toBe(buildProject(parseSegments(t))!.id);
  });
});

describe("storage shim", () => {
  const original = Object.getOwnPropertyDescriptor(window, "localStorage");
  afterEach(() => {
    if (original) Object.defineProperty(window, "localStorage", original);
  });

  function runShim(initial: Record<string, string>, quota: number) {
    const script = storageShim("g1", initial, quota).replace(/^<script>|<\/script>$/g, "");
    new Function(script)();
  }

  it("serves initial data, mirrors writes to the parent, enforces quota", () => {
    const post = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
    runShim({ best: "10" }, 20);
    expect(localStorage.getItem("best")).toBe("10");
    localStorage.setItem("best", "42");
    expect(post).toHaveBeenCalledWith({ __sandroid: "game-storage", id: "g1", op: "set", key: "best", value: "42" }, "*");
    expect(() => localStorage.setItem("big", "x".repeat(50))).toThrow(/full/);
    expect(localStorage.length).toBe(1);
    post.mockRestore();
  });

  it("injects the shim as the first thing in <head>", () => {
    const doc = gameDocument({ html: "<html><head><title>t</title></head><body></body></html>", name: "x", id: "g" }, {}, 100);
    expect(doc.indexOf("game-storage")).toBeLessThan(doc.indexOf("<title>"));
  });
});

describe("JS-only answers", () => {
  const js = (code: string, info = "javascript") => parseSegments(fence(info, code));

  it("wraps a p5 sketch with the p5 library", () => {
    const p = buildProject(js("function setup(){createCanvas(400,400)}\nfunction draw(){circle(mouseX,mouseY,20)}"))!;
    expect(p.html).toContain("p5.min.js");
    expect(p.html).toContain("function draw()");
  });

  it("uses an import map and a module script for ES-module three.js", () => {
    const p = buildProject(js("import * as THREE from 'three';\nconst r = new THREE.WebGLRenderer();document.body.appendChild(r.domElement);"))!;
    expect(p.html).toContain('<script type="importmap">');
    expect(p.html).toContain('<script type="module">');
    expect(p.html).not.toContain("three.min.js"); // imported, so no global build
  });

  it("loads the global three build when THREE is used without import", () => {
    expect(buildProject(js("const s = new THREE.Scene(); requestAnimationFrame(()=>{})"))!.html).toContain("three.min.js");
  });

  it("creates elements the code looks up", () => {
    const p = buildProject(js("const c=document.getElementById('canvas');const x=c.getContext('2d');const o=document.querySelector('#score');"))!;
    expect(p.html).toContain('<canvas id="canvas"');
    expect(p.html).toContain('<div id="score"></div>');
  });

  it("merges css blocks into the generated page", () => {
    const p = buildProject(parseSegments(fence("css", "body{background:black}") + fence("js", "document.body.append('x')")))!;
    expect(p.html).toContain("body{background:black}");
  });

  it("leaves non-visual and Node.js code alone", () => {
    expect(buildProject(js("function add(a,b){return a+b}"))).toBeNull();
    expect(buildProject(js("const fs = require('fs'); document.title='x'"))).toBeNull();
    expect(buildProject(js("console.log(process.env.HOME)"))).toBeNull();
  });
});

describe("control shim", () => {
  it("holds animation frames, timeouts and interval ticks while paused", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => (frames.push(cb), frames.length));
    const runFrames = () => frames.splice(0).forEach((cb) => cb(0));
    new Function(controlShim().replace(/^<script>|<\/script>$/g, ""))();
    const send = (paused: boolean) => window.dispatchEvent(new MessageEvent("message", { data: { __sandroid: "control", paused }, source: window.parent }));

    let ticks = 0;
    window.requestAnimationFrame(() => ticks++);
    send(true);
    runFrames();
    expect(ticks).toBe(0); // held
    expect(document.head.innerHTML).toContain("animation-play-state:paused");
    send(false);
    runFrames();
    expect(ticks).toBe(1); // released on resume
    expect(document.head.innerHTML).not.toContain("animation-play-state:paused");
    vi.unstubAllGlobals();
  });

  it("ignores control messages that do not come from the parent window", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => (cb(0), 1));
    new Function(controlShim().replace(/^<script>|<\/script>$/g, ""))();
    window.dispatchEvent(new MessageEvent("message", { data: { __sandroid: "control", paused: true }, source: null }));
    let ran = false;
    window.requestAnimationFrame(() => (ran = true));
    expect(ran).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe("runtime error reporting", () => {
  it("forwards script errors and console.error to the parent", () => {
    const post = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => (cb(0), 1));
    new Function(controlShim().replace(/^<script>|<\/script>$/g, ""))();
    window.dispatchEvent(new ErrorEvent("error", { message: "THREE.CapsuleGeometry is not a constructor", lineno: 42 }));
    console.error("boom");
    const messages = post.mock.calls.map(([d]) => (d as { __sandroid?: string; message?: string })).filter((d) => d.__sandroid === "runtime-error");
    // earlier tests in this file installed shims too (shared jsdom window) → compare unique messages
    expect([...new Set(messages.map((d) => d.message))]).toEqual(["THREE.CapsuleGeometry is not a constructor (line 42)", "boom"]);
    post.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe("runnableFromText", () => {
  it("finds fenced html inside a longer message and raw pasted documents", async () => {
    const { runnableFromText } = await import("./game");
    const msg = "coba run code ini\n\n```html\n<!DOCTYPE html><html><body><canvas></canvas></body></html>\n```\n\nCatatan: …";
    expect(runnableFromText(msg, parseSegments)?.html).toContain("<canvas>");
    expect(runnableFromText("<!doctype html><html><body>hi</body></html>", parseSegments)?.html).toContain("hi");
    expect(runnableFromText("just a question", parseSegments)).toBeNull();
  });
});
