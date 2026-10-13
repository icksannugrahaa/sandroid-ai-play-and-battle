import { beforeEach, describe, expect, it } from "vitest";

import en from "../i18n/en.json";
import id from "../i18n/id.json";
import { EXPORT_SCHEMA, type HistoryEntry } from "../types";
import { useCredentials } from "./credentials";
import { buildExport, HISTORY_LIMIT, ImportError, parseImport, sanitize, useHistory } from "./history";

function entry(n: number, extra: Record<string, unknown> = {}): HistoryEntry {
  return {
    id: `id-${n}`,
    kind: "playground",
    createdAt: new Date(2026, 0, 1, 0, n).toISOString(),
    config: { modality: "chat", prompt: `p${n}`, params: {} },
    results: [{ model: "m", endpointLabel: "e", baseUrl: "https://x", output: "o", images: [], metrics: null, error: null, ...extra }],
  };
}

describe("credentials store (zero persistence)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("never touches browser storage or cookies", () => {
    useCredentials.getState().addEndpoint({ label: "x", baseUrl: "https://api.test/v1", apiKey: "sk-secret-123" });
    expect(useCredentials.getState().endpoints).toHaveLength(1);
    const everything = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie;
    expect(everything).not.toContain("sk-secret-123");
    useCredentials.getState().clearAll();
    expect(useCredentials.getState().endpoints).toHaveLength(0);
  });
});

describe("history store", () => {
  beforeEach(() => {
    localStorage.clear();
    useHistory.setState({ entries: [], lastError: null });
  });

  it("sanitizes credential-like fields at any depth", () => {
    const dirty = { a: 1, apiKey: "x", nested: [{ api_key: "y", token: "z", ok: true }], Authorization: "b" };
    expect(sanitize(dirty)).toEqual({ a: 1, nested: [{ ok: true }] });
  });

  it("is FIFO-capped and never stores keys", () => {
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) useHistory.getState().add(entry(i, { apiKey: "sk-leak" }));
    const { entries } = useHistory.getState();
    expect(entries).toHaveLength(HISTORY_LIMIT);
    expect(entries[0]!.id).toBe(`id-${HISTORY_LIMIT + 4}`);
    expect(localStorage.getItem("sandroid.history.v1")).not.toContain("sk-leak");
  });

  it("round-trips export/import with schema validation", () => {
    const file = buildExport([entry(1)]);
    expect(file.schema).toBe(EXPORT_SCHEMA);
    expect(parseImport(JSON.stringify(file))).toHaveLength(1);
    expect(() => parseImport("{")).toThrow(ImportError);
    expect(() => parseImport(JSON.stringify({ ...file, schema: "other@v9" }))).toThrow("unsupported_schema");
    expect(() => parseImport(JSON.stringify({ ...file, runs: [{ id: 1 }] }))).toThrow("invalid_runs");
  });

  it("merge skips duplicates", () => {
    useHistory.getState().add(entry(1));
    expect(useHistory.getState().merge([entry(1), entry(2)])).toBe(1);
    expect(useHistory.getState().entries.map((e) => e.id)).toEqual(["id-2", "id-1"]);
  });
});

describe("i18n", () => {
  it("ID and EN dictionaries have identical keys", () => {
    expect(Object.keys(id).sort()).toEqual(Object.keys(en).sort());
  });
});
