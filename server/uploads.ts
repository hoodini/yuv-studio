// Resumable uploads in chunks (0.5.0). A phone video is often hundreds of megabytes, and Cloudflare (in front of a
// studio reached over the internet) refuses any single request over 100 MB. So the browser sends the file in
// 8 MB pieces, each one a separate request; after a dropped connection it asks how much arrived and goes on from there.
//
//   POST /api/projects/:id/uploads   { name, size }  -> { uploadId, chunkSize, received }
//   GET  /api/uploads/:uid                           -> { received, size }
//   PUT  /api/uploads/:uid?offset=N  (raw bytes)     -> { received }    N must equal what already arrived
//   POST /api/uploads/:uid/complete                  -> the imported Asset
//   DELETE /api/uploads/:uid                         -> cancel
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Asset } from '../shared/types';
import { uid } from '../shared/types';
import { mediaExt } from './media';
import { DATA, DIRS, loadProject } from './store';

export const CHUNK = 8 * 1024 * 1024;
const MAX_SIZE = 20 * 1024 ** 3; // 20 GB
const STALE = 24 * 3600 * 1000;
const DIR = path.join(DATA, 'uploads');

interface Meta {
  projectId: string;
  name: string;
  ext: string;
  size: number;
  createdAt: number;
}

const metaFile = (id: string) => path.join(DIR, `${id}.json`);
const partFile = (id: string) => path.join(DIR, `${id}.part`);

function load(id: string): Meta {
  if (!/^u_[a-f0-9]{32}$/.test(id)) throw Object.assign(new Error('Unknown upload'), { status: 404 });
  try {
    return JSON.parse(fs.readFileSync(metaFile(id), 'utf8'));
  } catch {
    throw Object.assign(new Error('That upload is gone. Start it again.'), { status: 404 });
  }
}
const received = (id: string) => (fs.existsSync(partFile(id)) ? fs.statSync(partFile(id)).size : 0);

function drop(id: string) {
  fs.rmSync(metaFile(id), { force: true });
  fs.rmSync(partFile(id), { force: true });
}

/** Unfinished uploads older than a day only take disk space. */
function sweep() {
  for (const f of fs.existsSync(DIR) ? fs.readdirSync(DIR) : []) {
    const full = path.join(DIR, f);
    try {
      if (Date.now() - fs.statSync(full).mtimeMs > STALE) fs.rmSync(full, { force: true });
    } catch {}
  }
}

type Wrap = (fn: (req: express.Request, res: express.Response) => any) => express.RequestHandler;
type Import = (projectId: string, file: string, name: string, origin?: string) => Promise<Asset>;

export function mountUploads(app: express.Express, wrap: Wrap, importAsset: Import, origin: (req: express.Request) => string) {
  fs.mkdirSync(DIR, { recursive: true });

  app.post(
    '/api/projects/:id/uploads',
    wrap((req) => {
      const p = loadProject(String(req.params.id));
      const size = Number(req.body?.size);
      if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_SIZE) throw Object.assign(new Error('The file size is missing or over 20 GB.'), { status: 400 });
      const name = String(req.body?.name || 'video').replace(/[\u0000-\u001f\u007f/\\]/g, '').slice(0, 200) || 'video';
      // Only the extension is kept from the name for the file on disk; it tells ffmpeg the container.
      const ext = mediaExt(name);
      sweep();
      const id = `u_${crypto.randomBytes(16).toString('hex')}`;
      fs.writeFileSync(metaFile(id), JSON.stringify({ projectId: p.id, name, ext, size, createdAt: Date.now() } satisfies Meta));
      fs.writeFileSync(partFile(id), '');
      return { uploadId: id, chunkSize: CHUNK, received: 0 };
    }),
  );

  app.get(
    '/api/uploads/:uid',
    wrap((req) => {
      const id = String(req.params.uid);
      const m = load(id);
      return { received: received(id), size: m.size };
    }),
  );

  app.put(
    '/api/uploads/:uid',
    express.raw({ type: () => true, limit: CHUNK + 1024 }),
    wrap((req) => {
      const id = String(req.params.uid);
      const m = load(id);
      const have = received(id);
      const offset = Number(req.query.offset);
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || !body.length) throw Object.assign(new Error('Empty chunk'), { status: 400 });
      // A retried or out-of-order chunk: tell the browser where to continue instead of corrupting the file.
      if (offset !== have) throw Object.assign(new Error(`Expected offset ${have}`), { status: 409, received: have });
      if (have + body.length > m.size) throw Object.assign(new Error('More bytes than the file size'), { status: 400 });
      fs.appendFileSync(partFile(id), body);
      fs.utimesSync(metaFile(id), new Date(), new Date());
      return { received: have + body.length };
    }),
  );

  app.post(
    '/api/uploads/:uid/complete',
    wrap(async (req) => {
      const id = String(req.params.uid);
      const m = load(id);
      const have = received(id);
      if (have !== m.size) throw Object.assign(new Error(`The upload is not complete (${have} of ${m.size} bytes)`), { status: 409, received: have });
      loadProject(m.projectId);
      const file = path.join(DIRS.media, `${uid('m_')}${m.ext}`);
      fs.renameSync(partFile(id), file);
      fs.rmSync(metaFile(id), { force: true });
      try {
        return await importAsset(m.projectId, file, m.name, origin(req));
      } catch (e) {
        fs.rmSync(file, { force: true });
        throw e;
      }
    }),
  );

  app.delete(
    '/api/uploads/:uid',
    wrap((req) => {
      const id = String(req.params.uid);
      load(id);
      drop(id);
    }),
  );
}
