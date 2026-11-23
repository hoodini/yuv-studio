// Checks the review engine (shared/diff.ts): every change can be kept or taken back on its own. Run: npm run test:diff
import { addCaption, addMediaClip, addTextClip, addTrack, addZoom, cutRange, moveTrack, newProject, replaceInCaptions, updateTrack, setProjectSettings } from '../shared/ops';
import { diffProjects, syncChanges } from '../shared/diff';
import type { Project } from '../shared/types';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const norm = (p: Project) => JSON.stringify({ t: p.tracks, n: p.name, w: p.width, h: p.height, f: p.fps, i: p.markIn ?? null, o: p.markOut ?? null });
let fail = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(cond ? '  ok  ' : '  FAIL', msg);
  if (!cond) fail++;
};

const before = newProject('Test', 1920, 1080, 30);
before.assets.push({ id: 'a1', name: 'cam.mp4', kind: 'video', path: '/x', duration: 60, width: 1920, height: 1080, fps: 30, hasAudio: true, thumbs: 10, size: 1 });
for (let i = 0; i < 4; i++) addMediaClip(before, 'a1', { duration: 5 } as any);
const cap = addTrack(before, 'caption', 'Captions');
for (let i = 0; i < 5; i++) addCaption(before, i * 4, `hello world ${i}`, 3, cap.id);
before.rev = 1;

// What an agent turn might do.
const after = clone(before);
cutRange(after, 6, 8); // splits a clip, shifts later clips on every track
const title = addTextClip(after, { text: 'Chapter 1', start: 1 } as any);
const vid = after.tracks.find((t) => t.kind === 'video' && t.clips.length)!;
addZoom(after, vid.clips[0].id, { from: 0.5 } as any);
replaceInCaptions(after, 'hello', 'shalom');
moveTrack(after, after.tracks.find((t) => t.kind === 'audio')!.id, 0);
updateTrack(after, after.tracks.find((t) => t.kind === 'audio')!.id, { muted: true });
setProjectSettings(after, { name: 'Renamed' });

const changes = diffProjects(before, after);
console.log('changes:');
for (const c of changes) console.log('  ', c.kind, c.scope, c.label || '', c.fields.join(','), c.count ?? '', c.delta != null ? `Δ${c.delta.toFixed(2)}` : '', c.time?.toFixed(2) ?? '');

ok(changes.some((c) => c.kind === 'add' && c.clipIds.includes(title.id)), 'title shows as added');
ok(changes.some((c) => c.scope === 'order'), 'layer order change found');
ok(changes.some((c) => c.scope === 'project'), 'project rename found');
ok(changes.some((c) => c.scope === 'track' && c.fields.includes('muted')), 'muted track found');

// Each change rejected on its own disappears, and the others stay.
for (const c of changes) {
  const cur = clone(after);
  syncChanges(cur, before, [c]);
  const left = diffProjects(before, cur).map((x) => x.key);
  ok(!left.includes(c.key), `reject ${c.key} removes it`);
}
// Accepting a change moves the baseline: the change disappears and the project itself is untouched.
for (const c of changes) {
  const base = clone(before);
  syncChanges(base, after, [c]);
  const left = diffProjects(base, after).map((x) => x.key);
  ok(!left.includes(c.key), `accept ${c.key} removes it`);
}
// Reject all = before; accept all = no changes left.
const all = clone(after);
syncChanges(all, before, changes);
ok(norm(all) === norm(before), 'reject all restores the project exactly');
const base = clone(before);
syncChanges(base, after, changes);
ok(diffProjects(base, after).length === 0, 'accept all leaves nothing to review');
// A project with no changes has none.
ok(diffProjects(before, clone(before)).length === 0, 'no false changes');
// A cut at the very start trims the first clip and pulls the rest earlier: one row.
const t2 = clone(before);
cutRange(t2, 0, 1.5);
const c2 = diffProjects(before, t2);
console.log('start cut:', c2.map((c) => `${c.kind}/${c.scope} cut=${c.cut} n=${c.clipIds.length} f=${c.fields}`));
ok(c2.filter((c) => c.cut !== undefined).length >= 1 && c2.some((c) => Math.abs((c.cut ?? 0) - 1.5) < 1e-3), 'start cut reads as a 1.5s cut');
const r2 = clone(t2);
syncChanges(r2, before, c2);
ok(norm(r2) === norm(before), 'rejecting the start cut restores it');
console.log(fail ? `${fail} FAILED` : 'all passed');
process.exit(fail ? 1 : 0);
