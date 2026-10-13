import { HttpError } from "../api/sse";

/** Maps any thrown error / category to a translated message. Abort → null. */
export function errorKey(err: unknown): string | null {
  if (err instanceof DOMException && err.name === "AbortError") return null;
  if (err instanceof HttpError) {
    const code = err.body.error === "provider_error" ? err.body.category : err.body.error;
    // keep the upstream status (e.g. 530 = gateway offline) for the message: "errors.server|530"
    const upstream = typeof err.body.upstream_status === "number" ? `|${err.body.upstream_status}` : "";
    return `errors.${typeof code === "string" ? code : "generic"}${upstream}`;
  }
  if (err instanceof TypeError) return "errors.network";
  return "errors.generic";
}
