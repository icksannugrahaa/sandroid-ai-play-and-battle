export const dash = "–";

export function ms(v: number | null | undefined): string {
  if (v === null || v === undefined) return dash;
  return v >= 10_000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`;
}

export function num(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined ? dash : v.toFixed(digits);
}

export function usd(v: number | null | undefined): string {
  if (v === null || v === undefined) return dash;
  if (v === 0) return "$0";
  return v < 0.01 ? `$${v.toPrecision(2)}` : `$${v.toFixed(v < 1 ? 4 : 2)}`;
}

export function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? dash : `${(v * 100).toFixed(0)}%`;
}

export function date(v: string | null | undefined, lang: string): string {
  if (!v) return dash;
  return new Date(v).toLocaleString(lang === "id" ? "id-ID" : "en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function bytes(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export function uid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
