// Fonts the user added (uploaded files and Google Fonts imports). The server serves them as one stylesheet; this
// module loads it, keeps the list for the font pickers, and remembers the default font for new titles.
import { useSyncExternalStore } from 'react';
import { FONTS } from '../shared/presets';
import { FONT_WEIGHTS } from './fonts';

export interface CustomFont {
  family: string;
  source: 'upload' | 'google';
  weights: number[];
}
let list: CustomFont[] = [];
let defaultFont = '';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

let inflight: Promise<void> | null = null;
/**
 * Fetch the list, (re)load the stylesheet and wait until every face can be drawn on a canvas. Calls that overlap share
 * one load: setting the same stylesheet address twice fires no second load event, which would leave a caller waiting.
 */
export function loadCustomFonts() {
  return (inflight ??= load().finally(() => (inflight = null)));
}
async function load() {
  try {
    const [fonts, settings] = await Promise.all([fetch('/api/fonts').then((r) => (r.ok ? r.json() : [])), fetch('/api/settings').then((r) => (r.ok ? r.json() : {}))]) as [any, any];
    list = Array.isArray(fonts) ? fonts : [];
    defaultFont = settings?.defaultFont || '';
  } catch {
    list = [];
  }
  let link = document.getElementById('custom-fonts') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.id = 'custom-fonts';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  await new Promise<void>((done) => {
    link!.onload = link!.onerror = () => done();
    link!.href = `/api/fonts.css?v=${Date.now()}`;
  });
  const jobs: Promise<unknown>[] = [];
  for (const f of list) {
    FONT_WEIGHTS[f.family] = f.weights.length ? f.weights : [400];
    for (const w of FONT_WEIGHTS[f.family]) jobs.push(document.fonts.load(`${w} 40px "${f.family}"`, 'Hello 123'), document.fonts.load(`${w} 40px "${f.family}"`, 'שלום עולם'));
  }
  await Promise.allSettled(jobs);
  emit();
}

export const getDefaultFont = () => defaultFont;
export function setDefaultFontLocal(f: string) {
  defaultFont = f;
  emit();
}
/** Bundled fonts plus the user's, for a font picker. */
export function fontOptions() {
  return [...FONTS.map((f) => ({ v: f.family, l: f.label })), ...list.map((f) => ({ v: f.family, l: `${f.family} · ${f.source === 'google' ? 'Google' : '↑'}` }))];
}
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
let version = 0;
listeners.add(() => version++);
/** Re-render when the font list or the default changes. */
export const useFonts = () => {
  useSyncExternalStore(subscribe, () => version);
  return { list, defaultFont, options: fontOptions() };
};
