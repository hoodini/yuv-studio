import { Check, LayoutTemplate, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LAYOUTS, RESOLUTIONS } from '../../shared/presets';
import { api } from '../api';
import { useT } from '../i18n';
import { flushSave, useStore } from '../store';

const USE: Record<string, [string, string]> = {
  '16:9': ['יוטיוב, מסך רחב', 'YouTube, widescreen'],
  '9:16': ['טיקטוק, רילס, שורטס', 'TikTok, Reels, Shorts'],
  '4:5': ['פוסט אינסטגרם', 'Instagram post'],
  '1:1': ['ריבוע', 'Square'],
  '4k': ['יוטיוב 4K', 'YouTube 4K'],
};

/** A frame of the given shape with the layout's slots drawn in it. */
function LayoutPic({ w, h, layout }: { w: number; h: number; layout: string }) {
  const k = 34 / Math.max(w, h);
  const W = w * k;
  const H = h * k;
  const slots = LAYOUTS.find((l) => l.id === layout)?.slots || [];
  return (
    <svg width={W + 2} height={H + 2} viewBox={`-1 -1 ${W + 2} ${H + 2}`} aria-hidden>
      <rect x={0} y={0} width={W} height={H} rx={3} className="pic-frame" />
      {slots.length === 0 && <rect x={2} y={2} width={W - 4} height={H - 4} rx={2} className="pic-slot" />}
      {slots.map((s, i) => {
        const r = s || { x: 0, y: 0, w: 1, h: 1 };
        return <rect key={i} x={r.x * W + 1.5} y={r.y * H + 1.5} width={r.w * W - 3} height={r.h * H - 3} rx={2} className={`pic-slot${s ? '' : ' back'}`} style={{ order: s ? 1 : 0 }} />;
      })}
    </svg>
  );
}

interface TemplateRow {
  id: string;
  name: string;
  width: number;
  height: number;
  layout?: string;
  titles: number;
  logo: boolean;
}

/** New project: the canvas shape, a layout for several videos, or one of your templates. */
export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const { t, isHe } = useT();
  const L = (he: string, en: string) => (isHe ? he : en);
  const { open, notify } = useStore.getState();
  const [name, setName] = useState('');
  const [size, setSize] = useState('16:9');
  const [layout, setLayout] = useState('single');
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [template, setTemplate] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(
    () =>
      void api
        .templates()
        .then(setTemplates)
        .catch(() => {}),
    [],
  );
  const res = RESOLUTIONS.find((r) => r.id === size)!;

  const create = async () => {
    setBusy(true);
    try {
      await flushSave();
      const p = await api.create(name.trim() || t('newProject'), template ? { templateId: template } : { width: res.w, height: res.h, layout });
      await open(p.id);
      onClose();
    } catch (e: any) {
      notify(String(e.message || e));
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    await api.removeTemplate(id);
    if (template === id) setTemplate('');
    setTemplates((x) => x.filter((y) => y.id !== id));
  };

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide new-project" role="dialog" aria-modal="true" aria-label={t('newProject')}>
        <header>
          <h2>{t('newProject')}</h2>
          <button className="icon-btn sm" onClick={onClose} aria-label={t('close')}>
            <X size={18} />
          </button>
        </header>
        <label className="select">
          <span>{t('name')}</span>
          <input className="text-input" dir="auto" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('newProject')} autoFocus />
        </label>

        {templates.length > 0 && (
          <section>
            <h3>{L('התבניות שלי', 'My templates')}</h3>
            <div className="tile-row">
              {templates.map((tp) => (
                <div key={tp.id} className={`tile tpl${template === tp.id ? ' active' : ''}`}>
                  <button className="tile-main" onClick={() => setTemplate(template === tp.id ? '' : tp.id)} aria-pressed={template === tp.id}>
                    <LayoutPic w={tp.width} h={tp.height} layout={tp.layout || 'single'} />
                    <strong dir="auto">{tp.name}</strong>
                    <span dir="ltr">
                      {tp.width}×{tp.height}
                      {tp.logo ? ' · logo' : ''}
                      {tp.titles ? ` · ${tp.titles} T` : ''}
                    </span>
                  </button>
                  <button className="mini tile-x" onClick={() => void remove(tp.id)} aria-label={L('מחיקת התבנית', 'Delete the template')} title={L('מחיקת התבנית', 'Delete the template')}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <fieldset disabled={!!template} className="np-fields">
          <section>
            <h3>{L('גודל הקנבס', 'Canvas size')}</h3>
            <div className="tile-row">
              {RESOLUTIONS.map((r) => (
                <button key={r.id} className={`tile${size === r.id ? ' active' : ''}`} onClick={() => setSize(r.id)} aria-pressed={size === r.id}>
                  <LayoutPic w={r.w} h={r.h} layout="single" />
                  <strong dir="ltr">{r.id === '4k' ? '4K' : r.id}</strong>
                  <span>{L(...(USE[r.id] || ['', '']))}</span>
                </button>
              ))}
            </div>
          </section>
          <section>
            <h3>{L('פריסה', 'Layout')}</h3>
            <div className="tile-row">
              {LAYOUTS.map((l) => (
                <button key={l.id} className={`tile${layout === l.id ? ' active' : ''}`} onClick={() => setLayout(l.id)} aria-pressed={layout === l.id}>
                  <LayoutPic w={res.w} h={res.h} layout={l.id} />
                  <strong>{isHe ? l.labelHe : l.label}</strong>
                </button>
              ))}
            </div>
            <p className="hint">
              {L(
                'בפריסה, וידאו שגוררים לשכבה העליונה או התחתונה נכנס לבד למקום שלו. אפשר לשנות פריסה גם אחר כך, בהגדרות הפרויקט.',
                'In a layout, a video dropped on the top or the lower layer fits into its place by itself. You can change the layout later in the project settings.',
              )}
            </p>
          </section>
        </fieldset>
        <div className="cta-wrap">
          <button className="cta" onClick={create} disabled={busy}>
            {template ? <LayoutTemplate size={20} /> : <Check size={20} />} {template ? L('יצירה מהתבנית', 'Create from the template') : L('יצירת הפרויקט', 'Create the project')}
          </button>
        </div>
      </div>
    </div>
  );
}
