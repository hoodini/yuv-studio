# REST API

Base address: `http://127.0.0.1:5177`. Bodies and answers are JSON. Errors come back as `{ "error": "..." }` with a 4xx status.

From the same machine no authentication is needed. Through a public address every request needs `Authorization: Bearer <token>` (see [REMOTE.md](REMOTE.md)).

## Projects

| | |
|---|---|
| `GET /api/projects` | List |
| `POST /api/projects` | Create. Body: `{ name, width?, height?, fps? }` |
| `GET /api/projects/:id` | The full project |
| `GET /api/projects/:id/summary` | A compact timeline, the best starting point for an agent |
| `PUT /api/projects/:id` | Replace the timeline (what the editor does when it saves) |
| `DELETE /api/projects/:id` | Delete |

## Media

| | |
|---|---|
| `POST /api/projects/:id/assets` | Upload, multipart field `files` (one request: over a Cloudflare tunnel, 100 MB at most; use the resumable upload below for larger files) |
| `POST /api/projects/:id/uploads` | `{ name, size }`: start a resumable upload. Returns `{ uploadId, chunkSize, received }` |
| `PUT /api/uploads/:uid?offset=N` | Raw bytes of the next piece (at most `chunkSize`, 8 MB). `N` must equal what already arrived, or the answer is 409 |
| `GET /api/uploads/:uid` | `{ received, size }`: where to continue after a dropped connection |
| `POST /api/uploads/:uid/complete` | Import the finished file; returns the asset. `DELETE /api/uploads/:uid` cancels |
| `POST /api/projects/:id/assets/import` | `{ path }`: use a file already on the machine |
| `POST /api/projects/:id/assets/import-url` | `{ url, addToTimeline?, broll?, start? }`: download a file from a public link. Returns a job |
| `GET /api/projects/:id/assets/:assetId/file` | The media file (supports ranges) |
| `GET /api/projects/:id/assets/:assetId/thumb/:i` | Filmstrip picture |
| `GET /api/projects/:id/assets/:assetId/peaks` | Waveform, 50 peaks per second |

## Edit operations

`POST /api/projects/:id/ops` runs one operation, `{ "op": "...", "args": { ... } }`, or several in order, `{ "ops": [ ... ] }`. A batch is all or nothing: if one operation fails, none is saved.

| op | args |
|---|---|
| `set_project` | `name?`, `width?`, `height?`, `fps?` |
| `add_track` | `kind` (`video`, `audio`, `text`, `caption`), `name?` |
| `remove_track` | `trackId` |
| `update_track` | `trackId`, `patch` (`name`, `muted`, `hidden`, `index` to move the layer) |
| `move_track` | `trackId`, `index` (0 = the top layer) |
| `add_clip` | `assetId`, `start?`, `trackId?`, `broll?`, `in?`, `duration?` |
| `add_text` | `text`, `preset?`, `start`, `duration?`, `style?`, `transform?` |
| `update_clip` | `clipId`, `patch` (see below) |
| `add_zoom` | `clipId`, `start?`, `end?`, `scale?` (1.5), `x?`, `y?` (the point to zoom towards), `ramp?` (0.6 s), `ease?` |
| `set_keyframe` | `clipId`, `time`, `transform?` (`x`, `y`, `scale`, `rotation`, `opacity`), `ease?` (`linear`, `ease-in`, `ease-out`, `ease-in-out`, `hold`) |
| `remove_keyframes` | `clipId`, `time?` (without it, every keyframe of the clip) |
| `move_clip` | `clipId`, `start`, `trackId?` |
| `trim_clip` | `clipId`, `edge` (`start` or `end`), `time` |
| `split` | `time`, `clipId?` (without it, every clip under that time) |
| `delete_clips` | `clipIds`, `ripple?` (default true) |
| `cut_range` | `start`, `end`, `trackIds?` |
| `duplicate_clip` | `clipId` |
| `set_caption_style` | `preset?`, `style?`, `transform?` |
| `add_caption` | `start`, `text`, `duration?` |
| `merge_captions` | `clipId` (joined with the next caption) |
| `replace_in_captions` | `find`, `replace` |
| `remove_asset` | `assetId` |

`update_clip` patch fields: `start`, `duration`, `in`, `speed`, `volume`, `muted`, `text`, `transform { x, y, scale, rotation, opacity }`, `fx { brightness, contrast, saturation, blur }`, `tin` / `tout` `{ type, duration }`, `style { ... }`.

A clip may also carry `keyframes`: a list of `{ t, x, y, scale, rotation, opacity, ease }` with `t` in seconds from the start of the clip. While a clip has keyframes they replace its `transform`; `ease` shapes the move that arrives at that keyframe. `update_clip` accepts a whole `keyframes` list in its patch (an empty list removes the motion).

Transition types: `none`, `fade`, `dip`, `flash`, `blur`, `zoom`, `zoom-out`, `spin`, `slide-left`, `slide-right`, `slide-up`, `slide-down`, `wipe-left`, `wipe-right`, `wipe-up`, `wipe-down`.

```bash
curl -X POST http://127.0.0.1:5177/api/projects/<id>/ops -H "content-type: application/json" -d '{"op":"cut_range","args":{"start":12.4,"end":15.1}}'
```

## Captions and transcription

| | |
|---|---|
| `POST /api/projects/:id/captions` | Build the caption track. `{ language: he\|en\|auto, translateTo?: he\|en\|es\|fr\|de\|it\|pt\|ru, engine?: auto\|local\|cloud, preset?, maxWords?, maxChars?, force? }`. `language` is the spoken language; `translateTo` translates the captions with the AI agent tab's model. Returns a job |
| `POST /api/projects/:id/captions/translate` | Translate the existing captions, keeping their times. `{ to, keepOriginal?, trackId? }`; `keepOriginal` puts the translation on a new caption layer above the original. Returns a job |
| `GET /api/stock/status` | Stock sources, what each has, and whether its key is set (never the key) |
| `GET /api/stock/search` | `?source=openverse\|pexels\|pixabay&kind=video\|image\|audio&q=&page=` -> `{ items: [{ url, thumb, preview, width, height, duration, license, credit, pageUrl, creator }] }` |
| `PUT /api/stock/keys` | `{ pexelsKey?, pixabayKey? }`; stored on this machine |
| `POST /api/projects/:id/assets/import-url` | Also takes `overlay: true` (add as an overlay) and `source: { name, url, license, credit }` (kept with the asset) |
| `GET /api/caption-languages` | The languages captions can be translated into |
| `GET /api/projects/:id/captions` | `[{ id, start, end, text }]` |
| `GET /api/projects/:id/captions.srt` | Subtitle file |
| `POST /api/projects/:id/timeline-transcript` | `{ language, engine? }`. Job result: lines with timeline times |
| `POST /api/projects/:id/transcribe` | `{ assetId, language, engine?, force? }`. Job result: word timings of one source file |
| `GET /api/settings`, `PUT /api/settings` | Transcription engine and provider. The API key can be written, never read |

## Voice

Text to speech and voice cloning through Cartesia: see [VOICE.md](VOICE.md) for the endpoints.

## Other

| | |
|---|---|
| `POST /api/projects/:id/remove-silences` | `{ thresholdDb?, minSilence?, padding?, dryRun? }` |
| `POST /api/projects/:id/words` | `{ language?, aggressive? }`: a job; its result is `{ words: [{ i, t0, t1, text, filler? }], fillers }` (timeline times) |
| `POST /api/projects/:id/cut-words` | `{ indices, language? }`: a job that cuts those words (indices from `/words`) and the pause after each |
| `POST /api/projects/:id/remove-fillers` | `{ language?, aggressive?, dryRun? }`: a job; cuts hesitations and stutters (and soft fillers with `aggressive`) |
| `POST /api/projects/:id/assets/:aid/enhance-voice` | `{ strength?: 'light' \| 'strong' }`: a job; a cleaned copy of the file replaces it on the timeline |
| `POST /api/projects/:id/clips/:cid/remove-background` | `{ background?: 'none' \| 'blur' \| 'original', text?, quality?: 'quality' \| 'fast' }`: a job; the clip becomes a transparent VP9 WebM; `blur` / `original` put the original on a new layer below, `text` (with `original`) adds a title between them |
| `POST /api/projects/:id/reframe` | `{ width?, height? }` (default 1080x1920): a job; reshapes the project and adds keyframes that follow the face |
| `POST /api/projects/:id/find-shorts` | `{ count?, minSec?, maxSec?, language? }`: a job; uses the AI agent tab's model; result `{ clips: [{ start, end, title, hook, reason }] }` |
| `POST /api/projects/:id/make-short` | `{ start, end, title?, width?, height?, reframe? }`: a job; result `{ projectId, editorUrl }` |
| `POST /api/projects/:id/sfx` | `{ sfx, start, volume? }` |
| `POST /api/projects/:id/export` | `{ quality?: high\|medium\|draft, height?, fps?, start?, end?, filename? }`. Returns a job |
| `GET /api/presets` | Caption styles, title styles, transitions, looks, sounds |
| `GET /api/jobs/:id` | Job state. Add `?wait=1` to hold the request until it finishes (up to 25 s) |
| `GET /api/events` | Server-sent events: `project` (something changed), `job` (progress) and `activity` (what an AI is doing) |
| `POST /api/activity` | `{ projectId, tool, phase: start\|end, ok?, source: agent\|mcp, hint? }`. Announces an AI step to the open editors (glow, guided cursor). The MCP tools send it themselves; `hint` keeps only short strings, numbers and id lists |
| `GET /exports/:file` | A finished export |

## Jobs

Transcription and export run in the background and return a job at once:

```json
{ "id": "j_ab12cd34", "kind": "export", "status": "running", "progress": 0.42, "message": "Encoding" }
```

Poll `GET /api/jobs/:id?wait=1` until `status` is `done` (the outcome is in `result`) or `error`.

## A whole edit from the shell

```bash
B=http://127.0.0.1:5177
J='-H content-type:application/json'
P=$(curl -s -X POST $B/api/projects $J -d '{"name":"Talk"}' | jq -r .id)
A=$(curl -s -X POST $B/api/projects/$P/assets/import $J -d '{"path":"C:/Videos/talk.mp4"}' | jq -r .id)
curl -s -X POST $B/api/projects/$P/ops $J -d "{\"ops\":[{\"op\":\"add_clip\",\"args\":{\"assetId\":\"$A\"}},{\"op\":\"cut_range\",\"args\":{\"start\":0,\"end\":2.5}}]}"
JOB=$(curl -s -X POST $B/api/projects/$P/captions $J -d '{"language":"he","preset":"marker"}' | jq -r .id)
until curl -s "$B/api/jobs/$JOB?wait=1" | jq -e '.status != "running"' > /dev/null; do :; done
JOB=$(curl -s -X POST $B/api/projects/$P/export $J -d '{"quality":"high"}' | jq -r .id)
until curl -s "$B/api/jobs/$JOB?wait=1" | jq -e '.status != "running"' > /dev/null; do :; done
curl -s $B/api/jobs/$JOB | jq -r .result.file
```

## Fonts

| Method | Path | Body | What it does |
|---|---|---|---|
| GET | `/api/fonts` | | The fonts you added: family, source (`upload` or `google`), weights |
| POST | `/api/fonts` | multipart `file` (TTF, OTF, WOFF, WOFF2), `family?`, `weight?`, `style?` | Install a font file |
| POST | `/api/fonts/google` | `family` | Download a family from Google Fonts (Hebrew and Latin subsets) and keep it on disk |
| DELETE | `/api/fonts/:family` | | Remove a font |
| GET | `/api/fonts.css` | | One stylesheet with every added font, used by the editor and the export renderer |

`PUT /api/settings` with `defaultFont` sets the font new titles start with.

## Export presets

`POST /api/projects/:id/export` takes `preset` (one of `youtube`, `youtube-4k`, `shorts`, `reels`, `tiktok`, `ig-post`, `square`, `x`, `linkedin`): it sets the output size, frame rate and a bitrate ceiling. When the preset has another shape than the project, `reframe` decides how: `fit` (default) keeps the whole picture over a blurred copy of itself, `fill` crops the middle.

## AI agent

See [AGENT.md](AGENT.md).

## Layers, layouts, logo, audio (operations)

These go through `POST /api/projects/:id/ops` like the others (they are not separate MCP tools):

| op | args | What it does |
|---|---|---|
| `move_clip_to_new_track` | `clipId`, `where` (`above` / `below`), `start?` | Makes a new layer above the top layer (or below the lowest) of the clip's kind and moves the clip onto it |
| `move_keyframe` | `clipId`, `from`, `to` | Moves one keyframe (timeline times); `{ moved: false }` when another keyframe is already there |
| `set_blend` | `clipId`, `blend` | `normal`, `screen`, `lighten`, `multiply`, `overlay` (video and image clips) |
| `reshape` | `width`, `height`, `mode?` | Change the frame shape and re-fit full-frame video and image clips: `fill` (default, crops) or `fit` |
| `add_overlay` | `assetId`, `start?`, `duration?`, `blend?` | A new top video layer, the clip filling the frame, muted, `screen` by default |
| `insert_clip` | `clipId`, `start`, `trackId?`, `ripple?`, `from?` | Puts a clip in at `start` and moves the clips from there on right to make room (inside another clip: before or after it) |
| `set_speed` | `clipId`, `speed`, `ripple?` | Changes speed; slower pushes the clips after it right, faster pulls them in |
| `detach_audio` | `clipId` | Puts a video clip's sound on an audio layer as its own clip and mutes the video clip |
| `apply_layout` | `layout` (`single`, `stack`, `side`, `pip`) | Gives the top video layers the layout's slots and fits their clips in |
| `set_watermark` | `assetId`, `corner` (`tl`, `tr`, `bl`, `br`), `size`, `opacity`, `margin`, or `remove: true` | The logo stamped on every frame of the export |

`update_clip` takes `fadeIn` and `fadeOut` (audio fades, seconds).

`POST /api/projects` takes `width` and `height` (the size then stays, whatever video comes first), `layout`, or `templateId`.

## Templates

| Method | Path | Body | What it does |
|---|---|---|---|
| GET | `/api/templates` | | Saved templates |
| POST | `/api/templates` | `projectId`, `name` | Save a project's canvas, layers, layout, titles and logo as a template |
| DELETE | `/api/templates/:id` | | Delete a template |

Exports run one at a time; several at once wait in a queue. Each file is named after the project, the preset and the time, and never replaces an earlier one.

