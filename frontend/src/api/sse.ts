/**
 * Minimal SSE consumer over fetch + ReadableStream (EventSource cannot POST a body).
 */

export interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

/** Incremental parser: feed text chunks, get complete events back. */
export class SseParser {
  private buffer = "";

  push(chunk: string): SseEvent[] {
    // Normalize CRLF/CR; hold back a trailing "\r" — its "\n" may arrive in the next chunk.
    let text = this.buffer + chunk;
    const heldCr = text.endsWith("\r");
    if (heldCr) text = text.slice(0, -1);
    this.buffer = text.replace(/\r\n?/g, "\n");
    const events: SseEvent[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n\n")) !== -1) {
      const block = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const parsed = parseBlock(block);
      if (parsed) events.push(parsed);
    }
    if (heldCr) this.buffer += "\r";
    return events;
  }
}

function parseBlock(block: string): SseEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue; // comment / keep-alive
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (data.length === 0) return null;
  try {
    return { event, data: JSON.parse(data.join("\n")) as Record<string, unknown> };
  } catch {
    return null;
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
  ) {
    super(String(body.error ?? `HTTP ${status}`));
  }
}

export async function streamSse(
  url: string,
  init: { body: unknown; headers?: Record<string, string>; signal?: AbortSignal },
  onEvent: (e: SseEvent) => void,
): Promise<void> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...init.headers },
    body: JSON.stringify(init.body),
    signal: init.signal,
    credentials: "omit",
    cache: "no-store",
  });
  if (!resp.ok || !resp.body) {
    let body: Record<string, unknown> = {};
    try {
      body = (await resp.json()) as Record<string, unknown>;
    } catch {
      /* non-JSON error */
    }
    throw new HttpError(resp.status, body);
  }
  const reader = resp.body.pipeThrough(new TextDecoderStream()).getReader();
  const parser = new SseParser();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const ev of parser.push(value)) onEvent(ev);
  }
}
