// The smart tools that work on words and faces: filler removal, cutting by transcript, and keeping a face in
// the frame when a wide video is reframed to vertical. Pure functions, shared by the server and the editor.
import { coverScale, mediaRect } from './geometry';
import { cutRange } from './ops';
import type { Asset, Clip, Keyframe, Project, Word } from './types';
import { clamp } from './types';

// ---------- fillers ----------

/** Hesitation sounds, written however long the speaker held them ("ummm", "אממממ"). Always safe to cut. */
const HESITATION = [
  /^(u+m+|u+h+|e+r+m*|a+h+|h+m+|m+h*m+|e+h+|o+h+)$/,
  /^(א+ה+|א+מ+|ה+מ+|מ+ה*מ+|א+ה+מ+|א+י+ה+|ה+ה+)$/,
];
/** Words that are often filler but sometimes meaning: only with `aggressive`. */
const SOFT = new Set(['like', 'basically', 'actually', 'literally', 'kinda', 'כאילו', 'בעצם', 'יעני', 'כזה', 'כזאת', 'סתם', 'נו']);
/** Words people repeat on purpose ("very very", "לא לא"): never a stutter. */
const EMPHASIS = new Set(['very', 'really', 'so', 'no', 'yes', 'ok', 'okay', 'bye', 'ha', 'go', 'more', 'לא', 'כן', 'מאוד', 'ממש', 'יותר', 'הכי', 'ביי', 'חה', 'די', 'רגע', 'עוד', 'נו']);
const SOFT_PAIRS = [['you', 'know'], ['i', 'mean'], ['sort', 'of'], ['kind', 'of'], ['אתה', 'יודע'], ['את', 'יודעת'], ['איך', 'אומרים']];

export const normWord = (s: string) =>
  s
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '') // niqqud
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

export interface Filler {
  /** Index into the words list. */
  i: number;
  /** How many words it covers (2 for "you know"). */
  n: number;
  t0: number;
  t1: number;
  text: string;
  kind: 'hesitation' | 'repeat' | 'soft';
}

/** Find fillers in timeline words: hesitations, a word said twice in a row ("I I", "אני אני"), and with `aggressive` the soft fillers. */
export function findFillers(words: Word[], o: { aggressive?: boolean } = {}): Filler[] {
  const out: Filler[] = [];
  const n = words.map((w) => normWord(w.text));
  for (let i = 0; i < words.length; i++) {
    const w = n[i];
    if (!w) continue;
    const add = (len: number, kind: Filler['kind']) => {
      out.push({ i, n: len, t0: words[i].t0, t1: words[i + len - 1].t1, text: words.slice(i, i + len).map((x) => x.text).join(' '), kind });
      i += len - 1;
    };
    if (HESITATION.some((rx) => rx.test(w))) add(1, 'hesitation');
    // A stutter: the same word again right away (within half a second), not a deliberate "very very",
    // and not the end of one sentence and the start of the next ("...Logan. Logan is...").
    else if (n[i + 1] === w && words[i + 1].t0 - words[i].t1 < 0.5 && !/[.?!…:]$/.test(words[i].text) && !EMPHASIS.has(w) && !/^\d+$/.test(w)) add(1, 'repeat');
    else if (o.aggressive && SOFT_PAIRS.some(([a, b]) => w === a && n[i + 1] === b)) add(2, 'soft');
    else if (o.aggressive && SOFT.has(w)) add(1, 'soft');
  }
  return out;
}

/**
 * Timeline ranges to cut for some words. Each range takes the words and the pause after them, up to the next word,
 * without touching the words around them, so "um... the" becomes "the" with no gap. Overlapping ranges merge.
 */
export function wordCutRanges(words: Word[], picks: { i: number; n?: number }[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (const { i, n = 1 } of picks) {
    const first = words[i];
    const last = words[i + n - 1];
    if (!first || !last) continue;
    const prev = words[i - 1];
    const next = words[i + n];
    // Breathing room only where there is a pause; words that touch are cut exactly at the boundary.
    const a = !prev ? Math.max(0, first.t0 - 0.04) : first.t0 - prev.t1 > 0.1 ? Math.max(first.t0 - 0.04, prev.t1 + 0.03) : Math.min(first.t0, prev.t1);
    const b = !next ? last.t1 + 0.05 : next.t0 - last.t1 > 0.1 ? Math.max(last.t1, Math.min(next.t0 - 0.05, last.t1 + 0.6)) : Math.max(last.t1, next.t0);
    if (b - a > 0.03) ranges.push([a, b]);
  }
  ranges.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const m = merged[merged.length - 1];
    if (m && r[0] <= m[1] + 0.02) m[1] = Math.max(m[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

/**
 * Cut several timeline ranges from every track, last first so the earlier times stay valid. A cut edge that falls
 * within a few frames of a clip edge (often an earlier cut) is moved onto it, and cuts that almost touch are joined,
 * so no sliver of a frame or two is left behind.
 */
export function cutRanges(p: Project, ranges: [number, number][]) {
  const near = 2.5 / (p.fps || 30);
  const edges: number[] = [];
  for (const t of p.tracks) if (t.kind === 'video' || t.kind === 'audio') for (const c of t.clips) edges.push(c.start, c.start + c.duration);
  /** The nearest clip edge within a few frames of x that keeps the cut at least a frame long, else x. */
  const snap = (x: number, ok: (e: number) => boolean) => {
    let best = x;
    let dist = near;
    for (const e of edges) if (Math.abs(e - x) < dist && ok(e)) (best = e), (dist = Math.abs(e - x));
    return best;
  };
  const frame = 1 / (p.fps || 30);
  const snapped = ranges.map(([x, y]) => {
    const a = snap(Math.min(x, y), (e) => e < Math.max(x, y) - frame);
    return [a, snap(Math.max(x, y), (e) => e > a + frame)] as [number, number];
  });
  const merged: [number, number][] = [];
  for (const [a0, b0] of snapped.sort((x, y) => x[0] - y[0])) {
    const m = merged[merged.length - 1];
    if (m && a0 - m[1] < near) m[1] = Math.max(m[1], b0);
    else merged.push([a0, b0]);
  }
  const sorted = merged.filter(([a, b]) => b - a > 0.01).sort((x, y) => y[0] - x[0]);
  let removed = 0;
  for (const [a, b] of sorted) removed += cutRange(p, a, b);
  return { cuts: sorted.length, removed };
}

// ---------- reframe: keep a face in the frame ----------

/** A detected face: `t` seconds into the source, `u` its centre as a fraction of the source width. */
export interface FaceSample {
  t: number;
  u: number | null;
}

/**
 * Keyframes that make a wide clip fill a narrower frame and follow the face like a calm camera operator:
 * it holds still while the face stays near the centre, and glides when the face moves away.
 */
export function followKeyframes(p: Project, asset: Pick<Asset, 'width' | 'height'>, clip: Clip, samples: FaceSample[]): Keyframe[] {
  const scale = coverScale(p, asset);
  const rect = mediaRect(p, asset, clip, { ...clip.transform, scale });
  const over = rect.w / p.width; // how much wider than the frame the picture is
  const maxShift = Math.max(0, (over - 1) / 2);
  const opacity = clip.transform.opacity ?? 1;
  const xFor = (u: number) => clamp(0.5 - (u - 0.5) * over, 0.5 - maxShift, 0.5 + maxShift);
  const srcEnd = clip.in + clip.duration * clip.speed;
  const local = (t: number) => (t - clip.in) / clip.speed;
  // Fill the gaps with the last face seen, then smooth with a median of 5 so one false detection does not move the camera.
  let lastU = 0.5;
  const filled = samples
    .filter((s) => s.t >= clip.in - 0.01 && s.t <= srcEnd + 0.01)
    .map((s) => ({ t: s.t, u: s.u == null ? lastU : (lastU = s.u) }));
  const firstFace = samples.find((s) => s.u != null && s.t >= clip.in);
  if (firstFace) for (const s of filled) if (s.t < firstFace.t) s.u = firstFace.u!;
  const med = filled.map((s, k) => {
    const win = filled.slice(Math.max(0, k - 2), k + 3).map((x) => x.u).sort((a, b) => a - b);
    return { t: s.t, u: win[Math.floor(win.length / 2)] };
  });
  const kf = (t: number, x: number, ease: Keyframe['ease']): Keyframe => ({ t: Math.max(0, Math.round(t * 1000) / 1000), x, y: 0.5, scale, rotation: 0, opacity, ease });
  if (!med.length) return [kf(0, 0.5, 'linear')];
  const DEAD = 0.07; // the face may wander this far (fraction of the source width) before the camera moves
  const GLIDE = 0.7;
  let cur = med[0].u;
  const out: Keyframe[] = [kf(0, xFor(cur), 'linear')];
  let busyUntil = 0;
  for (const s of med) {
    const t = local(s.t);
    if (t < busyUntil || Math.abs(s.u - cur) < DEAD) continue;
    const end = Math.min(t + GLIDE, clip.duration);
    if (end - t < 0.2) break;
    if (t - out[out.length - 1].t > 0.05) out.push(kf(t, xFor(cur), 'linear'));
    cur = s.u;
    out.push(kf(end, xFor(cur), 'ease-in-out'));
    busyUntil = end + 0.8;
  }
  // Drop keyframes that do not move anything (a still face needs just one).
  return out.filter((k, i) => i === 0 || Math.abs(k.x - out[i - 1].x) > 1e-4 || k.ease === 'linear');
}
