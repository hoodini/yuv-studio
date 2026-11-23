import type { Asset, Job, Project } from '../shared/types';

export const clientId = 'ui_' + Math.random().toString(36).slice(2, 10);

async function req<T>(method: string, url: string, body?: any): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'x-client-id': clientId, ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data as T;
}

export const api = {
  projects: () => req<{ id: string; name: string; updatedAt: string; clips: number }[]>('GET', '/api/projects'),
  create: (name: string, opts: { width?: number; height?: number; layout?: string; templateId?: string } = {}) => req<Project>('POST', '/api/projects', { name, ...opts }),
  templates: () => req<any[]>('GET', '/api/templates'),
  saveTemplate: (projectId: string, name: string) => req<any>('POST', '/api/templates', { projectId, name }),
  removeTemplate: (id: string) => req<any>('DELETE', `/api/templates/${id}`),
  load: (id: string) => req<Project>('GET', `/api/projects/${id}`),
  snapshot: (id: string, snap: string) => req<Project>('GET', `/api/projects/${id}/snapshots/${snap}`),
  save: (p: Project) => req<{ rev: number }>('PUT', `/api/projects/${p.id}`, p),
  remove: (id: string) => req('DELETE', `/api/projects/${id}`),
  op: (id: string, op: string, args: any) => req<{ result: any }>('POST', `/api/projects/${id}/ops`, { op, args }),
  /** In chunks, so files over Cloudflare's 100 MB request limit upload too (see uploadChunked). */
  upload: async (id: string, files: File[], onProgress?: (sent: number, total: number, file: File, index: number) => void, signal?: AbortSignal) => {
    const out: Asset[] = [];
    const total = files.reduce((n, f) => n + f.size, 0);
    let done = 0;
    for (const [i, f] of files.entries()) {
      out.push(await uploadChunked(id, f, (sent) => onProgress?.(done + sent, total, f, i), signal));
      done += f.size;
    }
    return out;
  },
  importPath: (id: string, path: string) => req<Asset>('POST', `/api/projects/${id}/assets/import`, { path }),
  /** Download a file from a link; resolves when the import job has finished. */
  importUrl: async (id: string, url: string) => {
    let job = await req<Job>('POST', `/api/projects/${id}/assets/import-url`, { url });
    while (job.status === 'running') job = await req<Job>('GET', `/api/jobs/${job.id}?wait=1`);
    if (job.status === 'error') throw new Error(job.error || 'Import failed');
    return job.result.asset as Asset;
  },
  voices: (o: { q?: string; language?: string; mine?: boolean }) => req<{ voices: any[]; more: boolean }>('GET', `/api/voice/voices?${new URLSearchParams({ ...(o.q ? { q: o.q } : {}), ...(o.language ? { language: o.language } : {}), ...(o.mine ? { mine: '1' } : {}) })}`),
  speak: (id: string, body: any) => req<{ asset: Asset; clip?: { id: string } }>('POST', `/api/projects/${id}/speak`, body),
  cloneVoice: (id: string, body: any) => req<any>('POST', `/api/projects/${id}/clone-voice`, body),
  captions: (id: string, body: any) => req<Job>('POST', `/api/projects/${id}/captions`, body),
  translateCaptions: (id: string, body: { to: string; keepOriginal?: boolean; trackId?: string }) => req<Job>('POST', `/api/projects/${id}/captions/translate`, body),
  silences: (id: string, body: any) => req<any>('POST', `/api/projects/${id}/remove-silences`, body),
  sfx: (id: string, sfx: string, start: number) => req('POST', `/api/projects/${id}/sfx`, { sfx, start }),
  exportVideo: (id: string, body: any) => req<Job>('POST', `/api/projects/${id}/export`, body),
  settings: () => req<any>('GET', '/api/settings'),
  saveSettings: (body: any) => req<any>('PUT', '/api/settings', body),
  peaks: (id: string, assetId: string) => req<{ rate: number; peaks: number[] }>('GET', `/api/projects/${id}/assets/${assetId}/peaks`),
};

/**
 * Upload one file in 8 MB pieces (server/uploads.ts). Survives a dropped connection: on an error it waits,
 * asks the server how much arrived, and continues from there. Works through Cloudflare's 100 MB request limit.
 */
export async function uploadChunked(projectId: string, file: File, onProgress: (sent: number, total: number) => void, signal?: AbortSignal): Promise<Asset> {
  const init = await req<{ uploadId: string; chunkSize: number; received: number }>('POST', `/api/projects/${projectId}/uploads`, { name: file.name || 'video.mp4', size: file.size });
  const { uploadId, chunkSize } = init;
  let offset = init.received;
  let failures = 0;
  onProgress(offset, file.size);
  while (offset < file.size) {
    if (signal?.aborted) {
      await fetch(`/api/uploads/${uploadId}`, { method: 'DELETE' }).catch(() => {});
      throw new Error('Cancelled');
    }
    try {
      const res = await fetch(`/api/uploads/${uploadId}?offset=${offset}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream', 'x-client-id': clientId },
        body: file.slice(offset, Math.min(file.size, offset + chunkSize)),
        signal,
      });
      if (res.status === 409) {
        offset = (await req<{ received: number }>('GET', `/api/uploads/${uploadId}`)).received;
        continue;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.error || `${res.status}`), { fatal: res.status === 404 || res.status === 400 });
      offset = data.received;
      failures = 0;
      onProgress(offset, file.size);
    } catch (e: any) {
      if (e.fatal || signal?.aborted || ++failures > 8) throw e;
      // Phone networks drop: wait a little longer each time, then ask where to continue.
      await new Promise((r) => setTimeout(r, Math.min(15000, 1000 * 2 ** failures)));
      offset = await req<{ received: number }>('GET', `/api/uploads/${uploadId}`).then((x) => x.received).catch(() => offset);
    }
  }
  return req<Asset>('POST', `/api/uploads/${uploadId}/complete`);
}

export const assetUrl =(projectId: string, a: Asset) => `/api/projects/${projectId}/assets/${a.id}/file${a.proxy ? '?p=1' : ''}`;
export const thumbUrl = (projectId: string, assetId: string, i: number) => `/api/projects/${projectId}/assets/${assetId}/thumb/${i}`;
