from app.domain.entities import Modality
from app.domain.services.capabilities import detect_capabilities


def test_metadata_wins() -> None:
    meta = {"architecture": {"input_modalities": ["text", "image"], "output_modalities": ["text"]}}
    assert detect_capabilities("whatever", meta) == [Modality.CHAT, Modality.VISION]


def test_name_heuristics() -> None:
    assert detect_capabilities("dall-e-3") == [Modality.IMAGE_GEN]
    assert detect_capabilities("gpt-4o-mini") == [Modality.CHAT, Modality.VISION]
    assert detect_capabilities("Qwen2.5-VL-72B") == [Modality.CHAT, Modality.VISION]
    assert detect_capabilities("deepseek-chat") == [Modality.CHAT]
    assert detect_capabilities("text-embedding-3-small") == []


def test_image_generation_detection() -> None:
    gen = lambda m: Modality.IMAGE_GEN in detect_capabilities(m)  # noqa: E731
    for m in [
        "9r/ag/gemini-3.1-flash-image",
        "gemini-2.5-flash-image-preview",
        "google/gemini-3-pro-image",
        "nano-banana-pro",
        "qwen-image",
        "hunyuan-image-3",
        "grok-2-image",
        "grok-imagine",
        "dall-e-3",
        "gpt-image-1",
        "flux-1.1-pro",
        "cogview-4",
        "seedream-4",
        "imagen-4",
    ]:
        assert gen(m), m
    for m in [
        "9r/ag/gemini-3.8-flash",
        "mini-imagenet-classifier",
        "gpt-4o",
        "claude-sonnet-4.5",
        "image-embedding-001",
    ]:
        assert not gen(m), m
    # hybrid models stay chat-capable; dedicated generators are image-only
    assert detect_capabilities("gemini-3.1-flash-image") == [Modality.CHAT, Modality.VISION, Modality.IMAGE_GEN]
    assert detect_capabilities("dall-e-3") == [Modality.IMAGE_GEN]
