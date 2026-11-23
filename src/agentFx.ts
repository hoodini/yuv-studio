// What the AI is doing, shown in the editor: the in-editor agent and any MCP client (Claude Code, Claude app...).
// The server announces every tool call (server/mcp.ts -> POST /api/activity -> SSE "activity"); this turns those
// announcements into a glow around the frame, a guided cursor that goes to the part of the editor being changed,
// and a short shimmer on the clips that changed.
import { create } from 'zustand';
import type { Project } from '../shared/types';
import { playback } from './playback';

export interface Activity {
  projectId: string;
  tool: string;
  phase: 'start' | 'end';
  ok: boolean;
  source: 'agent' | 'mcp';
  hint: Record<string, any>;
  at: number;
}

interface FxState {
  /** An AI is working on this project (a tool is running, or the agent is thinking between tools). */
  active: boolean;
  source: 'agent' | 'mcp';
  /** The last tool, for the cursor's label and target. */
  current: Activity | null;
  /** Bumped on every tool start, so the cursor flies again even to the same place. */
  seq: number;
  /** Clips that just changed, with the time they changed. */
  touched: Record<string, number>;
}

export const useAgentFx = create<FxState>(() => ({ active: false, source: 'agent', current: null, seq: 0, touched: {} }));

let thinking = false;
let running = 0;
let lastAt = 0;
let idleTimer: any;
const settle = () => {
  clearTimeout(idleTimer);
  if (thinking || running > 0) return void useAgentFx.setState({ active: true });
  // Stay lit a moment after the last step, so a fast sequence reads as one piece of work.
  // An outside client (Claude Code, the Claude app) thinks for seconds between tools and sends no "thinking" signal.
  const linger = useAgentFx.getState().source === 'mcp' ? 7000 : 1800;
  idleTimer = setTimeout(() => useAgentFx.setState({ active: false, current: null }), linger);
};

export const agentFx = {
  /** The in-editor agent's turn started or ended (it may think for a while between tools). */
  setThinking(on: boolean) {
    thinking = on;
    if (on) useAgentFx.setState({ source: 'agent' });
    else running = 0;
    settle();
  },
  onActivity(a: Activity) {
    if (a.phase === 'start') {
      running++;
      useAgentFx.setState((s) => ({ current: a, source: a.source, seq: s.seq + 1, active: true }));
      // Go to where the change happens on the timeline, as a person would (never while the user is watching).
      const t = typeof a.hint.start === 'number' ? a.hint.start : typeof a.hint.time === 'number' ? a.hint.time : null;
      if (t != null && !playback.playing && t >= 0) playback.seek(t);
    } else running = Math.max(0, running - 1);
    // A tool started by a client that went away must not keep the glow on forever: two quiet minutes end it.
    lastAt = Date.now();
    setTimeout(() => {
      if (Date.now() - lastAt >= 119000) {
        running = 0;
        settle();
      }
    }, 120000);
    settle();
  },
  /** Called with the project before and after a live update: mark the clips the AI changed. */
  diff(before: Project | null, after: Project) {
    if (!useAgentFx.getState().active || !before || before.id !== after.id) return;
    const old = new Map<string, string>();
    for (const t of before.tracks) for (const c of t.clips) old.set(c.id, JSON.stringify(c));
    const now = Date.now();
    const touched: Record<string, number> = {};
    for (const t of after.tracks) for (const c of t.clips) if (old.get(c.id) !== JSON.stringify(c)) touched[c.id] = now;
    if (!Object.keys(touched).length) return;
    useAgentFx.setState((s) => {
      const keep: Record<string, number> = {};
      for (const [id, at] of Object.entries(s.touched)) if (now - at < 2000) keep[id] = at;
      return { touched: { ...keep, ...touched } };
    });
    setTimeout(() => {
      useAgentFx.setState((s) => {
        const keep: Record<string, number> = {};
        for (const [id, at] of Object.entries(s.touched)) if (Date.now() - at < 2000) keep[id] = at;
        return { touched: keep };
      });
    }, 2100);
  },
};

export const useTouched = (clipId: string) => useAgentFx((s) => clipId in s.touched);

type Target = 'stage' | 'timeline' | 'clip' | 'export' | 'captions';
const T: Record<string, [Target, string, string]> = {
  generate_captions: ['captions', 'יוצר כתוביות', 'Making captions'],
  set_caption_style: ['stage', 'מעצב את הכתוביות', 'Styling the captions'],
  translate_captions: ['captions', 'מתרגם כתוביות', 'Translating captions'],
  edit_caption: ['captions', 'מתקן כתובית', 'Fixing a caption'],
  replace_in_captions: ['captions', 'מתקן כתוביות', 'Fixing captions'],
  add_caption: ['captions', 'מוסיף כתובית', 'Adding a caption'],
  merge_captions: ['captions', 'מאחד כתוביות', 'Merging captions'],
  get_captions: ['captions', 'קורא את הכתוביות', 'Reading the captions'],
  remove_silences: ['timeline', 'מסיר שתיקות', 'Removing silences'],
  get_words: ['captions', 'קורא את התמלול', 'Reading the transcript'],
  cut_words: ['timeline', 'חותך מילים', 'Cutting words'],
  remove_fillers: ['timeline', 'מסיר מילות מילוי', 'Removing filler words'],
  enhance_voice: ['timeline', 'מנקה את הקול', 'Cleaning the voice'],
  remove_background: ['stage', 'מסיר רקע', 'Removing the background'],
  list_brands: ['stage','קורא את ערכות המותג', 'Reading the brand kits'],
  apply_brand: ['stage', 'מלביש את המותג', 'Putting the brand on'],
  add_brand_card: ['timeline', 'מוסיף כרטיס מותג', 'Adding a brand card'],
  auto_reframe: ['stage', 'ממסגר מחדש לפי הפנים', 'Reframing to follow the face'],
  find_shorts: ['timeline', 'מחפש קליפים קצרים', 'Finding short clips'],
  make_short: ['timeline', 'יוצר קליפ קצר', 'Making a short'],
  cut_range: ['timeline', 'חותך קטע', 'Cutting a range'],
  split: ['clip', 'מפצל קליפ', 'Splitting a clip'],
  trim_clip: ['clip', 'מקצר קליפ', 'Trimming a clip'],
  delete_clips: ['clip', 'מוחק קליפים', 'Deleting clips'],
  move_clip: ['clip', 'מזיז קליפ', 'Moving a clip'],
  move_clip_to_new_track: ['clip', 'מעביר לשכבה חדשה', 'Moving to a new layer'],
  duplicate_clip: ['clip', 'משכפל קליפ', 'Duplicating a clip'],
  insert_clip: ['timeline', 'מכניס קליפ', 'Inserting a clip'],
  add_clip: ['timeline', 'מוסיף קליפ', 'Adding a clip'],
  update_clip: ['clip', 'משנה קליפ', 'Changing a clip'],
  set_speed: ['clip', 'משנה מהירות', 'Changing the speed'],
  detach_audio: ['clip', 'מפריד את הסאונד', 'Detaching the audio'],
  set_blend: ['clip', 'משנה מיזוג', 'Changing the blend'],
  add_text: ['stage', 'מוסיף כותרת', 'Adding a title'],
  add_zoom: ['stage', 'מוסיף זום', 'Adding a zoom'],
  set_keyframe: ['stage', 'מוסיף תנועה', 'Animating'],
  move_keyframe: ['stage', 'מזיז נקודת תנועה', 'Moving a keyframe'],
  remove_keyframes: ['stage', 'מסיר תנועה', 'Removing animation'],
  apply_layout: ['stage', 'מסדר את השכבות', 'Arranging the layers'],
  set_watermark: ['stage', 'מוסיף לוגו', 'Adding a logo'],
  reshape_project: ['stage', 'משנה את צורת הפריים', 'Reshaping the frame'],
  set_project: ['stage', 'משנה את הגדרות הפרויקט', 'Changing project settings'],
  add_track: ['timeline', 'מוסיף שכבה', 'Adding a layer'],
  remove_track: ['timeline', 'מסיר שכבה', 'Removing a layer'],
  update_track: ['timeline', 'משנה שכבה', 'Changing a layer'],
  add_sfx: ['timeline', 'מוסיף אפקט סאונד', 'Adding a sound effect'],
  speak: ['timeline', 'מקליט קריינות', 'Recording a voice-over'],
  import_media: ['timeline', 'מייבא מדיה', 'Importing media'],
  get_project: ['timeline', 'קורא את ציר הזמן', 'Reading the timeline'],
  get_transcript: ['timeline', 'קורא את התמלול', 'Reading the transcript'],
  export: ['export', 'מייצא', 'Exporting'],
};

export function describe(a: Activity | null, isHe: boolean): string {
  if (!a) return isHe ? 'חושב…' : 'Thinking…';
  const d = T[a.tool];
  return d ? (isHe ? d[1] : d[2]) : a.tool.replace(/_/g, ' ');
}

/** The element the cursor goes to for this step, and a point on it. */
export function targetOf(a: Activity | null, seq: number): { el: Element; x: number; y: number } | null {
  const kind: Target = a ? T[a.tool]?.[0] || 'timeline' : 'stage';
  const q = (s: string) => document.querySelector(s);
  const clipId = a?.hint.clipId || (Array.isArray(a?.hint.clipIds) ? a!.hint.clipIds[0] : undefined);
  const esc = (s: string) => CSS.escape(s);
  let el: Element | null = null;
  if (clipId && (kind === 'clip' || kind === 'captions' || kind === 'stage')) el = q(`.clip[data-clip-id="${esc(String(clipId))}"]`);
  if (!el && kind === 'captions') el = q('.clip.clip-caption') || q('.timeline');
  if (!el && kind === 'export') el = q('.topbar .cta') || q('.m-export');
  if (!el && kind === 'stage') el = q('.stage-frame-wrap');
  if (!el) el = q('.timeline') || q('.stage-frame-wrap');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  // Big areas: a different spot each step, so it looks like work and not a loop.
  const big = r.width > 260;
  const fx = big ? 0.25 + (((seq * 37) % 50) / 100) : 0.5;
  const fy = big ? 0.3 + (((seq * 23) % 40) / 100) : 0.5;
  return { el, x: r.left + r.width * fx, y: r.top + r.height * fy };
}
