import type {
  ChallengeBoardResponse,
  ChallengeResultIn,
  ArenaStrategy,
  CatalogModel,
  Endpoint,
  FetchedModel,
  HistoryMessage,
  PricingResponse,
  PromptConfig,
  ResearchLog,
} from "../types";
import { HttpError, streamSse, type SseEvent } from "./sse";

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

/** Key travels only as a request header, per request. Never in URLs, never stored. */
function keyHeader(apiKey: string, name = "X-Api-Key"): Record<string, string> {
  return apiKey ? { [name]: apiKey } : {};
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, { credentials: "omit", cache: "no-store", ...init });
  const body = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok) throw new HttpError(resp.status, body);
  return body as T;
}

function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function fetchModels(endpoint: Endpoint): Promise<{ models: FetchedModel[] }> {
  return json("/api/v1/models/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...keyHeader(endpoint.apiKey) },
    body: JSON.stringify({ base_url: endpoint.baseUrl }),
  });
}

export function runPlayground(
  endpoint: Endpoint,
  model: string,
  config: PromptConfig,
  opts: { contribute: boolean; timeoutS: number; signal?: AbortSignal },
  onEvent: (e: SseEvent) => void,
): Promise<void> {
  return streamSse(
    `${API_BASE}/api/v1/playground/run`,
    {
      body: { base_url: endpoint.baseUrl, model, config, contribute: opts.contribute, timeout_s: opts.timeoutS },
      headers: keyHeader(endpoint.apiKey),
      signal: opts.signal,
    },
    onEvent,
  );
}

export function runArena(
  slots: { endpoint: Endpoint; model: string; history?: HistoryMessage[]; prompt?: string }[],
  config: PromptConfig,
  opts: { strategy: ArenaStrategy; contribute: boolean; timeoutS: number; signal?: AbortSignal },
  onEvent: (e: SseEvent) => void,
): Promise<void> {
  const headers: Record<string, string> = {};
  slots.forEach((s, i) => Object.assign(headers, keyHeader(s.endpoint.apiKey, `X-Api-Key-${i}`)));
  return streamSse(
    `${API_BASE}/api/v1/arena/run`,
    {
      body: {
        // each model continues its OWN conversation
        slots: slots.map((s) => ({
          base_url: s.endpoint.baseUrl,
          model: s.model,
          history: s.history ?? [],
          ...(s.prompt !== undefined ? { prompt: s.prompt } : {}),
        })),
        strategy: opts.strategy,
        config,
        contribute: opts.contribute,
        timeout_s: opts.timeoutS,
      },
      headers,
      signal: opts.signal,
    },
    onEvent,
  );
}

export interface ChallengeBoardParams {
  challenge: string;
  difficulty: string;
  grouping: "exact" | "family";
  period: "7d" | "30d" | "all";
  min_runs: number;
  hide_insufficient: boolean;
}

export function getChallengeBoard(params: ChallengeBoardParams): Promise<ChallengeBoardResponse> {
  return json(`/api/v1/challenge-leaderboard${query({ ...params })}`);
}

/** Post checked challenge results (each with its run's ticket) to the challenge leaderboard. */
export function postChallengeResults(results: ChallengeResultIn[]): Promise<{ stored: number }> {
  return json("/api/v1/challenge-results", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ results }),
  });
}

export function getPricing(search: string, cursor?: string | null): Promise<PricingResponse> {
  return json(`/api/v1/pricing${query({ search, cursor })}`);
}

export function researchPricing(): Promise<{ research: ResearchLog; cooldown_remaining_s: number }> {
  return json("/api/v1/pricing/research", { method: "POST" });
}

export function getCatalog(
  params: { family?: string; search?: string },
  cursor?: string | null,
): Promise<{ models: CatalogModel[]; total: number; next_cursor: string | null }> {
  return json(`/api/v1/models${query({ ...params, cursor })}`);
}

export { HttpError };
