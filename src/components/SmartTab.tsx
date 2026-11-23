// The smart tools: edit by deleting text, remove filler words, clean the voice, reframe to vertical following the
// face, and find the moments of a long video that work as shorts. Each runs as a job on the server.
import { Eraser, Mic2, Scissors, Smartphone, Sparkles, TextCursorInput, UserRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Job } from '../../shared/types';
import { actions } from '../actions';
import { api } from '../api';
import { useT } from '../i18n';
import { playback } from '../playback';
import { useStore } from '../store';

interface W {
  i: number;
  t0: number;
  t1: number;
  text: string;
  filler?: string;
}
interface Short {
  start: number;
  end: number;
  title: string;
  hook: string;
  reason: string;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Start a server job and follow it through the live job events. */
function useJob(onDone?: (result: any) => void) {
  const [id, setId] = useState('');
  const job: Job | undefined = useStore((s) => (id ? s.jobs[id] : undefined));
  const notify = useStore((s) => s.notify);
  useEffect(() => {
    if (job?.status === 'error') notify(job.error || 'Error');
    if (job?.status === 'done') onDone?.(job.result);
  }, [job?.status]);
  const running = job?.status === 'running' || job?.status === 'queued';
  const start = async (fn: (projectId: string) => Promise<Job>) => {
    const j = await actions.server(fn);
    if (j) setId(j.id);
  };
  return { job, running, start };
}

function Progress({ job }: { job?: Job }) {
  if (!job || (job.status !== 'running' && job.status !== 'queued')) return null;
  return (
    <>
      <div className="progress">
        <i style={{ width: `${(job.progress || 0) * 100}%` }} />
      </div>
      {job.message && <p className="hint">{job.message}</p>}
    </>
  );
}

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <section className="engine-box smart-card">
      <h4>
        <Icon size={16} /> {title}
      </h4>
      {children}
    </section>
  );
}

/** Edit by text: the transcript as words. Click a word to jump there; select words and cut them; fillers are marked. */
function TranscriptEditor({ language, L }: { language: string; L: (h: string, e: string) => string }) {
  const [words, setWords] = useState<W[]>([]);
  const [sel, setSel] = useState<[number, number] | null>(null);
  const [aggressive, setAggressive] = useState(false);
  const load = useJob((r) => (setWords(r.words || []), setSel(null)));
  const cut = useJob(() => void load.start((id) => api.words(id, { language, aggressive })));
  const fillers = useJob((r) => {
    useStore.getState().notify(r.cuts ? L(`הוסרו ${r.cuts} מילות מילוי, ${r.removed.toFixed(1)} שניות`, `Removed ${r.cuts} filler words, ${r.removed.toFixed(1)} seconds`) : L('לא נמצאו מילות מילוי', 'No filler words found'));
    void load.start((id) => api.words(id, { language, aggressive }));
  });
  const fillerCount = useMemo(() => words.filter((w) => w.filler).length, [words]);
  const busy = load.running || cut.running || fillers.running;
  const [a, b] = sel ? [Math.min(...sel), Math.max(...sel)] : [-1, -1];
  const pick = (i: number, e: React.MouseEvent) => {
    playback.seek(words[i].t0);
    setSel(e.shiftKey && sel ? [sel[0], i] : [i, i]);
  };
  const cutSelected = () => {
    if (a < 0) return;
    const indices: number[] = [];
    for (let i = a; i <= b; i++) indices.push(i);
    void cut.start((id) => api.cutWords(id, { indices, language }));
  };
  // Delete / Backspace on a selection cuts it, like deleting text.
  useEffect(() => {
    if (a < 0) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && !(e.target as HTMLElement)?.closest?.('input, textarea, select')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        cutSelected();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [a, b, words]);
  return (
    <>
      <p className="hint">{L('עורכים את הווידאו כמו טקסט: לוחצים על מילה כדי לקפוץ אליה, מסמנים כמה מילים (Shift + לחיצה) ומוחקים. הכתוביות זזות יחד עם החיתוך.', 'Edit the video like text: click a word to jump to it, select words (Shift + click) and delete them. Captions follow the cut.')}</p>
      <div className="field-row">
        <button className="pill sm" onClick={() => void load.start((id) => api.words(id, { language, aggressive }))} disabled={busy}>
          <TextCursorInput size={15} /> {words.length ? L('לרענן תמלול', 'Refresh transcript') : L('לטעון תמלול', 'Load transcript')}
        </button>
        {a >= 0 && (
          <button className="pill sm strong" onClick={cutSelected} disabled={busy}>
            <Scissors size={15} /> {L(`לחתוך ${b - a + 1} מילים`, `Cut ${b - a + 1} words`)}
          </button>
        )}
      </div>
      <Progress job={load.job} />
      <Progress job={cut.job} />
      {words.length > 0 && (
        <div className="words" dir="auto">
          {words.map((w) => (
            <span key={w.i} className={`word${w.filler ? ' filler' : ''}${w.i >= a && w.i <= b ? ' sel' : ''}`} onClick={(e) => pick(w.i, e)} title={`${fmt(w.t0)}${w.filler ? ` · ${L('מילת מילוי', 'filler')}` : ''}`}>
              {w.text}{' '}
            </span>
          ))}
        </div>
      )}
      <div className="sub-head">
        <Eraser size={15} /> {L('מילות מילוי', 'Filler words')}
      </div>
      <p className="hint">{L('"אה", "אממ", "um", "uh" ומילה שנאמרה פעמיים ברצף. במצב מורחב גם "כאילו", "בעצם", "basically", "you know".', '"um", "uh", "אה", "אממ" and a word said twice in a row. Extended mode also takes "basically", "you know", "כאילו", "בעצם".')}</p>
      <label className="check-row">
        <input type="checkbox" checked={aggressive} onChange={(e) => setAggressive(e.target.checked)} />
        <span>{L('מצב מורחב', 'Extended mode')}</span>
      </label>
      <button className="pill wide strong" onClick={() => void fillers.start((id) => api.removeFillers(id, { language, aggressive }))} disabled={busy}>
        <Eraser size={17} /> {fillers.running ? `${Math.round((fillers.job?.progress || 0) * 100)}%` : words.length && fillerCount ? L(`להסיר ${fillerCount} מילות מילוי`, `Remove ${fillerCount} filler words`) : L('להסיר מילות מילוי', 'Remove filler words')}
      </button>
      <Progress job={fillers.job} />
    </>
  );
}

function CleanVoice({ L }: { L: (h: string, e: string) => string }) {
  const project = useStore((s) => s.project)!;
  // Files with sound that are on the timeline, newest last.
  const onTimeline = new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.assetId)));
  const options = project.assets.filter((a) => a.hasAudio && onTimeline.has(a.id) && !a.name.startsWith('SFX · '));
  const [assetId, setAssetId] = useState('');
  const [strength, setStrength] = useState<'light' | 'strong'>('light');
  const chosen = options.find((a) => a.id === assetId) || options[0];
  const job = useJob((r) => useStore.getState().notify(L(`הקול נוקה. ${r.replacedClips} קליפים עברו לגרסה הנקייה; המקור נשאר ברשימת המדיה.`, `Voice cleaned. ${r.replacedClips} clips now use the clean version; the original stays in the media list.`)));
  if (!options.length) return <p className="hint">{L('אין בציר הזמן קובץ עם סאונד.', 'There is no file with sound on the timeline.')}</p>;
  return (
    <>
      <p className="hint">{L('מוריד רעש רקע וזמזום, מאזן את עוצמת הקול ומביא אותה לרמה של רשתות חברתיות. התמונה לא משתנה.', 'Takes out background noise and hum, evens out the level and brings it to social media loudness. The picture is untouched.')}</p>
      <div className="field-row">
        <label>
          <span>{L('קובץ', 'File')}</span>
          <select value={chosen?.id} onChange={(e) => setAssetId(e.target.value)}>
            {options.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{L('עוצמה', 'Strength')}</span>
          <select value={strength} onChange={(e) => setStrength(e.target.value as any)}>
            <option value="light">{L('עדין', 'Light')}</option>
            <option value="strong">{L('חזק (חדר רועש)', 'Strong (noisy room)')}</option>
          </select>
        </label>
      </div>
      <button className="pill wide strong" onClick={() => chosen && void job.start((id) => api.enhanceVoice(id, chosen.id, strength))} disabled={job.running}>
        <Mic2 size={17} /> {job.running ? `${Math.round((job.job?.progress || 0) * 100)}%` : L('לנקות את הקול', 'Clean the voice')}
      </button>
      <Progress job={job.job} />
    </>
  );
}

function Reframe({ L }: { L: (h: string, e: string) => string }) {
  const project = useStore((s) => s.project)!;
  const [size, setSize] = useState('1080x1920');
  const job = useJob((r) => useStore.getState().notify(r.followed ? L(`המסגור עודכן: ${r.followed} קליפים עוקבים אחרי הפנים`, `Reframed: ${r.followed} clips follow the face`) : L('המסגור עודכן, אבל לא נמצאו פנים לעקוב אחריהן', 'Reframed, but no face was found to follow')));
  const [w, h] = size.split('x').map(Number);
  const vertical = project.width < project.height;
  return (
    <>
      <p className="hint">{L('הופך סרטון רחב לאנכי, והמסגרת עוקבת אחרי הדובר כמו צלם: נשארת במקום כשהוא יציב, וזזה בעדינות כשהוא זז. מיקום כל נקודה ניתן לתיקון בציר הזמן.', 'Turns a wide video vertical, and the frame follows the speaker like a camera operator: still while they stay put, gliding when they move. Every point can be adjusted on the timeline.')}</p>
      <label>
        <span>{L('גודל', 'Size')}</span>
        <select value={size} onChange={(e) => setSize(e.target.value)}>
          <option value="1080x1920">9:16 · Reels, TikTok, Shorts</option>
          <option value="1080x1350">4:5 · Instagram, LinkedIn</option>
          <option value="1080x1080">1:1</option>
        </select>
      </label>
      <button
        className="pill wide strong"
        onClick={() => {
          if (!vertical && !confirm(L('הפרויקט יעבור לגודל החדש. אפשר לבטל עם Ctrl+Z. להמשיך?', 'The project changes to the new size. Ctrl+Z undoes it. Continue?'))) return;
          void job.start((id) => api.reframe(id, { width: w, height: h }));
        }}
        disabled={job.running}
      >
        <Smartphone size={17} /> {job.running ? `${Math.round((job.job?.progress || 0) * 100)}%` : L('למסגר לפי הפנים', 'Reframe to the face')}
      </button>
      <Progress job={job.job} />
    </>
  );
}

function Shorts({ language, L }: { language: string; L: (h: string, e: string) => string }) {
  const [clips, setClips] = useState<Short[]>([]);
  const [count, setCount] = useState(5);
  const [maxSec, setMaxSec] = useState(60);
  const find = useJob((r) => setClips(r.clips || []));
  const make = useJob((r) => {
    useStore.getState().notify(L(`נוצר פרויקט חדש: ${r.name}`, `New project created: ${r.name}`));
    window.open(r.editorUrl, '_blank');
  });
  return (
    <>
      <p className="hint">{L('קורא את התמלול ומוצא את הרגעים שעומדים בפני עצמם כסרטון קצר, עם הוק חזק בהתחלה וסוף עם פואנטה. משתמש במודל שבלשונית סוכן ה-AI.', 'Reads the transcript and finds the moments that stand alone as a short: a strong hook at the start and a payoff at the end. Uses the model from the AI agent tab.')}</p>
      <div className="field-row">
        <label>
          <span>{L('כמה קליפים', 'How many')}</span>
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[3, 5, 8, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{L('אורך מקסימלי', 'Max length')}</span>
          <select value={maxSec} onChange={(e) => setMaxSec(Number(e.target.value))}>
            {[30, 45, 60, 90].map((n) => (
              <option key={n} value={n}>
                {n}s
              </option>
            ))}
          </select>
        </label>
      </div>
      <button className="pill wide strong" onClick={() => void find.start((id) => api.findShorts(id, { count, maxSec, minSec: Math.min(20, maxSec / 2), language }))} disabled={find.running}>
        <Sparkles size={17} /> {find.running ? `${Math.round((find.job?.progress || 0) * 100)}%` : L('למצוא קליפים קצרים', 'Find short clips')}
      </button>
      <Progress job={find.job} />
      {clips.map((c, k) => (
        <div key={k} className="short-item">
          <button className="short-head" onClick={() => (playback.seek(c.start), playback.play())} title={L('לנגן מכאן', 'Play from here')}>
            <b dir="auto">{c.title}</b>
            <span dir="ltr">
              {fmt(c.start)}–{fmt(c.end)} · {Math.round(c.end - c.start)}s
            </span>
          </button>
          <p dir="auto" className="short-hook">
            “{c.hook}”
          </p>
          <p dir="auto" className="hint">
            {c.reason}
          </p>
          <button className="pill sm" onClick={() => void make.start((id) => api.makeShort(id, { start: c.start, end: c.end, title: c.title }))} disabled={make.running}>
            <Smartphone size={14} /> {make.running ? `${Math.round((make.job?.progress || 0) * 100)}%` : L('ליצור סרטון אנכי', 'Make a vertical short')}
          </button>
        </div>
      ))}
      <Progress job={make.job} />
    </>
  );
}

function RemoveBackground({ L }: { L: (h: string, e: string) => string }) {
  const project = useStore((s) => s.project)!;
  const selection = useStore((s) => s.selection);
  const [background, setBackground] = useState<'none' | 'blur' | 'original'>('blur');
  const [text, setText] = useState('');
  const [quality, setQuality] = useState<'quality' | 'fast'>('quality');
  // The selected video clip, else the first clip of the main video layer.
  const videoClips = project.tracks.filter((t) => t.kind === 'video').flatMap((t) => t.clips.filter((c) => c.type === 'video'));
  // Not the background copies a removal puts on a lower layer (their ids end in _bg).
  const main = [...project.tracks].reverse().filter((t) => t.kind === 'video').flatMap((t) => t.clips.filter((c) => c.type === 'video' && !c.id.endsWith('_bg')));
  const clip = videoClips.find((c) => selection.includes(c.id)) || main[0];
  const asset = clip ? project.assets.find((a) => a.id === clip.assetId) : undefined;
  const job = useJob(() => useStore.getState().notify(L('הרקע הוסר', 'Background removed')));
  if (!clip || !asset) return <p className="hint">{L('אין קליפ וידאו בציר הזמן.', 'There is no video clip on the timeline.')}</p>;
  const done = !!asset.alpha;
  const seconds = Math.round(clip.duration);
  return (
    <>
      <p className="hint">{L('מפריד את האנשים מהרקע בלי מסך ירוק, פריים אחרי פריים ובלי ריצודים. אחר כך אפשר לטשטש את הרקע, לשים מאחור כל תמונה או וידאו, או טקסט שמופיע מאחורי הדובר.', 'Separates the people from the background with no green screen, frame by frame and without flicker. Then blur the background, put any picture or video behind, or text that appears behind the speaker.')}</p>
      <p className="hint">
        <b dir="auto">{asset.name}</b> · {seconds}s{selection.includes(clip.id) ? '' : L(' (סמנו קליפ בציר הזמן כדי לבחור אחר)', ' (select a clip on the timeline to pick another)')}
      </p>
      {done ? (
        <p className="hint">{L('לקליפ הזה כבר הוסר הרקע.', 'This clip already has its background removed.')}</p>
      ) : (
        <>
          <label>
            <span>{L('מה יהיה מאחור', 'What goes behind')}</span>
            <select value={background} onChange={(e) => setBackground(e.target.value as any)}>
              <option value="blur">{L('הרקע המקורי מטושטש (מצב פורטרט)', 'The original, blurred (portrait mode)')}</option>
              <option value="original">{L('הרקע המקורי, עם טקסט מאחורי הדובר', 'The original, with text behind the speaker')}</option>
              <option value="none">{L('שקוף: השכבות שמתחת (תמונה, וידאו, צבע)', 'Transparent: the layers below (picture, video, colour)')}</option>
            </select>
          </label>
          {background === 'original' && (
            <label>
              <span>{L('הטקסט שמאחורי הדובר', 'The text behind the speaker')}</span>
              <input dir="auto" value={text} onChange={(e) => setText(e.target.value)} placeholder={L('למשל: עכשיו בחינם', 'e.g. NOW FREE')} />
            </label>
          )}
          <label>
            <span>{L('איכות', 'Quality')}</span>
            <select value={quality} onChange={(e) => setQuality(e.target.value as any)}>
              <option value="quality">{L('גבוהה (מומלץ עם כרטיס מסך)', 'High (best with a GPU)')}</option>
              <option value="fast">{L('מהירה', 'Fast')}</option>
            </select>
          </label>
          <button className="pill wide strong" onClick={() => void job.start((id) => api.removeBackground(id, clip.id, { background, text: background === 'original' ? text.trim() || undefined : undefined, quality }))} disabled={job.running}>
            <UserRound size={17} /> {job.running ? `${Math.round((job.job?.progress || 0) * 100)}%` : L('להסיר רקע', 'Remove background')}
          </button>
          <Progress job={job.job} />
          {!job.running && <p className="hint">{L(`עם כרטיס מסך זה לוקח בערך כמו אורך הקליפ (${seconds} שניות). בפעם הראשונה המודל יורד (15-107MB).`, `With a GPU it takes about as long as the clip (${seconds} seconds). The first time, the model downloads (15-107 MB).`)}</p>}
        </>
      )}
    </>
  );
}

export function SmartTab() {
  const { isHe } = useT();
  const L = (h: string, e: string) => (isHe ? h : e);
  const [language, setLanguage] = useState(() => localStorage.getItem('studio.capLang') || 'auto');
  return (
    <div className="tab-body">
      <label>
        <span>{L('שפת הדיבור', 'Spoken language')}</span>
        <select value={language} onChange={(e) => (setLanguage(e.target.value), localStorage.setItem('studio.capLang', e.target.value))}>
          <option value="he">עברית</option>
          <option value="en">English</option>
          <option value="auto">{L('זיהוי אוטומטי', 'Detect')}</option>
        </select>
      </label>
      <Section icon={TextCursorInput} title={L('עריכה דרך הטקסט', 'Edit by text')}>
        <TranscriptEditor language={language} L={L} />
      </Section>
      <Section icon={Sparkles} title={L('קליפים קצרים מסרטון ארוך', 'Shorts from a long video')}>
        <Shorts language={language} L={L} />
      </Section>
      <Section icon={UserRound} title={L('הסרת רקע', 'Remove background')}>
        <RemoveBackground L={L} />
      </Section>
      <Section icon={Smartphone} title={L('אנכי עם מעקב פנים', 'Vertical, following the face')}>
        <Reframe L={L} />
      </Section>
      <Section icon={Mic2} title={L('ניקוי קול', 'Clean voice')}>
        <CleanVoice L={L} />
      </Section>
    </div>
  );
}
