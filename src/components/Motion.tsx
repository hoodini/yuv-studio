import { ChevronLeft, ChevronRight, Diamond, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { transformAt } from '../../shared/geometry';
import { addZoom, removeKeyframes, setKeyframe } from '../../shared/ops';
import type { Clip, Ease, Project } from '../../shared/types';
import { clipEnd } from '../../shared/types';
import { useT } from '../i18n';
import { playback, usePlayhead } from '../playback';
import { useStore } from '../store';

/** Each smoothness, with the CSS timing that draws the same move in the little previews. */
const EASES: { id: Ease; he: string; en: string; css: string; path: string }[] = [
  { id: 'ease-in-out', he: 'חלק', en: 'Smooth', css: 'cubic-bezier(0.65, 0, 0.35, 1)', path: 'M3 21 C 12 21, 12 3, 21 3' },
  { id: 'ease-out', he: 'האטה בסוף', en: 'Ease out', css: 'cubic-bezier(0.22, 1, 0.36, 1)', path: 'M3 21 C 6 6, 12 3, 21 3' },
  { id: 'ease-in', he: 'האצה בהתחלה', en: 'Ease in', css: 'cubic-bezier(0.64, 0, 0.78, 0)', path: 'M3 21 C 12 21, 18 18, 21 3' },
  { id: 'linear', he: 'קצב קבוע', en: 'Linear', css: 'linear', path: 'M3 21 L 21 3' },
  { id: 'hold', he: 'קפיצה', en: 'Jump', css: 'steps(1, end)', path: 'M3 21 H 21 V 3' },
];

type MoveId = 'zoom-in' | 'zoom-out' | 'punch' | 'pan-right' | 'pan-left';
const MOVES: { id: MoveId; he: string; en: string; hintHe: string; hintEn: string }[] = [
  { id: 'zoom-in', he: 'זום פנימה איטי', en: 'Slow zoom in', hintHe: 'מתקרב לאורך כל הקליפ', hintEn: 'Moves closer over the whole clip' },
  { id: 'zoom-out', he: 'זום החוצה איטי', en: 'Slow zoom out', hintHe: 'מתחיל קרוב ומתרחק', hintEn: 'Starts close and pulls back' },
  { id: 'punch', he: 'זום קצר בסמן', en: 'Punch in', hintHe: 'קפיצה פנימה לשתי שניות, מהסמן', hintEn: 'Jumps in for two seconds, from the playhead' },
  { id: 'pan-right', he: 'תנועה ימינה', en: 'Pan right', hintHe: 'גולש לרוחב (Ken Burns)', hintEn: 'Glides sideways (Ken Burns)' },
  { id: 'pan-left', he: 'תנועה שמאלה', en: 'Pan left', hintHe: 'גולש לרוחב לצד השני', hintEn: 'Glides sideways the other way' },
];

const stamp = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

/** A tiny animated frame showing what a move does: a sunset scene that zooms or pans with the chosen smoothness. */
function MovePreview({ move, ease }: { move: MoveId; ease: string }) {
  return (
    <span className="mv-frame" aria-hidden>
      <span className={`mv-scene mv-${move}`} style={{ animationTimingFunction: ease }}>
        <i className="mv-sun" />
        <i className="mv-hill mv-hill-a" />
        <i className="mv-hill mv-hill-b" />
        <i className="mv-person" />
      </span>
    </span>
  );
}

/**
 * Animation of a clip: keyframes at the playhead, the smoothness of the move that arrives at each one,
 * and ready-made moves. Once a clip has a keyframe, every change to its position or size at another
 * moment makes a new keyframe there.
 */
export function MotionFields({ clip, project }: { clip: Clip; project: Project }) {
  const now = usePlayhead();
  const { edit, checkpoint, notify, set } = useStore.getState();
  const selectedKf = useStore((s) => s.selectedKf);
  const { isHe } = useT();
  const L = (he: string, en: string) => (isHe ? he : en);
  const [ease, setEase] = useState<Ease>('ease-in-out');
  const [amount, setAmount] = useState(1.4);

  const kfs = clip.keyframes || [];
  const half = 0.5 / project.fps;
  const local = now - clip.start;
  const inside = local >= -half && local <= clip.duration + half;
  const here = kfs.find((k) => Math.abs(k.t - local) <= half);
  const prev = [...kfs].reverse().find((k) => k.t < local - half);
  const next = kfs.find((k) => k.t > local + half);
  const run = (fn: (p: Project) => void) => {
    checkpoint();
    try {
      edit(fn);
    } catch (e: any) {
      notify(String(e.message || e));
    }
  };
  const goTo = (t: number) => {
    playback.pause();
    playback.seek(clip.start + t);
    set({ selectedKf: { clipId: clip.id, time: clip.start + t } });
  };
  const end = clipEnd(clip);
  const shown = here ? here.ease : ease;
  const easeCss = EASES.find((e) => e.id === shown)!.css;

  const apply = (move: MoveId) => {
    const base = transformAt(clip, 0);
    if (move === 'zoom-in') run((p) => void addZoom(p, clip.id, { start: clip.start, ramp: clip.duration, scale: amount, ease }));
    if (move === 'zoom-out')
      run((p) => {
        setKeyframe(p, clip.id, clip.start, { ...base, scale: base.scale * amount }, 'linear');
        setKeyframe(p, clip.id, end, base, ease);
      });
    if (move === 'punch') {
      const at = Math.max(clip.start, Math.min(now, end - 0.2));
      run((p) => void addZoom(p, clip.id, { start: at, end: Math.min(end, at + 2), ramp: 0.35, scale: amount, ease }));
    }
    if (move === 'pan-right' || move === 'pan-left') {
      // Zoom in a little so the picture still covers the frame while it slides.
      const s = base.scale * Math.max(1.15, Math.min(amount, 1.6));
      const reach = Math.min(0.12, (s / base.scale - 1) / 2.2);
      const dir = move === 'pan-right' ? 1 : -1;
      run((p) => {
        setKeyframe(p, clip.id, clip.start, { ...base, scale: s, x: base.x - dir * reach }, 'linear');
        setKeyframe(p, clip.id, end, { ...base, scale: s, x: base.x + dir * reach }, ease);
      });
    }
  };

  return (
    <section className="insp-section">
      <h4>{L('תנועה וזום', 'Motion and zoom')}</h4>
      <div className="kf-row" dir="ltr">
        <button className="mini" disabled={!prev} onClick={() => prev && goTo(prev.t)} title={L('לקי-פריים הקודם (Shift+J)', 'Previous keyframe (Shift+J)')} aria-label={L('לקי-פריים הקודם', 'Previous keyframe')}>
          <ChevronLeft size={16} />
        </button>
        <button
          className={`kf-btn${here ? ' on' : ''}`}
          disabled={!inside}
          onClick={() => run((p) => void (here ? removeKeyframes(p, clip.id, now) : setKeyframe(p, clip.id, now, {}, ease)))}
          title={here ? L('הסרת הקי-פריים שבסמן', 'Remove the keyframe at the playhead') : L('קי-פריים בסמן (K)', 'Keyframe at the playhead (K)')}
        >
          <Diamond size={15} fill={here ? 'currentColor' : 'none'} />
          <span dir="auto">{here ? L('יש קי-פריים כאן', 'Keyframe here') : L('קי-פריים בסמן', 'Add keyframe')}</span>
        </button>
        <button className="mini" disabled={!next} onClick={() => next && goTo(next.t)} title={L('לקי-פריים הבא (Shift+K)', 'Next keyframe (Shift+K)')} aria-label={L('לקי-פריים הבא', 'Next keyframe')}>
          <ChevronRight size={16} />
        </button>
        <button className="mini" disabled={!kfs.length} onClick={() => run((p) => void removeKeyframes(p, clip.id))} title={L('הסרת כל התנועה', 'Remove all motion')} aria-label={L('הסרת כל התנועה', 'Remove all motion')}>
          <Trash2 size={15} />
        </button>
      </div>

      {kfs.length > 0 && (
        <div className="kf-list" role="listbox" aria-label={L('הקי-פריימים של הקליפ', "The clip's keyframes")}>
          {kfs.map((k) => {
            const on = selectedKf?.clipId === clip.id && Math.abs(selectedKf.time - (clip.start + k.t)) < 1e-3;
            return (
              <button key={k.t} role="option" aria-selected={on} className={`kf-chip${on ? ' on' : ''}${here === k ? ' here' : ''}`} onClick={() => goTo(k.t)} title={L('בחירה וקפיצה לקי-פריים. Delete מוחק אותו', 'Pick and jump to this keyframe. Delete removes it')}>
                <Diamond size={11} fill="currentColor" />
                <span dir="ltr">{stamp(clip.start + k.t)}</span>
                <small dir="ltr">×{k.scale.toFixed(2)}</small>
              </button>
            );
          })}
        </div>
      )}

      <div className="ease-pick" role="radiogroup" aria-label={here ? L('החלקה אל הקי-פריים הזה', 'Smoothness into this keyframe') : L('החלקה', 'Smoothness')}>
        <span className="ease-title">{here ? L('החלקה אל הקי-פריים הזה', 'Smoothness into this keyframe') : L('החלקה של התנועה', 'Smoothness of the move')}</span>
        <div className="ease-grid">
          {EASES.map((e) => (
            <button
              key={e.id}
              role="radio"
              aria-checked={shown === e.id}
              className={`ease-tile${shown === e.id ? ' on' : ''}`}
              onClick={() => {
                setEase(e.id);
                if (here) run((p) => void setKeyframe(p, clip.id, now, {}, e.id));
              }}
              title={L(e.he, e.en)}
            >
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d={e.path} />
              </svg>
              <i className="ease-dot" style={{ animationTimingFunction: e.css }} />
              <span>{L(e.he, e.en)}</span>
            </button>
          ))}
        </div>
      </div>

      <label className="slider">
        <span>{L('עוצמת זום', 'Zoom amount')}</span>
        <input type="range" min={1.05} max={3} step={0.05} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        <output dir="ltr">×{amount.toFixed(2)}</output>
      </label>

      <div className="move-grid">
        {MOVES.map((m) => (
          <button key={m.id} className="move-tile" disabled={m.id === 'punch' && (!inside || end - Math.max(clip.start, now) < 0.2)} onClick={() => apply(m.id)} title={L(m.hintHe, m.hintEn)}>
            <MovePreview move={m.id} ease={easeCss} />
            <span>{L(m.he, m.en)}</span>
          </button>
        ))}
      </div>
      <p className="hint">
        {kfs.length
          ? L('לקליפ יש תנועה: כל שינוי במיקום, בגודל, בסיבוב או באטימות יוצר קי-פריים בסמן. על הציר: לחיצה על יהלום בוחרת אותו, גרירה מזיזה אותו בזמן, Delete מוחק.', 'This clip is animated: any change to position, size, rotation or opacity makes a keyframe at the playhead. On the timeline: click a diamond to pick it, drag it to move it in time, Delete removes it.')
          : L('בחרו תנועה מוכנה, או הוסיפו קי-פריים, הזיזו את הסמן ושנו גודל או מיקום. הסטודיו ינוע ביניהם.', 'Pick a ready move, or add a keyframe, move the playhead and change the size or position. The studio moves between them.')}
      </p>
    </section>
  );
}
