// Brand kits: a name, four colours, two fonts, a caption look, a call to action and a logo, kept on the server and
// put on any project in one step (shared/brand.ts does the restyling). Also the built-in starters and the
// intro / outro cards, which need files made on the server (the logo copy and a background card in the colours).
import fs from 'node:fs';
import path from 'node:path';
import { cleanBrand, DEFAULT_BRAND } from '../shared/brand';
import { newProject, OPS } from '../shared/ops';
import { applyStarter, STARTERS } from '../shared/starters';
import type { BrandStyle, Project } from '../shared/types';
import { uid } from '../shared/types';
import { FFMPEG, importAsset, run } from './media';
import { DATA, DIRS, loadProject, mutate, saveProject } from './store';

const DIR = path.join(DATA, 'brands');
fs.mkdirSync(DIR, { recursive: true });

export interface BrandKit extends BrandStyle {
  id: string;
  /** File name of the logo inside the kit's folder. */
  logo?: string;
  /** The logo's place on videos. */
  logoCorner?: 'tl' | 'tr' | 'bl' | 'br';
  logoSize?: number;
  logoOpacity?: number;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

const LOGO_TYPES: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

const check = (id: string) => {
  if (!/^br_[a-z0-9]+$/.test(id)) throw Object.assign(new Error('Unknown brand kit'), { status: 404 });
  return id;
};
const kitFile = (id: string) => path.join(DIR, `${check(id)}.json`);
const kitDir = (id: string) => path.join(DIR, check(id));
export const logoPath = (k: BrandKit) => (k.logo ? path.join(kitDir(k.id), k.logo) : '');

export function getBrand(id: string): BrandKit {
  const f = kitFile(id);
  if (!fs.existsSync(f)) throw Object.assign(new Error(`Unknown brand kit: ${id}`), { status: 404 });
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

const view = (k: BrandKit) => ({ ...k, logoUrl: k.logo ? `/api/brands/${k.id}/logo?v=${encodeURIComponent(k.updatedAt)}` : null });

export function listBrands() {
  return fs
    .readdirSync(DIR)
    .filter((f) => /^br_[a-z0-9]+\.json$/.test(f))
    .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) as BrandKit)
    .sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault) || a.name.localeCompare(b.name))
    .map(view);
}

function write(k: BrandKit) {
  if (k.isDefault) for (const other of listBrands()) if (other.id !== k.id && other.isDefault) fs.writeFileSync(kitFile(other.id), JSON.stringify({ ...strip(other), isDefault: false }, null, 1));
  fs.writeFileSync(kitFile(k.id), JSON.stringify(k, null, 1));
  return view(k);
}
const strip = ({ logoUrl: _u, ...k }: BrandKit & { logoUrl?: unknown }) => k as BrandKit;

const placement = (o: any, base: Partial<BrandKit>) => ({
  logoCorner: (['tl', 'tr', 'bl', 'br'] as const).includes(o?.logoCorner) ? o.logoCorner : base.logoCorner || 'br',
  logoSize: Number.isFinite(Number(o?.logoSize)) ? Math.min(0.6, Math.max(0.03, Number(o.logoSize))) : base.logoSize ?? 0.12,
  logoOpacity: Number.isFinite(Number(o?.logoOpacity)) ? Math.min(1, Math.max(0.05, Number(o.logoOpacity))) : base.logoOpacity ?? 0.9,
});

/** Create a brand kit. `logoFrom` takes the logo from an image already in a project. The first kit becomes the default. */
export function createBrand(o: any) {
  const now = new Date().toISOString();
  const first = listBrands().length === 0;
  const k: BrandKit = { ...cleanBrand(o), ...placement(o, {}), id: uid('br_'), isDefault: first || !!o?.isDefault, createdAt: now, updatedAt: now };
  write(k);
  if (o?.logoFrom?.projectId && o?.logoFrom?.assetId) return logoFromAsset(k.id, String(o.logoFrom.projectId), String(o.logoFrom.assetId));
  return view(k);
}

export function updateBrand(id: string, o: any) {
  const cur = getBrand(id);
  const k: BrandKit = { ...cur, ...cleanBrand({ ...cur, ...o, colors: { ...cur.colors, ...(o?.colors || {}) }, fonts: { ...cur.fonts, ...(o?.fonts || {}) } }, cur), ...placement(o, cur), id, updatedAt: new Date().toISOString() };
  if (o?.isDefault != null) k.isDefault = !!o.isDefault;
  write(k);
  if (o?.logoFrom?.projectId && o?.logoFrom?.assetId) return logoFromAsset(id, String(o.logoFrom.projectId), String(o.logoFrom.assetId));
  return view(k);
}

export function removeBrand(id: string) {
  const k = getBrand(id);
  fs.rmSync(kitFile(id), { force: true });
  fs.rmSync(kitDir(id), { recursive: true, force: true });
  // the next kit takes over as the default
  if (k.isDefault) {
    const next = listBrands()[0];
    if (next) write({ ...strip(next), isDefault: true });
  }
  return { ok: true };
}

/** Save an uploaded logo (PNG, JPEG or WebP; a PNG with a transparent background works best). */
export function setBrandLogo(id: string, body: Buffer, type: string) {
  const k = getBrand(id);
  const ext = LOGO_TYPES[String(type).split(';')[0].trim().toLowerCase()];
  if (!ext) throw Object.assign(new Error('The logo must be a PNG, JPEG or WebP image'), { status: 400 });
  if (!body?.length) throw Object.assign(new Error('The logo file is empty'), { status: 400 });
  const sig = body.subarray(0, 12);
  const real = sig[0] === 0x89 && sig[1] === 0x50 ? '.png' : sig[0] === 0xff && sig[1] === 0xd8 ? '.jpg' : sig.toString('latin1', 8, 12) === 'WEBP' ? '.webp' : '';
  if (real !== ext) throw Object.assign(new Error('The file is not the image it says it is'), { status: 400 });
  fs.mkdirSync(kitDir(id), { recursive: true });
  for (const f of fs.readdirSync(kitDir(id))) if (f.startsWith('logo.')) fs.rmSync(path.join(kitDir(id), f), { force: true });
  fs.writeFileSync(path.join(kitDir(id), `logo${ext}`), body);
  return write({ ...k, logo: `logo${ext}`, updatedAt: new Date().toISOString() });
}

function logoFromAsset(id: string, projectId: string, assetId: string) {
  const p = loadProject(projectId);
  const a = p.assets.find((x) => x.id === assetId);
  if (!a || a.kind !== 'image') throw Object.assign(new Error('The logo must be an image in the project'), { status: 400 });
  const ext = path.extname(a.path).toLowerCase();
  const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[ext];
  if (!type) throw Object.assign(new Error('The logo must be a PNG, JPEG or WebP image'), { status: 400 });
  return setBrandLogo(id, fs.readFileSync(a.path), type);
}

export function removeBrandLogo(id: string) {
  const k = getBrand(id);
  if (k.logo) fs.rmSync(logoPath(k), { force: true });
  return write({ ...k, logo: undefined, updatedAt: new Date().toISOString() });
}

/** The brand's logo as an image in the project: imported once per kit and logo version, then reused. */
async function logoAsset(projectId: string, k: BrandKit, origin: string) {
  if (!k.logo || !fs.existsSync(logoPath(k))) return undefined;
  const name = `Logo · ${k.name}`;
  const have = loadProject(projectId).assets.find((a) => a.name === name && a.kind === 'image' && fs.existsSync(a.path) && fs.statSync(a.path).size === fs.statSync(logoPath(k)).size);
  if (have) return have;
  const copy = path.join(DIRS.media, `${uid('m_')}${path.extname(k.logo)}`);
  fs.copyFileSync(logoPath(k), copy);
  return importAsset(projectId, copy, name, origin);
}

/** Put a brand kit on a project: its colours and fonts on every title and caption, and its logo in the corner. */
export async function applyBrand(projectId: string, brandId: string, origin: string, o: { logo?: boolean } = {}) {
  const k = getBrand(brandId);
  const logo = o.logo === false ? undefined : await logoAsset(projectId, k, origin);
  let result: any;
  mutate(
    projectId,
    (d) => {
      result = OPS.set_brand_style(d, { brand: { ...cleanBrand(k), id: k.id } });
      if (logo) OPS.set_watermark(d, { assetId: logo.id, corner: k.logoCorner, size: k.logoSize, opacity: k.logoOpacity });
    },
    origin,
  );
  return { ...result, logo: !!logo };
}

/** The brand's background card, made once per frame size and colour pair: a soft diagonal from its dark colour into its primary. */
async function backgroundAsset(projectId: string, p: Project, b: BrandStyle, origin: string) {
  const name = `Brand card · ${b.name} · ${p.width}x${p.height}`;
  const have = p.assets.find((a) => a.name === name && fs.existsSync(a.path));
  if (have) return have;
  const hex = (c: string) => c.replace('#', '');
  const [r0, g0, b0] = [0, 2, 4].map((i) => parseInt(hex(b.colors.dark).slice(i, i + 2), 16));
  const [r1, g1, b1] = [0, 2, 4].map((i) => parseInt(hex(b.colors.primary).slice(i, i + 2), 16));
  // 35% of the way to the primary at the far corner, so titles in the light colour stay readable everywhere
  const ch = (a: number, z: number) => `${a}+${((z - a) * 0.35).toFixed(2)}*pow((X/W+Y/H)/2\\,1.6)`;
  const out = path.join(DIRS.media, `${uid('m_')}_card.png`);
  await run(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=black:s=${p.width}x${p.height}:d=1,format=rgb24`, '-vf', `geq=r='${ch(r0, r1)}':g='${ch(g0, g1)}':b='${ch(b0, b1)}'`, '-frames:v', '1', out]);
  return importAsset(projectId, out, name, origin);
}

/** Add the brand's intro card (at the start; the edit moves later) or outro card (at the end). */
export async function addBrandBumper(projectId: string, o: { kind: 'intro' | 'outro'; duration?: number; text?: string }, origin: string) {
  const p = loadProject(projectId);
  const b = p.brand || DEFAULT_BRAND;
  const kit = p.brand?.id ? (() => { try { return getBrand(p.brand!.id!); } catch { return undefined; } })() : undefined;
  const bg = await backgroundAsset(projectId, p, b, origin);
  const logo = kit ? await logoAsset(projectId, kit, origin) : undefined;
  let result: any;
  mutate(projectId, (d) => void (result = OPS.add_bumper(d, { kind: o.kind, duration: o.duration, text: o.text, backgroundAssetId: bg.id, logoAssetId: logo?.id })), origin);
  return result;
}

export const listStarters = () => STARTERS.map(({ titles: _t, ...s }) => s);

/** A brand kit id from a request: a kit id, "default" for the default kit, or nothing. */
export function resolveBrandId(id: unknown) {
  if (!id || id === 'none') return undefined;
  if (id === 'default') return listBrands().find((k) => k.isDefault)?.id;
  return getBrand(String(id)).id;
}

/** A new project from a starter, in a brand kit's look when one is given. */
export async function projectFromStarter(starterId: string, o: { name?: string; brandId?: string; lang?: string }, origin: string) {
  const starter = STARTERS.find((s) => s.id === starterId);
  if (!starter) throw Object.assign(new Error(`Unknown starter "${starterId}". Starters: ${STARTERS.map((s) => s.id).join(', ')}`), { status: 400 });
  const kitId = resolveBrandId(o.brandId);
  const kit = kitId ? getBrand(kitId) : undefined;
  const p = newProject(o.name || (o.lang === 'he' ? starter.labelHe : starter.label), starter.width, starter.height, starter.width > starter.height ? 60 : 30);
  if (kit) p.brand = { ...cleanBrand(kit), id: kit.id };
  applyStarter(p, starter.id, o.lang === 'he' ? 'he' : 'en');
  saveProject(p, origin);
  if (kit) await applyBrand(p.id, kit.id, origin);
  return loadProject(p.id);
}
