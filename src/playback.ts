// The playhead. Kept outside React state so 60 updates a second only touch what listens to it.
import { useSyncExternalStore } from 'react';

let time = 0;
let playing = false;
let duration = 0;
let lastTick = 0;
let raf = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function tick(now: number) {
  if (!playing) return;
  time += (now - lastTick) / 1000;
  lastTick = now;
  if (time >= duration) {
    time = duration;
    playing = false;
  } else raf = requestAnimationFrame(tick);
  emit();
}

export const playback = {
  get time() {
    return time;
  },
  get playing() {
    return playing;
  },
  setDuration(d: number) {
    duration = d;
    if (time > d) this.seek(d);
  },
  seek(t: number) {
    time = Math.max(0, Math.min(duration, t));
    emit();
  },
  play() {
    if (playing || duration <= 0) return;
    if (time >= duration - 0.01) time = 0;
    playing = true;
    lastTick = performance.now();
    raf = requestAnimationFrame(tick);
    emit();
  },
  pause() {
    playing = false;
    cancelAnimationFrame(raf);
    emit();
  },
  toggle() {
    playing ? this.pause() : this.play();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};

export const usePlayhead = () => useSyncExternalStore(playback.subscribe, () => time);
export const usePlaying = () => useSyncExternalStore(playback.subscribe, () => playing);

// The preview's own volume and mute (the speakers knob). It never changes the project or the export.
const readNum = (k: string, d: number) => {
  try {
    const v = Number(localStorage.getItem(k));
    return localStorage.getItem(k) == null || !Number.isFinite(v) ? d : v;
  } catch {
    return d;
  }
};
let volume = Math.max(0, Math.min(1, readNum('studio.volume', 1)));
let muted = readNum('studio.muted', 0) === 1;
const volListeners = new Set<() => void>();
const persist = () => {
  try {
    localStorage.setItem('studio.volume', String(volume));
    localStorage.setItem('studio.muted', muted ? '1' : '0');
  } catch {}
  volListeners.forEach((l) => l());
};
export const monitor = {
  get volume() {
    return volume;
  },
  get muted() {
    return muted;
  },
  /** What a clip's volume is multiplied by in the preview. */
  get gain() {
    return muted ? 0 : volume;
  },
  setVolume(v: number) {
    volume = Math.max(0, Math.min(1, v));
    if (volume > 0) muted = false;
    persist();
  },
  toggleMute() {
    // Unmuting at zero would stay silent: come back at a usable level.
    if (muted || volume === 0) {
      muted = false;
      if (volume === 0) volume = 0.8;
    } else muted = true;
    persist();
  },
  subscribe(l: () => void) {
    volListeners.add(l);
    return () => void volListeners.delete(l);
  },
};
let monitorSnap = { volume, muted };
export const useMonitor = () =>
  useSyncExternalStore(monitor.subscribe, () => (monitorSnap.volume === volume && monitorSnap.muted === muted ? monitorSnap : (monitorSnap = { volume, muted })));

export function timecode(t: number, fps: number) {
  const f = Math.round(t * fps);
  const s = Math.floor(f / fps);
  const pad = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}:${pad(f % fps)}`;
}
