import { Captions, Cloud, Cpu, Download, Languages, Merge, Plus, Replace, Settings2, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { addCaption, deleteClips, mergeCaptions, replaceInCaptions, setCaptionPreset, toSrt, updateClip } from '../../shared/ops';
import { CAPTION_LANGS, CAPTION_PRESETS } from '../../shared/presets';
import type { Track } from '../../shared/types';
import { clipEnd } from '../../shared/types';
import { actions } from '../actions';
import { api } from '../api';
import { useT } from '../i18n';
import { playback } from '../playback';
import { useStore } from '../store';
import { StylePreview } from './LeftPanel';

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI · whisper-1' },
  { id: 'groq', label: 'Groq · whisper-large-v3' },
  { id: 'elevenlabs', label: 'ElevenLabs · Scribe' },
  { id: 'custom', label: 'OpenAI-compatible' },
];

/** Where transcription runs, and the cloud provider's key. The key is stored on the studio machine only. */
function EngineSettings({ settings, onSaved, L }: { settings: any; onSaved: (s: any) => void; L: (h: string, e: string) => string }) {
  const tr = settings.transcription;
  const [engine, setEngine] = useState(tr.engine);
  const [provider, setProvider] = useState(tr.provider);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(tr.model);
  const [baseUrl, setBaseUrl] = useState(tr.baseUrl);
  const save = async () => {
    try {
      onSaved(await api.saveSettings({ transcription: { engine, provider, model, baseUrl, ...(apiKey ? { apiKey } : {}) } }));
      setApiKey('');
      useStore.getState().notify(L('ההגדרות נשמרו', 'Settings saved'));
    } catch (e: any) {
      useStore.getState().notify(String(e.message));
    }
  };
  return (
    <div className="engine-box">
      <label>
        <span>{L('איפה לתמלל', 'Where to transcribe')}</span>
        <select value={engine} onChange={(e) => setEngine(e.target.value)}>
          <option value="auto">{L('אוטומטי: המחשב הזה, ואם אין אז ענן', 'Automatic: this computer, else cloud')}</option>
          <option value="local">{L('המחשב הזה (Whisper)', 'This computer (Whisper)')}</option>
          <option value="cloud">{L('ענן (API)', 'Cloud (API)')}</option>
        </select>
      </label>
      <label>
        <span>{L('ספק ענן', 'Cloud provider')}</span>
        <select value={provider} onChange={(e) => (setProvider(e.target.value), setModel(''))}>
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{L('מפתח API', 'API key')}</span>
        <input type="password" dir="ltr" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={tr.hasKey && provider === tr.provider ? `${L('שמור', 'saved')} ${tr.keyHint}` : L('הדביקו מפתח', 'Paste a key')} />
      </label>
      {provider === 'custom' && (
        <label>
          <span>Base URL</span>
          <input dir="ltr" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://host/v1" />
        </label>
      )}
      <label>
        <span>{L('מודל (לא חובה)', 'Model (optional)')}</span>
        <input dir="ltr" value={model} onChange={(e) => setModel(e.target.value)} placeholder={provider === tr.provider ? tr.defaultModel : ''} />
      </label>
      <button className="pill sm" onClick={save}>
        {L('שמירה', 'Save')}
      </button>
      <p className="hint">{L('המפתח נשמר רק במחשב שמריץ את הסטודיו. בתמלול בענן האודיו נשלח לספק.', 'The key stays on the machine that runs the studio. With cloud transcription the audio is sent to the provider.')}</p>
    </div>
  );
}

function useActiveCaption(track: Track | undefined) {
  const [id, setId] = useState('');
  useEffect(() => {
    const check = () => {
      const t = playback.time;
      const hit = track?.clips.find((c) => t >= c.start && t < clipEnd(c))?.id || '';
      setId((prev) => (prev === hit ? prev : hit));
    };
    check();
    return playback.subscribe(check);
  }, [track]);
  return id;
}

const stamp = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

function TranscriptEditor({ track, L }: { track: Track; L: (h: string, e: string) => string }) {
  const project = useStore((s) => s.project)!;
  const { edit, checkpoint, select, notify } = useStore.getState();
  const active = useActiveCaption(track);
  const list = useRef<HTMLDivElement>(null);
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  useEffect(() => {
    if (playback.playing && active) list.current?.querySelector(`[data-cap="${active}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);
  const replaceAll = () => {
    let n = 0;
    edit((p) => void (n = replaceInCaptions(p, find, replace, track.id)));
    notify(L(`הוחלף ב-${n} כתוביות`, `Replaced in ${n} captions`));
  };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([toSrt(project)], { type: 'application/x-subrip' }));
    a.download = `${project.name}.srt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const matches = find ? track.clips.filter((c) => c.text?.includes(find)).length : 0;
  return (
    <>
      <div className="replace-row">
        <input dir="auto" value={find} onChange={(e) => setFind(e.target.value)} placeholder={L('חיפוש', 'Find')} aria-label={L('חיפוש', 'Find')} />
        <input dir="auto" value={replace} onChange={(e) => setReplace(e.target.value)} placeholder={L('החלפה ב', 'Replace with')} aria-label={L('החלפה ב', 'Replace with')} />
        <button className="mini" onClick={replaceAll} disabled={!matches} title={L('החלף הכול', 'Replace all')} aria-label={L('החלף הכול', 'Replace all')}>
          <Replace size={16} />
        </button>
      </div>
      {find && <p className="hint">{L(`נמצא ב-${matches} כתוביות`, `Found in ${matches} captions`)}</p>}
      <div className="chip-row">
        <button
          className="chip-btn"
          onClick={() => {
            let id = '';
            edit((p) => void (id = addCaption(p, playback.time, L('טקסט חדש', 'New text'), 2, track.id).id));
            if (id) select([id]);
          }}
        >
          <Plus size={13} /> {L('כתובית בסמן', 'Caption at playhead')}
        </button>
        <button className="chip-btn" onClick={download}>
          <Download size={13} /> SRT
        </button>
      </div>
      <div className="cap-list" ref={list}>
        {track.clips.map((c, i) => (
          <div key={c.id} data-cap={c.id} className={`cap-row${c.id === active ? ' active' : ''}`}>
            <button className="cap-time" dir="ltr" onClick={() => (playback.seek(c.start + 0.001), select([c.id]))} title={L('קפיצה לכתובית', 'Jump to caption')}>
              {stamp(c.start)}
            </button>
            <textarea
              dir="auto"
              rows={1}
              value={c.text || ''}
              onFocus={() => {
                checkpoint();
                select([c.id]);
                if (!playback.playing && (playback.time < c.start || playback.time >= clipEnd(c))) playback.seek(c.start + 0.001);
              }}
              onChange={(e) => edit((p) => updateClip(p, c.id, { text: e.target.value.replace(/\n/g, ' ') }), true)}
              aria-label={`${L('כתובית', 'Caption')} ${i + 1}`}
            />
            <div className="cap-actions">
              {i < track.clips.length - 1 && (
                <button className="mini" onClick={() => edit((p) => void mergeCaptions(p, c.id))} title={L('איחוד עם הבאה', 'Merge with next')} aria-label={L('איחוד עם הבאה', 'Merge with next')}>
                  <Merge size={14} />
                </button>
              )}
              <button className="mini" onClick={() => edit((p) => deleteClips(p, [c.id], false))} title={L('מחיקה', 'Delete')} aria-label={L('מחיקה', 'Delete')}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function CaptionsTab() {
  const project = useStore((s) => s.project)!;
  const jobs = useStore((s) => s.jobs);
  const { edit, notify } = useStore.getState();
  const { t, isHe } = useT();
  const L = (h: string, e: string) => (isHe ? h : e);
  const [language, setLanguage] = useState(localStorage.getItem('studio.capLang') || 'he');
  // The language the captions are shown in; '' = the language that is spoken.
  const [captionLang, setCaptionLang] = useState(localStorage.getItem('studio.capTo') || '');
  const [translateTo, setTranslateTo] = useState(isHe ? 'en' : 'he');
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [maxWords, setMaxWords] = useState(project.height > project.width ? 4 : 6);
  const [jobId, setJobId] = useState('');
  const [view, setView] = useState<'create' | 'style' | 'edit'>(() => (useStore.getState().project?.tracks.some((x) => x.kind === 'caption' && x.clips.length) ? 'edit' : 'create'));
  const [settings, setSettings] = useState<any>(null);
  const [showEngine, setShowEngine] = useState(false);
  const job = jobs[jobId];
  const running = job?.status === 'running';
  const track = project.tracks.find((x) => x.kind === 'caption');
  const count = track?.clips.length || 0;
  useEffect(() => void api.settings().then(setSettings).catch(() => {}), []);
  useEffect(() => {
    if (job?.status === 'error') notify(job.error || 'Error');
    if (job?.status === 'done') setView('edit');
  }, [job?.status]);
  const status = settings?.status;
  const willUse: string | null = status?.willUse ?? null;
  // The server is still looking for Whisper (it takes a few seconds after a start): ask again until it knows.
  const checkingEngine = !!status?.checking && !willUse;
  useEffect(() => {
    if (!checkingEngine) return;
    const id = setTimeout(() => void api.settings().then(setSettings).catch(() => {}), 3000);
    return () => clearTimeout(id);
  }, [checkingEngine, settings]);
  const generate = async (force = false) => {
    if (count && !confirm(L('יצירה מחדש תחליף את הכתוביות הקיימות, כולל תיקונים ידניים. להמשיך?', 'Generating again replaces the current captions, including manual fixes. Continue?'))) return;
    localStorage.setItem('studio.capLang', language);
    localStorage.setItem('studio.capTo', captionLang);
    const j = await actions.server((id) => api.captions(id, { language, maxWords, preset: track?.captionPreset, force, ...(captionLang && captionLang !== language ? { translateTo: captionLang } : {}) }));
    if (j) setJobId(j.id);
  };
  const translate = async () => {
    if (!keepOriginal && !confirm(L('התרגום יחליף את הטקסט של הכתוביות. כדי לשמור גם את המקור, סמנו "לשמור גם את המקור". להמשיך?', 'The translation replaces the caption text. To keep the original too, tick "Keep the original too". Continue?'))) return;
    const j = await actions.server((id) => api.translateCaptions(id, { to: translateTo, keepOriginal, trackId: track?.id }));
    if (j) setJobId(j.id);
  };
  const langName = (id: string) => (isHe ? CAPTION_LANGS[id]?.he : CAPTION_LANGS[id]?.name) || id;
  const shown = captionLang || track?.lang || language;
  const sample = shown === 'he' || (isHe && shown === 'auto') ? 'ככה זה נראה בסרטון' : 'This is how it looks';
  return (
    <div className="tab-body">
      <div className="engine-row">
        <span className={`engine-chip${settings && !willUse ? ' warn' : ''}`}>
          {willUse === 'cloud' ? <Cloud size={14} /> : <Cpu size={14} />}
          {willUse === 'local' ? L('תמלול במחשב הזה', 'Transcribes on this computer') : willUse === 'cloud' ? `${L('תמלול בענן', 'Cloud transcription')} · ${status.providerLabel}` : checkingEngine ? L('בודק את Whisper במחשב…', 'Looking for Whisper on this computer…') : settings ? L('אין מנוע תמלול זמין', 'No transcription engine') : '…'}
        </span>
        <button className="mini" onClick={() => setShowEngine(!showEngine)} aria-expanded={showEngine} title={L('מנוע התמלול', 'Transcription engine')} aria-label={L('מנוע התמלול', 'Transcription engine')}>
          <Settings2 size={16} />
        </button>
      </div>
      {settings && !willUse && !checkingEngine && !showEngine && <p className="hint">{L('לא נמצא Whisper במחשב ואין מפתח API. פתחו את ההגדרות והוסיפו מפתח לתמלול בענן.', 'Whisper was not found on this computer and there is no API key. Open the settings and add a key for cloud transcription.')}</p>}
      {showEngine && settings && <EngineSettings settings={settings} onSaved={setSettings} L={L} />}
      <div className="seg big" role="tablist">
        {(['create', 'style', 'edit'] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
            {v === 'create' ? L('תמלול', 'Transcribe') : v === 'style' ? t('style') : `${L('תיקון', 'Fix text')}${count ? ` · ${count}` : ''}`}
          </button>
        ))}
      </div>
      {view === 'create' && (
        <>
          <div className="field-row">
            <label>
              <span>{L('שפת הדיבור', 'Spoken language')}</span>
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="he">עברית</option>
                <option value="en">English</option>
                <option value="auto">{t('auto')}</option>
              </select>
            </label>

            <label>
              <span>{t('maxWords')}</span>
              <input type="number" min={1} max={14} value={maxWords} onChange={(e) => setMaxWords(Number(e.target.value) || 1)} />
            </label>
          </div>
          <div className="field-row">
            <label className="wide">
              <span>{L('שפת הכתוביות', 'Caption language')}</span>
              <select value={captionLang} onChange={(e) => setCaptionLang(e.target.value)}>
                <option value="">{L('כמו הדיבור', 'Same as spoken')}</option>
                {Object.keys(CAPTION_LANGS)
                  .filter((id) => id !== language)
                  .map((id) => (
                    <option key={id} value={id}>
                      {langName(id)}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <button className="pill wide strong" onClick={() => generate(false)} disabled={running || (settings && !willUse && !checkingEngine)}>
            <Captions size={18} />
            {running ? `${Math.round((job.progress || 0) * 100)}%` : count ? t('regenerate') : t('generate')}
          </button>
          {running && (
            <div className="progress">
              <i style={{ width: `${(job.progress || 0) * 100}%` }} />
            </div>
          )}
          <p className="hint">{running ? job.message : count ? `${count} ${t('captionCount')}` : t('captionsHint')}</p>
          {captionLang && captionLang !== language && !running && <p className="hint">{L(`מתמללים את הדיבור ומתרגמים ל${langName(captionLang)} עם המודל שבלשונית סוכן ה-AI. הזמנים של כל כתובית נשמרים.`, `The speech is transcribed, then translated to ${langName(captionLang)} with the model from the AI agent tab. Every caption keeps its timing.`)}</p>}
          {count > 0 && !running && (
            <button className="link-btn" onClick={() => generate(true)}>
              {L('לתמלל שוב מאפס (למשל אחרי החלפת מנוע)', 'Transcribe again from scratch (e.g. after switching engine)')}
            </button>
          )}
        </>
      )}
      {view === 'style' && (
        <div className="preset-grid">
          {CAPTION_PRESETS.map((p) => (
            <button key={p.id} className={`preset${track?.captionPreset === p.id ? ' active' : ''}`} disabled={!track} onClick={() => track && edit((d) => setCaptionPreset(d, track.id, p.id))}>
              <StylePreview style={p.style} text={sample} words />
              <span>{isHe ? p.labelHe : p.label}</span>
            </button>
          ))}
        </div>
      )}
      {view === 'edit' && track && count > 0 && (
        <div className="engine-box translate-box">
          <div className="translate-row">
            <Languages size={16} aria-hidden />
            <span>{L('תרגום ל', 'Translate to')}</span>
            <select value={translateTo} onChange={(e) => setTranslateTo(e.target.value)} aria-label={L('שפת התרגום', 'Translation language')}>
              {Object.keys(CAPTION_LANGS)
                .filter((id) => id !== track.lang)
                .map((id) => (
                  <option key={id} value={id}>
                    {langName(id)}
                  </option>
                ))}
            </select>
            <button className="pill sm strong" onClick={translate} disabled={running}>
              {running ? `${Math.round((job.progress || 0) * 100)}%` : L('תרגום', 'Translate')}
            </button>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={keepOriginal} onChange={(e) => setKeepOriginal(e.target.checked)} />
            <span>{L('לשמור גם את המקור (כתוביות בשתי שפות, התרגום מעליו)', 'Keep the original too (captions in two languages, the translation above it)')}</span>
          </label>
          {running && <p className="hint">{job.message}</p>}
        </div>
      )}
      {view === 'edit' && (track && count ? <TranscriptEditor track={track} L={L} /> : <p className="hint">{L('אחרי יצירת כתוביות אפשר לתקן כאן כל שורה, להחליף מילה בכל הכתוביות, לאחד, למחוק ולהוסיף.', 'After generating captions you can fix every line here, replace a word everywhere, merge, delete and add.')}</p>)}
    </div>
  );
}
