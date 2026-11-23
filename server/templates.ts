// Project templates: the canvas, layers, layout, titles and logo of a project, saved to start new ones from.
// Media clips and captions are left out (they belong to one video); the logo file is kept with the template.
import fs from 'node:fs';
import path from 'node:path';
import { newProject } from '../shared/ops';
import type { Project, Track } from '../shared/types';
import { uid } from '../shared/types';
import { importAsset } from './media';
import { DATA, DIRS, loadProject, mutate, saveProject } from './store';

const DIR = path.join(DATA, 'templates');
fs.mkdirSync(DIR, { recursive: true });

export interface Template {
  id: string;
  name: string;
  createdAt: string;
  width: number;
  height: number;
  fps: number;
  layout?: string;
  brand?: Project['brand'];
  tracks: Track[];
  watermark?: (NonNullable<Project['watermark']> & { file: string }) | null;
}

const file = (id: string) => {
  if (!/^tp_[a-z0-9]+$/.test(id)) throw Object.assign(new Error('Unknown template'), { status: 404 });
  return path.join(DIR, `${id}.json`);
};

export function listTemplates() {
  return fs
    .readdirSync(DIR)
    .filter((f) => /^tp_[a-z0-9]+\.json$/.test(f))
    .map((f) => {
      const t: Template = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
      return {
        id: t.id,
        name: t.name,
        createdAt: t.createdAt,
        width: t.width,
        height: t.height,
        fps: t.fps,
        layout: t.layout,
        titles: t.tracks.reduce((n, tr) => n + tr.clips.length, 0),
        logo: !!t.watermark,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function saveTemplate(projectId: string, name: string) {
  const p = loadProject(projectId);
  const id = uid('tp_');
  const tracks: Track[] = p.tracks.map((t) => ({
    ...JSON.parse(JSON.stringify(t)),
    clips: t.kind === 'text' ? JSON.parse(JSON.stringify(t.clips)) : [],
  }));
  let watermark: Template['watermark'] = null;
  const logo = p.watermark && p.assets.find((a) => a.id === p.watermark!.assetId);
  if (p.watermark && logo && fs.existsSync(logo.path)) {
    fs.mkdirSync(path.join(DIR, id), { recursive: true });
    const dest = path.join(DIR, id, `logo${path.extname(logo.path).toLowerCase() || '.png'}`);
    fs.copyFileSync(logo.path, dest);
    watermark = { ...p.watermark, file: dest };
  }
  const t: Template = {
    id,
    name:
      String(name || p.name)
        .trim()
        .slice(0, 80) || 'Template',
    createdAt: new Date().toISOString(),
    width: p.width,
    height: p.height,
    fps: p.fps,
    layout: p.layout,
    brand: p.brand || null,
    tracks,
    watermark,
  };
  fs.writeFileSync(file(id), JSON.stringify(t, null, 1));
  return listTemplates().find((x) => x.id === id)!;
}

export function removeTemplate(id: string) {
  fs.rmSync(file(id), { force: true });
  fs.rmSync(path.join(DIR, id.replace(/[^\w]/g, '')), {
    recursive: true,
    force: true,
  });
  return { ok: true };
}

/** A new project from a template: fresh ids, the same canvas, layers, layout and titles, and its own copy of the logo. */
export async function projectFromTemplate(id: string, name: string, origin: string) {
  const f = file(id);
  if (!fs.existsSync(f)) throw Object.assign(new Error('Unknown template'), { status: 404 });
  const t: Template = JSON.parse(fs.readFileSync(f, 'utf8'));
  const p = newProject(name || t.name, t.width, t.height, t.fps);
  p.tracks = t.tracks.map((tr) => ({
    ...tr,
    id: uid('t_'),
    clips: tr.clips.map((c) => ({ ...c, id: uid('c_') })),
  }));
  p.layout = t.layout;
  if (t.brand) p.brand = t.brand;
  p.sizeLocked = true;
  saveProject(p, origin);
  if (t.watermark?.file && fs.existsSync(t.watermark.file)) {
    const copy = path.join(DIRS.media, `${uid('m_')}${path.extname(t.watermark.file)}`);
    fs.copyFileSync(t.watermark.file, copy);
    const asset = await importAsset(p.id, copy, 'logo', origin);
    const { file: _f, ...wm } = t.watermark;
    mutate(p.id, (d) => void (d.watermark = { ...wm, assetId: asset.id }), origin);
  }
  return loadProject(p.id);
}
