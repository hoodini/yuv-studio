// Checks insert-drag and speed changes (shared/ops.ts): clips make room the way an editor user expects.
// Run: npm run test:edit
import { addCaption, addMediaClip, addTrack, copyCaptionTrack, insertClip, moveClipToNewTrack, newProject, placeClip, setCaptionTexts, setClipSpeed } from '../shared/ops';
import type { Project } from '../shared/types';

let fail = 0;
const ok = (c: boolean, m: string) => (console.log(c ? '  ok  ' : '  FAIL', m), c || fail++);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function base() {
  const p = newProject('t', 1920, 1080, 30);
  p.assets.push({ id: 'a', name: 'v.mp4', kind: 'video', path: '/v', duration: 100, width: 1920, height: 1080, fps: 30, hasAudio: true, thumbs: 1, size: 1 });
  const v1 = p.tracks.filter((t) => t.kind === 'video')[1];
  const ids = [0, 4, 8].map((s) => addMediaClip(p, 'a', { trackId: v1.id, start: s, duration: 4 }).id);
  return { p, v1, ids };
}
const layout = (p: Project, trackId: string) =>
  p.tracks
    .find((t) => t.id === trackId)!
    .clips.map((c) => `${c.id.slice(-3)}@${c.start}`)
    .join(' ');
const order = (p: Project, trackId: string, ids: string[]) => p.tracks.find((t) => t.id === trackId)!.clips.map((c) => ids.indexOf(c.id) + 1).join('');

{
  // Drag the third clip onto the first half of the first: it goes in at 0, the others move right, its old place closes.
  const { p, v1, ids } = base();
  const from = { trackId: v1.id, start: 8 };
  placeClip(p, ids[2], 0.5, v1.id);
  insertClip(p, ids[2], 0, { trackId: v1.id, ripple: true, from });
  ok(order(p, v1.id, ids) === '312' && layout(p, v1.id).endsWith('@8'), `3 dragged to the front: order ${order(p, v1.id, ids)} (${layout(p, v1.id)})`);
}
{
  // Drag the first clip onto the second half of the second: it goes after it.
  const { p, v1, ids } = base();
  const from = { trackId: v1.id, start: 0 };
  placeClip(p, ids[0], 6, v1.id);
  insertClip(p, ids[0], 8, { trackId: v1.id, ripple: true, from });
  const starts = p.tracks.find((t) => t.id === v1.id)!.clips.map((c) => c.start).join(',');
  ok(order(p, v1.id, ids) === '213' && starts === '0,4,8', `1 dragged after 2: order ${order(p, v1.id, ids)}, starts ${starts}`);
}
{
  // Without Close gaps the old place stays empty, but the insert still pushes.
  const { p, v1, ids } = base();
  insertClip(p, ids[2], 0, { trackId: v1.id, ripple: false, from: { trackId: v1.id, start: 8 } });
  const starts = p.tracks.find((t) => t.id === v1.id)!.clips.map((c) => c.start).join(',');
  ok(order(p, v1.id, ids) === '312' && starts === '0,4,8', `no ripple: starts ${starts}`);
}
{
  // To another layer: the clips there make room, the source layer closes its gap.
  const { p, v1, ids } = base();
  const v2 = p.tracks.filter((t) => t.kind === 'video')[0];
  const x = addMediaClip(p, 'a', { trackId: v2.id, start: 0, duration: 4 }).id;
  insertClip(p, ids[1], 1, { trackId: v2.id, ripple: true, from: { trackId: v1.id, start: 4 } });
  const top = p.tracks.find((t) => t.id === v2.id)!.clips.map((c) => `${c.id === x ? 'x' : 'm'}@${c.start}`).join(' ');
  const low = p.tracks.find((t) => t.id === v1.id)!.clips.map((c) => c.start).join(',');
  ok(top === 'm@0 x@4' && low === '0,4', `to another layer: top ${top}, below ${low}`);
}
{
  // Free space: no push when the clip fits.
  const { p, v1, ids } = base();
  insertClip(p, ids[0], 20, { trackId: v1.id, ripple: false, from: { trackId: v1.id, start: 0 } });
  ok(layout(p, v1.id).split(' ').map((x) => x.split('@')[1]).join(',') === '4,8,20', 'dropped in empty space: nothing else moves');
}
{
  // Slower: the clip gets longer and pushes the rest. Faster with Close gaps: they follow it.
  const { p, v1 } = base();
  const first = p.tracks.find((t) => t.id === v1.id)!.clips[0].id;
  const q = clone(p);
  setClipSpeed(p, first, 0.5, true);
  const s1 = p.tracks.find((t) => t.id === v1.id)!.clips.map((c) => `${c.start}+${c.duration}`).join(' ');
  ok(s1 === '0+8 8+4 12+4', `0.5x pushes: ${s1}`);
  setClipSpeed(q, first, 2, true);
  const s2 = q.tracks.find((t) => t.id === v1.id)!.clips.map((c) => `${c.start}+${c.duration}`).join(' ');
  ok(s2 === '0+2 2+4 6+4', `2x pulls in: ${s2}`);
}
{
  // A new layer above every video layer, or below them all.
  const { p, ids } = base();
  const t = moveClipToNewTrack(p, ids[0], 'above');
  const vids = p.tracks.filter((x) => x.kind === 'video');
  ok(vids[0] === t && t.clips[0]?.id === ids[0], `new layer above: it is the top video layer (${vids.map((x) => x.name).join(', ')})`);
  const b = moveClipToNewTrack(p, ids[1], 'below');
  const vids2 = p.tracks.filter((x) => x.kind === 'video');
  ok(vids2[vids2.length - 1] === b, `new layer below: it is the lowest video layer (${vids2.map((x) => x.name).join(', ')})`);
}
{
  // Translated captions keep their times; a copy for two languages sits one line higher.
  const p = newProject('t', 1920, 1080, 30);
  const cap = p.tracks.find((x) => x.kind === 'caption') || addTrack(p, 'caption');
  addCaption(p, 0, 'שלום לכולם', 2, cap.id);
  addCaption(p, 2, 'מה שלומך', 2, cap.id);
  const copy = copyCaptionTrack(p, cap.id, 'Captions (English)');
  setCaptionTexts(p, copy.id, ['Hello everyone', 'How are you doing'], 'en');
  const c = copy.clips[1];
  ok(
    copy.clips.map((x) => x.start).join(',') === '0,2' && c.words!.length === 4 && Math.abs(c.words![3].t1 - 2) < 1e-6 && cap.clips[0].text === 'שלום לכולם' && copy.lang === 'en',
    `translation keeps times, spreads the words, leaves the original (${copy.clips.map((x) => x.text).join(' / ')})`,
  );
  ok((copy.transform!.y ?? 0) < (cap.transform?.y ?? 0.8) && p.tracks.indexOf(copy) < p.tracks.indexOf(cap), `the copy is above the original (y ${copy.transform!.y?.toFixed(2)})`);
}
console.log(fail ? `${fail} FAILED` : 'all passed');
process.exit(fail ? 1 : 0);
