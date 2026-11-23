import { Bot, Check, ChevronDown, Download, FolderPlus, Loader2, Plug, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { setProjectSettings } from '../shared/ops';
import { EXPORT_PRESETS } from '../shared/presets';
import { projectDuration } from '../shared/types';
import { actions, installShortcuts } from './actions';
import { api } from './api';
import { AboutDialog } from './components/About';
import { AgentFx } from './components/AgentFx';
import { UploadStatus } from './components/UploadStatus';
import { Inspector } from './components/Inspector';
import { McpGuide } from './components/McpGuide';
import { NewProjectDialog } from './components/NewProject';
import { LeftPanel } from './components/LeftPanel';
import { LiquidSky } from './components/LiquidSky';
import { SideSplitter, TimelineSplitter } from './components/Splitter';
import { IconFill, IconFit } from './components/icons';
import { useLayout } from './layout';
import { Stage } from './components/Stage';
import { Timeline } from './components/Timeline';
import { useT } from './i18n';
import { connectEvents, flushSave, useStore } from './store';

function ProjectMenu() {
  const project = useStore((s) => s.project)!;
  const { open, edit, checkpoint } = useStore.getState();
  const { t } = useT();
  const [show, setShow] = useState(false);
  const [list, setList] = useState<{ id: string; name: string; clips: number }[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!show) return;
    void api.projects().then(setList);
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setShow(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [show]);
  const create = () => {
    setShow(false);
    setNewOpen(true);
  };
  const remove = async () => {
    if (!confirm(t('confirmDelete'))) return;
    await flushSave();
    await api.remove(project.id);
    const rest = (await api.projects()).filter((x) => x.id !== project.id);
    await open(rest[0]?.id || (await api.create(t('newProject'))).id);
    setShow(false);
  };
  return (
    <div className="project-menu" ref={ref}>
      <input className="project-name" dir="auto" value={project.name} onFocus={checkpoint} onChange={(e) => edit((d) => setProjectSettings(d, { name: e.target.value }), true)} aria-label={t('name')} />
      <button className="icon-btn sm" onClick={() => setShow(!show)} aria-label={t('projects')} aria-expanded={show}>
        <ChevronDown size={18} />
      </button>
      {show && (
        <div className="menu">
          <button className="menu-item strong" onClick={create}>
            <FolderPlus size={16} /> {t('newProject')}
          </button>
          <div className="menu-list">
            {list.map((p) => (
              <button key={p.id} className={`menu-item${p.id === project.id ? ' active' : ''}`} onClick={async () => (await flushSave(), await open(p.id), setShow(false))}>
                <span dir="auto">{p.name}</span>
                {p.id === project.id && <Check size={15} />}
              </button>
            ))}
          </div>
          <button className="menu-item danger" onClick={remove}>
            <Trash2 size={15} /> {t('deleteProject')}
          </button>
        </div>
      )}
      {newOpen && <NewProjectDialog onClose={() => setNewOpen(false)} />}
    </div>
  );
}

function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const jobs = useStore((s) => s.jobs);
  const { t } = useT();
  const [quality, setQuality] = useState('high');
  const [height, setHeight] = useState(0);
  const [fps, setFps] = useState(0);
  // Several destinations can be picked: one export each, rendered one after the other.
  const [picked, setPicked] = useState<string[]>([]);
  const preset = picked.length === 1 ? picked[0] : '';
  const [reframe, setReframe] = useState<'fit' | 'fill'>('fit');
  const [jobIds, setJobIds] = useState<string[]>([]);
  const jobId = jobIds.length === 1 ? jobIds[0] : '';
  const [error, setError] = useState('');
  const job = jobs[jobId];
  const start = async () => {
    setError('');
    try {
      await flushSave();
      const ids: string[] = [];
      if (!picked.length)
        ids.push(
          (
            await api.exportVideo(project.id, {
              quality,
              ...(height && { height }),
              ...(fps && { fps }),
            })
          ).id,
        );
      for (const id of picked)
        ids.push(
          (
            await api.exportVideo(project.id, {
              quality,
              preset: id,
              reframe,
              ...(fps && { fps }),
            })
          ).id,
        );
      setJobIds(ids);
    } catch (e: any) {
      setError(String(e.message));
    }
  };
  const toggle = (id: string) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const heights = [2160, 1440, 1080, 720, 480].filter((h) => h < project.height);
  const chosen = EXPORT_PRESETS.find((x) => x.id === preset);
  const reshapes = picked.some((id) => {
    const x = EXPORT_PRESETS.find((y) => y.id === id)!;
    return Math.abs(x.width / x.height - project.width / project.height) > 0.01;
  });
  const { isHe } = useT();
  const many = jobIds.length > 1;
  const running = !many && job?.status === 'running';
  const mb = job?.result ? (job.result.size / 1048576).toFixed(1) : '';
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && !running && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={t('export')}>
        <header>
          <h2>{t('export')}</h2>
          <button className="icon-btn sm" onClick={onClose} aria-label={t('close')}>
            <X size={18} />
          </button>
        </header>
        {!jobIds.length && (
          <>
            <p className="hint">{isHe ? 'אפשר לבחור כמה יעדים, למשל יוטיוב וגם טיקטוק ורילס: כל אחד יוצא כקובץ משלו.' : 'Pick several destinations, for example YouTube and TikTok and Reels: each comes out as its own file.'}</p>
            <div className="preset-chips" role="group" aria-label={isHe ? 'יעדים' : 'Destinations'}>
              <button aria-pressed={!picked.length} className={`chip-btn${!picked.length ? ' active' : ''}`} onClick={() => setPicked([])}>
                {isHe ? 'כמו הפרויקט' : 'As the project'}
              </button>
              {EXPORT_PRESETS.map((x) => (
                <button key={x.id} aria-pressed={picked.includes(x.id)} className={`chip-btn${picked.includes(x.id) ? ' active' : ''}`} onClick={() => toggle(x.id)} title={`${x.width}×${x.height} · ${x.fps}fps`}>
                  {picked.includes(x.id) && <Check size={13} />} {isHe ? x.labelHe : x.label}
                </button>
              ))}
            </div>
            {reshapes && (
              <div className="seg big" role="radiogroup">
                <button className={reframe === 'fit' ? 'active' : ''} onClick={() => setReframe('fit')}>
                <IconFit />
                  {isHe ? 'להכניס הכול, רקע מטושטש' : 'Fit, blurred background'}
                </button>
                <button className={reframe === 'fill' ? 'active' : ''} onClick={() => setReframe('fill')}>
                <IconFill />
                  {isHe ? 'למלא, לחתוך את השוליים' : 'Fill, crop the edges'}
                </button>
              </div>
            )}
            {chosen && <p className="hint" dir="ltr">{`${chosen.width}×${chosen.height} · ${fps || chosen.fps} fps · ≤${chosen.maxrate} Mbit/s`}</p>}
            <div className="field-row" hidden={picked.length > 0}>
              <label className="select">
                <span>{t('quality')}</span>
                <select value={quality} onChange={(e) => setQuality(e.target.value)}>
                  <option value="high">{t('high')}</option>
                  <option value="medium">{t('medium')}</option>
                  <option value="draft">{t('draft')}</option>
                </select>
              </label>
              <label className="select">
                <span>{t('resolution')}</span>
                <select value={height} onChange={(e) => setHeight(Number(e.target.value))}>
                  <option value={0}>
                    {project.width}×{project.height}
                  </option>
                  {heights.map((h) => (
                    <option key={h} value={h}>
                      {Math.round((project.width * h) / project.height / 2) * 2}×{h}
                    </option>
                  ))}
                </select>
              </label>
              <label className="select">
                <span>{t('frameRate')}</span>
                <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                  <option value={0}>{project.fps} fps</option>
                  {[60, 30, 25, 24]
                    .filter((f) => f !== project.fps)
                    .map((f) => (
                      <option key={f} value={f}>
                        {f} fps
                      </option>
                    ))}
                </select>
              </label>
            </div>
            {error && <p className="error">{error}</p>}
            <div className="cta-wrap">
              <button className="cta" onClick={start} disabled={projectDuration(project) === 0}>
                {picked.length > 1 ? (isHe ? `ייצוא ${picked.length} קבצים` : `Export ${picked.length} files`) : t('startExport')}
              </button>
            </div>
          </>
        )}
        {running && (
          <div className="export-progress">
            <Loader2 className="spin" size={22} />
            <strong>
              {t('exporting')} {Math.round(job.progress * 100)}%
            </strong>
            <div className="progress">
              <i style={{ width: `${job.progress * 100}%` }} />
            </div>
            <span className="hint">{job.message}</span>
          </div>
        )}
        {many && (
          <ul className="export-list">
            {jobIds.map((id, i) => {
              const j = jobs[id];
              const x = EXPORT_PRESETS.find((y) => y.id === picked[i]);
              return (
                <li key={id}>
                  <strong>{x ? (isHe ? x.labelHe : x.label) : project.name}</strong>
                  {!j || j.status === 'running' ? (
                    <>
                      <div className="progress">
                        <i style={{ width: `${(j?.progress || 0) * 100}%` }} />
                      </div>
                      <span className="hint">{j?.message || ''}</span>
                    </>
                  ) : j.status === 'error' ? (
                    <span className="error">{j.error}</span>
                  ) : (
                    <a className="chip-btn" href={j.result.url} download>
                      <Download size={14} /> {j.result.width}×{j.result.height} · {(j.result.size / 1048576).toFixed(1)} MB
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {job?.status === 'error' && <p className="error">{job.error}</p>}
        {job?.status === 'done' && (
          <div className="export-done">
            <video src={job.result.url} controls />
            <strong>{t('exportDone')}</strong>
            <span className="hint" dir="ltr">
              {job.result.width}×{job.result.height} · {job.result.fps}fps · {mb} MB
            </span>
            <span className="hint path" dir="ltr">
              {job.result.file}
            </span>
            <div className="cta-wrap">
              <a className="cta" href={job.result.url} download>
                <Download size={20} /> {t('download')}
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ApiDialog({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const { isHe } = useT();
  const base = location.origin;
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide" role="dialog" aria-modal="true" aria-label="API">
        <header>
          <h2>API · MCP</h2>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <p className="hint">{isHe ? 'כל פעולה בעורך זמינה גם ל-AI. העורך מתעדכן בזמן אמת כשסוכן עורך את הפרויקט.' : 'Every edit is available to an AI agent. The editor updates live while an agent edits the project.'}</p>
        <h4>{isHe ? 'חיבור ה-MCP לכלי שלכם' : 'Connect the MCP server to your client'}</h4>
        <McpGuide />
        <h4>REST</h4>
        <pre dir="ltr">{`GET  ${base}/api/projects/${project.id}/summary
POST ${base}/api/projects/${project.id}/ops
     {"op":"cut_range","args":{"start":12.4,"end":15.1}}
POST ${base}/api/projects/${project.id}/captions   {"language":"he"}
POST ${base}/api/projects/${project.id}/export     {"quality":"high"}`}</pre>
        <p className="hint" dir="ltr">
          Project id: <code>{project.id}</code>
        </p>
      </div>
    </div>
  );
}

export function App() {
  const project = useStore((s) => s.project);
  const saving = useStore((s) => s.saving);
  const toast = useStore((s) => s.toast);
  const jobs = useStore((s) => s.jobs);
  const { t, lang, isHe } = useT();
  const [exporting, setExporting] = useState(false);
  const [showApi, setShowApi] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [dragging, setDragging] = useState(false);
  const lay = useLayout();
  const leftTab = useStore((s) => s.leftTab);

  useEffect(() => {
    const { open, notify } = useStore.getState();
    (async () => {
      const wanted = new URLSearchParams(location.search).get('project') || localStorage.getItem('studio.project');
      const list = await api.projects();
      const id = list.find((p) => p.id === wanted)?.id || list[0]?.id || (await api.create(isHe ? 'הפרויקט שלי' : 'My project')).id;
      await open(id);
    })().catch((e) => notify(String(e.message)));
    const off1 = connectEvents();
    const off2 = installShortcuts();
    // One light for every glass surface: it follows the pointer (see --px / --py in styles.css).
    const light = (e: PointerEvent) => {
      document.documentElement.style.setProperty('--px', `${e.clientX}px`);
      document.documentElement.style.setProperty('--py', `${e.clientY}px`);
    };
    window.addEventListener('pointermove', light, { passive: true });
    return () => (off1(), off2(), window.removeEventListener('pointermove', light));
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = isHe ? 'rtl' : 'ltr';
    localStorage.setItem('studio.lang', lang);
  }, [lang]);

  if (!project)
    return (
      <>
        <LiquidSky />
        <div className="loading">YUV.AI STUDIO</div>
      </>
    );
  const proxy = Object.values(jobs).find((j) => j.kind === 'proxy' && j.status === 'running' && j.projectId === project.id);
  return (
    <div
      className="app"
      style={{ gridTemplateRows: `auto minmax(0, 1fr) 14px ${lay.tlOpen ? `${lay.tlH}px` : '0px'}` }}
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && (e.preventDefault(), setDragging(true))}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        setDragging(false);
        if (!e.dataTransfer.files.length || e.defaultPrevented) return;
        e.preventDefault();
        void actions.upload([...e.dataTransfer.files]);
      }}
    >
      <LiquidSky />
      <header className="topbar">
        <div className="brand brand-btn" dir="ltr" role="button" tabIndex={0} onClick={() => setShowAbout(true)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setShowAbout(true)} aria-label={t('about')} title={t('about')}>
          <img className="brand-phoenix" src="/brand/mark-128.png" alt="" />
          <span className="brand-mark">YUV.AI</span>
          <span className="brand-sub">STUDIO</span>
          <span className="brand-by">by Yuval Avidani</span>
        </div>
        <ProjectMenu />
        <span className="save-state">{saving ? t('saving') : t('saved')}</span>
        {proxy && (
          <span className="save-state">
            <Loader2 className="spin" size={14} /> {proxy.message} {Math.round(proxy.progress * 100)}%
          </span>
        )}
        <div className="tool-spacer" />
        <button
          className={`pill agent-pill${leftTab === 'agent' && lay.leftOpen ? ' on' : ''}`}
          onClick={() => {
            const open = leftTab === 'agent' && lay.leftOpen;
            useStore.getState().set({ leftTab: open ? 'media' : 'agent' });
            if (!lay.leftOpen) lay.setLayout({ leftOpen: true });
            if (!open) setTimeout(() => (document.querySelector('.agent-input textarea') as HTMLTextAreaElement | null)?.focus(), 60);
          }}
          aria-pressed={leftTab === 'agent' && lay.leftOpen}
        >
          <Bot size={16} /> {t('aiAgent')}
        </button>
        <button className="pill" onClick={() => setShowApi(true)}>
          <Plug size={16} /> API · MCP
        </button>
        <button className="pill lang" onClick={() => useStore.setState({ lang: isHe ? 'en' : 'he' })} aria-label="Language">
          <b className={isHe ? 'on' : ''}>עב</b> / <b className={!isHe ? 'on' : ''}>EN</b>
        </button>
        <div className="cta-wrap sm">
          <button className="cta" onClick={() => setExporting(true)}>
            <Download size={19} /> {t('export')}
          </button>
        </div>
      </header>
      <main
        className={`workspace${lay.leftOpen ? '' : ' start-closed'}${lay.rightOpen ? '' : ' end-closed'}`}
        style={{ gridTemplateColumns: `${lay.leftOpen ? `${lay.leftW}px` : '0px'} 14px minmax(0, 1fr) 14px ${lay.rightOpen ? `${lay.rightW}px` : '0px'}` }}
      >
        <LeftPanel />
        <SideSplitter side="start" />
        <Stage />
        <SideSplitter side="end" />
        <Inspector />
      </main>
      <TimelineSplitter />
      <div className="tl-slot" hidden={!lay.tlOpen}>
        <Timeline />
      </div>
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      <AgentFx />
      <UploadStatus />
      {showApi && <ApiDialog onClose={() => setShowApi(false)} />}
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
      {dragging && <div className="drop-veil">{t('dropHere')}</div>}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
