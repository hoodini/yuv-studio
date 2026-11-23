// Small pictures that say what a button does: how a clip sits in the frame, and the layouts.
// Drawn as 18px line icons in currentColor, like the lucide icons around them.
import type { SVGProps } from 'react';

const base = (p: SVGProps<SVGSVGElement>) => ({ width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...p });

/** The whole picture inside the frame, with bars where it does not reach. */
export const IconFit = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
    <rect x="6.5" y="7.5" width="11" height="9" rx="1.2" fill="currentColor" fillOpacity="0.35" />
  </svg>
);

/** The picture covers the frame and spills out past its edges. */
export const IconFill = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="1" y="2" width="22" height="20" rx="2" strokeDasharray="2.4 2.4" strokeOpacity="0.6" />
    <rect x="4" y="5.5" width="16" height="13" rx="2" fill="currentColor" fillOpacity="0.35" />
  </svg>
);

/** Back to the middle of the frame. */
export const IconCenter = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
    <path d="M12 8v8M8 12h8" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" />
  </svg>
);

/** Layouts, drawn as the frame with its parts. */
export const LayoutIcon = ({ id, ...p }: { id: string } & SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
    {id === 'stack' && <path d="M2.5 12h19" />}
    {id === 'side' && <path d="M12 4.5v15" />}
    {id === 'pip' && <rect x="13" y="11.5" width="6.5" height="5.5" rx="1" fill="currentColor" fillOpacity="0.5" />}
    {id === 'single' && <rect x="5" y="7" width="14" height="10" rx="1.2" fill="currentColor" fillOpacity="0.25" stroke="none" />}
  </svg>
);
