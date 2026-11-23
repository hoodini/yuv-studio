import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Peaks } from '../shared/ops';
import type { Asset, Project } from '../shared/types';
import { uid } from '../shared/types';
import { DIRS, mutate, startJob } from './store';

export const FFMPEG = process.env.FFMPEG || 'ffmpeg';
export const FFPROBE = process.env.FFPROBE || 'ffprobe';

/** Run a process and collect its output. Rejects on a non-zero exit code. */
export function run(cmd: string, args: string[], opts: { onStdout?: (s: string) => void; onStderr?: (s: string) => void; binary?: boolean } = {}): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    const out: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (d: Buffer) => {
      if (opts.onStdout) opts.onStdout(d.toString());
      else out.push(d);
    });
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString();
      err = (err + s).slice(-6000);
      opts.onStderr?.(s);
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve({ stdout: Buffer.concat(out), stderr: err }) : reject(new Error(`${path.basename(cmd)} exited with code ${code}\n${err.slice(-1500)}`))));
  });
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus', '.wma']);
const BROWSER_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1']);
const BROWSER_CONTAINER = new Set(['.mp4', '.m4v', '.mov', '.webm']);

const MEDIA_FORMATS = new Set(['mov', 'mp4', 'm4a', '3gp', 'matroska', 'webm', 'avi', 'asf', 'mpegts', 'mpeg', 'flv', 'mp3', 'wav', 'aac', 'ogg', 'flac', 'aiff', 'image2', 'png_pipe', 'jpeg_pipe', 'gif', 'webp_pipe', 'bmp_pipe', 'avif']);

export async function probe(file: string) {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-protocol_whitelist', 'file', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const info = JSON.parse(stdout.toString());
  // Only real media containers. Playlist and script formats (hls, concat, sdp...) make ffmpeg open other files
  // and addresses, and ffmpeg recognises them by content, whatever the file is called or starts with.
  const format = String(info.format?.format_name || '');
  if (!format.split(',').some((f) => MEDIA_FORMATS.has(f))) throw Object.assign(new Error(`This is not a video, audio or image file (${format || 'unknown format'})`), { status: 400 });
  const v = (info.streams || []).find((s: any) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const a = (info.streams || []).find((s: any) => s.codec_type === 'audio');
  const ext = path.extname(file).toLowerCase();
  let kind: Asset['kind'] = v ? 'video' : 'audio';
  if (IMAGE_EXT.has(ext)) kind = 'image';
  else if (AUDIO_EXT.has(ext) || !v) kind = 'audio';
  if (!v && !a) throw new Error('No video or audio stream found in this file');
  let width = v?.width as number | undefined;
  let height = v?.height as number | undefined;
  const rotation = Number(v?.side_data_list?.find((s: any) => s.rotation != null)?.rotation ?? v?.tags?.rotate ?? 0);
  if (width && height && Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  let fps: number | undefined;
  if (v?.avg_frame_rate && kind === 'video') {
    const [n, d] = String(v.avg_frame_rate).split('/').map(Number);
    if (n && d) fps = Math.round((n / d) * 100) / 100;
  }
  const duration = kind === 'image' ? 0 : Number(info.format?.duration || v?.duration || a?.duration || 0);
  const needsProxy = kind === 'video' && (!BROWSER_VIDEO.has(v.codec_name) || !BROWSER_CONTAINER.has(ext) || /10|12/.test(v.pix_fmt || '') || (height || 0) > 2160);
  // VP8/VP9 in WebM mark their transparency with the alpha_mode tag (ffprobe reports the colour planes only).
  const alpha = kind === 'video' && /^vp[89]$/.test(v.codec_name) && (String(v.tags?.alpha_mode ?? v.tags?.ALPHA_MODE ?? '') === '1' || /^yuva/.test(v.pix_fmt || ''));
  return { kind, width, height, fps, duration, hasAudio: !!a && kind !== 'image', needsProxy, alpha };
}

export const assetCache = (assetId: string) => {
  const d = path.join(DIRS.cache, assetId.replace(/[^\w-]/g, ''));
  fs.mkdirSync(d, { recursive: true });
  return d;
};

/** Register a file as an asset of the project and start building thumbnails, waveform and proxy. */
export async function importAsset(projectId: string, file: string, name?: string, origin = 'server'): Promise<Asset> {
  file = path.resolve(file);
  if (!fs.existsSync(file)) throw Object.assign(new Error(`File not found: ${file}`), { status: 400 });
  const info = await probe(file);
  const asset: Asset = {
    id: uid('a_'),
    name: name || path.basename(file),
    kind: info.kind,
    path: file,
    duration: info.duration,
    width: info.width,
    height: info.height,
    fps: info.fps,
    hasAudio: info.hasAudio,
    thumbs: info.kind === 'video' ? Math.max(1, Math.min(120, Math.ceil(info.duration))) : 0,
    size: fs.statSync(file).size,
    ...(info.alpha ? { alpha: true } : {}),
  };
  mutate(projectId, (p) => void p.assets.push(asset), origin);
  if (asset.kind === 'video') void buildThumbs(asset).catch((e) => console.error('[thumbs]', e.message));
  if (asset.hasAudio) void getPeaks(asset).catch((e) => console.error('[peaks]', e.message));
  if (info.needsProxy) buildProxy(projectId, asset);
  return asset;
}

export const thumbTime = (asset: Asset, i: number) => ((i + 0.5) / asset.thumbs) * asset.duration;

const thumbJobs = new Map<string, Promise<void>>();
export function buildThumbs(asset: Asset) {
  let job = thumbJobs.get(asset.id);
  if (!job) {
    job = (async () => {
      const dir = assetCache(asset.id);
      for (let i = 0; i < asset.thumbs; i++) {
        const out = path.join(dir, `thumb_${i}.jpg`);
        if (fs.existsSync(out)) continue;
        await run(FFMPEG, ['-v', 'error', '-ss', thumbTime(asset, i).toFixed(3), '-i', asset.path, '-frames:v', '1', '-vf', 'scale=-2:96', '-q:v', '6', '-y', out]).catch(() => {});
      }
    })();
    thumbJobs.set(asset.id, job);
  }
  return job;
}

const peakJobs = new Map<string, Promise<Peaks>>();
/** Waveform peaks, 50 per second, cached on disk. */
export function getPeaks(asset: Asset): Promise<Peaks> {
  let job = peakJobs.get(asset.id);
  if (!job) {
    job = (async () => {
      const out = path.join(assetCache(asset.id), 'peaks.json');
      if (fs.existsSync(out)) return JSON.parse(fs.readFileSync(out, 'utf8')) as Peaks;
      const { stdout } = await run(FFMPEG, ['-v', 'error', '-i', asset.path, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-']);
      const samples = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 2));
      const win = 160;
      const peaks: number[] = [];
      for (let i = 0; i < samples.length; i += win) {
        let m = 0;
        for (let j = i; j < Math.min(samples.length, i + win); j++) m = Math.max(m, Math.abs(samples[j]));
        peaks.push(Math.round((m / 32768) * 1000) / 1000);
      }
      const data: Peaks = { rate: 50, peaks };
      fs.writeFileSync(out, JSON.stringify(data));
      return data;
    })();
    peakJobs.set(asset.id, job);
    job.catch(() => peakJobs.delete(asset.id));
  }
  return job;
}

let nvenc: boolean | null = null;
/** True when the NVIDIA hardware H.264 encoder actually works on this machine. */
export async function hasNvenc() {
  if (nvenc == null) {
    nvenc = await run(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:r=30:d=0.2', '-c:v', 'h264_nvenc', '-f', 'null', '-'])
      .then(() => true)
      .catch(() => false);
  }
  return nvenc;
}

/** Make a 1080p H.264 copy for files a browser cannot play (HEVC, ProRes, MKV, 10-bit...). */
function buildProxy(projectId: string, asset: Asset) {
  startJob('proxy', projectId, async (update) => {
    update(0, `Preparing ${asset.name} for preview`);
    const out = path.join(assetCache(asset.id), 'proxy.mp4');
    const codec = (await hasNvenc()) ? ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '24'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23'];
    await run(FFMPEG, ['-v', 'error', '-progress', 'pipe:1', '-i', asset.path, '-vf', "scale=-2:'min(1080,ih)'", '-pix_fmt', 'yuv420p', ...codec, '-g', '30', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-y', out], {
      onStdout: (s) => {
        const m = /out_time_ms=(\d+)/.exec(s);
        if (m && asset.duration) update(Number(m[1]) / 1e6 / asset.duration);
      },
    });
    mutate(projectId, (p: Project) => {
      const a = p.assets.find((x) => x.id === asset.id);
      if (a) a.proxy = out;
    });
    return { assetId: asset.id };
  });
}

/** Extensions a stored media file may keep (they tell ffmpeg the container). Anything else is stored without one,
 *  so a file named page.html or x.svg.html can never be served back as a web page. ffprobe reads the content anyway. */
const MEDIA_EXT = new Set('mp4 m4v mov qt mkv webm avi wmv flv mts m2ts ts 3gp 3g2 mpg mpeg ogv mp3 wav m4a aac ogg oga opus flac wma aiff aif caf amr png jpg jpeg webp gif bmp heic heif tif tiff avif svg'.split(' '));
export function mediaExt(name: string) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(String(name || ''));
  return m && MEDIA_EXT.has(m[1].toLowerCase()) ? `.${m[1].toLowerCase()}` : '';
}
