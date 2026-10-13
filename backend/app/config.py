"""All configuration comes from the environment (or `.env`). No credentials of AI providers live here."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Sandroid AI Play & Battle"
    environment: str = "production"
    log_level: str = "INFO"

    database_url: str = "postgresql+asyncpg://sandroid:sandroid@localhost:5432/sandroid"
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=list)

    # Behind Nginx/Cloudflare: read the client IP from X-Forwarded-For / CF-Connecting-IP.
    trust_proxy_headers: bool = False

    # Rate limits (requests per minute per IP, token bucket, in-memory, single instance).
    rate_limit_read_per_min: int = 120
    rate_limit_run_per_min: int = 30
    rate_limit_arena_per_min: int = 10
    rate_limit_research_per_min: int = 5

    arena_max_active_per_ip: int = 2
    arena_max_parallel_per_ip: int = 1
    arena_parallel_concurrency: int = 4

    research_cooldown_seconds: int = 3600

    max_body_bytes: int = 10 * 1024 * 1024
    max_upstream_response_bytes: int = 20 * 1024 * 1024
    upstream_connect_timeout_s: float = 10.0

    # SSRF: only https + public IPs. Self-hosters running a local LLM (Ollama, vLLM)
    # on a private network may opt in. Never enable on a public deployment.
    ssrf_allow_private: bool = False
    ssrf_allow_http: bool = False

    model_list_cache_ttl_s: int = 300

    aliases_path: Path = REPO_ROOT / "aliases.json"
    frontend_dist: Path = REPO_ROOT / "frontend" / "dist"

    pricing_openrouter_url: str = "https://openrouter.ai/api/v1/models"
    pricing_litellm_url: str = (
        "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
    )
    pricing_helicone_url: str = "https://www.helicone.ai/api/llm-costs"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _parse_origins(cls, raw: object) -> object:
        # Accept "a,b" as well as a JSON list.
        if isinstance(raw, str):
            raw = raw.strip()
            if raw.startswith("["):
                return json.loads(raw)
            return [o.strip() for o in raw.split(",") if o.strip()]
        return raw


@lru_cache
def get_settings() -> Settings:
    return Settings()
