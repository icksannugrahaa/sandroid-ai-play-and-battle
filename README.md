<div align="center">

<img src="frontend/public/logo-sandroid.svg" alt="Sandroid" width="120" />

# Sandroid AI Play & Battle

![CI](https://github.com/icksannugrahaa/sandroid-ai-play-and-battle/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)
![Python 3.14](https://img.shields.io/badge/python-3.14-blue)
![Never stores credentials](https://img.shields.io/badge/credentials-NEVER%20stored-brightgreen)

Test, battle, and rank **any OpenAI-compatible model** using **your own API key**.

Bring your own endpoint (OpenAI, OpenRouter, Together, Groq, Ollama, LM Studio, vLLM, …) and compare models head-to-head in a single, privacy-first web app: chat, vision, image generation, multi-model battles, auto-scored intelligence challenges, and a global leaderboard — all without the server ever seeing your prompts or keys.

</div>

---

## Table of contents

- [Why this project](#why-this-project)
- [Features](#features)
- [Credentials & cost model](#-credentials--cost-model)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [API](#api)
- [Model grouping](#model-grouping)
- [Architecture](#architecture)
- [Testing](#testing)
- [Contributing](#contributing)
- [License](#license)

---

## Why this project

Most "model comparison" tools either run everything server-side (your prompts and key flow through someone else's machine) or lock you into a single gateway. Sandroid is built the other way around:

- **Your key stays yours.** Credentials live only in browser memory — never persisted, never logged.
- **Any OpenAI-compatible endpoint.** If it speaks the OpenAI API, it works here.
- **Metrics, not content.** Only aggregate performance data (latency, tokens, cost, status) is ever stored, and only if you opt in per run.

## Features

### Playground

Chat, vision (image + prompt), and text-to-image against a single model, streamed live, with TTFT / latency / tokens / throughput / cost shown per answer.

### Arena

Send one prompt to 2–4 models — including across providers — in **Battle-All** (parallel) or **Sequential** mode, with a side-by-side comparison table that highlights the winner of each metric. Multi-turn battles keep each model on its own line of work: every follow-up is sent to all models together with *that model's own* previous answers (round-by-round results, collapsible history, lineup locked until you start a new battle).

### Challenge mode 🏆

Auto-scored intelligence tests, run inside the Arena. Every model receives the same **generated** puzzle (seeded → replayable, impossible to memorise); answers are checked in your browser and scored 0–100, with a visual replay per model and a cross-puzzle scoreboard.

- **14 challenges × 3 difficulties:** 🧊 Rubik's Cube · 🗺️ maze route · 🛣️ cheapest route (weighted graph) · 🧩 8-puzzle · 🫗 water jugs · 🔢 Sudoku · 🛡️ Knights & Knaves · 🟦 ARC-style pattern grids · 🎯 Countdown numbers · 🧮 exact big-number arithmetic · 🔤 letter-level tasks ("strawberry") · 📏 instruction following (IFEval-style) · 💻 coding (JS run against hidden tests in a sandboxed Worker) · 🧷 needle-in-a-haystack.
- Each puzzle starts fresh (no chat history). **Run all** queues every challenge and waits out the server's rate limit automatically.
- Every model gets **its own 3D board** (three.js, lazy-loaded): live thinking while it works, then a step-by-step replay of the answer — cube turns, a ball rolling through the maze, tiles sliding, jugs filling, Sudoku tiles dropping in, route markers travelling, ARC voxels rising — with play/pause, scrub, and speed controls.

### Leaderboard

Global, **aggregate-only** rankings built from contributed runs: avg/P50/P95 latency, TTFT, throughput, cost, and success rate. Filter by modality, family, provider, period, or source; switch between exact-model and family views; apply an optional composite score with adjustable weights.

### Pricing

A read-only price table auto-updated from public sources (OpenRouter, LiteLLM, Helicone) via a **Research** button with a global one-hour cooldown.

### History

Stays in *your* browser (optional) and is exportable/importable as versioned JSON.

### Composer & input

Type and attach anything via 📎, drag & drop, or paste: images (vision is automatic), audio (WAV/MP3 → `input_audio`), PDFs and other documents (`file` part), and code/text files (inlined as fenced blocks so every model can read them). Enter sends, Shift+Enter adds a line; system prompt and parameters live under **Advanced settings**.

### Output & rendering

- **Full-width chat** — every answer keeps its own live metrics (status, TTFT, total, tokens, tok/s, cost); the composer is pinned to the bottom.
- **Source viewer** — `</> Source` on any code block or running app opens a full-screen viewer with one tab per file plus the combined runnable document, line numbers, highlighting, copy, and download.
- **Rich output** — markdown with syntax-highlighted code (copy / download as `.py`, `.js`, `.html`…), live **HTML preview** in an isolated sandbox, CSV/JSON/SVG previews, and a media & file gallery (images, video, audio, PDF, Word, Excel); other files open or download in one click.
- **Runnable apps & games** — when a model answers with HTML (a single file, or `index.html` + `style.css` + `game.js` blocks), it is merged and **starts automatically** once that model's answer finishes. Compare four generated games side by side in the Arena; ⟳ Restart and ⛶ Fullscreen per game; games may use `localStorage` via an in-memory shim.
- **Animations & JS-only answers** — CSS/canvas/SVG animations run the same way, and even JavaScript-only answers (p5.js, three.js, GSAP/anime.js/D3/Matter.js/Chart.js) are wrapped into a page automatically, with libraries loaded from jsDelivr (ES-module imports via an import map). Non-visual or Node.js snippets are left as code. Animations **pause automatically when scrolled off screen** without losing state.
- **Runtime errors visible** — if generated code or a CDN script fails, the player shows ⚠ with the exact messages, so broken outputs are easy to spot.
- **Live thinking** — reasoning models (DeepSeek, Qwen, Kimi, OpenRouter `reasoning`) stream their thought process into a 💭 panel. Displayed only; never stored or sent back as history.

### Model handling & operations

- **Mode-aware model list** — in *Text → Image* only image-capable models are listed (dedicated generators such as DALL·E/FLUX/Imagen, plus chat models that draw, e.g. `gemini-*-image`, `qwen-image`, nano-banana); chat mode hides image-only models; "show all" overrides. If a gateway lacks `/images/generations` for a model, the request automatically falls back to chat with `modalities: ["image","text"]`.
- **Models know they have a browser** — by default a short note in the system prompt tells every model that HTML/JS code blocks are executed live here, so "run this code" yields runnable code. Pasted or attached HTML/JS can also be run directly with **▶ Run code** — locally, no AI call, no cost. The exact note is shown and toggleable under ⚙ Settings.
- **Costs for router variants** — when a model id carries a config suffix the price list doesn't know (`gemini-3.6-flash-low`, `o3-high`, `…-thinking`), cost is estimated from the base model's price and marked **≈**.
- **Session usage** — Playground and Arena each show runs, models, tokens (in/out), and estimated cost for this tab, with a per-model breakdown.
- **Session budget** — each workspace holds up to **50 MB** of results and game saves in memory; when full, new runs are blocked until you click **Clear cache** (browser History is separate).
- UI available in **English and Bahasa Indonesia**. Light by design: ~53 KB gzipped initial JavaScript.

- **Playground** — chat, vision (image + prompt) and text-to-image against one model, streamed live, with TTFT / latency / tokens / throughput / cost.
- **Arena** — one prompt, 2–4 models (across providers), **Battle-All** (parallel) or **Sequential**, side-by-side with a comparison table that highlights the winner of each metric.
- **Multi-turn battles** — keep chatting in the Arena: each follow-up goes to every model together with *that model's own* previous answers, so each one continues its own line of work (round-by-round results, older rounds collapsible, lineup locked until ⟲ New battle).
- **Challenge mode (🏆)** — auto-scored intelligence tests in the Arena. Every model gets the same **generated** puzzle (seeded → replayable, can't be memorised); answers are checked in your browser and scored 0–100, with a visual replay per model and a scoreboard across puzzles. 14 challenges × 3 difficulties: 🧊 Rubik's Cube, 🗺️ maze route, 🛣️ cheapest route (weighted graph), 🧩 8-puzzle, 🫗 water jugs, 🔢 Sudoku, 🛡️ Knights & Knaves, 🟦 ARC-style pattern grids, 🎯 Countdown numbers, 🧮 exact big-number arithmetic, 🔤 letter-level tasks ("strawberry"), 📏 instruction following (IFEval-style), 💻 coding (JS run against hidden tests in a sandboxed Worker), 🧷 needle-in-a-haystack (long context). Each puzzle starts fresh (no chat history); **Run all** queues every challenge and waits out the server's rate limit automatically. Every model gets **its own 3D board** (three.js, lazy-loaded): while it works you see its live thinking, and when it answers, the answer is **replayed step by step** on its board — cube turns, a ball rolling through the maze, tiles sliding, jugs filling, Sudoku tiles dropping in, route marker travelling, ARC voxels rising — with play/pause, scrub and speed controls.
- **Leaderboard** — global, **aggregate-only** rankings built from every contributed run: avg/P50/P95 latency, TTFT, throughput, cost, success rate; filter by modality, family, provider, period, source; exact-model or family view; optional composite score with adjustable weights.
- **Pricing** — read-only price table auto-updated from public sources (OpenRouter, LiteLLM, Helicone) by a **Research** button with a global 1-hour cooldown.
- **History** — stays in *your* browser (optional), exportable/importable as versioned JSON.
- **Chat-style composer** — type and attach anything via 📎, drag & drop or paste: images (vision is automatic), audio (WAV/MP3 → `input_audio`), PDFs and other documents (`file` part), code/text files (inlined as fenced blocks so every model can read them). Enter sends, Shift+Enter adds a line; system prompt and parameters live under *Advanced settings*.
- **Full-width chat** — the Playground is a regular chat: every answer keeps its own live metrics (status, TTFT, total, tokens, tok/s, cost); the composer is pinned at the bottom with endpoint/model and ⚙ Settings below it.
- **Source viewer** — `</> Source` on any code block or running app opens a full-screen viewer: one tab per file plus the combined document that runs, line numbers, highlighting, copy & download.
- **Live thinking** — reasoning models (DeepSeek, Qwen, Kimi, OpenRouter `reasoning`) stream their thought process into a 💭 panel, so a long think isn't a blank wait. Shown only; never stored or sent back as history.
- **Session usage** — Playground and Arena each show runs, models, tokens (in/out) and estimated cost used in this tab, with a per-model breakdown.
- **Mode-aware model list** — in *Text → Image* only image-capable models are listed (dedicated generators such as DALL·E/FLUX/Imagen *and* chat models that draw, e.g. `gemini-*-image`, `qwen-image`, nano-banana); chat mode hides image-only models; "show all" overrides. If a gateway has no `/images/generations` for a model, the request automatically falls back to chat with `modalities: ["image","text"]`.
- **Rich output** — answers render as markdown with syntax-highlighted code (copy / download as `.py`, `.js`, `.html`…), live **HTML preview** in an isolated sandbox, CSV/JSON/SVG previews, and a media & file gallery: images, video, audio (incl. OpenAI-style streamed audio), PDF, Word (.docx), Excel (.xlsx); other files (pptx, zip…) open or download in one click.
- **Runnable apps & games** — when a model answers with HTML (single file, or `index.html` + `style.css` + `game.js` blocks), it is merged and **starts automatically** as soon as that model's answer finishes — compare 4 generated games side by side in the Arena. ⟳ Restart and ⛶ Fullscreen per game; games can use `localStorage` (served by an in-memory shim, kept across restarts).
- **Models know they have a browser** — by default a short note in the system prompt tells every model that HTML/JS code blocks are executed live in this app, so "run this code" gets runnable code instead of "I can't run code" (toggle under ⚙ Settings, with the exact note shown). Pasted or attached HTML/JS can also be run directly with **▶ Run code** — locally, no AI call, no cost.
- **Animations, auto-run** — CSS/canvas/SVG animations run the same way; even **JavaScript-only** answers (a p5.js sketch, a three.js module, GSAP/anime.js/D3/Matter.js/Chart.js code) are wrapped into a page automatically, with the library loaded from jsDelivr (ES-module imports via an import map) and referenced `#canvas`/`#id` elements created. Non-visual or Node.js snippets are left as code. Animations **pause automatically when scrolled off screen** (and on ⏸) without losing their state.
- **Runtime errors visible** — if generated code crashes (e.g. an API missing from the three.js version it loads) or a CDN script fails, the player shows ⚠ with the exact messages, so broken outputs are easy to spot when comparing models.
- **Costs for router variants** — when a model id carries a config suffix the price list doesn't know (`gemini-3.6-flash-low`, `o3-high`, `…-thinking`), the cost is estimated from the base model's price and marked **≈**.
- **Session budget** — each workspace (Playground / Arena) holds up to **50 MB** of results and game saves in memory; when full, new runs are blocked until you click **Clear cache** (browser History is separate).
- UI in **English and Bahasa Indonesia**. Light by design: ~53 KB gzipped initial JavaScript.

---

## ⚠️ Credentials & cost model

> **This project NEVER stores provider credentials.** Forks that add credential persistence violate project policy.

- Your endpoint URL and API key live **only in the memory of your browser tab**. Refreshing the page clears them. They are never written to localStorage, sessionStorage, cookies, URLs, the server's database, or its logs.
- Optional **Keep session** (Off / 1 / 3 / 6 / 12 / 24 h, in ⚙ Settings or on Endpoints) keeps chats, battles, settings, and endpoint URLs across refreshes in this browser (IndexedDB). API keys are still never saved — re-enter them after a refresh.
- The key is sent per request as a header (`X-Api-Key`, or `X-Api-Key-0..3` in the Arena), forwarded to *your* endpoint, and discarded when the request ends.
- **All AI usage is billed to the API key you enter.** An Arena with 4 models costs **4×** a single run. Pricing Research uses public data only and is never billed.
- The server stores **metrics only** (latency, tokens, cost, status, model name, provider host) — never prompts, outputs, or identity. Uncheck **"Contribute to leaderboard"** to store nothing at all for a run.

This is enforced by a CI guard test, not just promised — see [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md).

| Activity | Billed to your key? |
|---|---|
| Fetch model list (`/v1/models`) | Yes (usually free) |
| Playground run | Yes — tokens |
| Arena run (2–4 models) | Yes — **×N models** |
| Pricing Research | **No** |

---

## Quick start

### Docker (recommended)

```bash
POSTGRES_PASSWORD=change-me docker compose -f docker-compose.prod.yml up -d --build
```

Open http://localhost:8000. Migrations run automatically on container start (`RUN_MIGRATIONS=true`).
A prebuilt image is published to `ghcr.io/icksannugrahaa/sandroid-ai-play-and-battle`.

### Development

```bash
docker compose up --build        # postgres + backend (reload) + Vite → http://localhost:5173
```

Without Docker (Python **3.14** and Node 20+):

```bash
cd backend && python3.14 -m venv .venv && .venv/bin/pip install -e ".[dev]"
cp ../.env.example .env          # set DATABASE_URL (Postgres, or sqlite+aiosqlite:///./dev.db)
.venv/bin/alembic upgrade head
.venv/bin/uvicorn --factory app.main:create_app --reload --no-access-log
# second terminal
cd frontend && npm ci && npm run dev
```

No API key handy? `backend/scripts/mock_provider.py` is a fake OpenAI-compatible server for local demos
(see its docstring — it needs `SSRF_ALLOW_PRIVATE=true SSRF_ALLOW_HTTP=true`, **local only**).

### Deploy with PM2

Prerequisites: PostgreSQL (PM2 does not manage it), Node.js, **Python 3.14**, PM2.

```bash
cp .env.example backend/.env     # edit DATABASE_URL, TRUST_PROXY_HEADERS=true behind a proxy
./deploy.sh                      # git pull → pip install → npm ci && build → alembic upgrade head → pm2 reload
```

`ecosystem.config.js` runs a **single** uvicorn process (the in-memory rate limiter assumes one instance) serving both the API and the built UI on `127.0.0.1:8000`. Put Nginx/Cloudflare in front; 400/404 noise from internet scanners in the logs is normal.

---

## Configuration

All settings are environment variables — see [.env.example](.env.example). Highlights:

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://…/sandroid` | PostgreSQL 16 (SQLite works for local dev/tests) |
| `TRUST_PROXY_HEADERS` | `false` | Read client IP from `CF-Connecting-IP`/`X-Forwarded-For` for rate limiting |
| `CORS_ORIGINS` | *(empty)* | Only needed if the UI is on another origin |
| `RATE_LIMIT_*_PER_MIN` | 120 / 30 / 10 / 5 | read / run / arena / research, per IP |
| `ARENA_MAX_ACTIVE_PER_IP` | `2` (`1` Battle-All) | concurrent arenas per IP |
| `RESEARCH_COOLDOWN_SECONDS` | `3600` | global cooldown for Pricing Research |
| `SSRF_ALLOW_PRIVATE` / `SSRF_ALLOW_HTTP` | `false` | self-hosted only (e.g. Ollama on your LAN). **Never on a public deployment.** |

## API

OpenAPI docs at `/api/docs`. Stable, versioned under `/api/v1/`:

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/models/fetch` | Proxy your endpoint's model list (no-store) |
| `POST /api/v1/playground/run` | One model, SSE stream |
| `POST /api/v1/arena/run` | 2–4 models, `parallel`/`sequential`, SSE stream per slot |
| `GET /api/v1/leaderboard` | **Aggregates only**, filters/sort, cursor “Load More” |
| `GET /api/v1/pricing` | Price table + provenance, cursor “Load More” |
| `POST /api/v1/pricing/research` | Refresh prices (1 h global cooldown) |
| `GET /api/v1/models` | Canonical models + aliases seen |

There is deliberately **no** server-side history endpoint and **no** run-by-run endpoint. Embedding this service in another project: [docs/VENDOR.md](docs/VENDOR.md).

## How models are grouped

Two levels ([docs/DESIGN.md §5](docs/DESIGN.md)):

1. **Exact** (identity) — strip namespace, lowercase, drop non-alphanumerics: `vl/DeepSeek-V1-Flash`, `gg/DeepseekV1Flash` → `deepseekv1flash`. Meaningful suffixes are never dropped: `qwen3.8`, `qwen3.8-max`, `qwen3.8-2026-07-06` stay three models.
2. **Family** (aggregation) — variant suffixes (`-max`, dates, `70b`, `fp8`, `-instruct`, `:free`…) trimmed: all three above are family `qwen38`.

Wrong grouping? Fix it with a pull request to [`aliases.json`](aliases.json) — there is no admin panel.

## Architecture

FastAPI (Python 3.14, async httpx, SQLAlchemy 2 async, Alembic) + React 18 / Vite / TypeScript / Tailwind / Zustand / TanStack Query, organized as Clean Architecture:

```
backend/app/domain          pure entities + services (normalizer, family, metrics, pricing merge) + ports
backend/app/application     use cases: run_playground, run_arena (parallel/sequential strategies), research_pricing, leaderboard_query
backend/app/infrastructure  OpenAI-compatible client, pricing sources, SQLAlchemy repos, SSRF guard, redaction, rate limits
backend/app/interfaces      FastAPI routers, DTOs, SSE, middleware
frontend/src                pages, components, stores (credentials = memory-only), api (SSE consumer), i18n
```

Full design: [docs/DESIGN.md](docs/DESIGN.md).

## Testing

```bash
# Backend: unit, contract, integration (SQLite), and the CI credential guard
cd backend && .venv/bin/pytest

# Integration against PostgreSQL
TEST_DATABASE_URL=postgresql+asyncpg://… .venv/bin/pytest tests/integration

# Frontend: type-check, unit tests, production build
cd frontend && npm test && npx tsc -b
```

### Continuous integration

The workflow in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every **pull request** and **push** to the `main` branch. It enforces:

- **Credential & content guard** — fails if credentials or message content could be persisted or logged.
- **Backend** — Ruff lint/format, MyPy, pytest on SQLite, Alembic up/down/up on PostgreSQL, and pytest integration against PostgreSQL.
- **Frontend** — `tsc -b`, Vitest, and a production build.
- **Docker** — the production image builds successfully.

A separate [publish workflow](.github/workflows/publish.yml) pushes the production image to GHCR on `main` and on `v*` tags.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Please open an issue to discuss significant changes before submitting a pull request, and make sure `pytest`, `ruff`, `mypy`, `npm test`, and `tsc -b` pass locally.

## License

[MIT](LICENSE)
