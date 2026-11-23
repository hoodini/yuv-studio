import { BLEND_MODES } from '../shared/ops';
import type { BlendMode } from '../shared/types';
// Export: one ffmpeg run builds the whole timeline. Video and image layers are stacked with overlay
// filters, audio is mixed, and the text layer comes from pictures rendered in headless Chrome with
// the same drawing code as the preview.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { watermarkRect, BLUR_PX, SPIN_DEG, ZOOMING, mediaRect } from '../shared/geometry';
import { brandCardRanges } from '../shared/brand';
import { EXPORT_PRESETS } from '../shared/presets';
import { overlaySegments, textBands } from '../shared/renderText';
import type { Clip, Ease, Keyframe, Project, Transition } from '../shared/types';
import { audioFades, clipEnd, projectDuration, uid } from '../shared/types';
import { FFMPEG, hasNvenc, run } from './media';
import { DIRS } from './store';

export interface ExportOpts {
  quality?: 'high' | 'medium' | 'draft';
  /** Output height, e.g. 720. Default: the project height. */
  height?: number;
  fps?: number;
  /** Export only this part of the timeline, seconds. */
  start?: number;
  end?: number;
  filename?: string;
  /** A social preset id (shared/presets EXPORT_PRESETS): sets the output size, frame rate and bitrate ceiling. */
  preset?: string;
  /** Output size when it differs from the project's shape; `fit` keeps the whole picture, `fill` crops. */
  width?: number;
  reframe?: 'fit' | 'fill';
}

const n = (v: number) => (Math.round(v * 10000) / 10000).toString();
const ff = (p: string) => p.replace(/\\/g, '/');

function findBrowser() {
  const c = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  const hit = c.find((x) => x && fs.existsSync(x));
  if (!hit) throw new Error('Chrome or Edge is needed to render text. Set CHROME_PATH.');
  return hit;
}

/** Render the text layer to PNGs plus an ffmpeg concat list. Returns null when there is no text. */
async function renderTextLayer(p: Project, dir: string, baseUrl: string, totalFrames: number, update: (f: number) => void): Promise<string | null> {
  const segs = overlaySegments(p, totalFrames);
  if (!segs.some((s) => !s.empty)) return null;
  const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args: ['--no-sandbox', '--disable-gpu', '--force-color-profile=srgb'] });
  try {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/render.html`, { waitUntil: 'load' });
    await page.waitForFunction('window.__ready === true', { timeout: 30000 });
    await page.evaluate((proj) => (window as any).__setProject(proj), p as any);
    const empty = path.join(dir, 'empty.png');
    fs.writeFileSync(empty, Buffer.from(((await page.evaluate(() => (window as any).__renderEmpty())) as string).split(',')[1], 'base64'));
    const lines: string[] = ['ffconcat version 1.0'];
    let last = empty;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      let file = empty;
      if (!s.empty) {
        file = path.join(dir, `t${i}.png`);
        const url = (await page.evaluate((t) => (window as any).__renderAt(t), s.t)) as string;
        fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
      }
      lines.push(`file '${ff(file)}'`, `duration ${(s.frames / p.fps).toFixed(6)}`);
      last = file;
      if (i % 20 === 0) update(i / segs.length);
    }
    lines.push(`file '${ff(last)}'`);
    const list = path.join(dir, 'text.ffconcat');
    fs.writeFileSync(list, lines.join('\n'));
    return list;
  } finally {
    await browser.close();
  }
}

/** ffmpeg expression for a transition's progress 0..1 at main-timeline time `t`. */
const progressExpr = (clip: Clip, tr: Transition, isIn: boolean) => (isIn ? `min(1,max(0,(t-${n(clip.start)})/${n(tr.duration)}))` : `min(1,max(0,(${n(clipEnd(clip))}-t)/${n(tr.duration)}))`);
const easeExpr = (p: string) => `(1-pow(1-${p},3))`;

/** The curves of shared/geometry.ts easeFn, as ffmpeg expressions of a progress `u` that runs 0..1. */
const curveExpr = (ease: Ease, u: string) => (ease === 'ease-in' ? `pow(${u},3)` : ease === 'ease-out' ? `(1-pow(1-${u},3))` : ease === 'ease-in-out' ? `if(lt(${u},0.5),4*pow(${u},3),1-pow(2-2*${u},3)/2)` : u);
/**
 * One keyframed value as an ffmpeg expression of `v`, the seconds since the clip started: the first value
 * before the first keyframe, the last after the last, and the eased glide in between (transformAt, in ffmpeg).
 */
function keyExpr(kfs: Keyframe[], get: (k: Keyframe) => number, v: string): string {
  const vals = kfs.map(get);
  if (vals.every((x) => Math.abs(x - vals[0]) < 1e-6)) return n(vals[0]);
  let e = n(vals[vals.length - 1]);
  for (let i = kfs.length - 1; i >= 1; i--) {
    const a = kfs[i - 1];
    const b = kfs[i];
    const A = vals[i - 1];
    const B = vals[i];
    const u = `((${v}-${n(a.t)})/${n(Math.max(1e-4, b.t - a.t))})`;
    const seg = Math.abs(B - A) < 1e-6 || b.ease === 'hold' ? n(A) : `(${n(A)}+(${n(B - A)})*${curveExpr(b.ease, u)})`;
    e = `if(lt(${v},${n(b.t)}),${seg},${e})`;
  }
  return `if(lt(${v},${n(kfs[0].t)}),${n(vals[0])},${e})`;
}
const varies = (kfs: Keyframe[] | null, get: (k: Keyframe) => number) => !!kfs && kfs.some((k) => Math.abs(get(k) - get(kfs[0])) > 1e-6);

export async function exportProject(src: Project, opts: ExportOpts, baseUrl: string, update: (p: number, m?: string) => void) {
  const p: Project = JSON.parse(JSON.stringify(src));
  const preset = opts.preset ? EXPORT_PRESETS.find((x) => x.id === opts.preset) : undefined;
  if (opts.preset && !preset) throw Object.assign(new Error(`Unknown preset "${opts.preset}". Presets: ${EXPORT_PRESETS.map((x) => x.id).join(', ')}`), { status: 400 });
  if (preset) opts = { ...opts, width: preset.width, height: preset.height, fps: opts.fps || preset.fps };
  if (opts.fps) p.fps = opts.fps;
  const { width: W, height: H, fps } = p;
  const total = projectDuration(p);
  if (total <= 0) throw new Error('The timeline is empty, there is nothing to export');
  const totalFrames = Math.ceil(total * fps - 1e-6);
  const D = totalFrames / fps;
  const work = path.join(DIRS.tmp, uid('x_'));
  fs.mkdirSync(work, { recursive: true });

  // Text layers are drawn by the browser, one picture stream per band: the text tracks that sit between the same two
  // video layers. Usually all text is above all video (one band, laid over last); a title placed below a video
  // layer, such as text behind a person whose background was removed, gets its own band under that layer.
  const bands = textBands(p);
  update(0, 'Rendering text');
  const bandLists = new Map<number, string>();
  for (const [bi, band] of bands.entries()) {
    const dir = path.join(work, `text${bi}`);
    fs.mkdirSync(dir, { recursive: true });
    const only: Project = { ...p, tracks: p.tracks.filter((t) => (t.kind !== 'text' && t.kind !== 'caption') || band.ids.has(t.id)) };
    const list = await renderTextLayer(only, dir, baseUrl, totalFrames, (f) => update(((bi + f) / bands.length) * 0.15, 'Rendering text'));
    if (list) bandLists.set(band.below, list);
  }
  const textList = bandLists.get(-1) || null;
  const overlayText = (list: string, tag: string) => {
    const idx = addInput('-f', 'concat', '-safe', '0', '-i', list);
    filters.push(`[${idx}:v]fps=${fps},format=rgba[txt${tag}]`, `${last}[txt${tag}]overlay=eof_action=pass:format=auto[otxt${tag}]`);
    last = `[otxt${tag}]`;
  };

  const inputs: string[] = [];
  const filters: string[] = [];
  let ni = 0;
  const addInput = (...args: string[]) => (inputs.push(...args), ni++);
  addInput('-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${fps}:d=${n(D)}`);
  const silent = addInput('-f', 'lavfi', '-t', n(D), '-i', 'anullsrc=r=48000:cl=stereo');
  let last = '[base]';
  filters.push(`[0:v]format=yuv420p[base]`);
  const audio: string[] = [`[${silent}:a]`];
  let label = 0;
  const k = Math.min(W, H) / 1080;

  const audioChain = (idx: number, clip: Clip) => {
    const f: string[] = ['asetpts=PTS-STARTPTS'];
    let s = clip.speed;
    while (s < 0.5) (f.push('atempo=0.5'), (s /= 0.5));
    while (s > 2) (f.push('atempo=2'), (s /= 2));
    if (Math.abs(s - 1) > 1e-3) f.push(`atempo=${n(s)}`);
    f.push('aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo', `atrim=duration=${n(clip.duration)}`);
    if (clip.volume !== 1) f.push(`volume=${n(clip.volume)}`);
    const [fin, fout] = audioFades(clip);
    if (fin > 0) f.push(`afade=t=in:st=0:d=${n(fin)}`);
    if (fout > 0) f.push(`afade=t=out:st=${n(Math.max(0, clip.duration - fout))}:d=${n(fout)}`);
    f.push(`adelay=${Math.round(clip.start * 1000)}:all=1`);
    const out = `[a${label++}]`;
    filters.push(`[${idx}:a]${f.join(',')}${out}`);
    audio.push(out);
  };

  // Bottom layer first.
  for (let ti = p.tracks.length - 1; ti >= 0; ti--) {
    const track = p.tracks[ti];
    if (track.kind === 'audio') {
      if (track.muted) continue;
      for (const clip of track.clips) {
        const asset = p.assets.find((a) => a.id === clip.assetId);
        if (!asset || clip.muted || clip.volume <= 0) continue;
        audioChain(addInput('-ss', n(clip.in), '-t', n(clip.duration * clip.speed), '-i', asset.path), clip);
      }
      continue;
    }
    if (track.kind !== 'video') continue;
    const band = bandLists.get(ti);
    if (band) overlayText(band, `b${ti}`);
    for (const clip of track.clips) {
      const asset = p.assets.find((a) => a.id === clip.assetId);
      if (!asset) continue;
      const audible = asset.hasAudio && !clip.muted && !track.muted && clip.volume > 0;
      if (track.hidden && !audible) continue;
      let idx: number;
      if (clip.type === 'image') {
        idx = /\.gif$/i.test(asset.path) ? addInput('-ignore_loop', '0', '-t', n(clip.duration), '-i', asset.path) : addInput('-loop', '1', '-framerate', String(fps), '-t', n(clip.duration), '-i', asset.path);
      } else if (asset.alpha) {
        // ffmpeg's built-in VP9 decoder drops the alpha channel; libvpx keeps it.
        idx = addInput('-c:v', 'libvpx-vp9', '-ss', n(clip.in), '-t', n(clip.duration * clip.speed), '-i', asset.path);
      } else idx = addInput('-ss', n(clip.in), '-t', n(clip.duration * clip.speed), '-i', asset.path);
      if (audible) audioChain(idx, clip);
      if (track.hidden) continue;

      // Keyframes: the picture is prepared at its largest size, then shrunk frame by frame, so a zoom stays sharp.
      const kfs = clip.keyframes?.length ? clip.keyframes : null;
      const first = kfs ? kfs[0] : clip.transform;
      const sMax = kfs ? Math.max(...kfs.map((q) => q.scale)) : clip.transform.scale;
      const moveS = varies(kfs, (q) => q.scale);
      const moveR = varies(kfs, (q) => q.rotation);
      const moveO = varies(kfs, (q) => q.opacity);
      const local = 't'; // filters before the final setpts see the clip's own time
      const main = `(t-${n(clip.start)})`; // the overlay sees timeline time
      const r = mediaRect(p, asset, clip, { ...first, scale: sMax });
      const w0 = Math.max(2, Math.round(r.w / 2) * 2);
      const h0 = Math.max(2, Math.round(r.h / 2) * 2);
      const f: string[] = [`setpts=(PTS-STARTPTS)/${n(clip.speed)}`, `fps=${fps}`, `scale=${w0}:${h0}:flags=bicubic`, 'setsar=1'];
      const { fx, tin, tout } = clip;
      const tf = first;
      if (fx.brightness !== 1) f.push(`colorchannelmixer=rr=${n(fx.brightness)}:gg=${n(fx.brightness)}:bb=${n(fx.brightness)}`);
      if (fx.contrast !== 1 || fx.saturation !== 1) f.push(`eq=contrast=${n(fx.contrast)}:saturation=${n(fx.saturation)}`);
      if (fx.blur > 0) f.push(`gblur=sigma=${n(fx.blur * k)}`);
      const hasIn = tin.type !== 'none' && tin.duration > 0;
      const hasOut = tout.type !== 'none' && tout.duration > 0;
      const tIn = hasIn ? tin.type : 'none';
      const tOut = hasOut ? tout.type : 'none';
      const dur = n(clip.duration);
      // Progress 0..1 in the clip's own time. `v` is the time variable of the filter (t, or T in blend / geq).
      const pIn = (v: string) => `min(1,max(0,${v}/${n(tin.duration)}))`;
      const pOut = (v: string) => `min(1,max(0,(${dur}-${v})/${n(tout.duration)}))`;
      // True only while a transition runs, so the slow per-pixel filters skip the rest of the clip.
      const during = (inOn: boolean, outOn: boolean) => [inOn && `lt(t,${n(tin.duration)})`, outOn && `gt(t,${n(clip.duration - tout.duration)})`].filter(Boolean).join('+');

      // Blur transition: mix the sharp picture with a blurred copy.
      if (tIn === 'blur' || tOut === 'blur') {
        const id = label++;
        const on = during(tIn === 'blur', tOut === 'blur');
        const mix = [tIn === 'blur' && pIn('T'), tOut === 'blur' && pOut('T')].filter(Boolean).join('*');
        f.push(`format=yuv420p,split[bs${id}][bt${id}];[bt${id}]gblur=sigma=${n(BLUR_PX * k)}:enable='${on}'[bb${id}];[bs${id}][bb${id}]blend=all_expr='A*(${mix})+B*(1-(${mix}))':enable='${on}'`);
      }
      // Flash (from / to white) and dip (from / to black).
      for (const [type, color] of [
        ['flash', 'white'],
        ['dip', 'black'],
      ]) {
        if (tIn === type || tOut === type) f.push('format=rgb24');
        if (tIn === type) f.push(`fade=t=in:st=0:d=${n(tin.duration)}:color=${color}`);
        if (tOut === type) f.push(`fade=t=out:st=${n(Math.max(0, clip.duration - tout.duration))}:d=${n(tout.duration)}:color=${color}`);
      }
      const fadeIn = tIn === 'fade' || ZOOMING.includes(tIn);
      const fadeOut = tOut === 'fade' || ZOOMING.includes(tOut);
      const wipeIn = tIn.startsWith('wipe');
      const wipeOut = tOut.startsWith('wipe');
      const spin = tIn === 'spin' || tOut === 'spin';
      const rot = ((tf.rotation % 360) * Math.PI) / 180;
      const alpha = clip.type === 'image' || !!asset.alpha || tf.opacity < 1 || moveO || moveR || fadeIn || fadeOut || wipeIn || wipeOut || spin || rot !== 0;
      f.push(alpha ? 'format=rgba' : 'format=yuv420p');
      if (moveO) {
        // animated opacity: the alpha plane is multiplied by the keyframed value, frame by frame
        const id = label++;
        f.push(`format=yuva444p,split[oa${id}][ob${id}];[oa${id}][ob${id}]blend=c3_expr='A*(${keyExpr(kfs!, (q) => q.opacity, 'T')})',format=rgba`);
      } else if (tf.opacity < 1) f.push(`colorchannelmixer=aa=${n(tf.opacity)}`);
      if (fadeIn) f.push(`fade=t=in:st=0:d=${n(tin.type === 'fade' ? tin.duration : tin.duration / 2)}:alpha=1`);
      if (fadeOut) {
        const d = tout.type === 'fade' ? tout.duration : tout.duration / 2;
        f.push(`fade=t=out:st=${n(Math.max(0, clip.duration - d))}:d=${n(d)}:alpha=1`);
      }
      // Wipes: the alpha channel is cut along a moving edge.
      if (wipeIn || wipeOut) {
        const edge = (type: string, p: string) => ({ 'wipe-right': `lte(X,W*${p})`, 'wipe-left': `gte(X,W*(1-${p}))`, 'wipe-down': `lte(Y,H*${p})`, 'wipe-up': `gte(Y,H*(1-${p}))` })[type]!;
        const cond = [wipeIn && edge(tIn, pIn('T')), wipeOut && edge(tOut, pOut('T'))].filter(Boolean).join('*');
        f.push(`format=gbrap,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*${cond}':enable='${during(wipeIn, wipeOut)}',format=rgba`);
      }
      let cw = w0;
      let ch = h0;
      if (spin || moveR) {
        // The clip turns inside a square big enough for any angle.
        const spinRad = (SPIN_DEG * Math.PI) / 180;
        let angle = moveR ? `(${keyExpr(kfs!, (q) => (q.rotation * Math.PI) / 180, local)})` : n(rot);
        if (tIn === 'spin') angle += `-${n(spinRad)}*(1-${easeExpr(pIn('t'))})`;
        if (tOut === 'spin') angle += `+${n(spinRad)}*(1-${easeExpr(pOut('t'))})`;
        cw = ch = Math.ceil(Math.hypot(w0, h0) / 2) * 2;
        f.push(`rotate='${angle}':ow=${cw}:oh=${ch}:c=black@0`);
      } else if (rot !== 0) {
        f.push(`rotate=${n(rot)}:ow=rotw(${n(rot)}):oh=roth(${n(rot)}):c=black@0`);
        cw = Math.abs(w0 * Math.cos(rot)) + Math.abs(h0 * Math.sin(rot));
        ch = Math.abs(w0 * Math.sin(rot)) + Math.abs(h0 * Math.cos(rot));
      }
      // Zooming transitions change the clip's size frame by frame while it fades.
      const zf = (type: string, e: string) => (type === 'zoom-out' ? `(1.5-0.5*${e})` : `(0.6+0.4*${e})`);
      const zoomIn = ZOOMING.includes(tIn);
      const zoomOut = ZOOMING.includes(tOut);
      let zLocal = '1';
      let zMain = '1';
      if (zoomIn) {
        zLocal += `*${zf(tIn, easeExpr(pIn('t')))}`;
        zMain += `*${zf(tIn, easeExpr(progressExpr(clip, tin, true)))}`;
      }
      if (zoomOut) {
        zLocal += `*${zf(tOut, easeExpr(pOut('t')))}`;
        zMain += `*${zf(tOut, easeExpr(progressExpr(clip, tout, false)))}`;
      }
      if (moveS) {
        zLocal += `*(${keyExpr(kfs!, (q) => q.scale / sMax, local)})`;
        zMain += `*(${keyExpr(kfs!, (q) => q.scale / sMax, main)})`;
      }
      if (zoomIn || zoomOut || moveS) f.push(`scale=w='max(2,${n(cw)}*${zLocal})':h='max(2,${n(ch)}*${zLocal})':eval=frame`);
      f.push(`setpts=PTS+${n(clip.start)}/TB`);
      const v = `[v${label++}]`;
      filters.push(`[${idx}:v]${f.join(',')}${v}`);

      const cx = kfs ? `(${keyExpr(kfs, (q) => q.x * W, main)})` : n(r.cx);
      const cy = kfs ? `(${keyExpr(kfs, (q) => q.y * H, main)})` : n(r.cy);
      let x = `${cx}-${n(cw)}*(${zMain})/2`;
      let y = `${cy}-${n(ch)}*(${zMain})/2`;
      const slide = (tr: Transition, isIn: boolean) => {
        const off = `(1-${easeExpr(progressExpr(clip, tr, isIn))})`;
        const dir = isIn ? 1 : -1;
        if (tr.type === 'slide-left') x += `+${dir * W}*${off}`;
        if (tr.type === 'slide-right') x += `+${-dir * W}*${off}`;
        if (tr.type === 'slide-up') y += `+${dir * H}*${off}`;
        if (tr.type === 'slide-down') y += `+${-dir * H}*${off}`;
      };
      if (hasIn) slide(tin, true);
      if (hasOut) slide(tout, false);
      const out = `[o${label++}]`;
      const on = `between(t,${n(clip.start)},${n(clipEnd(clip) - 0.5 / fps)})`;
      const blend = BLEND_MODES.includes(clip.blend as BlendMode) && clip.blend !== 'normal' ? clip.blend : null;
      if (blend) {
        // A blend mode mixes the clip with everything under it. ffmpeg's blend needs two whole frames of the same
        // size, so the clip is first laid on a frame of the colour that leaves the picture unchanged in that mode
        // (black for screen / lighten, white for multiply, mid grey for overlay), then blended in RGB.
        const pad = blend === 'multiply' ? 'white' : blend === 'overlay' ? '0x808080' : 'black';
        const id = label++;
        const bg = addInput('-f', 'lavfi', '-i', `color=c=${pad}:s=${W}x${H}:r=${fps}:d=${n(D)}`);
        filters.push(`[${bg}:v]format=rgba[bk${id}]`);
        filters.push(`[bk${id}]${v}overlay=x='${x}':y='${y}':eval=frame:eof_action=pass:format=auto,format=gbrp[bl${id}]`);
        filters.push(`${last}format=gbrp[bb${id}]`);
        filters.push(`[bb${id}][bl${id}]blend=all_mode=${blend}:shortest=1:enable='${on}',format=yuv420p${out}`);
      } else {
        filters.push(`${last}${v}overlay=x='${x}':y='${y}':eval=frame:eof_action=pass:format=auto:enable='${on}'${out}`);
      }
      last = out;
    }
  }

  if (textList) overlayText(textList, 'top');
  // Output size. Same shape as the project: a plain resize. Another shape (a preset, or width and height): reframe.
  let outW = 0;
  let outH = opts.height && opts.height !== H ? Math.round(opts.height / 2) * 2 : 0;
  if (opts.width && opts.height) {
    outW = Math.round(opts.width / 2) * 2;
    outH = Math.round(opts.height / 2) * 2;
    if (outW === W && outH === H) outW = outH = 0;
  }
  const sameShape = !outW || Math.abs(outW / outH - W / H) < 0.01;
  // The final frame size, so the watermark keeps its corner and size in every preset.
  const finalW = outW || (outH ? Math.round((W * outH) / H / 2) * 2 : W);
  const finalH = outH || H;
  const wm = p.watermark;
  const wmAsset = wm ? p.assets.find((a) => a.id === wm.assetId && a.kind === 'image') : undefined;
  const sized = wmAsset ? '[vsized]' : '[vout]';
  if (outW && !sameShape) {
    if ((opts.reframe || 'fit') === 'fill') filters.push(`${last}scale=${outW}:${outH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${outW}:${outH},setsar=1,format=yuv420p${sized}`);
    else
      filters.push(
        `${last}split[rf1][rf2]`,
        `[rf1]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},gblur=sigma=${Math.round(Math.max(outW, outH) / 40)},eq=brightness=-0.12:saturation=1.1[rfb]`,
        `[rf2]scale=${outW}:${outH}:force_original_aspect_ratio=decrease:flags=lanczos,setsar=1[rff]`,
        `[rfb][rff]overlay=(W-w)/2:(H-h)/2,format=yuv420p${sized}`,
      );
  } else filters.push(`${last}${outW ? `scale=${outW}:${outH}:flags=lanczos,` : outH ? `scale=-2:${outH}:flags=lanczos,` : ''}format=yuv420p${sized}`);
  if (wm && wmAsset) {
    const r = watermarkRect(finalW, finalH, wmAsset, wm);
    const idx = addInput('-loop', '1', '-framerate', String(fps), '-t', n(D), '-i', wmAsset.path);
    // not over the brand's intro and outro cards, which show the logo big
    const cards = brandCardRanges(p);
    const enable = cards.length ? `:enable='not(${cards.map(([s, e]) => `between(t,${n(s)},${n(e - 1 / fps)})`).join('+')})'` : '';
    filters.push(`[${idx}:v]scale=${r.w}:${r.h}:flags=lanczos,format=rgba,colorchannelmixer=aa=${n(wm.opacity)}[wm]`, `[vsized][wm]overlay=${r.x}:${r.y}:format=auto:eof_action=repeat${enable},format=yuv420p[vout]`);
  }
  filters.push(`${audio.join('')}amix=inputs=${audio.length}:normalize=0:duration=first:dropout_transition=0,alimiter=limit=0.97[aout]`);

  const graph = path.join(work, 'graph.txt');
  fs.writeFileSync(graph, filters.join(';\n'));
  const safe = (opts.filename || p.name || 'export').replace(/[^\w\u0590-\u05FF.-]+/g, '_').replace(/\.mp4$/i, '') || 'export';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
  // The platform goes into the name, and a file never replaces another (several exports can finish in one minute).
  const base0 = `${safe}${preset ? `-${preset.id}` : ''}-${stamp}`;
  let outFile = path.join(DIRS.exports, `${base0}.mp4`);
  for (let i = 2; fs.existsSync(outFile); i++) outFile = path.join(DIRS.exports, `${base0}-${i}.mp4`);
  const q = opts.quality || 'high';
  const nv = await hasNvenc();
  const codec = nv
    ? ['-c:v', 'h264_nvenc', '-preset', q === 'draft' ? 'p3' : 'p6', '-rc', 'vbr', '-cq', { high: '18', medium: '23', draft: '29' }[q], '-b:v', '0']
    : ['-c:v', 'libx264', '-preset', q === 'draft' ? 'veryfast' : 'medium', '-crf', { high: '17', medium: '21', draft: '27' }[q]];
  if (preset) codec.push('-maxrate', `${preset.maxrate}M`, '-bufsize', `${preset.maxrate * 2}M`);
  const a = Math.max(0, opts.start ?? 0);
  const b = Math.min(D, opts.end ?? D);
  const span = Math.max(1 / fps, b - a);
  const args = ['-hide_banner', '-v', 'error', '-progress', 'pipe:1', ...inputs, '-/filter_complex', graph, '-map', '[vout]', '-map', '[aout]', ...(a > 0 ? ['-ss', n(a)] : []), '-t', n(span), '-r', String(fps), ...codec, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-y', outFile];
  const base = textList ? 0.15 : 0;
  update(base, 'Encoding');
  try {
    await run(FFMPEG, args, {
      onStdout: (s) => {
        const m = /out_time_ms=(\d+)/.exec(s);
        if (m) update(base + (1 - base) * Math.min(1, Number(m[1]) / 1e6 / span), 'Encoding');
      },
    });
  } finally {
    if (!process.env.STUDIO_KEEP_TMP) fs.rmSync(work, { recursive: true, force: true });
  }
  return { file: outFile, url: `/exports/${encodeURIComponent(path.basename(outFile))}`, duration: span, width: finalW, height: finalH, preset: preset?.id, fps, encoder: nv ? 'h264_nvenc' : 'libx264', size: fs.statSync(outFile).size };
}
