import { useEffect, useRef } from 'react';
import { mountLiquid } from '../liquid';
import { useStore } from '../store';

/** The living background of the editor: the studio backdrop, drawn by one small shader behind every panel. */
export function LiquidSky() {
  const ref = useRef<HTMLCanvasElement>(null);
  const lang = useStore((s) => s.lang);
  const live = useRef<ReturnType<typeof mountLiquid> | null>(null);
  useEffect(() => {
    // Half resolution: it is soft light, and the GPU stays free for the video.
    live.current = mountLiquid(ref.current!, { scale: 0.5, glass: 0.8, focus: [0, 0.05, 0.9] });
    return () => live.current?.destroy();
  }, []);
  useEffect(() => {
    live.current?.set({ side: lang === 'he' ? -1 : 1 });
  }, [lang]);
  return <canvas ref={ref} className="liquid-sky" aria-hidden="true" />;
}
