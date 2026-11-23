"""Transcribe a WAV file with faster-whisper and write word timings as JSON.

usage: transcribe.py <audio.wav> <language: he|en|auto> <out.json> <model>
Progress is printed as lines "PROGRESS <0..1>".
"""
import glob
import json
import os
import sys


def use_pip_cuda():
    """Find the CUDA 12 / cuDNN 9 libraries installed with pip (nvidia-cublas-cu12, nvidia-cudnn-cu12).

    The installer puts them in the studio's own Python environment instead of asking for a system-wide CUDA
    install, so they are not on PATH: add their folders on Windows, preload them on Linux. Without them (or
    without an NVIDIA GPU) transcription runs on the CPU.
    """
    try:
        import nvidia  # namespace package of the pip CUDA wheels
    except ImportError:
        return
    roots = list(getattr(nvidia, "__path__", []))
    if sys.platform == "win32":
        for root in roots:
            for d in glob.glob(os.path.join(root, "*", "bin")):
                try:
                    os.add_dll_directory(d)
                except OSError:
                    pass
                os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")
    elif sys.platform.startswith("linux"):
        import ctypes

        for pattern in ("cublas/lib/libcublasLt.so.*", "cublas/lib/libcublas.so.*", "cudnn/lib/libcudnn*.so.*"):
            for root in roots:
                for f in sorted(glob.glob(os.path.join(root, pattern))):
                    try:
                        ctypes.CDLL(f, mode=ctypes.RTLD_GLOBAL)
                    except OSError:
                        pass


def read_wav(path):
    """The 16 kHz mono 16-bit WAV the studio makes with ffmpeg, as float samples.

    Passing samples instead of a path keeps faster-whisper from decoding with PyAV, whose newer versions
    (16 and up) break faster-whisper 1.2's decoder.
    """
    import wave

    import numpy as np

    with wave.open(path, "rb") as w:
        if w.getsampwidth() != 2 or w.getnchannels() != 1 or w.getframerate() != 16000:
            return path  # not the studio's own format: let faster-whisper decode it
        data = w.readframes(w.getnframes())
    return np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0


def main():
    use_pip_cuda()
    audio, language, out, model_name = sys.argv[1:5]
    # An optional prompt written with fillers makes Whisper keep the "um"s it normally leaves out (verbatim mode).
    prompt = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] else None
    from faster_whisper import WhisperModel

    audio = read_wav(audio)

    try:
        model = WhisperModel(model_name, device="cuda", compute_type="float16")
        device = "cuda"
    except Exception as e:  # no GPU, or CUDA libraries missing
        print(f"NOTE cuda unavailable ({e}); using CPU", flush=True)
        model = WhisperModel(model_name, device="cpu", compute_type="int8")
        device = "cpu"

    def run(m):
        segments, info = m.transcribe(
            audio,
            language=None if language == "auto" else language,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=400),
            beam_size=5,
            condition_on_previous_text=False,
            initial_prompt=prompt,
        )
        words = []
        for seg in segments:
            for w in seg.words or []:
                text = w.word.strip()
                if text:
                    words.append({"t0": round(w.start, 3), "t1": round(w.end, 3), "text": text})
            if info.duration:
                print(f"PROGRESS {min(1.0, seg.end / info.duration):.3f}", flush=True)
        return words, info

    try:
        words, info = run(model)
    except Exception as e:
        if device != "cuda":
            raise
        print(f"NOTE cuda failed while decoding ({e}); using CPU", flush=True)
        model = WhisperModel(model_name, device="cpu", compute_type="int8")
        device = "cpu"
        words, info = run(model)

    with open(out, "w", encoding="utf-8") as f:
        json.dump({"language": info.language, "model": model_name, "device": device, "words": words}, f, ensure_ascii=False)
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
