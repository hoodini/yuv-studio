// Reviewing the AI agent's edits: the list of changes since before its turn, and how each one reads.
import { useMemo } from 'react';
import { type Change, diffProjects } from '../shared/diff';
import { useStore } from './store';

/** The agent's changes still awaiting review, in timeline order. */
export function useReviewChanges(): Change[] {
  const project = useStore((s) => s.project);
  const review = useStore((s) => s.review);
  return useMemo(() => (project && review ? diffProjects(review.before, project) : []), [project, review]);
}

type L = (he: string, en: string) => string;

const TYPE: Record<string, [string, string, string, string]> = {
  // he, en, he plural, en plural
  text: ['כותרת', 'Title', 'כותרות', 'titles'],
  caption: ['כתובית', 'Caption', 'כתוביות', 'captions'],
  video: ['קליפ', 'Clip', 'קליפים', 'clips'],
  image: ['תמונה', 'Image', 'תמונות', 'images'],
  audio: ['אודיו', 'Audio', 'קטעי אודיו', 'audio clips'],
};

const FIELD: Record<string, [string, string]> = {
  start: ['זז', 'moved'],
  track: ['עבר שכבה', 'moved to another layer'],
  duration: ['אורך', 'length'],
  in: ['נקודת התחלה במקור', 'source in-point'],
  keyframes: ['תנועה וזום', 'motion and zoom'],
  transform: ['מיקום וגודל', 'position and size'],
  fx: ['מראה', 'look'],
  tin: ['מעבר כניסה', 'transition in'],
  tout: ['מעבר יציאה', 'transition out'],
  text: ['טקסט', 'text'],
  words: ['טקסט', 'text'],
  name: ['שם', 'name'],
  style: ['עיצוב', 'style'],
  volume: ['עוצמה', 'volume'],
  muted: ['השתקה', 'mute'],
  hidden: ['הסתרה', 'hidden'],
  speed: ['מהירות', 'speed'],
  captionPreset: ['סגנון כתוביות', 'caption style'],
  width: ['גודל', 'size'],
  height: ['גודל', 'size'],
  fps: ['קצב פריימים', 'frame rate'],
  markIn: ['סימוני טווח', 'range marks'],
  markOut: ['סימוני טווח', 'range marks'],
};

const sec = (t: number) => `${Math.abs(t) < 10 ? t.toFixed(1) : Math.round(t * 10) / 10}s`;

/** A title and a detail line for one change, in the editor's language. */
/** A title, the clip or track name (shown apart, so its own direction holds), and a detail line. */
export function describeChange(c: Change, L: L): { title: string; name: string; detail: string } {
  const verb = c.kind === 'add' ? L('נוסף', 'Added') : c.kind === 'remove' ? L('נמחק', 'Removed') : L('שונה', 'Changed');
  const type = c.clipType ? TYPE[c.clipType] : undefined;
  let title: string;
  if (c.scope === 'order') title = L('סדר השכבות', 'Layer order');
  else if (c.scope === 'project') title = L('הגדרות הפרויקט', 'Project settings');
  else if (c.scope === 'track') title = c.count === 1 && type ? `${L(type[0], type[1])}` : `${L('רצועה', 'Track')}${c.count ? ` · ${c.count}` : ''}`;
  else if (c.cut !== undefined) title = `${L('חיתוך', 'Cut')} ${sec(c.cut)}`;
  else if (c.scope === 'clips') title = `${c.count} ${type ? L(type[2], type[3]) : L('פריטים', 'items')}`;
  else title = `${type ? L(type[0], type[1]) : L('פריט', 'Item')}`;

  let detail = verb;
  if (c.cut !== undefined) {
    const more = [...new Set(c.fields.filter((f) => f !== 'cut').map((f) => (FIELD[f] ? L(...FIELD[f]) : f)))];
    detail = `${L('הוסר מהטיימליין', 'Taken out of the timeline')}${more.length ? `; ${L('גם', 'also')} ${more.join(', ')}` : ''}`;
  } else if (c.kind === 'change' && c.fields.length) {
    const parts = [...new Set(c.fields.filter((f) => f !== 'order').map((f) => (FIELD[f] ? L(...FIELD[f]) : f)))];
    if (c.delta !== undefined) parts[0] = `${L('זז', 'moved')} ${c.delta > 0 ? '+' : '−'}${sec(Math.abs(c.delta))}`;
    if (parts.length) detail = `${verb}: ${parts.join(', ')}`;
  }
  if (c.time !== undefined && c.scope !== 'order' && c.scope !== 'project') detail += ` · ${sec(c.time)}`;
  const name = c.scope === 'clip' || c.cut !== undefined || (c.scope === 'track' && !!c.label) ? c.label : '';
  return { title, name, detail };
}
