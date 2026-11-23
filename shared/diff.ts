// What changed between two versions of a project, item by item, and how to keep or take back each item.
// The editor uses it to review an AI agent's edits: every clip, track and setting it touched is a change the
// user can accept or reject on its own.
import type { Clip, Project, Track } from './types';

export type ChangeKind = 'add' | 'remove' | 'change';
export interface Change {
  /** Stable while the change exists, so the UI can keep its row. */
  key: string;
  kind: ChangeKind;
  /** clip: one clip · clips: several clips changed the same way · track · order: the layer order · project: settings. */
  scope: 'clip' | 'clips' | 'track' | 'order' | 'project';
  clipIds: string[];
  trackIds: string[];
  /** Fields that differ (clip, track or project fields; 'track' when a clip moved to another track). */
  fields: string[];
  /** The clip's text or name, or the track's name. */
  label: string;
  clipType?: string;
  trackKind?: string;
  /** Where it is on the timeline, in seconds. */
  time?: number;
  count?: number;
  /** Seconds a clip (or every clip of a group) moved, when moving is all that changed. */
  delta?: number;
  /** Seconds taken out, when the change is a cut. */
  cut?: number;
}

const TRACK_FIELDS = ['name', 'muted', 'hidden', 'style', 'transform', 'captionPreset'] as const;
const PROJECT_FIELDS = ['name', 'width', 'height', 'fps', 'markIn', 'markOut'] as const;
const GROUP_MIN = 3;
/** What cutting a clip changes on it by itself. */
const TRIM_FIELDS = new Set(['duration', 'in', 'start', 'tin', 'tout', 'keyframes', 'words', 'text', 'name']);

/** JSON with sorted keys, so two equal objects built in a different key order compare equal. */
function stable(v: unknown): string {
  if (v === undefined) return 'u';
  if (v === null || typeof v !== 'object') return JSON.stringify(typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${k}:${stable(o[k])}`)
    .join(',')}}`;
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

interface ClipAt {
  clip: Clip;
  track: Track;
}
function indexOf(p: Project) {
  const clips = new Map<string, ClipAt>();
  for (const track of p.tracks) for (const clip of track.clips) clips.set(clip.id, { clip, track });
  const tracks = new Map(p.tracks.map((t) => [t.id, t]));
  return { clips, tracks };
}
const clipLabel = (c: Clip) => (c.text || c.name || c.type).replace(/\s+/g, ' ').trim().slice(0, 48);

function clipFields(a: Clip, b: Clip) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => stable((a as any)[k]) !== stable((b as any)[k])).sort();
}

/** Every difference from `before` to `after`, in timeline order. */
export function diffProjects(before: Project, after: Project): Change[] {
  const A = indexOf(before);
  const B = indexOf(after);
  const out: Change[] = [];
  const addedTracks = new Set<string>();
  const removedTracks = new Set<string>();

  // Whole tracks added or removed carry their clips with them.
  for (const t of after.tracks)
    if (!A.tracks.has(t.id)) {
      addedTracks.add(t.id);
      // A new track holding one clip (a title on a new text layer) reads as that clip.
      const one = t.clips.length === 1 ? t.clips[0] : null;
      out.push({ key: `track:${t.id}`, kind: 'add', scope: 'track', clipIds: t.clips.map((c) => c.id), trackIds: [t.id], fields: [], label: one ? clipLabel(one) : t.name, clipType: one?.type, trackKind: t.kind, time: t.clips[0]?.start, count: t.clips.length });
    }
  for (const t of before.tracks)
    if (!B.tracks.has(t.id)) {
      removedTracks.add(t.id);
      out.push({ key: `track:${t.id}`, kind: 'remove', scope: 'track', clipIds: t.clips.map((c) => c.id), trackIds: [t.id], fields: [], label: t.name, trackKind: t.kind, time: t.clips[0]?.start, count: t.clips.length });
    }
  for (const b of after.tracks) {
    const a = A.tracks.get(b.id);
    if (!a) continue;
    const fields = TRACK_FIELDS.filter((k) => stable(a[k]) !== stable(b[k]));
    if (fields.length) out.push({ key: `track:${b.id}`, kind: 'change', scope: 'track', clipIds: [], trackIds: [b.id], fields: [...fields], label: b.name, trackKind: b.kind });
  }
  const orderA = before.tracks.map((t) => t.id).filter((id) => B.tracks.has(id));
  const orderB = after.tracks.map((t) => t.id).filter((id) => A.tracks.has(id));
  if (orderA.join() !== orderB.join()) out.push({ key: 'order', kind: 'change', scope: 'order', clipIds: [], trackIds: orderB, fields: ['order'], label: '' });

  const pf = PROJECT_FIELDS.filter((k) => stable(before[k] ?? null) !== stable(after[k] ?? null));
  if (pf.length) out.push({ key: 'project', kind: 'change', scope: 'project', clipIds: [], trackIds: [], fields: [...pf], label: after.name });

  // Clips.
  const changed: Change[] = [];
  for (const [id, b] of B.clips) {
    if (addedTracks.has(b.track.id)) continue;
    const a = A.clips.get(id);
    const base = { key: `clip:${id}`, scope: 'clip' as const, clipIds: [id], trackIds: [b.track.id], label: clipLabel(b.clip), clipType: b.clip.type, trackKind: b.track.kind, time: b.clip.start };
    if (!a) {
      out.push({ ...base, kind: 'add', fields: [] });
      continue;
    }
    const fields = clipFields(a.clip, b.clip);
    if (a.track.id !== b.track.id) fields.push('track');
    if (!fields.length) continue;
    const onlyMoved = fields.length === 1 && fields[0] === 'start';
    changed.push({ ...base, kind: 'change', fields, delta: onlyMoved ? b.clip.start - a.clip.start : undefined });
  }
  for (const [id, a] of A.clips)
    if (!B.clips.has(id) && !removedTracks.has(a.track.id))
      out.push({ key: `clip:${id}`, kind: 'remove', scope: 'clip', clipIds: [id], trackIds: [a.track.id], fields: [], label: clipLabel(a.clip), clipType: a.clip.type, trackKind: a.track.kind, time: a.clip.start });

  // A cut through a clip reads as one change: the clip got shorter and a new piece of the same source appeared
  // after it. The clips the cut pulled earlier (on every track) belong to it too, so taking it back restores all.
  const cuts: Change[] = [];
  for (const add of out.filter((c) => c.scope === 'clip' && c.kind === 'add')) {
    const piece = B.clips.get(add.clipIds[0])!;
    if (!piece.clip.assetId) continue;
    const host = changed.find((c) => {
      const a = A.clips.get(c.clipIds[0])?.clip;
      const b = B.clips.get(c.clipIds[0]);
      return !!a && !!b && c.fields.includes('duration') && b.clip.assetId === piece.clip.assetId && b.track.id === piece.track.id && piece.clip.in > a.in + 1e-6 && piece.clip.in < a.in + a.duration * a.speed - 1e-6;
    });
    if (!host) continue;
    const a = A.clips.get(host.clipIds[0])!.clip;
    const b = B.clips.get(host.clipIds[0])!.clip;
    out.splice(out.indexOf(add), 1);
    changed.splice(changed.indexOf(host), 1);
    addCut(host, [add.clipIds[0]], Math.max(0, a.duration - b.duration - piece.clip.duration), b.start + b.duration);
  }
  // A cut at a clip's edge only shortens it (from the start, its in-point moves too).
  for (const c of [...changed]) {
    const a = A.clips.get(c.clipIds[0])!.clip;
    const b = B.clips.get(c.clipIds[0])!.clip;
    if (b.duration > a.duration - 1e-3 || !c.fields.every((f) => TRIM_FIELDS.has(f))) continue;
    changed.splice(changed.indexOf(c), 1);
    const fromStart = b.in > a.in + 1e-6 || (c.fields.includes('words') && b.start <= a.start + 1e-6 && !c.fields.includes('in'));
    addCut(c, [], a.duration - b.duration, fromStart ? b.start : b.start + b.duration);
  }
  function addCut(host: Change, more: string[], len: number, at: number) {
    const same = cuts.find((c) => Math.abs(c.time! - at) < 1e-3 && Math.abs(c.cut! - len) < 1e-3);
    // Fields a cut changes by itself are not worth listing; anything else the clip went through is.
    const extra = host.fields.filter((f) => !TRIM_FIELDS.has(f) || f === 'keyframes');
    if (same) {
      same.clipIds.push(host.clipIds[0], ...more);
      same.trackIds = [...new Set([...same.trackIds, ...host.trackIds])];
      same.fields = [...new Set([...same.fields, ...extra])];
    } else cuts.push({ key: `cut:${host.clipIds[0]}`, kind: 'change', scope: 'clips', clipIds: [host.clipIds[0], ...more], trackIds: [...host.trackIds], fields: ['cut', ...extra], label: host.label, clipType: host.clipType, trackKind: host.trackKind, time: at, cut: len });
  }
  for (const cut of cuts) {
    for (const m of changed.filter((c) => c.delta !== undefined && Math.abs(c.delta + cut.cut!) < 1e-3 && (c.time ?? 0) >= cut.time! - 1e-3)) {
      changed.splice(changed.indexOf(m), 1);
      cut.clipIds.push(...m.clipIds);
    }
    cut.count = cut.clipIds.length;
    out.push(cut);
  }

  // Many clips changed the same way (a cut shifting everything after it, a find-and-replace in captions) read as one row.
  const groups = new Map<string, Change[]>();
  for (const c of changed) {
    const sig = c.delta !== undefined ? 'moved' : `${c.trackIds[0]}|${c.fields.join(',')}`;
    groups.set(sig, [...(groups.get(sig) || []), c]);
  }
  for (const [sig, list] of groups) {
    if (list.length < GROUP_MIN) {
      out.push(...list);
      continue;
    }
    const d0 = list[0].delta;
    const sameDelta = d0 !== undefined && list.every((c) => c.delta !== undefined && Math.abs(c.delta - d0) < 1e-3);
    out.push({
      key: `clips:${sig}`,
      kind: 'change',
      scope: 'clips',
      clipIds: list.flatMap((c) => c.clipIds),
      trackIds: [...new Set(list.flatMap((c) => c.trackIds))],
      fields: list[0].fields,
      label: '',
      clipType: new Set(list.map((c) => c.clipType)).size === 1 ? list[0].clipType : undefined,
      trackKind: new Set(list.map((c) => c.trackKind)).size === 1 ? list[0].trackKind : undefined,
      time: Math.min(...list.map((c) => c.time ?? 0)),
      count: list.length,
      delta: sameDelta ? d0 : undefined,
    });
  }
  return out.sort((x, y) => (x.time ?? -1) - (y.time ?? -1) || x.key.localeCompare(y.key));
}

function insertSorted(track: Track, clip: Clip) {
  const i = track.clips.findIndex((c) => c.start > clip.start);
  track.clips.splice(i < 0 ? track.clips.length : i, 0, clip);
}
function removeClip(p: Project, id: string) {
  for (const t of p.tracks) {
    const i = t.clips.findIndex((c) => c.id === id);
    if (i >= 0) {
      t.clips.splice(i, 1);
      return t.id;
    }
  }
  return null;
}

/**
 * Make `target` match `source` for the parts that `changes` cover, and leave everything else alone.
 * Reject a change: syncChanges(current, before, [change]). Accept it: syncChanges(before, current, [change]),
 * which moves the review's baseline forward so the change stops showing.
 */
export function syncChanges(target: Project, source: Project, changes: Change[]) {
  const S = indexOf(source);
  const tracks = new Set<string>();
  const clips = new Set<string>();
  let order = false;
  let project = false;
  for (const c of changes) {
    if (c.scope === 'track') tracks.add(c.trackIds[0]);
    else if (c.scope === 'order') order = true;
    else if (c.scope === 'project') project = true;
    else c.clipIds.forEach((id) => clips.add(id));
  }

  for (const id of tracks) {
    const s = S.tracks.get(id);
    const ti = target.tracks.findIndex((t) => t.id === id);
    if (s && ti < 0) {
      // The whole track comes back (or arrives), with its clips; drop those clips anywhere else first.
      for (const c of s.clips) removeClip(target, c.id);
      target.tracks.splice(Math.min(source.tracks.indexOf(s), target.tracks.length), 0, clone(s));
    } else if (!s && ti >= 0) {
      target.tracks.splice(ti, 1);
    } else if (s && ti >= 0) {
      const t = target.tracks[ti] as any;
      for (const k of TRACK_FIELDS) {
        if (s[k] === undefined) delete t[k];
        else t[k] = clone(s[k]);
      }
    }
  }

  for (const id of clips) {
    const was = removeClip(target, id);
    const s = S.clips.get(id);
    if (!s) continue;
    const t = target.tracks.find((x) => x.id === s.track.id) || target.tracks.find((x) => x.id === was);
    if (t) insertSorted(t, clone(s.clip));
  }

  if (order) {
    const rank = new Map(source.tracks.map((t, i) => [t.id, i]));
    const slots = target.tracks.map((t, i) => (rank.has(t.id) ? i : -1)).filter((i) => i >= 0);
    const shared = slots.map((i) => target.tracks[i]).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    slots.forEach((slot, n) => (target.tracks[slot] = shared[n]));
  }

  if (project) for (const k of PROJECT_FIELDS) (target as any)[k] = clone(source[k] ?? null);
}
