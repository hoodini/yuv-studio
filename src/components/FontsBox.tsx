import { Download, Loader2, Star, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { loadCustomFonts, setDefaultFontLocal, useFonts } from '../customFonts';
import { useT } from '../i18n';
import { useStore } from '../store';

/** Add fonts (a file, or any Google Fonts family by name) and choose the font new titles start with. */
export function FontsBox() {
  const { isHe } = useT();
  const L = (he: string, en: string) => (isHe ? he : en);
  const { list, defaultFont, options } = useFonts();
  const notify = useStore.getState().notify;
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const run = async (fn: () => Promise<Response>, ok: string) => {
    setBusy(true);
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      await loadCustomFonts();
      notify(`${ok}: ${data.family || ''}`);
      return data;
    } catch (e: any) {
      notify(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };
  const importGoogle = () => name.trim() && run(() => fetch('/api/fonts/google', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ family: name.trim() }) }), L('הפונט נוסף', 'Font added')).then(() => setName(''));
  const upload = (f?: File) => {
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    void run(() => fetch('/api/fonts', { method: 'POST', body: fd }), L('הפונט הותקן', 'Font installed'));
  };
  const setDefault = async (family: string) => {
    await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ defaultFont: family }) });
    setDefaultFontLocal(family);
  };

  return (
    <section className="engine-box fonts-box">
      <h4>{L('פונטים', 'Fonts')}</h4>
      <div className="replace-row">
        <input dir="auto" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && importGoogle()} placeholder={L('שם פונט מגוגל, למשל Heebo', 'A Google font, e.g. Heebo')} aria-label={L('שם פונט מגוגל', 'Google font name')} />
        <button className="mini" onClick={importGoogle} disabled={busy || !name.trim()} title={L('ייבוא מ-Google Fonts', 'Import from Google Fonts')} aria-label={L('ייבוא מ-Google Fonts', 'Import from Google Fonts')}>
          {busy ? <Loader2 className="spin" size={15} /> : <Download size={15} />}
        </button>
      </div>
      <input ref={file} type="file" accept=".ttf,.otf,.woff,.woff2" hidden onChange={(e) => (upload(e.target.files?.[0]), (e.target.value = ''))} />
      <button className="pill sm" onClick={() => file.current?.click()} disabled={busy}>
        <Upload size={14} /> {L('התקנת קובץ פונט', 'Install a font file')}
      </button>
      <label className="select">
        <span>{L('פונט ברירת מחדל לכותרות חדשות', 'Default font for new titles')}</span>
        <select value={defaultFont} onChange={(e) => void setDefault(e.target.value)}>
          <option value="">{L('לפי הסגנון', 'From the style')}</option>
          {options.map((o) => (
            <option key={o.v} value={o.v}>
              {o.l}
            </option>
          ))}
        </select>
      </label>
      {list.length > 0 && (
        <ul className="font-list">
          {list.map((f) => (
            <li key={f.family}>
              <span style={{ fontFamily: `"${f.family}"` }} dir="auto">
                {f.family}
              </span>
              <small dir="ltr">{f.weights.join(' · ')}</small>
              {defaultFont === f.family && <Star size={13} />}
              <button
                className="mini"
                onClick={() => run(() => fetch(`/api/fonts/${encodeURIComponent(f.family)}`, { method: 'DELETE' }), L('הוסר', 'Removed'))}
                title={L('הסרה', 'Remove')}
                aria-label={`${L('הסרה', 'Remove')} ${f.family}`}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">{L('כותרת שמבקשת פונט שלא מותקן (גם מסוכן AI) תוריד אותו אוטומטית מ-Google Fonts.', 'A title that names a font you do not have yet (also from an AI agent) downloads it from Google Fonts automatically.')}</p>
    </section>
  );
}
