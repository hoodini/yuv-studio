// The editor's layout: how wide the side panels are, how tall the timeline is, and which of them are collapsed.
// Saved in this browser, so the editor opens the way it was left.
import { create } from 'zustand';

export interface Layout {
  leftW: number;
  rightW: number;
  tlH: number;
  leftOpen: boolean;
  rightOpen: boolean;
  tlOpen: boolean;
}
const KEY = 'studio.layout';
const DEFAULTS: Layout = { leftW: 340, rightW: 330, tlH: 330, leftOpen: true, rightOpen: true, tlOpen: true };

function load(): Layout {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export const LIMITS = { side: [240, 720] as const, tl: [150, 900] as const };
export const clampTo = (v: number, [a, b]: readonly [number, number]) => Math.max(a, Math.min(b, v));

export const useLayout = create<Layout & { setLayout: (p: Partial<Layout>) => void; reset: () => void }>((set, get) => ({
  ...load(),
  setLayout: (p) => {
    set(p);
    const { setLayout: _a, reset: _b, ...rest } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify(rest));
    } catch {}
  },
  reset: () => get().setLayout({ ...DEFAULTS }),
}));
