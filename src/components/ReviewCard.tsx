import { Check, Minus, Pencil, Plus, X } from 'lucide-react';
import type { Change } from '../../shared/diff';
import { useT } from '../i18n';
import { playback } from '../playback';
import { describeChange } from '../review';
import { useStore } from '../store';

const ICON = { add: Plus, remove: Minus, change: Pencil };

/**
 * The agent's edits as a list the user goes through: keep or take back each change on its own, or all at once.
 * The same changes are marked on the timeline; pointing at a row lights up what it touched.
 */
export function ReviewCard({ changes, busy }: { changes: Change[]; busy: boolean }) {
  const { isHe } = useT();
  const L = (he: string, en: string) => (isHe ? he : en);
  const { acceptChanges, rejectChanges, set } = useStore.getState();
  const hover = useStore((s) => s.hoverChange);
  if (!changes.length) return null;

  const show = (c: Change) => {
    if (c.time !== undefined) playback.seek(c.time);
    const p = useStore.getState().project;
    const live = c.clipIds.filter((id) => p?.tracks.some((t) => t.clips.some((x) => x.id === id)));
    if (live.length) useStore.getState().select(live);
  };

  return (
    <section className="review-card" aria-label={L('שינויים של הסוכן', "The agent's changes")}>
      <header>
        <strong>
          {changes.length === 1 ? L('שינוי אחד לבדיקה', '1 change to review') : L(`${changes.length} שינויים לבדיקה`, `${changes.length} changes to review`)}
        </strong>
        <button className="pill-ghost" disabled={busy} onClick={() => rejectChanges(changes)}>
          <X size={13} /> {L('ביטול הכל', 'Undo all')}
        </button>
        <button className="pill-white" disabled={busy} onClick={() => acceptChanges(changes)}>
          <Check size={13} /> {L('שמירת הכל', 'Keep all')}
        </button>
      </header>
      <ul>
        {changes.map((c) => {
          const { title, name, detail } = describeChange(c, L);
          const full = name ? `${title} “${name}”` : title;
          const Icon = ICON[c.kind];
          return (
            <li key={c.key} className={`rv rv-${c.kind}${hover === c.key ? ' hot' : ''}`} onPointerEnter={() => set({ hoverChange: c.key })} onPointerLeave={() => set({ hoverChange: null })}>
              <button className="rv-main" onClick={() => show(c)} title={L('הצגה בטיימליין', 'Show on the timeline')}>
                <span className="rv-icon">
                  <Icon size={12} />
                </span>
                <span className="rv-text">
                  <span className="rv-title">
                    {title} {name && <bdi>“{name}”</bdi>}
                  </span>
                  <span className="rv-detail">{detail}</span>
                </span>
              </button>
              <button className="mini rv-yes" disabled={busy} onClick={() => acceptChanges([c])} title={L('שמירה', 'Keep')} aria-label={`${L('שמירה', 'Keep')}: ${full}`}>
                <Check size={14} />
              </button>
              <button className="mini rv-no" disabled={busy} onClick={() => rejectChanges([c])} title={L('ביטול השינוי', 'Undo this change')} aria-label={`${L('ביטול', 'Undo')}: ${full}`}>
                <X size={14} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
