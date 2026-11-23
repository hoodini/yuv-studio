import { Loader2, Upload, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { useStore } from '../store';

const mb = (n: number) => (n / 1048576).toFixed(n < 10485760 ? 1 : 0);

/** Files going up: which one, how much, how fast, how long is left, and a way to stop. */
export function UploadStatus() {
  const up = useStore((s) => s.upload);
  const { isHe } = useT();
  const L = (he: string, en: string) => (isHe ? he : en);
  const [, tick] = useState(0);
  // Refresh the speed and the time left even while a slow piece is on its way.
  useEffect(() => {
    if (!up) return;
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [!!up]);
  if (!up) return null;
  const frac = up.total ? up.sent / up.total : 0;
  const secs = Math.max(0.5, (Date.now() - up.startedAt) / 1000);
  const rate = up.sent / secs;
  const left = rate > 0 ? (up.total - up.sent) / rate : 0;
  const preparing = up.sent >= up.total;
  const eta = left >= 60 ? L(`עוד ${Math.ceil(left / 60)} דק׳`, `${Math.ceil(left / 60)} min left`) : L(`עוד ${Math.ceil(left)} שנ׳`, `${Math.ceil(left)} s left`);
  return (
    <div className="upload-status" role="status" aria-live="polite">
      <div className="up-row">
        {preparing ? <Loader2 size={17} className="spin" /> : <Upload size={17} />}
        <span className="up-name" dir="auto">
          {preparing ? L('מכין את הקובץ (תמונות ממוזערות, גל קול)…', 'Preparing the file (thumbnails, waveform)…') : up.name}
        </span>
        <b dir="ltr">{Math.round(frac * 100)}%</b>
        {!preparing && (
          <button className="mini" onClick={up.cancel} title={L('ביטול ההעלאה', 'Cancel the upload')} aria-label={L('ביטול ההעלאה', 'Cancel the upload')}>
            <X size={15} />
          </button>
        )}
      </div>
      <div className="up-bar">
        <i style={{ width: `${Math.max(2, frac * 100)}%` }} className={preparing ? 'busy' : ''} />
      </div>
      <div className="up-meta" dir="ltr">
        {up.count > 1 && <span>{L(`קובץ ${up.index + 1} מתוך ${up.count}`, `File ${up.index + 1} of ${up.count}`)}</span>}
        <span>
          {mb(up.sent)} / {mb(up.total)} MB
        </span>
        {!preparing && up.sent > 0 && (
          <span>
            {mb(rate)} MB/s · {eta}
          </span>
        )}
      </div>
    </div>
  );
}
