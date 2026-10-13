"""Media helpers (pure): turn raw audio bytes from a provider into a playable data URL."""

from __future__ import annotations

import base64
import struct

PCM16_SAMPLE_RATE = 24_000  # OpenAI streams audio as 24 kHz mono 16-bit PCM


def sniff_audio_mime(data: bytes) -> str | None:
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "audio/wav"
    if data[:3] == b"ID3" or (len(data) > 1 and data[0] == 0xFF and data[1] & 0xE0 == 0xE0):
        return "audio/mpeg"
    if data[:4] == b"OggS":
        return "audio/ogg"
    if data[:4] == b"fLaC":
        return "audio/flac"
    return None


def wav_from_pcm16(pcm: bytes, sample_rate: int = PCM16_SAMPLE_RATE, channels: int = 1) -> bytes:
    byte_rate = sample_rate * channels * 2
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + len(pcm),
        b"WAVE",
        b"fmt ",
        16,
        1,  # PCM
        channels,
        sample_rate,
        byte_rate,
        channels * 2,
        16,
        b"data",
        len(pcm),
    )
    return header + pcm


def audio_data_url(data: bytes) -> str | None:
    """Known container → as-is; anything else is assumed raw PCM16 and wrapped in WAV."""
    if not data:
        return None
    mime = sniff_audio_mime(data)
    if mime is None:
        mime, data = "audio/wav", wav_from_pcm16(data[: len(data) - len(data) % 2])
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"
