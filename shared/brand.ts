// Brand kits: one set of colours and fonts that every title, caption, logo, intro and outro of a project follows.
// Pure functions on the project, shared by the browser, the API and the MCP server like the rest of ops.ts.
import { CAPTION_PRESETS, TITLE_PRESETS } from './presets';
import type { BrandStyle, Clip, Project, TextStyle, Track } from './types';
import { clamp, clipEnd, projectDuration } from './types';

/** Fonts that come in one weight only: a bolder weight would be faked by the browser and look smeared. */
const ONE_WEIGHT: Record<string, number> = { Anton: 400, 'Press Start 2P': 400, 'Bebas Neue': 400, 'Archivo Black': 400, 'Alfa Slab One': 400 };
/** Display faces in the presets, replaced by the brand's heading font; the rest take its body font. */
const DISPLAY = new Set(['Karantina', 'Anton', 'Bona Nova SC']);
/** Faces that are a look of their own (code, pixels) and stay. */
const KEEP = new Set(['JetBrains Mono', 'Press Start 2P']);

export const DEFAULT_BRAND: BrandStyle = {
  name: 'My brand',
  colors: { primary: '#7A6BFF', accent: '#17BCCF', light: '#FFFFFF', dark: '#0E0E14' },
  fonts: { heading: 'Karantina', body: 'Assistant' },
  captionPreset: 'glass',
  cta: 'Follow for more',
};

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
function rgb(color: string): [number, number, number] {
  const m = HEX.exec(String(color || '').trim());
  if (!m) return [128, 128, 128];
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
export const isColor = (s: unknown) => typeof s === 'string' && HEX.test(s.trim());
export const rgba = (color: string, a: number) => `rgba(${rgb(color).join(',')},${a})`;
/** Relative luminance (WCAG), 0 = black, 1 = white. */
export function luminance(color: string) {
  const [r, g, b] = rgb(color).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
/** The brand's light or dark text colour, whichever reads better on `bg`. */
export const readableOn = (b: BrandStyle, bg: string) => (contrast(b.colors.light, bg) >= contrast(b.colors.dark, bg) ? b.colors.light : b.colors.dark);
/** Is a CSS colour (hex or rgba) a light one? Used to tell light pills from dark boxes in the presets. */
function isLight(css: string) {
  const m = /rgba?\(([^)]+)\)/.exec(css);
  if (m) {
    const [r, g, b] = m[1].split(',').map((v) => Number(v.trim()));
    return 0.299 * r + 0.587 * g + 0.114 * b > 150;
  }
  return luminance(css) > 0.45;
}

const fontFor = (b: BrandStyle, family: string) => (KEEP.has(family) ? family : DISPLAY.has(family) ? b.fonts.heading : b.fonts.body);
const weightFor = (family: string, wanted: number) => ONE_WEIGHT[family] ?? wanted;

/** Clean a brand look sent by a person or an agent: valid colours, fonts and preset, defaults for the rest. */
export function cleanBrand(o: any, base: BrandStyle = DEFAULT_BRAND): BrandStyle {
  const c = o?.colors || {};
  const pick = (v: any, d: string) => (isColor(v) ? (String(v).startsWith('#') ? String(v) : `#${v}`).toUpperCase() : d);
  const font = (v: any, d: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : d);
  return {
    ...(o?.id || base.id ? { id: String(o?.id || base.id) } : {}),
    name: String(o?.name ?? base.name).trim().slice(0, 60) || base.name,
    colors: { primary: pick(c.primary, base.colors.primary), accent: pick(c.accent, base.colors.accent), light: pick(c.light, base.colors.light), dark: pick(c.dark, base.colors.dark) },
    fonts: { heading: font(o?.fonts?.heading, base.fonts.heading), body: font(o?.fonts?.body, base.fonts.body) },
    captionPreset: CAPTION_PRESETS.some((p) => p.id === o?.captionPreset) ? o.captionPreset : base.captionPreset,
    cta: typeof o?.cta === 'string' ? o.cta.trim().slice(0, 80) : base.cta,
  };
}

/** A title preset (TITLE_PRESETS) in the brand's colours and fonts. */
export function brandTitleStyle(b: BrandStyle, presetId: string): TextStyle {
  const preset = TITLE_PRESETS.find((x) => x.id === presetId) || TITLE_PRESETS[0];
  const { primary, accent, light, dark } = b.colors;
  const family = fontFor(b, preset.style.fontFamily);
  const st: TextStyle = { ...preset.style, fontFamily: family, fontWeight: weightFor(family, preset.style.fontWeight), highlightColor: accent, highlightTextColor: readableOn(b, accent) };
  switch (preset.id) {
    case 'marker-title':
      return { ...st, bgColor: accent, color: readableOn(b, accent) };
    case 'spectrum-title':
    case 'pixel':
      return { ...st, gradient: [primary, accent], shadowColor: rgba(dark, 0.45) };
    case 'lower-third':
      return { ...st, bgColor: rgba(light, 0.94), color: readableOn(b, light), shadowColor: rgba(dark, 0.3) };
    case 'kicker':
      return { ...st, bgColor: rgba(dark, 0.86), color: accent };
    case 'cta':
      return { ...st, bgColor: primary, color: readableOn(b, primary), shadowColor: rgba(primary, 0.5) };
    default:
      return { ...st, color: light, shadowColor: rgba(dark, 0.55) };
  }
}

/** A caption look (CAPTION_PRESETS) in the brand's colours and fonts. */
export function brandCaptionStyle(b: BrandStyle, presetId?: string): TextStyle {
  const preset = CAPTION_PRESETS.find((x) => x.id === presetId) || CAPTION_PRESETS.find((x) => x.id === b.captionPreset) || CAPTION_PRESETS[0];
  const { accent, light, dark } = b.colors;
  const family = fontFor(b, preset.style.fontFamily);
  const st: TextStyle = { ...preset.style, fontFamily: family, fontWeight: weightFor(family, preset.style.fontWeight) };
  if (st.bgColor) {
    const lightBox = isLight(st.bgColor);
    st.bgColor = lightBox ? rgba(light, 0.94) : rgba(dark, 0.86);
    st.color = preset.id === 'mono' ? accent : lightBox ? readableOn(b, light) : light;
    st.shadowColor = rgba(dark, lightBox ? 0.3 : 0);
  } else {
    st.color = light;
  }
  if (st.highlight === 'box') {
    st.highlightColor = accent;
    st.highlightTextColor = readableOn(b, accent);
  } else if (st.highlight === 'color') {
    // the spoken word in the accent, unless the accent does not read on the caption's own background
    const bg = st.bgColor ? (isLight(st.bgColor) ? light : dark) : dark;
    st.highlightTextColor = contrast(accent, bg) >= 2 ? accent : b.colors.primary;
  }
  if (st.strokeWidth > 0) st.strokeColor = dark;
  return st;
}

/** Keep what a person set on a clip by hand (size, alignment, motion) when its colours and fonts change. */
const keepOwn = (own: TextStyle | undefined, next: TextStyle): TextStyle =>
  own ? { ...next, fontSize: own.fontSize, align: own.align, maxWidth: own.maxWidth, lineHeight: own.lineHeight, uppercase: own.uppercase, animIn: own.animIn, animOut: own.animOut, animDuration: own.animDuration } : next;

/**
 * Put a brand look on the whole project: every caption track and title takes its colours and fonts, and new ones
 * follow it. Sizes, positions and animations people set stay. The logo is set separately (setWatermark).
 */
export function applyBrandStyle(p: Project, brand: BrandStyle) {
  const b = cleanBrand(brand);
  p.brand = b;
  let captions = 0;
  let titles = 0;
  for (const t of p.tracks) {
    if (t.kind === 'caption') {
      t.style = keepOwn(t.style, brandCaptionStyle(b, t.captionPreset || b.captionPreset));
      t.captionPreset = t.captionPreset || b.captionPreset;
      captions++;
      for (const c of t.clips) if (c.style) c.style = keepOwn(c.style, t.style);
    }
    if (t.kind !== 'text') continue;
    for (const c of t.clips) {
      if (!c.style) continue;
      titles++;
      if (c.preset) {
        c.style = keepOwn(c.style, brandTitleStyle(b, c.preset));
        continue;
      }
      // A title made before presets were recorded: only its fonts and brand colours change.
      const family = fontFor(b, c.style.fontFamily);
      c.style = { ...c.style, fontFamily: family, fontWeight: weightFor(family, c.style.fontWeight), highlightColor: b.colors.accent, highlightTextColor: readableOn(b, b.colors.accent) };
      if (c.style.gradient?.length) c.style.gradient = [b.colors.primary, b.colors.accent];
    }
  }
  return { brand: b.name, captionTracks: captions, titles };
}

/** Stop following a brand: new titles and captions get the studio's own looks again. Existing ones stay as they are. */
export function clearBrandStyle(p: Project) {
  p.brand = null;
}

// ---------- intro and outro cards ----------

const BRAND_LAYER = 'Brand';
const BRAND_BG_LAYER = 'Brand background';
const BRAND_TEXT_LAYER = 'Brand text';

/** When the brand's intro and outro cards show: the corner logo steps aside then, since the card has the logo big. */
export function brandCardRanges(p: Project): [number, number][] {
  const t = p.tracks.find((x) => x.kind === 'video' && x.name === BRAND_BG_LAYER && !x.hidden);
  return t ? t.clips.map((c) => [c.start, clipEnd(c)] as [number, number]) : [];
}

function layer(p: Project, name: string, kind: Track['kind'], add: (p: Project, kind: Track['kind'], name: string) => Track) {
  return p.tracks.find((t) => t.kind === kind && t.name === name) || add(p, kind, name);
}

export interface BumperParts {
  /** Image assets already in the project: the brand's logo and a full-frame background card in its colours. */
  logoAssetId?: string;
  backgroundAssetId: string;
  duration?: number;
  /** Intro: the brand name by default. Outro: the brand's call to action. */
  text?: string;
}

/**
 * An intro card at the start (everything else moves later by its length) or an outro card at the end: the brand's
 * background, its logo, and one line of text, on layers of their own. `deps` are the ops that add tracks and clips
 * (passed in to keep this module free of a circular import with ops.ts).
 */
export function addBumper(
  p: Project,
  kind: 'intro' | 'outro',
  parts: BumperParts,
  deps: {
    addTrack: (p: Project, kind: Track['kind'], name: string) => Track;
    moveTrack: (p: Project, trackId: string, index: number) => unknown;
    addMediaClip: (p: Project, assetId: string, o: { trackId: string; start: number; duration: number }) => Clip;
    addTextClip: (p: Project, o: { text: string; preset: string; start: number; duration: number; trackId: string; transform?: { y: number } }) => Clip;
  },
) {
  const b = p.brand || DEFAULT_BRAND;
  const d = clamp(parts.duration ?? (kind === 'intro' ? 2.5 : 3.5), 1, 15);
  const fr = 1 / p.fps;
  let at = 0;
  if (kind === 'intro') {
    // make room: the whole edit starts `d` later
    for (const t of p.tracks) for (const c of t.clips) c.start = Math.round((c.start + d) * p.fps) / p.fps;
    if (p.markIn != null) p.markIn += d;
    if (p.markOut != null) p.markOut += d;
  } else at = Math.round(projectDuration(p) * p.fps) / p.fps;

  // Fresh layers above the video, below titles and captions: the card covers the whole frame while it shows.
  const bg = layer(p, BRAND_BG_LAYER, 'video', deps.addTrack);
  const logo = parts.logoAssetId ? layer(p, BRAND_LAYER, 'video', deps.addTrack) : undefined;
  const firstVideo = () => p.tracks.findIndex((t) => t.kind === 'video' && t !== bg && t !== logo);
  if (logo) deps.moveTrack(p, logo.id, Math.max(0, firstVideo()));
  deps.moveTrack(p, bg.id, Math.max(0, firstVideo()));
  if (logo && p.tracks.indexOf(logo) > p.tracks.indexOf(bg)) deps.moveTrack(p, logo.id, p.tracks.indexOf(bg));
  for (const t of [bg, logo]) if (t) delete t.slot;

  const card = deps.addMediaClip(p, parts.backgroundAssetId, { trackId: bg.id, start: at, duration: d });
  card.name = kind === 'intro' ? 'Intro card' : 'Outro card';
  card.tin = { type: kind === 'intro' ? 'none' : 'fade', duration: 0.4 };
  card.tout = { type: kind === 'intro' ? 'fade' : 'none', duration: 0.4 };
  const ids: string[] = [card.id];
  if (logo && parts.logoAssetId) {
    const mark = deps.addMediaClip(p, parts.logoAssetId, { trackId: logo.id, start: at + fr * 3, duration: d - fr * 3 });
    mark.name = 'Logo';
    mark.transform = { ...mark.transform, x: 0.5, y: kind === 'intro' ? 0.42 : 0.38, scale: p.height > p.width ? 0.42 : 0.3 };
    mark.tin = { type: 'zoom', duration: 0.5 };
    mark.tout = { type: 'fade', duration: 0.35 };
    ids.push(mark.id);
  }
  const words = (parts.text ?? (kind === 'intro' ? b.name : b.cta || '')).trim();
  if (words) {
    const textLayer = layer(p, BRAND_TEXT_LAYER, 'text', deps.addTrack);
    const title = deps.addTextClip(p, {
      text: words,
      preset: kind === 'intro' ? 'title' : 'cta',
      start: at + 0.35,
      duration: Math.max(0.6, d - 0.35),
      trackId: textLayer.id,
      transform: { y: parts.logoAssetId ? 0.72 : 0.5 },
    });
    if (kind === 'intro') title.style = { ...title.style!, fontSize: Math.round(title.style!.fontSize * 0.7) };
    title.style = { ...title.style!, animOut: 'fade' };
    ids.push(title.id);
  }
  return { kind, start: at, duration: d, clipIds: ids, end: Math.max(...p.tracks.flatMap((t) => t.clips.map(clipEnd))) };
}
