# MCP server

YUV.AI Studio has its own MCP server, so Claude or any other MCP client can edit a project: import footage, cut, add captions and titles, and export. The editor in your browser updates live while the agent works, and you can keep editing by hand at the same time.

The studio must be running (`npm start`).

## Connect

The studio must be running. Its MCP address is `http://127.0.0.1:5177/mcp` on this computer. A studio reached over the internet (see [REMOTE.md](REMOTE.md)) also needs the access token in an `Authorization: Bearer <token>` header; below, `YUV_STUDIO_TOKEN` is an environment variable that holds it. The editor's **API · MCP** dialog shows the same instructions with your own address filled in, and a copy button on each snippet.

Checked against each vendor's documentation on 13 November 2026. Clients change their config formats often; if a step does not match what you see, the linked page is the source.

| Client | Local studio | Studio over the internet | Check |
|---|---|---|---|
| Claude Code | `claude mcp add --transport http --scope user yuv-studio http://127.0.0.1:5177/mcp` | add `--header "Authorization: Bearer <token>"` | `claude mcp list` |
| Claude Desktop | stdio in `claude_desktop_config.json` (below) | Settings > Connectors > Add custom connector, Request headers (beta) | the connector's tool list |
| Codex (OpenAI) | `codex mcp add yuv-studio --url http://127.0.0.1:5177/mcp` | add `--bearer-token-env-var YUV_STUDIO_TOKEN` | `codex mcp list` |
| Cursor | `~/.cursor/mcp.json` with `url` | add `headers` | Output > MCP Logs |
| VS Code (Copilot) | `~/.copilot/mcp-config.json` with `type: "http"` | add `headers` | MCP: List Servers |
| Gemini CLI | `gemini mcp add -s user -t http yuv-studio http://127.0.0.1:5177/mcp` | add `-H "Authorization: Bearer <token>"` | `gemini mcp list` |
| ChatGPT | not possible | not possible (no fixed-token auth) | |

### Claude Code

[Docs](https://code.claude.com/docs/en/mcp). `--scope user` makes the server available in every project; `project` writes `.mcp.json` for the team.

```bash
claude mcp add --transport http --scope user yuv-studio http://127.0.0.1:5177/mcp
```

Over the internet, keep the token out of the command by putting it in `.mcp.json`, which expands `${VAR}`:

```json
{ "mcpServers": { "yuv-studio": { "type": "http", "url": "https://studio.example.com/mcp", "headers": { "Authorization": "Bearer ${YUV_STUDIO_TOKEN}" } } } }
```

Inside a session, `/mcp` shows whether it is connected.

### Claude Desktop

[Local servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers) · [Custom connectors](https://claude.com/docs/connectors/custom/remote-mcp). The config file (Settings > Developer > Edit Config) is `%APPDATA%\Claude\claude_desktop_config.json` on Windows and `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS. It takes processes (stdio), not addresses:

```json
{ "mcpServers": { "yuv-studio": { "command": "npm", "args": ["--silent", "--prefix", "C:\\path\\to\\yuv-studio", "run", "mcp"] } } }
```

Quit and reopen the app. Logs are in `%APPDATA%\Claude\logs\mcp*.log`.

For a studio over the internet, add a custom connector with the https address, Authentication **No sign-in**, and under **Request headers** `authorization: Bearer <token>`. Request headers are a beta that not every organization has yet. Without it, the third-party `mcp-remote` bridge works in the config file (not documented by Anthropic):

```json
{ "mcpServers": { "yuv-studio": { "command": "npx", "args": ["-y", "mcp-remote", "https://studio.example.com/mcp", "--header", "Authorization:${AUTH_HEADER}"], "env": { "AUTH_HEADER": "Bearer <token>" } } } }
```

### Codex (OpenAI)

[Docs](https://learn.chatgpt.com/docs/extend/mcp?surface=cli). HTTP and bearer tokens are supported natively, in `~/.codex/config.toml`:

```toml
[mcp_servers.yuv-studio]
url = "http://127.0.0.1:5177/mcp"
# over the internet:
# url = "https://studio.example.com/mcp"
# bearer_token_env_var = "YUV_STUDIO_TOKEN"
```

`bearer_token_env_var` takes the variable's name, not the token. `/mcp` in Codex lists the tools.

### Cursor

[Docs](https://cursor.com/docs/context/mcp). In `~/.cursor/mcp.json`:

```json
{ "mcpServers": { "yuv-studio": { "url": "http://127.0.0.1:5177/mcp" } } }
```

Over the internet add `"headers": { "Authorization": "Bearer ${env:YUV_STUDIO_TOKEN}" }`.

### VS Code (Copilot agent mode)

[Docs](https://code.visualstudio.com/docs/agents/reference/mcp-configuration). In `~/.copilot/mcp-config.json` (the older `.vscode/mcp.json` with `"servers"` still works until February 2027):

```json
{ "mcpServers": { "yuv-studio": { "type": "http", "url": "http://127.0.0.1:5177/mcp", "tools": ["*"] } } }
```

Over the internet add `"headers": { "Authorization": "Bearer ${YUV_STUDIO_TOKEN}" }`. Run **MCP: List Servers**, then make one tool call to confirm.

### Gemini CLI

[Docs](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md). `httpUrl` means streamable HTTP (`url` would mean SSE):

```bash
gemini mcp add -s user -t http yuv-studio http://127.0.0.1:5177/mcp
```

### ChatGPT

[Docs](https://developers.openai.com/api/docs/guides/custom-mcp-server). ChatGPT connects from OpenAI's cloud, so it cannot reach `127.0.0.1`, and its custom servers accept only OAuth or no authentication, not a fixed token. Putting the studio on the internet without authentication would hand anyone your files, so this is not supported. Use Codex instead.

### Any other client that starts a process (stdio)

```json
{ "mcpServers": { "yuv-studio": { "command": "npm", "args": ["--silent", "--prefix", "C:/path/to/yuv-studio", "run", "mcp"], "env": { "STUDIO_URL": "http://127.0.0.1:5177" } } } }
```

For a studio over the internet, set `STUDIO_URL` to the https address and `STUDIO_TOKEN` to the token.

## Conventions

- Times are seconds on the timeline.
- Tracks are layers; the first track is the top layer.
- `x` and `y` are the centre of an item as a fraction of the frame: `0.5, 0.5` is the middle.
- `scale: 1` fits a clip inside the frame.
- When making several cuts, go from the end of the timeline to the start, so earlier times stay valid.
- `export` takes a `preset` for a platform (`youtube`, `shorts`, `reels`, `tiktok`, `ig-post`, `square`, `x`, `linkedin`, `youtube-4k`) and `reframe: 'fit' | 'fill'` when the shape differs.
- `update_track` with `patch.index` moves a track to another layer position (0 = top).
- A title whose `style.fontFamily` names a font the studio does not have yet downloads it from Google Fonts first.

## Tools

### Projects

| Tool | What it does |
|---|---|
| `list_projects` | List the projects |
| `create_project` | Create a project, optionally with a frame size, a `layout` (`single`, `stack`, `side`, `pip`), a ready-made `starterId` (`youtube`, `reel`, `podcast`, `tutorial`, `feed`) or a saved `templateId`, and a `brandId` (or `"default"`); returns its id and the editor link |
| `list_templates` | The ready-made starters and the saved templates (canvas, layers, layout, titles, logo) |
| `save_template` | Save a project as a template, without its video, audio or captions |
| `list_brands` | The brand kits: colours, fonts, caption look, call to action, logo or not, the default |
| `save_brand` | Create or change a brand kit; the logo comes from an image in a project (`logoFrom`) |
| `apply_brand` | Put a brand kit on a project: captions and titles take its colours and fonts, the logo goes in its corner, new ones follow it |
| `add_brand_card` | The brand's intro card at the start (the edit moves later) or outro card at the end |
| `get_project` | The timeline: assets, tracks and every clip with start and end |
| `set_project` | Name, frame size, frame rate |

### Media and layers

| Tool | What it does |
|---|---|
| `import_media` | Import a file by absolute path; optionally place it on the timeline or as B-roll |
| `import_media_url` | Download a video, audio or image file from a public link (for example a clip generated with Higgsfield) and add it; optionally place it on the timeline or as B-roll |
| `add_clip` | Put an asset on the timeline, whole or a part of it |
| `add_track`, `remove_track`, `update_track` | Add, delete, rename, mute or hide a layer |
| `apply_layout` | Arrange the video layers: `single`, `stack` (one above the other), `side` (side by side), `pip` (picture in picture) |
| `set_watermark` | A logo from an image in the project on every frame: corner, size, opacity, margin; `remove` takes it off |
| `add_text` | A title or text layer from a style preset |
| `add_sfx` | A built-in sound effect at a time |
| `search_stock` | Search free stock: videos and overlays (Pexels, Pixabay, free key), photos and audio (Openverse, no key); returns licence and credit |
| `add_stock` | Download a stock item into the project: as B-roll at a time, as an overlay over the frame (screen blend), or to the media list |

### Editing

| Tool | What it does |
|---|---|
| `cut_range` | Remove a time range from every track and close the gap |
| `split` | Split clips at a time |
| `trim_clip` | Trim the start or end of a clip |
| `move_clip` | Move a clip in time or to another track, overlaps allowed |
| `insert_clip` | Put a clip in between others: the clips from there on move right to make room, and the gap it left closes |
| `move_keyframe` | Move one keyframe to another moment, keeping its values |
| `set_blend` | How a video or image clip mixes with the layers below: normal, screen, lighten, multiply, overlay |
| `reshape_project` | Change the frame shape (e.g. 1920x1080 to a 1080x1920 reel) and re-fit full-frame clips, `fill` or `fit`; captions stay in the frame |
| `move_clip_to_new_track` | Move a clip onto a new layer above or below all the layers of its kind |
| `duplicate_clip` | Copy a clip with all its settings, right after it |
| `delete_clips` | Delete clips, closing the gap by default |
| `set_speed` | Speed of a video or audio clip (0.1 to 8); slower pushes the clips after it right, faster pulls them in |
| `detach_audio` | Split a video clip's sound onto an audio layer and mute the video |
| `update_clip` | Position, size, rotation, opacity, volume, fade in / out, look, transitions, text and style |
| `add_zoom` | Zoom smoothly towards a point of the frame, and back out when `end` is given |
| `set_keyframe` | Pin a clip's position, size, rotation and opacity at one moment; the clip glides between keyframes with the chosen ease |
| `remove_keyframes` | Remove one keyframe, or all the motion of a clip |
| `remove_silences` | Find and cut silent pauses (`dryRun` only lists them) |
| `get_words` | The spoken words on the timeline with times, an index and fillers marked: the data for editing by text |
| `cut_words` | Edit by deleting text: cut words by their index from `get_words`, with the pause after each; captions follow |
| `remove_fillers` | Cut "um", "uh", "אה", "אממ" and stutters; `aggressive` also takes "basically", "you know", "כאילו", "בעצם"; `dryRun` lists them |
| `enhance_voice` | Clean a file's voice (noise, hum, level, loudness); a cleaned copy replaces it on the timeline |
| `remove_background` | Take the background out from behind people in a clip, no green screen: transparent, blurred (portrait mode), or the original with a title between (text behind the person) |
| `auto_reframe` | Make the project vertical (or 4:5, 1:1) with keyframes that follow the speaker's face |
| `find_shorts` | Find the moments of a long video that work as Reels / TikTok / Shorts, each with a title, hook and reason |
| `make_short` | A new vertical project from one moment (video, captions, titles, sounds), the speaker followed |

### Captions

| Tool | What it does |
|---|---|
| `get_transcript` | Transcribe the timeline and return lines with times, to decide what to cut |
| `generate_captions` | Transcribe and build the caption track (`engine`: `auto`, `local`, `cloud`); `translateTo` shows them in another language than the speech |
| `translate_captions` | Translate the captions on the timeline, keeping their times; `keepOriginal` for two languages |
| `get_captions` | Every caption with id, start, end and text |
| `edit_caption` | Correct one caption |
| `replace_in_captions` | Replace a word or phrase in all captions |
| `add_caption`, `merge_captions` | Add a caption by hand, join two |
| `set_caption_style` | Restyle or move all captions |

### Voice

Needs a Cartesia key, see [VOICE.md](VOICE.md).

| Tool | What it does |
|---|---|
| `list_voices` | List text-to-speech voices; `mine` shows the account's own and cloned voices |
| `speak` | Turn text into narration and add it as an audio clip, at `start` when given |
| `clone_voice` | Create a voice from 3 to 30 seconds of speech in a timeline clip or an asset |

### Output

| Tool | What it does |
|---|---|
| `list_presets` | Caption styles, title styles, transitions, looks, sounds |
| `export` | Render the MP4 and return its path |
| `get_job` | State of a background job |

## Motion: zooms and keyframes

A clip (video, image or title) can move while it plays. A **keyframe** pins its whole transform at one moment: `x`, `y` (the centre, as fractions of the frame), `scale`, `rotation`, `opacity`. Between two keyframes the values glide, and the `ease` of the keyframe they arrive at shapes the move:

| ease | The move |
|---|---|
| `ease-in-out` | Starts gently and lands gently. The default |
| `ease-out` | Starts fast, lands gently |
| `ease-in` | Starts gently, ends fast |
| `linear` | Constant speed |
| `hold` | Stays where it was, then jumps at the keyframe |

`add_zoom` is the short way to the most common move. It zooms towards a point (`x`, `y`) by `scale`, taking `ramp` seconds, and returns when `end` is given:

```json
{ "clipId": "c_ab12", "start": 4.0, "end": 7.5, "scale": 1.6, "x": 0.35, "y": 0.4, "ramp": 0.5, "ease": "ease-in-out" }
```

A slow push-in over a whole clip is the same tool with `ramp` set to the clip's length and no `end`. For anything else (a pan, a fade to half opacity, a tilt) set keyframes yourself with `set_keyframe`. `get_project` lists a clip's keyframes, with `t` in seconds from the start of the clip. Splitting, trimming and changing the speed of a clip keep its motion in place.

The export draws the same curves as the preview, at the picture's largest size, so a zoom stays sharp.

## Example prompts

```
Make a brand kit "Acme" with primary #7A6BFF, accent #17BCCF, Inter for text and
Anton for headings. Then start a reel from the "reel" starter in that brand, import
C:/Videos/talk.mp4, caption it, and add the intro and outro cards.
```

```
In "Talk": every time I say the name of a product, zoom in on my face by 1.4 for
two seconds with a smooth ease, then come back.
```

```
Import C:/Videos/talk.mp4 into a new project called "Talk", remove the silences,
add Hebrew captions in the "marker" style and export it.
```

```
In the project "Talk": read the transcript, cut every place where I restart a sentence,
then show me the list of cuts you made.
```

```
Proofread the captions of "Talk". Fix obvious transcription mistakes, and replace
every "cloud code" with "Claude Code".
```

```
Make a vertical 1080x1920 version: set the frame size, scale the main clip to fill
the frame, move the captions to y 0.7 and use 3 words per caption.
```

```
New 9:16 project "Reaction" in the stack layout: my face cam on the top layer,
the screen recording below it. Put the logo C:/brand/logo.png in the top right
corner at 15% width, and save the project as a template called "Reaction".
```

```
In "Talk": find a free light-leak overlay and lay it over the first 5 seconds, then
add a 4-second drone shot of a city as B-roll at 0:20.
```

```
My video "Talk" is in Hebrew. Make English captions, keep the Hebrew ones under them,
and put the English line in the "marker" style.
```

```
In "Talk": play the demo part (40 s to 52 s) at 2x, move the clip that starts at
1:10 to the very start without leaving a gap, and split the music off the intro
clip so it fades out over 2 seconds.
```

## Check that it works

```bash
curl -s -X POST http://127.0.0.1:5177/mcp -H "content-type: application/json" -H "accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The answer lists the 63 tools.
