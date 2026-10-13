import { describe, expect, it } from "vitest";

import { SseParser } from "./sse";

describe("SseParser", () => {
  it("parses events split across arbitrary chunks", () => {
    const p = new SseParser();
    const raw = ': stream-open\n\nevent: delta\ndata: {"text":"Hel","slot":1}\n\nevent: metrics\r\ndata: {"total_ms":5}\r\n\r\n';
    const events = [...raw].flatMap((ch) => p.push(ch));
    expect(events).toEqual([
      { event: "delta", data: { text: "Hel", slot: 1 } },
      { event: "metrics", data: { total_ms: 5 } },
    ]);
  });

  it("ignores malformed data", () => {
    expect(new SseParser().push("event: x\ndata: {nope\n\n")).toEqual([]);
  });
});
