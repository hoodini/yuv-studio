import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Job, Project } from '../shared/types';
import { uid } from '../shared/types';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Always absolute: a relative STUDIO_DATA (like ./data in .env.example) is read from the studio folder, and paths
// handed to ffmpeg (the export's text concat list) must not be joined onto it twice.
export const DATA = path.resolve(ROOT, process.env.STUDIO_DATA || 'data');
export const DIRS = {
  projects: path.join(DATA, 'projects'),
  media: path.join(DATA, 'media'),
  cache: path.join(DATA, 'cache'),
  exports: path.join(DATA, 'exports'),
  sfx: path.join(DATA, 'sfx'),
  tmp: path.join(DATA, 'tmp'),
};
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

/** `project` events carry (projectId, origin); `job` events carry the job. */
export const bus = new EventEmitter();
bus.setMaxListeners(200);

const cache = new Map<string, Project>();
const file = (id: string) => path.join(DIRS.projects, `${id.replace(/[^\w-]/g, '')}.json`);

export function loadProject(id: string): Project {
  const hit = cache.get(id);
  if (hit) return hit;
  if (!fs.existsSync(file(id))) throw Object.assign(new Error(`Project not found: ${id}`), { status: 404 });
  const p = JSON.parse(fs.readFileSync(file(id), 'utf8')) as Project;
  cache.set(id, p);
  return p;
}

export function saveProject(p: Project, origin = 'server') {
  p.rev = (p.rev || 0) + 1;
  p.updatedAt = new Date().toISOString();
  cache.set(p.id, p);
  const tmp = file(p.id) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(p));
  fs.renameSync(tmp, file(p.id));
  bus.emit('project', p.id, origin, p.rev);
  return p;
}

/** Run an edit on the stored project and save it. */
export function mutate<T>(id: string, fn: (p: Project) => T, origin = 'server'): T {
  const p = loadProject(id);
  const draft: Project = JSON.parse(JSON.stringify(p));
  const result = fn(draft);
  saveProject(draft, origin);
  return result;
}

export function listProjects() {
  return fs
    .readdirSync(DIRS.projects)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const p = loadProject(f.slice(0, -5));
        return { id: p.id, name: p.name, width: p.width, height: p.height, fps: p.fps, updatedAt: p.updatedAt, clips: p.tracks.reduce((n, t) => n + t.clips.length, 0) };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a!.updatedAt < b!.updatedAt ? 1 : -1));
}

export function deleteProject(id: string) {
  cache.delete(id);
  fs.rmSync(file(id), { force: true });
}

// ---------- jobs ----------

export const jobs = new Map<string, Job>();

export function startJob(kind: Job['kind'], projectId: string, run: (update: (progress: number, message?: string) => void, job: Job) => Promise<any>): Job {
  const job: Job = { id: uid('j_'), kind, projectId, status: 'running', progress: 0, message: '', createdAt: new Date().toISOString() };
  jobs.set(job.id, job);
  let lastEmit = 0;
  const update = (progress: number, message?: string) => {
    job.progress = Math.max(0, Math.min(1, progress));
    if (message != null) job.message = message;
    if (Date.now() - lastEmit > 200) {
      lastEmit = Date.now();
      bus.emit('job', job);
    }
  };
  bus.emit('job', job);
  run(update, job)
    .then((result) => {
      job.status = 'done';
      job.progress = 1;
      job.result = result;
    })
    .catch((e) => {
      job.status = 'error';
      job.error = String(e?.message || e);
      console.error(`[job ${job.kind}]`, e);
    })
    .finally(() => bus.emit('job', job));
  return job;
}
