"""Level 1 — exact canonical key.

Rules (deterministic, in order):
  1. strip namespace — keep the last segment after "/"
  2. lowercase
  3. remove every non-alphanumeric character

Only names that are identical modulo formatting are merged. Meaningful suffixes
(-max, version dates, -mini, -pro, ...) are NEVER stripped at this level.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from app.domain.entities import CanonicalModel
from app.domain.services.family_extractor import extract_family
from app.domain.services.naming import strip_namespace

_NON_ALNUM = re.compile(r"[^a-z0-9]")


def canonical_key(raw_name: str) -> str:
    key = _NON_ALNUM.sub("", strip_namespace(raw_name).lower())
    if not key:
        raise ValueError("model name has no alphanumeric characters")
    return key


@dataclass(frozen=True, slots=True)
class AliasRule:
    pattern: str
    canonical: str
    regex: bool = False


class AliasRegistry:
    """Curated overrides loaded from `aliases.json` (community PRs, no admin UI).

    A non-regex `pattern` is compared after normalization, so formatting does not
    matter. A regex `pattern` is full-matched against the lowercased raw name
    with its namespace stripped.
    """

    def __init__(self, rules: Iterable[AliasRule] = ()) -> None:
        self._exact: dict[str, str] = {}
        self._regex: list[tuple[re.Pattern[str], str]] = []
        for rule in rules:
            target = canonical_key(rule.canonical)
            if rule.regex:
                self._regex.append((re.compile(rule.pattern, re.IGNORECASE), target))
            else:
                self._exact[canonical_key(rule.pattern)] = target

    @classmethod
    def from_mapping(cls, data: Mapping[str, object]) -> AliasRegistry:
        raw_rules = data.get("aliases", [])
        if not isinstance(raw_rules, list):
            raise ValueError("'aliases' must be a list")
        rules: list[AliasRule] = []
        for item in raw_rules:
            if not isinstance(item, dict) or "pattern" not in item or "canonical" not in item:
                raise ValueError("each alias needs 'pattern' and 'canonical'")
            rules.append(
                AliasRule(
                    pattern=str(item["pattern"]),
                    canonical=str(item["canonical"]),
                    regex=bool(item.get("regex", False)),
                )
            )
        return cls(rules)

    def __len__(self) -> int:
        return len(self._exact) + len(self._regex)

    def override_for(self, raw_name: str) -> str | None:
        key = canonical_key(raw_name)
        if key in self._exact:
            return self._exact[key]
        tail = strip_namespace(raw_name).lower()
        for pattern, target in self._regex:
            if pattern.fullmatch(tail):
                return target
        return None

    def resolve_key(self, raw_name: str) -> str:
        return self.override_for(raw_name) or canonical_key(raw_name)

    def resolve(self, raw_name: str) -> CanonicalModel:
        display = strip_namespace(raw_name)
        return CanonicalModel(
            canonical_key=self.resolve_key(raw_name),
            display_name=display,
            family=extract_family(display),
        )
