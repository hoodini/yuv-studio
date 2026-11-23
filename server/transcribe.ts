// Speech to text with word timings. Two engines:
//   local  - faster-whisper on this computer (server/transcribe.py), free and private, wants a GPU
//   cloud  - an API (OpenAI, Groq, ElevenLabs or any OpenAI-compatible server) for machines without one
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Asset, Word } from '../shared/types';
import { FFMPEG, assetCache, run } from './media';
import { loadSettings, sttConfig } from './settings';
import { ROOT } from './store';

export type Lang = 'he' | 'en' | 'auto';
export type Engine = 'local' | 'cloud';
export interface Transcript {
  language: string;
  model: string;
  device: string;
  engine?: Engine;
  words: Word[];
}

/** Hebrew uses the ivrit.ai fine-tune, which is far more accurate for Hebrew than stock Whisper. */
const MODELS: Record<Lang, string> = {
  he: process.env.WHISPER_MODEL_HE || 'ivrit-ai/whisper-large-v3-turbo-ct2',
  en: process.env.WHISPER_MODEL_EN || 'large-v3',
  auto: process.env.WHISPER_MODEL_AUTO || 'large-v3',
};

// Which Python has faster-whisper. Importing it takes seconds (it loads ctranslate2 and the CUDA libraries) and has
// hung for over an hour under load, so the check never runs synchronously: a blocking spawnSync here once froze the
// whole server, remote access included. It runs in the background with a time limit; until it ends, local
// transcription counts as "checking".
let python: string | null | undefined;
let checking: Promise<string | null> | null = null;
const CANDIDATES = [process.env.STUDIO_PYTHON, 'C:/Python313/python.exe', 'python', 'python3', 'py'].filter(Boolean) as string[];

function canImport(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(cmd, ['-c', 'import faster_whisper'], { windowsHide: true, timeout: 90_000 }, (err) => resolve(!err));
  });
}

/** Resolves to the Python to use (cached), checking the candidates one by one the first time. */
export function checkPython(): Promise<string | null> {
  if (python !== undefined) return Promise.resolve(python);
  checking ??= (async () => {
    for (const c of CANDIDATES) if (await canImport(c)) return (python = c);
    return (python = null);
  })().finally(() => (checking = null));
  return checking;
}

/** The cached answer, without waiting: null while the first check is still running. */
function findPython(): string | null {
  if (python === undefined) void checkPython();
  return python ?? null;
}

export function transcriptionStatus() {
  const s = loadSettings().transcription;
  const c = sttConfig();
  const local = !!findPython();
  const cloud = !!c.apiKey && !!c.baseUrl;
  return { local, cloud, checking: python === undefined, engine: s.engine, provider: c.provider, providerLabel: c.label, willUse: pickEngine(undefined, true) };
}

/** Decide which engine runs. Throws a message the user can act on when nothing is available. */
export function pickEngine(requested?: string, quiet = false): Engine | null {
  const wanted = requested === 'local' || requested === 'cloud' ? requested : loadSettings().transcription.engine;
  const local = !!findPython();
  const c = sttConfig();
  const cloud = !!c.apiKey && !!c.baseUrl;
  const pick = wanted === 'local' ? (local ? 'local' : null) : wanted === 'cloud' ? (cloud ? 'cloud' : null) : local ? 'local' : cloud ? 'cloud' : null;
  if (!pick && !quiet) {
    if (wanted === 'local') throw new Error('Local transcription needs Python with faster-whisper ("pip install faster-whisper", or set STUDIO_PYTHON). You can switch to cloud transcription in the Captions tab.');
    if (wanted === 'cloud') throw new Error('Cloud transcription needs an API key. Add one under Captions > Transcription engine.');
    throw new Error('No transcription engine is available. Install faster-whisper for local transcription, or add an API key under Captions > Transcription engine.');
  }
  return pick;
}

const transcriptFile = (asset: Asset, lang: Lang, verbatim = false) => path.join(assetCache(asset.id), `transcript.${lang}${verbatim ? '.verbatim' : ''}.json`);

/**
 * Whisper leaves out "um" and "uh" unless its prompt shows them. Verbatim mode (used to find and cut filler words)
 * gives it a prompt full of fillers, so it writes them down with their times.
 */
const VERBATIM_PROMPT: Record<Lang, string> = {
  he: 'אממ... אה, אז, אה, אני, אני חושב ש... אממ, כאילו, בעצם... אה.',
  en: 'Umm, uh, so, uh, I, I think... um, like, you know, uh.',
  auto: 'Umm, uh, so, uh, I, I think... um. אממ... אה, אני, אני חושב ש... אה.',
};

export function cachedTranscript(asset: Asset, lang: Lang): Transcript | null {
  const f = transcriptFile(asset, lang);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

type Update = (p: number, m?: string) => void;

async function transcribeLocal(asset: Asset, lang: Lang, update: Update, verbatim = false): Promise<Transcript> {
  const dir = assetCache(asset.id);
  const wav = path.join(dir, 'audio16k.wav');
  update(0, `Extracting audio: ${asset.name}`);
  if (!fs.existsSync(wav)) await run(FFMPEG, ['-v', 'error', '-i', asset.path, '-vn', '-ac', '1', '-ar', '16000', '-y', wav]);
  update(0.03, `Transcribing: ${asset.name}`);
  const out = path.join(dir, `local.${lang}${verbatim ? '.verbatim' : ''}.json`);
  let notes = '';
  await run(findPython()!, [path.join(ROOT, 'server', 'transcribe.py'), wav, lang, out, MODELS[lang], verbatim ? VERBATIM_PROMPT[lang] : ''], {
    onStdout: (s) => {
      for (const line of s.split(/\r?\n/)) {
        const m = /^PROGRESS ([\d.]+)/.exec(line);
        if (m) update(0.03 + 0.97 * Number(m[1]), `Transcribing: ${asset.name}`);
        if (line.startsWith('NOTE')) notes += line + '\n';
      }
    },
  });
  if (notes) console.warn('[transcribe]', notes.trim());
  return { ...JSON.parse(fs.readFileSync(out, 'utf8')), engine: 'local' };
}

/** Send one audio file to the provider and return its words (times relative to that file). */
async function cloudRequest(file: string, lang: Lang, verbatim = false): Promise<{ language: string; words: Word[] }> {
  const c = sttConfig();
  const form = new FormData();
  const blob = new Blob([fs.readFileSync(file)], { type: 'audio/mpeg' });
  let url: string;
  const headers: Record<string, string> = {};
  if (c.provider === 'elevenlabs') {
    url = `${c.baseUrl}/speech-to-text`;
    headers['xi-api-key'] = c.apiKey;
    form.append('file', blob, 'audio.mp3');
    form.append('model_id', c.model);
    form.append('timestamps_granularity', 'word');
    form.append('tag_audio_events', 'false');
    if (lang !== 'auto') form.append('language_code', lang);
  } else {
    url = `${c.baseUrl}/audio/transcriptions`;
    headers.authorization = `Bearer ${c.apiKey}`;
    form.append('file', blob, 'audio.mp3');
    form.append('model', c.model);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    if (lang !== 'auto') form.append('language', lang);
    if (verbatim) form.append('prompt', VERBATIM_PROMPT[lang]);
  }
  const res = await fetch(url, { method: 'POST', headers, body: form }).catch((e) => {
    throw new Error(`Could not reach ${c.label} at ${c.baseUrl} (${e?.cause?.code || e.message}). Check the internet connection and the base URL.`);
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${c.label} answered ${res.status}: ${text.slice(0, 400)}`);
  const data = JSON.parse(text);
  const raw: any[] = data.words || [];
  const words: Word[] = raw
    .filter((w) => !w.type || w.type === 'word')
    .map((w) => ({ text: String(w.text ?? w.word ?? '').trim(), t0: Number(w.start), t1: Number(w.end) }))
    .filter((w) => w.text && Number.isFinite(w.t0) && Number.isFinite(w.t1));
  if (!words.length && (data.text || '').trim()) throw new Error(`${c.label} returned text without word timings. Pick a model that supports word timestamps (OpenAI: whisper-1, Groq: whisper-large-v3, ElevenLabs: scribe_v1).`);
  return { language: data.language || data.language_code || lang, words };
}

async function transcribeCloud(asset: Asset, lang: Lang, update: Update, verbatim = false): Promise<Transcript> {
  const c = sttConfig();
  const dir = path.join(assetCache(asset.id), 'cloud');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  update(0, `Preparing audio: ${asset.name}`);
  // Small mono MP3 in 20-minute parts keeps every upload under the providers' 25 MB limit.
  const part = 1200;
  await run(FFMPEG, ['-v', 'error', '-i', asset.path, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '40k', '-f', 'segment', '-segment_time', String(part), '-reset_timestamps', '1', '-y', path.join(dir, 'part_%03d.mp3')]);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mp3')).sort();
  const words: Word[] = [];
  let language: string = lang;
  try {
    for (let i = 0; i < files.length; i++) {
      update(0.05 + (0.95 * i) / files.length, `Transcribing with ${c.label}: ${asset.name}`);
      const r = await cloudRequest(path.join(dir, files[i]), lang, verbatim);
      language = r.language;
      for (const w of r.words) words.push({ text: w.text, t0: Math.round((w.t0 + i * part) * 1000) / 1000, t1: Math.round((w.t1 + i * part) * 1000) / 1000 });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { language, model: `${c.provider}:${c.model}`, device: 'cloud', engine: 'cloud', words };
}

export async function transcribe(asset: Asset, lang: Lang, update: Update, opts: { force?: boolean; engine?: string; verbatim?: boolean } = {}): Promise<Transcript> {
  if (!asset.hasAudio) return { language: lang, model: '', device: '', words: [] };
  await checkPython();
  const engine = pickEngine(opts.engine)!;
  const v = !!opts.verbatim;
  const f = transcriptFile(asset, lang, v);
  const hit = opts.force || !fs.existsSync(f) ? null : (JSON.parse(fs.readFileSync(f, 'utf8')) as Transcript);
  // A cached transcript is reused unless the caller asked for the other engine explicitly.
  if (hit && (!opts.engine || opts.engine === 'auto' || (hit.engine || 'local') === engine)) return hit;
  const result = engine === 'local' ? await transcribeLocal(asset, lang, update, v) : await transcribeCloud(asset, lang, update, v);
  fs.writeFileSync(f, JSON.stringify(result));
  return result;
}
