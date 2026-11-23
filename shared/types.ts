// The project model shared by the browser UI, the REST API, the MCP server and the exporter.

export type TrackKind = 'video' | 'audio' | 'text' | 'caption';
export type ClipType = 'video' | 'image' | 'audio' | 'text' | 'caption';

export interface Asset {
  id: string;
  name: string;
  kind: 'video' | 'audio' | 'image';
  /** Absolute path of the source file on the server machine. */
  path: string;
  /** Absolute path of a browser-friendly proxy, when the source can't play in a browser. */
  proxy?: string;
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio: boolean;
  /** Number of filmstrip thumbnails generated. */
  thumbs: number;
  size: number;
  /** The video has an alpha channel (VP9 WebM with transparency, e.g. after background removal). */
  alpha?: boolean;
  /** Stock media: where it came from, and the credit line its licence asks for (empty = none needed). */
  source?: { name: string; url: string; license: string; credit: string };
}

/** How a video layer mixes with what is under it. `screen` keeps the light (light leaks, dust, flares on black). */
export type BlendMode = 'normal' | 'screen' | 'multiply' | 'overlay' | 'lighten';

/** x / y are the centre of the item as a fraction of the frame (0.5, 0.5 = centre). */
export interface Transform {
  x: number;
  y: number;
  /** 1 = fits inside the frame (media) or the style's own font size (text). */
  scale: number;
  rotation: number;
  opacity: number;
}

/** How a move arrives at a keyframe. `hold` keeps the previous values and jumps at the keyframe. */
export type Ease = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold';
/**
 * A keyframe pins the whole transform of a clip at one moment. Between two keyframes the values glide,
 * shaped by the `ease` of the keyframe they arrive at. Before the first and after the last they stay put.
 */
export interface Keyframe extends Transform {
  /** Seconds from the start of the clip. */
  t: number;
  ease: Ease;
}

export type TransitionType = 'none' | 'fade' | 'dip' | 'flash' | 'blur' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'wipe-left' | 'wipe-right' | 'wipe-up' | 'wipe-down' | 'zoom' | 'zoom-out' | 'spin';
export interface Transition {
  type: TransitionType;
  duration: number;
}

/** Colour / look adjustments. 1 is neutral for the multipliers, 0 for blur. */
export interface Fx {
  brightness: number;
  contrast: number;
  saturation: number;
  blur: number;
}

export interface Word {
  /** Seconds from the start of the clip (captions) or of the source (transcripts). */
  t0: number;
  t1: number;
  text: string;
}

export type HighlightMode = 'none' | 'color' | 'box' | 'reveal';
export type TextAnim = 'none' | 'fade' | 'pop' | 'slide-up' | 'typewriter';

export interface TextStyle {
  fontFamily: string;
  fontWeight: number;
  /** Font size in px on a 1080px-high frame; scaled with the project height. */
  fontSize: number;
  color: string;
  /** Optional gradient fill (list of colours, left to right) instead of `color`. */
  gradient?: string[];
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  uppercase: boolean;
  /** Maximum line width as a fraction of the frame width. */
  maxWidth: number;
  strokeColor: string;
  strokeWidth: number;
  shadowColor: string;
  shadowBlur: number;
  shadowY: number;
  /** Background behind the whole block. */
  bgColor: string;
  bgPadX: number;
  bgPadY: number;
  bgRadius: number;
  /** How the word being spoken is marked (captions with word timings). */
  highlight: HighlightMode;
  highlightColor: string;
  highlightTextColor: string;
  animIn: TextAnim;
  animOut: TextAnim;
  animDuration: number;
}

export interface Clip {
  id: string;
  type: ClipType;
  assetId?: string;
  name?: string;
  /** Position on the timeline, seconds. */
  start: number;
  /** Length on the timeline, seconds. */
  duration: number;
  /** Offset into the source, seconds. */
  in: number;
  speed: number;
  volume: number;
  muted: boolean;
  transform: Transform;
  /** Animated transform. When present (and not empty) it replaces `transform` while the clip plays. */
  keyframes?: Keyframe[];
  fx: Fx;
  tin: Transition;
  tout: Transition;
  /** Audio fade in / out, seconds. When unset, a clip's in / out transition fades its sound too. */
  fadeIn?: number;
  fadeOut?: number;
  text?: string;
  words?: Word[];
  /** Text clips carry their own style; captions fall back to the track's style. */
  style?: TextStyle;
  /** Video and image clips: how they mix with the layers below. Unset = normal. */
  blend?: BlendMode;
  /** Text clips: the title preset the clip was made from, so a brand kit can restyle it in kind. */
  preset?: string;
}

/**
 * The look of a brand: four colours and two fonts. A project keeps a copy, so new titles and captions come out in
 * the brand's look; the brand kit itself (with its logo) lives on the server (server/brands.ts).
 */
export interface BrandStyle {
  /** The brand kit it came from. */
  id?: string;
  name: string;
  colors: {
    /** The main brand colour: buttons, pills. */
    primary: string;
    /** The highlight: the spoken word, the marker, the second gradient stop. */
    accent: string;
    /** Text over video. */
    light: string;
    /** Text on light pills; dark boxes. */
    dark: string;
  };
  fonts: { heading: string; body: string };
  /** The caption look new captions start from (see CAPTION_PRESETS). */
  captionPreset?: string;
  /** The line on the outro card, e.g. "Follow for more". */
  cta?: string;
}

/** A region of the frame (fractions of width and height) a video layer's clips fit into: a layout's slot. */
export interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  hidden: boolean;
  clips: Clip[];
  /** Caption tracks: one style and one position shared by every caption on the track. */
  style?: TextStyle;
  transform?: Transform;
  captionPreset?: string;
  /** Caption tracks: the language of the text (he, en...), set when the captions were translated. */
  lang?: string;
  /** Video layers in a layout: new clips fit into this part of the frame. */
  slot?: Slot;
}

/** A logo stamped in a corner of every frame of the export, above everything else. */
export interface Watermark {
  assetId: string;
  corner: 'tl' | 'tr' | 'bl' | 'br';
  /** Width as a fraction of the frame's shorter side. */
  size: number;
  opacity: number;
  /** Distance from the edges as a fraction of the frame's shorter side. */
  margin: number;
}

export interface Project {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  /** tracks[0] is the top layer. */
  tracks: Track[];
  assets: Asset[];
  markIn?: number | null;
  markOut?: number | null;
  watermark?: Watermark | null;
  /** The brand look in use: new titles and captions follow it. */
  brand?: BrandStyle | null;
  /** The layout chosen for the video layers (see LAYOUTS). */
  layout?: string;
  /** The frame size was chosen on purpose: the first video dropped in does not change it. */
  sizeLocked?: boolean;
  rev: number;
  createdAt: string;
  updatedAt: string;
}

export interface Job {
  id: string;
  kind: 'export' | 'transcribe' | 'captions' | 'proxy' | 'import' | 'smart';
  projectId: string;
  status: 'queued' | 'running' | 'done' | 'error';
  progress: number;
  message: string;
  result?: any;
  error?: string;
  createdAt: string;
}

export const uid = (p = '') => p + Math.random().toString(36).slice(2, 10);
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const clipEnd = (c: Clip) => c.start + c.duration;
/** The audio fade in and out of a clip, in seconds, never longer than the clip. */
export function audioFades(c: Clip): [number, number] {
  const fin = c.fadeIn ?? (c.tin.type !== 'none' ? c.tin.duration : 0);
  const fout = c.fadeOut ?? (c.tout.type !== 'none' ? c.tout.duration : 0);
  return [clamp(fin, 0, c.duration), clamp(fout, 0, c.duration)];
}
export const projectDuration = (p: Project) => p.tracks.reduce((m, t) => t.clips.reduce((mm, c) => Math.max(mm, clipEnd(c)), m), 0);
