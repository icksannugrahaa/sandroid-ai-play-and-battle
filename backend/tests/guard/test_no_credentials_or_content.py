"""CI GUARD — enforces the project's privacy promises. Do not weaken, skip, or delete.

This project NEVER stores provider credentials, prompts/outputs, or client identity.
These tests fail any change that:
  * adds a credential column/field (api_key, secret, token, password, ...) to the DB schema,
    a migration, or a persisted domain record;
  * adds a content column/field (prompt, output, messages, response, ...) to the same;
  * adds client-identity columns (ip, ip_hash, user_agent, email, ...);
  * logs/prints request headers or API keys, or handles auth header names outside the
    few modules that legitimately must;
  * makes the frontend credential store persistent (localStorage/sessionStorage/cookie/persist).

See CONTRIBUTING.md § "Credential & content policy".
"""

from __future__ import annotations

import ast
import dataclasses
import re
from pathlib import Path

import pytest

from app.domain.entities import ArenaStrategy, ChallengeResult, RunMetrics, RunRecord
from app.domain.ports.repositories import ChallengeBoardRow, LeaderboardRow
from app.infrastructure.persistence.orm import Base

BACKEND = Path(__file__).resolve().parents[2]
APP = BACKEND / "app"
MIGRATIONS = BACKEND / "alembic" / "versions"
FRONTEND_SRC = BACKEND.parent / "frontend" / "src"

CREDENTIAL = re.compile(
    r"(api_?key|apikey|secret|passw(or)?d|credential|authori[sz]ation|bearer|cookie|session_?key|private_?key)"
)
CREDENTIAL_TOKEN = re.compile(
    r"(^|_)(access_|refresh_|auth_|api_)?token$"
)  # 'token', 'api_token' — not 'prompt_tokens'
CONTENT_WORDS = {
    "prompt",
    "prompts",
    "output",
    "outputs",
    "message",
    "messages",
    "response",
    "responses",
    "content",
    "contents",
    "completion",
    "text",
    "body",
    "system",
    "image",
    "images",
    "snapshot",
}
IDENTITY = re.compile(
    r"(^|_)(ip|ips|ip_hash|ip_address|user_agent|useragent|email|user|user_id|client_id|fingerprint|device)($|_)"
)

# Metric columns that happen to contain a content word. Every addition needs review.
METRIC_ALLOWLIST = {
    "prompt_tokens",
    "completion_tokens",
    "tokens_estimated",  # token counts, not text
    "image_price",
    "output_per_1m",
    "supports_image_gen",  # pricing / capability flags
}


def violations(name: str) -> list[str]:
    lowered = name.lower()
    found = []
    if CREDENTIAL.search(lowered) or CREDENTIAL_TOKEN.search(lowered):
        found.append("credential")
    if lowered not in METRIC_ALLOWLIST and CONTENT_WORDS & set(lowered.split("_")):
        found.append("content")
    if IDENTITY.search(lowered):
        found.append("identity")
    return found


@pytest.mark.parametrize(
    ("name", "bad"),
    [
        ("api_key", True),
        ("apiKey", True),
        ("token", True),
        ("refresh_token", True),
        ("password", True),
        ("prompt", True),
        ("output_text", True),
        ("messages", True),
        ("response_body", True),
        ("ip_hash", True),
        ("user_agent", True),
        ("prompt_tokens", False),
        ("completion_tokens", False),
        ("total_ms", False),
        ("provider_label", False),
        ("tokens_estimated", False),
    ],
)
def test_detector_itself(name: str, bad: bool) -> None:
    assert bool(violations(name)) is bad


def test_orm_schema_has_no_credential_content_or_identity_columns() -> None:
    bad = {
        f"{table.name}.{col.name}": v
        for table in Base.metadata.tables.values()
        for col in table.columns
        if (v := violations(col.name))
    }
    assert not bad, f"Forbidden columns in DB schema: {bad}"


def test_no_forbidden_tables() -> None:
    bad = [t for t in Base.metadata.tables if violations(t) or "history" in t or "credential" in t]
    assert not bad, f"Forbidden tables: {bad}"


def test_migrations_add_no_forbidden_columns() -> None:
    column = re.compile(r"sa\.Column\(\s*['\"]([^'\"]+)['\"]")
    table = re.compile(r"create_table\(\s*['\"]([^'\"]+)['\"]")
    bad = []
    for path in sorted(MIGRATIONS.glob("*.py")):
        source = path.read_text()
        bad += [f"{path.name}: column {n}" for n in column.findall(source) if violations(n)]
        bad += [f"{path.name}: table {n}" for n in table.findall(source) if violations(n)]
    assert not bad, f"Forbidden schema in migrations: {bad}"


@pytest.mark.parametrize("record", [RunRecord, RunMetrics, LeaderboardRow, ChallengeResult, ChallengeBoardRow])
def test_persisted_domain_records_carry_no_content_or_credentials(record: type) -> None:
    fields = [f.name for f in dataclasses.fields(record)]
    allowed_nested = {"canonical", "metrics", "raw_model_name"}
    bad = {n: v for n in fields if n not in allowed_nested and (v := violations(n))}
    assert not bad, f"{record.__name__} has forbidden fields: {bad}"


def test_arena_session_has_no_prompt_snapshot() -> None:
    cols = {c.name for c in Base.metadata.tables["arena_sessions"].columns}
    assert cols == {"id", "strategy", "created_at"}
    assert {s.value for s in ArenaStrategy} == {"parallel", "sequential"}


# --------------------------------------------------------------------------- logging / headers
LOG_METHODS = {"debug", "info", "warning", "warn", "error", "exception", "critical", "log"}
SENSITIVE_NAMES = re.compile(r"(api_?key|headers?|authorization|secret|token|password|cookie|keys)$", re.IGNORECASE)


def _names(node: ast.AST) -> list[str]:
    out = []
    for sub in ast.walk(node):
        if isinstance(sub, ast.Name):
            out.append(sub.id)
        elif isinstance(sub, ast.Attribute):
            out.append(sub.attr)
    return out


def _python_files() -> list[Path]:
    return [p for p in APP.rglob("*.py") if "__pycache__" not in p.parts]


def test_no_logging_or_printing_of_keys_or_headers() -> None:
    bad = []
    for path in _python_files():
        tree = ast.parse(path.read_text(), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            is_print = isinstance(func, ast.Name) and func.id == "print"
            is_log = isinstance(func, ast.Attribute) and func.attr in LOG_METHODS
            if not (is_print or is_log):
                continue
            for arg in [*node.args, *(k.value for k in node.keywords)]:
                hits = [n for n in _names(arg) if SENSITIVE_NAMES.search(n)]
                if hits:
                    bad.append(f"{path.relative_to(BACKEND)}:{node.lineno} logs {hits}")
    assert not bad, "Logging/printing of credentials or headers:\n" + "\n".join(bad)


# Modules that legitimately touch auth header names: building the outbound request,
# reading the inbound header, CORS allow-list, and redaction itself.
AUTH_HEADER_ALLOWED = {
    "app/infrastructure/providers/openai_compatible.py",
    "app/infrastructure/security/redaction.py",
    "app/interfaces/deps.py",
    "app/main.py",
}


def test_auth_header_names_only_in_allowed_modules() -> None:
    pattern = re.compile(r"(authorization|x-api-key)", re.IGNORECASE)
    bad = []
    for path in _python_files():
        rel = str(path.relative_to(BACKEND))
        if rel in AUTH_HEADER_ALLOWED:
            continue
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and pattern.search(node.value):
                # docstrings/descriptions mentioning the header are fine; code using it is not
                if len(node.value) > 60:
                    continue
                bad.append(f"{rel}:{node.lineno} {node.value!r}")
    assert not bad, "Auth header handled outside allowed modules:\n" + "\n".join(bad)


def test_no_file_writes_in_app_code() -> None:
    """The server writes nothing to disk (no request dumps, no key files)."""
    bad = []
    for path in _python_files():
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.Call):
                f = node.func
                if isinstance(f, ast.Attribute) and f.attr in {"write_text", "write_bytes"}:
                    bad.append(f"{path.relative_to(BACKEND)}:{node.lineno}")
                if isinstance(f, ast.Name) and f.id == "open":
                    modes = [a.value for a in node.args[1:2] if isinstance(a, ast.Constant)]
                    modes += [
                        k.value.value for k in node.keywords if k.arg == "mode" and isinstance(k.value, ast.Constant)
                    ]
                    if any(isinstance(m, str) and set(m) & set("wax+") for m in modes):
                        bad.append(f"{path.relative_to(BACKEND)}:{node.lineno}")
    assert not bad, f"File writes in app code: {bad}"


# --------------------------------------------------------------------------- frontend
def test_frontend_credential_store_is_memory_only() -> None:
    store = FRONTEND_SRC / "stores" / "credentials.ts"
    if not FRONTEND_SRC.exists():
        pytest.skip("frontend not present (vendored backend only)")
    source = store.read_text()
    forbidden = re.compile(
        r"(zustand/middleware|\bpersist\s*\(|createJSONStorage|localStorage|sessionStorage|document\.cookie|indexedDB)"
    )
    found = forbidden.findall(source)
    assert not found, f"credentials store must stay memory-only (found {found})"


def test_frontend_never_persists_keys_anywhere() -> None:
    if not FRONTEND_SRC.exists():
        pytest.skip("frontend not present")
    storage = re.compile(r"(localStorage|sessionStorage|indexedDB|document\.cookie)")
    keyish = re.compile(r"(api_?key|apiKey|credential|secret)", re.IGNORECASE)
    bad = []
    for path in FRONTEND_SRC.rglob("*.ts*"):
        if ".test." in path.name:
            continue
        for lineno, line in enumerate(path.read_text().splitlines(), 1):
            if storage.search(line) and keyish.search(line):
                bad.append(f"{path.relative_to(FRONTEND_SRC)}:{lineno}")
    assert not bad, f"Possible credential persistence in frontend: {bad}"
