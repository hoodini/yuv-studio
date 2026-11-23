// Editing commands shared by the toolbar buttons and the keyboard shortcuts.
import { addMediaClip, addTextClip, cutRange, deleteClips, detachAudio, duplicateClip, removeKeyframes, setClipSpeed, setKeyframe, splitAt } from '../shared/ops';
import type { Clip, Track } from '../shared/types';
import { clipEnd, projectDuration } from '../shared/types';
import { api } from './api';
import { getDefaultFont } from './customFonts';
import { monitor, playback, timecode } from './playback';
import { flushSave, useStore } from './store';

const S = () => useStore.getState();

export const actions = {
  /** The stage and its controls on the whole screen, or back. */
  toggleFullscreen() {
    if (document.fullscreenElement) return void document.exitFullscreen().catch(() => {});
    void document.getElementById('stage-panel')?.requestFullscreen().catch(() => {});
  },
  /** Delete the keyframe picked on the timeline (Delete / Backspace while one is picked). */
  removeSelectedKeyframe(): boolean {
    const { selectedKf, edit, notify } = S();
    if (!selectedKf) return false;
    try {
      edit((p) => void removeKeyframes(p, selectedKf.clipId, selectedKf.time));
    } catch (e: any) {
      notify(String(e.message || e));
    }
    S().set({ selectedKf: null });
    return true;
  },
  split() {
    const { selection, project, edit } = S();
    if (!project) return;
    const t = playback.time;
    const under = (id: string) => project.tracks.some((tr) => tr.clips.some((c) => c.id === id && t > c.start && t < clipEnd(c)));
    const ids = selection.filter(under);
    edit((p) => void splitAt(p, t, ids.length ? ids : undefined));
  },
  remove() {
    const { selection, ripple, edit, select } = S();
    if (!selection.length) return;
    edit((p) => deleteClips(p, selection, ripple));
    select([]);
  },
  duplicate() {
    const { selection, edit, select } = S();
    if (selection.length !== 1) return;
    let id = '';
    edit((p) => void (id = duplicateClip(p, selection[0]).id));
    if (id) select([id]);
  },
  mark(which: 'in' | 'out') {
    const t = playback.time;
    S().edit((p) => {
      if (which === 'in') p.markIn = t;
      else p.markOut = t;
      if (p.markIn != null && p.markOut != null && p.markIn > p.markOut) [p.markIn, p.markOut] = [p.markOut, p.markIn];
    });
    // Say what happened: a mark on its own is a thin line that is easy to miss.
    const p = S().project!;
    const he = S().lang === 'he';
    const tc = timecode(t, p.fps);
    const both = p.markIn != null && p.markOut != null;
    S().notify(
      both
        ? he
          ? `טווח מסומן ${timecode(p.markIn!, p.fps)} עד ${timecode(p.markOut!, p.fps)}. X חותך אותו`
          : `Range ${timecode(p.markIn!, p.fps)} to ${timecode(p.markOut!, p.fps)} marked. X cuts it`
        : which === 'in'
          ? he
            ? `התחלת טווח ב-${tc}. עכשיו O או ] בסוף`
            : `Range start at ${tc}. Now O or ] at the end`
          : he
            ? `סוף טווח ב-${tc}. עכשיו I או [ בהתחלה`
            : `Range end at ${tc}. Now I or [ at the start`,
    );
  },
  clearMarks() {
    S().edit((p) => {
      p.markIn = null;
      p.markOut = null;
    });
  },
  cutMarked() {
    const { project, edit, select, notify } = S();
    if (!project) return;
    if (project.markIn != null && project.markOut != null && project.markOut - project.markIn < 1 / project.fps) return void notify(S().lang === 'he' ? 'ההתחלה והסוף באותה נקודה. הזיזו את הסמן בין I ל-O' : 'Start and end are at the same spot. Move the playhead between I and O');
    if (project.markIn == null || project.markOut == null) return void notify(S().lang === 'he' ? 'קודם מסמנים טווח: I או [ בהתחלה, O או ] בסוף' : 'Mark a range first: I or [ at the start, O or ] at the end');
    const a = project.markIn;
    edit((p) => void cutRange(p, p.markIn!, p.markOut!));
    select([]);
    playback.seek(a);
  },
  /** The selected clip, or the top visual clip under the playhead (which then gets selected). */
  target(): { clip: Clip; track: Track } | null {
    const { project, selection, select } = S();
    if (!project) return null;
    for (const track of project.tracks) for (const clip of track.clips) if (clip.id === selection[0]) return { clip, track };
    const t = playback.time;
    for (const track of project.tracks)
      if (track.kind === 'video' || track.kind === 'text')
        for (const clip of track.clips)
          if (t >= clip.start && t < clip.start + clip.duration) {
            select([clip.id]);
            return { clip, track };
          }
    return null;
  },
  /** Add a keyframe at the playhead on the selected clip, or take away the one that is there. */
  toggleKeyframe() {
    const { edit, notify, project } = S();
    const he = S().lang === 'he';
    const hit = actions.target();
    if (!hit || !project) return void notify(he ? 'בחרו קליפ, ואז K מוסיף קי-פריים בסמן' : 'Select a clip, then K adds a keyframe at the playhead');
    const { clip } = hit;
    if (clip.type === 'audio') return void notify(he ? 'לקליפ אודיו אין תנועה. לעוצמה ולהגברה יש ידיות על הקליפ' : 'Audio clips have no motion. Volume and fades have handles on the clip');
    const t = playback.time;
    const half = 0.5 / project.fps;
    if (t < clip.start - half || t > clip.start + clip.duration + half) return void notify(he ? 'הסמן מחוץ לקליפ. הזיזו אותו לתוך הקליפ' : 'The playhead is outside the clip. Move it into the clip');
    const here = clip.keyframes?.some((k) => Math.abs(k.t - (t - clip.start)) <= half);
    edit((p) => void (here ? removeKeyframes(p, clip.id, t) : setKeyframe(p, clip.id, t, {}, 'ease-in-out')));
    const n = (S().project!.tracks.flatMap((tr) => tr.clips).find((c) => c.id === clip.id)?.keyframes || []).length;
    notify(
      here
        ? he
          ? 'הקי-פריים הוסר'
          : 'Keyframe removed'
        : n < 2
          ? he
            ? 'קי-פריים נוסף. הזיזו את הסמן ושנו מיקום או גודל בתצוגה: קי-פריים נוסף ייווצר לבד'
            : 'Keyframe added. Move the playhead and change position or size in the preview: the next keyframe is made for you'
          : he
            ? `קי-פריים נוסף (${n} בקליפ)`
            : `Keyframe added (${n} on the clip)`,
    );
  },
  /** Jump to the selected clip's previous / next keyframe. */
  stepKeyframe(dir: -1 | 1) {
    const hit = actions.target();
    if (!hit?.clip.keyframes?.length) return;
    const local = playback.time - hit.clip.start;
    const ks = hit.clip.keyframes.map((k) => k.t);
    const t = dir < 0 ? [...ks].reverse().find((k) => k < local - 1e-3) : ks.find((k) => k > local + 1e-3);
    if (t != null) (playback.pause(), playback.seek(hit.clip.start + t));
  },
  /** Speed of the selected video / audio clips: slower pushes what follows right, faster pulls it in (with Close gaps). */
  setSpeed(speed: number) {
    const { project, selection, edit, ripple, notify } = S();
    if (!project) return;
    const ids = project.tracks.flatMap((t) => t.clips).filter((c) => selection.includes(c.id) && (c.type === 'video' || c.type === 'audio')).map((c) => c.id);
    if (!ids.length) return void notify(S().lang === 'he' ? 'בחרו קליפ וידאו או אודיו כדי לשנות מהירות' : 'Select a video or audio clip to change its speed');
    edit((p) => ids.forEach((id) => setClipSpeed(p, id, speed, ripple)));
  },
  /** Split the selected video's sound onto an audio layer. */
  detachAudio() {
    const { edit, select, notify } = S();
    const hit = actions.target();
    if (!hit) return void notify(S().lang === 'he' ? 'בחרו קליפ וידאו עם סאונד' : 'Select a video clip with sound');
    let id = '';
    try {
      edit((p) => void (id = detachAudio(p, hit.clip.id).id));
    } catch (e: any) {
      return void notify(String(e.message || e));
    }
    if (id) select([id]);
  },
  addAsset(assetId: string, opts: { broll?: boolean; start?: number; trackId?: string } = {}) {
    const { edit, select } = S();
    let id = '';
    edit((p) => void (id = addMediaClip(p, assetId, opts).id));
    if (id) select([id]);
  },
  addText(preset: string, text: string) {
    const { edit, select } = S();
    let id = '';
    const font = getDefaultFont();
    edit((p) => void (id = addTextClip(p, { preset, text, start: playback.time, ...(font ? { style: { fontFamily: font } } : {}) }).id));
    if (id) select([id]);
  },
  /** Edits that run on the server (they need the files): save first, keep an undo step, then reload. */
  async server<T>(fn: (projectId: string) => Promise<T>): Promise<T | undefined> {
    const { project, checkpoint, reload, notify } = S();
    if (!project) return;
    try {
      await flushSave();
      checkpoint();
      const out = await fn(project.id);
      await reload();
      return out;
    } catch (e: any) {
      notify(String(e.message || e));
    }
  },
  async upload(files: File[]) {
    const { project, notify, reload } = S();
    if (!project || !files.length) return;
    try {
      await flushSave();
      const wasEmpty = projectDuration(project) === 0;
      const ctrl = new AbortController();
      const startedAt = Date.now();
      const base = { index: 0, count: files.length, sent: 0, total: files.reduce((n, f) => n + f.size, 0), startedAt, cancel: () => ctrl.abort() };
      S().set({ upload: { ...base, name: files[0].name } });
      const assets = await api.upload(project.id, files, (sent, total, f, index) => S().set({ upload: { ...base, name: f.name, index, sent, total } }), ctrl.signal).finally(() => S().set({ upload: null }));
      await reload();
      // A first drop goes straight onto the timeline so there is something to cut right away.
      if (wasEmpty) for (const a of assets) actions.addAsset(a.id);
    } catch (e: any) {
      if (e.message !== 'Cancelled') notify(String(e.message || e));
    }
  },
};

export function installShortcuts() {
  const onKey = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    // Only fields you type into keep the keys. A slider, checkbox or button that still has focus after a click
    // must not swallow the shortcuts (that made I / O / [ / ] look dead after touching a slider).
    const typing = !!el?.closest?.('textarea, select, [contenteditable]:not([contenteditable="false"])') || (el instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'color', 'button', 'submit', 'reset', 'file'].includes(el.type));
    if (typing) return;
    const slider = el instanceof HTMLInputElement && el.type === 'range';
    if (slider && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) return;
    const p = S().project;
    if (!p) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const frame = 1 / p.fps;
    const stepTo = (d: number) => (playback.pause(), playback.seek(Math.round((playback.time + d) * p.fps) / p.fps));
    // Physical keys (e.code), so the shortcuts work the same with a Hebrew keyboard layout.
    const c = e.code;
    if (c === 'Space') playback.toggle();
    else if (ctrl && c === 'KeyZ') e.shiftKey ? S().redo() : S().undo();
    else if (ctrl && c === 'KeyY') S().redo();
    else if (ctrl && c === 'KeyD') actions.duplicate();
    else if (e.code === 'KeyS' && !ctrl) actions.split();
    else if (e.key === 'Delete' || e.key === 'Backspace') actions.removeSelectedKeyframe() || actions.remove();
    else if (c === 'KeyF' && !ctrl) actions.toggleFullscreen();
    else if (c === 'KeyM' && !ctrl) monitor.toggleMute();
    else if ((c === 'KeyI' || c === 'BracketLeft') && !ctrl) actions.mark('in');
    else if ((c === 'KeyO' || c === 'BracketRight') && !ctrl) actions.mark('out');
    else if (c === 'KeyX' && e.altKey) actions.clearMarks();
    else if (c === 'KeyX' && !ctrl) actions.cutMarked();
    else if (c === 'KeyK' && !ctrl && !e.shiftKey) actions.toggleKeyframe();
    else if (c === 'KeyK' && e.shiftKey) actions.stepKeyframe(1);
    else if (c === 'KeyJ' && e.shiftKey) actions.stepKeyframe(-1);
    else if (e.key === 'ArrowLeft') stepTo(e.shiftKey ? -1 : -frame);
    else if (e.key === 'ArrowRight') stepTo(e.shiftKey ? 1 : frame);
    else if (e.key === 'Home') playback.seek(0);
    else if (e.key === 'End') playback.seek(projectDuration(p));
    else if (e.key === 'Escape') document.fullscreenElement ? void document.exitFullscreen().catch(() => {}) : S().selectedKf ? S().set({ selectedKf: null }) : S().select([]);
    else return;
    e.preventDefault();
    if (el instanceof HTMLElement && el !== document.body && !(el instanceof HTMLInputElement && el.type === 'range')) el.blur();
  };
  // A click leaves focus on the slider, checkbox or button it touched; give the keys back to the editor.
  const onUp = () => {
    const el = document.activeElement;
    if (el instanceof HTMLButtonElement || (el instanceof HTMLInputElement && ['range', 'checkbox', 'radio', 'color'].includes(el.type))) setTimeout(() => el.blur(), 0);
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('pointerup', onUp);
  return () => (window.removeEventListener('keydown', onKey), window.removeEventListener('pointerup', onUp));
}
