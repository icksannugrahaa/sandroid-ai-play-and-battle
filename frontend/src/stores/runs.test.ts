import { afterEach, describe, expect, it, vi } from "vitest";

import { useCredentials } from "./credentials";
import { useArena, usePlayground } from "./runs";

function sseResponse(events: [string, object][], delayMs = 5): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const [event, data] of events) {
        await new Promise((r) => setTimeout(r, delayMs));
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const METRICS = { status: "success", error_category: null, ttft_ms: 5, ttft_supported: true, total_ms: 20, prompt_tokens: 1, completion_tokens: 2, total_tokens: 3, tokens_estimated: false, throughput_tps: 100, cost_usd: null };

afterEach(() => {
  vi.unstubAllGlobals();
  useCredentials.getState().clearAll();
});

describe("run stores (independent of page components)", () => {
  it("playground keeps streaming with no component mounted", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        ["start", { canonical_key: "m" }],
        ["delta", { text: "Hel" }],
        ["delta", { text: "lo" }],
        ["metrics", METRICS],
        ["done", { contributed: true }],
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const ep = useCredentials.getState().addEndpoint({ label: "x", baseUrl: "https://api.test/v1", apiKey: "sk-k" });
    usePlayground.setState({ endpointId: ep.id, model: "m", prompt: "hi" });

    const pending = usePlayground.getState().run();
    expect(usePlayground.getState().running).toBe(true);
    await pending;

    const st = usePlayground.getState();
    expect(st.running).toBe(false);
    expect(st.slots[0]?.output).toBe("Hello");
    expect(st.slots[0]?.metrics?.status).toBe("success");
    expect(st.conversation.map((m) => m.content)).toEqual(["hi", "Hello"]);
    expect(st.lastEntry?.results[0]).not.toHaveProperty("apiKey");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("sk-k");
    expect(JSON.stringify(usePlayground.getState())).not.toContain("sk-k");
  });

  it("arena routes events to slots and can be stopped", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const res = sseResponse(
          [
            ["start", { slot: 0 }],
            ["start", { slot: 1 }],
            ["delta", { slot: 1, text: "B" }],
            ["delta", { slot: 0, text: "A" }],
            ["metrics", { ...METRICS, slot: 0 }],
            ["metrics", { ...METRICS, slot: 1 }],
            ["done", { strategy: "parallel" }],
          ],
          20,
        );
        init.signal?.addEventListener("abort", () => void res.body?.cancel());
        return res;
      }),
    );
    const ep = useCredentials.getState().addEndpoint({ label: "x", baseUrl: "https://api.test/v1", apiKey: "" });
    useArena.setState({ picks: [{ endpointId: ep.id, model: "a" }, { endpointId: ep.id, model: "b" }], prompt: "go" });
    await useArena.getState().run();
    expect(useArena.getState().slots.map((s) => s.output)).toEqual(["A", "B"]);
    expect(useArena.getState().running).toBe(false);
  });
});

describe("arena follow-ups", () => {
  it("sends each model its own previous answers in the next round", async () => {
    const bodies: { slots: { model: string; history: { role: string; content: string }[] }[] }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return sseResponse([
          ["start", { slot: 0 }],
          ["start", { slot: 1 }],
          ["delta", { slot: 0, text: `A${bodies.length}` }],
          ["delta", { slot: 1, text: `B${bodies.length}` }],
          ["metrics", { ...METRICS, slot: 0 }],
          ["metrics", { ...METRICS, slot: 1 }],
          ["done", {}],
        ]);
      }),
    );
    const ep = useCredentials.getState().addEndpoint({ label: "x", baseUrl: "https://api.test/v1", apiKey: "" });
    useArena.getState().newBattle();
    useArena.setState({ picks: [{ endpointId: ep.id, model: "a" }, { endpointId: ep.id, model: "b" }], prompt: "make a cube" });
    await useArena.getState().run();
    expect(useArena.getState().prompt).toBe(""); // composer cleared like a chat
    useArena.setState({ prompt: "patch #1" });
    await useArena.getState().run();

    expect(bodies[0]!.slots.map((s) => s.history)).toEqual([[], []]);
    expect(bodies[1]!.slots[0]!.history.map((m) => m.content)).toEqual(["make a cube", "A1"]);
    expect(bodies[1]!.slots[1]!.history.map((m) => m.content)).toEqual(["make a cube", "B1"]);
    expect(useArena.getState().rounds.map((r) => r.text)).toEqual(["make a cube", "patch #1"]);
    useArena.getState().newBattle();
    expect(useArena.getState().rounds).toEqual([]);
    expect(useArena.getState().histories).toEqual([]);
  });
});

describe("runtime hint (models know code runs in this app)", () => {
  it("is prepended to the system prompt by default and can be turned off", async () => {
    const { RUNTIME_HINT, stripRuntimeHint } = await import("../lib/runtimeHint");
    const { usePrefs } = await import("./prefs");
    const bodies: { config: { system?: string } }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return sseResponse([["metrics", METRICS], ["done", {}]]);
      }),
    );
    const ep = useCredentials.getState().addEndpoint({ label: "x", baseUrl: "https://api.test/v1", apiKey: "" });
    usePlayground.setState({ endpointId: ep.id, model: "m", prompt: "coba run code ini", system: "Be brief." });
    await usePlayground.getState().run();
    expect(bodies[0]!.config.system).toBe(`${RUNTIME_HINT}\n\nBe brief.`);
    expect(stripRuntimeHint(bodies[0]!.config.system)).toBe("Be brief.");

    usePrefs.getState().setRuntimeHint(false);
    usePlayground.setState({ prompt: "again" });
    await usePlayground.getState().run();
    expect(bodies[1]!.config.system).toBe("Be brief.");
    usePrefs.getState().setRuntimeHint(true);
  });
});

describe("composer clearing & image follow-ups", () => {
  it("clears the composer on send, and restores it if the request fails before any answer", async () => {
    const ep = useCredentials.getState().addEndpoint({ label: "x", baseUrl: "https://api.test/v1", apiKey: "" });
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([["delta", { text: "hi" }], ["metrics", METRICS], ["done", {}]], 20)));
    usePlayground.getState().newChat();
    usePlayground.setState({ endpointId: ep.id, model: "m", mode: "chat", prompt: "halo" });
    const pending = usePlayground.getState().run();
    expect(usePlayground.getState().prompt).toBe(""); // cleared immediately, not after the answer
    await pending;
    expect(usePlayground.getState().prompt).toBe("");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 })));
    usePlayground.setState({ prompt: "coba lagi" });
    await usePlayground.getState().run();
    expect(usePlayground.getState().prompt).toBe("coba lagi"); // given back for retry
    expect(usePlayground.getState().turns.at(-1)?.requestError).toBe("errors.rate_limited");
  });

  it("text → image follow-ups keep the context of earlier image requests", async () => {
    const prompts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: RequestInit) => {
        prompts.push(JSON.parse(String(init.body)).config.prompt);
        return sseResponse([["image", { url: "data:image/png;base64,AA" }], ["metrics", METRICS], ["done", {}]]);
      }),
    );
    const ep = useCredentials.getState().addEndpoint({ label: "x", baseUrl: "https://api.test/v1", apiKey: "" });
    usePlayground.getState().newChat();
    usePlayground.setState({ endpointId: ep.id, model: "img", mode: "image_gen", prompt: "kucing pakai kacamata" });
    await usePlayground.getState().run();
    usePlayground.setState({ prompt: "ubah warnanya jadi hitam" });
    await usePlayground.getState().run();

    expect(prompts[0]).toBe("kucing pakai kacamata");
    expect(prompts[1]).toContain("kucing pakai kacamata");
    expect(prompts[1]).toContain("1. ubah warnanya jadi hitam");
    // the chat shows what you typed, not the chained prompt
    expect(usePlayground.getState().turns.map((t) => t.text)).toEqual(["kucing pakai kacamata", "ubah warnanya jadi hitam"]);
    usePlayground.getState().newChat();
    expect(usePlayground.getState().imageThread).toEqual([]);
    usePlayground.setState({ mode: "chat" });
  });
});

describe("arena challenges", () => {
  it("scores a challenge round and retries after the server's rate limit", async () => {
    const e = useCredentials.getState().addEndpoint({ label: "x", baseUrl: "https://x.test/v1", apiKey: "k" });
    useArena.setState({ picks: [{ endpointId: e.id, model: "a" }, { endpointId: e.id, model: "b" }], rounds: [], histories: [], queue: null });
    let calls = 0;
    const bodies: { slots: { history: unknown[] }[]; system: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        calls++;
        bodies.push(JSON.parse(String(init.body)));
        if (calls === 1)
          return new Response(JSON.stringify({ error: "rate_limited", retry_after_s: 1 }), { status: 429, headers: { "content-type": "application/json" } });
        return sseResponse([
          ["start", { slot: 0, model: "a" }],
          ["start", { slot: 1, model: "b" }],
          ["delta", { slot: 0, text: "<answer>14</answer>" }],
          ["delta", { slot: 1, text: "no idea" }],
          ["metrics", { slot: 0, ...METRICS }],
          ["metrics", { slot: 1, ...METRICS }],
          ["done", {}],
        ]);
      }),
    );
    await useArena.getState().runChallenges([{ id: "arithmetic", seed: 1, difficulty: "easy" }]);
    const st = useArena.getState();
    expect(calls).toBe(2); // 429 → waited → retried
    expect(st.rounds).toHaveLength(1);
    expect(st.rounds[0]!.challenge).toEqual({ id: "arithmetic", seed: 1, difficulty: "easy" });
    expect(st.rounds[0]!.verdicts!.map((v) => v?.solved)).toEqual([false, false]);
    expect(st.rounds[0]!.verdicts![1]!.note).toMatch(/no integer/);
    expect(st.queue).toBeNull();
    // puzzles start fresh: no chat history is sent
    expect(bodies[1]!.slots.every((s) => s.history.length === 0)).toBe(true);
    expect(st.histories).toEqual([]);
  }, 10_000);
});

describe("until-solved challenge play", () => {
  it("feeds each model its own state turn after turn until it solves (or gets stuck)", async () => {
    const { puzzleFor } = await import("../challenges");
    const { slide } = await import("../challenges/sliding");
    const ref = { id: "sliding", seed: 9, difficulty: "medium" as const, untilSolved: true };
    const start = (puzzleFor(ref)!.data as { start: string }).start;
    // shortest solution by BFS
    const prev = new Map<string, [string, string] | null>([[start, null]]);
    const queue = [start];
    for (let q = 0; q < queue.length && !prev.has("123456780"); q++)
      for (const m of "UDLR") {
        const n = slide(queue[q]!, m);
        if (n && !prev.has(n)) (prev.set(n, [queue[q]!, m]), queue.push(n));
      }
    const path: string[] = [];
    for (let s = "123456780"; prev.get(s); s = prev.get(s)![0]) path.unshift(prev.get(s)![1]);

    const e = useCredentials.getState().addEndpoint({ label: "x", baseUrl: "https://x.test/v1", apiKey: "k" });
    useArena.setState({ picks: [{ endpointId: e.id, model: "a" }, { endpointId: e.id, model: "b" }], rounds: [], histories: [], queue: null });
    const turns: { models: string[]; prompts: (string | undefined)[] }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { slots: { model: string; prompt?: string }[] };
        turns.push({ models: body.slots.map((s) => s.model), prompts: body.slots.map((s) => s.prompt) });
        const events: [string, object][] = [];
        body.slots.forEach((s, i) => {
          const made = s.prompt ? Number(/\((?:turn \d+ so far, )?(\d+) moves/.exec(s.prompt)?.[1] ?? 0) : 0;
          const text = s.model === "a" ? `<answer>${path.slice(made, made + 2).join("")}</answer>` : "no idea";
          events.push(["start", { slot: i, model: s.model }], ["delta", { slot: i, text }], ["metrics", { slot: i, ...METRICS }]);
        });
        return sseResponse([...events, ["done", {}]], 1);
      }),
    );
    await useArena.getState().runChallenges([ref]);
    const round = useArena.getState().rounds.at(-1)!;
    const [a, b] = round.verdicts!;
    expect(a).toMatchObject({ solved: true, moves: path.length });
    expect(a!.note).toMatch(new RegExp(`over ${Math.ceil(path.length / 2)} turns`));
    expect(b!.solved).toBe(false);
    expect(b!.note).toMatch(/stopped: 3 turns in a row without usable moves/);
    // turn 1 is the shared prompt; later turns carry each model's own state
    expect(turns[0]!.prompts).toEqual([undefined, undefined]);
    expect(turns[1]!.prompts[0]).toMatch(/CURRENT board/);
    // b drops out after 3 turns, a continues alone
    expect(turns.slice(3).every((t) => t.models.join() === "a")).toBe(true);
    // one card per model with every turn's output
    expect(round.results[0]!.output).toMatch(/### Turn 2/);
    expect(round.results[0]!.metrics!.completion_tokens).toBe(2 * Math.ceil(path.length / 2));
  }, 20_000);
});
