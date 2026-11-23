// Where a media clip sits in the frame and how its transitions move it.
// The preview uses the numbers; server/export.ts builds the same formulas as ffmpeg expressions.
import type { Asset, Clip, Ease, Keyframe, Project, Slot, Transform, Watermark } from './types';
import { clamp } from './types';

export const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);

export const EASES: Ease[] = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold'];
/** Eased progress 0..1. server/export.ts writes the same curves as ffmpeg expressions. */
export function easeFn(ease: Ease, u: number) {
  u = clamp(u, 0, 1);
  if (ease === 'ease-in') return u * u * u;
  if (ease === 'ease-out') return 1 - Math.pow(1 - u, 3);
  if (ease === 'ease-in-out') return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  if (ease === 'hold') return u >= 1 ? 1 : 0;
  return u;
}
const TF_KEYS = ['x', 'y', 'scale', 'rotation', 'opacity'] as const;
export const pickTransform = (t: Transform): Transform => ({ x: t.x, y: t.y, scale: t.scale, rotation: t.rotation, opacity: t.opacity });
export const hasKeyframes = (clip: Clip): clip is Clip & { keyframes: Keyframe[] } => !!clip.keyframes?.length;
/** The clip's transform at `localT` seconds after its start: its keyframes when it has any, else its fixed transform. */
export function transformAt(clip: Clip, localT: number): Transform {
  const k = clip.keyframes;
  if (!k?.length) return clip.transform;
  if (localT <= k[0].t) return pickTransform(k[0]);
  const last = k[k.length - 1];
  if (localT >= last.t) return pickTransform(last);
  let i = 1;
  while (k[i].t < localT) i++;
  const a = k[i - 1];
  const b = k[i];
  const e = easeFn(b.ease, (localT - a.t) / (b.t - a.t));
  const out = {} as Transform;
  for (const key of TF_KEYS) out[key] = a[key] + (b[key] - a[key]) * e;
  return out;
}

/** Size of the clip at scale 1 ("fit inside the frame") times its scale, and its centre, in frame pixels. */
export function mediaRect(p: Project, asset: Pick<Asset, 'width' | 'height'> | undefined, clip: Clip, tf: Transform = clip.transform) {
  const aw = asset?.width || p.width;
  const ah = asset?.height || p.height;
  const fit = Math.min(p.width / aw, p.height / ah);
  const w = aw * fit * tf.scale;
  const h = ah * fit * tf.scale;
  return { w, h, cx: tf.x * p.width, cy: tf.y * p.height };
}

/** The transform that fits a clip of this asset inside a slot of the frame (centred, whole picture visible). */
export function slotTransform(p: Pick<Project, 'width' | 'height'>, asset: Pick<Asset, 'width' | 'height'> | undefined, slot: Slot) {
  const aw = asset?.width || p.width;
  const ah = asset?.height || p.height;
  const frameFit = Math.min(p.width / aw, p.height / ah);
  const boxFit = Math.min((slot.w * p.width) / aw, (slot.h * p.height) / ah);
  return { x: slot.x + slot.w / 2, y: slot.y + slot.h / 2, scale: boxFit / frameFit };
}

/** Scale at which the clip covers the whole frame. */
export function coverScale(p: Project, asset: Pick<Asset, 'width' | 'height'> | undefined) {
  const aw = asset?.width || p.width;
  const ah = asset?.height || p.height;
  return Math.max(p.width / aw, p.height / ah) / Math.min(p.width / aw, p.height / ah);
}

/** Where the watermark sits in a frame of W x H, in pixels (left, top, width, height). */
export function watermarkRect(W: number, H: number, asset: Pick<Asset, 'width' | 'height'> | undefined, wm: Watermark) {
  const short = Math.min(W, H);
  const w = Math.max(2, Math.round((wm.size * short) / 2) * 2);
  const h = Math.max(2, Math.round((w * (asset?.height || 1)) / (asset?.width || 1) / 2) * 2);
  const m = Math.round(wm.margin * short);
  const x = wm.corner === 'tl' || wm.corner === 'bl' ? m : W - w - m;
  const y = wm.corner === 'tl' || wm.corner === 'tr' ? m : H - h - m;
  return { x, y, w, h };
}

export const SPIN_DEG = 120;
export const BLUR_PX = 30;
/** Scale of a clip at eased progress `e` for the transitions that zoom. */
export const zoomAt = (type: string, e: number) => (type === 'zoom' || type === 'spin' ? 0.6 + 0.4 * e : type === 'zoom-out' ? 1.5 - 0.5 * e : 1);
export const ZOOMING = ['zoom', 'zoom-out', 'spin'];

export function transitionState(clip: Clip, localT: number, W: number, H: number) {
  // inset: top, right, bottom, left as fractions of the clip (wipes).
  const s = { alpha: 1, dx: 0, dy: 0, zoom: 1, rot: 0, blur: 0, white: 0, black: 0, inset: [0, 0, 0, 0] };
  const apply = (type: string, p: number, dir: 1 | -1) => {
    const e = easeOut(p);
    if (type === 'fade') s.alpha *= p;
    if (type === 'dip') s.black = Math.max(s.black, 1 - p);
    if (type === 'flash') s.white = Math.max(s.white, 1 - p);
    if (type === 'blur') s.blur = Math.max(s.blur, BLUR_PX * (1 - p));
    if (type === 'slide-left') s.dx += dir * (1 - e) * W;
    if (type === 'slide-right') s.dx -= dir * (1 - e) * W;
    if (type === 'slide-up') s.dy += dir * (1 - e) * H;
    if (type === 'slide-down') s.dy -= dir * (1 - e) * H;
    if (type === 'wipe-up') s.inset[0] = Math.max(s.inset[0], 1 - p);
    if (type === 'wipe-right') s.inset[1] = Math.max(s.inset[1], 1 - p);
    if (type === 'wipe-down') s.inset[2] = Math.max(s.inset[2], 1 - p);
    if (type === 'wipe-left') s.inset[3] = Math.max(s.inset[3], 1 - p);
    if (ZOOMING.includes(type)) {
      s.zoom *= zoomAt(type, e);
      s.alpha *= Math.min(1, p * 2);
    }
    if (type === 'spin') s.rot -= dir * SPIN_DEG * (1 - e);
  };
  if (clip.tin.type !== 'none' && clip.tin.duration > 0) apply(clip.tin.type, clamp(localT / clip.tin.duration, 0, 1), 1);
  if (clip.tout.type !== 'none' && clip.tout.duration > 0) apply(clip.tout.type, clamp((clip.duration - localT) / clip.tout.duration, 0, 1), -1);
  return s;
}

export const fxActive = (c: Clip) => c.fx.brightness !== 1 || c.fx.contrast !== 1 || c.fx.saturation !== 1 || c.fx.blur > 0;
type TState = ReturnType<typeof transitionState>;
/** CSS filter for the clip's look plus the transition's blur / flash / dip. `k` scales px to the frame. */
export function cssFilter(c: Clip, k: number, ts?: TState) {
  const f: string[] = [];
  if (fxActive(c)) f.push(`brightness(${c.fx.brightness}) contrast(${c.fx.contrast}) saturate(${c.fx.saturation})`);
  const blur = c.fx.blur + (ts?.blur || 0);
  if (blur > 0) f.push(`blur(${blur * k}px)`);
  // invert, darken, invert = mix towards white, the same result as ffmpeg's fade from white.
  if (ts && ts.white > 0) f.push(`invert(1) brightness(${1 - ts.white}) invert(1)`);
  if (ts && ts.black > 0) f.push(`brightness(${1 - ts.black})`);
  return f.length ? f.join(' ') : 'none';
}
