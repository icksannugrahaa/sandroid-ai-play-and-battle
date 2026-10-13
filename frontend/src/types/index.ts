export type Modality = "chat" | "vision" | "image_gen";
export type ArenaStrategy = "parallel" | "sequential";
export type RunStatus = "success" | "error" | "timeout";
export type ErrorCategory = "auth" | "rate_limit" | "server" | "network" | "timeout";

/** A user-supplied endpoint. Lives in memory only — see stores/credentials.ts. */
export interface Endpoint {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
}

export interface FetchedModel {
  id: string;
  display_name: string;
  canonical_key: string;
  family: string;
  capabilities: Modality[];
  owned_by: string | null;
}

export interface GenerationParams {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  seed?: number;
}

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PromptConfig {
  modality: Modality;
  prompt: string;
  system?: string;
  history?: HistoryMessage[];
  images?: string[];
  attachments?: { kind: "audio" | "file"; name: string; data_url: string }[];
  image_size?: string;
  params: GenerationParams;
}

export interface RunMetrics {
  status: RunStatus;
  error_category: ErrorCategory | null;
  ttft_ms: number | null;
  ttft_supported: boolean;
  total_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  tokens_estimated: boolean;
  throughput_tps: number | null;
  cost_usd: number | null;
  /** which price was used; exact=false → base model price (e.g. "-low" suffix removed) */
  price_key?: string | null;
  price_exact?: boolean | null;
  /** why the model stopped: "length" = cut off by the output-token cap */
  finish_reason?: string | null;
}

/** Client-side result of one model run (content stays in the browser). */
export interface SlotResult {
  model: string;
  endpointLabel: string;
  canonicalKey?: string;
  output: string;
  /** streamed "thinking" of reasoning models (display only — never sent back as history) */
  reasoning?: string;
  images: string[];
  /** audio data URLs returned by the provider (optional: older history entries lack it) */
  audio?: string[];
  metrics: RunMetrics | null;
  error: ErrorCategory | null;
  /** upstream HTTP status behind `error`, when there was one (e.g. 524 = proxy timeout) */
  errorStatus?: number | null;
  /** how long the model ran before failing */
  errorAfterMs?: number;
  running: boolean;
  /** client clock (ms) for the live timer; final numbers come from `metrics` */
  startedAt?: number;
  firstTokenAt?: number;
  /** signed proof of this run for the challenge leaderboard (only when contributing) */
  ticket?: string;
}

export interface PricingEntry {
  canonical_key: string;
  raw_name: string;
  input_per_1m: number | null;
  output_per_1m: number | null;
  image_price: number | null;
  currency: string;
  source: string;
  fetched_at: string;
}

export interface ResearchLog {
  sources_status: Record<string, { ok: boolean; entries: number; error: string | null }>;
  entries_updated: number;
  created_at: string;
  alias_candidates: { model_key: string; suggested_key: string; score: number }[];
}

export interface PricingResponse {
  entries: PricingEntry[];
  total: number;
  next_cursor: string | null;
  cooldown_remaining_s: number;
  last_research: ResearchLog | null;
}

export interface CatalogModel {
  canonical_key: string;
  display_name: string;
  family: string;
  modalities: Modality[];
  first_seen: string;
  aliases: string[];
}

/** A saved run in browser history. NEVER contains an API key. */
export interface HistoryEntry {
  id: string;
  kind: "playground" | "arena";
  createdAt: string;
  strategy?: ArenaStrategy;
  config: PromptConfig;
  results: (Omit<SlotResult, "running"> & { baseUrl: string })[];
}

export const EXPORT_SCHEMA = "sandroid-playground-export@v1";

export interface ExportFile {
  schema: typeof EXPORT_SCHEMA;
  exported_at: string;
  runs: HistoryEntry[];
}

export interface ChallengeBoardRow {
  rank: number;
  key: string;
  display_name: string;
  family: string;
  variants: number;
  runs: number;
  avg_score: number;
  solve_rate: number;
  best_score: number;
  avg_moves_solved: number | null;
  avg_time_ms: number;
  avg_tokens: number;
  avg_cost_usd: number | null;
  timeouts: number;
  last_tested: string;
  insufficient_data: boolean;
}

export interface ChallengeBoardCell {
  challenge_id: string;
  difficulty: string;
  runs: number;
  models: number;
}

export interface ChallengeBoardResponse {
  challenge_id: string;
  difficulty: string;
  rows: ChallengeBoardRow[];
  cells: ChallengeBoardCell[];
  min_runs: number;
  ranking: string;
}

export interface ChallengeResultIn {
  ticket: string;
  challenge_id: string;
  difficulty: string;
  seed: number;
  score: number;
  solved: boolean;
  moves: number | null;
  time_limit_s: number | null;
}
