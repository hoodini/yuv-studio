import { Check, Copy, ExternalLink, Film, Image as ImageIcon, KeyRound, Layers, Loader2, Music, Plus, Search, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { actions } from '../actions';
import { useT } from '../i18n';
import { playback } from '../playback';
import { flushSave, useStore } from '../store';

type Kind = 'video' | 'image' | 'audio' | 'overlay';
interface Item {
  id: string;
  source: 'openverse' | 'pexels' | 'pixabay';
  kind: 'video' | 'image' | 'audio';
  title: string;
  thumb: string;
  preview: string;
  url: string;
  width?: number;
  height?: number;
  duration?: number;
  creator: string;
  license: string;
  licenseUrl: string;
  pageUrl: string;
  credit: string;
}
interface SourceStatus {
  id: 'openverse' | 'pexels' | 'pixabay';
  label: string;
  kinds: string[];
  needsKey: boolean;
  hasKey: boolean;
  keyHint: string;
  keyUrl: string;
  terms: string;
}

const TOPICS: Record<Kind, [string, string][]> = {
  video: [
    ['טכנולוגיה', 'technology'],
    ['עיר בלילה', 'city night'],
    ['מחשב נייד', 'laptop typing'],
    ['טבע', 'nature drone'],
    ['אנשים במשרד', 'office people'],
    ['חלל', 'space stars'],
  ],
  image: [
    ['רקע אבסטרקטי', 'abstract background'],
    ['טקסטורה', 'texture'],
    ['שקיעה', 'sunset'],
    ['קוד על מסך', 'code screen'],
    ['ישראל', 'israel'],
  ],
  audio: [
    ['מוזיקת רקע', 'background music'],
    ['אמביינט', 'ambient'],
    ['וווש', 'whoosh'],
    ['קליק', 'click'],
    ['מחיאות כפיים', 'applause'],
  ],
  overlay: [
    ['דליפות אור', 'light leak'],
    ['גרעין פילם', 'film grain'],
    ['אבק וחלקיקים', 'dust particles'],
    ['בוקה', 'bokeh'],
    ['הבזק עדשה', 'lens flare'],
    ['עשן', 'smoke black background'],
  ],
};

const fmt = (s?: number) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');

/** Free B-roll, overlays, photos, music and sound effects, searched from inside the editor and added in one click. */
export function StockTab() {
  const project = useStore((s) => s.project)!;
  const jobs = useStore((s) => s.jobs);
  const { isHe } = useT();
  const L = (he: string, en: string) => (isHe ? he : en);
  const [kind, setKind] = useState<Kind>('video');
  const [q, setQ] = useState('');
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [source, setSource] = useState<SourceStatus['id']>('pexels');
  const [items, setItems] = useState<Item[]>([]);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needsKey, setNeedsKey] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [keys, setKeys] = useState({ pexelsKey: '', pixabayKey: '' });
  const [adding, setAdding] = useState<Record<string, string>>({});
  const lastQuery = useRef('');

  const loadStatus = () =>
    fetch('/api/stock/status')
      .then((r) => r.json())
      .then((s: SourceStatus[]) => setSources(s));
  useEffect(() => void loadStatus(), []);

  // The sources that have this kind; overlays are videos.
  const want = kind === 'overlay' ? 'video' : kind;
  const usable = sources.filter((s) => s.kinds.includes(want));
  useEffect(() => {
    if (!usable.length) return;
    if (!usable.some((s) => s.id === source)) setSource((usable.find((s) => !s.needsKey || s.hasKey) || usable[0]).id);
  }, [kind, sources]);
  const current = sources.find((s) => s.id === source);

  const search = async (query = q, pg = 1) => {
    const text = query.trim();
    if (!text) return;
    lastQuery.current = text;
    setBusy(true);
    setError('');
    setNeedsKey(false);
    try {
      const res = await fetch(`/api/stock/search?${new URLSearchParams({ source, kind: want, q: kind === 'overlay' && !/overlay/i.test(text) ? `${text} overlay` : text, page: String(pg) })}`);
      const data = await res.json();
      if (!res.ok) {
        setNeedsKey(/key/i.test(data.error || ''));
        throw new Error(data.error || res.statusText);
      }
      setItems(pg === 1 ? data.items : (x) => [...x, ...data.items]);
      setPage(pg);
    } catch (e: any) {
      setError(String(e.message || e));
      if (pg === 1) setItems([]);
    } finally {
      setBusy(false);
    }
  };

  const saveKeys = async () => {
    const body: Record<string, string> = {};
    if (keys.pexelsKey.trim()) body.pexelsKey = keys.pexelsKey.trim();
    if (keys.pixabayKey.trim()) body.pixabayKey = keys.pixabayKey.trim();
    if (!Object.keys(body).length) return;
    const res = await fetch('/api/stock/keys', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) {
      setSources(await res.json());
      setKeys({ pexelsKey: '', pixabayKey: '' });
      setShowKeys(false);
      useStore.getState().notify(L('המפתח נשמר במחשב הזה', 'Key saved on this computer'));
      if (lastQuery.current) void search(lastQuery.current);
    }
  };

  /** how: 'media' = only into the media list, 'broll' = on a layer above at the playhead, 'overlay' = full frame with Screen. */
  const add = async (it: Item, how: 'media' | 'broll' | 'overlay') => {
    setAdding((a) => ({ ...a, [it.id]: 'running' }));
    await flushSave();
    try {
      const res = await fetch(`/api/projects/${project.id}/assets/import-url`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: it.url,
          name: `${it.title || it.source}`.slice(0, 60),
          start: playback.time,
          broll: how === 'broll',
          addToTimeline: how === 'broll',
          overlay: how === 'overlay',
          source: { name: sources.find((s) => s.id === it.source)?.label || it.source, url: it.pageUrl, license: it.license, credit: it.credit },
        }),
      });
      const job = await res.json();
      if (!res.ok) throw new Error(job.error || res.statusText);
      setAdding((a) => ({ ...a, [it.id]: job.id }));
    } catch (e: any) {
      setAdding((a) => ({ ...a, [it.id]: '' }));
      useStore.getState().notify(String(e.message || e));
    }
  };
  // When an import job ends, reload so the new clip shows, and mark the card.
  useEffect(() => {
    for (const [id, jid] of Object.entries(adding)) {
      const j = jobs[jid];
      if (!j || j.status === 'running') continue;
      setAdding((a) => ({ ...a, [id]: j.status === 'done' ? 'done' : '' }));
      if (j.status === 'done') void useStore.getState().reload();
      else useStore.getState().notify(j.error || 'Error');
    }
  }, [jobs]);

  const credits = project.assets.map((a) => a.source?.credit).filter(Boolean) as string[];
  const copyCredits = () => void navigator.clipboard?.writeText(credits.join('\n')).then(() => useStore.getState().notify(L(`${credits.length} שורות קרדיט הועתקו`, `${credits.length} credit lines copied`)));

  const KINDS: [Kind, typeof Film, string, string][] = [
    ['video', Film, 'B-roll וידאו', 'Video B-roll'],
    ['overlay', Sparkles, 'אוברליי', 'Overlays'],
    ['image', ImageIcon, 'תמונות', 'Photos'],
    ['audio', Music, 'מוזיקה ואפקטים', 'Music & SFX'],
  ];

  return (
    <div className="tab-body stock-tab">
      <div className="seg big stock-kinds" role="tablist">
        {KINDS.map(([k, Icon, he, en]) => (
          <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'active' : ''} onClick={() => (setKind(k), setItems([]), setError(''))}>
            <Icon size={14} /> {L(he, en)}
          </button>
        ))}
      </div>
      {kind === 'overlay' && <p className="hint">{L('אוברליי נכנס לשכבה עליונה על כל הפריים, במצב "מסך": השחור נעלם ונשאר רק האור.', 'An overlay goes on a top layer over the whole frame in Screen mode: the black disappears and only the light stays.')}</p>}

      <form
        className="stock-search"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <Search size={16} aria-hidden />
        <input dir="auto" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L('חיפוש באנגלית עובד הכי טוב: city, ocean, laptop…', 'Search: city, ocean, laptop…')} aria-label={L('חיפוש', 'Search')} />
        <button className="mini" type="submit" disabled={busy || !q.trim()} aria-label={L('חיפוש', 'Search')}>
          {busy ? <Loader2 className="spin" size={15} /> : <Search size={15} />}
        </button>
      </form>
      <div className="chip-row wrap">
        {TOPICS[kind].map(([he, en]) => (
          <button key={en} className="chip-btn" onClick={() => (setQ(en), void search(en))}>
            {L(he, en)}
          </button>
        ))}
      </div>

      <div className="stock-sources">
        {usable.map((s) => (
          <button key={s.id} className={`chip-btn${source === s.id ? ' active' : ''}`} onClick={() => setSource(s.id)} title={s.needsKey && !s.hasKey ? L('דורש מפתח חינמי', 'Needs a free key') : s.label}>
            {s.label} {s.needsKey && !s.hasKey && <KeyRound size={12} />}
          </button>
        ))}
        <button className="mini" onClick={() => setShowKeys(!showKeys)} title={L('מפתחות חינמיים', 'Free keys')} aria-label={L('מפתחות חינמיים', 'Free keys')} aria-expanded={showKeys}>
          <KeyRound size={15} />
        </button>
      </div>

      {(showKeys || (needsKey && current?.needsKey)) && (
        <div className="engine-box">
          <p className="hint">{L('Pexels ו-Pixabay נותנים מפתח חינמי תוך דקה, בלי כרטיס אשראי. המפתח נשמר רק במחשב הזה. Openverse עובד בלי מפתח (תמונות ומוזיקה).', 'Pexels and Pixabay give a free key in a minute, no credit card. The key stays on this computer. Openverse works without one (photos and music).')}</p>
          {sources
            .filter((s) => s.needsKey)
            .map((s) => (
              <label key={s.id} className="select">
                <span>
                  {s.label} {s.hasKey && <em dir="ltr">({s.keyHint})</em>}{' '}
                  <a className="link-btn" href={s.keyUrl} target="_blank" rel="noreferrer">
                    {L('להשגת מפתח', 'Get a key')} <ExternalLink size={11} />
                  </a>
                </span>
                <input type="password" autoComplete="off" dir="ltr" value={s.id === 'pexels' ? keys.pexelsKey : keys.pixabayKey} onChange={(e) => setKeys((k) => ({ ...k, [s.id === 'pexels' ? 'pexelsKey' : 'pixabayKey']: e.target.value }))} placeholder={s.hasKey ? L('להחלפת המפתח', 'Replace the key') : L('הדביקו מפתח', 'Paste a key')} />
              </label>
            ))}
          <button className="pill sm strong" onClick={saveKeys} disabled={!keys.pexelsKey.trim() && !keys.pixabayKey.trim()}>
            {L('שמירה', 'Save')}
          </button>
          <p className="hint">
            {L('גם Mixkit חינמי, אבל אין לו API: ', 'Mixkit is free too, but has no API: ')}
            <a className="link-btn" href="https://mixkit.co/free-stock-video/" target="_blank" rel="noreferrer">
              mixkit.co <ExternalLink size={11} />
            </a>
            {L(' הורידו משם וגררו את הקובץ לעורך.', ' download there and drop the file on the editor.')}
          </p>
        </div>
      )}

      {error && !needsKey && <p className="hint warn-text">{error}</p>}
      {!items.length && !busy && !error && <p className="hint">{L('חפשו או בחרו נושא. לחיצה על + מוסיפה לציר בסמן.', 'Search or pick a topic. + adds it to the timeline at the playhead.')}</p>}

      <div className={`stock-grid${kind === 'audio' ? ' audio' : ''}`}>
        {items.map((it) => {
          const st = adding[it.id];
          const running = st && st !== 'done';
          return (
            <div key={it.id} className="stock-card">
              {it.kind === 'audio' ? (
                <div className="stock-audio">
                  <Music size={16} />
                  <span dir="auto" className="stock-title">
                    {it.title}
                  </span>
                  {it.preview && <audio controls preload="none" src={it.preview} />}
                </div>
              ) : (
                <div className="stock-thumb" onMouseEnter={(e) => e.currentTarget.querySelector('video')?.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.querySelector('video')?.pause()}>
                  <img src={it.thumb} alt="" loading="lazy" />
                  {it.kind === 'video' && it.preview && <video src={it.preview} muted loop playsInline preload="none" />}
                  {it.duration ? <span className="stock-dur">{fmt(it.duration)}</span> : null}
                </div>
              )}
              <div className="stock-meta">
                <span className="stock-lic" title={`${it.license}${it.creator ? ` · ${it.creator}` : ''}`}>
                  {it.license}
                  {it.credit ? ` · ${L('קרדיט', 'credit')}` : ''}
                </span>
                <div className="stock-actions">
                  {st === 'done' ? (
                    <Check size={15} className="ok-text" />
                  ) : running ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <>
                      {kind === 'overlay' ? (
                        <button className="mini" onClick={() => void add(it, 'overlay')} title={L('אוברליי על כל הפריים בסמן', 'Overlay over the frame at the playhead')} aria-label={L('הוספת אוברליי', 'Add overlay')}>
                          <Layers size={15} />
                        </button>
                      ) : it.kind !== 'audio' ? (
                        <button className="mini" onClick={() => void add(it, 'broll')} title={L('B-roll בסמן, בשכבה מעל', 'B-roll at the playhead, on a layer above')} aria-label={L('הוספה לציר', 'Add to timeline')}>
                          <Plus size={15} />
                        </button>
                      ) : null}
                      <button className="mini" onClick={() => void add(it, 'media')} title={L('למדיה בלבד', 'To the media list only')} aria-label={L('ייבוא למדיה', 'Import to media')}>
                        <Film size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {items.length > 0 && (
        <button className="link-btn" disabled={busy} onClick={() => void search(lastQuery.current, page + 1)}>
          {busy ? '…' : L('עוד תוצאות', 'More results')}
        </button>
      )}
      {credits.length > 0 && (
        <button className="chip-btn" onClick={copyCredits}>
          <Copy size={13} /> {L(`העתקת הקרדיטים לתיאור הסרטון (${credits.length})`, `Copy credits for the video description (${credits.length})`)}
        </button>
      )}
      <p className="hint">
        {current && (
          <a className="link-btn" href={current.terms} target="_blank" rel="noreferrer">
            {L('תנאי השימוש של', 'Terms of')} {current.label} <ExternalLink size={11} />
          </a>
        )}
      </p>
    </div>
  );
}
