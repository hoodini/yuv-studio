# Removes the background behind people in a video, with Robust Video Matting (ONNX, GPU when available).
#   python matte.py <ffmpeg> <src> <start> <duration> <fps> <width> <height> <model.onnx> <out.webm>
# ffmpeg decodes RGB frames into this script; the model's recurrent state carries from frame to frame, which keeps
# the edges steady (no flicker); the result is encoded as VP9 with an alpha channel (WebM), which browsers play
# with transparency and ffmpeg can composite. The sound of that part of the source is kept.
# Prints "PROGRESS <0..1>" lines, then "DONE <frames>".
import queue
import subprocess
import sys
import threading

import numpy as np
import onnxruntime as ort

ffmpeg, src, start, dur, fps, w, h, model, out = sys.argv[1:10]
start, dur, fps, w, h = float(start), float(dur), float(fps), int(w), int(h)

ort.set_default_logger_severity(3)
providers = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in ort.get_available_providers()]
sess = ort.InferenceSession(model, providers=providers)
print(f"NOTE matting on {sess.get_providers()[0]}", flush=True)

dec = subprocess.Popen(
    [ffmpeg, "-v", "error", "-ss", str(start), "-t", str(dur), "-i", src, "-an", "-vf", f"fps={fps},scale={w}:{h}:flags=bicubic", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    stdout=subprocess.PIPE,
)
# The script only computes the mask; ffmpeg reads the picture again and joins the two (alphamerge), which keeps
# the colours untouched and moves 4 times less data through Python.
enc = subprocess.Popen(
    [
        ffmpeg, "-v", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{w}x{h}", "-r", str(fps), "-i", "-",
        "-ss", str(start), "-t", str(dur), "-i", src,
        "-filter_complex", f"[1:v]fps={fps},scale={w}:{h}:flags=bicubic,format=rgba[c];[0:v]format=gray[a];[c][a]alphamerge,format=yuva420p[v]",
        "-map", "[v]", "-map", "1:a?",
        "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "28",
        "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-auto-alt-ref", "0",
        "-c:a", "libopus", "-b:a", "160k",
        "-shortest", out,
    ],
    stdin=subprocess.PIPE,
)

# The model looks at a smaller copy to find the person, then refines the edges at full size.
ratio = np.array([min(1.0, 512.0 / max(w, h))], dtype=np.float32)
rec = [np.zeros((1, 1, 1, 1), dtype=np.float32)] * 4
size = w * h * 3
total = max(1, int(round(dur * fps)))

# Reading, the model and writing overlap: one thread feeds frames in, one writes results out.
frames: "queue.Queue[bytes | None]" = queue.Queue(maxsize=8)
results: "queue.Queue[bytes | None]" = queue.Queue(maxsize=8)


def reader():
    while True:
        buf = dec.stdout.read(size)
        if len(buf) < size:
            frames.put(None)
            return
        frames.put(buf)


def writer():
    while True:
        b = results.get()
        if b is None:
            return
        enc.stdin.write(b)


threading.Thread(target=reader, daemon=True).start()
wt = threading.Thread(target=writer, daemon=True)
wt.start()
k = 0
inv = np.float32(1 / 255)
while True:
    buf = frames.get()
    if buf is None:
        break
    x = np.frombuffer(buf, dtype=np.uint8).reshape(h, w, 3).transpose(2, 0, 1)[None].astype(np.float32)
    x *= inv
    _fgr, pha, *rec = sess.run(None, {"src": x, "r1i": rec[0], "r2i": rec[1], "r3i": rec[2], "r4i": rec[3], "downsample_ratio": ratio})
    a = pha[0, 0]
    np.clip(a, 0, 1, out=a)
    a *= 255.0
    a += 0.5
    results.put(a.astype(np.uint8).tobytes())
    k += 1
    if k % 10 == 0:
        print(f"PROGRESS {min(1.0, k / total):.3f}", flush=True)
results.put(None)
wt.join()
dec.wait()
enc.stdin.close()
code = enc.wait()
if code != 0 or k == 0:
    sys.exit(f"encoding failed ({code}) after {k} frames")
print(f"DONE {k}", flush=True)
