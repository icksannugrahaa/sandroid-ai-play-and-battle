# Security

## Credential data flow

```
Browser tab memory (Zustand store, no persistence)
   │  per request: header X-Api-Key / X-Api-Key-N  (HTTPS)
   ▼
FastAPI request scope ──► httpx request to YOUR endpoint (Authorization: Bearer …)
   │
   └─ request ends → key is garbage. Never in DB, files, logs, responses, or caches.
```

| Where | What guarantees it | Verify it yourself |
|---|---|---|
| Browser | `frontend/src/stores/credentials.ts` is a plain Zustand store without `persist`; refresh = gone | Add a key, refresh, inspect Application → Storage: nothing |
| Transport | Key only in request headers, never in URL/query | `frontend/src/api/client.ts` (`keyHeader`) |
| Server code | Key is a function argument of the provider call; `RunTarget.api_key` has `repr=False` | `backend/app/application/execution.py`, `backend/app/infrastructure/providers/openai_compatible.py` |
| Logs | Access log has method/path/status/duration/masked IP only; a `RedactingFilter` scrubs bearer tokens, `sk-…`, `api_key=…` from **every** log record | `backend/app/interfaces/middleware.py`, `backend/app/infrastructure/security/redaction.py` |
| Errors | Upstream failures become `ProviderError(category)`; httpx exceptions (which reference request headers) are never chained, logged, or returned | `backend/app/interfaces/errors.py` |
| Model list cache | In memory, 5-min TTL, keyed by SHA-256(endpoint+key) — never the key itself, never the DB | `backend/app/application/fetch_models.py` |
| Database | No credential, content, or identity columns exist | `backend/app/infrastructure/persistence/orm.py` |

**CI guard** — `backend/tests/guard/test_no_credentials_or_content.py` fails the build if a change adds credential/content/identity columns (ORM or migrations), logs or prints keys/headers, handles auth header names outside four reviewed modules, writes files from app code, or makes the frontend credential store persistent.

## No-auth threat model

There are no accounts and no admin panel: nothing valuable sits on the server to steal. Remaining risks and mitigations:

| Risk | Mitigation |
|---|---|
| **SSRF** (server calls arbitrary URLs) | https only; no userinfo/query/fragment in base URLs; DNS-resolved addresses checked against private, loopback, link-local, CGNAT, multicast, reserved and IPv4-mapped ranges; the check runs **again at connect time** inside a custom httpcore network backend (defeats DNS rebinding) while TLS still verifies the original hostname; redirects disabled; proxy env ignored; response size capped |
| Abuse as a free relay | Users bring their own keys; per-IP token-bucket rate limits (strict for arena/research); max 2 active arenas per IP (1 Battle-All) |
| Huge payloads | 10 MB body cap (streamed check), prompt length limits, max 4 images (data URLs only) |
| Error leakage | Generic messages + enum category; validation errors never echo input |
| Research abuse | Global 1-hour cooldown (survives restarts via `research_logs`), UI confirmation |
| Untrusted model output (XSS) | Markdown is sanitized with DOMPurify (no scripts, styles, images, unsafe link schemes); generated HTML runs only in `<iframe sandbox="allow-scripts">` **without** `allow-same-origin`, so it cannot reach this app, its in-memory keys or storage; generated apps/games get `allow-scripts allow-modals allow-forms allow-pointer-lock` (still no same-origin) and talk to the app only through a `postMessage` storage protocol accepted solely from their own frame; DOCX renders in a script-less sandboxed iframe; SVG only via `<img>`; HTML/SVG are never opened as same-origin blob URLs |
| Clickjacking / sniffing | `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on the API |

`SSRF_ALLOW_PRIVATE` / `SSRF_ALLOW_HTTP` exist for self-hosters who point the app at a model on their own LAN. Enabling them on a public instance exposes your internal network — don't.

## Reporting a vulnerability

Please open a **private** security advisory on GitHub (Security → Advisories → Report a vulnerability) rather than a public issue. We aim to respond within 7 days.
