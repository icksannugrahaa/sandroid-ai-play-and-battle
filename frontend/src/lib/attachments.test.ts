import { describe, expect, it } from "vitest";

import { tally } from "../stores/runs";
import type { SlotResult } from "../types";
import { buildPrompt, classify, inlineTextFile, readFiles, type Draft } from "./attachments";

const d = (kind: Draft["kind"], extra: Partial<Draft> = {}): Draft => ({ id: kind, kind, name: `x.${kind}`, size: 10, mime: "", ...extra });

describe("attachments", () => {
  it("classifies by mime and extension", () => {
    expect(classify({ name: "a.png", type: "image/png" })).toBe("image");
    expect(classify({ name: "logo.svg", type: "image/svg+xml" })).toBe("text"); // svg is text, inlined
    expect(classify({ name: "v.mp3", type: "" })).toBe("audio");
    expect(classify({ name: "main.py", type: "" })).toBe("text");
    expect(classify({ name: "data.json", type: "application/json" })).toBe("text");
    expect(classify({ name: "doc.pdf", type: "application/pdf" })).toBe("file");
    expect(classify({ name: "deck.pptx", type: "" })).toBe("file");
  });

  it("inlines text files with a fence longer than any inside", () => {
    expect(inlineTextFile("a.md", "```js\nx\n```")).toBe("````md a.md\n```js\nx\n```\n````");
  });

  it("builds chat / vision / image_gen requests", () => {
    const drafts = [
      d("text", { name: "main.py", text: "print(1)" }),
      d("image", { dataUrl: "data:image/png;base64,AA" }),
      d("audio", { name: "q.mp3", dataUrl: "data:audio/mpeg;base64,AA" }),
      d("file", { name: "r.pdf", dataUrl: "data:application/pdf;base64,AA" }),
    ];
    const p = buildPrompt("explain", drafts, "chat");
    expect(p.modality).toBe("vision");
    expect(p.prompt).toBe("explain\n\n```py main.py\nprint(1)\n```");
    expect(p.images).toEqual(["data:image/png;base64,AA"]);
    expect(p.attachments).toEqual([
      { kind: "audio", name: "q.mp3", data_url: "data:audio/mpeg;base64,AA" },
      { kind: "file", name: "r.pdf", data_url: "data:application/pdf;base64,AA" },
    ]);
    expect(buildPrompt("hi", [], "chat").modality).toBe("chat");
    expect(buildPrompt("a cat", drafts, "image_gen")).toMatchObject({ modality: "image_gen", images: [], attachments: [] });
  });

  it("rejects unsupported audio and oversize files", async () => {
    const ogg = new File(["x"], "a.ogg", { type: "audio/ogg" });
    const big = new File([new Uint8Array(9 * 1024 * 1024)], "big.pdf", { type: "application/pdf" });
    const txt = new File(["hello"], "n.txt", { type: "text/plain" });
    const res = await readFiles([ogg, big, txt], []);
    expect(res.errors.map((e) => [e.fileName, e.code])).toEqual([["a.ogg", "audio_format"], ["big.pdf", "too_large"]]);
    expect(res.drafts).toMatchObject([{ kind: "text", text: "hello" }]);
  });
});

describe("session usage tally", () => {
  const slot = (model: string, m: Partial<NonNullable<SlotResult["metrics"]>> | null): SlotResult => ({
    model, endpointLabel: "e", output: "", images: [], error: null, running: false,
    metrics: m && { status: "success", error_category: null, ttft_ms: 1, ttft_supported: true, total_ms: 2, prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, tokens_estimated: false, throughput_tps: 1, cost_usd: 0.01, ...m },
  });

  it("accumulates per model and ignores unfinished slots", () => {
    let u = tally({}, [slot("a", {}), slot("b", { cost_usd: null, status: "error" }), slot("c", null)]);
    u = tally(u, [slot("a", { price_exact: false, cost_usd: 0.02 })]);
    expect(u.a).toMatchObject({ runs: 2, promptTokens: 20, completionTokens: 40, pricedRuns: 2, approx: true });
    expect(u.a!.cost).toBeCloseTo(0.03);
    expect(u.b).toMatchObject({ runs: 1, failed: 1, pricedRuns: 0 });
    expect(u.c).toBeUndefined();
  });
});
