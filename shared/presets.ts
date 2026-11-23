import type { Fx, TextStyle, Transition, TransitionType } from './types';

export const SPECTRUM = ['#FCB54C', '#FB9550', '#F25E56', '#DA3969', '#904B9D', '#4D6BAB', '#68A2BC'];

/** Fonts bundled with the studio. Imported and uploaded fonts are added to this list at run time (GET /api/fonts). */
export const FONTS = [
  { family: 'Assistant', label: 'Assistant · עברית/EN' },
  { family: 'Karantina', label: 'Karantina · כותרות' },
  { family: 'Anton', label: 'Anton · DISPLAY' },
  { family: 'Inter', label: 'Inter' },
  { family: 'JetBrains Mono', label: 'JetBrains Mono' },
  { family: 'Press Start 2P', label: 'Press Start 2P' },
];

export const baseStyle: TextStyle = {
  fontFamily: 'Assistant',
  fontWeight: 800,
  fontSize: 64,
  color: '#FFFFFF',
  align: 'center',
  lineHeight: 1.2,
  uppercase: false,
  maxWidth: 0.84,
  strokeColor: '#000000',
  strokeWidth: 0,
  shadowColor: 'rgba(10,10,40,.55)',
  shadowBlur: 18,
  shadowY: 4,
  bgColor: '',
  bgPadX: 28,
  bgPadY: 14,
  bgRadius: 26,
  highlight: 'none',
  highlightColor: '#FCB54C',
  highlightTextColor: '#1C1A4B',
  animIn: 'none',
  animOut: 'none',
  animDuration: 0.25,
};

const s = (o: Partial<TextStyle>): TextStyle => ({ ...baseStyle, ...o });

export interface StylePreset {
  id: string;
  label: string;
  labelHe: string;
  style: TextStyle;
}

/** Caption looks. `highlight` drives the karaoke effect from the word timings. */
export const CAPTION_PRESETS: StylePreset[] = [
  { id: 'clean', label: 'Clean', labelHe: 'נקי', style: s({ fontSize: 60 }) },
  {
    id: 'glass',
    label: 'Glass pill',
    labelHe: 'זכוכית',
    style: s({ color: '#1C1A4B', bgColor: 'rgba(255,255,255,.92)', shadowColor: 'rgba(40,70,140,.28)', shadowBlur: 34, shadowY: 12, fontSize: 56, bgRadius: 999, bgPadX: 40, bgPadY: 16, highlight: 'color', highlightTextColor: '#DA3969' }),
  },
  {
    id: 'marker',
    label: 'Gold marker',
    labelHe: 'מרקר זהב',
    style: s({ fontSize: 64, highlight: 'box', highlightColor: '#FDB45A', highlightTextColor: '#1C1A4B', shadowBlur: 22 }),
  },
  {
    id: 'bold',
    label: 'Bold stroke',
    labelHe: 'מודגש',
    style: s({ fontFamily: 'Karantina', fontWeight: 700, fontSize: 104, strokeColor: '#14123A', strokeWidth: 10, shadowBlur: 0, shadowY: 6, shadowColor: 'rgba(0,0,0,.5)', highlight: 'color', highlightTextColor: '#FFD66E', lineHeight: 1 }),
  },
  {
    id: 'impact',
    label: 'IMPACT',
    labelHe: 'אימפקט',
    style: s({ fontFamily: 'Anton', fontWeight: 400, fontSize: 84, uppercase: true, strokeColor: '#000000', strokeWidth: 8, shadowBlur: 0, shadowY: 0, highlight: 'color', highlightTextColor: '#FCB54C', lineHeight: 1.12 }),
  },
  {
    id: 'spectrum',
    label: 'Phoenix',
    labelHe: 'פניקס',
    style: s({ fontSize: 66, fontWeight: 800, color: '#1C1A4B', bgColor: 'rgba(255,255,255,.94)', bgRadius: 30, shadowColor: 'rgba(40,70,140,.3)', shadowBlur: 40, shadowY: 14, highlight: 'box', highlightColor: '#DA3969', highlightTextColor: '#FFFFFF' }),
  },
  {
    id: 'reveal',
    label: 'Word by word',
    labelHe: 'מילה-מילה',
    style: s({ fontSize: 68, highlight: 'reveal', strokeColor: '#14123A', strokeWidth: 6 }),
  },
  {
    id: 'night',
    label: 'Night box',
    labelHe: 'קופסה כהה',
    style: s({ fontSize: 52, fontWeight: 700, bgColor: 'rgba(14,13,42,.86)', bgRadius: 26, shadowBlur: 0, shadowY: 0, highlight: 'color', highlightTextColor: '#FFD66E' }),
  },
  {
    id: 'mono',
    label: 'Terminal',
    labelHe: 'טרמינל',
    style: s({ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 46, color: '#FFD66E', bgColor: 'rgba(14,13,42,.9)', bgRadius: 26, shadowBlur: 0, shadowY: 0, highlight: 'color', highlightTextColor: '#FFFFFF' }),
  },
];

/** Titles and free text. */
export const TITLE_PRESETS: (StylePreset & { sample: string; sampleHe: string; y?: number })[] = [
  { id: 'title', label: 'Big title', labelHe: 'כותרת גדולה', sample: 'BIG TITLE', sampleHe: 'כותרת גדולה', style: s({ fontFamily: 'Karantina', fontWeight: 700, fontSize: 190, lineHeight: 0.98, shadowBlur: 30, animIn: 'pop' }) },
  { id: 'display', label: 'Display', labelHe: 'דיספליי', sample: 'LET\'S FLY HIGH', sampleHe: 'LET\'S FLY HIGH', style: s({ fontFamily: 'Anton', fontWeight: 400, fontSize: 150, uppercase: true, lineHeight: 1.04, animIn: 'slide-up' }) },
  { id: 'marker-title', label: 'Marker', labelHe: 'מרקר', sample: 'Key point', sampleHe: 'הנקודה החשובה', style: s({ fontFamily: 'Karantina', fontWeight: 700, fontSize: 150, color: '#1C1A4B', bgColor: '#FDB45A', bgRadius: 18, bgPadX: 30, bgPadY: 4, shadowBlur: 0, shadowY: 0, lineHeight: 1, animIn: 'pop' }) },
  { id: 'spectrum-title', label: 'Spectrum', labelHe: 'ספקטרום', sample: 'YUV.AI', sampleHe: 'YUV.AI', style: s({ fontFamily: 'Anton', fontWeight: 400, fontSize: 170, gradient: SPECTRUM, shadowBlur: 26, shadowColor: 'rgba(40,70,140,.35)', animIn: 'fade' }) },
  { id: 'lower-third', label: 'Lower third', labelHe: 'כתובית שם', sample: 'Name · Title', sampleHe: 'שם · תפקיד', y: 0.82, style: s({ fontSize: 50, fontWeight: 700, color: '#1C1A4B', bgColor: 'rgba(255,255,255,.92)', bgRadius: 999, bgPadX: 44, bgPadY: 18, shadowColor: 'rgba(40,70,140,.3)', shadowBlur: 40, shadowY: 14, animIn: 'slide-up', animOut: 'fade' }) },
  { id: 'kicker', label: 'Kicker', labelHe: 'קיקר', sample: 'ON AIR · EP 01', sampleHe: 'ON AIR · EP 01', y: 0.12, style: s({ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 36, uppercase: true, bgColor: 'rgba(14,13,42,.82)', bgRadius: 999, bgPadX: 30, bgPadY: 12, shadowBlur: 0, shadowY: 0, animIn: 'typewriter' }) },
  { id: 'subtitle', label: 'Subtitle', labelHe: 'כותרת משנה', sample: 'A short supporting line', sampleHe: 'שורת הסבר קצרה', style: s({ fontSize: 58, fontWeight: 600, animIn: 'fade' }) },
  { id: 'cta', label: 'Button', labelHe: 'כפתור', sample: 'Follow for more', sampleHe: 'עקבו לעוד', y: 0.8, style: s({ fontSize: 56, fontWeight: 800, bgColor: '#FF2EA0', bgRadius: 999, bgPadX: 60, bgPadY: 24, shadowColor: 'rgba(218,57,105,.5)', shadowBlur: 46, shadowY: 12, animIn: 'pop' }) },
  { id: 'pixel', label: 'Pixel', labelHe: 'פיקסל', sample: 'PRESS START', sampleHe: 'PRESS START', style: s({ fontFamily: 'Press Start 2P', fontWeight: 400, fontSize: 60, gradient: SPECTRUM, shadowBlur: 0, shadowY: 6, shadowColor: '#1C1A4B', animIn: 'typewriter' }) },
];

export const TRANSITIONS: { id: TransitionType; label: string; labelHe: string }[] = [
  { id: 'none', label: 'None', labelHe: 'ללא' },
  { id: 'fade', label: 'Fade', labelHe: 'דהייה' },
  { id: 'dip', label: 'Dip to black', labelHe: 'דרך שחור' },
  { id: 'flash', label: 'White flash', labelHe: 'הבזק לבן' },
  { id: 'blur', label: 'Blur', labelHe: 'טשטוש' },
  { id: 'zoom', label: 'Zoom in', labelHe: 'זום פנימה' },
  { id: 'zoom-out', label: 'Zoom out (punch)', labelHe: 'זום החוצה' },
  { id: 'spin', label: 'Spin', labelHe: 'סיבוב' },
  { id: 'slide-left', label: 'Slide ←', labelHe: 'החלקה ←' },
  { id: 'slide-right', label: 'Slide →', labelHe: 'החלקה →' },
  { id: 'slide-up', label: 'Slide ↑', labelHe: 'החלקה ↑' },
  { id: 'slide-down', label: 'Slide ↓', labelHe: 'החלקה ↓' },
  { id: 'wipe-left', label: 'Wipe ←', labelHe: 'ניגוב ←' },
  { id: 'wipe-right', label: 'Wipe →', labelHe: 'ניגוב →' },
  { id: 'wipe-up', label: 'Wipe ↑', labelHe: 'ניגוב ↑' },
  { id: 'wipe-down', label: 'Wipe ↓', labelHe: 'ניגוב ↓' },
];

export const noTransition = (): Transition => ({ type: 'none', duration: 0.4 });
export const neutralFx = (): Fx => ({ brightness: 1, contrast: 1, saturation: 1, blur: 0 });

export const FX_PRESETS: { id: string; label: string; labelHe: string; fx: Fx }[] = [
  { id: 'none', label: 'Original', labelHe: 'מקור', fx: neutralFx() },
  { id: 'vivid', label: 'Vivid', labelHe: 'חי', fx: { brightness: 1.04, contrast: 1.12, saturation: 1.35, blur: 0 } },
  { id: 'cinema', label: 'Cinematic', labelHe: 'קולנועי', fx: { brightness: 0.94, contrast: 1.22, saturation: 0.85, blur: 0 } },
  { id: 'soft', label: 'Soft', labelHe: 'רך', fx: { brightness: 1.08, contrast: 0.9, saturation: 0.95, blur: 0 } },
  { id: 'bw', label: 'B&W', labelHe: 'שחור-לבן', fx: { brightness: 1, contrast: 1.15, saturation: 0, blur: 0 } },
  { id: 'fade', label: 'Faded', labelHe: 'דהוי', fx: { brightness: 1.1, contrast: 0.82, saturation: 0.7, blur: 0 } },
  { id: 'blur', label: 'Blur (backdrop)', labelHe: 'טשטוש (רקע)', fx: { brightness: 0.85, contrast: 1, saturation: 1.1, blur: 24 } },
];

/** Synthesised with ffmpeg on first run (server/sfx.ts). */
export type SfxGroup = 'move' | 'hit' | 'ui' | 'tone';
export const SFX_GROUPS: { id: SfxGroup; label: string; labelHe: string }[] = [
  { id: 'move', label: 'Movement and transitions', labelHe: 'תנועה ומעברים' },
  { id: 'hit', label: 'Hits and drama', labelHe: 'מכות ודרמה' },
  { id: 'ui', label: 'Interface', labelHe: 'ממשק' },
  { id: 'tone', label: 'Tones', labelHe: 'צלילים' },
];
export const SFX: { id: string; label: string; labelHe: string; group: SfxGroup }[] = [
  { id: 'whoosh', label: 'Whoosh', labelHe: 'ווש', group: 'move' },
  { id: 'swish', label: 'Swish', labelHe: 'סוויש', group: 'move' },
  { id: 'deep-whoosh', label: 'Deep whoosh', labelHe: 'ווש עמוק', group: 'move' },
  { id: 'riser', label: 'Riser', labelHe: 'רייזר', group: 'move' },
  { id: 'suck-in', label: 'Reverse hit', labelHe: 'שאיבה', group: 'move' },
  { id: 'tape-stop', label: 'Tape stop', labelHe: 'עצירת טייפ', group: 'move' },
  { id: 'swell', label: 'Swell', labelHe: 'סוול', group: 'move' },
  { id: 'impact', label: 'Impact', labelHe: 'אימפקט', group: 'hit' },
  { id: 'boom', label: 'Boom', labelHe: 'בום', group: 'hit' },
  { id: 'sub-drop', label: 'Sub drop', labelHe: 'סאב דרופ', group: 'hit' },
  { id: 'thud', label: 'Thud', labelHe: 'חבטה', group: 'hit' },
  { id: 'heartbeat', label: 'Heartbeat', labelHe: 'דופק', group: 'hit' },
  { id: 'glitch', label: 'Glitch', labelHe: 'גליץ׳', group: 'hit' },
  { id: 'zap', label: 'Zap', labelHe: 'זאפ', group: 'hit' },
  { id: 'pop', label: 'Pop', labelHe: 'פופ', group: 'ui' },
  { id: 'bubble', label: 'Bubble', labelHe: 'בועה', group: 'ui' },
  { id: 'click', label: 'Click', labelHe: 'קליק', group: 'ui' },
  { id: 'typing', label: 'Typing', labelHe: 'הקלדה', group: 'ui' },
  { id: 'shutter', label: 'Camera', labelHe: 'מצלמה', group: 'ui' },
  { id: 'notify', label: 'Notification', labelHe: 'התראה', group: 'ui' },
  { id: 'error', label: 'Error', labelHe: 'שגיאה', group: 'ui' },
  { id: 'ding', label: 'Ding', labelHe: 'דינג', group: 'tone' },
  { id: 'chime', label: 'Chime', labelHe: 'צלצול', group: 'tone' },
  { id: 'success', label: 'Success', labelHe: 'הצלחה', group: 'tone' },
  { id: 'coin', label: 'Ka-ching', labelHe: 'קופה', group: 'tone' },
  { id: 'sparkle', label: 'Sparkle', labelHe: 'נצנוץ', group: 'tone' },
];

export const RESOLUTIONS = [
  { id: '16:9', label: '16:9 · 1920×1080', w: 1920, h: 1080 },
  { id: '9:16', label: '9:16 · 1080×1920', w: 1080, h: 1920 },
  { id: '4:5', label: '4:5 · 1080×1350', w: 1080, h: 1350 },
  { id: '1:1', label: '1:1 · 1080×1080', w: 1080, h: 1080 },
  { id: '4k', label: '4K · 3840×2160', w: 3840, h: 2160 },
];
export const FPS_OPTIONS = [24, 25, 30, 50, 60];

/**
 * Layouts for several videos in one frame. slots[0] goes to the top video layer, slots[1] to the one below it;
 * null = the whole frame. A clip put on a layer with a slot is fitted into it.
 */
export const LAYOUTS: { id: string; label: string; labelHe: string; slots: ({ x: number; y: number; w: number; h: number } | null)[] }[] = [
  { id: 'single', label: 'One video', labelHe: 'וידאו אחד', slots: [] },
  { id: 'stack', label: 'One above the other', labelHe: 'אחד מעל השני', slots: [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 }] },
  { id: 'side', label: 'Side by side', labelHe: 'זה לצד זה', slots: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }] },
  { id: 'pip', label: 'Picture in picture', labelHe: 'תמונה בתוך תמונה', slots: [{ x: 0.6, y: 0.62, w: 0.36, h: 0.32 }, null] },
];

/**
 * Export presets for the places a video goes. Size and frame rate are what each platform shows best; when the
 * project has another shape, the export reframes it: `fill` crops the middle, `fit` keeps the whole picture
 * over a blurred copy of itself.
 */
export interface ExportPreset {
  id: string;
  label: string;
  labelHe: string;
  width: number;
  height: number;
  fps: number;
  /** Video bitrate ceiling in Mbit/s, so uploads are not re-compressed harder than needed. */
  maxrate: number;
  /**
   * Edges the platform's own interface covers (buttons, caption, top bar), as fractions of the output frame.
   * Approximate: each app moves them a little between versions and screen sizes.
   */
  safe?: { top: number; bottom: number; left: number; right: number };
}
export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'youtube', label: 'YouTube · 16:9', labelHe: 'יוטיוב · 16:9', width: 1920, height: 1080, fps: 60, maxrate: 16, safe: { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 } },
  { id: 'youtube-4k', label: 'YouTube 4K', labelHe: 'יוטיוב 4K', width: 3840, height: 2160, fps: 60, maxrate: 60 },
  { id: 'shorts', label: 'YouTube Shorts · 9:16', labelHe: 'שורטס · 9:16', width: 1080, height: 1920, fps: 60, maxrate: 16, safe: { top: 0.1, bottom: 0.2, left: 0.05, right: 0.14 } },
  { id: 'reels', label: 'Instagram Reels · 9:16', labelHe: 'רילס · 9:16', width: 1080, height: 1920, fps: 30, maxrate: 10, safe: { top: 0.12, bottom: 0.22, left: 0.05, right: 0.12 } },
  { id: 'tiktok', label: 'TikTok · 9:16', labelHe: 'טיקטוק · 9:16', width: 1080, height: 1920, fps: 30, maxrate: 10, safe: { top: 0.08, bottom: 0.25, left: 0.05, right: 0.14 } },
  { id: 'ig-post', label: 'Instagram post · 4:5', labelHe: 'פוסט אינסטגרם · 4:5', width: 1080, height: 1350, fps: 30, maxrate: 10 },
  { id: 'square', label: 'Square · 1:1', labelHe: 'ריבוע · 1:1', width: 1080, height: 1080, fps: 30, maxrate: 10 },
  { id: 'x', label: 'X post · 16:9', labelHe: 'פוסט X · 16:9', width: 1920, height: 1080, fps: 30, maxrate: 12 },
  { id: 'linkedin', label: 'LinkedIn · 1:1', labelHe: 'לינקדאין · 1:1', width: 1080, height: 1080, fps: 30, maxrate: 10 },
];

/** Languages captions can be translated into (by the model set in the AI agent tab). */
export const CAPTION_LANGS: Record<string, { name: string; he: string }> = {
  he: { name: 'Hebrew', he: 'עברית' },
  en: { name: 'English', he: 'אנגלית' },
  es: { name: 'Spanish', he: 'ספרדית' },
  fr: { name: 'French', he: 'צרפתית' },
  de: { name: 'German', he: 'גרמנית' },
  it: { name: 'Italian', he: 'איטלקית' },
  pt: { name: 'Portuguese', he: 'פורטוגזית' },
  ru: { name: 'Russian', he: 'רוסית' },
};
