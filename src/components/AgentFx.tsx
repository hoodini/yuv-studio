import { useEffect, useRef, useState } from 'react';
import { describe, targetOf, useAgentFx } from '../agentFx';
import { useT } from '../i18n';

/**
 * The AI at work, made visible: the editor gets a living glow around the frame, and a cursor with a label flies to
 * the part of the editor each step changes (a clip, the captions, the frame, the export button) and "clicks" it.
 * The work itself happens through the studio's tools; this only shows it.
 */
export function AgentFx() {
  const { active, current, seq, source } = useAgentFx();
  const { isHe } = useT();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [click, setClick] = useState(0);
  const lastEl = useRef<Element | null>(null);
  const shown = useRef(false);

  useEffect(() => {
    document.body.classList.toggle('agent-on', active);
    return () => document.body.classList.remove('agent-on');
  }, [active]);

  useEffect(() => {
    if (!active) {
      shown.current = false;
      setPos(null);
      lastEl.current?.classList.remove('agent-target');
      lastEl.current = null;
      return;
    }
    // Wait a frame so a tab or clip that just appeared has its place on screen.
    const id = requestAnimationFrame(() => {
      const t = targetOf(current, seq);
      if (!t) return;
      // First appearance: start from the agent's corner (the chat side), then fly on the next frame.
      const fly = setTimeout(() => setPos({ x: t.x, y: t.y }), shown.current ? 0 : 60);
      if (!shown.current) {
        shown.current = true;
        setPos({ x: isHe ? window.innerWidth - 120 : 120, y: window.innerHeight * 0.55 });
      }
      lastEl.current?.classList.remove('agent-target');
      lastEl.current = t.el;
      const arrive = setTimeout(() => {
        t.el.classList.add('agent-target');
        setClick((c) => c + 1);
      }, 650);
      const leave = setTimeout(() => t.el.classList.remove('agent-target'), 2200);
      cleanup.current = () => (clearTimeout(fly), clearTimeout(arrive), clearTimeout(leave));
    });
    return () => {
      cancelAnimationFrame(id);
      cleanup.current?.();
    };
  }, [active, seq, current, isHe]);
  const cleanup = useRef<(() => void) | null>(null);

  if (!active || !pos) return null;
  const who = source === 'agent' ? (isHe ? 'הסוכן' : 'Agent') : 'AI';
  return (
    <div className="agent-fx">
      <div className="agent-cursor" aria-hidden="true" style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>
        <span key={click} className="agent-ripple" />
        <svg className="agent-arrow" width="26" height="30" viewBox="0 0 26 30">
          <defs>
            <linearGradient id="agentArrowGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#5DE1EE" />
              <stop offset="1" stopColor="#7A6BFF" />
            </linearGradient>
          </defs>
          <path d="M2 2 L2 24 L8 18.5 L12.5 28 L16.5 26.2 L12 17 L20.5 17 Z" fill="url(#agentArrowGrad)" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
        <span className="agent-label" dir="auto">
          <b>{who}</b> {describe(current, isHe)}
        </span>
      </div>
      <div className="agent-status" dir="auto" role="status">
        <span className="agent-dot" />
        {who} · {describe(current, isHe)}
      </div>
    </div>
  );
}
