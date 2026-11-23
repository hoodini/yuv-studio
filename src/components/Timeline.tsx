import { moveTrack } from '../../shared/ops';
import { AudioLines, Captions, Copy, Diamond, Eye, EyeOff, Film, Gauge, Magnet, Plus, Redo2, Scissors, ScissorsLineDashed, Trash2, Type, Undo2, Unlink, Volume2, VolumeX, X, ZoomIn, ZoomOut } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { addMediaClip, addTrack, insertClip, moveClipToNewTrack, moveKeyframe, placeClip, removeTrack, trimClip, updateClip } from '../../shared/ops';
import type { Asset, Clip, Project, Track } from '../../shared/types';
import { audioFades, clamp, clipEnd, projectDuration } from '../../shared/types';
import { actions } from '../actions';
import { useTouched } from '../agentFx';
import { api, thumbUrl } from '../api';
import { useT } from '../i18n';
import { playback } from '../playback';
import { useReviewChanges } from '../review';
import { useStore } from '../store';

const ROW_H: Record<string, number> = {
  video: 64,
  audio: 48,
  text: 38,
  caption: 38,
};
const HEAD_W = 200;
const STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

const peakCache = new Map<string, Promise<{ rate: number; peaks: number[] }>>();
const loadPeaks = (projectId: string, assetId: string) => {
  if (!peakCache.has(assetId)) {
    const job = api.peaks(projectId, assetId);
    job.catch(() => peakCache.delete(assetId));
    peakCache.set(assetId, job);
  }
  return peakCache.get(assetId)!;
};

function Waveform({ projectId, clip, width, height }: { projectId: string; clip: Clip; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    const w = Math.round(Math.min(width, 4000));
    loadPeaks(projectId, clip.assetId!)
      .then((pk) => {
        const c = ref.current;
        if (!live || !c) return;
        c.width = w;
        c.height = height;
        const g = c.getContext('2d')!;
        g.clearRect(0, 0, w, height);
        g.fillStyle = 'rgba(185,185,201,.75)';
        const srcLen = clip.duration * clip.speed;
        for (let x = 0; x < w; x += 2) {
          const a = Math.floor((clip.in + (x / w) * srcLen) * pk.rate);
          const b = Math.max(a + 1, Math.floor((clip.in + ((x + 2) / w) * srcLen) * pk.rate));
          let m = 0;
          for (let i = a; i < b; i++) m = Math.max(m, pk.peaks[i] || 0);
          const h = Math.max(1, Math.sqrt(m) * height * clip.volume);
          g.fillRect(x, (height - Math.min(height, h)) / 2, 1.4, Math.min(height, h));
        }
      })
      .catch(() => {});
    return () => void (live = false);
  }, [projectId, clip.assetId, clip.in, clip.duration, clip.speed, clip.volume, Math.round(Math.min(width, 4000)), height]);
  return <canvas ref={ref} className="clip-wave" style={{ height }} />;
}

interface ClipProps {
  clip: Clip;
  track: Track;
  asset?: Asset;
  projectId: string;
  zoom: number;
  selected: boolean;
  /** How the AI agent changed this clip, while its edits await review. */
  mark?: string;
  view: [number, number];
  onDown: (e: React.PointerEvent, clip: Clip, mode: DragMode) => void;
  onMenu: (e: React.MouseEvent, clip: Clip) => void;
  /** The picked keyframe on this clip (seconds from the clip's start), if any. */
  kfSel?: number;
  onKfDown: (e: React.PointerEvent, clip: Clip, t: number) => void;
}
type DragMode = 'move' | 'start' | 'end' | 'fadeIn' | 'fadeOut' | 'volume';
export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

const ClipView = memo(function ClipView({ clip, track, asset, projectId, zoom, selected, mark, view, onDown, onMenu, kfSel, onKfDown }: ClipProps) {
  const touched = useTouched(clip.id);
  const left = clip.start * zoom;
  const width = Math.max(4, clip.duration * zoom);
  const h = ROW_H[track.kind] - 8;
  const tiles: React.ReactNode[] = [];
  if (asset && (clip.type === 'video' || clip.type === 'image')) {
    const tileW = Math.round((h * (asset.width || 16)) / (asset.height || 9));
    const first = Math.max(0, Math.floor((view[0] - left) / tileW));
    const last = Math.min(Math.ceil(width / tileW), Math.ceil((view[1] - left) / tileW));
    for (let i = first; i < last; i++) {
      const src = clip.in + (((i + 0.5) * tileW) / zoom) * clip.speed;
      const idx = asset.kind === 'image' ? 0 : clamp(Math.floor((src / Math.max(0.01, asset.duration)) * asset.thumbs), 0, asset.thumbs - 1);
      tiles.push(<img key={i} src={thumbUrl(projectId, asset.id, idx)} style={{ left: i * tileW, width: tileW, height: h }} draggable={false} loading="lazy" alt="" />);
    }
  }
  const hasWave = asset?.hasAudio && !clip.muted && width > 24;
  // Sound you can shape right on the clip (when it is selected): fade handles in the corners, a volume line across.
  const audible = (clip.type === 'audio' || (clip.type === 'video' && asset?.hasAudio)) && !clip.muted;
  const [fin, fout] = audioFades(clip);
  const volY = h * (1 - clamp(clip.volume, 0, 2) / 2);
  return (
    <div
      className={`clip clip-${clip.type}${selected ? ' selected' : ''}${clip.muted ? ' is-muted' : ''}${mark ? ` rv-mark rv-mark-${mark}` : ''}${touched ? ' agent-touched' : ''}`}
      data-clip-id={clip.id}
      style={{ left, width, height: h }}
      onPointerDown={(e) => onDown(e, clip, 'move')}
      onContextMenu={(e) => onMenu(e, clip)}
      title={clip.name}
    >
      {tiles.length > 0 && <div className="clip-thumbs">{tiles}</div>}
      {hasWave && <Waveform projectId={projectId} clip={clip} width={width} height={clip.type === 'audio' ? h - 4 : Math.round(h * 0.42)} />}
      <span className="clip-label" dir="auto">
        {clip.type === 'text' || clip.type === 'caption' ? clip.text : clip.name}
        {clip.speed !== 1 && <em> {clip.speed}×</em>}
      </span>
      {clip.tin.type !== 'none' && <i className="clip-tr clip-tr-in" style={{ width: Math.min(width / 2, clip.tin.duration * zoom) }} />}
      {clip.tout.type !== 'none' && <i className="clip-tr clip-tr-out" style={{ width: Math.min(width / 2, clip.tout.duration * zoom) }} />}
      {selected && audible && width > 40 && (
        <>
          <svg className="fade-shape" width={width} height={h} aria-hidden>
            {fin > 0 && <polygon points={`0,0 ${fin * zoom},0 0,${h}`} />}
            {fout > 0 && <polygon points={`${width},0 ${width - fout * zoom},0 ${width},${h}`} />}
          </svg>
          <span className="vol-line" style={{ top: volY }} onPointerDown={(e) => onDown(e, clip, 'volume')} title="Volume">
            <b>{Math.round(clip.volume * 100)}%</b>
          </span>
          <span className="fade-h" style={{ left: fin * zoom }} onPointerDown={(e) => onDown(e, clip, 'fadeIn')} title="Fade in" />
          <span className="fade-h" style={{ left: width - fout * zoom }} onPointerDown={(e) => onDown(e, clip, 'fadeOut')} title="Fade out" />
        </>
      )}
      {clip.keyframes?.map((k, i) => (
        <i
          key={i}
          className={`kf${kfSel != null && Math.abs(kfSel - k.t) < 1e-3 ? ' on' : ''}`}
          style={{ left: k.t * zoom }}
          title="Keyframe: click to pick (Delete removes it), drag to move it in time"
          onPointerDown={(e) => onKfDown(e, clip, k.t)}
        />
      ))}
      <span className="trim trim-start" onPointerDown={(e) => onDown(e, clip, 'start')} />
      <span className="trim trim-end" onPointerDown={(e) => onDown(e, clip, 'end')} />
    </div>
  );
});

const KIND_ICON = {
  video: Film,
  audio: AudioLines,
  text: Type,
  caption: Captions,
};

export function Timeline() {
  const project = useStore((s) => s.project)!;
  const selection = useStore((s) => s.selection);
  // The agent's edits awaiting review: added and changed clips get an outline, removed ones a ghost where they were.
  const changes = useReviewChanges();
  const hoverChange = useStore((s) => s.hoverChange);
  const reviewBefore = useStore((s) => s.review?.before);
  const marks = new Map<string, string>();
  const ghosts = new Map<string, Clip[]>();
  for (const c of changes) {
    const hot = c.key === hoverChange ? ' hot' : '';
    if (c.kind === 'remove') {
      for (const t of reviewBefore?.tracks || []) for (const clip of t.clips) if (c.clipIds.includes(clip.id)) ghosts.set(t.id, [...(ghosts.get(t.id) || []), { ...clip, name: hot }]);
    } else for (const id of c.clipIds) marks.set(id, c.kind + hot);
  }
  const zoom = useStore((s) => s.zoom);
  const ripple = useStore((s) => s.ripple);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const { edit, checkpoint, select, set, undo, redo, notify } = useStore.getState();
  const { t } = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<[number, number]>([0, 3000]);
  const total = projectDuration(project);
  const [busy, setBusy] = useState(false);
  const [speedOpen, setSpeedOpen] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => setSpeedOpen(null), [selection[0]]);
  useEffect(() => {
    if (!speedOpen) return;
    const close = (ev: Event) => !(ev.target as HTMLElement)?.closest?.('.speed-wrap, .speed-pop') && setSpeedOpen(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [speedOpen]);

  const updateView = () => {
    const el = scrollRef.current;
    if (el) setView([el.scrollLeft - 600, el.scrollLeft + el.clientWidth + 600]);
  };
  useEffect(updateView, [zoom]);
  const contentW = Math.max(total + 8, (scrollRef.current?.clientWidth || 1200) / zoom) * zoom;

  // The playhead line moves without re-rendering the timeline.
  useEffect(() => {
    const place = () => {
      const x = playback.time * useStore.getState().zoom;
      const el = scrollRef.current;
      if (headRef.current) headRef.current.style.transform = `translateX(${x}px)`;
      if (el && playback.playing && (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft)) el.scrollLeft = x - 80;
    };
    place();
    return playback.subscribe(place);
  }, [zoom]);

  const timeAt = (clientX: number) => {
    const el = scrollRef.current!;
    return Math.max(0, (clientX - el.getBoundingClientRect().left + el.scrollLeft) / zoom);
  };
  const trackAt = (clientY: number) => {
    for (const row of scrollRef.current!.querySelectorAll<HTMLElement>('[data-track]')) {
      const r = row.getBoundingClientRect();
      if (clientY >= r.top && clientY < r.bottom) return row.dataset.track!;
    }
  };
  const dragWindow = (move: (e: PointerEvent) => void, done?: () => void) => {
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      done?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const scrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    playback.pause();
    playback.seek(timeAt(e.clientX));
    dragWindow((ev) => playback.seek(timeAt(ev.clientX)));
  };

  /** Edges of other clips and the playhead pull a dragged clip to them. */
  const snapPoints = (ignore: string) => {
    const pts = [0, playback.time];
    for (const tr of project.tracks) for (const c of tr.clips) if (c.id !== ignore) pts.push(c.start, clipEnd(c));
    return pts;
  };
  const snap = (v: number, pts: number[]) => {
    let best = v;
    let dist = 8 / zoom;
    for (const p of pts) if (Math.abs(p - v) < dist) ((best = p), (dist = Math.abs(p - v)));
    return best;
  };

  /** Drag a track head up or down to put that layer above or below the others. */
  const [dragTrack, setDragTrack] = useState('');
  const onHeadDown = (e: React.PointerEvent, trackId: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const y0 = e.clientY;
    let started = false;
    dragWindow(
      (ev) => {
        if (!started && Math.abs(ev.clientY - y0) < 4) return;
        if (!started) ((started = true), checkpoint(), setDragTrack(trackId));
        // the new position = how many of the other layers sit above the pointer
        const others = [...document.querySelectorAll<HTMLElement>('[data-head]')].filter((h) => h.dataset.head !== trackId);
        const index = others.filter((h) => {
          const r = h.getBoundingClientRect();
          return ev.clientY > r.top + r.height / 2;
        }).length;
        const from = useStore.getState().project!.tracks.findIndex((x) => x.id === trackId);
        if (index !== from) edit((p) => void moveTrack(p, trackId, index), true);
      },
      () => setDragTrack(''),
    );
  };

  /** While a clip is dragged above or below every layer: a new layer will be made there. */
  const [newLayer, setNewLayer] = useState<{
    where: 'above' | 'below';
    kind: string;
  } | null>(null);
  /** Where a dragged clip will go in when it is let go: the clips from there on move right. */
  const [insertAt, setInsertAt] = useState<{ trackId: string; at: number } | null>(null);
  const onClipDown = (e: React.PointerEvent, clip: Clip, mode: DragMode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    select(e.shiftKey ? [...new Set([...selection, clip.id])] : [clip.id]);
    const x0 = e.clientX;
    const y0 = e.clientY;
    const pts = snapPoints(clip.id);
    let started = false;
    let where: 'above' | 'below' | null = null;
    let lastStart = clip.start;
    let ins: { trackId: string; at: number } | null = null;
    const kind = clip.type === 'image' ? 'video' : clip.type;
    const fromTrack = project.tracks.find((tr) => tr.clips.some((c) => c.id === clip.id))!;
    const from = { trackId: fromTrack.id, start: clip.start };
    const [fin0, fout0] = audioFades(clip);
    const rowH = ROW_H[fromTrack.kind] - 8;
    dragWindow(
      (ev) => {
        const dx = ev.clientX - x0;
        if (!started && Math.abs(dx) < 3 && Math.abs(ev.clientY - y0) < 3) return;
        if (!started) ((started = true), checkpoint());
        const dt = dx / zoom;
        if (mode === 'fadeIn' || mode === 'fadeOut') {
          const v = clamp(mode === 'fadeIn' ? fin0 + dt : fout0 - dt, 0, Math.min(10, clip.duration / 2));
          edit((p) => updateClip(p, clip.id, { [mode]: Math.round(v * 20) / 20 } as any), true);
          return;
        }
        if (mode === 'volume') {
          let v = clamp(clip.volume - ((ev.clientY - y0) / rowH) * 2, 0, 2);
          if (Math.abs(v - 1) < 0.04) v = 1;
          edit((p) => updateClip(p, clip.id, { volume: Math.round(v * 100) / 100 }), true);
          return;
        }
        if (mode === 'move') {
          let start = snap(clip.start + dt, pts);
          const endSnap = snap(clip.start + dt + clip.duration, pts);
          if (endSnap !== clip.start + dt + clip.duration && start === clip.start + dt) start = endSnap - clip.duration;
          // Past the top or bottom of the layers of this kind: a new layer, made when the clip is let go.
          const rows = [...scrollRef.current!.querySelectorAll<HTMLElement>(`.tl-row-${kind === 'video' || kind === 'audio' ? kind : '__none'}`)];
          const first = rows[0]?.getBoundingClientRect();
          const last = rows[rows.length - 1]?.getBoundingClientRect();
          const next = !first || !last ? null : ev.clientY < first.top + 6 ? 'above' : ev.clientY > last.bottom - 6 ? 'below' : null;
          if (next !== where) ((where = next), setNewLayer(next ? { where: next, kind } : null));
          lastStart = Math.max(0, start);
          const trackId = where ? undefined : trackAt(ev.clientY);
          edit((p) => placeClip(p, clip.id, lastStart, trackId), true);
          // The insertion point: inside another clip, before it (first half) or after it (second half).
          const target = useStore.getState().project!.tracks.find((tr) => tr.id === trackId);
          if (!where && target && target.kind === kind) {
            const pt = timeAt(ev.clientX);
            const hit = target.clips.find((c) => c.id !== clip.id && pt > c.start && pt < clipEnd(c));
            const at = hit ? (pt < hit.start + hit.duration / 2 ? hit.start : clipEnd(hit)) : lastStart;
            ins = { trackId: target.id, at };
          } else ins = null;
          setInsertAt(ins);
        } else {
          const time = snap(mode === 'start' ? clip.start + dt : clipEnd(clip) + dt, pts);
          edit((p) => trimClip(p, clip.id, mode, time), true);
        }
      },
      () => {
        if (where) edit((p) => void moveClipToNewTrack(p, clip.id, where!, lastStart), true);
        else if (started && mode === 'move' && ins) {
          const to = ins;
          edit((p) => void insertClip(p, clip.id, to.at, { trackId: to.trackId, ripple: useStore.getState().ripple, from }), true);
        }
        setNewLayer(null);
        setInsertAt(null);
      },
    );
  };

  /** Pick a keyframe on a clip; drag it sideways to move it to another moment. */
  const selectedKf = useStore((s) => s.selectedKf);
  const onKfDown = (e: React.PointerEvent, clip: Clip, t: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const fps = useStore.getState().project!.fps;
    let cur = clip.start + t;
    select([clip.id]);
    set({ selectedKf: { clipId: clip.id, time: cur } });
    playback.pause();
    playback.seek(cur);
    const x0 = e.clientX;
    let started = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (!started && Math.abs(dx) < 3) return;
      if (!started) ((started = true), checkpoint());
      const want = Math.min(clipEnd(clip), Math.max(clip.start, Math.round((clip.start + t + dx / zoom) * fps) / fps));
      if (Math.abs(want - cur) < 0.5 / fps) return;
      let moved = false;
      edit((p) => void (moved = moveKeyframe(p, clip.id, cur, want)), true);
      if (!moved) return;
      cur = want;
      set({ selectedKf: { clipId: clip.id, time: cur } });
      playback.seek(cur);
    };
    const up = () => (window.removeEventListener('pointermove', move), window.removeEventListener('pointerup', up));
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const [menu, setMenu] = useState<{ x: number; y: number; clipId: string } | null>(null);
  const onMenu = (e: React.MouseEvent, clip: Clip) => {
    e.preventDefault();
    e.stopPropagation();
    select([clip.id]);
    setMenu({ x: Math.min(e.clientX, innerWidth - 250), y: Math.min(e.clientY, innerHeight - 330), clipId: clip.id });
  };
  useEffect(() => {
    if (!menu) return;
    const close = (ev: Event) => !(ev.target as HTMLElement)?.closest?.('.ctx-menu') && setMenu(null);
    const esc = (ev: KeyboardEvent) => ev.key === 'Escape' && setMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => (window.removeEventListener('pointerdown', close), window.removeEventListener('keydown', esc));
  }, [menu]);

  const onDrop = (e: React.DragEvent) => {
    const assetId = e.dataTransfer.getData('application/x-asset');
    if (e.dataTransfer.files.length) {
      e.preventDefault();
      return void actions.upload([...e.dataTransfer.files]);
    }
    if (!assetId) return;
    e.preventDefault();
    const start = timeAt(e.clientX);
    const trackId = trackAt(e.clientY);
    const asset = project.assets.find((a) => a.id === assetId);
    const track = project.tracks.find((x) => x.id === trackId);
    const ok = track && asset && track.kind === (asset.kind === 'audio' ? 'audio' : 'video');
    let id = '';
    edit(
      (p) =>
        void (id = addMediaClip(p, assetId, {
          start,
          trackId: ok ? trackId : undefined,
          broll: !ok && asset?.kind !== 'audio',
        }).id),
    );
    if (id) select([id]);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const el = scrollRef.current!;
    const at = timeAt(e.clientX);
    const next = clamp(zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), 4, 600);
    set({ zoom: next });
    requestAnimationFrame(() => (el.scrollLeft = at * next - (e.clientX - el.getBoundingClientRect().left)));
  };
  useEffect(() => {
    // React registers wheel listeners as passive; block the browser's own Ctrl+wheel page zoom here.
    const el = scrollRef.current!;
    const stop = (e: WheelEvent) => (e.ctrlKey || e.metaKey) && e.preventDefault();
    el.addEventListener('wheel', stop, { passive: false });
    return () => el.removeEventListener('wheel', stop);
  }, []);

  const silence = async () => {
    setBusy(true);
    const r = await actions.server((id) => api.silences(id, {}));
    setBusy(false);
    if (r) notify(r.cuts ? t('silenceDone', { n: r.cuts, s: r.removed.toFixed(1) }) : t('silenceNone'));
  };

  const step = STEPS.find((s) => s * zoom >= 70) || 600;
  const ticks: number[] = [];
  for (let i = Math.max(0, Math.floor(view[0] / zoom / step)); i * step * zoom < view[1] && i * step * zoom < contentW; i++) ticks.push(i * step);
  const label = (s: number) => (step < 1 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(step < 0.25 ? 1 : 2).padStart(step < 0.25 ? 4 : 5, '0')}` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
  const hasRange = project.markIn != null && project.markOut != null;
  const sel = selection.length === 1 ? project.tracks.flatMap((tr) => tr.clips).find((c) => c.id === selection[0]) : undefined;
  const selAsset = sel && project.assets.find((a) => a.id === sel.assetId);
  const menuClip = menu && project.tracks.flatMap((tr) => tr.clips).find((c) => c.id === menu.clipId);
  const menuAsset = menuClip && project.assets.find((a) => a.id === menuClip.assetId);
  const act = (fn: () => void) => () => (fn(), setMenu(null));
  const Tool = ({ icon: Icon, text, onClick, disabled, active, kbd }: any) => (
    <button className={`tool${active ? ' active' : ''}`} onClick={onClick} disabled={disabled} title={kbd ? `${text} (${kbd})` : text}>
      <Icon size={17} />
      <span>{text}</span>
    </button>
  );

  return (
    <section className="timeline">
      {menu && menuClip && (
        <div className="ctx-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
          <button role="menuitem" onClick={act(actions.split)}>
            <Scissors size={14} /> {t('split')} <kbd>S</kbd>
          </button>
          {menuClip.type !== 'audio' && menuClip.type !== 'caption' && (
            <button role="menuitem" onClick={act(actions.toggleKeyframe)}>
              <Diamond size={14} /> {t('keyframe')} <kbd>K</kbd>
            </button>
          )}
          {(menuClip.type === 'video' || menuClip.type === 'audio') && (
            <div className="ctx-speed">
              <span>
                <Gauge size={14} /> {t('speed')}
              </span>
              <div>
                {SPEEDS.map((v) => (
                  <button key={v} className={`chip-btn${Math.abs(menuClip.speed - v) < 1e-3 ? ' active' : ''}`} onClick={act(() => actions.setSpeed(v))}>
                    {v}×
                  </button>
                ))}
              </div>
            </div>
          )}
          {menuClip.type === 'video' && menuAsset?.hasAudio && !menuClip.muted && (
            <button role="menuitem" onClick={act(actions.detachAudio)}>
              <Unlink size={14} /> {t('detachAudio')}
            </button>
          )}
          {(menuClip.type === 'video' || menuClip.type === 'audio') && (
            <button role="menuitem" onClick={act(() => edit((p) => updateClip(p, menuClip.id, { muted: !menuClip.muted })))}>
              {menuClip.muted ? <Volume2 size={14} /> : <VolumeX size={14} />} {menuClip.muted ? t('unmute') : t('mute')}
            </button>
          )}
          <button role="menuitem" onClick={act(actions.duplicate)}>
            <Copy size={14} /> {t('duplicate')} <kbd>Ctrl+D</kbd>
          </button>
          <button role="menuitem" className="danger" onClick={act(actions.remove)}>
            <Trash2 size={14} /> {t('delete')} <kbd>Del</kbd>
          </button>
        </div>
      )}
      <div className="tl-toolbar">
        <div className="tool-group icons-only">
          <Tool icon={Undo2} text={t('undo')} onClick={undo} disabled={!canUndo} kbd="Ctrl+Z" />
          <Tool icon={Redo2} text={t('redo')} onClick={redo} disabled={!canRedo} kbd="Ctrl+Y" />
        </div>
        <div className="tool-group">
          <Tool icon={Scissors} text={t('split')} onClick={actions.split} kbd="S" />
          <Tool icon={Trash2} text={t('delete')} onClick={actions.remove} disabled={!selection.length} kbd="Del" />
          <Tool icon={Copy} text={t('duplicate')} onClick={actions.duplicate} disabled={selection.length !== 1} kbd="Ctrl+D" />
          <Tool icon={Magnet} text={t('ripple')} onClick={() => set({ ripple: !ripple })} active={ripple} />
        </div>
        <div className="tool-group">
          <Tool icon={() => <b className="mark-ico">[</b>} text={t('markIn')} onClick={() => actions.mark('in')} kbd="I / [" />
          <Tool icon={() => <b className="mark-ico">]</b>} text={t('markOut')} onClick={() => actions.mark('out')} kbd="O / ]" />
          <Tool icon={ScissorsLineDashed} text={t('cutRange')} onClick={actions.cutMarked} disabled={!hasRange} kbd="X" />
          {(project.markIn != null || project.markOut != null) && <Tool icon={X} text={t('clearMarks')} onClick={actions.clearMarks} />}
        </div>
        <div className="tool-group">
          <Tool icon={VolumeX} text={busy ? '…' : t('removeSilence')} onClick={silence} disabled={busy || !total} />
        </div>
        {sel && (
          <div className="tool-group clip-tools">
            {(sel.type === 'video' || sel.type === 'audio') && (
              <div className="speed-wrap">
                <Tool
                  icon={Gauge}
                  text={`${t('speed')} ${sel.speed}×`}
                  onClick={(e: React.MouseEvent) => {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setSpeedOpen(speedOpen ? null : { x: Math.min(r.left, innerWidth - 226), y: r.bottom + 6 });
                  }}
                  active={!!speedOpen || sel.speed !== 1}
                />
                {speedOpen && (
                  <div className="speed-pop" style={{ left: speedOpen.x, top: speedOpen.y }} onPointerDown={(e) => e.stopPropagation()}>
                    {SPEEDS.map((v) => (
                      <button key={v} className={`chip-btn${Math.abs(sel.speed - v) < 1e-3 ? ' active' : ''}`} onClick={() => (actions.setSpeed(v), setSpeedOpen(null))}>
                        {v}×
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {sel.type === 'video' && selAsset?.hasAudio && !sel.muted && <Tool icon={Unlink} text={t('detachAudio')} onClick={actions.detachAudio} />}
            {sel.type !== 'audio' && sel.type !== 'caption' && <Tool icon={Diamond} text={t('keyframe')} onClick={actions.toggleKeyframe} kbd="K" />}
          </div>
        )}
        <div className="tool-spacer" />
        <div className="tool-group">
          <Tool icon={Plus} text={t('video')} onClick={() => edit((p) => void addTrack(p, 'video'))} />
          <Tool icon={Plus} text={t('audio')} onClick={() => edit((p) => void addTrack(p, 'audio'))} />
          <Tool icon={Plus} text={t('text')} onClick={() => edit((p) => void addTrack(p, 'text'))} />
        </div>
        <div className="tool-group zoom-group" dir="ltr">
          <button className="icon-btn sm" onClick={() => set({ zoom: clamp(zoom / 1.4, 4, 600) })} aria-label="Zoom out">
            <ZoomOut size={16} />
          </button>
          <input type="range" min={1.4} max={6.4} step={0.01} value={Math.log(zoom)} onChange={(e) => set({ zoom: Math.exp(Number(e.target.value)) })} aria-label={t('zoom')} />
          <button className="icon-btn sm" onClick={() => set({ zoom: clamp(zoom * 1.4, 4, 600) })} aria-label="Zoom in">
            <ZoomIn size={16} />
          </button>
        </div>
      </div>
      <div className="tl-body" dir="ltr">
        <div className="tl-heads" style={{ width: HEAD_W }}>
          <div className="tl-ruler-spacer" />
          {project.tracks.map((track) => {
            const Icon = KIND_ICON[track.kind];
            const visual = track.kind !== 'audio';
            return (
              <div key={track.id} data-head={track.id} className={`tl-head${dragTrack === track.id ? ' dragging' : ''}`} style={{ height: ROW_H[track.kind] }} onPointerDown={(e) => onHeadDown(e, track.id)} title={t('dragLayer')}>
                <Icon size={15} />
                <span className="tl-head-name" dir="auto">
                  {track.name}
                </span>
                {track.kind !== 'text' && track.kind !== 'caption' && (
                  <button className="mini" onClick={() => edit((p) => void (p.tracks.find((x) => x.id === track.id)!.muted = !track.muted))} aria-label={t('mute')} title={t('mute')}>
                    {track.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                  </button>
                )}
                {visual && (
                  <button className="mini" onClick={() => edit((p) => void (p.tracks.find((x) => x.id === track.id)!.hidden = !track.hidden))} aria-label="Hide" title="Hide">
                    {track.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                )}
                <button className="mini" onClick={() => edit((p) => removeTrack(p, track.id))} aria-label={t('remove')} title={t('remove')}>
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="tl-scroll" ref={scrollRef} onScroll={updateView} onWheel={onWheel} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          <div className="tl-content" style={{ width: contentW }}>
            <div className="tl-ruler" onPointerDown={scrub}>
              {ticks.map((s) => (
                <span key={s} className="tick" style={{ left: s * zoom }}>
                  {label(s)}
                </span>
              ))}
            </div>
            {project.tracks.map((track) => {
              const same = project.tracks.filter((x) => x.kind === track.kind);
              const drop = newLayer && newLayer.kind === track.kind ? (newLayer.where === 'above' && same[0] === track ? 'above' : newLayer.where === 'below' && same[same.length - 1] === track ? 'below' : '') : '';
              return (
                <div
                  key={track.id}
                  data-track={track.id}
                  className={`tl-row tl-row-${track.kind}${track.hidden ? ' is-hidden' : ''}${track.muted ? ' is-muted' : ''}`}
                  style={{ height: ROW_H[track.kind] }}
                  onPointerDown={(e) => (scrub(e), select([]))}
                >
                  {drop && (
                    <div className={`tl-newlayer tl-newlayer-${drop}`}>
                      <span>{t('newLayerHere')}</span>
                    </div>
                  )}
                  {track.clips.map((clip) =>
                    clipEnd(clip) * zoom < view[0] || clip.start * zoom > view[1] ? null : (
                      <ClipView
                        key={clip.id}
                        clip={clip}
                        track={track}
                        asset={project.assets.find((a) => a.id === clip.assetId)}
                        projectId={project.id}
                        zoom={zoom}
                        selected={selection.includes(clip.id)}
                        mark={marks.get(clip.id)}
                        view={view}
                        onDown={onClipDown}
                        onMenu={onMenu}
                        kfSel={selectedKf?.clipId === clip.id ? selectedKf.time - clip.start : undefined}
                        onKfDown={onKfDown}
                      />
                    ),
                  )}
                  {insertAt?.trackId === track.id && <i className="tl-insert" style={{ left: insertAt.at * zoom }} aria-hidden />}
                  {ghosts.get(track.id)?.map((g) => (
                    <i
                      key={g.id}
                      className={`rv-ghost${g.name}`}
                      style={{
                        left: g.start * zoom,
                        width: Math.max(4, g.duration * zoom),
                        height: ROW_H[track.kind] - 8,
                      }}
                      aria-hidden
                    />
                  ))}
                </div>
              );
            })}
            {project.markIn != null && (
              <span className="tl-flag tl-flag-in" style={{ left: project.markIn * zoom }}>
                IN
              </span>
            )}
            {project.markOut != null && (
              <span className="tl-flag tl-flag-out" style={{ left: project.markOut * zoom }}>
                OUT
              </span>
            )}
            {(project.markIn != null || project.markOut != null) && (
              <div
                className="tl-range"
                style={{
                  left: (project.markIn ?? project.markOut!) * zoom,
                  width: hasRange ? (project.markOut! - project.markIn!) * zoom : 2,
                }}
              >
                {/* With both marks set, the cut is one click away, right on the range. */}
                {hasRange && (
                  <div className="range-actions">
                    <button onClick={actions.cutMarked} title={`${t('cutRange')} (X)`}>
                      <ScissorsLineDashed size={13} /> {t('cutRange')} <kbd>X</kbd>
                    </button>
                    <button onClick={actions.clearMarks} title={`${t('clearMarks')} (Alt+X)`} aria-label={t('clearMarks')}>
                      <X size={13} />
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="playhead" ref={headRef}>
              <i />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
