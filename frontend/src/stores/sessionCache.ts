/**
 * Optional session cache (0–24 h, off by default) so a refresh doesn't wipe your work.
 *
 * Saved (IndexedDB, this browser only): Playground conversation & turns, Arena rounds &
 * per-model histories, form settings, session usage, game saves, endpoint label + URL,
 * fetched model lists.
 * NEVER saved: API keys. Restored endpoints come back key-less ("needs key").
 * The snapshot is also run through `sanitize`, which drops any credential-looking field.
 */
import { create } from "zustand";

import { idbStore, type KeyValueStore } from "../lib/idb";
import { useCredentials } from "./credentials";
import { useGameStorage } from "./gameStorage";
import { sanitize } from "./history";
import { usePrefs } from "./prefs";
import { useArena, usePlayground } from "./runs";

const CACHE_ID = "workspace-v1";
const HOUR = 3_600_000;
const SAVE_EVERY_MS = 1500;

export interface Snapshot {
  version: 1;
  savedAt: number;
  expiresAt: number;
  endpoints: { id: string; label: string; baseUrl: string }[];
  models: Record<string, unknown>;
  playground: Record<string, unknown>;
  arena: Record<string, unknown>;
  games: Record<string, unknown>;
}

interface CacheStatus {
  savedAt: number | null;
  expiresAt: number | null;
  restoredAt: number | null;
}

export const useCacheStatus = create<CacheStatus>()(() => ({ savedAt: null, expiresAt: null, restoredAt: null }));

const PLAYGROUND_FIELDS = ["endpointId", "model", "mode", "system", "params", "timeoutS", "imageSize", "prompt", "conversation", "turns", "imageThread", "usage", "lastEntry"] as const;
const ARENA_FIELDS = ["picks", "strategy", "mode", "system", "params", "timeoutS", "prompt", "rounds", "histories", "imageThread", "usage", "lastEntry", "kind", "challengeId", "difficulty", "maxMoves", "untilSolved", "maxTurns", "stateFormat", "challengeTimeoutS", "distanceHint"] as const;

function pick<T extends object>(obj: T, fields: readonly string[]): Record<string, unknown> {
  const rec = obj as Record<string, unknown>;
  return Object.fromEntries(fields.filter((f) => f in rec).map((f) => [f, rec[f]]));
}

export function takeSnapshot(hours: number, now = Date.now()): Snapshot {
  const creds = useCredentials.getState();
  return sanitize({
    version: 1 as const,
    savedAt: now,
    expiresAt: now + hours * HOUR,
    // label + URL only — the API key is deliberately left out
    endpoints: creds.endpoints.map(({ id, label, baseUrl }) => ({ id, label, baseUrl })),
    models: creds.models,
    playground: pick(usePlayground.getState(), PLAYGROUND_FIELDS),
    arena: pick(useArena.getState(), ARENA_FIELDS),
    games: useGameStorage.getState().data,
  });
}

/** Apply a snapshot unless it expired. Returns what happened. */
export async function restoreSession(store: KeyValueStore = idbStore, now = Date.now()): Promise<"restored" | "expired" | "none"> {
  const snap = await store.get<Snapshot>(CACHE_ID);
  if (!snap || snap.version !== 1) return "none";
  if (snap.expiresAt <= now || usePrefs.getState().cacheHours === 0) {
    await store.del(CACHE_ID);
    return "expired";
  }
  useCredentials.getState().restoreEndpoints(snap.endpoints, snap.models as never);
  if (!usePlayground.getState().running) usePlayground.setState(snap.playground as never);
  if (!useArena.getState().running) useArena.setState(snap.arena as never);
  useGameStorage.setState({ data: snap.games as never });
  useCacheStatus.setState({ savedAt: snap.savedAt, expiresAt: snap.expiresAt, restoredAt: now });
  return "restored";
}

export async function clearSessionCache(store: KeyValueStore = idbStore): Promise<void> {
  await store.del(CACHE_ID);
  useCacheStatus.setState({ savedAt: null, expiresAt: null });
}

/** Restore once, then keep saving (throttled) while caching is on. Returns an unsubscribe fn. */
export function startSessionCache(store: KeyValueStore = idbStore): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ready = false;

  const save = async () => {
    timer = null;
    const hours = usePrefs.getState().cacheHours;
    if (hours === 0) return;
    try {
      const snap = takeSnapshot(hours);
      await store.set(CACHE_ID, snap);
      useCacheStatus.setState({ savedAt: snap.savedAt, expiresAt: snap.expiresAt });
    } catch {
      /* quota or private mode — caching is best-effort */
    }
  };
  const schedule = () => {
    if (ready && !timer) timer = setTimeout(() => void save(), SAVE_EVERY_MS);
  };

  const unsubs = [usePlayground, useArena, useCredentials, useGameStorage].map((s) =>
    (s as { subscribe: (fn: () => void) => () => void }).subscribe(schedule),
  );
  unsubs.push(
    usePrefs.subscribe((p, prev) => {
      if (p.cacheHours === prev.cacheHours) return;
      if (p.cacheHours === 0) void clearSessionCache(store);
      else void save(); // new duration applies right away
    }),
  );

  void restoreSession(store).finally(() => {
    ready = true;
  });

  return () => {
    if (timer) clearTimeout(timer);
    unsubs.forEach((u) => u());
  };
}
