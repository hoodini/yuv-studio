// A picture of what the stage shows right now, with the user's drawing on it, for the AI agent to look at. Drawn from
// the stage's own media elements and text canvases in their stacking order, so it matches the preview (rotation of a
// clip is approximated by its bounding box).
import type { Marks } from './store';

/** Set by the Stage while it is mounted: the frame element and which clips sit under a set of strokes. */
export const stage: {
  frame?: HTMLElement | null;
  hits?: (marks: Marks) => string[];
} = {};

export async function captureFrame(marks: Marks, maxSide = 1024): Promise<{ image: string | null; items: string[] }> {
  const frame = stage.frame;
  const items = stage.hits?.(marks) || [];
  if (!frame) return { image: null, items };
  try {
    const fr = frame.getBoundingClientRect();
    // the long side at maxSide, whatever the stage's size on screen
    const k = maxSide / Math.max(fr.width, fr.height);
    const W = Math.round(fr.width * k);
    const H = Math.round(fr.height * k);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const els = [...frame.querySelectorAll<HTMLElement>('video, img, canvas')].filter((el) => {
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.01;
    });
    // stacking order: z-index first (media and text bands carry one), then document order
    const z = (el: HTMLElement) => Number(getComputedStyle(el).zIndex) || 0;
    const inHost = (el: HTMLElement) => (el.closest('.stage-host') ? 0 : 1);
    els
      .map((el, i) => ({ el, i }))
      .sort((a, b) => inHost(a.el) - inHost(b.el) || z(a.el) - z(b.el) || a.i - b.i)
      .forEach(({ el }) => {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        if (el instanceof HTMLVideoElement && el.readyState < 2) return;
        if (el instanceof HTMLImageElement && !el.complete) return;
        g.globalAlpha = Math.min(1, Number(getComputedStyle(el).opacity) || 1);
        try {
          g.drawImage(el as CanvasImageSource, ((r.left - fr.left) / fr.width) * W, ((r.top - fr.top) / fr.height) * H, (r.width / fr.width) * W, (r.height / fr.height) * H);
        } catch {}
      });
    g.globalAlpha = 1;
    // the strokes, as the user saw them
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const [width, color] of [
      [Math.max(6, W / 110), 'rgba(0,0,0,.55)'],
      [Math.max(3, W / 240), '#5DE1EE'],
    ] as const) {
      g.lineWidth = width;
      g.strokeStyle = color;
      for (const s of marks.strokes) {
        g.beginPath();
        s.forEach((p, i) => (i ? g.lineTo(p.x * W, p.y * H) : g.moveTo(p.x * W, p.y * H)));
        g.stroke();
      }
    }
    return { image: c.toDataURL('image/jpeg', 0.82), items };
  } catch {
    // a tainted canvas or a browser without canvas export: the agent still gets the drawing in words
    return { image: null, items };
  }
}
