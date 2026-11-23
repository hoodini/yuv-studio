// Custom fonts: files the user uploads, and families imported from Google Fonts. They live in data/fonts and are
// served to the editor and to the headless export renderer as one stylesheet, so the preview and the export match.
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './store';

export const FONT_DIR = path.join(DATA, 'fonts');
const INDEX = path.join(FONT_DIR, 'index.json');
fs.mkdirSync(FONT_DIR, { recursive: true });

export interface FontFile {
  weight: number;
  style: 'normal' | 'italic';
  /** Path under data/fonts, served at /fonts/<file>. */
  file: string;
  unicodeRange?: string;
  format: 'woff2' | 'woff' | 'truetype' | 'opentype';
}
export interface FontEntry {
  family: string;
  source: 'upload' | 'google';
  files: FontFile[];
  addedAt: string;
}

const read = (): FontEntry[] => {
  try {
    return JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  } catch {
    return [];
  }
};
const write = (list: FontEntry[]) => fs.writeFileSync(INDEX, JSON.stringify(list, null, 1));
export const listFonts = () => read().map((f) => ({ family: f.family, source: f.source, weights: [...new Set(f.files.map((x) => x.weight))].sort((a, b) => a - b) }));

/** A family name that is safe inside CSS and a file name: letters (any script), digits, spaces, - and _. */
function cleanFamily(name: string) {
  const s = String(name || '')
    .replace(/[^\p{L}\p{N} _-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  if (!s) throw Object.assign(new Error('Give the font a name'), { status: 400 });
  return s;
}
const slug = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'font';

/** The format of a font file from its first bytes. Anything else is refused. */
function sniff(head: Buffer): FontFile['format'] | null {
  const tag = head.toString('latin1', 0, 4);
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'wOFF') return 'woff';
  if (tag === 'OTTO') return 'opentype';
  if (tag === 'true' || (head[0] === 0 && head[1] === 1 && head[2] === 0 && head[3] === 0)) return 'truetype';
  return null;
}
const EXT: Record<FontFile['format'], string> = { woff2: 'woff2', woff: 'woff', opentype: 'otf', truetype: 'ttf' };

function upsert(entry: FontEntry) {
  const list = read().filter((f) => f.family.toLowerCase() !== entry.family.toLowerCase());
  list.push(entry);
  write(list);
  return { family: entry.family, source: entry.source, weights: [...new Set(entry.files.map((x) => x.weight))] };
}

/** Add an uploaded font file (TTF, OTF, WOFF, WOFF2). Several weights of one family can be uploaded one by one. */
export function addUploadedFont(tmp: string, originalName: string, o: { family?: string; weight?: number; style?: string } = {}) {
  try {
    const head = Buffer.alloc(4);
    const fd = fs.openSync(tmp, 'r');
    fs.readSync(fd, head, 0, 4, 0);
    fs.closeSync(fd);
    const format = sniff(head);
    if (!format) throw Object.assign(new Error('That is not a font file (TTF, OTF, WOFF or WOFF2)'), { status: 400 });
    const family = cleanFamily(o.family || path.basename(originalName, path.extname(originalName)).replace(/[-_](regular|bold|light|medium|black|semibold|thin|italic)$/i, ''));
    const weight = Math.min(900, Math.max(100, Math.round((Number(o.weight) || guessWeight(originalName)) / 100) * 100));
    const style = o.style === 'italic' || /italic/i.test(originalName) ? 'italic' : 'normal';
    const dir = path.join(FONT_DIR, 'upload', slug(family));
    fs.mkdirSync(dir, { recursive: true });
    const name = `${weight}${style === 'italic' ? 'i' : ''}.${EXT[format]}`;
    fs.copyFileSync(tmp, path.join(dir, name));
    const old = read().find((f) => f.family.toLowerCase() === family.toLowerCase());
    const files = (old?.source === 'upload' ? old.files : []).filter((f) => !(f.weight === weight && f.style === style));
    files.push({ weight, style, file: `upload/${slug(family)}/${name}`, format });
    return upsert({ family, source: 'upload', files, addedAt: new Date().toISOString() });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
function guessWeight(name: string) {
  const n = name.toLowerCase();
  for (const [k, w] of [['thin', 100], ['extralight', 200], ['light', 300], ['medium', 500], ['semibold', 600], ['extrabold', 800], ['black', 900], ['bold', 700]] as const) if (n.includes(k)) return w;
  return 400;
}

// A current desktop Chrome user agent makes Google Fonts answer with WOFF2 files.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const WANTED_SUBSETS = new Set(['hebrew', 'latin', 'latin-ext']);

/**
 * Import a family from Google Fonts by its name ("Rubik Dirt", "Heebo"...). The stylesheet and the font files are
 * downloaded once and kept on disk, so exports work offline afterwards. Only the Hebrew and Latin subsets are kept.
 */
export async function importGoogleFont(name: string) {
  const family = cleanFamily(name);
  const q = encodeURIComponent(family).replace(/%20/g, '+');
  let css = '';
  // Ask for the common weights; a family without some of them makes Google answer 400, so fall back step by step.
  for (const axis of [':wght@300;400;500;600;700;800;900', ':wght@400;700', ':wght@400', '']) {
    const res = await fetch(`https://fonts.googleapis.com/css2?family=${q}${axis}&display=swap`, { headers: { 'user-agent': UA } });
    if (res.ok) {
      css = await res.text();
      break;
    }
    if (res.status !== 400) throw Object.assign(new Error(`Google Fonts answered ${res.status}`), { status: 502 });
  }
  if (!css) throw Object.assign(new Error(`Google Fonts has no family named "${family}". Check the spelling on fonts.google.com.`), { status: 404 });
  const blocks = [...css.matchAll(/(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g)];
  const keep = blocks.some((b) => b[1] && WANTED_SUBSETS.has(b[1])) ? blocks.filter((b) => !b[1] || WANTED_SUBSETS.has(b[1])) : blocks;
  const dir = path.join(FONT_DIR, 'google', slug(family));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const files: FontFile[] = [];
  for (let i = 0; i < keep.length; i++) {
    const body = keep[i][2];
    const url = /src:\s*url\(([^)]+)\)/.exec(body)?.[1]?.replace(/['"]/g, '');
    if (!url || !/^https:\/\/fonts\.gstatic\.com\//.test(url)) continue;
    const weight = Number(/font-weight:\s*(\d+)/.exec(body)?.[1] || 400);
    const style = /font-style:\s*italic/.test(body) ? 'italic' : 'normal';
    const unicodeRange = /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim();
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    if (!res.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    const format = sniff(buf.subarray(0, 4));
    if (!format) continue;
    const fname = `${weight}${style === 'italic' ? 'i' : ''}-${keep[i][1] || i}.${EXT[format]}`;
    fs.writeFileSync(path.join(dir, fname), buf);
    files.push({ weight, style, file: `google/${slug(family)}/${fname}`, format, unicodeRange });
  }
  if (!files.length) throw Object.assign(new Error('Could not download the font files from Google Fonts'), { status: 502 });
  // Google spells the family its own way ("Rubik Dirt"); use the name from the stylesheet when it has one.
  const real = /font-family:\s*'([^']+)'/.exec(css)?.[1] || family;
  return upsert({ family: cleanFamily(real), source: 'google', files, addedAt: new Date().toISOString() });
}

export function removeFont(family: string) {
  const list = read();
  const hit = list.find((f) => f.family.toLowerCase() === String(family).toLowerCase());
  if (!hit) throw Object.assign(new Error('No such font'), { status: 404 });
  for (const f of hit.files) fs.rmSync(path.join(FONT_DIR, f.file), { force: true });
  write(list.filter((f) => f !== hit));
  return { removed: hit.family };
}

/** One stylesheet with every custom font, for the editor and for the export renderer. */
export function fontsCss() {
  return read()
    .flatMap((f) =>
      f.files.map(
        (x) => `@font-face{font-family:'${f.family.replace(/'/g, '')}';font-style:${x.style};font-weight:${x.weight};font-display:block;src:url(/fonts/${x.file.split('/').map(encodeURIComponent).join('/')}) format('${x.format}');${x.unicodeRange ? `unicode-range:${x.unicodeRange};` : ''}}`,
      ),
    )
    .join('\n');
}
