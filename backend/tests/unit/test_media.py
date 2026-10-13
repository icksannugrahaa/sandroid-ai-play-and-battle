import base64

from app.domain.services.media import audio_data_url, sniff_audio_mime, wav_from_pcm16


def test_sniff_containers() -> None:
    assert sniff_audio_mime(b"RIFF\x00\x00\x00\x00WAVEfmt ") == "audio/wav"
    assert sniff_audio_mime(b"ID3\x04") == "audio/mpeg"
    assert sniff_audio_mime(b"\xff\xfb\x90") == "audio/mpeg"
    assert sniff_audio_mime(b"OggS....") == "audio/ogg"
    assert sniff_audio_mime(b"\x01\x02\x03") is None


def test_pcm16_wrapped_as_wav() -> None:
    url = audio_data_url(b"\x01\x00" * 100 + b"\x07")  # odd trailing byte dropped
    assert url is not None and url.startswith("data:audio/wav;base64,")
    wav = base64.b64decode(url.split(",", 1)[1])
    assert wav[:4] == b"RIFF" and wav[8:12] == b"WAVE" and len(wav) == 44 + 200
    assert wav == wav_from_pcm16(b"\x01\x00" * 100)


def test_known_container_kept_and_empty_ignored() -> None:
    mp3 = b"ID3" + b"\x00" * 10
    assert audio_data_url(mp3) == "data:audio/mpeg;base64," + base64.b64encode(mp3).decode()
    assert audio_data_url(b"") is None
