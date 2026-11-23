# Narration, voice cloning and AI-generated clips

Two additions turn the editor into a place where video is also made, not only cut:

- **Voice** (Cartesia): type text and get narration on the timeline, in a library voice or in a voice cloned from a few seconds of speech.
- **Import by link**: any tool that returns a link to a video, audio or image file can drop its result into a project. That is how clips generated with Higgsfield (Seedance and the rest) arrive.

## Voice (Cartesia)

### Set it up

1. Create an API key at [play.cartesia.ai](https://play.cartesia.ai) (it starts with `sk_car_`).
2. In the studio open the **Voice** tab, paste the key and save. Or set `CARTESIA_API_KEY` in `.env`.

The key is stored in `data/settings.json` on the machine that runs the studio and is never sent to the browser. The model is `sonic-3.6` unless you type another one in the settings.

### Text to speech

1. Type or paste the text. **From captions** fills it with the text of the caption track.
2. Pick a voice. **Library** shows Cartesia's voices for a language; **My voices** shows the voices of your account, including clones. The play button plays a sample of a voice: Cartesia's own when the voice has one, otherwise one short sentence generated once (a few credits) and kept in `data/cache/voice-samples`.
3. **Generate at the playhead** adds the narration as an audio clip. If something already sits at that time on the audio track, the clip goes into the next free spot.

The text language is detected (Hebrew letters mean Hebrew, otherwise English) or chosen by hand. Speed goes from 0.6× to 1.5×.

The audio is saved as a WAV file in `data/media` and behaves like any other clip: move it, trim it, change its volume, export it.

### Clone a voice

1. Put a recording of the speaker on the timeline and select the clip. Cut it first so it holds only that person speaking, with no music or noise.
2. In **Voice > Clone a voice** give the voice a name and a language, confirm that you may clone it, and press the button.

3 to 10 seconds are enough. At most the first 30 seconds of the clip are sent. The new voice appears under **My voices** and becomes the selected voice.

Clone only your own voice or a voice whose owner agreed.

### What it costs and what leaves the machine

Every generation uses credits of the Cartesia account. The text you type and the sample you clone from are sent to Cartesia. Nothing else is.

## Import by link

In the **Media** tab the path field also accepts a link: paste `https://…/clip.mp4` and press Import. The file is downloaded into `data/media` and added to the project.

Rules:

- The link must point at the file itself (video, audio or image), not at a web page.
- Only public internet addresses are accepted. Links to this computer, to the home network or to other private addresses are refused, so the feature cannot be used to reach devices behind the studio.
- Files larger than 2 GB are refused (`STUDIO_MAX_DOWNLOAD_MB` changes the limit).

## Making video with Higgsfield and an agent

The studio does not call Higgsfield itself. An agent that has both connectors does the work in between:

```
you  ->  Claude  ->  Higgsfield MCP (generate)  ->  link to the result
                 ->  YUV.AI Studio MCP (import_media_url, speak, add_text, export)
```

Connect both to the same agent: the Higgsfield connector, and this studio's MCP ([MCP.md](MCP.md)). Then ask in plain words:

> Generate a 5 second clip of a phoenix rising over a pixel city with Seedance, put it as B-roll at 0:12 in my project "Launch", and narrate over it in my cloned voice: "This is where it starts."

The agent generates the clip with Higgsfield, passes the resulting link to `import_media_url` with `broll: true, start: 12`, and calls `speak` with `start: 12`. Generation is paid from your Higgsfield plan and narration from your Cartesia credits.

Tools involved on the studio side: `import_media_url`, `list_voices`, `speak`, `clone_voice`.

## REST

| Endpoint | Body | Result |
|---|---|---|
| `POST /api/projects/:id/assets/import-url` | `{ url, name?, addToTimeline?, broll?, start? }` | A job; its result is `{ asset, clip? }` |
| `GET /api/voice/voices` | query `q`, `language`, `mine=1` | `{ voices, more }` |
| `GET /api/voice/voices/:voiceId/preview` | query `language` (`he` or `en`) | A sample clip of the voice |
| `POST /api/projects/:id/speak` | `{ text, voiceId?, language?, speed?, emotion?, start? }` | `{ asset, clip?, voiceId, language, model, characters }` |
| `POST /api/projects/:id/clone-voice` | `{ name, language?, clipId }` or `{ name, language?, assetId, from?, duration? }` | The new voice |
| `PUT /api/settings` | `{ voice: { apiKey?, model?, voiceId? } }` | Settings without the key |

`speak` without `voiceId` uses the last voice chosen in the studio. Without `start` the audio is only added to the media list.
