import { produce } from 'immer';
import { create } from 'zustand';
import { type Change, syncChanges } from '../shared/diff';
import type { Job, Project } from '../shared/types';
import { projectDuration } from '../shared/types';
import { api, clientId } from './api';
import { type Activity, agentFx } from './agentFx';
import { playback } from './playback';

interface State {
  project: Project | null;
  selection: string[];
  zoom: number;
  ripple: boolean;
  lang: 'he' | 'en';
  jobs: Record<string, Job>;
  past: string[];
  future: string[];
  toast: string;
  saving: boolean;
  /** The AI agent's changes awaiting review: `before` is the project as it was before the agent's turn(s). */
  review: { snapshot: string; before: Project } | null;
  /** The review row under the pointer, highlighted on the timeline. */
  hoverChange: string | null;
  /** A keyframe picked on the timeline (its clip and its time on the timeline): Delete removes it. */
  selectedKf: { clipId: string; time: number } | null;
  /** Files going up from this browser: what, how far, and how to stop it. */
  upload: { name: string; index: number; count: number; sent: number; total: number; startedAt: number; cancel: () => void } | null;
  /** The library tab open on the side (media, stock, agent...). */
  leftTab: string;
  startReview: (snapshot: string) => Promise<void>;
  /** Keep these changes: the baseline moves forward so they stop showing. */
  acceptChanges: (changes: Change[]) => void;
  /** Take these changes back (one undo step). */
  rejectChanges: (changes: Change[]) => void;
  open: (id: string) => Promise<void>;
  /** Apply an edit. `transient` edits (while dragging) do not add undo steps; call `checkpoint` first. */
  edit: (fn: (p: Project) => void, transient?: boolean) => void;
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  select: (ids: string[]) => void;
  set: (s: Partial<State>) => void;
  reload: () => Promise<void>;
  notify: (msg: string) => void;
}

let saveTimer: any;
let toastTimer: any;
function scheduleSave() {
  clearTimeout(saveTimer);
  useStore.setState({ saving: true });
  saveTimer = setTimeout(async () => {
    const p = useStore.getState().project;
    if (!p) return;
    try {
      await api.save(p);
    } catch (e: any) {
      useStore.getState().notify(String(e.message));
    }
    useStore.setState({ saving: false });
  }, 350);
}
/** Push pending edits to the server now. Call before asking the server to edit the project itself. */
export async function flushSave() {
  clearTimeout(saveTimer);
  const p = useStore.getState().project;
  if (p) await api.save(p);
  useStore.setState({ saving: false });
}
const afterChange = (p: Project) => playback.setDuration(projectDuration(p));

export const useStore = create<State>((set, get) => ({
  project: null,
  selection: [],
  zoom: 80,
  ripple: true,
  lang: (localStorage.getItem('studio.lang') as any) || 'he',
  jobs: {},
  past: [],
  future: [],
  toast: '',
  saving: false,
  review: null,
  hoverChange: null,
  selectedKf: null,
  upload: null,
  leftTab: localStorage.getItem('studio.leftTab') || 'media',
  startReview: async (snapshot) => {
    const p = get().project;
    if (!p || get().review) return;
    const before = await api.snapshot(p.id, snapshot);
    if (get().project?.id === p.id && !get().review) set({ review: { snapshot, before } });
  },
  acceptChanges: (changes) => {
    const { review, project } = get();
    if (!review || !project) return;
    set({ review: { ...review, before: produce(review.before, (d) => syncChanges(d, project, changes)) } });
  },
  rejectChanges: (changes) => {
    const review = get().review;
    if (review) get().edit((p) => syncChanges(p, review.before, changes));
  },
  open: async (id) => {
    const project = await api.load(id);
    localStorage.setItem('studio.project', id);
    history.replaceState(null, '', `?project=${id}`);
    set({ project, selection: [], past: [], future: [], review: null, hoverChange: null });
    playback.pause();
    afterChange(project);
    playback.seek(0);
  },
  reload: async () => {
    const cur = get().project;
    if (!cur) return;
    const project = await api.load(cur.id);
    agentFx.diff(get().project, project);
    set({ project, selection: get().selection.filter((id) => project.tracks.some((t) => t.clips.some((c) => c.id === id))) });
    afterChange(project);
  },
  checkpoint: () => {
    const p = get().project;
    if (p) set({ past: [...get().past.slice(-80), JSON.stringify(p)], future: [] });
  },
  edit: (fn, transient) => {
    const p = get().project;
    if (!p) return;
    if (!transient) get().checkpoint();
    const next = produce(p, fn);
    set({ project: next });
    afterChange(next);
    scheduleSave();
  },
  undo: () => {
    const { past, project, future } = get();
    if (!past.length || !project) return;
    const prev: Project = { ...JSON.parse(past[past.length - 1]), assets: project.assets };
    set({ project: prev, past: past.slice(0, -1), future: [JSON.stringify(project), ...future] });
    afterChange(prev);
    scheduleSave();
  },
  redo: () => {
    const { past, project, future } = get();
    if (!future.length || !project) return;
    const next: Project = { ...JSON.parse(future[0]), assets: project.assets };
    set({ project: next, future: future.slice(1), past: [...past, JSON.stringify(project)] });
    afterChange(next);
    scheduleSave();
  },
  select: (ids) => set({ selection: ids, selectedKf: get().selectedKf && ids.includes(get().selectedKf!.clipId) ? get().selectedKf : null }),
  set: (s) => set(s),
  notify: (msg) => {
    set({ toast: msg });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: '' }), 4000);
  },
}));

/** Live updates: edits made through the API or MCP, and job progress. */
export function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('project', (e) => {
    const d = JSON.parse((e as MessageEvent).data);
    const s = useStore.getState();
    if (d.id === s.project?.id && d.origin !== clientId) void s.reload();
  });
  es.addEventListener('activity', (e) => {
    const a: Activity = JSON.parse((e as MessageEvent).data);
    if (a.projectId === useStore.getState().project?.id) agentFx.onActivity(a);
  });
  es.addEventListener('job', (e) => {
    const job: Job = JSON.parse((e as MessageEvent).data);
    useStore.setState((s) => ({ jobs: { ...s.jobs, [job.id]: job } }));
  });
  return () => es.close();
}

export function getSelected(s: Pick<State, 'project' | 'selection'>) {
  if (s.selection.length !== 1 || !s.project) return null;
  for (const track of s.project.tracks) {
    const clip = track.clips.find((c) => c.id === s.selection[0]);
    if (clip) return { track, clip };
  }
  return null;
}
