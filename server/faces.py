# Finds the main face in a video, a few times a second, for reframing a wide video to vertical.
#   python faces.py <ffmpeg> <file> <start> <duration> <fps> <width> <height>
# ffmpeg decodes small grey frames into this script; OpenCV's bundled face detector finds the largest face.
# Prints one JSON line: {"samples": [[t, u|null], ...]} where u is the face centre as a fraction of the width.
import json
import subprocess
import sys

import cv2
import numpy as np

ffmpeg, src, start, dur, fps, w, h = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5]), int(sys.argv[6]), int(sys.argv[7])
front = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
profile = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_profileface.xml")

cmd = [ffmpeg, "-v", "error", "-ss", str(start), "-t", str(dur), "-i", src, "-an", "-vf", f"fps={fps},scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "gray", "-"]
proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
size = w * h
samples = []
k = 0
prev = None
while True:
    buf = proc.stdout.read(size)
    if len(buf) < size:
        break
    img = np.frombuffer(buf, dtype=np.uint8).reshape(h, w)
    img = cv2.equalizeHist(img)
    min_side = max(20, h // 12)
    faces = list(front.detectMultiScale(img, scaleFactor=1.1, minNeighbors=5, minSize=(min_side, min_side)))
    if not faces:
        faces = list(profile.detectMultiScale(img, scaleFactor=1.1, minNeighbors=5, minSize=(min_side, min_side)))
        flipped = profile.detectMultiScale(cv2.flip(img, 1), scaleFactor=1.1, minNeighbors=5, minSize=(min_side, min_side))
        faces += [(w - x - fw, y, fw, fh) for (x, y, fw, fh) in flipped]
    u = None
    if faces:
        # The biggest face, and of two similar ones the one nearest the last position (no jumping between people).
        faces.sort(key=lambda f: -f[2] * f[3])
        best = faces[0]
        if prev is not None and len(faces) > 1 and faces[1][2] * faces[1][3] > 0.7 * best[2] * best[3]:
            best = min(faces[:2], key=lambda f: abs((f[0] + f[2] / 2) / w - prev))
        u = round(float((best[0] + best[2] / 2) / w), 4)
        prev = u
    samples.append([round(start + k / fps, 3), u])
    k += 1
proc.wait()
print(json.dumps({"samples": samples}))
