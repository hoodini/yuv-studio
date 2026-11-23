import { ChevronFirst, ChevronLast, Diamond, Maximize, Minimize, Pause, PenLine, Play, StepBack, StepForward, Volume1, Volume2, VolumeX } from 'lucide-react';
import { DrawLayer } from './DrawLayer';
import { stage } from '../stageCapture';
import { actions } from '../actions';
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { cssFilter, mediaRect, transformAt, transitionState, watermarkRect } from '../../shared/geometry';
import { applyTransform, captionTransform } from '../../shared/ops';
import { drawOverlay, textBands } from '../../shared/renderText';
import type { Box } from '../../shared/renderText';
import type { Clip, Project, Track, Transform } from '../../shared/types';
import { audioFades, clamp, clipEnd, projectDuration } from '../../shared/types';
import { assetUrl } from '../api';
import { loadFonts } from '../fonts';
import { useT } from '../i18n';
import { monitor, playback, timecode, useMonitor, usePlayhead, usePlaying } from '../playback';
import { getSelected, useStore } from '../store';
import { EXPORT_PRESETS } from '../../shared/presets';
import { SafeZones } from './SafeZones';
import { brandCardRanges } from '../../shared/brand';

type El = HTMLVideoElement | HTMLAudioElement | HTMLImageElement;

/** Keep one media element per clip near the playhead, positioned and in sync with the clock. */
function syncMedia(p: Project, t: number, playing: boolean, host: HTMLElement, els: Map<string, El>, resync: () => void) {
  const alive = new Set<string>();
  const k = Math.min(p.width, p.height) / 1080;
  p.tracks.forEach((track, ti) => {
    if (track.kind !== 'video' && track.kind !== 'audio') return;
    track.clips.forEach((clip, ci) => {
      const asset = p.assets.find((a) => a.id === clip.assetId);
      if (!asset) return;
      const active = t >= clip.start && t < clipEnd(clip);
      if (!(t >= clip.start - 4 && t < clipEnd(clip) + 0.5)) return;
      alive.add(clip.id);
      let el = els.get(clip.id);
      if (!el) {
        el = document.createElement(clip.type === 'image' ? 'img' : clip.type === 'audio' ? 'audio' : 'video');
        if (el instanceof HTMLMediaElement) {
          el.preload = 'auto';
          el.addEventListener('seeked', resync);
          el.addEventListener('loadeddata', resync);
        }
        if (el instanceof HTMLVideoElement) el.playsInline = true;
        el.draggable = false;
        el.className = 'stage-media';
        host.appendChild(el);
        els.set(clip.id, el);
      }
      const src = assetUrl(p.id, asset);
      if (el.dataset.src !== src) {
        el.dataset.src = src;
        el.src = src;
      }
      if (clip.type !== 'audio') {
        const visible = active && !track.hidden;
        el.style.visibility = visible ? 'visible' : 'hidden';
        if (visible) {
          const tf = transformAt(clip, t - clip.start);
          const r = mediaRect(p, asset, clip, tf);
          const ts = transitionState(clip, t - clip.start, p.width, p.height);
          const s = el.style;
          s.width = `${r.w}px`;
          s.height = `${r.h}px`;
          s.left = `${r.cx - r.w / 2 + ts.dx}px`;
          s.top = `${r.cy - r.h / 2 + ts.dy}px`;
          s.transform = `rotate(${tf.rotation + ts.rot}deg) scale(${ts.zoom})`;
          s.clipPath = ts.inset.some((v) => v > 0) ? `inset(${ts.inset.map((v) => `${v * 100}%`).join(' ')})` : 'none';
          s.opacity = String(tf.opacity * ts.alpha);
          s.filter = cssFilter(clip, k, ts);
          s.zIndex = String((p.tracks.length - ti) * 1000 + ci);
          s.mixBlendMode = clip.blend && clip.blend !== 'normal' ? clip.blend : 'normal';
        }
      }
      if (el instanceof HTMLMediaElement) {
        const want = clip.in + clamp(t - clip.start, 0, clip.duration) * clip.speed;
        const audible = !track.muted && !clip.muted && (clip.type === 'audio' || asset.hasAudio);
        el.muted = !audible;
        let vol = clamp(clip.volume, 0, 1);
        const [fin, fout] = audioFades(clip);
        if (fin > 0) vol *= clamp((t - clip.start) / fin, 0, 1);
        if (fout > 0) vol *= clamp((clipEnd(clip) - t) / fout, 0, 1);
        el.volume = clamp(vol * monitor.gain, 0, 1);
        if (active && playing) {
          el.playbackRate = clamp(clip.speed, 0.1, 8);
          if (el.paused) {
            if (Math.abs(el.currentTime - want) > 0.05) el.currentTime = want;
            el.play().catch(() => {});
          } else if (Math.abs(el.currentTime - want) > 0.3) el.currentTime = want;
        } else {
          if (!el.paused) el.pause();
          if (t < clipEnd(clip)) {
            const target = active ? want : clip.in;
            if (!el.seeking && Math.abs(el.currentTime - target) > (active ? 0.4 / p.fps : 0.05)) el.currentTime = target;
          }
        }
      }
    });
  });
  for (const [id, el] of els) {
    if (alive.has(id)) continue;
    if (el instanceof HTMLMediaElement) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    el.remove();
    els.delete(id);
  }
}

/** Preview volume and mute: a speaker button and a slider. Only the preview; the export is untouched. */
export function VolumeControl({ compact = false }: { compact?: boolean }) {
  const { volume, muted } = useMonitor();
  const { isHe } = useT();
  const silent = muted || volume === 0;
  const Icon = silent ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const pct = Math.round((silent ? 0 : volume) * 100);
  return (
    <div className={`vol-ctl${compact ? ' compact' : ''}${silent ? ' silent' : ''}`}>
      <button className="icon-btn vol-btn" onClick={() => monitor.toggleMute()} aria-pressed={silent} aria-label={silent ? (isHe ? 'ביטול השתקה' : 'Unmute') : isHe ? 'השתקה' : 'Mute'} title={`${silent ? (isHe ? 'ביטול השתקה' : 'Unmute') : isHe ? 'השתקה' : 'Mute'} (M)`}>
        <Icon size={18} />
      </button>
      <input
        type="range"
        className="vol-slider"
        min={0}
        max={100}
        step={1}
        value={pct}
        style={{ ['--v' as any]: `${pct}%` }}
        onChange={(e) => monitor.setVolume(Number(e.target.value) / 100)}
        aria-label={isHe ? 'עוצמת השמע בתצוגה' : 'Preview volume'}
        aria-valuetext={`${pct}%`}
      />
    </div>
  );
}

interface Hit {
  clip: Clip;
  track: Track;
  box: Box;
}

function boxesAt(p: Project, t: number, textBoxes: Map<string, Box>): Hit[] {
  const out: Hit[] = [];
  for (const track of p.tracks) {
    if (track.hidden) continue;
    for (const clip of track.clips) {
      if (t < clip.start || t >= clipEnd(clip)) continue;
      if (track.kind === 'video') {
        const tf = transformAt(clip, t - clip.start);
        const r = mediaRect(
          p,
          p.assets.find((a) => a.id === clip.assetId),
          clip,
          tf,
        );
        out.push({
          clip,
          track,
          box: { cx: r.cx, cy: r.cy, w: r.w, h: r.h, rotation: tf.rotation },
        });
      } else if (track.kind !== 'audio') {
        const box = textBoxes.get(clip.id);
        if (box) out.push({ clip, track, box });
      }
    }
  }
  return out;
}

const inside = (b: Box, x: number, y: number, pad = 0) => {
  const a = (-b.rotation * Math.PI) / 180;
  const dx = x - b.cx;
  const dy = y - b.cy;
  const rx = dx * Math.cos(a) - dy * Math.sin(a);
  const ry = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(rx) <= b.w / 2 + pad && Math.abs(ry) <= b.h / 2 + pad;
};

export function Stage() {
  const project = useStore((s) => s.project)!;
  const selection = useStore((s) => s.selection);
  const { edit, checkpoint, select } = useStore.getState();
  const t = usePlayhead();
  const playing = usePlaying();
  const vol = useMonitor();
  const { t: tr } = useT();
  const areaRef = useRef<HTMLDivElement>(null);
  // Full screen: the stage and its controls fill the screen (button under the picture, F, Esc to leave).
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const frameRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Canvases for text that sits under a video layer (text behind a person), keyed by that layer's index. */
  const bandCanvases = useRef(new Map<number, HTMLCanvasElement>());
  const els = useRef(new Map<string, El>());
  const textBoxes = useRef(new Map<string, Box>());
  const [fit, setFit] = useState(0.3);
  const [fonts, setFonts] = useState(false);
  const [guides, setGuides] = useState({ v: false, h: false });
  /** Preview the frame as a platform shows it: its crop and the edges its interface covers. */
  const [previewAs, setPreviewAs] = useState('');
  const [tick, resync] = useReducer((x: number) => x + 1, 0);
  const [, repaint] = useReducer((x: number) => x + 1, 0);
  const { width: W, height: H } = project;
  const drawing = useStore((s) => s.drawing);

  // The AI agent's frame capture: this frame, and the clips under a drawing (top layer first).
  useEffect(() => {
    stage.frame = frameRef.current;
    stage.hits = (m) => {
      const p = useStore.getState().project;
      if (!p) return [];
      const ids: string[] = [];
      for (const s of m.strokes) {
        const xs = s.map((q) => q.x * p.width);
        const ys = s.map((q) => q.y * p.height);
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        for (const h of boxesAt(p, m.t, textBoxes.current)) {
          const b = h.box;
          const hit = b.cx + b.w / 2 >= x0 && b.cx - b.w / 2 <= x1 && b.cy + b.h / 2 >= y0 && b.cy - b.h / 2 <= y1;
          if (hit && !ids.includes(h.clip.id)) ids.push(h.clip.id);
        }
      }
      return ids.slice(0, 12);
    };
    return () => {
      stage.frame = null;
      stage.hits = undefined;
    };
  }, []);
  // Esc puts the pen down
  useEffect(() => {
    if (!drawing) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && useStore.getState().set({ drawing: false });
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [drawing]);

  useEffect(() => void loadFonts().then(() => setFonts(true)), []);
  useEffect(() => {
    const el = areaRef.current!;
    const ro = new ResizeObserver(() => setFit(Math.max(0.02, Math.min((el.clientWidth - 8) / W, (el.clientHeight - 8) / H))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);
  useEffect(() => () => void els.current.forEach((el) => el.remove()), []);

  useLayoutEffect(() => {
    syncMedia(project, t, playing, hostRef.current!, els.current, resync);
    const canvas = canvasRef.current!;
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const before = selection[0] ? JSON.stringify(textBoxes.current.get(selection[0])) : '';
    // Text above all video on the main canvas; each band under a video layer on its own canvas at that depth.
    const bands = textBands(project);
    const top = bands.find((b) => b.below < 0);
    const boxes = drawOverlay(canvas.getContext('2d')!, project, t, top?.ids || new Set());
    for (const b of bands) {
      const c = b.below >= 0 ? bandCanvases.current.get(b.below) : undefined;
      if (!c) continue;
      if (c.width !== W || c.height !== H) (c.width = W), (c.height = H);
      for (const [id, box] of drawOverlay(c.getContext('2d')!, project, t, b.ids)) boxes.set(id, box);
    }
    textBoxes.current = boxes;
    // The selection frame is drawn from these boxes; repaint once if the selected one moved.
    if (selection[0] && JSON.stringify(textBoxes.current.get(selection[0])) !== before) repaint();
  }, [project, t, playing, fonts, tick, selection, vol]);

  const sel = getSelected({ project, selection });
  const hits = boxesAt(project, t, textBoxes.current);
  const selHit = sel ? hits.find((h) => h.clip.id === sel.clip.id) : undefined;

  const toFrame = (e: { clientX: number; clientY: number }) => {
    const r = frameRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / fit, y: (e.clientY - r.top) / fit };
  };
  const setTransform = (hit: Hit, patch: Partial<Transform>) =>
    edit((p) => {
      const track = p.tracks.find((x) => x.id === hit.track.id);
      const clip = track?.clips.find((c) => c.id === hit.clip.id);
      if (!track || !clip) return;
      if (track.kind === 'caption')
        track.transform = {
          ...(track.transform || captionTransform()),
          ...patch,
        };
      else applyTransform(p, clip.id, patch, playback.time); // an animated clip gets a keyframe at the playhead
    }, true);
  const transformOf = (hit: Hit): Transform => (hit.track.kind === 'caption' ? hit.track.transform || captionTransform() : transformAt(hit.clip, playback.time - hit.clip.start));

  const drag = (e: React.PointerEvent, onMove: (pt: { x: number; y: number }) => void) => {
    e.preventDefault();
    e.stopPropagation();
    checkpoint();
    const move = (ev: PointerEvent) => onMove(toFrame(ev));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setGuides({ v: false, h: false });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const pt = toFrame(e);
    // Prefer what is already selected, then the top-most layer under the pointer.
    const hit = (selHit && inside(selHit.box, pt.x, pt.y, 6 / fit) && selHit) || hits.find((h) => inside(h.box, pt.x, pt.y, h.track.kind === 'video' ? 0 : 10 / fit));
    if (!hit) return select([]);
    select([hit.clip.id]);
    const start = transformOf(hit);
    drag(e, (now) => {
      let x = start.x + (now.x - pt.x) / W;
      let y = start.y + (now.y - pt.y) / H;
      const sv = Math.abs(x - 0.5) < 0.012;
      const sh = Math.abs(y - 0.5) < 0.012;
      if (sv) x = 0.5;
      if (sh) y = 0.5;
      setGuides({ v: sv, h: sh });
      setTransform(hit, { x, y });
    });
  };
  const onScale = (e: React.PointerEvent) => {
    if (!selHit) return;
    const hit = selHit;
    const start = transformOf(hit);
    const d0 = Math.hypot(toFrame(e).x - hit.box.cx, toFrame(e).y - hit.box.cy) || 1;
    drag(e, (now) =>
      setTransform(hit, {
        scale: clamp((start.scale * Math.hypot(now.x - hit.box.cx, now.y - hit.box.cy)) / d0, 0.05, 20),
      }),
    );
  };
  const onRotate = (e: React.PointerEvent) => {
    if (!selHit) return;
    const hit = selHit;
    drag(e, (now) => {
      let deg = (Math.atan2(now.y - hit.box.cy, now.x - hit.box.cx) * 180) / Math.PI + 90;
      const snap = Math.round(deg / 45) * 45;
      if (Math.abs(deg - snap) < 4) deg = snap;
      setTransform(hit, { rotation: Math.round(deg * 10) / 10 });
    });
  };

  const total = projectDuration(project);
  const step = (frames: number) => {
    playback.pause();
    playback.seek(Math.round(playback.time * project.fps + frames) / project.fps);
  };

  return (
    <section className="stage-panel" id="stage-panel">
      <div className="stage-area" ref={areaRef}>
        <div className="stage-frame-wrap" style={{ width: W * fit, height: H * fit }} onPointerDown={onDown}>
          <div className="stage-frame" ref={frameRef} style={{ width: W, height: H, transform: `scale(${fit})` }}>
            {/* Text under a video layer lives inside the media host (an isolated stacking context), so it can sit between the clips. */}
            <div ref={hostRef} className="stage-host">
              {textBands(project)
                .filter((b) => b.below >= 0)
                .map((b) => (
                  <canvas
                    key={b.below}
                    ref={(el) => void (el ? bandCanvases.current.set(b.below, el) : bandCanvases.current.delete(b.below))}
                    className="stage-canvas"
                    // just under the clips of the video layer it sits below (see the media z-index in syncMedia)
                    style={{ zIndex: (project.tracks.length - b.below) * 1000 - 1 }}
                  />
                ))}
            </div>
            <canvas ref={canvasRef} className="stage-canvas" />
            {(() => {
              const wm = project.watermark;
              const a = wm && project.assets.find((x) => x.id === wm.assetId);
              if (!wm || !a) return null;
              // the brand's intro and outro cards show the logo big; the corner one steps aside (as in the export)
              if (brandCardRanges(project).some(([s, e]) => t >= s && t < e)) return null;
              const r = watermarkRect(W, H, a, wm);
              return (
                <img
                  className="stage-watermark"
                  src={assetUrl(project.id, a)}
                  alt=""
                  draggable={false}
                  style={{
                    left: r.x,
                    top: r.y,
                    width: r.w,
                    height: r.h,
                    opacity: wm.opacity,
                  }}
                />
              );
            })()}
          </div>
          {previewAs && <SafeZones W={W} H={H} fit={fit} presetId={previewAs} />}
          <DrawLayer W={W} H={H} fit={fit} />
          {guides.v && <div className="guide guide-v" />}
          {guides.h && <div className="guide guide-h" />}
          {selHit && (
            <div
              className="sel-box"
              style={{
                width: selHit.box.w * fit,
                height: selHit.box.h * fit,
                left: (selHit.box.cx - selHit.box.w / 2) * fit,
                top: (selHit.box.cy - selHit.box.h / 2) * fit,
                transform: `rotate(${selHit.box.rotation}deg)`,
              }}
            >
              {['tl', 'tr', 'bl', 'br'].map((c) => (
                <span key={c} className={`handle handle-${c}`} onPointerDown={onScale} />
              ))}
              {selHit.track.kind !== 'caption' && <span className="handle handle-rot" onPointerDown={onRotate} />}
            </div>
          )}
          {total === 0 && (
            <div className="stage-empty">
              <strong>{tr('emptyTitle')}</strong>
              <span>{tr('emptyBody')}</span>
            </div>
          )}
        </div>
        {total > 0 && (
          <div className={`stage-hud${playing ? '' : ' paused'}`} dir="ltr">
            <button className="hud-play" onClick={() => playback.toggle()} aria-label={tr('scPlay')} title={`${tr('scPlay')} (Space)`}>
              {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
            </button>
            <VolumeControl />
          </div>
        )}
      </div>
      <div className="transport" dir="ltr">
        <span className="timecode">{timecode(t, project.fps)}</span>
        <div className="transport-buttons">
          <button className="icon-btn" onClick={() => playback.seek(0)} aria-label="Start">
            <ChevronFirst size={20} />
          </button>
          <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous frame">
            <StepBack size={18} />
          </button>
          <button className="play-btn" onClick={() => playback.toggle()} aria-label={tr('scPlay')}>
            {playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
          </button>
          <button className="icon-btn" onClick={() => step(1)} aria-label="Next frame">
            <StepForward size={18} />
          </button>
          <button
            className={`icon-btn draw-btn${drawing ? ' active' : ''}`}
            onClick={() => {
              const on = !useStore.getState().drawing;
              useStore.getState().set({ drawing: on, ...(on ? { leftTab: 'agent' } : {}) });
              if (on) playback.pause();
            }}
            aria-pressed={drawing}
            title={tr('drawHint')}
            aria-label={tr('draw')}
          >
            <PenLine size={17} />
          </button>
          <button className="icon-btn kf-stage" onClick={() => actions.toggleKeyframe()} title={tr('keyframe') + ' (K)'} aria-label={tr('keyframe')}>
            <Diamond size={17} />
          </button>
          <button className="icon-btn" onClick={() => playback.seek(total)} aria-label="End">
            <ChevronLast size={20} />
          </button>
        </div>
        <div className="transport-end">
          <VolumeControl compact />
          <span className="timecode muted">
            {timecode(total, project.fps)} · {W}×{H} · {project.fps}fps
          </span>
          <button className="icon-btn fs-btn" onClick={() => actions.toggleFullscreen()} title={`${fullscreen ? tr('exitFullscreen') : tr('fullscreen')} (F)`} aria-label={fullscreen ? tr('exitFullscreen') : tr('fullscreen')}>
            {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
          <label className="preview-as" title={tr('previewAsHint')}>
            <select value={previewAs} onChange={(e) => setPreviewAs(e.target.value)} aria-label={tr('previewAs')}>
              <option value="">{tr('previewAs')}</option>
              {EXPORT_PRESETS.filter((p) => p.safe || Math.abs(p.width / p.height - W / H) > 0.01).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </section>
  );
}
