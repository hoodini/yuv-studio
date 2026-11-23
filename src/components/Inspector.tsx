import { AlignCenter, AlignLeft, AlignRight, Copy, ExternalLink, Unlink } from 'lucide-react';
import { IconCenter, IconFill, IconFit, LayoutIcon } from './icons';
import type { ReactNode } from 'react';
import { coverScale, transformAt } from '../../shared/geometry';
import { SPEEDS } from './Timeline';
import { actions } from '../actions';
import { applyLayout, applyTransform, captionTransform, detachAudio, setClipSpeed, setCaptionPreset, setProjectSettings, setWatermark, updateClip, updateTrack } from '../../shared/ops';
import { api } from '../api';
import { audioFades } from '../../shared/types';
import { CAPTION_PRESETS, FPS_OPTIONS, FX_PRESETS, LAYOUTS, RESOLUTIONS, TITLE_PRESETS, TRANSITIONS, baseStyle } from '../../shared/presets';
import { useState } from 'react';
import type { Clip, TextStyle, Track, Transform, Transition } from '../../shared/types';
import { FONT_WEIGHTS } from '../fonts';
import { useT } from '../i18n';
import { playback, usePlayhead } from '../playback';
import { useFonts } from '../customFonts';
import { getSelected, useStore } from '../store';
import { MotionFields } from './Motion';

const cp = () => useStore.getState().checkpoint();

function Slider({ label, value, min, max, step = 0.01, onChange, show }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; show?: (v: number) => string }) {
  return (
    <label className="slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onPointerDown={cp} onKeyDown={cp} onChange={(e) => onChange(Number(e.target.value))} />
      <output dir="ltr">{show ? show(value) : Math.round(value * 100) / 100}</output>
    </label>
  );
}

const toHex = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#ffffff');
function Color({ label, value, onChange, optional }: { label: string; value: string; onChange: (v: string) => void; optional?: boolean }) {
  return (
    <label className="color">
      <span>{label}</span>
      {optional && <input type="checkbox" checked={!!value} onChange={(e) => (cp(), onChange(e.target.checked ? '#FFFFFF' : ''))} aria-label={label} />}
      <input type="color" value={toHex(value)} disabled={optional && !value} onPointerDown={cp} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Select({ label, value, options, onChange, dir }: { label: string; value: string | number; options: { v: string | number; l: string }[]; onChange: (v: string) => void; dir?: 'ltr' | 'rtl' }) {
  return (
    <label className="select">
      <span>{label}</span>
      <select value={value} dir={dir} onChange={(e) => (cp(), onChange(e.target.value))}>
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.l}
          </option>
        ))}
      </select>
    </label>
  );
}

const Section = ({ title, children, note }: { title: string; children: ReactNode; note?: string }) => (
  <section className="insp-section">
    <h4>{title}</h4>
    {note && <p className="hint">{note}</p>}
    {children}
  </section>
);

/** The transform of a clip as it is at the playhead; on an animated clip a change makes a keyframe there. */
function ClipTransform({ clip, extra }: { clip: Clip; extra?: ReactNode }) {
  const now = usePlayhead();
  const edit = useStore((s) => s.edit);
  return <TransformFields tf={transformAt(clip, now - clip.start)} set={(x) => edit((d) => applyTransform(d, clip.id, x, playback.time), true)} extra={extra} />;
}

function TransformFields({ tf, set, extra, rotation = true }: { tf: Transform; set: (p: Partial<Transform>) => void; extra?: ReactNode; rotation?: boolean }) {
  const { t } = useT();
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <Section title={t('transform')}>
      <div className="chip-row">
        <button className="chip-btn icon-chip" onClick={() => (cp(), set({ x: 0.5, y: 0.5 }))} title={t('centerHint')}>
          <IconCenter /> {t('center')}
        </button>
        {extra}
      </div>
      <Slider label={t('scale')} value={tf.scale} min={0.05} max={4} onChange={(scale) => set({ scale })} show={pct} />
      <Slider label="X" value={tf.x} min={-0.5} max={1.5} step={0.005} onChange={(x) => set({ x })} show={pct} />
      <Slider label="Y" value={tf.y} min={-0.5} max={1.5} step={0.005} onChange={(y) => set({ y })} show={pct} />
      {rotation && <Slider label={t('rotation')} value={tf.rotation} min={-180} max={180} step={1} onChange={(r) => set({ rotation: r })} show={(v) => `${Math.round(v)}°`} />}
      <Slider label={t('opacity')} value={tf.opacity} min={0} max={1} onChange={(opacity) => set({ opacity })} show={pct} />
    </Section>
  );
}

function TransitionFields({ label, value, set, audio }: { label: string; value: Transition; set: (t: Partial<Transition>) => void; audio?: boolean }) {
  const { t, isHe } = useT();
  const opts = (audio ? TRANSITIONS.filter((x) => x.id === 'none' || x.id === 'fade') : TRANSITIONS).map((x) => ({ v: x.id, l: isHe ? x.labelHe : x.label }));
  return (
    <>
      <Select label={label} value={value.type} options={opts} onChange={(type) => set({ type: type as any })} />
      {value.type !== 'none' && <Slider label={t('duration')} value={value.duration} min={0.1} max={3} step={0.05} onChange={(duration) => set({ duration })} show={(v) => `${v.toFixed(2)}s`} />}
    </>
  );
}

function StyleFields({ style, set, caption }: { style: TextStyle; set: (s: Partial<TextStyle>) => void; caption?: boolean }) {
  const { t } = useT();
  const { options: fontOptions } = useFonts();
  const weights = FONT_WEIGHTS[style.fontFamily] || [400, 700];
  const anims = [
    { v: 'none', l: t('none') },
    { v: 'fade', l: t('fade') },
    { v: 'pop', l: t('pop') },
    { v: 'slide-up', l: t('slideUp') },
    { v: 'typewriter', l: t('typewriter') },
  ];
  return (
    <>
      <Select
        label={t('font')}
        value={style.fontFamily}
        options={fontOptions}
        onChange={(fontFamily) =>
          set({
            fontFamily,
            fontWeight: (FONT_WEIGHTS[fontFamily] || [400]).includes(style.fontWeight) ? style.fontWeight : (FONT_WEIGHTS[fontFamily] || [400]).slice(-1)[0],
          })
        }
      />
      <div className="field-row">
        <Select label={t('weight')} value={style.fontWeight} options={weights.map((w) => ({ v: w, l: String(w) }))} onChange={(w) => set({ fontWeight: Number(w) })} />
        <label className="select">
          <span>{t('align')}</span>
          <div className="seg">
            {(['left', 'center', 'right'] as const).map((a) => {
              const Icon = a === 'left' ? AlignLeft : a === 'center' ? AlignCenter : AlignRight;
              return (
                <button key={a} className={style.align === a ? 'active' : ''} onClick={() => (cp(), set({ align: a }))} aria-label={a}>
                  <Icon size={15} />
                </button>
              );
            })}
          </div>
        </label>
      </div>
      <Slider label={t('size')} value={style.fontSize} min={16} max={320} step={1} onChange={(fontSize) => set({ fontSize })} show={(v) => String(Math.round(v))} />
      <Slider label={t('width')} value={style.maxWidth} min={0.2} max={1} onChange={(maxWidth) => set({ maxWidth })} show={(v) => `${Math.round(v * 100)}%`} />
      <div className="field-row colors">
        <Color label={t('color')} value={style.color} onChange={(color) => set({ color, gradient: undefined })} />
        <Color label={t('background')} value={style.bgColor} optional onChange={(bgColor) => set({ bgColor })} />
        <Color
          label={t('stroke')}
          value={style.strokeWidth > 0 ? style.strokeColor : ''}
          optional
          onChange={(c) =>
            set(
              c
                ? {
                    strokeColor: c === '#FFFFFF' && style.strokeWidth <= 0 ? '#14123A' : c,
                    strokeWidth: style.strokeWidth || 8,
                  }
                : { strokeWidth: 0 },
            )
          }
        />
      </div>
      {style.strokeWidth > 0 && <Slider label={t('stroke')} value={style.strokeWidth} min={1} max={24} step={1} onChange={(strokeWidth) => set({ strokeWidth })} show={(v) => String(v)} />}
      <label className="check">
        <input type="checkbox" checked={style.uppercase} onChange={(e) => (cp(), set({ uppercase: e.target.checked }))} />
        <span>{t('uppercase')}</span>
      </label>
      {caption && (
        <>
          <Select
            label={t('highlight')}
            value={style.highlight}
            options={[
              { v: 'none', l: t('none') },
              { v: 'color', l: t('word') },
              { v: 'box', l: t('box') },
              { v: 'reveal', l: t('reveal') },
            ]}
            onChange={(highlight) => set({ highlight: highlight as any })}
          />
          {(style.highlight === 'color' || style.highlight === 'box') && (
            <div className="field-row colors">
              <Color label={t('highlightText')} value={style.highlightTextColor} onChange={(highlightTextColor) => set({ highlightTextColor })} />
              {style.highlight === 'box' && <Color label={t('highlightColor')} value={style.highlightColor} onChange={(highlightColor) => set({ highlightColor })} />}
            </div>
          )}
        </>
      )}
      <div className="field-row">
        <Select label={t('animIn')} value={style.animIn} options={anims} onChange={(animIn) => set({ animIn: animIn as any })} />
        <Select label={t('animOut')} value={style.animOut} options={anims.slice(0, 4)} onChange={(animOut) => set({ animOut: animOut as any })} />
      </div>
    </>
  );
}

const BLENDS = [
  { id: 'normal', he: 'רגיל', en: 'Normal', hintHe: 'מכסה את מה שמתחת', hintEn: 'Covers what is below' },
  { id: 'screen', he: 'מסך (אור)', en: 'Screen (light)', hintHe: 'השחור נעלם ונשאר רק האור: דליפות אור, אבק, הבזקים', hintEn: 'Black disappears and only the light stays: light leaks, dust, flares' },
  { id: 'lighten', he: 'הבהרה', en: 'Lighten', hintHe: 'נשאר הבהיר מבין השניים', hintEn: 'Keeps the lighter of the two' },
  { id: 'multiply', he: 'הכפלה (צל)', en: 'Multiply (shade)', hintHe: 'הלבן נעלם ונשאר רק הכהה: נייר, מרקם, צל', hintEn: 'White disappears and only the dark stays: paper, texture, shade' },
  { id: 'overlay', he: 'שכבת על', en: 'Overlay', hintHe: 'מחזק ניגודיות וצבע: מרקמים וגרעין', hintEn: 'Adds contrast and colour: textures and grain' },
] as const;

/** Where a stock file came from, its licence, and the credit line to copy into the video's description. */
function SourceNote({ source }: { source: NonNullable<import('../../shared/types').Asset['source']> }) {
  const { t, isHe } = useT();
  return (
    <section className="insp-section source-note">
      <h4>{t('credit')}</h4>
      <p className="hint" dir="auto">
        {source.name} · {source.license}
        {/^https?:\/\//i.test(source.url) && (
          <a className="link-btn" href={source.url} target="_blank" rel="noreferrer">
            {' '}
            <ExternalLink size={12} />
          </a>
        )}
      </p>
      {source.credit ? (
        <button className="chip-btn" onClick={() => void navigator.clipboard?.writeText(source.credit).then(() => useStore.getState().notify(isHe ? 'הקרדיט הועתק' : 'Credit copied'))}>
          <Copy size={13} /> {isHe ? 'העתקת שורת הקרדיט' : 'Copy the credit line'}
        </button>
      ) : (
        <p className="hint">{isHe ? 'הרישיון לא דורש קרדיט.' : 'The licence needs no credit.'}</p>
      )}
    </section>
  );
}

function ClipInspector({ clip, track }: { clip: Clip; track: Track }) {
  const project = useStore((s) => s.project)!;
  const { edit } = useStore.getState();
  const { t, isHe } = useT();
  const patch = (p: Partial<Clip> | Record<string, any>) => edit((d) => updateClip(d, clip.id, p as any), true);
  const asset = project.assets.find((a) => a.id === clip.assetId);
  const visual = clip.type === 'video' || clip.type === 'image';

  if (clip.type === 'caption') {
    const style = { ...baseStyle, ...(track.style || {}) };
    const setStyle = (s: Partial<TextStyle>) => edit((d) => updateTrack(d, track.id, { style: s } as any), true);
    const tf = track.transform || captionTransform();
    return (
      <>
        <Section title={t('content')}>
          <textarea dir="auto" rows={2} value={clip.text || ''} onFocus={cp} onChange={(e) => patch({ text: e.target.value })} />
        </Section>
        <Section title={t('captionStyle')} note={t('allCaptions')}>
          <div className="chip-row wrap">
            {CAPTION_PRESETS.map((p) => (
              <button key={p.id} className={`chip-btn${track.captionPreset === p.id ? ' active' : ''}`} onClick={() => edit((d) => setCaptionPreset(d, track.id, p.id))}>
                {isHe ? p.labelHe : p.label}
              </button>
            ))}
          </div>
          <StyleFields style={style} set={setStyle} caption />
        </Section>
        <TransformFields tf={tf} rotation={false} set={(x) => edit((d) => updateTrack(d, track.id, { transform: x } as any), true)} />
      </>
    );
  }

  return (
    <>
      {clip.type === 'text' && (
        <>
          <Section title={t('content')}>
            <textarea dir="auto" rows={3} value={clip.text || ''} onFocus={cp} onChange={(e) => patch({ text: e.target.value })} />
          </Section>
          <Section title={t('style')}>
            <div className="chip-row wrap">
              {TITLE_PRESETS.map((p) => (
                <button key={p.id} className="chip-btn" onClick={() => (cp(), patch({ style: { ...p.style } }))}>
                  {isHe ? p.labelHe : p.label}
                </button>
              ))}
            </div>
            <StyleFields style={{ ...baseStyle, ...(clip.style || {}) }} set={(s) => patch({ style: s })} />
          </Section>
        </>
      )}
      {clip.type !== 'audio' && (
        <ClipTransform
          clip={clip}
          extra={
            visual && (
              <>
                <button className="chip-btn icon-chip" onClick={() => (cp(), patch({ transform: { scale: 1, x: 0.5, y: 0.5 } }))} title={t('fitHint')}>
                  <IconFit /> {t('fit')}
                </button>
                <button
                  className="chip-btn icon-chip"
                  title={t('fillHint')}
                  onClick={() => (
                    cp(),
                    patch({
                      transform: {
                        scale: coverScale(project, asset),
                        x: 0.5,
                        y: 0.5,
                      },
                    })
                  )}
                >
                  <IconFill /> {t('fill')}
                </button>
              </>
            )
          }
        />
      )}
      {visual && (
        <Section title={t('blend')} note={t('blendHint')}>
          <div className="chip-row wrap" role="radiogroup" aria-label={t('blend')}>
            {BLENDS.map((b) => (
              <button key={b.id} role="radio" aria-checked={(clip.blend || 'normal') === b.id} className={`chip-btn${(clip.blend || 'normal') === b.id ? ' active' : ''}`} onClick={() => (cp(), patch({ blend: b.id === 'normal' ? undefined : b.id }))} title={isHe ? b.hintHe : b.hintEn}>
                {isHe ? b.he : b.en}
              </button>
            ))}
          </div>
        </Section>
      )}
      {asset?.source && <SourceNote source={asset.source} />}
      {clip.type !== 'audio' && <MotionFields clip={clip} project={project} />}
      {(clip.type === 'video' || clip.type === 'audio') && (
        <Section title={t('speed')} note={t('speedHint')}>
          <div className="chip-row wrap speed-chips">
            {SPEEDS.map((v) => (
              <button key={v} className={`chip-btn${Math.abs(clip.speed - v) < 1e-3 ? ' active' : ''}`} onClick={() => actions.setSpeed(v)}>
                {v}×
              </button>
            ))}
          </div>
          <Slider label={t('speed')} value={clip.speed} min={0.1} max={8} step={0.05} onChange={(speed) => edit((d) => void setClipSpeed(d, clip.id, speed, useStore.getState().ripple), true)} show={(v) => `${v.toFixed(2)}×`} />
        </Section>
      )}
      {(clip.type === 'video' || clip.type === 'audio') && (
        <Section title={t('audio')} note={t('audioHint')}>
          <Slider label={t('volume')} value={clip.volume} min={0} max={2} onChange={(volume) => patch({ volume })} show={(v) => `${Math.round(v * 100)}%`} />
          <label className="check">
            <input type="checkbox" checked={clip.muted} onChange={(e) => (cp(), patch({ muted: e.target.checked }))} />
            <span>{t('mute')}</span>
          </label>
          {(clip.type === 'audio' || asset?.hasAudio) && (
            <>
              <Slider label={t('fadeIn')} value={audioFades(clip)[0]} min={0} max={Math.min(5, clip.duration)} step={0.05} onChange={(fadeIn) => patch({ fadeIn })} show={(v) => `${v.toFixed(2)}s`} />
              <Slider label={t('fadeOut')} value={audioFades(clip)[1]} min={0} max={Math.min(5, clip.duration)} step={0.05} onChange={(fadeOut) => patch({ fadeOut })} show={(v) => `${v.toFixed(2)}s`} />
            </>
          )}
          {clip.type === 'video' && asset?.hasAudio && !clip.muted && (
            <button
              className="chip-btn"
              onClick={() => {
                let id = '';
                edit((d) => void (id = detachAudio(d, clip.id).id));
                if (id) useStore.getState().select([id]);
              }}
            >
              <Unlink size={14} /> {t('detachAudio')}
            </button>
          )}
        </Section>
      )}
      {visual && (
        <Section title={t('look')}>
          <div className="chip-row wrap">
            {FX_PRESETS.map((f) => (
              <button key={f.id} className={`chip-btn${JSON.stringify(f.fx) === JSON.stringify(clip.fx) ? ' active' : ''}`} onClick={() => (cp(), patch({ fx: f.fx }))}>
                {isHe ? f.labelHe : f.label}
              </button>
            ))}
          </div>
          <Slider label={t('brightness')} value={clip.fx.brightness} min={0.3} max={1.8} onChange={(brightness) => patch({ fx: { brightness } })} />
          <Slider label={t('contrast')} value={clip.fx.contrast} min={0.3} max={1.8} onChange={(contrast) => patch({ fx: { contrast } })} />
          <Slider label={t('saturation')} value={clip.fx.saturation} min={0} max={2} onChange={(saturation) => patch({ fx: { saturation } })} />
          <Slider label={t('blur')} value={clip.fx.blur} min={0} max={60} step={1} onChange={(blur) => patch({ fx: { blur } })} show={(v) => String(v)} />
        </Section>
      )}
      {clip.type !== 'text' && (
        <Section title={`${t('transitionIn')} / ${t('transitionOut')}`}>
          <TransitionFields label={t('transitionIn')} value={clip.tin} set={(x) => patch({ tin: x })} audio={clip.type === 'audio'} />
          <TransitionFields label={t('transitionOut')} value={clip.tout} set={(x) => patch({ tout: x })} audio={clip.type === 'audio'} />
        </Section>
      )}
    </>
  );
}

/** Save this project's canvas, layers, layout, titles and logo as a template for new projects. */
function SaveTemplate() {
  const project = useStore((s) => s.project)!;
  const { notify } = useStore.getState();
  const { t } = useT();
  const [name, setName] = useState('');
  const save = async () => {
    try {
      const tp = await api.saveTemplate(project.id, name.trim() || project.name);
      setName('');
      notify(t('templateSaved', { name: tp.name }));
    } catch (e: any) {
      notify(String(e.message || e));
    }
  };
  return (
    <Section title={t('template')} note={t('templateHint')}>
      <div className="replace-row">
        <input className="text-input" dir="auto" value={name} onChange={(e) => setName(e.target.value)} placeholder={project.name} onKeyDown={(e) => e.key === 'Enter' && void save()} />
        <button className="chip-btn" onClick={() => void save()}>
          {t('saveTemplate')}
        </button>
      </div>
    </Section>
  );
}

function ProjectInspector() {
  const project = useStore((s) => s.project)!;
  const { edit } = useStore.getState();
  const { t, isHe } = useT();
  const res = RESOLUTIONS.find((r) => r.w === project.width && r.h === project.height);
  const keys: [string, string][] = [
    ['Space', 'scPlay'],
    ['S', 'scSplit'],
    ['Del', 'scDelete'],
    ['I / O  ·  [ / ]', 'scRange'],
    ['X  ·  Alt+X', 'scCut'],
    ['←  /  →', 'scFrame'],
    ['Ctrl+Z  /  Y', 'scUndo'],
    ['Ctrl + wheel', 'scZoom'],
  ];
  return (
    <>
      <Section title={t('project')}>
        <Select
          label={t('frameSize')}
          dir="ltr"
          value={res?.id || 'custom'}
          options={[...RESOLUTIONS.map((r) => ({ v: r.id, l: r.label })), ...(res ? [] : [{ v: 'custom', l: `${project.width}×${project.height}` }])]}
          onChange={(id) => {
            const r = RESOLUTIONS.find((x) => x.id === id);
            if (r) edit((d) => setProjectSettings(d, { width: r.w, height: r.h }), true);
          }}
        />
        <Select
          label={t('frameRate')}
          value={project.fps}
          options={[...new Set([...FPS_OPTIONS, project.fps])].sort((a, b) => a - b).map((f) => ({ v: f, l: `${f} fps` }))}
          onChange={(f) => edit((d) => setProjectSettings(d, { fps: Number(f) }), true)}
        />
      </Section>
      <Section title={t('layout')} note={t('layoutHint')}>
        <div className="chip-row wrap">
          {LAYOUTS.map((l) => (
            <button key={l.id} className={`chip-btn icon-chip${(project.layout || 'single') === l.id ? ' active' : ''}`} onClick={() => edit((d) => applyLayout(d, l.id))}>
              <LayoutIcon id={l.id} /> {isHe ? l.labelHe : l.label}
            </button>
          ))}
        </div>
      </Section>
      <WatermarkFields />
      <SaveTemplate />
      <Section title={t('shortcuts')}>
        <dl className="keys">
          {keys.map(([k, label]) => (
            <div key={k}>
              <dt dir="ltr">{k}</dt>
              <dd>{t(label)}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </>
  );
}

/** A logo stamped in a corner of the whole video: pick an image already in the project or upload one. */
function WatermarkFields() {
  const project = useStore((s) => s.project)!;
  const { edit, notify, reload } = useStore.getState();
  const { t } = useT();
  const wm = project.watermark;
  const images = project.assets.filter((a) => a.kind === 'image');
  const set = (w: Parameters<typeof setWatermark>[1], transient = false) => {
    try {
      edit((d) => setWatermark(d, w), transient);
    } catch (e: any) {
      notify(String(e.message || e));
    }
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    try {
      const [a] = await api.upload(project.id, [f]);
      await reload();
      if (a) set({ assetId: a.id });
    } catch (e: any) {
      notify(String(e.message || e));
    }
  };
  return (
    <Section title={t('watermark')} note={wm ? undefined : t('watermarkHint')}>
      {images.length > 0 && <Select label={t('logo')} value={wm?.assetId || ''} options={[{ v: '', l: t('none') }, ...images.map((a) => ({ v: a.id, l: a.name }))]} onChange={(id) => set(id ? { assetId: id } : null)} />}
      <label className="chip-btn file-btn">
        <input type="file" accept="image/png,image/webp,image/svg+xml,image/jpeg" hidden onChange={(e) => void upload(e.target.files?.[0])} />
        {t('uploadLogo')}
      </label>
      {wm && (
        <>
          <label className="select">
            <span>{t('corner')}</span>
            <div className="corner-pick">
              {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
                <button key={c} className={`${c}${wm.corner === c ? ' active' : ''}`} onClick={() => set({ corner: c })} aria-label={c} />
              ))}
            </div>
          </label>
          <Slider label={t('size')} value={wm.size} min={0.03} max={0.6} onChange={(size) => set({ size }, true)} show={(v) => `${Math.round(v * 100)}%`} />
          <Slider label={t('opacity')} value={wm.opacity} min={0.05} max={1} onChange={(opacity) => set({ opacity }, true)} show={(v) => `${Math.round(v * 100)}%`} />
          <Slider label={t('margin')} value={wm.margin} min={0} max={0.2} step={0.005} onChange={(margin) => set({ margin }, true)} show={(v) => `${Math.round(v * 100)}%`} />
          <button className="chip-btn" onClick={() => set(null)}>
            {t('removeWatermark')}
          </button>
        </>
      )}
    </Section>
  );
}

export function Inspector() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const sel = getSelected({ project, selection });
  const { t } = useT();
  return (
    <aside className="panel inspector">
      <header className="insp-head">
        <strong dir="auto">{sel ? (sel.clip.type === 'caption' ? t('captions') : sel.clip.name || sel.clip.type) : t('project')}</strong>
        {!sel && <span>{t('nothingSelected')}</span>}
      </header>
      <div className="insp-body">{sel ? <ClipInspector key={sel.clip.id} clip={sel.clip} track={sel.track} /> : <ProjectInspector />}</div>
    </aside>
  );
}
