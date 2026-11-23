// Text and caption rendering on a 2D canvas. The live preview and the exporter (headless Chrome)
// both call this file, so what you see in the editor is what lands in the exported video.
import { transformAt } from './geometry';
import { baseStyle } from './presets';
import type { Clip, Project, TextStyle, Track, Transform, Word } from './types';
import { clamp, clipEnd, projectDuration } from './types';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
const HEB = /[֐-׿]/;
const LTR_WORD = /^[^֐-׿]*[A-Za-z0-9][^֐-׿]*$/;

export interface Box {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
}

export interface TextItem {
  clip: Clip;
  track: Track;
  style: TextStyle;
  transform: Transform;
}

export function resolveItem(track: Track, clip: Clip): TextItem {
  const isCaption = track.kind === 'caption';
  return {
    clip,
    track,
    style: { ...baseStyle, ...((isCaption ? track.style : clip.style) || {}) },
    transform: (isCaption ? track.transform : clip.transform) || clip.transform,
  };
}

const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
const easeBack = (p: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
};

function typewriterDuration(style: TextStyle, chars: number, duration: number) {
  return Math.min(duration * 0.7, Math.max(style.animDuration, chars * 0.045));
}

/** True while an entrance or exit animation is running, i.e. the item changes every frame. */
export function isAnimating(item: TextItem, localT: number): boolean {
  const { style, clip } = item;
  const kf = item.track.kind !== 'caption' ? clip.keyframes : undefined;
  if (kf && kf.length > 1 && localT >= kf[0].t && localT <= kf[kf.length - 1].t) return true;
  const chars = (clip.text || '').length;
  const inDur = style.animIn === 'typewriter' ? typewriterDuration(style, chars, clip.duration) : style.animDuration;
  if (style.animIn !== 'none' && localT < inDur) return true;
  if (style.animOut !== 'none' && localT > clip.duration - style.animDuration) return true;
  return false;
}

/** Index of the word being spoken at `localT`, or -1 before the first word. */
export function activeWord(words: Word[] | undefined, localT: number): number {
  if (!words?.length) return -1;
  let idx = -1;
  for (let i = 0; i < words.length; i++) if (words[i].t0 <= localT + 1e-4) idx = i;
  return idx;
}

interface Placed {
  text: string;
  x: number;
  w: number;
  index: number;
  line: number;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draw one text item at clip-local time `localT`. Returns its box in frame pixels. */
export function drawTextItem(ctx: Ctx, item: TextItem, W: number, H: number, localT: number): Box {
  const { style, clip } = item;
  // a title can be animated with keyframes; captions share one fixed position per track
  const transform = item.track.kind !== 'caption' && clip.keyframes?.length ? transformAt(clip, localT) : item.transform;
  const k = (Math.min(W, H) / 1080) * transform.scale;
  const fontPx = Math.max(4, style.fontSize * k);
  const raw = clip.text || '';
  const rtl = HEB.test(raw);
  const up = (s: string) => (style.uppercase ? s.toUpperCase() : s);
  const paragraphs: string[][] = clip.words?.length ? [clip.words.map((w) => up(w.text))] : raw.split('\n').map((l) => up(l).split(/\s+/).filter(Boolean));

  ctx.save();
  ctx.font = `${style.fontWeight} ${fontPx}px "${style.fontFamily}", "Assistant", sans-serif`;
  ctx.textBaseline = 'middle';
  (ctx as any).direction = rtl ? 'rtl' : 'ltr';
  (ctx as any).fontKerning = 'normal';
  const space = ctx.measureText(' ').width;
  const maxW = style.maxWidth * W * Math.max(1, transform.scale);
  const lineH = fontPx * style.lineHeight;

  // Greedy line breaking, then visual ordering (right to left for Hebrew, Latin runs kept left to right).
  const lines: { words: { text: string; w: number; index: number }[]; width: number }[] = [];
  let index = 0;
  for (const para of paragraphs) {
    let cur: { text: string; w: number; index: number }[] = [];
    let width = 0;
    for (const text of para) {
      const w = ctx.measureText(text).width;
      if (cur.length && width + space + w > maxW) {
        lines.push({ words: cur, width });
        cur = [];
        width = 0;
      }
      width += (cur.length ? space : 0) + w;
      cur.push({ text, w, index: index++ });
    }
    lines.push({ words: cur, width });
  }
  const blockW = Math.max(1, ...lines.map((l) => l.width));
  const blockH = lines.length * lineH;
  const placed: Placed[] = [];
  lines.forEach((line, li) => {
    let visual = line.words;
    if (rtl) {
      visual = [];
      let run: typeof line.words = [];
      for (const w of line.words) {
        if (LTR_WORD.test(w.text)) run.push(w);
        else {
          if (run.length) visual.unshift(...run);
          run = [];
          visual.unshift(w);
        }
      }
      if (run.length) visual.unshift(...run);
    }
    const align = style.align;
    let x = align === 'center' ? -line.width / 2 : align === 'left' ? -blockW / 2 : blockW / 2 - line.width;
    for (const w of visual) {
      placed.push({ text: w.text, x, w: w.w, index: w.index, line: li });
      x += w.w + space;
    }
  });

  // Entrance / exit animation.
  const chars = placed.reduce((n, w) => n + w.text.length, 0);
  let alpha = transform.opacity;
  let scale = 1;
  let dy = 0;
  let visibleChars = Infinity;
  const dur = Math.max(0.01, style.animDuration);
  if (style.animIn !== 'none') {
    const p = clamp(localT / dur, 0, 1);
    if (style.animIn === 'fade') alpha *= p;
    if (style.animIn === 'pop') {
      scale *= Math.max(0.01, easeBack(p));
      alpha *= clamp(p * 3, 0, 1);
    }
    if (style.animIn === 'slide-up') {
      dy += (1 - easeOut(p)) * fontPx * 1.1;
      alpha *= clamp(p * 2, 0, 1);
    }
    if (style.animIn === 'typewriter') visibleChars = Math.floor((localT / typewriterDuration(style, chars, clip.duration)) * chars + 1e-6);
  }
  if (style.animOut !== 'none') {
    const p = clamp((clip.duration - localT) / dur, 0, 1);
    alpha *= p;
    if (style.animOut === 'pop') scale *= 0.6 + 0.4 * p;
    if (style.animOut === 'slide-up') dy -= (1 - easeOut(p)) * fontPx * 0.8;
  }

  const cx = transform.x * W;
  const cy = transform.y * H;
  const padX = style.bgColor ? style.bgPadX * k : 0;
  const padY = style.bgColor ? style.bgPadY * k : 0;
  ctx.translate(cx, cy + dy);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.scale(scale, scale);
  ctx.globalAlpha = clamp(alpha, 0, 1);

  const shadow = (on: boolean) => {
    ctx.shadowColor = on ? style.shadowColor : 'transparent';
    ctx.shadowBlur = on ? style.shadowBlur * k : 0;
    ctx.shadowOffsetY = on ? style.shadowY * k : 0;
  };
  const hasShadow = style.shadowBlur > 0 || style.shadowY !== 0;
  if (style.bgColor) {
    shadow(hasShadow);
    ctx.fillStyle = style.bgColor;
    roundRect(ctx, -blockW / 2 - padX, -blockH / 2 - padY, blockW + 2 * padX, blockH + 2 * padY, style.bgRadius * k);
    ctx.fill();
    shadow(false);
  }

  const active = activeWord(clip.words, localT);
  let fill: string | CanvasGradient = style.color;
  if (style.gradient?.length) {
    const g = ctx.createLinearGradient(-blockW / 2, 0, blockW / 2, 0);
    style.gradient.forEach((c, i) => g.addColorStop(i / Math.max(1, style.gradient!.length - 1), c));
    fill = g;
  }
  ctx.lineJoin = 'round';
  ctx.lineWidth = style.strokeWidth * k;
  ctx.strokeStyle = style.strokeColor;
  ctx.textAlign = rtl ? 'right' : 'left';

  // Characters are revealed in reading order for the typewriter.
  const order = [...placed].sort((a, b) => a.index - b.index);
  let budget = visibleChars;
  const shown = new Map<number, string>();
  for (const w of order) {
    shown.set(w.index, budget >= w.text.length ? w.text : w.text.slice(0, Math.max(0, budget)));
    budget -= w.text.length;
  }

  for (const pass of ['box', 'stroke', 'fill'] as const) {
    for (const w of placed) {
      if (style.highlight === 'reveal' && clip.words?.length && w.index > active) continue;
      const text = shown.get(w.index)!;
      if (!text) continue;
      const y = -blockH / 2 + w.line * lineH + lineH / 2;
      const x = rtl ? w.x + w.w : w.x;
      const isActive = w.index === active && style.highlight !== 'none' && style.highlight !== 'reveal';
      if (pass === 'box') {
        if (isActive && style.highlight === 'box') {
          ctx.fillStyle = style.highlightColor;
          const px = fontPx * 0.16;
          roundRect(ctx, w.x - px, y - lineH / 2 + fontPx * 0.04, w.w + 2 * px, lineH - fontPx * 0.08, fontPx * 0.2);
          ctx.fill();
        }
      } else if (pass === 'stroke') {
        if (style.strokeWidth > 0) {
          shadow(hasShadow && !style.bgColor);
          ctx.strokeText(text, x, y);
          shadow(false);
        }
      } else {
        shadow(hasShadow && !style.bgColor && style.strokeWidth <= 0 && !(isActive && style.highlight === 'box'));
        ctx.fillStyle = isActive ? style.highlightTextColor : fill;
        ctx.fillText(text, x, y);
        shadow(false);
      }
    }
  }
  ctx.restore();
  return { cx, cy, w: blockW + 2 * padX, h: blockH + 2 * padY, rotation: transform.rotation };
}

/** Text and caption clips visible at time `t`, bottom layer first. */
export function itemsAt(p: Project, t: number): TextItem[] {
  const out: TextItem[] = [];
  for (let i = p.tracks.length - 1; i >= 0; i--) {
    const track = p.tracks[i];
    if (track.hidden || (track.kind !== 'text' && track.kind !== 'caption')) continue;
    for (const clip of track.clips) if (t >= clip.start && t < clipEnd(clip)) out.push(resolveItem(track, clip));
  }
  return out;
}

/**
 * The text tracks grouped by where they sit among the video layers. `below` is the index of the video track the band
 * goes under (-1: above every video layer, the usual case). A title placed under a video layer, such as text behind
 * a person whose background was removed, makes its own band. The preview and the export both draw text this way.
 */
export function textBands(p: Project): { below: number; ids: Set<string> }[] {
  const bands: { below: number; ids: Set<string> }[] = [];
  let ids = new Set<string>();
  for (let ti = p.tracks.length - 1; ti >= 0; ti--) {
    const t = p.tracks[ti];
    if ((t.kind === 'text' || t.kind === 'caption') && !t.hidden && t.clips.length) ids.add(t.id);
    else if (t.kind === 'video' && !t.hidden && t.clips.length && ids.size) (bands.push({ below: ti, ids }), (ids = new Set()));
  }
  if (ids.size) bands.push({ below: -1, ids });
  return bands;
}

/** Draw the text layer (or one band of it: `only` the given tracks) for time `t` onto a cleared canvas. Returns the box of each clip. */
export function drawOverlay(ctx: Ctx, p: Project, t: number, only?: Set<string>): Map<string, Box> {
  const boxes = new Map<string, Box>();
  ctx.clearRect(0, 0, p.width, p.height);
  for (const item of itemsAt(p, t)) if (!only || only.has(item.track.id)) boxes.set(item.clip.id, drawTextItem(ctx, item, p.width, p.height, t - item.clip.start));
  return boxes;
}

export interface OverlaySegment {
  /** First frame and number of frames this picture stays on screen. */
  frame: number;
  frames: number;
  /** Time to render the picture at. */
  t: number;
  empty: boolean;
}

/** Split the text layer into runs of frames that look identical, so the exporter renders each picture once. */
export function overlaySegments(p: Project, totalFrames?: number): OverlaySegment[] {
  const fps = p.fps;
  const F = totalFrames ?? Math.ceil(projectDuration(p) * fps - 1e-6);
  const keys: string[] = new Array(F).fill('');
  for (const track of p.tracks) {
    if (track.hidden || (track.kind !== 'text' && track.kind !== 'caption')) continue;
    for (const clip of track.clips) {
      const item = resolveItem(track, clip);
      const a = Math.max(0, Math.ceil(clip.start * fps - 0.5 - 1e-6));
      const b = Math.min(F, Math.ceil(clipEnd(clip) * fps - 0.5 - 1e-6));
      const timed = item.style.highlight !== 'none' && clip.words?.length;
      for (let f = a; f < b; f++) {
        const local = (f + 0.5) / fps - clip.start;
        keys[f] += `|${clip.id}:${timed ? activeWord(clip.words, local) : ''}${isAnimating(item, local) ? ':f' + f : ''}`;
      }
    }
  }
  const segs: OverlaySegment[] = [];
  for (let f = 0; f < F; f++) {
    const last = segs[segs.length - 1];
    if (last && keys[f] === keys[f - 1]) last.frames++;
    else segs.push({ frame: f, frames: 1, t: (f + 0.5) / fps, empty: keys[f] === '' });
  }
  return segs;
}
