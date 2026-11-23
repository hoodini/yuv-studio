// Brand kits: the logo, four colours, two fonts, the caption look and the outro line of a brand, kept in the studio and
// put on any project in one click. Titles and captions then follow the brand; intro and outro cards come in its look.
import { Check, ImagePlus, Palette, Plus, Star, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { brandCaptionStyle, brandTitleStyle, DEFAULT_BRAND } from '../../shared/brand';
import { CAPTION_PRESETS } from '../../shared/presets';
import { actions } from '../actions';
import { api } from '../api';
import type { BrandKit } from '../api';
import { useFonts } from '../customFonts';
import { useT } from '../i18n';
import { useStore } from '../store';
import { StylePreview } from './LeftPanel';

const COLOR_KEYS = ['primary', 'accent', 'light', 'dark'] as const;
const COLOR_LABEL: Record<(typeof COLOR_KEYS)[number], [string, string, string, string]> = {
  primary: ['ראשי', 'Primary', 'כפתורים וגלולות', 'Buttons and pills'],
  accent: ['הדגשה', 'Accent', 'המילה המודגשת, מרקר', 'The highlighted word, markers'],
  light: ['טקסט בהיר', 'Light text', 'טקסט מעל הווידאו', 'Text over the video'],
  dark: ['כהה', 'Dark', 'טקסט על רקע בהיר, קופסאות כהות', 'Text on light pills, dark boxes'],
};

/** A small picture of the brand: its background card, logo, a title and a caption, drawn with the real renderer. */
function BrandPreview({ kit, isHe }: { kit: BrandKit; isHe: boolean }) {
  return (
    <div className="brand-preview" style={{ background: `linear-gradient(135deg, ${kit.colors.dark}, ${kit.colors.dark} 40%, ${kit.colors.primary})` }}>
      {kit.logoUrl && <img className={`brand-preview-logo ${kit.logoCorner || 'br'}`} src={kit.logoUrl} alt="" />}
      <StylePreview style={brandTitleStyle(kit, 'title')} text={kit.name || (isHe ? 'המותג שלי' : 'My brand')} />
      <StylePreview style={brandCaptionStyle(kit, kit.captionPreset)} text={isHe ? 'ככה ייראו הכתוביות' : 'This is how captions look'} words />
    </div>
  );
}

export function BrandTab() {
  const { isHe } = useT();
  const L = (he: string, en: string) => (isHe ? he : en);
  const project = useStore((s) => s.project)!;
  const notify = useStore((s) => s.notify);
  const { options: fonts } = useFonts();
  const [kits, setKits] = useState<BrandKit[] | null>(null);
  const [id, setId] = useState('');
  const [busy, setBusy] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const logoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api
      .brands()
      .then((list) => {
        setKits(list);
        setId((cur) => cur || project.brand?.id || list[0]?.id || '');
      })
      .catch((e) => notify(String(e.message || e)));
  }, []);
  const kit = kits?.find((k) => k.id === id);

  const replace = (k: BrandKit) => setKits((list) => (list || []).map((x) => (x.id === k.id ? k : k.isDefault ? { ...x, isDefault: false } : x)));
  /** Change the kit on screen at once; save after a short pause, so typing a name sends one request. */
  const change = (patch: Partial<BrandKit>) => {
    if (!kit) return;
    const next = { ...kit, ...patch, colors: { ...kit.colors, ...(patch.colors || {}) }, fonts: { ...kit.fonts, ...(patch.fonts || {}) } };
    replace(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const { id: _i, logo: _l, logoUrl: _u, ...body } = next;
      void api.updateBrand(next.id, body).then(replace).catch((e) => notify(String(e.message || e)));
    }, 450);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const create = async () => {
    setBusy('new');
    try {
      const k = await api.createBrand({ ...DEFAULT_BRAND, name: L('המותג שלי', 'My brand') });
      setKits((list) => [...(list || []), k]);
      setId(k.id);
    } catch (e: any) {
      notify(String(e.message || e));
    }
    setBusy('');
  };
  const remove = async () => {
    if (!kit || !confirm(L(`למחוק את ערכת המותג "${kit.name}"? הפרויקטים שכבר עוצבו בה נשארים כמו שהם.`, `Delete the brand kit "${kit.name}"? Projects already styled with it stay as they are.`))) return;
    await api.removeBrand(kit.id).catch((e) => notify(String(e.message || e)));
    const list = await api.brands();
    setKits(list);
    setId(list[0]?.id || '');
  };
  const uploadLogo = async (f?: File) => {
    if (!kit || !f) return;
    setBusy('logo');
    try {
      replace(await api.brandLogo(kit.id, f));
    } catch (e: any) {
      notify(String(e.message || e));
    }
    setBusy('');
  };
  /** Run a project change on the server (with an undo step), then say what happened. */
  const onProject = async (key: string, fn: (pid: string) => Promise<any>, done: (r: any) => string) => {
    setBusy(key);
    clearTimeout(timer.current);
    if (kit) {
      // a pending colour change has to reach the server before the project takes the kit
      const { id: _i, logo: _l, logoUrl: _u, ...body } = kit;
      await api.updateBrand(kit.id, body).catch(() => {});
    }
    const r = await actions.server(fn);
    if (r) notify(done(r));
    setBusy('');
  };

  if (!kits) return <div className="tab-body" />;
  if (!kit)
    return (
      <div className="tab-body">
        <section className="engine-box smart-card brand-empty">
          <h4>
            <Palette size={16} /> {L('ערכת מותג', 'Brand kit')}
          </h4>
          <p className="hint">{L('לוגו, צבעים ופונטים פעם אחת, ואז כל כותרת, כתובית, אינטרו ואאוטרו יוצאים במראה של המותג שלך, בכל פרויקט.', 'Your logo, colours and fonts once, then every title, caption, intro and outro comes out in your brand’s look, in every project.')}</p>
          <button className="pill" onClick={() => void create()} disabled={!!busy}>
            <Plus size={16} /> {L('יצירת ערכת מותג', 'Create a brand kit')}
          </button>
        </section>
      </div>
    );

  const following = project.brand?.id === kit.id;
  return (
    <div className="tab-body brand-tab">
      <div className="chip-row wrap" role="tablist" aria-label={L('ערכות מותג', 'Brand kits')}>
        {kits.map((k) => (
          <button key={k.id} role="tab" aria-selected={k.id === id} className={`chip-btn brand-chip${k.id === id ? ' active' : ''}`} onClick={() => setId(k.id)}>
            <i style={{ background: `linear-gradient(135deg, ${k.colors.primary}, ${k.colors.accent})` }} />
            <span dir="auto">{k.name}</span>
            {k.isDefault && <Star size={12} fill="currentColor" aria-label={L('ברירת מחדל', 'Default')} />}
          </button>
        ))}
        <button className="chip-btn" onClick={() => void create()} disabled={!!busy} aria-label={L('ערכה חדשה', 'New kit')} title={L('ערכה חדשה', 'New kit')}>
          <Plus size={14} />
        </button>
      </div>

      <BrandPreview kit={kit} isHe={isHe} />

      <section className="engine-box smart-card">
        <h4>
          <Wand2 size={16} /> {L('הפרויקט הזה', 'This project')}
        </h4>
        <p className="hint">
          {following
            ? L(`הפרויקט עוקב אחרי "${kit.name}": כותרות וכתוביות חדשות יוצאות במראה שלו.`, `This project follows "${kit.name}": new titles and captions come out in its look.`)
            : project.brand
              ? L(`הפרויקט עוקב עכשיו אחרי "${project.brand.name}".`, `This project follows "${project.brand.name}" now.`)
              : L('הלבשה צובעת את כל הכתוביות והכותרות בצבעים ובפונטים של המותג (גודל, מיקום ואנימציה נשארים), ושמה את הלוגו בפינה.', 'Putting it on recolours every caption and title in the brand’s colours and fonts (sizes, places and animations stay) and puts the logo in the corner.')}
        </p>
        <div className="chip-row wrap">
          <button className="pill" disabled={!!busy} onClick={() => void onProject('apply', (pid) => api.applyBrand(pid, { brandId: kit.id }), (r) => L(`המותג הולבש: ${r.titles} כותרות, ${r.captionTracks} שכבות כתוביות${r.logo ? ', לוגו' : ''}`, `Brand on: ${r.titles} titles, ${r.captionTracks} caption layers${r.logo ? ', logo' : ''}`))}>
            <Check size={16} /> {following ? L('לרענן על הפרויקט', 'Refresh on this project') : L('להלביש על הפרויקט', 'Put on this project')}
          </button>
          <button className="chip-btn" disabled={!!busy || !following} title={following ? '' : L('קודם להלביש את המותג', 'Put the brand on first')} onClick={() => void onProject('intro', (pid) => api.brandCard(pid, 'intro'), (r) => L(`נוסף אינטרו של ${r.duration} שניות. כל העריכה זזה קדימה.`, `Added a ${r.duration}s intro. The whole edit moved later.`))}>
            {L('+ אינטרו', '+ Intro')}
          </button>
          <button className="chip-btn" disabled={!!busy || !following} title={following ? '' : L('קודם להלביש את המותג', 'Put the brand on first')} onClick={() => void onProject('outro', (pid) => api.brandCard(pid, 'outro'), (r) => L(`נוסף אאוטרו של ${r.duration} שניות בסוף.`, `Added a ${r.duration}s outro at the end.`))}>
            {L('+ אאוטרו', '+ Outro')}
          </button>
          {following && (
            <button className="link-btn" disabled={!!busy} onClick={() => void onProject('off', (pid) => api.applyBrand(pid, { remove: true }), () => L('הפרויקט כבר לא עוקב אחרי המותג. מה שעוצב נשאר.', 'The project no longer follows the brand. What was styled stays.'))}>
              {L('להפסיק לעקוב', 'Stop following')}
            </button>
          )}
        </div>
      </section>

      <section className="engine-box smart-card">
        <h4>
          <Palette size={16} /> {L('הערכה', 'The kit')}
        </h4>
        <label className="select">
          <span>{L('שם', 'Name')}</span>
          <input className="text-input" dir="auto" value={kit.name} onChange={(e) => change({ name: e.target.value })} />
        </label>

        <div className="brand-logo-row">
          <div className="brand-logo-box">{kit.logoUrl ? <img src={kit.logoUrl} alt={L('הלוגו', 'The logo')} /> : <ImagePlus size={22} />}</div>
          <div className="brand-logo-actions">
            <button className="chip-btn" onClick={() => logoInput.current?.click()} disabled={busy === 'logo'}>
              {busy === 'logo' ? '…' : kit.logo ? L('להחליף לוגו', 'Replace the logo') : L('העלאת לוגו', 'Upload a logo')}
            </button>
            {kit.logo && (
              <button className="link-btn" onClick={() => void api.removeBrandLogo(kit.id).then(replace)}>
                {L('להסיר', 'Remove')}
              </button>
            )}
            <span className="hint">{L('PNG עם רקע שקוף נראה הכי טוב', 'A PNG with a transparent background looks best')}</span>
          </div>
          <input ref={logoInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => (void uploadLogo(e.target.files?.[0]), (e.target.value = ''))} />
        </div>
        {kit.logo && (
          <label className="select">
            <span>{L('פינת הלוגו', 'Logo corner')}</span>
            <div className="corner-pick">
              {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
                <button key={c} className={`${c}${(kit.logoCorner || 'br') === c ? ' active' : ''}`} onClick={() => change({ logoCorner: c })} aria-label={c} />
              ))}
            </div>
          </label>
        )}

        <div className="brand-colors">
          {COLOR_KEYS.map((key) => (
            <label key={key} className="brand-color" title={L(COLOR_LABEL[key][2], COLOR_LABEL[key][3])}>
              <input type="color" value={kit.colors[key]} onChange={(e) => change({ colors: { [key]: e.target.value.toUpperCase() } as any })} />
              <span>
                <strong>{L(COLOR_LABEL[key][0], COLOR_LABEL[key][1])}</strong>
                <em dir="ltr">{kit.colors[key]}</em>
              </span>
            </label>
          ))}
        </div>

        <div className="field-row">
          {(['heading', 'body'] as const).map((key) => (
            <label key={key} className="select">
              <span>{key === 'heading' ? L('פונט כותרות', 'Heading font') : L('פונט טקסט', 'Body font')}</span>
              <select value={kit.fonts[key]} onChange={(e) => change({ fonts: { [key]: e.target.value } as any })}>
                {[...fonts, ...(fonts.some((f) => f.v === kit.fonts[key]) ? [] : [{ v: kit.fonts[key], l: kit.fonts[key] }])].map((f) => (
                  <option key={f.v} value={f.v}>
                    {f.l}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <span className="field-label">{L('מראה הכתוביות', 'Caption look')}</span>
        <div className="preset-grid">
          {CAPTION_PRESETS.map((c) => (
            <button key={c.id} className={`preset${kit.captionPreset === c.id ? ' active' : ''}`} onClick={() => change({ captionPreset: c.id })} aria-pressed={kit.captionPreset === c.id}>
              <StylePreview style={brandCaptionStyle(kit, c.id)} text={isHe ? 'ככה זה נראה' : 'This is how'} words />
              <span>{isHe ? c.labelHe : c.label}</span>
            </button>
          ))}
        </div>

        <label className="select">
          <span>{L('שורת הסיום (אאוטרו)', 'Outro line')}</span>
          <input className="text-input" dir="auto" value={kit.cta || ''} placeholder={L('עקבו לעוד', 'Follow for more')} onChange={(e) => change({ cta: e.target.value })} />
        </label>

        <div className="chip-row wrap">
          <button className={`chip-btn${kit.isDefault ? ' active' : ''}`} onClick={() => change({ isDefault: true })} disabled={kit.isDefault}>
            <Star size={13} fill={kit.isDefault ? 'currentColor' : 'none'} /> {kit.isDefault ? L('ברירת המחדל', 'The default') : L('לקבוע כברירת מחדל', 'Make it the default')}
          </button>
          <button className="chip-btn danger" onClick={() => void remove()}>
            <Trash2 size={13} /> {L('מחיקת הערכה', 'Delete the kit')}
          </button>
        </div>
      </section>
    </div>
  );
}
