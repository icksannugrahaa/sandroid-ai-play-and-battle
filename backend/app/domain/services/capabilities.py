"""Model capability detection: provider metadata first, name heuristics second."""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

from app.domain.entities import Modality

# Dedicated image generators (image output only).
_IMAGE_ONLY = re.compile(
    r"dall-?e|gpt-image|imagen(?:-|\d|$)|flux|stable-?diffusion|sdxl|sd3|midjourney|kandinsky|cogview|"
    r"playground-v|recraft|ideogram|seedream|hidream|image-gen|text-to-image|t2i|wanx|dreamina"
)
# Chat models that can also return images (e.g. gemini-*-image, qwen-image, grok-2-image, nano-banana).
_IMAGE_HYBRID = re.compile(r"(?:^|[-_/.:])image(?:[-_.:]|\d|$)|nano-?banana|grok-imagine")
_VISION = re.compile(
    r"vision|(?<![a-z])vl(?![a-z])|-vl|llava|pixtral|gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-5|o3|o4|"
    r"claude-3|claude-(?:sonnet|opus|haiku)|gemini|gemma-3|qwen2\.5-vl|qwen-vl|qvq|"
    r"internvl|minicpm-v|molmo|llama-3\.2-(?:11|90)b|llama-4|grok-(?:2-vision|4)|mistral-(?:small|medium)"
)
_NON_CHAT = re.compile(r"embed|whisper|tts|moderation|rerank|transcribe")


def detect_capabilities(model_id: str, metadata: Mapping[str, Any] | None = None) -> list[Modality]:
    meta = metadata or {}
    arch = meta.get("architecture")
    if isinstance(arch, Mapping):
        inputs = {str(m) for m in arch.get("input_modalities") or []}
        outputs = {str(m) for m in arch.get("output_modalities") or []}
        if inputs or outputs:
            caps: list[Modality] = []
            if "text" in outputs:
                caps.append(Modality.CHAT)
                if "image" in inputs:
                    caps.append(Modality.VISION)
            if "image" in outputs:
                caps.append(Modality.IMAGE_GEN)
            if caps:
                return caps

    name = model_id.lower()
    if _NON_CHAT.search(name):
        return []
    if _IMAGE_ONLY.search(name):
        return [Modality.IMAGE_GEN]
    caps = [Modality.CHAT]
    if _VISION.search(name):
        caps.append(Modality.VISION)
    if _IMAGE_HYBRID.search(name):
        caps.append(Modality.IMAGE_GEN)
    return caps
