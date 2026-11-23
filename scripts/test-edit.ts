// Checks insert-drag and speed changes (shared/ops.ts): clips make room the way an editor user expects.
// Run: npm run test:edit
import { OPS, addCaption, addMediaClip, addTextClip, addTrack, copyCaptionTrack, insertClip, moveClipToNewTrack, newProject, placeClip, setCaptionPreset, setCaptionTexts, setClipSpeed } from '../shared/ops';
import { applyStarter } from '../shared/starters';
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
{
  // A brand kit restyles captions and titles (keeping sizes people set), new ones follow it, and an intro moves the edit.
  const { p } = base();
  p.assets.push({ id: 'bg', name: 'card', kind: 'image', path: '/bg', duration: 0, width: 1920, height: 1080, hasAudio: false, thumbs: 1, size: 1 });
  p.assets.push({ id: 'logo', name: 'logo', kind: 'image', path: '/logo', duration: 0, width: 512, height: 512, hasAudio: false, thumbs: 1, size: 1 });
  const cap = addTrack(p, 'caption');
  setCaptionPreset(p, cap.id, 'marker');
  const title = addTextClip(p, { preset: 'cta', text: 'Go', start: 1 });
  title.style!.fontSize = 77;
  const brand = { name: 'Acme', colors: { primary: '#112233', accent: '#FFCC00', light: '#FFFFFF', dark: '#000000' }, fonts: { heading: 'Anton', body: 'Inter' }, captionPreset: 'glass', cta: 'Buy now' };
  const r = OPS.set_brand_style(p, { brand }) as any;
  ok(r.titles === 1 && cap.style!.highlightColor === '#FFCC00' && cap.style!.fontFamily === 'Inter', `captions take the accent and body font (${cap.style!.highlightColor}, ${cap.style!.fontFamily})`);
  ok(title.style!.bgColor === '#112233' && title.style!.fontSize === 77 && title.style!.color === '#FFFFFF', `the button takes the primary, keeps its size 77 (${title.style!.bgColor}, ${title.style!.fontSize})`);
  const big = addTextClip(p, { preset: 'title', text: 'Hi', start: 6 });
  ok(big.style!.fontFamily === 'Anton' && big.style!.fontWeight === 400 && big.preset === 'title', `a new title uses the heading font in its one weight (${big.style!.fontFamily} ${big.style!.fontWeight})`);
  const firstStart = p.tracks.flatMap((t) => t.clips).filter((c) => c.type === 'video').reduce((m, c) => Math.min(m, c.start), Infinity);
  const out = OPS.add_bumper(p, { kind: 'intro', backgroundAssetId: 'bg', logoAssetId: 'logo', duration: 2 }) as any;
  const moved = p.tracks.flatMap((t) => t.clips).filter((c) => c.assetId === 'a').reduce((m, c) => Math.min(m, c.start), Infinity);
  const bgTrack = p.tracks.find((t) => t.name === 'Brand background')!;
  const firstMain = p.tracks.findIndex((t) => t.kind === 'video' && t.clips.some((c) => c.assetId === 'a'));
  ok(moved === firstStart + 2 && out.clipIds.length === 3 && p.tracks.indexOf(bgTrack) < firstMain, `the intro moves the edit by 2s (${firstStart} -> ${moved}) and covers it`);
  const outro = OPS.add_bumper(p, { kind: 'outro', backgroundAssetId: 'bg' }) as any;
  const cta = p.tracks.flatMap((t) => t.clips).find((c) => c.id === outro.clipIds[1]);
  ok(cta?.text === 'Buy now' && Math.abs(outro.start - 14) < 1e-6, `the outro starts at the end with the call to action (${outro.start}, "${cta?.text}")`);
}
{
  // Starters lay out the canvas, the caption look and the titles.
  const p = newProject('s', 1920, 1080, 30);
  applyStarter(p, 'podcast', 'he');
  const cap = p.tracks.find((t) => t.kind === 'caption')!;
  const titles = p.tracks.filter((t) => t.kind === 'text').flatMap((t) => t.clips);
  ok(p.width === 1080 && p.height === 1920 && p.layout === 'stack' && cap.captionPreset === 'night' && titles.length === 2 && titles.some((c) => c.text === 'מנחה'), `podcast starter: ${p.width}x${p.height}, ${p.layout}, ${titles.map((c) => c.text).join(' + ')}`);
}
console.log(fail ? `${fail} FAILED` : 'all passed');
process.exit(fail ? 1 : 0);
