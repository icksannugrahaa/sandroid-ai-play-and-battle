import { beforeEach, describe, expect, it } from "vitest";

import { memoryStore } from "../lib/idb";
import { useCredentials } from "./credentials";
import { usePrefs } from "./prefs";
import { usePlayground } from "./runs";
import { restoreSession, takeSnapshot, type Snapshot } from "./sessionCache";

const SECRET = "sk-super-secret-1234";

beforeEach(() => {
  useCredentials.setState({ endpoints: [], models: {} });
  usePlayground.setState({ turns: [], conversation: [], prompt: "" });
  usePrefs.getState().setCacheHours(6);
});

describe("session cache", () => {
  it("never puts an API key in the snapshot", () => {
    useCredentials.getState().addEndpoint({ label: "Mine", baseUrl: "https://x.test/v1", apiKey: SECRET });
    usePlayground.setState({ prompt: "hello", conversation: [{ role: "user", content: "hi" }] });
    const snap = takeSnapshot(6);
    expect(JSON.stringify(snap)).not.toContain(SECRET);
    expect(snap.endpoints[0]).toEqual({ id: expect.any(String), label: "Mine", baseUrl: "https://x.test/v1" });
    expect(snap.expiresAt - snap.savedAt).toBe(6 * 3_600_000);
  });

  it("restores the workspace with key-less endpoints", async () => {
    const store = memoryStore();
    useCredentials.getState().addEndpoint({ label: "Mine", baseUrl: "https://x.test/v1", apiKey: SECRET });
    usePlayground.setState({ prompt: "draft", conversation: [{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }] });
    await store.set("workspace-v1", takeSnapshot(6));

    useCredentials.setState({ endpoints: [], models: {} });
    usePlayground.setState({ prompt: "", conversation: [] });
    expect(await restoreSession(store)).toBe("restored");

    expect(useCredentials.getState().endpoints).toEqual([expect.objectContaining({ label: "Mine", apiKey: "" })]);
    expect(usePlayground.getState().conversation).toHaveLength(2);
    expect(usePlayground.getState().prompt).toBe("draft");
  });

  it("drops an expired snapshot", async () => {
    const store = memoryStore();
    const snap: Snapshot = { ...takeSnapshot(1, 0) };
    await store.set("workspace-v1", snap);
    expect(await restoreSession(store, 2 * 3_600_000)).toBe("expired");
    expect(await store.get("workspace-v1")).toBeUndefined();
  });

  it("ignores the cache when caching is off", async () => {
    const store = memoryStore();
    await store.set("workspace-v1", takeSnapshot(6));
    usePrefs.getState().setCacheHours(0);
    expect(await restoreSession(store)).toBe("expired");
  });
});
