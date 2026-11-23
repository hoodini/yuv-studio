import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { useRef } from 'react';
import { useT } from '../i18n';
import { LIMITS, clampTo, useLayout } from '../layout';

const COLLAPSE_AT = 170;
const TL_COLLAPSE_AT = 110;

/**
 * The bar between a side panel and the stage: drag to resize, click the round button (or double-click the bar)
 * to collapse or bring back the panel. `side` is the panel's side in reading order: 'start' is the library,
 * 'end' the inspector, so it works the same in Hebrew (right to left) and English.
 */
export function SideSplitter({ side }: { side: 'start' | 'end' }) {
  const { isHe, t } = useT();
  const open = useLayout((s) => (side === 'start' ? s.leftOpen : s.rightOpen));
  const setLayout = useLayout((s) => s.setLayout);
  const dragging = useRef(false);
  const keyW = side === 'start' ? 'leftW' : 'rightW';
  const keyOpen = side === 'start' ? 'leftOpen' : 'rightOpen';
  const toggle = () => setLayout({ [keyOpen]: !open } as any);
  const widthAt = (x: number, ws: DOMRect) => {
    // Distance from the panel's outer edge to the pointer, in the direction the panel grows.
    const fromLeft = x - ws.left - 6;
    const fromRight = ws.right - x - 6;
    const startIsLeft = !isHe;
    return side === 'start' ? (startIsLeft ? fromLeft : fromRight) : startIsLeft ? fromRight : fromLeft;
  };
  // Which way the arrow points: towards the panel to collapse it, away from it to bring it back.
  const panelOnLeft = (side === 'start') !== isHe;
  const Arrow = open === panelOnLeft ? ChevronLeft : ChevronRight;
  const label = open ? (side === 'start' ? t('hideLibrary') : t('hideInspector')) : side === 'start' ? t('showLibrary') : t('showInspector');
  return (
    <div
      className={`splitter splitter-v${open ? '' : ' closed'}`}
      role="separator"
      aria-orientation="vertical"
      tabIndex={0}
      title={t('dragToResize')}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        dragging.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        document.body.classList.add('resizing-x');
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const ws = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
        const w = widthAt(e.clientX, ws);
        if (w < COLLAPSE_AT) setLayout({ [keyOpen]: false } as any);
        else setLayout({ [keyOpen]: true, [keyW]: clampTo(w, LIMITS.side) } as any);
      }}
      onPointerUp={() => {
        dragging.current = false;
        document.body.classList.remove('resizing-x');
      }}
      onDoubleClick={toggle}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        const cur = useLayout.getState()[keyW];
        const grow = (e.key === 'ArrowRight') === panelOnLeft ? 1 : -1;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') (e.preventDefault(), setLayout({ [keyOpen]: true, [keyW]: clampTo(cur + grow * step, LIMITS.side) } as any));
        if (e.key === 'Enter' || e.key === ' ') (e.preventDefault(), toggle());
      }}
    >
      <span className="splitter-grip" aria-hidden />
      <button className="splitter-btn" onClick={toggle} title={label} aria-label={label} aria-expanded={open}>
        <Arrow size={14} />
      </button>
    </div>
  );
}

/** The bar above the timeline: drag up or down to make the timeline taller or shorter, or collapse it. */
export function TimelineSplitter() {
  const { t } = useT();
  const open = useLayout((s) => s.tlOpen);
  const setLayout = useLayout((s) => s.setLayout);
  const dragging = useRef(false);
  const toggle = () => setLayout({ tlOpen: !open });
  const label = open ? t('hideTimeline') : t('showTimeline');
  return (
    <div
      className={`splitter splitter-h${open ? '' : ' closed'}`}
      role="separator"
      aria-orientation="horizontal"
      tabIndex={0}
      title={t('dragToResize')}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        dragging.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        document.body.classList.add('resizing-y');
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const app = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
        const h = app.bottom - 16 - e.clientY - 6;
        if (h < TL_COLLAPSE_AT) setLayout({ tlOpen: false });
        else setLayout({ tlOpen: true, tlH: clampTo(h, LIMITS.tl) });
      }}
      onPointerUp={() => {
        dragging.current = false;
        document.body.classList.remove('resizing-y');
      }}
      onDoubleClick={toggle}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        const cur = useLayout.getState().tlH;
        if (e.key === 'ArrowUp') (e.preventDefault(), setLayout({ tlOpen: true, tlH: clampTo(cur + step, LIMITS.tl) }));
        if (e.key === 'ArrowDown') (e.preventDefault(), setLayout({ tlH: clampTo(cur - step, LIMITS.tl) }));
        if (e.key === 'Enter' || e.key === ' ') (e.preventDefault(), toggle());
      }}
    >
      <span className="splitter-grip" aria-hidden />
      <button className="splitter-btn" onClick={toggle} title={label} aria-label={label} aria-expanded={open}>
        {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        {!open && <span>{t('timeline')}</span>}
      </button>
    </div>
  );
}
