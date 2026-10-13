# Embedding as a vendor service

Sandroid AI Play & Battle runs as a self-contained service that other projects (a WhatsApp bot, an internal dashboard, …) can add next to their own stack and consume over REST/SSE.

## Topology

```
your-app ──HTTP──► sandroid (FastAPI :8000, also serves the UI) ──► PostgreSQL
                         │
                         └──► the AI endpoint + key YOUR APP supplies per request
```

The service is not tied to any AI router: every call carries its own `base_url` and key.

### docker compose

```yaml
services:
  sandroid:
    image: ghcr.io/icksannugrahaa/sandroid-ai-play-and-battle:latest   # or a pinned :1.0 tag
    environment:
      DATABASE_URL: postgresql+asyncpg://sandroid:${SANDROID_DB_PASSWORD}@sandroid-db:5432/sandroid
      CORS_ORIGINS: https://your-app.example.com   # only if a browser on another origin calls it
    depends_on: [sandroid-db]
  sandroid-db:
    image: postgres:16-alpine
    environment: { POSTGRES_USER: sandroid, POSTGRES_PASSWORD: "${SANDROID_DB_PASSWORD}", POSTGRES_DB: sandroid }
    volumes: [sandroid-db:/var/lib/postgresql/data]
volumes: { sandroid-db: {} }
```

### PM2

Add the app entry from this repo's `ecosystem.config.js` to your own ecosystem file (adjust `cwd` and `--port`), then run `deploy.sh` steps for this directory.

## Stable API (`/api/v1/`)

Breaking changes only ship under a new prefix (`/api/v2/`). OpenAPI: `GET /api/openapi.json`, docs at `/api/docs`.

| Method & path | Notes |
|---|---|
| `GET /api/v1/health` | `{"status":"ok","version":"1.0.0"}` |
| `POST /api/v1/models/fetch` | body `{base_url}`, header `X-Api-Key` |
| `POST /api/v1/playground/run` | SSE; body `{base_url, model, config, contribute, timeout_s}` |
| `POST /api/v1/arena/run` | SSE; body `{slots:[{base_url, model, history?}]×2–4, strategy, config, contribute, timeout_s}`, headers `X-Api-Key-0..3`. Optional per-slot `history` (`[{role, content}]`) lets each model continue its own conversation. |
| `GET /api/v1/leaderboard` | aggregates; `grouping, modality, family, provider, period, mode, min_runs, hide_insufficient, sort, order, w_*`, `cursor` |
| `GET /api/v1/pricing` | `search`, `cursor` |
| `POST /api/v1/pricing/research` | 429 + `Retry-After` during cooldown |
| `GET /api/v1/models` | `family`, `search`, `cursor` |

`config` = `{modality: "chat"|"vision"|"image_gen", prompt, system?, history?: [{role, content}], images?: [dataURL], image_size?, params?: {temperature, max_tokens, top_p, frequency_penalty, presence_penalty, seed, stop}}`.

### SSE events

Each event is `event: <type>` + `data: <json>`; arena events include `"slot": n`.

| Event | Data |
|---|---|
| `start` | `model, canonical_key, family` |
| `delta` | `text` |
| `image` | `url` (data URL or https) |
| `error` | `category` |
| `metrics` | `status, error_category, ttft_ms, ttft_supported, total_ms, prompt_tokens, completion_tokens, total_tokens, tokens_estimated, throughput_tps, cost_usd` |
| `done` | playground: `contributed`; arena: `strategy, contributed, total_cost_usd` |

### Example (Python)

```python
import httpx, json

async def ask(prompt: str, key: str) -> str:
    body = {"base_url": "https://openrouter.ai/api/v1", "model": "openai/gpt-4o-mini",
            "config": {"prompt": prompt}, "contribute": True}
    out = []
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream("POST", "http://sandroid:8000/api/v1/playground/run",
                                 json=body, headers={"X-Api-Key": key}) as resp:
            event = None
            async for line in resp.aiter_lines():
                if line.startswith("event: "):
                    event = line[7:]
                elif line.startswith("data: ") and event == "delta":
                    out.append(json.loads(line[6:])["text"])
    return "".join(out)
```

## Integration rules

- **Never** persist the keys you pass — the same policy applies to integrators (see CONTRIBUTING.md).
- Rate limits are per client IP. A server-side integrator shares one IP: raise `RATE_LIMIT_*` for private deployments, or keep the service internal.
- Set `TRUST_PROXY_HEADERS=true` only when a trusted proxy sets `X-Forwarded-For`/`CF-Connecting-IP`.
- The rate limiter and cooldown are in-memory → run **one** instance. Multi-instance: replace `TokenBucketLimiter`/`ArenaGuard` (same methods) with a Postgres-backed implementation; no Redis needed.
