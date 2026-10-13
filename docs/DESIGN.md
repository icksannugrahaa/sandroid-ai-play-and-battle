# Sandroid AI Play & Battle — Design Document

> **Status:** Final (Brainstorm v3, revisi r1) — siap implementasi
> **Revisi r3 (2026-10-02):** Normalizer §5 — segmen terakhir yang hanya berupa versi (mis. `…/text-to-image/3.2`) digabung dengan segmen sebelumnya agar tidak bertabrakan (ditemukan saat uji data harga nyata).
> **Revisi r2 (2026-10-02):** UI dibuat **sederhana, elegan, dan seringan mungkin** — lihat §3 "Prinsip UI ringan".
> **Revisi r1 (2026-10-02):** Python dipin ke **3.14** (bukan 3.12) — memakai interpreter yang tersedia di environment; ekosistem async (SQLAlchemy 2.0.4x, pydantic 2.12+, asyncpg 0.30+) sudah mendukung 3.14.
> **Repo:** `sandroid-ai-play-and-battle` (public, MIT)
> **Tanggal:** 2025 — hasil sesi brainstorming, semua keputusan terkunci di §1

---

## 1. Keputusan Terkunci

| # | Poin | Keputusan |
|---|---|---|
| 1 | Repo | Terpisah dari bot-sandroid, **public**, dapat di-embed sebagai vendor di project lain |
| 2 | Stack | FastAPI (Python 3.14 pinned) + React 18 + TypeScript + PostgreSQL |
| 3 | API Key | **Zero persistence** — memory-only di client, hilang saat refresh, tidak pernah disimpan di mana pun |
| 4 | Grouping model | **Exact + Family** (dua level, aturan ketat — hanya nama identik yang digabung) |
| 5 | Leaderboard | Metrik objektif saja, agregat-only, ranking filterable, Load More tanpa batas |
| 6 | Auth | **Tidak ada** — tidak ada panel admin, semua user setara |
| 7 | Retensi hasil run | 3 opsi client-side: ephemeral / localStorage / export-import JSON. Server hanya menyimpan metrik agregat |
| 8 | Arena | Battle-All (paralel) **atau** Sequential, maks 4 model |
| 9 | Pricing | Menu terpisah, **update otomatis via tombol Research saja** (cooldown 1 jam global), tidak boleh manual |
| 10 | Biaya | Semua pemakaian AI ditagihkan ke API key user — notice wajib di UI |
| 11 | Deployment | Docker **dan** PM2 (dua jalur warga kelas satu) |
| 12 | UI | **Dwibahasa ID/EN** |
| 13 | Export format | **JSON saja** (schema berversi) |
| 14 | Leaderboard opt-out | Toggle "Contribute to leaderboard" per-run, **default ON** |
| 15 | License | **MIT** |

---

## 2. Overview & Prinsip

Sandroid AI Play & Battle adalah web app mandiri untuk:

- **Playground** — menguji satu model AI (chat, vision, text-to-image, dst.) melalui endpoint OpenAI-compatible milik user sendiri
- **Arena** — menjalankan satu prompt ke 2–4 model sekaligus (paralel atau berurutan), dengan hasil side-by-side dan metrik lengkap (TTFT, elapsed, tokens, throughput, cost)
- **Leaderboard** — peringkat global model berdasarkan metrik objektif dari semua run yang pernah dilakukan semua user
- **Pricing Center** — tabel harga model yang diperbarui otomatis dari sumber publik

**Prinsip arsitektur:**

1. **Global, bukan internal** — tidak terkait AI router project mana pun. Endpoint + API key selalu dari user.
2. **Zero credential persistence** — key tidak pernah disimpan. Bukan janji: ditegakkan CI guard test (§11).
3. **Server = agregator metrik, bukan penyimpan konten** — prompt/output tidak pernah ke DB.
4. **No-auth by design** — permukaan serangan menyempit karena tidak ada yang bernilai untuk dicuri.
5. **Clean Architecture** — domain pure, terpisah total dari framework dan I/O.

---

## 3. Tech Stack

### Backend — FastAPI, Python 3.14 (pinned)

- Inti service adalah **I/O-bound proxy** (menunggu respons provider AI). Async (`asyncio` + `httpx.AsyncClient`) memberi throughput tertinggi: arena 4 model paralel + streaming token adalah pola natural asyncio.
- **Pin eksplisit Python 3.14** di `pyproject.toml`, Dockerfile, CI, dan docs (revisi r1 — sebelumnya 3.12). Versi dependency minimum dipilih yang sudah merilis wheel untuk 3.14.
- Pydantic v2 untuk validasi semua boundary.
- OpenAPI/Swagger otomatis → penting untuk repo public dan integrasi vendor.

### Frontend — React 18 + Vite + TypeScript + TailwindCSS

- **Zustand** untuk state credential — *tanpa `persist` middleware* → refresh = hilang (mekanisme teknis penjamin zero-persistence).
- **TanStack Query** untuk data fetching.
- Streaming via `fetch` + `ReadableStream` (bukan EventSource — arena butuh POST body).
- **i18n dwibahasa ID/EN** (react-i18next atau setara), EN sebagai fallback default.

**Prinsip UI ringan (revisi r2):**
- Tampilan **sederhana tapi elegan**: dark theme netral, tipografi sistem (tanpa web font), tanpa animasi berat.
- **Dependensi runtime minimal:** hanya React, React DOM, Zustand, TanStack Query. Tidak ada router library (hash router ~30 baris), tidak ada library i18n (modul `t()` in-house ~1 KB, dua kamus JSON), tidak ada icon pack / chart / UI kit.
- **Code-splitting per halaman** (`React.lazy`) — halaman pertama hanya memuat yang dibutuhkan.
- Tailwind v4 (CSS hasil build hanya berisi kelas yang dipakai).
- Rendering streaming hemat: token di-append ke state per frame, bukan re-render per token.
- Target: bundle awal JS < ~80 KB gzip.

### Database — PostgreSQL 16

- Docker-compose untuk dev; native/container untuk PM2 prod.
- SQLAlchemy 2.x async + Alembic untuk migrasi.

### Yang sengaja TIDAK dipakai (v1)

- **Redis / task queue** — arena dieksekusi dalam scope request + SSE, state pendek. Rate limit & cooldown in-memory (single instance). Jalur migrasi ke Postgres-based limiting sudah disiapkan bila multi-instance.
- **Auth library apa pun** — tidak ada auth.

---

## 4. Clean Architecture — Struktur Monorepo

```
sandroid-ai-play-and-battle/
├── backend/
│   ├── app/
│   │   ├── domain/                  # Pure, zero I/O, zero framework
│   │   │   ├── entities/            # CanonicalModel, RunMetrics, PricingEntry
│   │   │   ├── services/            # normalizer, family_extractor, metrics (pure)
│   │   │   └── ports/               # Abstract: ProviderClient, PricingSource, MetricsRepository
│   │   ├── application/             # Use cases (orchestration)
│   │   │   ├── run_playground.py
│   │   │   ├── run_arena.py         # strategi: parallel / sequential
│   │   │   ├── fetch_models.py
│   │   │   ├── research_pricing.py
│   │   │   └── leaderboard_query.py
│   │   ├── infrastructure/          # Implementasi ports
│   │   │   ├── providers/           # OpenAICompatibleClient (httpx async)
│   │   │   ├── pricing/             # OpenRouterSource, LiteLLMSource, fallback lain
│   │   │   ├── persistence/         # SQLAlchemy async repos + Alembic
│   │   │   └── security/            # SSRF guard, key redaction, rate limiter
│   │   ├── interfaces/              # FastAPI routers + DTO + SSE formatters
│   │   └── config.py                # pydantic-settings, semua via env
│   ├── tests/
│   └── pyproject.toml               # requires-python = ">=3.14,<3.15"
├── frontend/
│   ├── src/
│   │   ├── pages/                   # Playground, Arena, Leaderboard, Pricing, History, Endpoints
│   │   ├── components/
│   │   ├── stores/                  # credentials.ts (MEMORY-ONLY), history.ts (localStorage)
│   │   ├── api/                     # client + SSE consumer
│   │   ├── i18n/                    # id.json, en.json
│   │   └── types/
│   └── package.json
├── docker-compose.yml               # postgres + backend + frontend (dev)
├── Dockerfile                       # all-in-one: build frontend → static diserve FastAPI
├── ecosystem.config.js              # PM2 deployment
├── deploy.sh                        # PM2 deploy pipeline
├── aliases.json                     # kurasi alias model (community, via PR)
├── README.md                        # termasuk WARNING credential + biaya
├── SECURITY.md
├── PRIVACY.md
├── CONTRIBUTING.md                  # larangan eksplisit penyimpanan credential
├── docs/VENDOR.md                   # panduan embed ke project lain
└── LICENSE                          # MIT
```

**Aturan dependency:** `domain` tidak mengimpor apa pun dari `application`/`infrastructure`/`interfaces`. `normalizer`, `family_extractor`, `metrics` adalah pure function — testable tanpa mock.

---

## 5. Model Normalization (Exact + Family)

### Level 1 — Exact Canonical (identitas utama)

Aturan deterministic, berurutan:

1. **Strip namespace** — ambil segmen terakhir setelah `/` *(r3: bila segmen terakhir hanya versi tanpa huruf, mis. `3.2`, sertakan segmen sebelumnya → `text-to-image/3.2` → `texttoimage32`)*
2. **Lowercase**
3. **Hapus semua karakter non-alfanumerik** (`-`, `_`, `.`, `:`, spasi, `@`)

Verifikasi terhadap kasus nyata:

| Raw names | Canonical key | Hasil |
|---|---|---|
| `vl/DeepSeek-V1-Flash`, `dp/deepseek-v1-flash`, `gg/DeepseekV1Flash`, `deepseek-v1-flash` | `deepseekv1flash` | ✅ satu model |
| `qwen3.8` | `qwen38` | model A |
| `qwen3.8-max` | `qwen38max` | model B (terpisah) |
| `qwen3.8-2026-07-06` | `qwen3820260706` | model C (terpisah) |
| `prov/qwen3.8-max` vs `other/Qwen3.8Max` | `qwen38max` | ✅ satu model |

**Aturan keras:** hanya nama identik dengan penamaan berbeda yang digabung. Suffix bermakna (`-max`, tanggal versi, `-mini`, `-pro`) tidak pernah di-strip di level exact.

### Level 2 — Family (agregasi, bukan identitas)

Family diekstrak dari display name dengan memotong suffix varian via pattern list:

- Ukuran/tier: `-max`, `-mini`, `-pro`, `-turbo`, `-flash`, `-lite`, `-ultra`
- Tanggal versi: `\d{4}[-.]?\d{2}[-.]?\d{2}`
- Parameter size: `7b`, `70b`, `8x7b`, `a3b`, dst.
- Kuantitas: `fp8`, `int4`, `bf16`
- Role suffix: `-instruct`, `-chat`, `-latest`, `-base`, `:free`

Hasilnya: `qwen38`, `qwen38max`, `qwen3820260706` semua ber-family `qwen38` — **tetap tiga model terpisah** dengan statistik masing-masing. Family dipakai untuk:

- Filter/browsing UI ("lihat semua varian Qwen 3.8")
- Family-level leaderboard (agregasi performa seluruh varian)
- Perbandingan antar varian dalam satu family

### Koreksi alias tanpa admin panel

Kurasi lewat **`aliases.json` di repo** (community PR) — pola standar open source:

```json
{
  "aliases": [
    { "pattern": "deepseek-v1-flash", "canonical": "deepseekv1flash" }
  ]
}
```

Dimuat saat startup, meng-override hasil normalizer. Edge case salah-grouping diperbaiki via pull request, bukan UI.

---

## 6. Playground

- Pilih endpoint (dari daftar endpoint sesi ini) → fetch model list → pilih model.
- Mode: **chat**, **vision** (upload gambar + prompt), **text-to-image** (fase 2), video/audio (fase 3).
- Parameter panel: system prompt, temperature, max_tokens, top_p, dsb.
- Output streaming via SSE; metrik muncul setelah selesai (TTFT, total, tokens, throughput, cost estimasi).
- Setiap run menampilkan toggle **"Contribute to leaderboard"** (default ON) dan opsi penyimpanan client-side (§10).
- Capability model dideteksi dari metadata provider (misal field modality OpenRouter) atau heuristik nama; bisa di-override di UI sesi.

---

## 7. Arena

**Input:** 1 konfigurasi prompt (system, user, parameter, opsional gambar) + 2–4 model terpilih. Setiap slot model membawa `base_url` + `api_key` + `model_name` sendiri — boleh lintas provider.

### Mode Battle-All (paralel)

- Semua model dieksekusi konkuren (`asyncio.gather` + semaphore).
- Progress per model distream via SSE — 4 kolom terisi bersamaan.
- Cocok untuk perbandingan wall-clock.

### Mode Sequential (berurutan)

- Model dijalankan satu per satu sesuai urutan pilih.
- Menghindari rate limit provider dan kontensi bandwidth → pengukuran latency lebih murni.
- Ramah koneksi lambat; UI tetap 4 slot, terisi bertahap.

### Aturan bersama

- **Maks 4 model** — divalidasi di backend, bukan cuma UI.
- Timeout per model (default 120s, configurable per run).
- **Partial failure** — model error/timeout menampilkan error di card-nya; arena tetap selesai.
- Hasil akhir: tabel komparatif — output + TTFT + total elapsed + tokens + tokens/sec + cost + status.
- Strategi = dua strategy class di use case `run_arena` → mudah ditambah mode baru (tournament, dsb.).
- **Concurrency guard**: maks 2 arena aktif per IP (1 untuk battle-all) — mencegah satu user menyalakan 20 arena.

---

## 8. Metrik Objektif

Dicatat per run:

| Metrik | Sumber / catatan |
|---|---|
| **TTFT** (ms) | Butuh streaming; null + flag bila provider tidak support |
| **Total elapsed** (ms) | |
| **Prompt / completion / total tokens** | Field `usage`; fallback estimasi (chars ÷ 4) dengan flag `estimated=true` |
| **Throughput** (completion tokens/sec) | |
| **Cost** (USD) | Tabel pricing × usage; null bila harga unknown |
| **Status** | success / error / timeout |
| **Error category** | Enum saja: `auth`, `rate_limit`, `server`, `network`, `timeout`. **Pesan mentah tidak pernah disimpan** |
| **Konteks** | modality, mode (playground/arena + strategi), timestamp, provider label |

Tidak ada voting/ELO — murni angka.

---

## 9. Pricing Center

### Sumber harga publik (tanpa credential)

| Sumber | Bentuk | Prioritas |
|---|---|---|
| OpenRouter `GET /api/v1/models` | JSON publik, field `pricing` per model | 1 |
| LiteLLM `model_prices_and_context_window.json` (GitHub raw) | JSON publik, ratusan model | 2 |
| Sumber terstruktur lain (misal Helicone cost map) | JSON publik | 3 (fallback) |

### Flow tombol Research

1. Siapa pun klik **Research** → backend fetch semua sumber paralel.
2. Setiap entri dinormalisasi ke canonical key (normalizer yang sama).
3. Merge: prioritas sumber > kebaruan; simpan **provenance** (source, fetched_at) per entri.
4. Catat `research_logs` (sources_status JSONB, entries_updated, created_at).
5. **Cooldown 1 jam GLOBAL** (per instance, bukan per IP). Ditegakkan backend: in-memory timestamp + `research_logs.created_at` sebagai sumber kebenaran setelah restart. UI menampilkan countdown sisa waktu.

### Aturan keras

- UI pricing **read-only** — tidak ada form edit, tidak ada endpoint update manual.
- Model tanpa harga → tampil `-` / "unknown"; cost run = null.
- Research juga dapat **mengusulkan kandidat alias baru** (nama mirip yang belum ter-mapping) — ditulis sebagai usulan; tetap butuh PR ke `aliases.json` untuk jadi resmi.

### Menu Pricing menampilkan

Tabel: model → harga input/output per 1M token → sumber → terakhir diupdate → tombol Research + status research terakhir. Load More, tanpa batas.

---

## 10. Leaderboard (History Global = Peringkat Model)

**Definisi:** leaderboard ADALAH history global — berbentuk peringkat agregat model, bukan daftar run.

### Aturan API

- **Leaderboard API hanya mengembalikan agregat.** Tidak ada endpoint run-by-run sama sekali. Data individual run tidak pernah meninggalkan server (lihat analisis privasi §11).

### Kolom (semua sortable)

- Avg / P50 / P95 latency (total elapsed)
- Avg TTFT
- Avg throughput (tokens/sec)
- Avg cost per run
- Success rate (%)
- Total runs
- Recency (last tested)

### Filter

- Modality (chat / vision / image-gen / dst.)
- Family (dropdown dari family extractor)
- Provider yang pernah dipakai
- Periode (7 hari / 30 hari / all time)
- Mode asal data (playground / arena / semua)
- **Min-run threshold** — default 5 run; toggleable (model di bawah threshold diberi badge "insufficient data")

### Tampilan

- Toggle ranking **Exact vs Family**
- **Load More** (25 baris per muat) — tanpa batas atas, bukan numbered pagination
- **Composite score opsional** — normalisasi (throughput + reliability − latency − cost) dengan bobot via slider; formula ditampilkan transparan

### Implementasi

Materialized view Postgres (refresh berkala) atau query agregat + index — cukup untuk skala awal.

---

## 11. Security & Privacy (bagian terpenting — ditegakkan, bukan dijanjikan)

### 11.1 Credential Zero-Persistence

**Client:**
- Credential di Zustand store **in-memory, tanpa `persist`** → refresh = hilang.
- Tidak pernah masuk localStorage / sessionStorage / cookie / URL query param.
- Dikirim via header HTTPS per request.

**Server:**
- Key hidup hanya dalam scope request → diteruskan ke httpx → dibuang.
- Logging middleware **me-redact** header `Authorization`/`x-api-key` sebelum log apa pun.
- Exception handler men-sanitize error httpx (exception membawa objek request berisi header — di-strip sebelum masuk log/response).
- Response tidak pernah me-echo key.
- Model list cache (opsional): in-memory, TTL 5 menit, keyed by hash — **tidak pernah ke DB**.

### 11.2 Kebijakan localStorage GANDA (jangan tertukar)

| Data | localStorage? |
|---|---|
| **Credential / API key** | ❌ **TIDAK PERNAH** — memory-only, refresh = hilang |
| **History run (konten)** | ✅ **BOLEH** — opt-in user, tanpa credential apa pun |

### 11.3 Analisis Privasi Leaderboard — 4 Aturan Pengunci

Klaim: leaderboard aman karena hanya membagikan analisa performa, bukan prompt/auth/data pribadi. **Klaim ini valid SEPENUHNYA — dengan syarat 4 aturan berikut dipatuhi:**

1. **Toggle "Contribute to leaderboard"** per-run (default ON). Melindungi nama model privat (misal fine-tune internal `acme-corp-llm-v3`) agar tidak terekspos publik via leaderboard.
2. **API agregat-only.** Tidak ada endpoint yang mengembalikan run individual. Mencegah korelasi pola aktivitas per timestamp.
3. **Error kategori saja.** Pesan error mentah (bisa mengandung URL internal) tidak pernah disimpan — hanya enum kategori.
4. **IP tidak pernah persisten.** IP hanya hidup di memory untuk rate limiter; tidak ke DB, tidak ke log utuh.

Dengan 4 aturan ini, leaderboard secara privasi setara tabel benchmark publik (LMSYS/Artificial Analysis).

### 11.4 Anti-Kecurangan untuk Fork (repo public)

1. **README badge + section:** "This project NEVER stores provider credentials. Forks that add credential persistence violate project policy."
2. **SECURITY.md** — data flow credential + cara user memverifikasi sendiri (pointer ke kode redaction).
3. **PRIVACY.md** — apa yang disimpan (metrik agregat) dan apa yang tidak (credential, prompt, output, identitas).
4. **CONTRIBUTING.md** — larangan eksplisit menambah penyimpanan credential.
5. **CI Guard Test** — test yang GAGAL bila PR:
   - menambah kolom/field `api_key`/`secret`/`token`/`password` ke schema DB atau model persistensi, ATAU
   - menambah field konten (`prompt`, `output`, `messages`, `response`) ke schema DB, ATAU
   - menulis header auth ke file/log.
   → "Tidak menyimpan credential & konten" ditegakkan test, bukan itikad baik.

### 11.5 Keamanan Tanpa Auth — Risiko Tersisa & Mitigasi

| Risiko | Mitigasi |
|---|---|
| **SSRF** (server meneruskan ke URL arbitrary) | Validasi URL: hanya `https`; resolve DNS lalu **blokir IP private/loopback/link-local** (10.x, 172.16.x, 192.168.x, 127.x, 169.254.x); timeout ketat; batas ukuran respons |
| **Diborong / dipakai relay** | Rate limit per IP (token bucket in-memory): ketat untuk `/arena` & `/research`, longgar untuk read |
| **Payload raksasa** | Batas body 10 MB (vision upload), batas panjang prompt |
| **Error bocor** | Sanitasi semua error upstream → pesan generik + kategori; tidak ada traceback/secret ke client |
| **Abuse research** | Cooldown global 1 jam + konfirmasi UI |

### 11.6 Notice Biaya di UI

Semua pengeluaran AI (fetch model list, playground, arena) **ditagihkan ke API key yang diinput user**. Pengecualian: Pricing Research (sumber publik, tanpa key).

| Aktivitas | Ditagih ke key user? |
|---|---|
| Fetch model list (`/v1/models`) | Ya (umumnya gratis) |
| Playground run | Ya — token ditagih |
| Arena run (2–4 model) | Ya — **tagihan ×N model** |
| Pricing Research | **Tidak** |

**Penempatan notice:**
1. Form input endpoint/key: *"Semua biaya penggunaan AI ditagihkan ke API key yang Anda masukkan. Arena 4 model = 4× tagihan. Key tidak pernah disimpan — hilang saat refresh."* (versi EN tersedia)
2. Tombol Run arena: label sekunder `Run Battle-All (4 models — billed to your keys)`
3. Setelah run: estimasi cost per model + total, label *"estimated — charged to your API key"*
4. README + section Pricing: penjelasan yang sama

---

## 12. History Client-Side (3 Opsi Retensi)

Hasil run ditampilkan dan diproses **di client**. Tiga opsi (pilihan user):

1. **Ephemeral (default)** — tampil sekali, hilang saat navigasi/refresh. Server hanya mencatat metrik agregat (bila toggle contribute ON).
2. **Save ke localStorage** — hasil lengkap (prompt, output, metrik, konfigurasi arena) di browser user. History page membaca dari sini. Batas praktis: maks ~200 run terakhir (FIFO) dengan indikator sisa kapasitas.
3. **Export / Import** — export single run / satu arena / seluruh history sebagai **JSON** (schema berversi `sandroid-playground-export@v1`). Import memvalidasi versi schema lalu merestore tampilan history. **Tidak ada CSV.**

**History page murni client-side** — tidak ada request ke server, tidak ada konsep "My Runs" di server.

### Konsekuensi skema server

Karena leaderboard agregat-only dan history pindah ke client, **server tidak menyimpan prompt, output, maupun identitas client sama sekali.**

---

## 13. Database Schema (PostgreSQL)

| Tabel | Kolom kunci |
|---|---|
| `canonical_models` | id, canonical_key (unique), display_name, family, modality flags, first_seen |
| `model_aliases` | raw_name, canonical_key, source (`auto` / `aliases.json`) |
| `runs` | id, canonical_model_id, raw_model_name, provider_label, modality, mode, arena_session_id (nullable), ttft_ms, total_ms, prompt_tokens, completion_tokens, tokens_estimated (bool), cost_usd, status, error_category, created_at — **TANPA prompt/output/client identity** |
| `arena_sessions` | id, strategy (parallel/sequential), created_at — **TANPA prompt snapshot** |
| `pricing_entries` | canonical_key, input_per_1m, output_per_1m, image_price (nullable), currency, source, fetched_at |
| `research_logs` | id, sources_status (JSONB), entries_updated, created_at — **TANPA ip_hash** |

**Tidak ada tabel/kolom credential — CI guard test memastikan itu tetap begitu selamanya.**

---

## 14. API Surface

| Endpoint | Fungsi |
|---|---|
| `POST /api/v1/models/fetch` | Proxy ambil model list dari base_url + key user (no-store) |
| `POST /api/v1/playground/run` | 1 model, SSE stream |
| `POST /api/v1/arena/run` | 2–4 model, param strategy, SSE stream per model |
| `GET /api/v1/leaderboard` | **Agregat saja** + filter/sort + cursor Load More |
| `GET /api/v1/pricing` | Tabel harga + provenance + Load More |
| `POST /api/v1/pricing/research` | Trigger auto-update (cooldown 1 jam global) |
| `GET /api/v1/models` | Canonical models + aliases yang pernah terlihat |

**Tidak ada endpoint history server-side. Tidak ada endpoint run-by-run.**

---

## 15. Frontend — Halaman

1. **Playground** — picker model, parameter panel, mode chat/vision/image, stream output, metrik, toggle contribute, opsi simpan/export
2. **Arena** — picker 2–4 model (endpoint per slot), toggle **Battle-All / Sequential**, 4 kolom live, tabel komparatif
3. **Leaderboard** — tabel sortable + filter bar (modality, family, provider, periode, min-runs), toggle exact/family, slider composite, **Load More**
4. **Pricing** — tabel read-only + tombol Research (countdown cooldown) + log research terakhir, **Load More**
5. **History** — render dari localStorage / file import; detail run lengkap; tombol export JSON; indikator kapasitas
6. **Endpoints** — form base_url + key (memory-only), daftar endpoint sesi, banner: *"Credentials are never stored. Refreshing this page clears them."* / *"Kredensial tidak pernah disimpan. Refresh halaman akan menghapusnya."*

**i18n:** semua copy dwibahasa `id.json` + `en.json`.

---

## 16. Deployment

### Opsi A — Docker (adopter publik)

- `docker-compose.yml`: postgres + backend (hot reload) + frontend Vite dev (dev)
- Dockerfile multi-stage: build React → static diserve FastAPI → 1 container + postgres (prod)
- Image dipublish ke ghcr.io via CI

### Opsi B — PM2

- **Prasyarat:** PostgreSQL (native atau container terpisah — PM2 tidak mengelola DB), Node.js (build frontend), **Python 3.14 pinned**
- **Backend:** PM2 menjalankan `uvicorn` (atau gunicorn + uvicorn workers) via `ecosystem.config.js`
- **Frontend:** `npm run build` → `dist/` diserve FastAPI sebagai static files → tetap 1 proses PM2
- **Migrasi:** `alembic upgrade head` (langkah deploy eksplisit)
- **Deploy pipeline** (`deploy.sh`): `git pull → pip install → npm ci && npm run build → alembic upgrade head → pm2 reload`
- **Env:** `.env` untuk `DATABASE_URL`, `CORS_ORIGINS`, rate limit config
- Di balik Nginx/Cloudflare; log 400/404 dari scanner internet adalah hal normal
- Mode PM2 = single instance → in-memory rate limiter valid. Multi-instance nanti: pindah ke Postgres-based limiting (jalur disiapkan, tanpa Redis)

### Vendor integration

Project lain (misal bot WhatsApp) cukup menambah service ini di compose/ecosystem mereka + konsumsi REST API. `docs/VENDOR.md`: arsitektur integrasi, CORS, daftar endpoint stabil, versioning `/api/v1/`.

---

## 17. Testing & CI

- **Domain unit tests** (pure, cepat): normalizer golden cases (DeepSeek 4 varian → 1 group; qwen3.8 tiga varian → 3 model), family extractor, metrics calculator, pricing merge
- **Integration tests:** repo layer dengan testcontainers Postgres
- **Contract tests:** mock provider server untuk client
- **CI Guard Test** (§11.4) — **wajib**, penegak janji no-credential & no-content
- GitHub Actions: lint (ruff), typecheck (mypy), pytest, frontend (tsc + vitest + build)

---

## 18. Roadmap

- **Fase 1:** Skeleton monorepo + CI + domain (normalizer/metrics) + provider client + Playground chat & vision (SSE) + Arena 2 mode + metrik + Pricing research (cooldown) + Leaderboard agregat + History client-side (3 opsi) + Docker & PM2 + i18n ID/EN
- **Fase 2:** Text-to-image + composite score slider + family leaderboard view + publish image ghcr.io + VENDOR.md final
- **Fase 3:** Video (job-based async + polling tracker), audio, adapter provider non-OpenAI-compatible (Anthropic/Gemini native di `infrastructure/providers/`)

---

## 19. Checklist Inisialisasi Repo

- [ ] Buat repo `sandroid-ai-play-and-battle` (public)
- [ ] Tambahkan `LICENSE` — **MIT** (belum ada di GitHub, tambahkan sejak commit pertama)
- [ ] `README.md` — overview + WARNING credential + notice biaya + badge "NEVER stores credentials"
- [ ] `SECURITY.md`, `PRIVACY.md`, `CONTRIBUTING.md`
- [ ] `aliases.json` kosong + format terdokumentasi
- [ ] CI pipeline termasuk **credential guard test**
- [ ] `docker-compose.yml` + `Dockerfile` + `ecosystem.config.js` + `deploy.sh`
- [ ] Pin Python 3.14 di semua tempat (pyproject, Dockerfile, CI, docs)

---

*Dokumen ini adalah hasil final sesi brainstorming. Perubahan keputusan di §1 harus dicatat sebagai revisi versi dokumen.*
