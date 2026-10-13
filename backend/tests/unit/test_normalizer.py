import pytest

from app.domain.services.family_extractor import extract_family
from app.domain.services.normalizer import AliasRegistry, AliasRule, canonical_key


@pytest.mark.parametrize(
    "raw",
    ["vl/DeepSeek-V1-Flash", "dp/deepseek-v1-flash", "gg/DeepseekV1Flash", "deepseek-v1-flash"],
)
def test_deepseek_four_spellings_are_one_model(raw: str) -> None:
    assert canonical_key(raw) == "deepseekv1flash"


def test_qwen_variants_stay_three_separate_models() -> None:
    keys = {canonical_key(n) for n in ["qwen3.8", "qwen3.8-max", "qwen3.8-2026-07-06"]}
    assert keys == {"qwen38", "qwen38max", "qwen3820260706"}


def test_cross_provider_same_name_merges() -> None:
    assert canonical_key("prov/qwen3.8-max") == canonical_key("other/Qwen3.8Max") == "qwen38max"


@pytest.mark.parametrize("suffix", ["-max", "-mini", "-pro", "-2024-07-18", ":free", "@latest"])
def test_meaningful_suffixes_never_stripped_at_exact_level(suffix: str) -> None:
    assert canonical_key("model-x" + suffix) != canonical_key("model-x")


def test_namespace_only_last_segment_counts() -> None:
    assert canonical_key("a/b/c/GPT-4o") == "gpt4o"


def test_bare_version_segment_keeps_its_parent() -> None:
    assert canonical_key("fal_ai/bria/text-to-image/3.2") == "texttoimage32"
    assert canonical_key("a/b/1.0") != canonical_key("c/d/1.0")


def test_empty_name_rejected() -> None:
    with pytest.raises(ValueError):
        canonical_key("vendor/---")


def test_alias_registry_overrides_exact_and_regex() -> None:
    reg = AliasRegistry(
        [
            AliasRule(pattern="deepseek-chat-v1", canonical="deepseek-v1-flash"),
            AliasRule(pattern=r"ds-v1-fl(ash)?", canonical="deepseekv1flash", regex=True),
        ]
    )
    assert reg.resolve_key("x/DeepSeek_Chat_V1") == "deepseekv1flash"
    assert reg.resolve_key("y/ds-v1-fl") == "deepseekv1flash"
    assert reg.resolve_key("qwen3.8") == "qwen38"  # untouched


def test_alias_registry_from_mapping_validates() -> None:
    assert len(AliasRegistry.from_mapping({"aliases": []})) == 0
    with pytest.raises(ValueError):
        AliasRegistry.from_mapping({"aliases": [{"pattern": "x"}]})


def test_resolve_returns_family_and_display() -> None:
    m = AliasRegistry().resolve("prov/Qwen3.8-Max")
    assert (m.canonical_key, m.display_name, m.family) == ("qwen38max", "Qwen3.8-Max", "qwen38")


@pytest.mark.parametrize(
    ("name", "family"),
    [
        ("qwen3.8", "qwen38"),
        ("qwen3.8-max", "qwen38"),
        ("qwen3.8-2026-07-06", "qwen38"),
        ("deepseek-v1-flash", "deepseekv1"),
        ("DeepseekV1Flash", "deepseekv1"),
        ("gpt-4o-mini-2024-07-18", "gpt4o"),
        ("claude-3-5-sonnet-20240620", "claude35sonnet"),
        ("Meta-Llama-3.1-70B-Instruct-Turbo", "metallama31"),
        ("mixtral-8x7b-instruct", "mixtral"),
        ("qwen3-30b-a3b", "qwen3"),
        ("llama-3-8b-fp8", "llama3"),
        ("deepseek/deepseek-r1:free", "deepseekr1"),
        ("gpt-4-0613", "gpt4"),
        ("gemini", "gemini"),  # trailing "mini" without a separator is not a suffix
        ("gemini-2.0-flash-lite", "gemini20"),
        ("o3-mini", "o3"),
        ("max", "max"),  # never reduce to empty
    ],
)
def test_family_extraction(name: str, family: str) -> None:
    assert extract_family(name) == family
