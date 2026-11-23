import { AudioLines, Captions, Check, Copy, Mic, Play, Search, Settings2, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { actions } from '../actions';
import { api } from '../api';
import { useT } from '../i18n';
import { playback } from '../playback';
import { getSelected, useStore } from '../store';

interface Voice {
  id: string;
  name: string;
  description: string;
  language: string;
  gender: string | null;
  mine: boolean;
  hasPreview: boolean;
}

/** The Cartesia key and model. The key is stored on the studio machine only. */
function VoiceSettings({ settings, onSaved, L }: { settings: any; onSaved: (s: any) => void; L: (h: string, e: string) => string }) {
  const v = settings.voice;
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(v.model);
  const save = async () => {
    try {
      onSaved(await api.saveSettings({ voice: { model, ...(apiKey ? { apiKey } : {}) } }));
      setApiKey('');
      useStore.getState().notify(L('ההגדרות נשמרו', 'Settings saved'));
    } catch (e: any) {
      useStore.getState().notify(String(e.message));
    }
  };
  return (
    <div className="engine-box">
      <label>
        <span>{L('מפתח API של Cartesia', 'Cartesia API key')}</span>
        <input type="password" dir="ltr" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={v.hasKey ? `${L('שמור', 'saved')} ${v.keyHint}` : 'sk_car_…'} />
      </label>
      <label>
        <span>{L('מודל (לא חובה)', 'Model (optional)')}</span>
        <input dir="ltr" value={model} onChange={(e) => setModel(e.target.value)} placeholder={v.defaultModel} />
      </label>
      <button className="pill sm" onClick={save}>
        {L('שמירה', 'Save')}
      </button>
      <p className="hint">{L('המפתח נשמר רק במחשב שמריץ את הסטודיו. הטקסט ודגימות הקול נשלחים ל-Cartesia, וכל יצירה משתמשת בקרדיטים של החשבון שם.', 'The key stays on the machine that runs the studio. Text and voice samples are sent to Cartesia, and every generation uses credits of that account.')}</p>
    </div>
  );
}

export function VoiceTab() {
  const project = useStore((s) => s.project)!;
  const selection = useStore((s) => s.selection);
  const { notify } = useStore.getState();
  const { isHe } = useT();
  const L = (h: string, e: string) => (isHe ? h : e);
  const [settings, setSettings] = useState<any>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [view, setView] = useState<'speak' | 'clone'>('speak');
  const [text, setText] = useState('');
  const [language, setLanguage] = useState('auto');
  const [speed, setSpeed] = useState(1);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [more, setMore] = useState(false);
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState('');
  const [voiceLang, setVoiceLang] = useState('he');
  const [voice, setVoice] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [cloneLang, setCloneLang] = useState('he');
  const [agree, setAgree] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const hasKey = !!settings?.voice.hasKey;

  useEffect(
    () =>
      void api
        .settings()
        .then((s) => {
          setSettings(s);
          if (s.voice.voiceId) setVoice({ id: s.voice.voiceId, name: s.voice.voiceName || s.voice.voiceId });
          if (!s.voice.hasKey) setShowSettings(true);
        })
        .catch(() => {}),
    [],
  );
  useEffect(() => () => audio.current?.pause(), []);

  // The voice list follows the filters, with a short pause while typing.
  useEffect(() => {
    if (!hasKey) return;
    let live = true;
    const timer = setTimeout(() => {
      setLoading(true);
      api
        .voices({ q, language: mine ? '' : voiceLang, mine })
        .then((r) => {
          if (!live) return;
          setVoices(r.voices);
          setMore(r.more);
          setListError('');
        })
        .catch((e) => live && (setVoices([]), setListError(String(e.message))))
        .finally(() => live && setLoading(false));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [hasKey, q, mine, voiceLang, settings?.voice.keyHint]);

  const preview = (v: Voice) => {
    audio.current?.pause();
    if (playing === v.id) return setPlaying('');
    const a = new Audio(`/api/voice/voices/${encodeURIComponent(v.id)}/preview?language=${v.language.startsWith('he') ? 'he' : 'en'}`);
    audio.current = a;
    setPlaying(v.id);
    a.onended = () => setPlaying('');
    a.play().catch(() => {
      setPlaying('');
      notify(L('לא הצלחתי להשמיע את הקול הזה', 'Could not play this voice'));
    });
  };

  const speak = async () => {
    if (!voice || !text.trim()) return;
    setBusy(true);
    const out = await actions.server((id) => api.speak(id, { text, voiceId: voice.id, voiceName: voice.name, language, speed, start: playback.time }));
    setBusy(false);
    if (out?.clip) {
      useStore.getState().select([out.clip.id]);
      notify(L('הקריינות נוספה בסמן', 'Narration added at the playhead'));
    }
  };

  const captionTrack = project.tracks.find((t) => t.kind === 'caption' && t.clips.length);
  const selected = getSelected({ project, selection });
  const source = selected?.clip.assetId ? project.assets.find((a) => a.id === selected.clip.assetId) : undefined;
  const sourceSeconds = selected ? selected.clip.duration * (selected.clip.speed || 1) : 0;
  const canClone = !!source?.hasAudio && sourceSeconds >= 3 && !!cloneName.trim() && agree;
  const clone = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const v: Voice = await api.cloneVoice(project.id, { clipId: selected.clip.id, name: cloneName.trim(), language: cloneLang });
      setVoice({ id: v.id, name: v.name });
      setMine(true);
      setQ('');
      setCloneName('');
      setAgree(false);
      setView('speak');
      notify(L(`הקול "${v.name}" נוצר ונבחר`, `Voice "${v.name}" created and selected`));
    } catch (e: any) {
      notify(String(e.message));
    }
    setBusy(false);
  };

  return (
    <div className="tab-body">
      <div className="engine-row">
        <span className={`engine-chip${settings && !hasKey ? ' warn' : ''}`}>
          <Mic size={14} />
          {!settings ? '…' : hasKey ? `Cartesia · ${settings.voice.model || settings.voice.defaultModel}` : L('חסר מפתח Cartesia', 'Cartesia key missing')}
        </span>
        <button className="mini" onClick={() => setShowSettings(!showSettings)} aria-expanded={showSettings} title={L('הגדרות קול', 'Voice settings')} aria-label={L('הגדרות קול', 'Voice settings')}>
          <Settings2 size={16} />
        </button>
      </div>
      {showSettings && settings && <VoiceSettings settings={settings} onSaved={setSettings} L={L} />}
      {hasKey && (
        <>
          <div className="seg big" role="tablist">
            {(['speak', 'clone'] as const).map((v) => (
              <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
                {v === 'speak' ? L('טקסט לדיבור', 'Text to speech') : L('שיבוט קול', 'Clone a voice')}
              </button>
            ))}
          </div>
          {view === 'speak' && (
            <>
              <textarea dir="auto" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={L('מה להקריא?', 'What should it say?')} aria-label={L('טקסט לקריינות', 'Narration text')} />
              <div className="chip-row">
                {captionTrack && (
                  <button className="chip-btn" onClick={() => setText(captionTrack.clips.map((c) => c.text || '').join(' '))}>
                    <Captions size={13} /> {L('מהכתוביות', 'From captions')}
                  </button>
                )}
                <span className="hint" dir="ltr">
                  {text.trim().length}
                </span>
              </div>
              <div className="field-row">
                <label>
                  <span>{L('שפת הטקסט', 'Text language')}</span>
                  <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                    <option value="auto">{L('זיהוי אוטומטי', 'Detect')}</option>
                    <option value="he">עברית</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <label>
                  <span>
                    {L('מהירות', 'Speed')} · <span dir="ltr">{speed.toFixed(2)}×</span>
                  </span>
                  <input type="range" min={0.6} max={1.5} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
                </label>
              </div>
              <button className="pill wide strong" onClick={speak} disabled={busy || !voice || !text.trim()}>
                <AudioLines size={18} />
                {busy ? L('יוצר…', 'Generating…') : L('יצירת קריינות בסמן', 'Generate at the playhead')}
              </button>
              <p className="hint">{voice ? (
                  <>
                    {L('קול', 'Voice')}: <bdi>{voice.name}</bdi>
                  </>
                ) : (
                  L('בחרו קול מהרשימה', 'Pick a voice from the list')
                )}</p>

              <h4>{L('קולות', 'Voices')}</h4>
              <div className="seg big" role="tablist">
                <button role="tab" aria-selected={!mine} className={!mine ? 'active' : ''} onClick={() => setMine(false)}>
                  {L('הספרייה', 'Library')}
                </button>
                <button role="tab" aria-selected={mine} className={mine ? 'active' : ''} onClick={() => setMine(true)}>
                  {L('הקולות שלי', 'My voices')}
                </button>
              </div>
              <div className="voice-filter">
                <label className="path-row">
                  <Search size={15} />
                  <input dir="auto" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L('חיפוש קול', 'Search voices')} aria-label={L('חיפוש קול', 'Search voices')} />
                </label>
                {!mine && (
                  <select value={voiceLang} onChange={(e) => setVoiceLang(e.target.value)} aria-label={L('שפת הקול', 'Voice language')}>
                    <option value="he">עברית</option>
                    <option value="en">English</option>
                    <option value="">{L('הכול', 'All')}</option>
                  </select>
                )}
              </div>
              {listError && <p className="error">{listError}</p>}
              <div className="voice-list">
                {voices.map((v) => (
                  <div key={v.id} className={`voice${voice?.id === v.id ? ' active' : ''}`}>
                    <button className="mini" onClick={() => preview(v)} title={L('האזנה לדגימה', 'Play sample')} aria-label={`${L('האזנה לדגימה', 'Play sample')}: ${v.name}`}>
                      {playing === v.id ? <Square size={13} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
                    </button>
                    <button className="voice-pick" onClick={() => setVoice({ id: v.id, name: v.name })} aria-pressed={voice?.id === v.id}>
                      <strong dir="auto">{v.name}</strong>
                      <span dir="auto">{[v.language, v.description].filter(Boolean).join(' · ')}</span>
                    </button>
                    {voice?.id === v.id && <Check size={16} className="voice-check" />}
                  </div>
                ))}
              </div>
              {!loading && !listError && !voices.length && <p className="hint">{mine ? L('עדיין אין קולות משלך. אפשר ליצור אחד בלשונית "שיבוט קול".', 'No voices of your own yet. Create one under "Clone a voice".') : L('לא נמצאו קולות', 'No voices found')}</p>}
              {loading && <p className="hint">…</p>}
              {more && <p className="hint">{L('מוצגים 100 הראשונים. חפשו כדי לצמצם.', 'Showing the first 100. Search to narrow down.')}</p>}
            </>
          )}
          {view === 'clone' && (
            <>
              <p className="hint">{L('סמנו בציר הזמן קליפ שבו רק האדם הזה מדבר, בלי מוזיקה ורעש. מספיקות 3 עד 10 שניות; נשלחות לכל היותר 30 השניות הראשונות של הקליפ.', 'Select a timeline clip in which only this person speaks, with no music or noise. 3 to 10 seconds are enough; at most the first 30 seconds of the clip are sent.')}</p>
              <div className={`engine-chip${source?.hasAudio && sourceSeconds >= 3 ? '' : ' warn'}`}>
                <Copy size={14} />
                {!selected ? L('לא נבחר קליפ', 'No clip selected') : !source?.hasAudio ? L('בקליפ הנבחר אין קול', 'The selected clip has no sound') : sourceSeconds < 3 ? L('הקליפ קצר מ-3 שניות', 'The clip is shorter than 3 seconds') : `${source.name} · ${Math.min(30, sourceSeconds).toFixed(1)}s`}
              </div>
              <div className="field-row">
                <label>
                  <span>{L('שם הקול', 'Voice name')}</span>
                  <input className="text-input" dir="auto" value={cloneName} onChange={(e) => setCloneName(e.target.value)} maxLength={80} />
                </label>
                <label>
                  <span>{L('שפה', 'Language')}</span>
                  <select value={cloneLang} onChange={(e) => setCloneLang(e.target.value)}>
                    <option value="he">עברית</option>
                    <option value="en">English</option>
                  </select>
                </label>
              </div>
              <label className="check-row">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>{L('זה הקול שלי, או שיש לי רשות מבעל הקול לשבט אותו', 'This is my own voice, or I have the speaker’s permission to clone it')}</span>
              </label>
              <button className="pill wide strong" onClick={clone} disabled={busy || !canClone}>
                <Mic size={18} />
                {busy ? L('יוצר…', 'Creating…') : L('שיבוט הקול מהקליפ', 'Clone the voice from the clip')}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
