// Edit operations. Every function mutates the project it is given; the UI runs them inside immer,
// the server runs them on the stored project. The REST API and the MCP server call the same code.
import { LAYOUTS, CAPTION_PRESETS, TITLE_PRESETS, baseStyle, neutralFx, noTransition } from './presets';
import { coverScale, slotTransform, EASES, pickTransform, transformAt } from './geometry';
import { addBumper, applyBrandStyle, brandCaptionStyle, brandTitleStyle, clearBrandStyle } from './brand';
import type { Asset, BlendMode, Clip, Ease, Keyframe, Project, TextStyle, Track, TrackKind, Transform, Watermark, Word } from './types';
import { audioFades, clamp, clipEnd, projectDuration, uid } from './types';

const EPS = 1e-4;
export const defaultTransform = (): Transform => ({ x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 });
export const captionTransform = (): Transform => ({ x: 0.5, y: 0.84, scale: 1, rotation: 0, opacity: 1 });
const isHebrew = (s: string) => /[֐-׿]/.test(s);

export function newProject(name = 'Untitled', width = 1920, height = 1080, fps = 60): Project {
  const now = new Date().toISOString();
  return {
    id: uid('p_'),
    name,
    width,
    height,
    fps,
    // Two layers of each from the start, so a clip can be dragged above or below another right away.
    tracks: [
      { id: uid('t_'), kind: 'video', name: 'Video 2', muted: false, hidden: false, clips: [] },
      { id: uid('t_'), kind: 'video', name: 'Video 1', muted: false, hidden: false, clips: [] },
      { id: uid('t_'), kind: 'audio', name: 'Audio 1', muted: false, hidden: false, clips: [] },
      { id: uid('t_'), kind: 'audio', name: 'Audio 2', muted: false, hidden: false, clips: [] },
    ],
    assets: [],
    markIn: null,
    markOut: null,
    rev: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function findClip(p: Project, id: string) {
  for (const track of p.tracks) {
    const index = track.clips.findIndex((c) => c.id === id);
    if (index >= 0) return { track, clip: track.clips[index], index };
  }
  return null;
}
const need = (p: Project, id: string) => {
  const f = findClip(p, id);
  if (!f) throw new Error(`Clip not found: ${id}`);
  return f;
};
const needTrack = (p: Project, id: string) => {
  const t = p.tracks.find((x) => x.id === id);
  if (!t) throw new Error(`Track not found: ${id}`);
  return t;
};
const sortTrack = (t: Track) => t.clips.sort((a, b) => a.start - b.start);
const snapFrame = (p: Project, t: number) => Math.max(0, Math.round(t * p.fps) / p.fps);

/** Tracks are ordered top layer first: text and captions, then video, then audio. */
export function addTrack(p: Project, kind: TrackKind, name?: string): Track {
  const count = p.tracks.filter((t) => t.kind === kind).length + 1;
  const label = { video: 'Video', audio: 'Audio', text: 'Text', caption: 'Captions' }[kind];
  const track: Track = { id: uid('t_'), kind, name: name || `${label} ${count}`, muted: false, hidden: false, clips: [] };
  if (kind === 'caption') {
    const preset = p.brand ? CAPTION_PRESETS.find((x) => x.id === p.brand!.captionPreset) || CAPTION_PRESETS[0] : CAPTION_PRESETS[0];
    track.style = p.brand ? brandCaptionStyle(p.brand, preset.id) : { ...preset.style };
    track.transform = captionTransform();
    track.captionPreset = preset.id;
  }
  let index = p.tracks.length;
  if (kind === 'text' || kind === 'caption') index = 0;
  else if (kind === 'video') {
    const i = p.tracks.findIndex((t) => t.kind === 'video' || t.kind === 'audio');
    index = i < 0 ? p.tracks.length : i;
  }
  p.tracks.splice(index, 0, track);
  return track;
}

export function removeTrack(p: Project, trackId: string) {
  needTrack(p, trackId);
  p.tracks = p.tracks.filter((t) => t.id !== trackId);
}

/** Move a track to another layer position: 0 = the top layer. */
export function moveTrack(p: Project, trackId: string, index: number) {
  const i = p.tracks.findIndex((t) => t.id === trackId);
  if (i < 0) throw Object.assign(new Error(`Track not found: ${trackId}`), { status: 404 });
  const [t] = p.tracks.splice(i, 1);
  p.tracks.splice(clamp(Math.round(index), 0, p.tracks.length), 0, t);
  return p.tracks.map((x) => x.id);
}

export function updateTrack(p: Project, trackId: string, patch: Partial<Track>) {
  const t = needTrack(p, trackId);
  const { style, transform, clips, id, kind, ...rest } = patch as any;
  Object.assign(t, rest);
  if (style) t.style = { ...(t.style || baseStyle), ...style };
  if (transform) t.transform = { ...(t.transform || captionTransform()), ...transform };
}

/** First start time >= `start` where a clip of `duration` fits on the track without overlap. */
export function freeStart(track: Track, start: number, duration: number, ignoreId?: string) {
  let s = Math.max(0, start);
  const others = track.clips.filter((c) => c.id !== ignoreId).sort((a, b) => a.start - b.start);
  for (const c of others) {
    if (s + duration <= c.start + EPS) break;
    if (s < clipEnd(c) - EPS) s = clipEnd(c);
  }
  return s;
}

function blankClip(type: Clip['type'], start: number, duration: number): Clip {
  return { id: uid('c_'), type, start, duration, in: 0, speed: 1, volume: 1, muted: false, transform: defaultTransform(), fx: neutralFx(), tin: noTransition(), tout: noTransition() };
}

export interface AddMediaOpts {
  trackId?: string;
  start?: number;
  /** Put the clip on a layer above the main video, muted. */
  broll?: boolean;
  duration?: number;
  in?: number;
}

export function addMediaClip(p: Project, assetId: string, o: AddMediaOpts = {}): Clip {
  const asset = p.assets.find((a) => a.id === assetId);
  if (!asset) throw new Error(`Asset not found: ${assetId}`);
  const kind: TrackKind = asset.kind === 'audio' ? 'audio' : 'video';
  const inPoint = clamp(o.in ?? 0, 0, Math.max(0, asset.duration - 0.05));
  const duration = o.duration ?? (asset.kind === 'image' ? 4 : Math.max(0.1, asset.duration - inPoint));
  let track: Track | undefined = o.trackId ? needTrack(p, o.trackId) : undefined;
  if (track && track.kind !== kind) throw new Error(`A ${asset.kind} clip cannot go on a ${track.kind} track`);
  const tracksOfKind = p.tracks.filter((t) => t.kind === kind);
  // The first video dropped into an empty project sets the frame size and frame rate.
  const empty = p.tracks.every((t) => t.clips.length === 0);
  if (empty && !p.sizeLocked && asset.kind === 'video' && asset.width && asset.height) {
    p.width = asset.width - (asset.width % 2);
    p.height = asset.height - (asset.height % 2);
    if (asset.fps) p.fps = asset.fps > 49 ? 60 : asset.fps > 27 ? 30 : Math.round(asset.fps);
  }
  let start = o.start;
  if (!track) {
    if (o.broll && kind === 'video') {
      const main = tracksOfKind[tracksOfKind.length - 1];
      const at = start ?? 0;
      track = tracksOfKind.find((t) => t !== main && freeStart(t, at, duration) <= at + EPS) || addTrack(p, 'video');
    } else if (kind === 'video') {
      track = tracksOfKind[tracksOfKind.length - 1] || addTrack(p, 'video');
    } else {
      const at = start ?? 0;
      track = tracksOfKind.find((t) => freeStart(t, at, duration) <= at + EPS) || tracksOfKind[0] || addTrack(p, 'audio');
    }
  }
  if (start == null) start = track.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  const clip = blankClip(asset.kind, freeStart(track, snapFrame(p, start), duration), duration);
  clip.assetId = asset.id;
  clip.name = asset.name;
  clip.in = inPoint;
  if (o.broll) clip.muted = true;
  if (track.slot && asset.kind !== 'audio') clip.transform = { ...clip.transform, ...slotTransform(p, asset, track.slot) };
  track.clips.push(clip);
  sortTrack(track);
  return clip;
}

export interface AddTextOpts {
  text?: string;
  preset?: string;
  start?: number;
  duration?: number;
  trackId?: string;
  style?: Partial<TextStyle>;
  transform?: Partial<Transform>;
}

export function addTextClip(p: Project, o: AddTextOpts = {}): Clip {
  const preset = TITLE_PRESETS.find((x) => x.id === o.preset) || TITLE_PRESETS[0];
  const duration = o.duration ?? 3;
  const start = snapFrame(p, o.start ?? 0);
  let track = o.trackId ? needTrack(p, o.trackId) : p.tracks.find((t) => t.kind === 'text' && freeStart(t, start, duration) <= start + EPS);
  if (!track) track = addTrack(p, 'text');
  if (track.kind !== 'text') throw new Error('Text clips go on text tracks');
  const clip = blankClip('text', freeStart(track, start, duration), duration);
  clip.text = o.text ?? preset.sample;
  clip.name = clip.text;
  clip.style = { ...(p.brand ? brandTitleStyle(p.brand, preset.id) : preset.style), ...(o.style || {}) };
  clip.preset = preset.id;
  clip.transform = { ...defaultTransform(), y: preset.y ?? 0.5, ...(o.transform || {}) };
  track.clips.push(clip);
  sortTrack(track);
  return clip;
}

/** The part of clip `c` that covers the timeline range [a, b). */
/**
 * The keyframes of the part of a clip that starts `delta` seconds in and lasts `duration`: the ones inside it,
 * shifted, plus one at each end with the value the move had there.
 */
function rebaseKeyframes(c: Clip, delta: number, duration: number): Keyframe[] {
  const src = c.keyframes || [];
  const inside = src.filter((k) => k.t > delta + EPS && k.t < delta + duration - EPS).map((k) => ({ ...k, t: k.t - delta }));
  const after = src.find((k) => k.t >= delta + duration - EPS);
  return [{ ...transformAt(c, delta), t: 0, ease: 'linear' as Ease }, ...inside, { ...transformAt(c, delta + duration), t: duration, ease: after?.ease || 'linear' }];
}
const cleanKeyframes = (clip: Clip, list: any[]): Keyframe[] => {
  const base = clip.transform;
  const num = (v: any, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const out = list
    .map((k) => ({
      t: clamp(num(k?.t, 0), 0, clip.duration),
      x: num(k?.x, base.x),
      y: num(k?.y, base.y),
      scale: clamp(num(k?.scale, base.scale), 0.01, 20),
      rotation: num(k?.rotation, base.rotation),
      opacity: clamp(num(k?.opacity, base.opacity), 0, 1),
      ease: (EASES.includes(k?.ease) ? k.ease : 'ease-in-out') as Ease,
    }))
    .sort((a, b) => a.t - b.t);
  // two keyframes on the same moment: the later one in the list wins
  return out.filter((k, i) => i === out.length - 1 || out[i + 1].t - k.t > EPS);
};

/**
 * Set (or move) a keyframe at a timeline time. Values not given keep what the clip shows at that moment, so
 * "add a keyframe here, then change the scale" works. The first keyframe of a clip starts from its fixed transform.
 */
export function setKeyframe(p: Project, clipId: string, time: number, values: Partial<Transform> = {}, ease?: Ease): Keyframe {
  const { clip } = need(p, clipId);
  if (clip.type === 'audio' || clip.type === 'caption') throw new Error('Only video, image and text clips can be animated');
  const t = clamp(snapFrame(p, time) - clip.start, 0, clip.duration);
  const list = clip.keyframes || [];
  const half = 0.5 / p.fps;
  const old = list.find((k) => Math.abs(k.t - t) <= half);
  const kf: Keyframe = { ...transformAt(clip, t), ...pickPatch(values), t: old ? old.t : t, ease: ease && EASES.includes(ease) ? ease : old?.ease || 'ease-in-out' };
  clip.keyframes = cleanKeyframes(clip, [...list.filter((k) => k !== old), kf]);
  return kf;
}
const pickPatch = (v: Partial<Transform>) => {
  const out: Partial<Transform> = {};
  for (const key of ['x', 'y', 'scale', 'rotation', 'opacity'] as const) if (v[key] != null && Number.isFinite(Number(v[key]))) out[key] = Number(v[key]);
  return out;
};

/** Remove the keyframe at a timeline time, or every keyframe when no time is given. The clip keeps how it looked. */
export function removeKeyframes(p: Project, clipId: string, time?: number) {
  const { clip } = need(p, clipId);
  const list = clip.keyframes || [];
  if (!list.length) return 0;
  if (time == null) {
    clip.transform = pickTransform(list[0]);
    delete clip.keyframes;
    return list.length;
  }
  const t = snapFrame(p, time) - clip.start;
  const hit = list.reduce((best, k) => (Math.abs(k.t - t) < Math.abs(best.t - t) ? k : best), list[0]);
  if (Math.abs(hit.t - t) > 0.5 / p.fps + EPS) return 0;
  const rest = list.filter((k) => k !== hit);
  if (rest.length) clip.keyframes = rest;
  else {
    clip.transform = pickTransform(hit);
    delete clip.keyframes;
  }
  return 1;
}

/**
 * Change a clip's transform the way the editor does: a clip that is animated gets a keyframe at `time`,
 * a clip that is not simply changes.
 */
export function applyTransform(p: Project, clipId: string, values: Partial<Transform>, time: number) {
  const { clip } = need(p, clipId);
  if (clip.keyframes?.length) setKeyframe(p, clipId, time, values);
  else clip.transform = { ...clip.transform, ...pickPatch(values) };
}

export interface ZoomOpts {
  /** Timeline time the zoom starts. Default: the start of the clip. */
  start?: number;
  /** Timeline time the picture is back to normal. Without it the clip stays zoomed to its end. */
  end?: number;
  /** How much closer: 1.5 = one and a half times the clip's current size. Below 1 zooms out. */
  scale?: number;
  /** The point to zoom towards, as fractions of the frame (0.5, 0.5 = the centre). */
  x?: number;
  y?: number;
  /** Seconds the move in (and the move back) takes. Default 0.6, or the whole span for a slow push. */
  ramp?: number;
  ease?: Ease;
}
/**
 * Zoom towards a point and (with `end`) back out. It writes ordinary keyframes: one where the move starts,
 * one where it arrives, and, when it returns, one where it leaves and one where it is back.
 */
export function addZoom(p: Project, clipId: string, o: ZoomOpts = {}): Keyframe[] {
  const { clip } = need(p, clipId);
  const from = clamp(o.start ?? clip.start, clip.start, clipEnd(clip));
  const to = o.end != null ? clamp(o.end, from, clipEnd(clip)) : undefined;
  const span = (to ?? clipEnd(clip)) - from;
  if (span < 2 / p.fps) throw new Error('The zoom needs at least two frames of the clip');
  const z = clamp(Number(o.scale) || 1.5, 0.05, 20);
  const ease: Ease = o.ease && EASES.includes(o.ease) ? o.ease : 'ease-in-out';
  const ramp = clamp(Number(o.ramp) || (to == null ? Math.min(0.6, span) : Math.min(0.6, span / 2)), 1 / p.fps, to == null ? span : span / 2);
  const fx = o.x ?? 0.5;
  const fy = o.y ?? 0.5;
  // Zooming about a point: the centre moves away from it by the same factor the picture grows.
  const zoomed = (b: Transform): Partial<Transform> => ({ scale: b.scale * z, x: fx + (b.x - fx) * z, y: fy + (b.y - fy) * z });
  const base = transformAt(clip, from - clip.start);
  const made = [setKeyframe(p, clipId, from, base, 'linear'), setKeyframe(p, clipId, from + ramp, zoomed(base), ease)];
  if (to != null) {
    const back = transformAt(clip, to - clip.start);
    if (to - ramp > from + ramp + EPS) made.push(setKeyframe(p, clipId, to - ramp, zoomed(base), 'linear'));
    made.push(setKeyframe(p, clipId, to, { ...back, scale: base.scale, x: base.x, y: base.y }, ease));
  }
  return made;
}

function slice(c: Clip, a: number, b: number, keepId = false): Clip | null {
  a = Math.max(a, c.start);
  b = Math.min(b, clipEnd(c));
  if (b - a < EPS) return null;
  const delta = a - c.start;
  const n: Clip = JSON.parse(JSON.stringify(c));
  if (!keepId) n.id = uid('c_');
  n.start = a;
  n.duration = b - a;
  if (c.type === 'video' || c.type === 'audio') n.in = c.in + delta * c.speed;
  if (delta > EPS) n.tin = noTransition();
  if (clipEnd(c) - b > EPS) n.tout = noTransition();
  if (c.keyframes?.length) n.keyframes = rebaseKeyframes(c, delta, n.duration);
  if (c.words?.length) {
    n.words = c.words
      .filter((w) => (w.t0 + w.t1) / 2 >= delta && (w.t0 + w.t1) / 2 < delta + n.duration)
      .map((w) => ({ ...w, t0: Math.max(0, w.t0 - delta), t1: Math.min(n.duration, w.t1 - delta) }));
    if (!n.words.length) return null;
    n.text = n.words.map((w) => w.text).join(' ');
    n.name = n.text;
  }
  return n;
}

export function splitClip(p: Project, clipId: string, t: number): Clip | null {
  const { track, clip, index } = need(p, clipId);
  t = snapFrame(p, t);
  if (t <= clip.start + EPS || t >= clipEnd(clip) - EPS) return null;
  const left = slice(clip, clip.start, t, true);
  const right = slice(clip, t, clipEnd(clip));
  const parts = [left, right].filter(Boolean) as Clip[];
  track.clips.splice(index, 1, ...parts);
  return right;
}

/** Split every clip under time `t` (or only the given clips). */
export function splitAt(p: Project, t: number, clipIds?: string[]): string[] {
  const made: string[] = [];
  for (const track of p.tracks) {
    for (const c of [...track.clips]) {
      if (clipIds?.length && !clipIds.includes(c.id)) continue;
      const r = splitClip(p, c.id, t);
      if (r) made.push(r.id);
    }
  }
  return made;
}

/** Delete clips. With `ripple`, later clips on the same track move left to close the gap. */
export function deleteClips(p: Project, ids: string[], ripple = false) {
  for (const id of ids) {
    const f = findClip(p, id);
    if (!f) continue;
    const { track, clip } = f;
    track.clips = track.clips.filter((c) => c.id !== id);
    if (ripple) for (const c of track.clips) if (c.start >= clipEnd(clip) - EPS) c.start = Math.max(0, c.start - clip.duration);
  }
}

/** Remove the timeline range [t0, t1) from every track and close the gap. */
export function cutRange(p: Project, t0: number, t1: number, trackIds?: string[]) {
  t0 = snapFrame(p, Math.min(t0, t1));
  t1 = snapFrame(p, Math.max(t0, t1));
  const len = t1 - t0;
  if (len < EPS) return 0;
  for (const track of p.tracks) {
    if (trackIds?.length && !trackIds.includes(track.id)) continue;
    const out: Clip[] = [];
    for (const c of track.clips) {
      const e = clipEnd(c);
      if (e <= t0 + EPS) out.push(c);
      else if (c.start >= t1 - EPS) out.push({ ...c, start: c.start - len });
      else {
        const left = c.start < t0 - EPS ? slice(c, c.start, t0, true) : null;
        const right = e > t1 + EPS ? slice(c, t1, e, !left) : null;
        if (left) out.push(left);
        if (right) out.push({ ...right, start: t0 });
      }
    }
    track.clips = out;
    sortTrack(track);
  }
  if (p.markIn != null || p.markOut != null) {
    p.markIn = null;
    p.markOut = null;
  }
  return len;
}

function sourceLimit(p: Project, c: Clip) {
  if (c.type !== 'video' && c.type !== 'audio') return Infinity;
  return p.assets.find((a) => a.id === c.assetId)?.duration ?? Infinity;
}

/** Drag a clip edge. `edge: 'start'` trims the beginning, `'end'` trims the end. */
export function trimClip(p: Project, clipId: string, edge: 'start' | 'end', t: number) {
  const { track, clip } = need(p, clipId);
  t = snapFrame(p, t);
  const others = track.clips.filter((c) => c.id !== clip.id);
  const min = 1 / p.fps;
  if (edge === 'start') {
    const prevEnd = others.filter((c) => clipEnd(c) <= clip.start + EPS).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
    const earliest = clip.type === 'video' || clip.type === 'audio' ? clip.start - clip.in / clip.speed : 0;
    const ns = clamp(t, Math.max(prevEnd, earliest, 0), clipEnd(clip) - min);
    const delta = ns - clip.start;
    if (clip.type === 'video' || clip.type === 'audio') clip.in = Math.max(0, clip.in + delta * clip.speed);
    if (clip.words) clip.words = clip.words.map((w) => ({ ...w, t0: w.t0 - delta, t1: w.t1 - delta }));
    if (clip.keyframes?.length) clip.keyframes = delta > 0 ? rebaseKeyframes(clip, delta, clip.duration - delta) : clip.keyframes.map((k) => ({ ...k, t: k.t - delta }));
    clip.duration -= delta;
    clip.start = ns;
  } else {
    const nextStart = others.filter((c) => c.start >= clipEnd(clip) - EPS).reduce((m, c) => Math.min(m, c.start), Infinity);
    const latest = clip.start + (sourceLimit(p, clip) - clip.in) / clip.speed;
    const d = clamp(t, clip.start + min, Math.min(nextStart, latest)) - clip.start;
    if (clip.keyframes?.length && clip.keyframes.some((k) => k.t > d + EPS)) clip.keyframes = rebaseKeyframes(clip, 0, d);
    clip.duration = d;
  }
}

export function moveClip(p: Project, clipId: string, start: number, trackId?: string) {
  const { track, clip } = need(p, clipId);
  let target = trackId ? needTrack(p, trackId) : track;
  const kindOf = (c: Clip): TrackKind => (c.type === 'image' ? 'video' : (c.type as TrackKind));
  if (target.kind !== kindOf(clip)) target = track;
  if (target !== track) {
    track.clips = track.clips.filter((c) => c.id !== clip.id);
    target.clips.push(clip);
    // In a layout, a clip moved to another layer takes that layer's place in the frame.
    if (!clip.keyframes?.length && (target.slot || track.slot)) {
      const asset = p.assets.find((a) => a.id === clip.assetId);
      clip.transform = { ...clip.transform, ...(target.slot ? slotTransform(p, asset, target.slot) : { x: 0.5, y: 0.5, scale: 1 }) };
    }
  }
  clip.start = freeStart(target, snapFrame(p, start), clip.duration, clip.id);
  sortTrack(target);
}

const kindOfClip = (c: Clip): TrackKind => (c.type === 'image' ? 'video' : (c.type as TrackKind));
/** Move a clip onto a layer, refitting it when it leaves or enters a layout slot. */
function changeTrack(p: Project, clip: Clip, from: Track, to: Track) {
  if (from === to) return;
  from.clips = from.clips.filter((c) => c.id !== clip.id);
  to.clips.push(clip);
  if (!clip.keyframes?.length && (to.slot || from.slot)) {
    const asset = p.assets.find((a) => a.id === clip.assetId);
    clip.transform = { ...clip.transform, ...(to.slot ? slotTransform(p, asset, to.slot) : { x: 0.5, y: 0.5, scale: 1 }) };
  }
}

/** While dragging: put a clip anywhere, overlaps allowed. `insertClip` settles it when the clip is let go. */
export function placeClip(p: Project, clipId: string, start: number, trackId?: string) {
  const { track, clip } = need(p, clipId);
  const target = trackId ? needTrack(p, trackId) : track;
  if (target.kind === kindOfClip(clip)) changeTrack(p, clip, track, target);
  clip.start = Math.max(0, start);
  sortTrack(target.kind === kindOfClip(clip) ? target : track);
}

/**
 * An overlay (light leak, film grain, dust, flare...): on a new video layer above everything, filling the frame,
 * muted, mixed with `screen` so its black disappears and only the light stays.
 */
export function addOverlayClip(p: Project, assetId: string, o: { start?: number; duration?: number; blend?: BlendMode } = {}): Clip {
  const asset = p.assets.find((a) => a.id === assetId);
  if (!asset || asset.kind === 'audio') throw Object.assign(new Error('An overlay must be a video or an image in the project'), { status: 400 });
  const clip = addMediaClip(p, assetId, { start: o.start ?? 0, duration: o.duration, broll: true });
  moveClipToNewTrack(p, clip.id, 'above', clip.start);
  const c = need(p, clip.id).clip;
  c.blend = o.blend || 'screen';
  c.muted = true;
  c.transform = { ...c.transform, x: 0.5, y: 0.5, scale: coverScale(p, asset) };
  return c;
}

/**
 * Drop a clip into a layer the way editors like CapCut do: it goes in at `at` and the clips from there on move right
 * to make room. Dropped inside another clip, it goes before it (first half) or after it (second half).
 * With `ripple`, the gap it left behind closes. `from` is where the clip was before the drag started.
 */
export function insertClip(p: Project, clipId: string, at: number, o: { trackId?: string; ripple?: boolean; from?: { trackId: string; start: number } } = {}) {
  const { track: now, clip } = need(p, clipId);
  let target = o.trackId ? needTrack(p, o.trackId) : now;
  if (target.kind !== kindOfClip(clip)) target = now;
  const dur = clip.duration;
  now.clips = now.clips.filter((c) => c.id !== clip.id);
  const from = o.from && p.tracks.find((t) => t.id === o.from!.trackId);
  if (o.ripple && from) {
    const gapEnd = o.from!.start + dur;
    for (const c of from.clips) if (c.start >= gapEnd - EPS) c.start = Math.max(0, c.start - dur);
    if (from === target && at >= gapEnd - EPS) at -= dur;
  }
  at = Math.max(0, at);
  const hit = target.clips.find((c) => at > c.start + EPS && at < clipEnd(c) - EPS);
  if (hit) at = at < hit.start + hit.duration / 2 ? hit.start : clipEnd(hit);
  at = snapFrame(p, at);
  const after = target.clips.filter((c) => c.start >= at - EPS);
  const first = after.reduce((m, c) => Math.min(m, c.start), Infinity);
  const push = Math.max(0, at + dur - first);
  if (push > EPS) for (const c of after) c.start += push;
  now.clips.push(clip);
  changeTrack(p, clip, now, target);
  clip.start = at;
  sortTrack(target);
  if (from) sortTrack(from);
  return { start: at, trackId: target.id, pushed: push > EPS ? after.length : 0 };
}

/**
 * Change a clip's speed. Slower makes it longer, so the clips after it on its layer move right; faster makes it
 * shorter and, with `ripple`, they follow it left.
 */
export function setClipSpeed(p: Project, clipId: string, speed: number, ripple = true) {
  const { track, clip } = need(p, clipId);
  const oldEnd = clipEnd(clip);
  updateClip(p, clipId, { speed });
  const delta = clipEnd(clip) - oldEnd;
  if (delta > EPS || (ripple && delta < -EPS)) for (const c of track.clips) if (c !== clip && c.start >= oldEnd - EPS) c.start = Math.max(0, c.start + delta);
  sortTrack(track);
  return clip;
}

/**
 * Split a video clip's sound off onto an audio layer, so the two can be moved and trimmed apart. The new audio clip
 * plays the same part of the source at the same time; the video clip is muted. Returns the audio clip.
 */
export function detachAudio(p: Project, clipId: string): Clip {
  const { clip } = need(p, clipId);
  const asset = p.assets.find((a) => a.id === clip.assetId);
  if (clip.type !== 'video' || !asset?.hasAudio) throw Object.assign(new Error('Only a video clip with sound can have its audio split off'), { status: 400 });
  if (clip.muted) throw Object.assign(new Error('This clip is muted: its audio was already split off or turned off'), { status: 400 });
  const [fadeIn, fadeOut] = audioFades(clip);
  const audioTracks = p.tracks.filter((t) => t.kind === 'audio');
  const track = audioTracks.find((t) => freeStart(t, clip.start, clip.duration) <= clip.start + EPS) || addTrack(p, 'audio');
  const a = blankClip('audio', clip.start, clip.duration);
  Object.assign(a, { assetId: asset.id, name: clip.name || asset.name, in: clip.in, speed: clip.speed, volume: clip.volume, fadeIn, fadeOut });
  track.clips.push(a);
  sortTrack(track);
  clip.muted = true;
  return a;
}

/**
 * Move a clip onto a new layer of its kind, made right above the topmost layer of that kind ('above') or right
 * below the lowest one ('below'). This is what dragging a clip above or below every layer does.
 */
export function moveClipToNewTrack(p: Project, clipId: string, where: 'above' | 'below', start?: number): Track {
  const { clip } = need(p, clipId);
  const kind: TrackKind = clip.type === 'image' ? 'video' : (clip.type as TrackKind);
  const track = addTrack(p, kind);
  const same = p.tracks.filter((t) => t.kind === kind && t !== track);
  if (same.length) {
    // Positions are counted without the new layer, which is where moveTrack puts it back.
    const rest = p.tracks.filter((t) => t !== track);
    moveTrack(p, track.id, where === 'above' ? rest.indexOf(same[0]) : rest.indexOf(same[same.length - 1]) + 1);
  }
  moveClip(p, clipId, start ?? clip.start, track.id);
  return track;
}

export function updateClip(p: Project, clipId: string, patch: Partial<Clip>) {
  const { clip } = need(p, clipId);
  const { transform, fx, tin, tout, style, id, type, keyframes, ...rest } = patch as any;
  if (rest.blend !== undefined && rest.blend !== null && !BLEND_MODES.includes(rest.blend)) throw Object.assign(new Error(`Blend modes: ${BLEND_MODES.join(', ')}`), { status: 400 });
  if (rest.blend === 'normal' || rest.blend === null) rest.blend = undefined;
  if (rest.speed != null) {
    const speed = clamp(rest.speed, 0.1, 8);
    // the animation keeps its place in the picture: it stretches with the clip
    if (clip.keyframes?.length && (clip.type === 'video' || clip.type === 'audio')) clip.keyframes = clip.keyframes.map((k) => ({ ...k, t: (k.t * clip.speed) / speed }));
    // Keep the same piece of source: the clip gets shorter or longer on the timeline.
    if (clip.type === 'video' || clip.type === 'audio') clip.duration = (clip.duration * clip.speed) / speed;
    rest.speed = speed;
  }
  Object.assign(clip, rest);
  if (transform) {
    clip.transform = { ...clip.transform, ...transform };
    // an animated clip: the same change applies to every keyframe (use set_keyframe to change one moment)
    if (clip.keyframes?.length && keyframes === undefined) clip.keyframes = clip.keyframes.map((k) => ({ ...k, ...pickPatch(transform) }));
  }
  if (keyframes !== undefined) {
    if (Array.isArray(keyframes) && keyframes.length) clip.keyframes = cleanKeyframes(clip, keyframes);
    else delete clip.keyframes;
  }
  if (fx) clip.fx = { ...clip.fx, ...fx };
  if (tin) clip.tin = { ...clip.tin, ...tin };
  if (tout) clip.tout = { ...clip.tout, ...tout };
  if (style) clip.style = { ...(clip.style || baseStyle), ...style };
  if (rest.text != null && clip.type === 'text') clip.name = rest.text;
  if (rest.text != null && clip.type === 'caption') {
    // Re-spread the word timings over the edited text so the karaoke highlight keeps working.
    const tokens = String(rest.text).split(/\s+/).filter(Boolean);
    const old = clip.words || [];
    clip.words = tokens.map((text, i) => {
      if (old.length === tokens.length) return { ...old[i], text };
      return { text, t0: (clip.duration * i) / tokens.length, t1: (clip.duration * (i + 1)) / tokens.length };
    });
    clip.name = rest.text;
  }
  clip.duration = Math.max(1 / p.fps, clip.duration);
  clip.start = Math.max(0, clip.start);
}

/**
 * Move one keyframe to another moment of its clip (seconds on the timeline). Returns false when another keyframe
 * already sits there; the clip keeps its look at every other keyframe.
 */
export function moveKeyframe(p: Project, clipId: string, from: number, to: number): boolean {
  const { clip } = need(p, clipId);
  const half = 0.5 / p.fps;
  const kfs = clip.keyframes || [];
  const k = kfs.find((x) => Math.abs(x.t - (from - clip.start)) <= half);
  if (!k) throw Object.assign(new Error('No keyframe at that time'), { status: 404 });
  const t = snapFrame(p, clamp(to - clip.start, 0, clip.duration));
  if (kfs.some((x) => x !== k && Math.abs(x.t - t) <= half)) return false;
  k.t = t;
  kfs.sort((a, b) => a.t - b.t);
  return true;
}

export const BLEND_MODES: BlendMode[] = ['normal', 'screen', 'multiply', 'overlay', 'lighten'];
export function setBlend(p: Project, clipId: string, blend: BlendMode) {
  const { clip } = need(p, clipId);
  if (clip.type !== 'video' && clip.type !== 'image') throw Object.assign(new Error('Only video and image clips can blend'), { status: 400 });
  if (!BLEND_MODES.includes(blend)) throw Object.assign(new Error(`Blend modes: ${BLEND_MODES.join(', ')}`), { status: 400 });
  if (blend === 'normal') delete clip.blend;
  else clip.blend = blend;
}

export function duplicateClip(p: Project, clipId: string): Clip {
  const { track, clip } = need(p, clipId);
  const n: Clip = JSON.parse(JSON.stringify(clip));
  n.id = uid('c_');
  n.start = freeStart(track, clipEnd(clip), clip.duration);
  track.clips.push(n);
  sortTrack(track);
  return n;
}

/** Set or change the logo watermark (assetId: an image in the project), or remove it with null. */
export function setWatermark(p: Project, w: (Partial<Watermark> & { assetId?: string }) | null) {
  if (!w) return void (p.watermark = null);
  const assetId = w.assetId ?? p.watermark?.assetId;
  const asset = p.assets.find((a) => a.id === assetId);
  if (!asset || asset.kind !== 'image') throw Object.assign(new Error('The watermark must be an image in the project (a PNG with a transparent background works best)'), { status: 400 });
  const cur = p.watermark || { assetId: asset.id, corner: 'br' as const, size: 0.14, opacity: 0.85, margin: 0.035 };
  p.watermark = {
    assetId: asset.id,
    corner: (['tl', 'tr', 'bl', 'br'] as const).includes(w.corner as any) ? (w.corner as Watermark['corner']) : cur.corner,
    size: clamp(w.size ?? cur.size, 0.03, 0.6),
    opacity: clamp(w.opacity ?? cur.opacity, 0.05, 1),
    margin: clamp(w.margin ?? cur.margin, 0, 0.2),
  };
}

/**
 * Arrange the video layers in a layout (see LAYOUTS): the top layers get its slots, and the clips on them are
 * fitted in (animated clips keep their own motion). 'single' takes the slots away and puts clips back full frame.
 */
export function applyLayout(p: Project, id: string) {
  const layout = LAYOUTS.find((l) => l.id === id);
  if (!layout) throw Object.assign(new Error(`Unknown layout "${id}". Layouts: ${LAYOUTS.map((l) => l.id).join(', ')}`), { status: 400 });
  while (p.tracks.filter((t) => t.kind === 'video').length < layout.slots.length) addTrack(p, 'video');
  const videos = p.tracks.filter((t) => t.kind === 'video');
  videos.forEach((t, i) => {
    const had = !!t.slot;
    const slot = layout.slots[i] || undefined;
    if (slot) t.slot = { ...slot };
    else delete t.slot;
    if (!slot && !had) return;
    for (const c of t.clips) {
      if (c.keyframes?.length || c.type === 'audio') continue;
      const asset = p.assets.find((a) => a.id === c.assetId);
      c.transform = { ...c.transform, ...(slot ? slotTransform(p, asset, slot) : { x: 0.5, y: 0.5, scale: 1 }) };
    }
  });
  p.layout = id;
}

export function setProjectSettings(p: Project, s: Partial<Pick<Project, 'name' | 'width' | 'height' | 'fps'>>) {
  if (s.name != null) p.name = String(s.name);
  if (s.width || s.height) p.sizeLocked = true;
  if (s.width) p.width = Math.round(s.width / 2) * 2;
  if (s.height) p.height = Math.round(s.height / 2) * 2;
  if (s.fps) p.fps = clamp(Math.round(s.fps), 1, 120);
}

/**
 * Change the frame's shape, e.g. a horizontal recording into a 9:16 reel, and lay the picture out again: each video or
 * image clip that sits full-frame (centred, no keyframes) is re-fitted to the new frame. `fill` (default) covers the
 * frame and crops the sides; `fit` shows the whole picture. Captions and titles keep their relative place, so they stay
 * inside the new frame. Better than cropping at export, which cuts captions that were laid out for the old shape.
 */
export function reshapeProject(p: Project, width: number, height: number, mode: 'fill' | 'fit' = 'fill') {
  if (!(width >= 16 && height >= 16 && width <= 7680 && height <= 7680)) throw Object.assign(new Error('width and height must be 16-7680'), { status: 400 });
  setProjectSettings(p, { width, height });
  let refitted = 0;
  for (const t of p.tracks) {
    if (t.kind !== 'video') continue;
    for (const c of t.clips) {
      const a = c.assetId ? p.assets.find((x) => x.id === c.assetId) : undefined;
      if (!a || a.kind === 'audio' || c.keyframes?.length) continue;
      const tr = c.transform || ({} as any);
      // Only clips that fill the frame the usual way; a picture-in-picture or a placed logo keeps its spot.
      if (Math.abs((tr.x ?? 0.5) - 0.5) > 0.02 || Math.abs((tr.y ?? 0.5) - 0.5) > 0.02) continue;
      c.transform = { ...tr, x: 0.5, y: 0.5, scale: mode === 'fill' ? coverScale(p, a) : 1 };
      refitted++;
    }
  }
  return { width: p.width, height: p.height, refitted };
}

export function removeAsset(p: Project, assetId: string) {
  p.assets = p.assets.filter((a) => a.id !== assetId);
  for (const t of p.tracks) t.clips = t.clips.filter((c) => c.assetId !== assetId);
}

// ---------- captions ----------

export interface CaptionOpts {
  maxWords?: number;
  maxChars?: number;
  /** Start a new caption when the speaker pauses longer than this (seconds). */
  gap?: number;
  preset?: string;
  trackId?: string;
}

/** Map the transcripts of the source files onto the timeline, following every cut and speed change. */
export function timelineWords(p: Project, transcripts: Record<string, Word[]>): Word[] {
  const out: Word[] = [];
  for (const track of p.tracks) {
    if (track.muted || (track.kind !== 'video' && track.kind !== 'audio')) continue;
    for (const c of track.clips) {
      const words = c.assetId && !c.muted ? transcripts[c.assetId] : undefined;
      if (!words) continue;
      const srcEnd = c.in + c.duration * c.speed;
      for (const w of words) {
        const mid = (w.t0 + w.t1) / 2;
        if (mid < c.in || mid >= srcEnd) continue;
        const t0 = c.start + (Math.max(w.t0, c.in) - c.in) / c.speed;
        const t1 = c.start + (Math.min(w.t1, srcEnd) - c.in) / c.speed;
        out.push({ text: w.text.trim(), t0, t1: Math.max(t1, t0 + 0.04) });
      }
    }
  }
  return out.filter((w) => w.text).sort((a, b) => a.t0 - b.t0);
}

/** Rebuild the caption track from transcripts. Returns the caption track. */
export function buildCaptions(p: Project, transcripts: Record<string, Word[]>, o: CaptionOpts = {}): Track {
  const words = timelineWords(p, transcripts);
  const portrait = p.height > p.width;
  const maxWords = o.maxWords ?? (portrait ? 4 : 7);
  const maxChars = o.maxChars ?? (portrait ? 22 : 42);
  const gap = o.gap ?? 0.6;
  let track = o.trackId ? needTrack(p, o.trackId) : p.tracks.find((t) => t.kind === 'caption');
  if (!track) track = addTrack(p, 'caption');
  if (o.preset) setCaptionPreset(p, track.id, o.preset);
  const groups: Word[][] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length) groups.push(cur);
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    const chars = cur.reduce((n, x) => n + x.text.length + 1, 0);
    if (prev && (w.t0 - prev.t1 > gap || cur.length >= maxWords || chars + w.text.length > maxChars)) flush();
    cur.push(w);
    if (/[.?!…]$/.test(w.text) && cur.length >= 2) flush();
  }
  flush();
  track.clips = groups.map((g, i) => {
    const start = g[0].t0;
    const nextStart = groups[i + 1]?.[0].t0 ?? Infinity;
    const end = Math.min(g[g.length - 1].t1 + 0.18, nextStart);
    const clip = blankClip('caption', start, Math.max(0.1, end - start));
    clip.words = g.map((w) => ({ text: w.text, t0: w.t0 - start, t1: w.t1 - start }));
    clip.text = g.map((w) => w.text).join(' ');
    clip.name = clip.text;
    return clip;
  });
  return track;
}

/**
 * Put new text (a translation) on a caption track, one string per caption in order. Times stay; the word
 * timings for the highlight are spread over each caption by word length, since a translation's words do not
 * line up with the spoken ones.
 */
export function setCaptionTexts(p: Project, trackId: string, texts: string[], lang?: string) {
  const track = needTrack(p, trackId);
  if (track.kind !== 'caption') throw Object.assign(new Error('Not a caption track'), { status: 400 });
  if (texts.length !== track.clips.length) throw Object.assign(new Error(`Expected ${track.clips.length} captions, got ${texts.length}`), { status: 400 });
  track.clips.forEach((c, i) => {
    const text = String(texts[i] ?? '').replace(/\s+/g, ' ').trim() || c.text || '';
    const tokens = text.split(' ').filter(Boolean);
    const total = tokens.reduce((n, w) => n + w.length + 1, 0) || 1;
    let at = 0;
    c.words = tokens.map((w) => {
      const t0 = (at / total) * c.duration;
      at += w.length + 1;
      return { text: w, t0, t1: (at / total) * c.duration };
    });
    c.text = text;
    c.name = text;
  });
  if (lang) track.lang = lang;
  return track;
}

/** A copy of a caption track (same captions, style and position), placed right above the original on screen. */
export function copyCaptionTrack(p: Project, trackId: string, name?: string): Track {
  const src = needTrack(p, trackId);
  const t: Track = JSON.parse(JSON.stringify(src));
  t.id = uid('t_');
  t.name = name || `${src.name} 2`;
  for (const c of t.clips) c.id = uid('c_');
  const tr = src.transform || captionTransform();
  // One caption line higher, so the two languages do not cover each other.
  t.transform = { ...tr, y: Math.max(0.05, (tr.y ?? 0.8) - 0.1 * (tr.scale ?? 1)) };
  p.tracks.splice(p.tracks.indexOf(src), 0, t);
  return t;
}

export function setCaptionPreset(p: Project, trackId: string, presetId: string) {
  const track = needTrack(p, trackId);
  const preset = CAPTION_PRESETS.find((x) => x.id === presetId);
  if (!preset) throw new Error(`Unknown caption preset: ${presetId}. Options: ${CAPTION_PRESETS.map((x) => x.id).join(', ')}`);
  track.style = p.brand ? brandCaptionStyle(p.brand, preset.id) : { ...preset.style };
  track.captionPreset = preset.id;
  if (!track.transform) track.transform = captionTransform();
}

const captionTrack = (p: Project, trackId?: string) => {
  const track = trackId ? needTrack(p, trackId) : p.tracks.find((t) => t.kind === 'caption');
  if (!track || track.kind !== 'caption') throw new Error('No caption track yet. Generate captions first.');
  return track;
};

/** Add an empty caption by hand, e.g. for a line the transcription missed. */
export function addCaption(p: Project, start: number, text = '', duration = 2, trackId?: string): Clip {
  let track = trackId ? needTrack(p, trackId) : p.tracks.find((t) => t.kind === 'caption');
  if (!track) track = addTrack(p, 'caption');
  start = snapFrame(p, start);
  const next = track.clips.filter((c) => c.start > start + EPS).reduce((m, c) => Math.min(m, c.start), Infinity);
  const clip = blankClip('caption', freeStart(track, start, 0.2), Math.max(0.2, Math.min(duration, next - start)));
  track.clips.push(clip);
  sortTrack(track);
  updateClip(p, clip.id, { text });
  return clip;
}

/** Join a caption with the one after it. Word timings are kept. */
export function mergeCaptions(p: Project, clipId: string): Clip {
  const { track, clip, index } = need(p, clipId);
  const next = track.clips[index + 1];
  if (track.kind !== 'caption' || !next) throw new Error('There is no caption after this one to merge with');
  const shift = next.start - clip.start;
  const spread = (c: Clip): Word[] => c.words?.length ? c.words : (c.text || '').split(/\s+/).filter(Boolean).map((text, i, a) => ({ text, t0: (c.duration * i) / a.length, t1: (c.duration * (i + 1)) / a.length }));
  clip.words = [...spread(clip), ...spread(next).map((w) => ({ ...w, t0: w.t0 + shift, t1: w.t1 + shift }))];
  clip.text = clip.words.map((w) => w.text).join(' ');
  clip.name = clip.text;
  clip.duration = clipEnd(next) - clip.start;
  track.clips.splice(index + 1, 1);
  return clip;
}

/** Fix a word that was heard wrong everywhere at once. Returns how many captions changed. */
export function replaceInCaptions(p: Project, find: string, replace: string, trackId?: string): number {
  if (!find) return 0;
  let n = 0;
  for (const c of captionTrack(p, trackId).clips) {
    if (!c.text?.includes(find)) continue;
    updateClip(p, c.id, { text: c.text.split(find).join(replace) });
    n++;
  }
  return n;
}

export function listCaptions(p: Project) {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return p.tracks.filter((t) => t.kind === 'caption').flatMap((t) => t.clips.map((c) => ({ id: c.id, start: r(c.start), end: r(clipEnd(c)), text: c.text || '' })));
}

/** The captions as an .srt subtitle file. */
export function toSrt(p: Project): string {
  const tc = (t: number) => {
    const ms = Math.round(t * 1000);
    const pad = (v: number, l = 2) => String(v).padStart(l, '0');
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
  };
  return listCaptions(p)
    .sort((a, b) => a.start - b.start)
    .map((c, i) => `${i + 1}\n${tc(c.start)} --> ${tc(c.end)}\n${c.text}\n`)
    .join('\n');
}

// ---------- silence removal ----------

export interface Peaks {
  /** Samples per second. */
  rate: number;
  /** Peak amplitude 0..1 per sample window. */
  peaks: number[];
}
export interface SilenceOpts {
  thresholdDb?: number;
  minSilence?: number;
  /** Breathing room kept on each side of the speech, seconds. */
  padding?: number;
}

export function findSilences(p: Project, peaks: Record<string, Peaks>, o: SilenceOpts = {}): [number, number][] {
  const threshold = Math.pow(10, (o.thresholdDb ?? -34) / 20);
  const minSilence = o.minSilence ?? 0.6;
  const pad = o.padding ?? 0.12;
  const rate = 50;
  const total = projectDuration(p);
  const n = Math.ceil(total * rate);
  const loud = new Float32Array(n);
  let covered = false;
  for (const track of p.tracks) {
    if (track.muted || (track.kind !== 'video' && track.kind !== 'audio')) continue;
    for (const c of track.clips) {
      const pk = c.assetId ? peaks[c.assetId] : undefined;
      if (!pk || c.muted) continue;
      covered = true;
      const a = Math.floor(c.start * rate);
      const b = Math.min(n, Math.ceil(clipEnd(c) * rate));
      for (let i = a; i < b; i++) {
        const src = c.in + (i / rate - c.start) * c.speed;
        const v = (pk.peaks[Math.floor(src * pk.rate)] || 0) * c.volume;
        if (v > loud[i]) loud[i] = v;
      }
    }
  }
  if (!covered) return [];
  const ranges: [number, number][] = [];
  let runStart = -1;
  for (let i = 0; i <= n; i++) {
    const quiet = i < n && loud[i] < threshold;
    if (quiet && runStart < 0) runStart = i;
    if (!quiet && runStart >= 0) {
      const t0 = runStart / rate + (runStart === 0 ? 0 : pad);
      const t1 = i / rate - (i >= n ? 0 : pad);
      if (t1 - t0 >= minSilence - 2 * pad && i / rate - runStart / rate >= minSilence) ranges.push([t0, t1]);
      runStart = -1;
    }
  }
  return ranges;
}

export function removeSilences(p: Project, peaks: Record<string, Peaks>, o: SilenceOpts = {}) {
  const ranges = findSilences(p, peaks, o);
  for (const [a, b] of [...ranges].reverse()) cutRange(p, a, b);
  return { cuts: ranges.length, removed: ranges.reduce((s, [a, b]) => s + (b - a), 0) };
}

// ---------- a single entry point for the API and MCP ----------

export const OPS = {
  set_project: (p: Project, a: any) => (setProjectSettings(p, a), { width: p.width, height: p.height, fps: p.fps, name: p.name }),
  reshape: (p: Project, a: any) => reshapeProject(p, Number(a.width), Number(a.height), a.mode === 'fit' ? 'fit' : 'fill'),
  add_track: (p: Project, a: any) => addTrack(p, a.kind, a.name),
  remove_track: (p: Project, a: any) => removeTrack(p, a.trackId),
  update_track: (p: Project, a: any) => (a.patch?.index != null ? moveTrack(p, a.trackId, a.patch.index) : null, updateTrack(p, a.trackId, a.patch || {})),
  move_track: (p: Project, a: any) => ({ order: moveTrack(p, a.trackId, a.index) }),
  add_clip: (p: Project, a: any) => addMediaClip(p, a.assetId, a),
  add_text: (p: Project, a: any) => addTextClip(p, a),
  update_clip: (p: Project, a: any) => (updateClip(p, a.clipId, a.patch || {}), need(p, a.clipId).clip),
  set_keyframe: (p: Project, a: any) => ({ keyframe: setKeyframe(p, a.clipId, a.time, a.transform || a, a.ease), keyframes: need(p, a.clipId).clip.keyframes }),
  remove_keyframes: (p: Project, a: any) => ({ removed: removeKeyframes(p, a.clipId, a.time), keyframes: need(p, a.clipId).clip.keyframes || [] }),
  add_zoom: (p: Project, a: any) => ({ added: addZoom(p, a.clipId, a), keyframes: need(p, a.clipId).clip.keyframes }),
  apply_layout: (p: Project, a: any) => (applyLayout(p, a.layout), { layout: p.layout, tracks: p.tracks.filter((t) => t.slot).map((t) => ({ id: t.id, name: t.name, slot: t.slot })) }),
  set_watermark: (p: Project, a: any) => (setWatermark(p, a?.remove ? null : a), { watermark: p.watermark }),
  set_brand_style: (p: Project, a: any) => (a?.remove ? (clearBrandStyle(p), { brand: null }) : applyBrandStyle(p, a.brand || a)),
  add_bumper: (p: Project, a: any) =>
    addBumper(p, a.kind === 'outro' ? 'outro' : 'intro', { logoAssetId: a.logoAssetId, backgroundAssetId: a.backgroundAssetId, duration: a.duration, text: a.text }, { addTrack, moveTrack, addMediaClip, addTextClip }),
  // Without `from` (API and MCP callers) the clip's place before the move is where it is now.
  insert_clip: (p: Project, a: any) => {
    const { track, clip } = need(p, a.clipId);
    return insertClip(p, a.clipId, a.start, { trackId: a.trackId, ripple: a.ripple ?? true, from: a.from ?? { trackId: track.id, start: clip.start } });
  },
  set_speed: (p: Project, a: any) => setClipSpeed(p, a.clipId, a.speed, a.ripple ?? true),
  detach_audio: (p: Project, a: any) => detachAudio(p, a.clipId),
  move_clip_to_new_track: (p: Project, a: any) => moveClipToNewTrack(p, a.clipId, a.where === 'below' ? 'below' : 'above', a.start),
  move_clip: (p: Project, a: any) => (moveClip(p, a.clipId, a.start, a.trackId), need(p, a.clipId).clip),
  trim_clip: (p: Project, a: any) => (trimClip(p, a.clipId, a.edge, a.time), need(p, a.clipId).clip),
  split: (p: Project, a: any) => ({ newClipIds: splitAt(p, a.time, a.clipIds || (a.clipId ? [a.clipId] : undefined)) }),
  delete_clips: (p: Project, a: any) => (deleteClips(p, a.clipIds || [a.clipId], a.ripple ?? true), { ok: true }),
  cut_range: (p: Project, a: any) => ({ removedSeconds: cutRange(p, a.start, a.end, a.trackIds) }),
  duplicate_clip: (p: Project, a: any) => duplicateClip(p, a.clipId),
  move_keyframe: (p: Project, a: any) => ({ moved: moveKeyframe(p, a.clipId, a.from, a.to) }),
  set_blend: (p: Project, a: any) => (setBlend(p, a.clipId, a.blend), { blend: a.blend }),
  add_overlay: (p: Project, a: any) => addOverlayClip(p, a.assetId, { start: a.start, duration: a.duration, blend: a.blend }),
  set_caption_style: (p: Project, a: any) => {
    const track = a.trackId ? needTrack(p, a.trackId) : p.tracks.find((t) => t.kind === 'caption');
    if (!track) throw new Error('No caption track yet. Generate captions first.');
    if (a.preset) setCaptionPreset(p, track.id, a.preset);
    updateTrack(p, track.id, { style: a.style, transform: a.transform } as any);
    return { trackId: track.id, preset: track.captionPreset };
  },
  remove_asset: (p: Project, a: any) => (removeAsset(p, a.assetId), { ok: true }),
  add_caption: (p: Project, a: any) => addCaption(p, a.start, a.text, a.duration, a.trackId),
  merge_captions: (p: Project, a: any) => mergeCaptions(p, a.clipId),
  replace_in_captions: (p: Project, a: any) => ({ changed: replaceInCaptions(p, String(a.find || ''), String(a.replace ?? ''), a.trackId) }),
} as const;
export type OpName = keyof typeof OPS;

/** A compact, readable view of the timeline for an AI agent. */
export function summarize(p: Project) {
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return {
    id: p.id,
    name: p.name,
    width: p.width,
    height: p.height,
    fps: p.fps,
    duration: r(projectDuration(p)),
    assets: p.assets.map((a: Asset) => ({ id: a.id, name: a.name, kind: a.kind, duration: r(a.duration), width: a.width, height: a.height, fps: a.fps, hasAudio: a.hasAudio, path: a.path })),
    tracks: p.tracks.map((t, i) => ({
      id: t.id,
      layer: i === 0 ? 'top' : i,
      kind: t.kind,
      name: t.name,
      muted: t.muted,
      hidden: t.hidden,
      captionPreset: t.captionPreset,
      clips: t.clips.map((c) => ({
        id: c.id,
        type: c.type,
        assetId: c.assetId,
        start: r(c.start),
        end: r(clipEnd(c)),
        sourceIn: c.assetId ? r(c.in) : undefined,
        speed: c.speed !== 1 ? c.speed : undefined,
        muted: c.muted || undefined,
        text: c.text,
        transform: c.type !== 'audio' && c.type !== 'caption' ? c.transform : undefined,
        // seconds from the start of the clip; while these exist they replace `transform`
        keyframes: c.keyframes?.length ? c.keyframes.map((k) => ({ ...k, t: r(k.t), x: r(k.x), y: r(k.y), scale: r(k.scale) })) : undefined,
      })),
    })),
  };
}

export { isHebrew };
