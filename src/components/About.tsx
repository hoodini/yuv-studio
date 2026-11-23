import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT } from '../i18n';

/** Yuval Avidani's public links, from the YUV.AI design system. */
export const SOCIALS: [string, string][] = [
  ['YUV.AI', 'https://yuv.ai'],
  ['YouTube', 'https://youtube.com/@yuv-ai'],
  ['Instagram', 'https://instagram.com/yuval_770'],
  ['TikTok', 'https://www.tiktok.com/@yuval.ai'],
  ['LinkedIn', 'https://www.linkedin.com/in/yuval-avidani-87081474/'],
  ['X', 'https://x.com/yuvalav'],
  ['GitHub', 'https://github.com/hoodini'],
  ['Facebook', 'https://facebook.com/yuval.avidani'],
];

/** Who made the studio, and where to find him. */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const { t, isHe } = useT();
  // The portrait and the home page are not part of the open-source edition: show each only when it is there.
  const [photo, setPhoto] = useState(true);
  const [home, setHome] = useState(false);
  useEffect(() => {
    let live = true;
    fetch('/home/', { method: 'HEAD' })
      .then((r) => live && setHome(r.ok && (r.headers.get('content-type') || '').includes('text/html')))
      .catch(() => {});
    return () => void (live = false);
  }, []);
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog about" role="dialog" aria-modal="true" aria-label={t('about')}>
        <header>
          <div className="brand" dir="ltr">
            <img className="brand-phoenix" src="/brand/mark-128.png" alt="" />
            <span className="brand-mark">YUV.AI</span>
            <span className="brand-sub">STUDIO</span>
          </div>
          <button className="icon-btn sm" onClick={onClose} aria-label={t('close')}>
            <X size={18} />
          </button>
        </header>
        <div className="about-who">
          {photo && (
            <span className="avatar">
              <img src="/brand/author.jpg" alt={isHe ? 'יובל אבידני' : 'Yuval Avidani'} onError={() => setPhoto(false)} />
            </span>
          )}
          <div>
            <span className="hint">{isHe ? 'נבנה על ידי' : 'Built by'}</span>
            <strong>{isHe ? 'יובל אבידני' : 'Yuval Avidani'}</strong>
            <p>
              {isHe
                ? 'טכנולוג ויוצר תוכן טכני, מגיש פינת ה-AI בחדשות 12, ומייסד YUV.AI. ‏GitHub Star כפול ו-AWS GenAI Superstar כפול.'
                : 'Technologist and technical content creator, host of the AI segment on Channel 12 News, and founder of YUV.AI. 2× GitHub Star and 2× AWS GenAI Superstar.'}
            </p>
          </div>
        </div>
        <nav className="socials" dir="ltr" aria-label={isHe ? 'קישורים' : 'Links'}>
          {SOCIALS.map(([name, url]) => (
            <a key={name} className="pill sm" href={url} target="_blank" rel="noreferrer">
              {name}
            </a>
          ))}
        </nav>
        <div className="about-foot">
          {home ? (
            <a className="link-btn" href="/home/">
              {isHe ? 'עמוד הבית של הסטודיו' : 'The studio home page'}
            </a>
          ) : (
            <a className="link-btn" href="https://github.com/hoodini/yuv-studio" target="_blank" rel="noreferrer">
              {isHe ? 'הקוד ב-GitHub' : 'The code on GitHub'}
            </a>
          )}
          <span className="fly" dir="ltr">
            LET&apos;S FLY HIGH
          </span>
        </div>
      </div>
    </div>
  );
}
