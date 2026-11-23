// Studio settings kept on this machine in data/settings.json (never committed, never sent to the browser in full).
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './store';

export type SttProvider = 'openai' | 'groq' | 'elevenlabs' | 'custom';
export interface Settings {
  transcription: {
    /** auto = this computer when Whisper is installed, otherwise the cloud provider. */
    engine: 'auto' | 'local' | 'cloud';
    provider: SttProvider;
    apiKey: string;
    /** Only for `custom`: any OpenAI-compatible /audio/transcriptions server. */
    baseUrl: string;
    /** Empty = the provider's default model. */
    model: string;
  };
  /** Font family new titles start with (bundled, uploaded or imported). Empty = the preset's own font. */
  defaultFont: string;
  /** Text to speech and voice cloning (Cartesia). */
  voice: {
    apiKey: string;
    /** Empty = VOICE_DEFAULT_MODEL. */
    model: string;
    /** The voice used when a request does not name one; the last voice picked in the editor. */
    voiceId: string;
    voiceName: string;
  };
  /** Free stock media keys (Openverse needs none). */
  stock: {
    pexelsKey: string;
    pixabayKey: string;
  };
}

export const STT_DEFAULTS: Record<SttProvider, { baseUrl: string; model: string; env: string; label: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'whisper-1', env: 'OPENAI_API_KEY', label: 'OpenAI Whisper' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3', env: 'GROQ_API_KEY', label: 'Groq Whisper large-v3' },
  elevenlabs: { baseUrl: 'https://api.elevenlabs.io/v1', model: 'scribe_v1', env: 'ELEVENLABS_API_KEY', label: 'ElevenLabs Scribe' },
  custom: { baseUrl: '', model: 'whisper-1', env: 'STUDIO_STT_KEY', label: 'OpenAI-compatible server' },
};
export const VOICE_DEFAULT_MODEL = 'sonic-3.6';

const FILE = path.join(DATA, 'settings.json');
const defaults = (): Settings => ({
  transcription: { engine: 'auto', provider: 'openai', apiKey: '', baseUrl: '', model: '' },
  voice: { apiKey: '', model: '', voiceId: '', voiceName: '' },
  stock: { pexelsKey: '', pixabayKey: '' },
  defaultFont: '',
});

export function loadSettings(): Settings {
  const s = defaults();
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    Object.assign(s.transcription, saved.transcription || {});
    Object.assign(s.voice, saved.voice || {});
    Object.assign(s.stock, saved.stock || {});
    if (typeof saved.defaultFont === 'string') s.defaultFont = saved.defaultFont;
  } catch {}
  return s;
}

export function saveSettings(patch: { transcription?: Partial<Settings['transcription']>; voice?: Partial<Settings['voice']>; stock?: Partial<Settings['stock']>; defaultFont?: string }) {
  const s = loadSettings();
  const t = patch.transcription || {};
  if (t.engine && ['auto', 'local', 'cloud'].includes(t.engine)) s.transcription.engine = t.engine;
  const before = { provider: s.transcription.provider, baseUrl: s.transcription.baseUrl };
  if (t.provider && t.provider in STT_DEFAULTS) s.transcription.provider = t.provider;
  if (typeof t.baseUrl === 'string') s.transcription.baseUrl = t.baseUrl.trim().replace(/\/$/, '');
  // A saved key goes only to the service it was saved for: changing the provider or the address forgets it,
  // so nobody can point a saved key at their own server.
  if (s.transcription.provider !== before.provider || (s.transcription.provider === 'custom' && s.transcription.baseUrl !== before.baseUrl)) s.transcription.apiKey = '';
  if (typeof t.apiKey === 'string') s.transcription.apiKey = t.apiKey.trim();
  if (typeof t.model === 'string') s.transcription.model = t.model.trim();
  const v = patch.voice || {};
  if (typeof v.apiKey === 'string') s.voice.apiKey = v.apiKey.trim();
  if (typeof v.model === 'string') s.voice.model = v.model.trim();
  if (typeof v.voiceId === 'string') s.voice.voiceId = v.voiceId.trim();
  if (typeof v.voiceName === 'string') s.voice.voiceName = v.voiceName.trim().slice(0, 120);
  if (typeof patch.defaultFont === 'string') s.defaultFont = patch.defaultFont.trim().slice(0, 80);
  const k = patch.stock || {};
  if (typeof k.pexelsKey === 'string') s.stock.pexelsKey = k.pexelsKey.trim();
  if (typeof k.pixabayKey === 'string') s.stock.pixabayKey = k.pixabayKey.trim();
  // The file holds API keys: owner-only where the OS supports it.
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
  return s;
}

/** The provider, key and endpoint to use. The key in settings wins; otherwise the provider's environment variable. */
export function sttConfig(s = loadSettings()) {
  const t = s.transcription;
  const d = STT_DEFAULTS[t.provider];
  // A custom server's address can be changed in the settings, so it only ever gets the key saved for it (which is
  // forgotten when the address changes), never a key from the environment. Named providers have a fixed address.
  const apiKey = t.provider === 'custom' ? t.apiKey : t.apiKey || process.env[d.env] || process.env.STUDIO_STT_KEY || '';
  return { provider: t.provider, apiKey, baseUrl: (t.provider === 'custom' ? t.baseUrl : d.baseUrl) || d.baseUrl, model: t.model || d.model, label: d.label };
}

/** Cartesia key, model and default voice. The key in settings wins; otherwise CARTESIA_API_KEY. */
export function voiceConfig(s = loadSettings()) {
  return {
    apiKey: s.voice.apiKey || process.env.CARTESIA_API_KEY || '',
    baseUrl: (process.env.CARTESIA_BASE_URL || 'https://api.cartesia.ai').replace(/\/$/, ''),
    model: s.voice.model || VOICE_DEFAULT_MODEL,
    voiceId: s.voice.voiceId,
    voiceName: s.voice.voiceName,
  };
}

/** What the browser may see: everything except the keys themselves. */
export function publicSettings() {
  const s = loadSettings();
  const c = sttConfig(s);
  const v = voiceConfig(s);
  return {
    transcription: { engine: s.transcription.engine, provider: s.transcription.provider, baseUrl: s.transcription.baseUrl, model: s.transcription.model, hasKey: !!c.apiKey, keyHint: c.apiKey ? `…${c.apiKey.slice(-4)}` : '', defaultModel: STT_DEFAULTS[s.transcription.provider].model },
    defaultFont: s.defaultFont,
    voice: { hasKey: !!v.apiKey, keyHint: v.apiKey ? `…${v.apiKey.slice(-4)}` : '', model: s.voice.model, defaultModel: VOICE_DEFAULT_MODEL, voiceId: v.voiceId, voiceName: v.voiceName },
  };
}
