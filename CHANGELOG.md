# What's new

## Unreleased

**Smart tools** (a new **Smart** tab, and 7 new MCP tools: 58 in all)

- **Edit by text:** the transcript as words. Click a word to jump to it, select words and delete them, and they are cut from the video with the pause after them. Captions follow. MCP: `get_words`, `cut_words`.
- **Remove filler words** in Hebrew and English: hesitations ("um", "uh", "אה", "אממ") and stutters ("I I", "אני אני"), never a deliberate "very very". Extended mode also takes soft fillers ("basically", "you know", "כאילו", "בעצם"). It uses a word-for-word transcription, since Whisper normally leaves fillers out. MCP: `remove_fillers`.
- **Shorts from a long video:** the AI reads the transcript and picks the moments that stand alone, each with a title, its hook and why it works; one click makes a new vertical project from it. MCP: `find_shorts`, `make_short`.
- **Vertical, following the face:** reframes to 9:16, 4:5 or 1:1 and adds keyframes that follow the speaker like a camera operator (OpenCV face detection, smoothed, with a dead zone so it does not jitter). MCP: `auto_reframe`.
- **Clean voice:** noise and hum reduction, levelling and loudness in one step (ffmpeg); the cleaned copy replaces the original on the timeline and keeps its transcripts. MCP: `enhance_voice`.
- Cutting several ranges never leaves a sliver of a frame or two between them: cut edges snap to nearby clip edges and nearly-touching cuts join.

**Open source**

- YUV.AI Studio is now free and open-source software under the GNU AGPL v3.0, with a commercial license for companies that need other terms. See LICENSE, CLA.md (for contributors) and TRADEMARK.md (the name and logo stay trademarks).
- Without the brand files, the studio shows a neutral mark, hides the author's portrait, and opens the editor at `/` instead of the home page.

## 0.6.0 · 22 November 2026

**Watch the AI edit**

- While the AI edits, a living cyan-violet glow runs around the frame, and a status line says what it is doing ("Adding captions", "Removing silences").
- A cursor with a label flies to the part of the editor each step changes (the clip, the captions, the frame, the export button) and "clicks" it; the playhead jumps to where the change is, and the clips that changed shimmer for a moment.
- It works for the in-editor agent and for any MCP client (Claude Code, the Claude app): the editing still happens through the studio's tools, this only shows it.

**Sound and play on the picture**

- Hover the picture for a play button, mute and a volume slider; the same mute and volume sit in the bar under the picture, and `M` mutes. It is the preview's volume only: the project and the export are not changed. It is remembered.

**Uploads you can see**

- The desktop editor shows every upload: the file, the percent, MB sent, speed, time left, a cancel button, and "Preparing" while thumbnails and the waveform are made.
- On the phone, a picked video is shown first (playable, with its name, length and size) and uploads only after **Upload and edit**; **Choose another file** and **Cancel** are next to it.

**Security**

- The studio can no longer be shown inside another site's frame (clickjacking), and every answer carries `nosniff`, a referrer policy and an opener policy.
- Uploaded files keep only a media extension, and files are served with a sandbox policy, so a file that is secretly a web page can never run script on the studio's address.
- A saved speech-to-text key is forgotten when the provider or the custom address changes, so it can never be pointed at another server.
- Import by file path refuses network paths (`\\server\share`) and is refused from the internet (phone, remote MCP): upload instead.
- Wrong-token lockout counts per address as well as for the whole server, so one stranger cannot lock the owner out.

**For agents:** `POST /api/activity` and the SSE event `activity` carry what an AI is doing (the tool name and small hints such as a clip id, never content); the MCP tools announce themselves.

## 0.5.0 · 19 November 2026

**The studio on your phone**

- Open the studio on a phone and it opens in **mobile mode**: one big "New video" button, your recent projects, Hebrew or English. `?m=1` opens it anywhere; "Full editor" goes back to the desktop editor and remembers it.
- **Upload from the gallery**, in 8 MB pieces with a progress bar. It resumes after the signal drops, and it is not limited by Cloudflare's 100 MB per request, so long 4K clips upload too.
- **Captions on the phone:** pick the spoken language and the caption language (with translation), make captions, cut the silences, tap any line to fix it, translate, download the SRT.
- **Style:** the caption looks as tiles, applied to the preview right away.
- **The AI agent** chat is a tab away.
- **Export** for Reels, TikTok, Shorts, YouTube or square, then download or share from the phone. A horizontal video sent to a 9:16 destination is reshaped first, so the preview shows exactly what comes out and the captions stay inside the frame.
- **Install it** to the home screen from the browser menu (an app with the phoenix icon). On Android, share a video from the gallery straight to "YUV Studio".
- The work still runs on the computer that hosts the studio (Whisper, ffmpeg, the GPU); the phone is the remote. To reach it from outside, see [docs/REMOTE.md](docs/REMOTE.md).

**For everyone**

- Uploads in the desktop editor use the same resumable pieces, so files over 100 MB upload through a Cloudflare tunnel.

**For agents:** `reshape_project` (51 MCP tools) changes the frame shape and re-fits the picture, the better way to turn a horizontal video into a reel than cropping at export. REST: op `reshape`, and the upload routes `/api/projects/:id/uploads` and `/api/uploads/:uid`.

## 0.4.0 · 19 November 2026

**A workspace you can arrange**

- Drag the bars to resize the library, the inspector and the timeline; collapse any of them with the round button on its bar (or a double-click) and bring it back the same way. The sizes are remembered.
- **Full screen** button under the picture, or `F`; `Esc` leaves.

**Keyframes you can pick**

- Click a diamond on the timeline to pick it (it lights up, here and in the inspector), drag it to move it in time, `Delete` removes just that keyframe. The diamonds could not be clicked at all before.
- The inspector lists the clip's keyframes as chips; click one to jump to it.
- **Ready moves with a preview:** each one (slow zoom in / out, punch in, and the new pan right / pan left) is a small animation of what it does. Smoothness is picked from tiles that draw each curve.

**Icons that explain the buttons:** fit, fill, center, the layouts, and fit / fill when exporting.

**Free stock media**

- A **Stock** tab: video B-roll, overlays (light leaks, film grain, dust, bokeh, flares, smoke), photos, music and sound effects from Pexels, Pixabay (free key) and Openverse (no key). One click adds a clip at the playhead or an overlay over the whole frame; licences and credits stay with the files and can be copied for the video description.
- **Blend modes** for video and image layers (screen, lighten, multiply, overlay), the same in the preview and the export.

**The AI agent chat**

- An **AI agent** button in the top bar. The message box is always at the bottom, a card explains how to connect a model, and the settings open as a sheet. Before, without a key, the settings filled the tab and pushed the chat out of view.

**For agents:** `set_blend`, `move_keyframe`, `search_stock`, `add_stock` (50 MCP tools); REST ops `set_blend`, `add_overlay`, `move_keyframe` and `/api/stock/*`.

**Fixed**

- The whole studio (and its remote address) could stop answering for a long time: checking for Whisper ran a slow Python import synchronously. It now runs in the background.

## 0.3.1 · 19 November 2026

**Fixed**

- Export failed when `STUDIO_DATA` was set to a relative folder (such as the `./data` example in `.env.example`): the paths of the title pictures were joined twice. The data folder is now always resolved from the studio folder. Found by running the AI install prompt on a fresh copy of the member zip.

## 0.3.0 · 19 November 2026

**Captions in another language**

- Hebrew speech with English captions, English speech with Hebrew captions, and also Spanish, French, German, Italian, Portuguese and Russian. In **Captions > Transcribe**, pick the **Caption language** next to the spoken one.
- **Translate the captions you already fixed** from **Captions > Fix text**, and **Keep the original too** for captions in two languages, each on its own layer.
- Every caption keeps its timing. The translation is done by the model in the AI agent tab (your own key, or a local model such as Ollama).
- For agents: `generate_captions` takes `translateTo`, and the new tool `translate_captions` (46 MCP tools). REST: `POST /api/projects/:id/captions/translate`.

**Install with one prompt**

- A new [AI install prompt](docs/AI_INSTALL_PROMPT.md): paste it into Claude Code, Codex, Cursor or Gemini CLI and the agent finds the zip, recognises Windows, macOS or Linux, installs what is missing (Node.js, ffmpeg, Python, the Whisper models, GPU support), builds and starts the studio, puts a launcher on the desktop, connects itself over MCP and runs a real test.
- GPU captions without a system CUDA install: the prompt installs the CUDA 12 and cuDNN 9 libraries with pip inside the studio's own Python. Verified on Windows; on Linux the studio preloads them, as faster-whisper recommends (not yet tested on a Linux machine).

**Fixed**

- Local captions failed on a fresh install: a new faster-whisper pulls PyAV 16 or newer, whose decoder it cannot use. The studio now hands Whisper the audio samples itself, so any PyAV version works.

## 0.2.1 · 19 November 2026

**Everything new in 0.2.0 is now an MCP tool**, so an agent connected over MCP can do what you do in the editor. The MCP server goes from 36 to 45 tools:

- `insert_clip`: put a clip in between others; the rest move right to make room and the gap it left closes.
- `set_speed`: speed that moves the clips after it, so nothing overlaps.
- `detach_audio`, `duplicate_clip`, `move_clip_to_new_track`.
- `apply_layout` (one above the other, side by side, picture in picture) and `set_watermark` (a logo on every frame).
- `list_templates` and `save_template`; `create_project` now takes a `layout` or a `templateId`.

The agent chat in the editor gets the editing tools too. The MCP server now reports the studio's real version.

**Fixed**

- Dragging a clip above every layer made the new layer second from the top instead of on top. It now goes above them all.
- `insert_clip` through the REST API closes the gap the clip left even when the caller does not send `from`.

## 0.2.0 · 19 November 2026

**Editing that feels like CapCut**

- **Drag a clip in between others.** A glowing line shows where it goes in, and the clips from there on move right to make room. Dropped on the first half of a clip it goes before it, on the second half after it. With **Close gaps** on, the place it left closes. Works on video, audio, caption and title layers.
- **Speed per clip.** 0.25× to 4× from the timeline toolbar, the right-click menu or the inspector, or any value from 0.1× to 8× with the slider. Slower makes the clip longer and pushes the clips after it right; faster pulls them in.
- **Volume and fades on the clip itself.** Select a clip with sound: drag the line across it for volume (it shows the %), and the dots in its top corners for fade in and fade out.
- **Detach the audio** from the timeline toolbar or the right-click menu, not only from the inspector.
- **Keyframe in one press.** `K` (or the diamond next to the play button) puts a keyframe at the playhead, and again removes it. Move the playhead and move the clip on the preview: the next keyframe is made for you. `Shift+J` / `Shift+K` jump between keyframes; clicking a diamond on the clip jumps to it.
- **Right-click menu on every clip:** split, keyframe, speed, detach audio, mute, duplicate, delete.

**Fixed**

- `I`, `O`, `[` and `]` did nothing after you had clicked a slider (timeline zoom or any slider in the inspector): the slider kept the focus and swallowed the keys. Shortcuts now work after clicking a slider or a button, IN and OUT flags show on the ruler, and a message says what was marked.

**Canvas, layers and export**

- New projects start with two video and two audio layers, and a clip can be dragged right above or below the top layer to make a new one.
- Pick the canvas when you start a project (16:9, 9:16, 4:5, 1:1, 4K), choose a layout (one above the other, side by side, picture in picture) and save any project as a template.
- Logo watermark on every export.
- Audio fade in and fade out, and detach a video's audio onto its own layer.
- Export several presets at once (for example 16:9 and 9:16), with a safe-zone preview per platform.

**Remote access**

- Cloudflare Access sign-in with your email instead of the token page ([REMOTE.md](docs/REMOTE.md)).

**For developers:** two new edit operations on the REST API, `insert_clip` and `set_speed` ([API.md](docs/API.md)). They are not MCP tools yet; the MCP server still has 36 tools.

## 0.1.0 · 13 November 2026

The first member release: cutting, Hebrew and English captions, narration and voice cloning, layers, keyframes, titles, looks, transitions, sound effects, export up to 60 fps, the AI agent chat (big edits wait for your approval of its plan, and its edits come back as a review you keep or take back change by change), the REST API and 36 MCP tools.
