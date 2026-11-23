// MCP server for YUV.AI Studio. Every tool is a thin wrapper over the REST API, so the same code
// serves the built-in HTTP endpoint (/mcp) and the stdio launcher (server/mcp-stdio.ts).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { CAPTION_LANGS, CAPTION_PRESETS, EXPORT_PRESETS, FX_PRESETS, LAYOUTS, SFX, TITLE_PRESETS, TRANSITIONS } from '../shared/presets';

const CAPTION_LANG_IDS = Object.keys(CAPTION_LANGS) as [string, ...string[]];
const VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

/** `remote`: the client reached the studio from the internet, so tools that read files by path are refused. */
export function createMcp(base: string, token = '', source: 'agent' | 'mcp' = 'mcp', remote = false) {
  const api = async (method: string, url: string, body?: any) => {
    const headers: Record<string, string> = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${method} ${url} failed with ${res.status}`);
    return data;
  };
  const waitJob = async (id: string) => {
    for (;;) {
      const job = await api('GET', `/api/jobs/${id}?wait=1`);
      if (job.status === 'done') return job.result;
      if (job.status === 'error') throw new Error(job.error);
    }
  };
  const op = (projectId: string, name: string, args: any) => api('POST', `/api/projects/${projectId}/ops`, { op: name, args });

  const server = new McpServer({ name: 'yuv-studio', version: VERSION }, { instructions: `YUV.AI Studio is a video editor. Times are seconds on the timeline. Tracks are layers: the first track is the top layer. Positions (x, y) are the centre of an item as a fraction of the frame (0.5, 0.5 = centre); scale 1 fits a clip inside the frame. Call get_project to see the timeline before editing. To make the picture move (zoom in on a point, pan, fade) use add_zoom for a ready-made zoom or set_keyframe for full control; moves between keyframes are eased. To use material made elsewhere (AI video or image generators), pass its direct link to import_media_url. To put a clip in between others without overlaps use insert_clip; to change speed use set_speed (it moves the clips after it). For narration use list_voices and speak. The editor UI at ${base} updates live as you edit.` });
  const pid = z.string().describe('Project id, from list_projects or create_project');
  // Tell the open editor what the AI is doing, so it can show it (glow, guided cursor). Never blocks or fails a tool.
  const announce = (projectId: unknown, name: string, args: any, phase: 'start' | 'end', ok?: boolean) => {
    if (typeof projectId !== 'string' || !projectId) return;
    const hint: Record<string, any> = {};
    for (const k of ['clipId', 'trackId', 'assetId', 'start', 'end', 'time', 'preset', 'language', 'presetId', 'mode']) if (args?.[k] != null && typeof args[k] !== 'object') hint[k] = typeof args[k] === 'string' ? String(args[k]).slice(0, 80) : args[k];
    if (Array.isArray(args?.clipIds)) hint.clipIds = args.clipIds.slice(0, 20).map(String);
    if (typeof args?.text === 'string') hint.text = args.text.slice(0, 60);
    api('POST', '/api/activity', { projectId, tool: name, phase, ok, source, hint }).catch(() => {});
  };
  const tool = (name: string, description: string, shape: Record<string, z.ZodTypeAny>, fn: (a: any) => Promise<any>) =>
    server.registerTool(name, { description, inputSchema: shape }, async (args: any) => {
      announce(args?.projectId, name, args, 'start');
      try {
        const out = await fn(args);
        announce(args?.projectId, name, args, 'end', true);
        return { content: [{ type: 'text' as const, text: typeof out === 'string' ? out : JSON.stringify(out, null, 1) }] };
      } catch (e: any) {
        announce(args?.projectId, name, args, 'end', false);
        return { isError: true, content: [{ type: 'text' as const, text: String(e?.message || e) }] };
      }
    });

  tool('list_projects', 'List the projects in the studio.', {}, () => api('GET', '/api/projects'));
  tool(
    'create_project',
    `Create a project. The first video added sets the frame size and frame rate unless you set them here (1920x1080 for 16:9, 1080x1920 for 9:16, 1080x1350 for 4:5, 1080x1080 square). layout arranges the video layers from the start: ${LAYOUTS.map((l) => `${l.id} (${l.label.toLowerCase()})`).join(', ')}. templateId starts from a saved template (list_templates).`,
    { name: z.string(), width: z.number().optional(), height: z.number().optional(), fps: z.number().optional(), layout: z.enum(LAYOUTS.map((l) => l.id) as [string, ...string[]]).optional(), templateId: z.string().optional() },
    (a) => api('POST', '/api/projects', a).then((p) => ({ projectId: p.id, name: p.name, width: p.width, height: p.height, layout: p.layout, editorUrl: `${base}/?project=${p.id}` })),
  );
  tool('list_templates', 'List saved project templates (canvas size, layers, layout, titles, logo) with their ids, for create_project.', {}, () => api('GET', '/api/templates'));
  tool('save_template', 'Save a project as a template: its canvas, layers, layout, titles and logo, without its video, audio or captions. New projects can start from it.', { projectId: pid, name: z.string() }, (a) => api('POST', '/api/templates', a));
  tool('get_project', 'Read the timeline: assets, tracks (top layer first) and every clip with its start and end time.', { projectId: pid }, (a) => api('GET', `/api/projects/${a.projectId}/summary`));
  tool('set_project', 'Change the project name, frame size or frame rate (e.g. 1080x1920 for vertical, fps 60).', { projectId: pid, name: z.string().optional(), width: z.number().optional(), height: z.number().optional(), fps: z.number().optional() }, ({ projectId, ...rest }) => op(projectId, 'set_project', rest));
  tool(
    'import_media',
    'Import a video, audio or image file from this computer by its absolute path. With addToTimeline it is also placed on the timeline (broll: on a layer above the main video, muted).',
    { projectId: pid, path: z.string().describe('Absolute file path'), addToTimeline: z.boolean().optional(), broll: z.boolean().optional(), start: z.number().optional().describe('Timeline time for the clip; default: after the last clip') },
    async (a) => {
      if (remote) throw new Error('Importing by file path works only on the computer itself. Use import_media_url with a direct link, or upload the file in the editor.');
      const asset = await api('POST', `/api/projects/${a.projectId}/assets/import`, { path: a.path });
      const clip = a.addToTimeline || a.broll ? await op(a.projectId, 'add_clip', { assetId: asset.id, broll: a.broll, start: a.start }) : undefined;
      return { asset, clip: clip?.result };
    },
  );
  tool(
    'import_media_url',
    'Download a video, audio or image file from a public https link and add it to the project. Use it to bring in a clip made by another tool (for example a video generated with Higgsfield, or any file an AI tool returned as a link). The link must point at the file itself, not at a web page. With addToTimeline it is also placed on the timeline (broll: on a layer above the main video).',
    { projectId: pid, url: z.string().describe('Direct https link to the media file'), name: z.string().optional().describe('Name shown in the media list'), addToTimeline: z.boolean().optional(), broll: z.boolean().optional(), start: z.number().optional().describe('Timeline time for the clip; default: after the last clip') },
    async ({ projectId, ...rest }) => waitJob((await api('POST', `/api/projects/${projectId}/assets/import-url`, rest)).id),
  );
  tool(
    'add_clip',
    'Put an imported asset on the timeline. Use broll for B-roll or an overlay above the main video; use in/duration to take only part of the source.',
    { projectId: pid, assetId: z.string(), start: z.number().optional(), trackId: z.string().optional(), broll: z.boolean().optional(), in: z.number().optional().describe('Offset into the source, seconds'), duration: z.number().optional() },
    ({ projectId, ...rest }) => op(projectId, 'add_clip', rest),
  );
  tool(
    'add_text',
    `Add a title or text layer. Presets: ${TITLE_PRESETS.map((p) => p.id).join(', ')}. Hebrew and English are both supported.`,
    { projectId: pid, text: z.string(), preset: z.string().optional(), start: z.number(), duration: z.number().optional(), x: z.number().optional(), y: z.number().optional(), scale: z.number().optional(), style: z.record(z.string(), z.any()).optional().describe('Overrides: fontFamily, fontWeight, fontSize, color, bgColor, strokeColor, strokeWidth, animIn, animOut...') },
    ({ projectId, x, y, scale, ...rest }) => op(projectId, 'add_text', { ...rest, transform: { ...(x != null && { x }), ...(y != null && { y }), ...(scale != null && { scale }) } }),
  );
  tool(
    'update_clip',
    `Change a clip. patch fields: start, duration, in, speed (set_speed also moves the clips after it), volume (1 = as recorded, 0..2), muted, fadeIn / fadeOut (audio fade, seconds), text, transform {x,y,scale,rotation,opacity}, fx {brightness,contrast,saturation,blur}, tin / tout {type,duration} (transition in / out: ${TRANSITIONS.map((t) => t.id).join(', ')}), style {...} for text.`,
    { projectId: pid, clipId: z.string(), patch: z.record(z.string(), z.any()) },
    ({ projectId, ...rest }) => op(projectId, 'update_clip', rest),
  );
  tool(
    'add_zoom',
    'Animate a zoom on a video, image or text clip. The picture moves smoothly towards a point and, when `end` is given, back to where it was. scale is how much closer (1.5 = one and a half times; below 1 zooms out). x / y are the point to zoom towards as fractions of the frame (0.5, 0.5 = centre; use the place of a face or of the thing being discussed). Without `end` the clip stays zoomed until it ends; with ramp equal to the clip length it becomes a slow push-in. It writes ordinary keyframes, which get_project shows.',
    { projectId: pid, clipId: z.string(), start: z.number().optional().describe('Timeline time the zoom starts. Default: the start of the clip'), end: z.number().optional().describe('Timeline time the picture is back to normal'), scale: z.number().optional().describe('Default 1.5'), x: z.number().optional(), y: z.number().optional(), ramp: z.number().optional().describe('Seconds each move takes. Default 0.6'), ease: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold']).optional().describe('Default ease-in-out') },
    ({ projectId, ...rest }) => op(projectId, 'add_zoom', rest),
  );
  tool(
    'set_keyframe',
    'Pin how a clip looks at one moment: a keyframe. Between keyframes the clip glides from one to the next, so two keyframes with different scale make a zoom, different x / y make a pan, different opacity a fade. transform fields: x, y (centre, as fractions of the frame), scale (1 = fits the frame), rotation (degrees), opacity (0..1); fields left out keep what the clip shows at that time. ease shapes the move that ARRIVES at this keyframe: ease-in-out (smooth, the default), ease-in, ease-out, linear, or hold (stay, then jump). Calling it again at the same time changes that keyframe.',
    { projectId: pid, clipId: z.string(), time: z.number().describe('Timeline time, seconds'), transform: z.object({ x: z.number().optional(), y: z.number().optional(), scale: z.number().optional(), rotation: z.number().optional(), opacity: z.number().optional() }).optional(), ease: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold']).optional() },
    ({ projectId, ...rest }) => op(projectId, 'set_keyframe', rest),
  );
  tool('remove_keyframes', 'Remove the keyframe at a timeline time, or all the animation of a clip when no time is given. The clip keeps the look of its first keyframe.', { projectId: pid, clipId: z.string(), time: z.number().optional() }, ({ projectId, ...rest }) => op(projectId, 'remove_keyframes', rest));
  tool('move_clip', 'Move a clip to a new start time, optionally to another track of the same kind.', { projectId: pid, clipId: z.string(), start: z.number(), trackId: z.string().optional() }, ({ projectId, ...rest }) => op(projectId, 'move_clip', rest));
  tool(
    'insert_clip',
    'Put a clip in between others, the way dragging does in the editor: it goes in at `start` and the clips from there on move right to make room, so nothing overlaps. If `start` falls inside another clip, it goes before it (first half) or after it (second half). With ripple (default) the gap the clip left behind closes. trackId moves it to another layer of the same kind. Works for video, audio, caption and title clips. Use move_clip instead to place a clip freely, overlaps allowed.',
    { projectId: pid, clipId: z.string(), start: z.number().describe('Timeline time to put it in at'), trackId: z.string().optional(), ripple: z.boolean().optional() },
    ({ projectId, ...rest }) => op(projectId, 'insert_clip', rest),
  );
  tool(
    'set_speed',
    'Change the speed of a video or audio clip: 0.5 is half speed (twice as long), 2 is double speed; 0.1 to 8. It keeps the same piece of the source, so the clip gets longer or shorter. Slower pushes the clips after it on its layer right so nothing overlaps; faster, with ripple (default), pulls them in. Keyframes stretch with the clip.',
    { projectId: pid, clipId: z.string(), speed: z.number(), ripple: z.boolean().optional() },
    ({ projectId, ...rest }) => op(projectId, 'set_speed', rest),
  );
  tool(
    'detach_audio',
    'Split the sound of a video clip off onto an audio layer as its own clip, at the same time, and mute the video clip. Then the sound can be moved, trimmed, faded or sped up on its own. Returns the new audio clip.',
    { projectId: pid, clipId: z.string() },
    ({ projectId, ...rest }) => op(projectId, 'detach_audio', rest),
  );
  tool(
    'duplicate_clip',
    'Copy a clip with all its settings (transform, keyframes, looks, speed, fades) and put the copy right after it on the same layer, in the first free space.',
    { projectId: pid, clipId: z.string() },
    ({ projectId, ...rest }) => op(projectId, 'duplicate_clip', rest),
  );
  tool(
    'move_clip_to_new_track',
    "Move a clip onto a new layer of its kind, made above the top layer of that kind ('above', e.g. to overlay it) or below the lowest one ('below'). start moves it in time as well.",
    { projectId: pid, clipId: z.string(), where: z.enum(['above', 'below']), start: z.number().optional() },
    ({ projectId, ...rest }) => op(projectId, 'move_clip_to_new_track', rest),
  );
  tool(
    'apply_layout',
    `Arrange the video layers on the frame: ${LAYOUTS.map((l) => `${l.id} (${l.label.toLowerCase()})`).join(', ')}. The top video layer gets the first place, the next layer the second (in pip the top layer is the small picture, the next one the full frame). Clips on those layers are fitted in, and clips added to them later too; animated clips keep their own motion. 'single' puts everything back full frame. Add layers first if needed; missing video layers are made.`,
    { projectId: pid, layout: z.enum(LAYOUTS.map((l) => l.id) as [string, ...string[]]) },
    ({ projectId, ...rest }) => op(projectId, 'apply_layout', rest),
  );
  tool(
    'set_watermark',
    "Put a logo on every frame of the export (and the preview). assetId is an image already in the project (import_media first; a PNG with a transparent background works best). corner: tl, tr, bl or br (default br). size is its width as a fraction of the frame width (default 0.14), opacity 0..1 (default 0.85), margin from the edges as a fraction (default 0.035). Called again it changes only what is given. remove: true takes the logo off.",
    { projectId: pid, assetId: z.string().optional(), corner: z.enum(['tl', 'tr', 'bl', 'br']).optional(), size: z.number().optional(), opacity: z.number().optional(), margin: z.number().optional(), remove: z.boolean().optional() },
    ({ projectId, ...rest }) => op(projectId, 'set_watermark', rest),
  );
  tool(
    'reshape_project',
    'Change the frame shape and lay the picture out again, e.g. a horizontal recording into a 9:16 reel (1080x1920) or back to 16:9 (1920x1080). Full-frame video and image clips are re-fitted: fill (default) covers the frame and crops the sides, fit shows the whole picture. Captions stay inside the new frame. Prefer this over exporting with a preset of another shape, which crops the finished frame and can cut captions.',
    { projectId: pid, width: z.number(), height: z.number(), mode: z.enum(['fill', 'fit']).optional() },
    ({ projectId, ...rest }) => op(projectId, 'reshape', rest),
  );
  tool(
    'set_blend',
    "How a video or image clip mixes with the layers under it: normal, screen (black disappears, only the light stays: light leaks, dust, flares, film burns on black), lighten, multiply (white disappears: paper, texture, shade) or overlay (adds contrast: grain, textures). Works in the preview and the export.",
    { projectId: pid, clipId: z.string(), blend: z.enum(['normal', 'screen', 'lighten', 'multiply', 'overlay']) },
    ({ projectId, ...rest }) => op(projectId, 'set_blend', rest),
  );
  tool(
    'move_keyframe',
    'Move one keyframe of a clip to another moment, keeping its values. from and to are timeline times in seconds; get_project lists the keyframes (t is seconds from the clip start). Fails if another keyframe is already at the new time.',
    { projectId: pid, clipId: z.string(), from: z.number(), to: z.number() },
    ({ projectId, ...rest }) => op(projectId, 'move_keyframe', rest),
  );
  tool(
    'search_stock',
    'Search free stock media to use in the video: kind video (B-roll, overlays such as "light leak", "film grain", "dust particles"), image or audio (music and sound effects). Sources: openverse (images and audio, no key, CC licences: keep the credit), pexels and pixabay (video and images, need a free key the user enters in the Stock tab; no credit needed). Returns items with url, size, duration, licence and credit; pass one to add_stock.',
    { source: z.enum(['openverse', 'pexels', 'pixabay']), kind: z.enum(['video', 'image', 'audio']), query: z.string().describe('In English works best, e.g. "city night", "ocean drone", "whoosh"'), page: z.number().optional() },
    async (a) => {
      const r = await api('GET', `/api/stock/search?${new URLSearchParams({ source: a.source, kind: a.kind, q: a.query, page: String(a.page || 1) })}`);
      return r.items.slice(0, 16).map((i: any) => ({ url: i.url, title: i.title, kind: i.kind, width: i.width, height: i.height, duration: i.duration, license: i.license, credit: i.credit || undefined, page: i.pageUrl, source: i.source }));
    },
  );
  tool(
    'add_stock',
    "Download a stock item found with search_stock into the project. as 'broll' puts it on a layer above the main video at `start`; 'overlay' puts it over the whole frame on a new top layer with the screen blend (for light leaks, grain, dust...); 'media' only adds it to the media list. The licence and credit are kept with the file (the editor can copy all credits for the video description). Waits until the download ends.",
    { projectId: pid, url: z.string(), title: z.string().optional(), as: z.enum(['media', 'broll', 'overlay']).optional(), start: z.number().optional(), source: z.string().optional().describe('openverse, pexels or pixabay'), license: z.string().optional(), credit: z.string().optional(), page: z.string().optional().describe('The page of the item on its site') },
    async ({ projectId, url, title, as, start, source, license, credit, page }) =>
      waitJob(
        (
          await api('POST', `/api/projects/${projectId}/assets/import-url`, {
            url,
            name: title,
            start,
            broll: as === 'broll',
            addToTimeline: as === 'broll',
            overlay: as === 'overlay',
            source: { name: source || '', url: page || '', license: license || '', credit: credit || '' },
          })
        ).id,
      ),
  );
  tool('trim_clip',"Trim the start or the end of a clip to a timeline time (edge 'start' cuts the beginning, 'end' cuts the end).", { projectId: pid, clipId: z.string(), edge: z.enum(['start', 'end']), time: z.number() }, ({ projectId, ...rest }) => op(projectId, 'trim_clip', rest));
  tool('split', 'Split clips at a timeline time. Without clipId every clip under that time is split.', { projectId: pid, time: z.number(), clipId: z.string().optional() }, ({ projectId, ...rest }) => op(projectId, 'split', rest));
  tool('delete_clips', 'Delete clips. With ripple (default) the clips after them move left to close the gap.', { projectId: pid, clipIds: z.array(z.string()), ripple: z.boolean().optional() }, ({ projectId, ...rest }) => op(projectId, 'delete_clips', rest));
  tool(
    'cut_range',
    'Remove a time range from the whole timeline (all tracks) and close the gap. This is the tool for cutting out a mistake or a boring part. When making several cuts, go from the end of the timeline to the start so earlier times stay valid.',
    { projectId: pid, start: z.number(), end: z.number() },
    ({ projectId, ...rest }) => op(projectId, 'cut_range', rest),
  );
  tool(
    'remove_silences',
    'Find silent pauses and cut them out. dryRun only lists the ranges.',
    { projectId: pid, thresholdDb: z.number().optional().describe('Default -34'), minSilence: z.number().optional().describe('Shortest pause to cut, seconds. Default 0.6'), padding: z.number().optional().describe('Silence kept around speech, seconds. Default 0.12'), dryRun: z.boolean().optional() },
    ({ projectId, ...rest }) => api('POST', `/api/projects/${projectId}/remove-silences`, rest),
  );
  tool('add_track', 'Add a layer. Video tracks hold video and images, text tracks hold titles.', { projectId: pid, kind: z.enum(['video', 'audio', 'text', 'caption']), name: z.string().optional() }, ({ projectId, ...rest }) => op(projectId, 'add_track', rest));
  tool('remove_track', 'Delete a layer and its clips.', { projectId: pid, trackId: z.string() }, ({ projectId, ...rest }) => op(projectId, 'remove_track', rest));
  tool('update_track', 'Rename, mute or hide a track. patch: { name, muted, hidden }.', { projectId: pid, trackId: z.string(), patch: z.record(z.string(), z.any()) }, ({ projectId, ...rest }) => op(projectId, 'update_track', rest));
  tool(
    'get_transcript',
    'Transcribe the speech on the timeline (Hebrew or English) and return it as lines with timeline times. Use it to decide what to cut. The first call for a file takes a while.',
    { projectId: pid, language: z.enum(['he', 'en', 'auto']), engine: z.enum(['auto', 'local', 'cloud']).optional().describe('local = Whisper on this computer, cloud = the configured API. Default: the studio setting') },
    async ({ projectId, ...rest }) => waitJob((await api('POST', `/api/projects/${projectId}/timeline-transcript`, rest)).id),
  );
  tool(
    'generate_captions',
    `Transcribe and build the caption track. Captions follow every cut already made. language is the language SPOKEN in the video. translateTo shows the captions in another language (e.g. Hebrew speech with English captions): the speech is transcribed, then the text is translated by the model set in the studio's AI agent tab, keeping every caption's timing. Caption languages: ${CAPTION_LANG_IDS.join(', ')}. Presets: ${CAPTION_PRESETS.map((p) => p.id).join(', ')}.`,
    { projectId: pid, language: z.enum(['he', 'en', 'auto']), translateTo: z.enum(CAPTION_LANG_IDS).optional().describe('Language of the captions, when it differs from the speech'), preset: z.string().optional(), maxWords: z.number().optional(), maxChars: z.number().optional(), engine: z.enum(['auto', 'local', 'cloud']).optional(), force: z.boolean().optional().describe('Transcribe again instead of using the saved transcript') },
    async ({ projectId, ...rest }) => waitJob((await api('POST', `/api/projects/${projectId}/captions`, rest)).id),
  );
  tool(
    'set_caption_style',
    'Restyle or reposition all captions. transform: {x, y, scale}. style overrides: fontFamily, fontSize, color, highlight (none|color|box|reveal), highlightColor...',
    { projectId: pid, preset: z.string().optional(), style: z.record(z.string(), z.any()).optional(), transform: z.record(z.string(), z.any()).optional() },
    ({ projectId, ...rest }) => op(projectId, 'set_caption_style', rest),
  );
  tool(
    'translate_captions',
    `Translate the captions that are already on the timeline (for example after proofreading them) into another language, keeping every caption's timing and style. Uses the model set in the studio's AI agent tab. keepOriginal puts the translation on a new caption layer just above the original, for captions in two languages; without it the text is replaced. Languages: ${CAPTION_LANG_IDS.join(', ')}. Waits until done.`,
    { projectId: pid, to: z.enum(CAPTION_LANG_IDS), keepOriginal: z.boolean().optional(), trackId: z.string().optional().describe('Caption track to translate; default the first one with captions') },
    async ({ projectId, ...rest }) => waitJob((await api('POST', `/api/projects/${projectId}/captions/translate`, rest)).id),
  );
  tool('get_captions','List every caption with its id, start, end and text. Use it to proofread the transcription.', { projectId: pid }, (a) => api('GET', `/api/projects/${a.projectId}/captions`));
  tool('edit_caption', 'Correct the text of one caption. Word timings are kept when the number of words stays the same.', { projectId: pid, clipId: z.string(), text: z.string() }, (a) => op(a.projectId, 'update_clip', { clipId: a.clipId, patch: { text: a.text } }));
  tool('replace_in_captions', 'Replace a word or phrase in all captions at once, e.g. a name the transcription keeps getting wrong.', { projectId: pid, find: z.string(), replace: z.string() }, ({ projectId, ...rest }) => op(projectId, 'replace_in_captions', rest));
  tool('add_caption', 'Add a caption by hand at a timeline time.', { projectId: pid, start: z.number(), text: z.string(), duration: z.number().optional() }, ({ projectId, ...rest }) => op(projectId, 'add_caption', rest));
  tool('merge_captions', 'Join a caption with the one after it.', { projectId: pid, clipId: z.string() }, ({ projectId, ...rest }) => op(projectId, 'merge_captions', rest));
  tool('add_sfx', `Add a built-in sound effect at a timeline time. Sounds: ${SFX.map((s) => s.id).join(', ')}.`, { projectId: pid, sfx: z.string(), start: z.number(), volume: z.number().optional() }, ({ projectId, ...rest }) => api('POST', `/api/projects/${projectId}/sfx`, rest));
  tool(
    'list_voices',
    'List text-to-speech voices (Cartesia). mine = only the voices of this account, including cloned ones. Returns id, name, language and gender. Use the id with speak.',
    { q: z.string().optional().describe('Search by name or description'), language: z.string().optional().describe('Language code, e.g. he, en'), mine: z.boolean().optional() },
    (a) => api('GET', `/api/voice/voices?${new URLSearchParams({ ...(a.q ? { q: a.q } : {}), ...(a.language ? { language: a.language } : {}), ...(a.mine ? { mine: '1' } : {}) })}`),
  );
  tool(
    'speak',
    'Turn text into speech (narration / voice-over) with Cartesia and add it to the project as an audio clip. Hebrew and English are detected from the text unless language is given. Without voiceId the last voice used in the studio is used. With start the clip is placed on the timeline at that time; without it the audio is only added to the media list. Each call uses Cartesia credits.',
    { projectId: pid, text: z.string(), voiceId: z.string().optional(), language: z.string().optional().describe('he, en, ... or auto (default)'), start: z.number().optional().describe('Timeline time in seconds'), speed: z.number().optional().describe('0.6 to 1.5, default 1'), emotion: z.string().optional().describe('e.g. neutral, calm, excited, happy, sad, angry') },
    ({ projectId, ...rest }) => api('POST', `/api/projects/${projectId}/speak`, rest),
  );
  tool(
    'clone_voice',
    'Create a new Cartesia voice from speech that is already in the project: a timeline clip (clipId) or part of an asset (assetId, from, duration). Needs 3 to 30 seconds of one person speaking clearly. Only clone a voice the user has the right to use. Returns the new voice id, which also becomes the default voice for speak.',
    { projectId: pid, name: z.string().describe('Name for the new voice'), language: z.string().optional().describe('Language the voice speaks, e.g. he or en. Default he'), clipId: z.string().optional(), assetId: z.string().optional(), from: z.number().optional().describe('Offset into the asset, seconds'), duration: z.number().optional() },
    ({ projectId, ...rest }) => api('POST', `/api/projects/${projectId}/clone-voice`, rest),
  );
  tool('list_presets', 'List caption styles, title styles, transitions, effects (looks) and sound effects.', {}, async () => ({
    captionPresets: CAPTION_PRESETS.map((p) => p.id),
    titlePresets: TITLE_PRESETS.map((p) => p.id),
    transitions: TRANSITIONS.map((t) => t.id),
    fxPresets: FX_PRESETS.map((f) => ({ id: f.id, fx: f.fx })),
    sfx: SFX.map((s) => s.id),
  }));
  tool(
    'export',
    `Render the timeline to an MP4 file (H.264 + AAC, at the project frame rate, up to 60 fps). Waits until the file is ready and returns its path. preset sizes it for a platform: ${EXPORT_PRESETS.map((x) => `${x.id} (${x.width}x${x.height})`).join(', ')}; a preset of another shape than the project reframes it: reframe 'fit' keeps the whole picture over a blurred copy, 'fill' crops the middle.`,
    { projectId: pid, preset: z.enum(EXPORT_PRESETS.map((x) => x.id) as [string, ...string[]]).optional(), reframe: z.enum(['fit', 'fill']).optional(), quality: z.enum(['high', 'medium', 'draft']).optional(), height: z.number().optional().describe('Output height, e.g. 720'), fps: z.number().optional(), start: z.number().optional(), end: z.number().optional(), filename: z.string().optional() },
    async ({ projectId, ...rest }) => waitJob((await api('POST', `/api/projects/${projectId}/export`, rest)).id),
  );
  tool('get_job', 'Check a background job (export, transcription).', { jobId: z.string() }, (a) => api('GET', `/api/jobs/${a.jobId}`));
  return server;
}
