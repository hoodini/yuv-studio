// Draw on the frame for the AI agent: circle what you mean, or draw a line to where it should go. The strokes are kept
// in fractions of the frame with the moment they were drawn at, and go to the agent with the next message.
import { useRef } from 'react';
import { playback } from '../playback';
import { useStore } from '../store';

/** Keep a stroke light: drop points closer than ~0.4% of the frame to the last kept one, at most 200 points. */
function simplify(pts: { x: number; y: number }[]) {
  const out: { x: number; y: number }[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 0.004) out.push(p);
  }
  const last = pts[pts.length - 1];
  if (last && out[out.length - 1] !== last) out.push(last);
  if (out.length <= 200) return out;
  const k = out.length / 200;
  return Array.from({ length: 200 }, (_, i) => out[Math.min(out.length - 1, Math.round(i * k))]);
}

const path = (s: { x: number; y: number }[], W: number, H: number) => s.map((p, i) => `${i ? 'L' : 'M'}${(p.x * W).toFixed(1)} ${(p.y * H).toFixed(1)}`).join(' ');

/** The strokes over the stage; while the pen is on, it takes the pointer (no selecting or moving clips). */
export function DrawLayer({ W, H, fit }: { W: number; H: number; fit: number }) {
  const drawing = useStore((s) => s.drawing);
  const marks = useStore((s) => s.marks);
  const live = useRef<{ x: number; y: number }[] | null>(null);
  const liveEl = useRef<SVGPathElement>(null);
  if (!drawing && !marks) return null;

  const at = (e: React.PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing) return;
    e.stopPropagation();
    e.preventDefault();
    playback.pause();
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {}
    live.current = [at(e)];
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!live.current) return;
    live.current.push(at(e));
    liveEl.current?.setAttribute('d', path(live.current, W * fit, H * fit));
  };
  const up = () => {
    const s = live.current;
    live.current = null;
    liveEl.current?.setAttribute('d', '');
    if (!s || s.length < 2) return;
    const { marks: cur } = useStore.getState();
    // A drawing belongs to one moment: strokes at another moment start a new drawing.
    const t = playback.time;
    const keep = cur && Math.abs(cur.t - t) < 1e-3 ? cur.strokes : [];
    useStore.setState({ marks: { t, strokes: [...keep, simplify(s)].slice(-12) } });
  };

  const w = W * fit;
  const h = H * fit;
  return (
    <svg
      className={`draw-layer${drawing ? ' on' : ''}`}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      aria-hidden={!drawing}
      aria-label={drawing ? 'Draw on the frame' : undefined}
    >
      {marks?.strokes.map((s, i) => (
        <g key={i}>
          <path d={path(s, w, h)} className="draw-shadow" />
          <path d={path(s, w, h)} className="draw-stroke" />
        </g>
      ))}
      <path ref={liveEl} className="draw-stroke" />
    </svg>
  );
}
