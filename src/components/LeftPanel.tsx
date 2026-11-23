import { AudioLines, Bot, Captions, Clapperboard, Film, FolderOpen, Image as ImageIcon, Layers, Mic, Music, Play, Plus, Sparkles, Trash2, Type, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { SFX, SFX_GROUPS, TITLE_PRESETS } from '../../shared/presets';
import { drawTextItem } from '../../shared/renderText';
import type { Clip, TextStyle } from '../../shared/types';
import { actions } from '../actions';
import { api, thumbUrl } from '../api';
import { loadFonts } from '../fonts';
import { useT } from '../i18n';
import { playback } from '../playback';
import { useStore } from '../store';
import { AgentTab } from './AgentTab';
import { CaptionsTab } from './CaptionsTab';
import { FontsBox } from './FontsBox';
import { SmartTab } from './SmartTab';
import { StockTab } from './StockTab';
import { VoiceTab } from './VoiceTab';

/** A small live rendering of a text style, drawn with the real renderer. */
export function StylePreview({ style, text, words }: { style: TextStyle; text: string; words?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    void loadFonts().then(() => {
      const c = ref.current;
      if (!live || !c) return;
      const W = 640;
      const H = 240;
      c.width = W;
      c.height = H;
      const g = c.getContext('2d')!;
      const tokens = text.split(/\s+/);
      const clip = { text, duration: 4, words: words ? tokens.map((w, i) => ({ text: w, t0: i, t1: i + 1 })) : undefined } as Clip;
      const st = { ...style, animIn: 'none', animOut: 'none', maxWidth: 3 } as TextStyle;
      const draw = (scale: number) => drawTextItem(g, { clip, style: st, transform: { x: 0.5, y: 0.5, scale, rotation: 0, opacity: 1 }, track: {} as any }, W, H, 1.5);
      const box = draw(1);
      g.clearRect(0, 0, W, H);
      draw(Math.min(2.4, (W * 0.84) / box.w, (H * 0.6) / box.h));
    });
    return () => void (live = false);
  }, [style, text, words]);
  return <canvas ref={ref} className="style-preview" />;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function MediaTab() {
  const project = useStore((s) => s.project)!;
  const { t } = useT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const up = useStore((s) => s.upload);
  const [path, setPath] = useState('');
  const upload = async (files: File[]) => {
    setBusy(true);
    await actions.upload(files);
    setBusy(false);
  };
  const assets = project.assets.filter((a) => !a.name.startsWith('SFX · '));
  return (
    <div className="tab-body">
      <button className="drop" onClick={() => input.current?.click()} disabled={busy}>
        <Upload size={22} />
        <strong>{busy ? (up ? `${Math.round((up.sent / Math.max(1, up.total)) * 100)}%` : '…') : t('upload')}</strong>
        <span>{t('dropHere')}</span>
      </button>
      <input ref={input} type="file" multiple hidden accept="video/*,audio/*,image/*,.mkv,.mov" onChange={(e) => (upload([...(e.target.files || [])]), (e.target.value = ''))} />
      <form
        className="path-row"
        onSubmit={(e) => {
          e.preventDefault();
          const src = path.trim().replace(/^"|"$/g, '');
          if (!src) return;
          setBusy(true);
          void actions
            .server((id) => (/^https?:\/\//i.test(src) ? api.importUrl(id, src) : api.importPath(id, src)))
            .then((a) => a && setPath(''))
            .finally(() => setBusy(false));
        }}
      >
        <FolderOpen size={16} />
        <input dir="ltr" value={path} onChange={(e) => setPath(e.target.value)} placeholder={t('importPath')} aria-label={t('importPath')} />
        <button className="pill sm" type="submit" disabled={!path.trim() || busy}>
          {busy && path.trim() ? '…' : t('import')}
        </button>
      </form>
      <div className="asset-list">
        {assets.map((a) => {
          const Icon = a.kind === 'video' ? Film : a.kind === 'audio' ? Music : ImageIcon;
          return (
            <div key={a.id} className="asset" draggable onDragStart={(e) => e.dataTransfer.setData('application/x-asset', a.id)}>
              <div className="asset-thumb">{a.kind === 'audio' ? <AudioLines size={22} /> : <img src={thumbUrl(project.id, a.id, 0)} alt="" draggable={false} />}</div>
              <div className="asset-info">
                <strong dir="auto" title={a.name}>
                  {a.name}
                </strong>
                <span dir="ltr">
                  <Icon size={12} /> {a.kind === 'image' ? `${a.width}×${a.height}` : fmt(a.duration)}
                  {a.kind === 'video' && ` · ${a.height}p${a.fps ? ` · ${Math.round(a.fps)}fps` : ''}`}
                </span>
              </div>
              <div className="asset-actions">
                <button className="mini" title={t('addToTimeline')} aria-label={t('addToTimeline')} onClick={() => actions.addAsset(a.id)}>
                  <Plus size={16} />
                </button>
                {a.kind !== 'audio' && (
                  <button className="mini" title={t('addBroll')} aria-label={t('addBroll')} onClick={() => actions.addAsset(a.id, { broll: true, start: playback.time })}>
                    <Layers size={15} />
                  </button>
                )}
                <button className="mini" title={t('remove')} aria-label={t('remove')} onClick={() => void actions.server((id) => api.op(id, 'remove_asset', { assetId: a.id }))}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TextTab() {
  const { t, isHe } = useT();
  return (
    <div className="tab-body">
      <p className="hint">{t('titlesHint')}</p>
      <div className="preset-grid">
        {TITLE_PRESETS.map((p) => (
          <button key={p.id} className="preset" onClick={() => actions.addText(p.id, isHe ? p.sampleHe : p.sample)}>
            <StylePreview style={p.style} text={isHe ? p.sampleHe : p.sample} />
            <span>{isHe ? p.labelHe : p.label}</span>
          </button>
        ))}
      </div>
      <FontsBox />
    </div>
  );
}

function SoundsTab() {
  const { t, isHe } = useT();
  const play = (id: string) => void new Audio(`/sfx/${id}.wav`).play().catch(() => {});
  return (
    <div className="tab-body">
      <p className="hint">{t('sfxHint')}</p>
      {SFX_GROUPS.map((g) => (
        <section key={g.id} className="sfx-group">
          <h4>{isHe ? g.labelHe : g.label}</h4>
          <div className="sfx-list">
            {SFX.filter((s) => s.group === g.id).map((s) => (
              <div key={s.id} className="sfx">
                <button className="sfx-play" onClick={() => play(s.id)}>
                  <Play size={14} fill="currentColor" />
                  <span>{isHe ? s.labelHe : s.label}</span>
                </button>
                <button className="mini" aria-label={t('addToTimeline')} title={t('addToTimeline')} onClick={() => void actions.server((id) => api.sfx(id, s.id, playback.time))}>
                  <Plus size={16} />
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const TABS = [
  { id: 'agent', icon: Bot, C: AgentTab },
  { id: 'media', icon: Film, C: MediaTab },
  { id: 'stock', icon: Clapperboard, C: StockTab },
  { id: 'text', icon: Type, C: TextTab },
  { id: 'captions', icon: Captions, C: CaptionsTab },
  { id: 'smart', icon: Sparkles, C: SmartTab },
  { id: 'voice', icon: Mic, C: VoiceTab },
  { id: 'sounds', icon: Music, C: SoundsTab },
];

export function LeftPanel() {
  const tab = useStore((s) => s.leftTab);
  const setTab = (id: string) => (useStore.getState().set({ leftTab: id }), localStorage.setItem('studio.leftTab', id));
  // the agent tab's chat survives switching tabs: it is hidden, not unmounted
  const { t } = useT();
  const Body = (TABS.find((x) => x.id === tab) || TABS[1]).C;
  return (
    <aside className="panel left-panel">
      <div className="tabs" role="tablist">
        {TABS.map(({ id, icon: Icon }) => (
          <button key={id} data-tab={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} title={t(id)}>
            <Icon size={17} />
            <span>{t(id)}</span>
          </button>
        ))}
      </div>
      <div className="tab-host" hidden={tab !== 'agent'}>
        <AgentTab />
      </div>
      {tab !== 'agent' && <Body />}
    </aside>
  );
}
