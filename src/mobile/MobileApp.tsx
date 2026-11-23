// Mobile mode (0.5.0): the studio on a phone, for one job done well. Pick a video, it uploads in pieces (resumable),
// it is transcribed and captioned (optionally translated), you fix the text, pick a look, and export for Reels,
// TikTok, Shorts or YouTube, then download or share. The AI agent chat is one tab away. The heavy work runs on the
// computer that hosts the studio; the phone is the remote.
import { ArrowLeft, Bot, Captions, Check, Download, FolderOpen, Loader2, Monitor, Palette, Plus, Scissors, Share2, Sparkles, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CAPTION_LANGS, CAPTION_PRESETS, EXPORT_PRESETS } from '../../shared/presets';
import type { Job, Project } from '../../shared/types';
import { projectDuration } from '../../shared/types';
import { api, uploadChunked } from '../api';
import { AgentFx } from '../components/AgentFx';
import { AgentTab } from '../components/AgentTab';
import { Stage } from '../components/Stage';
import { connectEvents, flushSave, useStore } from '../store';
import { takeShared } from './share';
import './mobile.css';

type L2 = { he: string; en: string };
const S = {
  newVideo: { he: 'סרטון חדש', en: 'New video' },
  newHint: { he: 'בוחרים סרטון מהגלריה. הוא עולה ברקע, וממשיך גם אם הקליטה נקטעת.', en: 'Pick a video from your gallery. It uploads in the background and resumes if the signal drops.' },
  recent: { he: 'פרויקטים אחרונים', en: 'Recent projects' },
  none: { he: 'עוד אין פרויקטים.', en: 'No projects yet.' },
  uploading: { he: 'מעלה', en: 'Uploading' },
  preparing: { he: 'מכין את הסרטון', en: 'Preparing the video' },
  cancel: { he: 'ביטול', en: 'Cancel' },
  captions: { he: 'כתוביות', en: 'Captions' },
  style: { he: 'עיצוב', en: 'Style' },
  agent: { he: 'סוכן AI', en: 'AI agent' },
  export: { he: 'ייצוא', en: 'Export' },
  speech: { he: 'שפת הדיבור', en: 'Spoken language' },
  auto: { he: 'זיהוי אוטומטי', en: 'Detect' },
  hebrew: { he: 'עברית', en: 'Hebrew' },
  english: { he: 'אנגלית', en: 'English' },
  captionsIn: { he: 'שפת הכתוביות', en: 'Captions language' },
  sameLang: { he: 'אותה שפה', en: 'Same language' },
  make: { he: 'יצירת כתוביות', en: 'Make captions' },
  silences: { he: 'הסרת שתיקות', en: 'Cut silences' },
  silencesDone: { he: 'השתיקות הוסרו', en: 'Silences removed' },
  edit: { he: 'לוחצים על שורה כדי לתקן אותה.', en: 'Tap a line to fix it.' },
  translate: { he: 'תרגום ל', en: 'Translate to' },
  translateGo: { he: 'תרגום', en: 'Translate' },
  again: { he: 'יצירה מחדש', en: 'Make again' },
  srt: { he: 'קובץ SRT', en: 'SRT file' },
  pickLook: { he: 'בוחרים מראה לכתוביות. רואים אותו מיד בתצוגה.', en: 'Pick a look for the captions. It shows in the preview right away.' },
  noCaptions: { he: 'קודם יוצרים כתוביות.', en: 'Make captions first.' },
  where: { he: 'לאן?', en: 'Where to?' },
  another: { he: 'ייצוא נוסף', en: 'Export again' },
  reshaped: { he: 'המסגרת שונתה לצורה של היעד. כך הסרטון ייראה: בודקים בתצוגה.', en: 'The frame now has the shape of this destination. Check the preview: that is how it will look.' },
  start: { he: 'ייצוא', en: 'Export' },
  exporting: { he: 'מייצא', en: 'Exporting' },
  ready: { he: 'הסרטון מוכן', en: 'Your video is ready' },
  download: { he: 'הורדה', en: 'Download' },
  share: { he: 'שיתוף', en: 'Share' },
  fullEditor: { he: 'לעורך המלא', en: 'Full editor' },
  failed: { he: 'משהו נכשל', en: 'Something failed' },
  sharedAsk: { he: 'לערוך את הסרטון ששיתפתם?', en: 'Edit the video you shared?' },
  sharedYes: { he: 'העלאה ועריכה', en: 'Upload and edit' },
  pickedAsk: { he: 'זה הסרטון להעלות?', en: 'Upload this video?' },
  pickOther: { he: 'בחירת קובץ אחר', en: 'Choose another file' },
  install: { he: 'אפשר להוסיף את הסטודיו למסך הבית מתפריט הדפדפן.', en: 'Add the studio to your home screen from the browser menu.' },
} satisfies Record<string, L2>;

const PRESETS = ['reels', 'tiktok', 'shorts', 'youtube', 'square'];

function useL() {
  const lang = useStore((s) => s.lang);
  return { lang, he: lang === 'he', t: (k: keyof typeof S) => S[k][lang === 'he' ? 'he' : 'en'] };
}

/** Wait for a job; long-polls, so it also works after the phone sleeps (an event stream may have dropped). */
async function waitJob(job: Job, onUpdate: (j: Job) => void): Promise<Job> {
  let j = job;
  onUpdate(j);
  while (j.status === 'running' || j.status === 'queued') {
    try {
      const res = await fetch(`/api/jobs/${j.id}?wait=1`);
      if (res.ok) j = await res.json();
      else await new Promise((r) => setTimeout(r, 2000));
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
    onUpdate(j);
  }
  if (j.status === 'error') throw new Error(j.error || 'Failed');
  return j;
}

function Progress({ label, value, onCancel }: { label: string; value: number; onCancel?: () => void }) {
  const { t } = useL();
  return (
    <div className="m-progress" role="status">
      <div className="m-progress-row">
        <Loader2 size={18} className="spin" />
        <span dir="auto">{label}</span>
        <b>{Math.round(value * 100)}%</b>
      </div>
      <div className="m-bar">
        <i style={{ width: `${Math.max(2, value * 100)}%` }} />
      </div>
      {onCancel && (
        <button className="m-link" onClick={onCancel}>
          <X size={16} /> {t('cancel')}
        </button>
      )}
    </div>
  );
}

function useDesktop() {
  return () => {
    try {
      localStorage.setItem('studio.ui', 'desktop');
    } catch {}
    location.href = '/';
  };
}

/** The chosen file before it goes up: a playable preview, its name and size, and an explicit button to upload. */
function PickedFile({ file, ask, onUpload, onOther, onCancel }: { file: File; ask: string; onUpload: () => void; onOther: () => void; onCancel: () => void }) {
  const { t } = useL();
  const [url, setUrl] = useState('');
  const [dur, setDur] = useState(0);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  const audio = file.type.startsWith('audio/');
  const mins = dur ? `${Math.floor(dur / 60)}:${String(Math.round(dur % 60)).padStart(2, '0')} · ` : '';
  return (
    <div className="m-picked">
      <p className="m-picked-ask">{ask}</p>
      {url &&
        (audio ? (
          <audio className="m-picked-media" src={url} controls preload="metadata" onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)} />
        ) : (
          <video className="m-picked-media" src={url} controls playsInline muted preload="metadata" onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)} />
        ))}
      <p className="m-picked-meta" dir="auto">
        <b dir="auto">{file.name}</b>
        <span dir="ltr">
          {mins}
          {(file.size / 1048576).toFixed(file.size < 10485760 ? 1 : 0)} MB
        </span>
      </p>
      <button className="m-cta" onClick={onUpload}>
        <Upload size={20} /> {t('sharedYes')}
      </button>
      <div className="m-picked-row">
        <button className="m-link" onClick={onOther}>
          <FolderOpen size={16} /> {t('pickOther')}
        </button>
        <button className="m-link" onClick={onCancel}>
          <X size={16} /> {t('cancel')}
        </button>
      </div>
    </div>
  );
}

// ---------- home: new video + recent projects ----------

function Home({ onOpen }: { onOpen: (id: string) => void }) {
  const { t, he, lang } = useL();
  const [list, setList] = useState<{ id: string; name: string; updatedAt: string; clips: number }[] | null>(null);
  const [up, setUp] = useState<{ label: string; value: number } | null>(null);
  const [error, setError] = useState('');
  /** A file picked from the gallery or shared to the studio: shown first, uploaded only after a tap. */
  const [pending, setPending] = useState<{ file: File; from: 'pick' | 'share' } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const toDesktop = useDesktop();

  const start = async (file: File) => {
    setError('');
    abort.current = new AbortController();
    try {
      setUp({ label: t('uploading'), value: 0 });
      const name = file.name.replace(/\.[^.]+$/, '').slice(0, 60) || t('newVideo');
      const p = await api.create(name);
      const a = await uploadChunked(p.id, file, (sent, total) => setUp({ label: `${t('uploading')} · ${(sent / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MB`, value: sent / total }), abort.current.signal);
      setUp({ label: t('preparing'), value: 1 });
      await api.op(p.id, 'add_clip', { assetId: a.id });
      setUp(null);
      onOpen(p.id);
    } catch (e: any) {
      setUp(null);
      if (e.message !== 'Cancelled') setError(String(e.message || e));
    }
  };

  useEffect(() => {
    void api.projects().then(setList).catch((e) => setError(String(e.message)));
    // A video shared to the studio from the phone's gallery (Android share sheet, see public/sw.js).
    // It waits for a tap: a file that arrives from outside is never uploaded without the user saying so.
    if (new URLSearchParams(location.search).has('shared'))
      void takeShared().then((f) => {
        history.replaceState(null, '', '/?m=1');
        if (f) setPending({ file: f, from: 'share' });
      });
  }, []);

  return (
    <div className="m-screen">
      <header className="m-top">
        <div className="m-brand">
          <img src="/brand/mark-128.png" alt="" width={30} height={30} />
          <b>YUV.AI</b>
          <span>STUDIO</span>
        </div>
        <button className="m-chip" onClick={() => useStore.setState({ lang: he ? 'en' : 'he' })} aria-label="Language">
          {he ? 'EN' : 'עב'}
        </button>
      </header>

      <section className="m-hero">
        <input
          ref={input}
          type="file"
          accept="video/*,audio/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) setPending({ file: f, from: 'pick' });
          }}
        />
        {up ? (
          <Progress label={up.label} value={up.value} onCancel={up.value < 1 ? () => abort.current?.abort() : undefined} />
        ) : pending ? (
          <PickedFile
            file={pending.file}
            ask={pending.from === 'share' ? t('sharedAsk') : t('pickedAsk')}
            onUpload={() => (setPending(null), void start(pending.file))}
            onOther={() => input.current?.click()}
            onCancel={() => setPending(null)}
          />
        ) : (
          <>
            <button className="m-cta" onClick={() => input.current?.click()}>
              <Plus size={22} /> {t('newVideo')}
            </button>
            <p className="m-hint">{t('newHint')}</p>
          </>
        )}
        {error && <p className="m-error" dir="auto">{t('failed')}: {error}</p>}
      </section>

      <section className="m-section">
        <h2 className="m-kicker">{t('recent')}</h2>
        {list === null ? (
          <Loader2 className="spin" />
        ) : list.length ? (
          <div className="m-list">
            {list.slice(0, 30).map((p) => (
              <button key={p.id} className="m-row" onClick={() => onOpen(p.id)}>
                <FolderOpen size={18} />
                <span dir="auto">{p.name}</span>
                <small>{new Date(p.updatedAt).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US')}</small>
              </button>
            ))}
          </div>
        ) : (
          <p className="m-hint">{t('none')}</p>
        )}
      </section>

      <footer className="m-foot">
        <button className="m-link" onClick={toDesktop}>
          <Monitor size={16} /> {t('fullEditor')}
        </button>
        <p className="m-hint">{t('install')}</p>
      </footer>
    </div>
  );
}

// ---------- the project: preview + captions / style / agent / export ----------

function CaptionsPanel({ project }: { project: Project }) {
  const { t, he } = useL();
  const reload = useStore((s) => s.reload);
  const [speech, setSpeech] = useState<'auto' | 'he' | 'en'>(he ? 'he' : 'auto');
  const [to, setTo] = useState('');
  const [tr, setTr] = useState('en');
  const [busy, setBusy] = useState<{ label: string; value: number } | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const track = project.tracks.find((x) => x.kind === 'caption' && x.clips.length);
  const lines = track ? [...track.clips].sort((a, b) => a.start - b.start) : [];
  const run = async (label: string, start: () => Promise<Job>) => {
    setError('');
    setNote('');
    try {
      await flushSave();
      await waitJob(await start(), (j) => setBusy({ label: j.message || label, value: j.progress || 0 }));
      await reload();
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setBusy(null);
    }
  };
  const make = () => run(t('make'), () => api.captions(project.id, { language: speech, preset: 'glass', ...(to ? { translateTo: to } : {}) }));
  const silences = async () => {
    setError('');
    try {
      setBusy({ label: t('silences'), value: 0.5 });
      await flushSave();
      await api.silences(project.id, {});
      await reload();
      setNote(t('silencesDone'));
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setBusy(null);
    }
  };
  const save = async (clipId: string, text: string, old: string) => {
    if (text.trim() === old.trim()) return;
    try {
      await api.op(project.id, 'update_clip', { clipId, patch: { text: text.trim() } });
      await reload();
    } catch (e: any) {
      setError(String(e.message || e));
    }
  };
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const langs = Object.entries(CAPTION_LANGS);

  if (busy) return <Progress label={busy.label} value={busy.value} />;
  return (
    <div className="m-panel">
      {!track ? (
        <>
          <label className="m-field">
            <span>{t('speech')}</span>
            <select value={speech} onChange={(e) => setSpeech(e.target.value as any)}>
              <option value="auto">{t('auto')}</option>
              <option value="he">{t('hebrew')}</option>
              <option value="en">{t('english')}</option>
            </select>
          </label>
          <label className="m-field">
            <span>{t('captionsIn')}</span>
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">{t('sameLang')}</option>
              {langs.map(([id, l]) => (
                <option key={id} value={id}>
                  {he ? l.he : l.name}
                </option>
              ))}
            </select>
          </label>
          <button className="m-cta" onClick={make}>
            <Sparkles size={20} /> {t('make')}
          </button>
          <button className="m-btn" onClick={silences}>
            <Scissors size={18} /> {t('silences')}
          </button>
        </>
      ) : (
        <>
          <p className="m-hint">{t('edit')}</p>
          <div className="m-lines">
            {lines.map((c) => (
              <label key={c.id} className="m-line">
                <small dir="ltr">{fmt(c.start)}</small>
                <textarea dir="auto" rows={1} defaultValue={c.text || ''} onBlur={(e) => void save(c.id, e.target.value, c.text || '')} />
              </label>
            ))}
          </div>
          <div className="m-inline">
            <select value={tr} onChange={(e) => setTr(e.target.value)} aria-label={t('translate')}>
              {langs.map(([id, l]) => (
                <option key={id} value={id}>
                  {t('translate')}
                  {he ? l.he : ` ${l.name}`}
                </option>
              ))}
            </select>
            <button className="m-btn" onClick={() => run(t('translateGo'), () => api.translateCaptions(project.id, { to: tr, trackId: track.id }))}>
              {t('translateGo')}
            </button>
          </div>
          <div className="m-inline">
            <button className="m-btn" onClick={silences}>
              <Scissors size={18} /> {t('silences')}
            </button>
            <a className="m-btn" href={`/api/projects/${project.id}/captions.srt`} download>
              <Download size={18} /> {t('srt')}
            </a>
          </div>
        </>
      )}
      {note && <p className="m-ok">{note}</p>}
      {error && <p className="m-error" dir="auto">{t('failed')}: {error}</p>}
    </div>
  );
}

function StylePanel({ project }: { project: Project }) {
  const { t, he } = useL();
  const reload = useStore((s) => s.reload);
  const [busy, setBusy] = useState('');
  const track = project.tracks.find((x) => x.kind === 'caption' && x.clips.length);
  if (!track) return <p className="m-hint m-panel">{t('noCaptions')}</p>;
  const pick = async (id: string) => {
    setBusy(id);
    try {
      await api.op(project.id, 'set_caption_style', { trackId: track.id, preset: id });
      await reload();
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="m-panel">
      <p className="m-hint">{t('pickLook')}</p>
      <div className="m-grid">
        {CAPTION_PRESETS.map((p) => {
          const st = p.style || {};
          return (
            <button key={p.id} className="m-tile" onClick={() => void pick(p.id)} aria-busy={busy === p.id}>
              <span
                className="m-sample"
                style={{
                  fontFamily: st.fontFamily,
                  fontWeight: st.fontWeight,
                  color: st.color,
                  background: st.bgColor,
                  textTransform: st.uppercase ? 'uppercase' : undefined,
                  borderRadius: st.bgRadius ? 999 : undefined,
                }}
              >
                {he ? 'כתובית' : 'Caption'}
              </span>
              <small>{he ? p.labelHe : p.label}</small>
              {busy === p.id && <Loader2 size={14} className="spin" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ExportPanel({ project }: { project: Project }) {
  const { t, he } = useL();
  const reload = useStore((s) => s.reload);
  const ratio = project.width / project.height;
  const [preset, setPreset] = useState(() => PRESETS.find((id) => { const p = EXPORT_PRESETS.find((x) => x.id === id)!; return Math.abs(p.width / p.height - ratio) < 0.02; }) || 'reels');
  const [reshaped, setReshaped] = useState(false);
  const [busy, setBusy] = useState<{ label: string; value: number } | null>(null);
  const [done, setDone] = useState<{ url: string; name: string } | null>(null);
  const [error, setError] = useState('');
  /** A destination of another shape reshapes the project now (server op "reshape"), so the preview shows the result. */
  const choose = async (id: string) => {
    setPreset(id);
    setError('');
    const p = EXPORT_PRESETS.find((x) => x.id === id)!;
    if (Math.abs(p.width / p.height - project.width / project.height) < 0.02) return;
    try {
      await flushSave();
      await api.op(project.id, 'reshape', { width: p.width, height: p.height, mode: 'fill' });
      await reload();
      setReshaped(true);
    } catch (e: any) {
      setError(String(e.message || e));
    }
  };
  const go = async () => {
    setError('');
    setDone(null);
    try {
      await flushSave();
      const j = await waitJob(await api.exportVideo(project.id, { preset, quality: 'high', reframe: 'fit' }), (x) => setBusy({ label: x.message || t('exporting'), value: x.progress || 0 }));
      setDone({ url: j.result.url, name: decodeURIComponent(j.result.url.split('/').pop() || 'video.mp4') });
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setBusy(null);
    }
  };
  const share = async () => {
    if (!done) return;
    try {
      const blob = await (await fetch(done.url)).blob();
      const file = new File([blob], done.name, { type: 'video/mp4' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: project.name });
      else location.href = done.url;
    } catch (e: any) {
      if (e?.name !== 'AbortError') setError(String(e.message || e));
    }
  };
  if (busy) return <Progress label={busy.label} value={busy.value} />;
  return (
    <div className="m-panel">
      {done ? (
        <div className="m-done">
          <Check size={28} />
          <h3>{t('ready')}</h3>
          <a className="m-cta" href={done.url} download={done.name}>
            <Download size={20} /> {t('download')}
          </a>
          {'share' in navigator && (
            <button className="m-btn" onClick={share}>
              <Share2 size={18} /> {t('share')}
            </button>
          )}
          <button className="m-link" onClick={() => setDone(null)}>
            {t('another')}
          </button>
        </div>
      ) : (
        <>
          <h3 className="m-kicker">{t('where')}</h3>
          <div className="m-choices" role="radiogroup">
            {PRESETS.map((id) => {
              const p = EXPORT_PRESETS.find((x) => x.id === id)!;
              return (
                <button key={id} role="radio" aria-checked={preset === id} className="m-choice" onClick={() => void choose(id)}>
                  {he ? p.labelHe : p.label}
                </button>
              );
            })}
          </div>
          {reshaped && <p className="m-hint">{t('reshaped')}</p>}
          <button className="m-cta" onClick={go} disabled={!projectDuration(project)}>
            <Upload size={20} style={{ transform: 'rotate(180deg)' }} /> {t('start')}
          </button>
        </>
      )}
      {error && <p className="m-error" dir="auto">{t('failed')}: {error}</p>}
    </div>
  );
}

type Tab = 'captions' | 'style' | 'agent' | 'export';

function ProjectScreen({ onBack }: { onBack: () => void }) {
  const project = useStore((s) => s.project)!;
  const { t } = useL();
  const [tab, setTab] = useState<Tab>('captions');
  const tabs: [Tab, typeof Captions, keyof typeof S][] = [
    ['captions', Captions, 'captions'],
    ['style', Palette, 'style'],
    ['agent', Bot, 'agent'],
    ['export', Download, 'export'],
  ];
  return (
    <div className="m-screen m-project">
      <header className="m-top">
        <button className="m-icon" onClick={onBack} aria-label="Back">
          <ArrowLeft size={22} className="flip-rtl" />
        </button>
        <h1 dir="auto">{project.name}</h1>
      </header>
      <div className="m-stage">
        <Stage />
      </div>
      <nav className="m-tabs" role="tablist">
        {tabs.map(([id, Icon, k]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            <Icon size={20} />
            <span>{t(k)}</span>
          </button>
        ))}
      </nav>
      <div className="m-body">
        {tab === 'captions' && <CaptionsPanel project={project} />}
        {tab === 'style' && <StylePanel project={project} />}
        {tab === 'agent' && (
          <div className="m-agent">
            <AgentTab />
          </div>
        )}
        {tab === 'export' && <ExportPanel project={project} />}
      </div>
    </div>
  );
}

export function MobileApp() {
  const project = useStore((s) => s.project);
  const lang = useStore((s) => s.lang);
  const toast = useStore((s) => s.toast);
  const [screen, setScreen] = useState<'home' | 'project'>(() => (new URLSearchParams(location.search).get('project') ? 'project' : 'home'));

  useEffect(() => {
    const off = connectEvents();
    const wanted = new URLSearchParams(location.search).get('project');
    if (wanted) void useStore.getState().open(wanted).catch(() => setScreen('home'));
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {});
    return off;
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
    try {
      localStorage.setItem('studio.lang', lang);
    } catch {}
  }, [lang]);
  useEffect(() => {
    // The phone's back button leaves the project instead of the studio.
    const onPop = () => setScreen(new URLSearchParams(location.search).get('project') ? 'project' : 'home');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const open = async (id: string) => {
    await useStore.getState().open(id);
    history.pushState(null, '', `/?m=1&project=${encodeURIComponent(id)}`);
    setScreen('project');
  };
  const back = () => {
    history.pushState(null, '', '/?m=1');
    setScreen('home');
  };

  return (
    <div className="m-app">
      {screen === 'project' && project ? <ProjectScreen onBack={back} /> : screen === 'project' ? <div className="m-loading"><Loader2 className="spin" /></div> : <Home onOpen={(id) => void open(id)} />}
      {toast && <div className="m-toast" dir="auto">{toast}</div>}
      {screen === 'project' && project && <AgentFx />}
    </div>
  );
}
