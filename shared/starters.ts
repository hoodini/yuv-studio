// Ready-made starting points for the videos people make most: the canvas, the layers, the caption look and a few
// placeholder titles in place. With a brand kit they come out in the brand's colours, fonts and logo.
import { addTextClip, addTrack, applyLayout, setCaptionPreset } from './ops';
import type { Project } from './types';

export interface Starter {
  id: string;
  label: string;
  labelHe: string;
  hint: string;
  hintHe: string;
  width: number;
  height: number;
  layout?: string;
  caption: { preset: string; y: number };
  titles: { preset: string; text: string; textHe: string; start: number; duration: number; x?: number; y?: number; scale?: number }[];
}

export const STARTERS: Starter[] = [
  {
    id: 'youtube',
    label: 'YouTube video',
    labelHe: 'סרטון יוטיוב',
    hint: 'Talking head, captions, a name card',
    hintHe: 'מדבר למצלמה, כתוביות, כרטיס שם',
    width: 1920,
    height: 1080,
    caption: { preset: 'glass', y: 0.86 },
    titles: [{ preset: 'lower-third', text: 'Your name · What you do', textHe: 'השם שלך · מה אתה עושה', start: 0.6, duration: 4.5, y: 0.8 }],
  },
  {
    id: 'reel',
    label: 'Reel · Short · TikTok',
    labelHe: 'רילס · שורטס · טיקטוק',
    hint: 'A hook on top, big captions clear of the app buttons',
    hintHe: 'הוק למעלה, כתוביות גדולות מחוץ לכפתורים של האפליקציה',
    width: 1080,
    height: 1920,
    caption: { preset: 'bold', y: 0.64 },
    titles: [{ preset: 'display', text: 'The hook goes here', textHe: 'כאן ההוק', start: 0, duration: 3, y: 0.2 }],
  },
  {
    id: 'podcast',
    label: 'Podcast clip',
    labelHe: 'קליפ מפודקאסט',
    hint: 'Two speakers one above the other, captions between them',
    hintHe: 'שני דוברים אחד מעל השני, כתוביות ביניהם',
    width: 1080,
    height: 1920,
    layout: 'stack',
    caption: { preset: 'night', y: 0.5 },
    titles: [
      { preset: 'kicker', text: 'Host', textHe: 'מנחה', start: 0, duration: 4, y: 0.06, scale: 1.7 },
      { preset: 'kicker', text: 'Guest', textHe: 'אורח', start: 0, duration: 4, y: 0.56, scale: 1.7 },
    ],
  },
  {
    id: 'tutorial',
    label: 'Tutorial',
    labelHe: 'מדריך',
    hint: 'Screen recording with your face in the corner',
    hintHe: 'הקלטת מסך עם הפנים שלך בפינה',
    width: 1920,
    height: 1080,
    layout: 'pip',
    caption: { preset: 'clean', y: 0.9 },
    titles: [{ preset: 'kicker', text: 'Step 1', textHe: 'שלב 1', start: 0, duration: 3, x: 0.12, y: 0.08, scale: 1.3 }],
  },
  {
    id: 'feed',
    label: 'Feed post',
    labelHe: 'פוסט לפיד',
    hint: '4:5 for Instagram and LinkedIn, a key line on top',
    hintHe: '4:5 לאינסטגרם ולינקדאין, שורת מפתח למעלה',
    width: 1080,
    height: 1350,
    caption: { preset: 'marker', y: 0.82 },
    titles: [{ preset: 'marker-title', text: 'The key point', textHe: 'הנקודה החשובה', start: 0, duration: 4, y: 0.14 }],
  },
];

/** Lay a starter out on a new, empty project (in the brand's look when p.brand is set). */
export function applyStarter(p: Project, id: string, lang: 'he' | 'en' = 'en') {
  const s = STARTERS.find((x) => x.id === id);
  if (!s) throw Object.assign(new Error(`Unknown starter "${id}". Starters: ${STARTERS.map((x) => x.id).join(', ')}`), { status: 400 });
  p.width = s.width;
  p.height = s.height;
  p.sizeLocked = true;
  if (s.layout) applyLayout(p, s.layout);
  const cap = addTrack(p, 'caption');
  // a brand's own caption look wins over the starter's suggestion
  setCaptionPreset(p, cap.id, p.brand?.captionPreset || s.caption.preset);
  cap.transform = { ...cap.transform!, y: s.caption.y };
  // titles at the same time get layers of their own (addTextClip finds or adds a free one)
  for (const t of s.titles) addTextClip(p, { text: lang === 'he' ? t.textHe : t.text, preset: t.preset, start: t.start, duration: t.duration, transform: { x: t.x ?? 0.5, y: t.y ?? 0.5, scale: t.scale ?? 1 } });
  return s;
}
