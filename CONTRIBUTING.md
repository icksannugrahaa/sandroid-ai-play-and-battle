# Contributing

Thanks for helping! Small, focused pull requests are easiest to review.

## Credential & content policy (non-negotiable)

This project **never stores provider credentials** and **never stores prompts or outputs** on the server. Pull requests that do any of the following will be closed:

- add a column, field, cache, file, or log line holding an API key, token, secret, password, or auth header;
- persist the frontend credential store (`persist` middleware, localStorage, sessionStorage, cookies, IndexedDB, URL params);
- add prompt/output/message/response content to the database, or a server-side history / run-by-run endpoint;
- store client identity (IP, IP hash, user agent, fingerprint) in the database or full IPs in logs.

The CI guard (`backend/tests/guard/`) enforces this automatically. **Do not weaken, skip, or delete it.** If you add a legitimate metric column whose name trips the detector (e.g. `prompt_tokens`), add it to `METRIC_ALLOWLIST` in the guard with a short justification so reviewers see it.

Forks that add credential persistence violate project policy and must not use the project name.

## Fixing model grouping — `aliases.json`

The normalizer merges only names that are identical apart from formatting. If two different spellings of the **same** model are not merged (or a name maps wrongly), add a rule:

```json
{
  "aliases": [
    { "pattern": "deepseek-chat-v1", "canonical": "deepseekv1flash" },
    { "pattern": "ds-v1-fl(ash)?", "canonical": "deepseekv1flash", "regex": true }
  ]
}
```

- `pattern` (non-regex) is compared **after** normalization, so case and punctuation don't matter.
- `"regex": true` full-matches the lowercased name with its namespace stripped.
- `canonical` is normalized too.
- Explain in the PR why the names are the same model (link to provider docs). Never merge genuinely different variants (`-max`, `-mini`, dated versions).
- Pricing → *Alias suggestions* lists near-miss names found during Research — good PR candidates.

## Development

```bash
cd backend && python3.14 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/ruff check app tests alembic && .venv/bin/ruff format app tests alembic
.venv/bin/mypy app && .venv/bin/pytest

cd frontend && npm ci && npx tsc -b && npm test && npm run build
```

- Python is pinned to **3.14** everywhere (pyproject, Dockerfile, CI, docs).
- Keep the domain layer pure: `app/domain` must not import from `application`, `infrastructure`, or `interfaces`.
- Schema changes need an Alembic migration (`alembic revision --autogenerate -m "…"`), reviewed by hand.
- UI copy goes into **both** `frontend/src/i18n/en.json` and `id.json` (a test checks parity).
- Keep the frontend light: no new runtime dependency without a strong reason (current: react, react-dom, zustand, @tanstack/react-query).
