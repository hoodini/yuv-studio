// Text to speech and voice cloning through the Cartesia API (https://docs.cartesia.ai).
// The key never leaves this machine except in the Authorization header sent to Cartesia.
import fs from 'node:fs';
import path from 'node:path';
import { addMediaClip } from '../shared/ops';
import type { Asset, Project } from '../shared/types';
import { clipEnd, uid } from '../shared/types';
import { fetchPublic, looksLikeMedia } from './fetchUrl';
import { FFMPEG, importAsset, run } from './media';
import { saveSettings, voiceConfig } from './settings';
import { DIRS, loadProject, mutate } from './store';

const API_VERSION = '2026-08-14';
/** Cartesia accepts clips up to 16 MB; a clone needs only a few seconds of clean speech. */
const CLONE_MAX_SECONDS = 30;
const CLONE_MIN_SECONDS = 3;
const PREVIEW_MAX_BYTES = 20 * 1024 * 1024;

export interface Voice {
  id: string;
  name: string;
  description: string;
  language: string;
  gender: string | null;
  mine: boolean;
  hasPreview: boolean;
}

function config() {
  const c = voiceConfig();
  if (!c.apiKey) throw Object.assign(new Error('No Cartesia API key. Add one in the Voice tab settings (or set CARTESIA_API_KEY).'), { status: 400 });
  return c;
}

async function cartesia(pathname: string, init: RequestInit = {}) {
  const c = config();
  let res: Response;
  try {
    res = await fetch(c.baseUrl + pathname, { ...init, headers: { authorization: `Bearer ${c.apiKey}`, 'cartesia-version': API_VERSION, ...(init.headers || {}) } });
  } catch (e: any) {
    throw new Error(`Could not reach Cartesia at ${c.baseUrl}: ${e?.cause?.message || e?.message || e}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let detail = body;
    try {
      const j = JSON.parse(body);
      detail = j.message || j.error?.message || j.error || j.title || body;
    } catch {}
    const hint = res.status === 401 || res.status === 403 ? ' Check the API key.' : res.status === 402 || res.status === 429 ? ' Check the plan limits and credits of the Cartesia account.' : '';
    throw Object.assign(new Error(`Cartesia answered ${res.status}: ${String(detail).slice(0, 300) || res.statusText}.${hint}`), { status: 502 });
  }
  return res;
}

const toVoice = (v: any): Voice => ({
  id: String(v.id),
  name: String(v.name || v.id),
  description: String(v.tagline || v.description || ''),
  language: String(v.language || v.accents?.find((a: any) => a.is_native)?.locale || ''),
  gender: v.gender ?? null,
  mine: !!v.is_owner,
  hasPreview: !!v.preview_file_url,
});

/** One page of voices (up to 100). `mine` = voices this account owns, including clones. */
export async function listVoices(o: { q?: string; language?: string; mine?: boolean } = {}): Promise<{ voices: Voice[]; more: boolean }> {
  const qs = new URLSearchParams({ limit: '100' });
  qs.append('expand[]', 'preview_file_url');
  if (o.q) qs.set('q', o.q);
  if (o.language) qs.set('language', o.language);
  if (o.mine) qs.set('is_owner', 'true');
  const data: any = await (await cartesia(`/voices?${qs}`)).json();
  return { voices: (data.data || []).map(toVoice), more: !!data.has_more };
}

const SAMPLE_TEXT: Record<string, string> = { he: 'שלום, כך נשמע הקול הזה.', en: 'Hello, this is how this voice sounds.' };
const SAMPLES = path.join(DIRS.cache, 'voice-samples');

/**
 * A short clip to hear a voice by. Cartesia's own sample when the voice has one; otherwise (cloned voices and
 * many library voices have none) one short sentence is generated once and kept on disk.
 */
export async function voicePreview(id: string, language = ''): Promise<{ type: string; body: Buffer }> {
  const c = config();
  const lang = language === 'he' ? 'he' : 'en';
  const cached = path.join(SAMPLES, `${id.replace(/[^\w-]/g, '')}_${lang}.wav`);
  if (fs.existsSync(cached)) return { type: 'audio/wav', body: fs.readFileSync(cached) };
  const v: any = await (await cartesia(`/voices/${encodeURIComponent(id)}?expand[]=preview_file_url`)).json();
  if (!v.preview_file_url) {
    const res = await cartesia('/tts/bytes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model_id: c.model, transcript: SAMPLE_TEXT[lang], voice: { id }, language: lang, output_format: { container: 'wav', encoding: 'pcm_s16le', sample_rate: 44100 } }),
    });
    const body = Buffer.from(await res.arrayBuffer());
    if (!looksLikeMedia(body.subarray(0, 16))) throw Object.assign(new Error('Cartesia returned no audio for the sample'), { status: 502 });
    fs.mkdirSync(SAMPLES, { recursive: true });
    fs.writeFileSync(cached, body);
    return { type: 'audio/wav', body };
  }
  const url = new URL(v.preview_file_url, c.baseUrl);
  let clip: { type: string; body: Buffer };
  if (url.origin === new URL(c.baseUrl).origin) {
    // The sample lives on the API host itself: same request as every other call, with the key.
    const res = await cartesia(url.pathname + url.search);
    clip = { type: (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(), body: Buffer.from(await res.arrayBuffer()) };
  } else {
    // Another host: https only, public addresses only, at most 20 MB. Cartesia keeps samples on its own file
    // host, which asks for the key; the key goes to hosts under the API's own domain and nowhere else.
    const home = new URL(c.baseUrl).hostname.split('.').slice(-2).join('.');
    const keyFor = (u: URL): Record<string, string> => (u.hostname === home || u.hostname.endsWith(`.${home}`) ? { authorization: `Bearer ${c.apiKey}`, 'cartesia-version': API_VERSION } : {});
    clip = await fetchPublic(url.href, PREVIEW_MAX_BYTES, keyFor).catch((e) => {
      throw Object.assign(new Error(`Could not load the sample clip: ${e.message}`), { status: 502 });
    });
  }
  // Whatever the address returned is only passed on if it really is audio, and always labelled as audio.
  if (!looksLikeMedia(clip.body.subarray(0, 16))) throw Object.assign(new Error('The sample clip is not an audio file'), { status: 502 });
  return { type: clip.type.startsWith('audio/') ? clip.type : 'audio/wav', body: clip.body };
}

/** Hebrew letters in the text mean Hebrew; otherwise English. */
export const guessLanguage = (text: string) => (/[֐-׿]/.test(text) ? 'he' : 'en');

export interface SpeakOptions {
  text: string;
  voiceId?: string;
  voiceName?: string;
  language?: string;
  speed?: number;
  emotion?: string;
  /** Timeline time for the clip. Without it the audio is only added to the media list. */
  start?: number;
  addToTimeline?: boolean;
  trackId?: string;
}

/** Turn text into speech, save it as an audio asset of the project and (optionally) place it on the timeline. */
export async function speak(projectId: string, o: SpeakOptions, origin = 'server') {
  loadProject(projectId);
  const text = String(o.text || '').trim();
  if (!text) throw Object.assign(new Error('There is no text to speak'), { status: 400 });
  const c = config();
  const voiceId = o.voiceId || c.voiceId;
  if (!voiceId) throw Object.assign(new Error('No voice chosen. Pick one with list_voices (or in the Voice tab) and pass voiceId.'), { status: 400 });
  const language = !o.language || o.language === 'auto' ? guessLanguage(text) : o.language;
  const generation: Record<string, any> = {};
  if (o.speed != null && Number(o.speed) !== 1) generation.speed = Math.max(0.6, Math.min(1.5, Number(o.speed)));
  if (o.emotion) generation.emotion = String(o.emotion);
  const res = await cartesia('/tts/bytes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model_id: c.model,
      transcript: text,
      voice: { id: voiceId },
      language,
      output_format: { container: 'wav', encoding: 'pcm_s16le', sample_rate: 44100 },
      ...(Object.keys(generation).length ? { generation_config: generation } : {}),
    }),
  });
  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.length < 1000) throw new Error('Cartesia returned no audio for this text');
  const file = path.join(DIRS.media, `${uid('vo_')}.wav`);
  fs.writeFileSync(file, audio);
  let asset: Asset;
  try {
    const label = text.replace(/\s+/g, ' ');
    asset = await importAsset(projectId, file, `VO · ${label.length > 40 ? label.slice(0, 40) + '…' : label}`, origin);
  } catch (e) {
    fs.rmSync(file, { force: true });
    throw e;
  }
  if (o.voiceId && o.voiceId !== c.voiceId) saveSettings({ voice: { voiceId: o.voiceId, voiceName: o.voiceName || '' } });
  const place = o.addToTimeline ?? o.start != null;
  const clip = place ? mutate(projectId, (p) => addMediaClip(p, asset.id, { start: o.start, trackId: o.trackId }), origin) : undefined;
  return { asset, clip, voiceId, language, model: c.model, characters: text.length };
}

export interface CloneOptions {
  name: string;
  language?: string;
  /** Take the sample from this timeline clip (its own in / duration)... */
  clipId?: string;
  /** ...or from this asset, optionally a part of it. */
  assetId?: string;
  from?: number;
  duration?: number;
}

/** Create a voice from a few seconds of speech in the project. Returns the new voice. */
export async function cloneVoice(projectId: string, o: CloneOptions): Promise<Voice> {
  const p: Project = loadProject(projectId);
  const name = String(o.name || '').trim();
  if (!name) throw Object.assign(new Error('Give the voice a name'), { status: 400 });
  config();
  let assetId = o.assetId;
  let from = Number(o.from) || 0;
  let duration = o.duration != null ? Number(o.duration) : undefined;
  if (o.clipId) {
    const clip = p.tracks.flatMap((t) => t.clips).find((c) => c.id === o.clipId);
    if (!clip?.assetId) throw Object.assign(new Error('Select a video or audio clip that contains the voice'), { status: 400 });
    assetId = clip.assetId;
    from = clip.in || 0;
    duration = (clipEnd(clip) - clip.start) * (clip.speed || 1);
  }
  const asset = p.assets.find((a) => a.id === assetId);
  if (!asset) throw Object.assign(new Error('Choose the clip or asset that contains the voice'), { status: 400 });
  if (!asset.hasAudio) throw Object.assign(new Error('That clip has no sound'), { status: 400 });
  const length = Math.min(CLONE_MAX_SECONDS, duration ?? asset.duration - from, asset.duration - from);
  if (!(length >= CLONE_MIN_SECONDS)) throw Object.assign(new Error(`The sample must be at least ${CLONE_MIN_SECONDS} seconds of speech`), { status: 400 });
  const sample = path.join(DIRS.tmp, `${uid('clone_')}.wav`);
  try {
    await run(FFMPEG, ['-v', 'error', '-ss', from.toFixed(3), '-t', length.toFixed(3), '-i', asset.path, '-vn', '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', '-y', sample]);
    const form = new FormData();
    form.append('clip', new Blob([fs.readFileSync(sample)], { type: 'audio/wav' }), 'sample.wav');
    form.append('name', name.slice(0, 80));
    form.append('language', o.language && o.language !== 'auto' ? o.language : 'he');
    const voice = toVoice({ ...(await (await cartesia('/voices/clone', { method: 'POST', body: form })).json()), is_owner: true });
    saveSettings({ voice: { voiceId: voice.id, voiceName: voice.name } });
    return voice;
  } finally {
    fs.rmSync(sample, { force: true });
  }
}
